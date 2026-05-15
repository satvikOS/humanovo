"""
Billing endpoints — Stripe Checkout + Customer Portal + webhook receiver.

Surface:
  POST /billing/checkout    create a Checkout Session, return its URL
  POST /billing/portal      create a Customer Portal session
  GET  /billing/status      caller's current tier + cap + month-to-date
  POST /billing/webhook     Stripe → our app (signature-verified)

The first three are AUTH_REQUIRED. The webhook is intentionally
unauthenticated — Stripe POSTs to it from the public internet, and
authentication happens via the Stripe-Signature header instead.
That's why the router below wires AUTH_REQUIRED at handler level
(via Depends) on the three user-facing routes, and leaves the
webhook handler dependency-free.
"""

from __future__ import annotations

import logging
from collections import OrderedDict
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_active_user
from app.core.database import get_db
from app.models.user import User, UserTier
from app.services.budget_enforcer_service import (
    TIER_MONTHLY_CAP_CENTS,
    get_user_budget_service,
)
from app.services.stripe_service import (
    StripeNotConfiguredError,
    StripeWebhookSignatureError,
    apply_checkout_completed,
    apply_subscription_event,
    create_checkout_session,
    create_portal_session,
    verify_webhook,
)

logger = logging.getLogger(__name__)

# NOT registered with router-level AUTH_REQUIRED because the webhook
# endpoint MUST be reachable without a bearer token. Per-handler
# dependencies enforce auth on the user-facing routes.
router = APIRouter(prefix="/billing", tags=["billing"])


# ─── Webhook idempotency cache ──────────────────────────────────────
#
# Stripe retries non-2xx events for up to 3 days. The underlying
# apply_*() service functions are idempotent (UPSERT semantics on
# stripe_customer_id / tier), so a retry doesn't corrupt state - but
# it does waste DB round-trips and log lines, AND a horizontally-
# scaled deployment can't trust an in-process LRU alone (worker A's
# cache doesn't help worker B).
#
# Two-layer dedup:
#   1. In-process LRU — fast-path, eliminates DB round trip on the
#      common case of Stripe re-delivering within seconds to the
#      same worker.
#   2. Persistent stripe_processed_events table (migration 025) —
#      cross-worker truth. Insert ON CONFLICT DO NOTHING; the
#      RETURNING xmax tells us whether the row was already there.
#
# `_seen_event_in_memory` retains the synchronous LRU contract; the
# new `_record_event_seen` helper is async (DB write) and is the
# authoritative dedup gate in the webhook handler.

_RECENT_EVENT_IDS: OrderedDict[str, None] = OrderedDict()
_RECENT_EVENT_CAP = 4096


def _seen_event_in_memory(event_id: str) -> bool:
    """In-process LRU fast-path. Returns True if already seen on
    this worker. Doesn't update the LRU on a hit — that happens on
    the WRITE path (`_record_event_seen`)."""
    if not event_id:
        return False
    return event_id in _RECENT_EVENT_IDS


async def _record_event_seen(
    db: AsyncSession,
    event_id: str,
    event_type: str,
    *,
    stripe_created_ts: int | None = None,
    customer_id: str | None = None,
) -> bool:
    """Record an event_id in the persistent dedup table. Returns True
    if this is the FIRST time we've seen this event (we should
    process it), False if it was already there (replay — short-
    circuit). Uses INSERT ... ON CONFLICT DO NOTHING so the path is
    a single round-trip with no race.

    Also updates the in-process LRU on first-see so subsequent
    same-worker checks short-circuit before reaching the DB."""
    if not event_id:
        # Should never happen — Stripe always includes event.id.
        # Fail open (allow processing) rather than silently swallow.
        return True

    from datetime import UTC, datetime
    from sqlalchemy import text

    stripe_ts = (
        datetime.fromtimestamp(stripe_created_ts, tz=UTC)
        if stripe_created_ts else None
    )
    # ON CONFLICT DO NOTHING + RETURNING returns 1 row if inserted,
    # 0 rows if conflict. We use that to disambiguate first-see vs.
    # replay without a separate SELECT.
    result = await db.execute(
        text(
            """
            INSERT INTO stripe_processed_events
                (event_id, event_type, stripe_created_at, customer_id)
            VALUES (:event_id, :event_type, :stripe_created_at, :customer_id)
            ON CONFLICT (event_id) DO NOTHING
            RETURNING event_id
            """
        ),
        {
            "event_id": event_id,
            "event_type": event_type,
            "stripe_created_at": stripe_ts,
            "customer_id": customer_id,
        },
    )
    inserted = result.scalar_one_or_none() is not None
    if inserted:
        # Update the in-process LRU so a same-worker replay short-
        # circuits without re-hitting the DB.
        _RECENT_EVENT_IDS[event_id] = None
        while len(_RECENT_EVENT_IDS) > _RECENT_EVENT_CAP:
            _RECENT_EVENT_IDS.popitem(last=False)
    return inserted


# ─── Schemas ────────────────────────────────────────────────────────


class CheckoutRequest(BaseModel):
    target_tier: UserTier


class CheckoutResponse(BaseModel):
    checkout_url: str


class PortalResponse(BaseModel):
    portal_url: str


class StatusResponse(BaseModel):
    tier: UserTier
    monthly_budget_cents: int
    current_month_spend_cents: int
    remaining_cents: int
    threshold_pct: int
    has_paid_subscription: bool
    subscription_status: str | None


# ─── User-facing endpoints (AUTH_REQUIRED via Depends) ──────────────


@router.post("/checkout", response_model=CheckoutResponse)
async def start_checkout(
    body: CheckoutRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> CheckoutResponse:
    """Create a Stripe Checkout Session for the requested tier and
    return the URL to redirect the user to.

    Trial-tier users entering their first paid checkout, and existing
    paid users upgrading/downgrading, both use this endpoint —
    Stripe's Checkout flow handles the existing-subscription case
    correctly via the customer record we created on first checkout.
    """
    try:
        url = create_checkout_session(current_user, body.target_tier)
    except StripeNotConfiguredError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return CheckoutResponse(checkout_url=url)


@router.post("/portal", response_model=PortalResponse)
async def open_portal(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> PortalResponse:
    """Create a Stripe Customer Portal session and return its URL.

    The Portal is the Stripe-hosted UI for cancellation, payment-method
    updates, invoice history, and tier swaps. We open it in the OS
    browser via the desktop app's deep-link handler.
    """
    try:
        url = create_portal_session(current_user)
    except StripeNotConfiguredError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return PortalResponse(portal_url=url)


@router.get("/status", response_model=StatusResponse)
async def get_status(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> StatusResponse:
    """Return the caller's tier, monthly cap, and month-to-date spend.

    Drives the desktop app's billing tab — no Stripe round-trip on this
    endpoint, all data is in our DB. Stripe-state freshness depends on
    the webhook keeping User.stripe_subscription_status in sync; the
    `has_paid_subscription` flag is the cheapest test.
    """
    cfg = await get_user_budget_service().get_or_create(str(current_user.id))
    spend = int(cfg["current_month_spend_cents"])
    cap = int(cfg["monthly_budget_cents"])
    return StatusResponse(
        tier=current_user.tier,
        monthly_budget_cents=cap,
        current_month_spend_cents=spend,
        remaining_cents=max(0, cap - spend),
        threshold_pct=int(cfg["alert_threshold_pct"]),
        has_paid_subscription=current_user.stripe_subscription_id is not None,
        subscription_status=current_user.stripe_subscription_status,
    )


# ─── Webhook (UNAUTHENTICATED, signature-verified) ──────────────────


@router.post("/webhook")
async def stripe_webhook(
    request: Request,
    stripe_signature: Annotated[str | None, Header(alias="Stripe-Signature")] = None,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Stripe POSTs subscription events here. Verify the signature,
    then translate the event into a UserTier change.

    Always returns 2xx for events we successfully verify (even if we
    can't find a matching user — that's a permanent state Stripe's
    retry machinery can't fix). 400 only on signature failure.
    """
    if not stripe_signature:
        raise HTTPException(status_code=400, detail="missing Stripe-Signature header")

    payload = await request.body()
    try:
        event = verify_webhook(payload, stripe_signature)
    except StripeWebhookSignatureError as exc:
        # Don't echo the upstream error string in the response — it can
        # leak the configured webhook secret in error messages.
        logger.warning("stripe webhook signature failed: %s", exc)
        raise HTTPException(status_code=400, detail="signature verification failed")
    except StripeNotConfiguredError as exc:
        raise HTTPException(status_code=503, detail=str(exc))

    # Idempotency. Two-layer dedup: in-process LRU first (cheap),
    # then persistent stripe_processed_events table (cross-worker
    # truth). The persistent insert is ON CONFLICT DO NOTHING; if
    # the row already exists we short-circuit before applying
    # business logic. The underlying apply_*() service functions are
    # inherently idempotent (UPSERT on stripe_customer_id / tier),
    # so this is a defence-in-depth layer rather than the only line.
    event_id = event.get("id", "")
    event_type = event["type"]
    data = event["data"]["object"]

    if _seen_event_in_memory(event_id):
        logger.info(
            "stripe webhook: in-memory replay short-circuited",
            extra={"event_id": event_id, "event_type": event_type},
        )
        return {"received": True, "event": event_type, "status": "duplicate"}

    # Persistent dedup. `is_first_seen` is True iff this insert
    # actually wrote a new row — same single round-trip handles both
    # the dedup check and the dedup write.
    customer_id = (data.get("customer") if isinstance(data, dict) else None)
    is_first_seen = await _record_event_seen(
        db,
        event_id=event_id,
        event_type=event_type,
        stripe_created_ts=event.get("created"),
        customer_id=customer_id,
    )
    if not is_first_seen:
        logger.info(
            "stripe webhook: persistent replay short-circuited",
            extra={"event_id": event_id, "event_type": event_type},
        )
        return {"received": True, "event": event_type, "status": "duplicate"}

    if event_type == "checkout.session.completed":
        # Persist the stripe_customer_id on the user so subsequent
        # subscription events resolve. The actual tier flip happens in
        # customer.subscription.created which fires moments later.
        result = await apply_checkout_completed(data, db)
        await db.commit()
        return {"received": True, "event": event_type, **result}

    if event_type in (
        "customer.subscription.created",
        "customer.subscription.updated",
        "customer.subscription.deleted",
    ):
        result = await apply_subscription_event(event_type, data, db)
        await db.commit()
        return {"received": True, "event": event_type, **result}

    if event_type == "invoice.paid":
        # Paying customer just had a successful invoice. Send the
        # receipt email via the receipt service (idempotent on
        # invoice.id). Subscription state machine already updated
        # tier via customer.subscription.updated; this is purely
        # the user-facing notification.
        try:
            from app.services.receipt_service import send_receipt
            recv_result = await send_receipt(db, invoice=data)
            await db.commit()
            return {"received": True, "event": event_type, **recv_result}
        except Exception as e:
            logger.warning("invoice.paid receipt send failed: %s", e)
            return {"received": True, "event": event_type, "status": "logged_no_send"}

    if event_type == "charge.refunded":
        # Reconcile a refund issued from the Stripe dashboard (i.e.
        # one that bypassed our /admin/billing/refund endpoint). The
        # reconciler dedupes on stripe_refund_id so admin-UI refunds
        # — which already have a refund_records row — are skipped
        # cleanly; only dashboard-originated refunds INSERT new rows
        # and fire the customer confirmation email.
        try:
            from app.services.receipt_service import (
                reconcile_stripe_refund_event,
            )
            recon_result = await reconcile_stripe_refund_event(db, charge=data)
            await db.commit()
            return {"received": True, "event": event_type, **recon_result}
        except Exception as e:
            logger.warning("charge.refunded reconcile failed: %s", e)
            return {"received": True, "event": event_type, "status": "logged_no_reconcile"}

    if event_type == "invoice.payment_failed":
        # Stripe will retry the invoice for ~3 weeks; we don't downgrade
        # the user yet (subscription.updated → past_due covers that).
        # Send the first-touch payment-failed email (lightweight; the
        # full dunning cadence fires from the state machine when
        # subscription status flips past_due — Phase 2.6).
        try:
            from app.services.receipt_service import send_payment_failed
            sent_result = await send_payment_failed(db, invoice=data)
            await db.commit()
            return {"received": True, "event": event_type, **sent_result}
        except Exception as e:
            sub_id = data.get("subscription")
            logger.warning(
                "stripe invoice.payment_failed first-touch email failed: %s",
                e,
                extra={"subscription_id": sub_id, "customer_id": data.get("customer")},
            )
            return {"received": True, "event": event_type, "status": "logged_no_send"}

    # All other events (price.created, charge.succeeded, etc.) — log
    # at info, return 2xx so Stripe doesn't retry.
    logger.info("stripe webhook: unhandled event type", extra={"event_type": event_type})
    return {"received": True, "event": event_type, "status": "ignored"}


# ─── Tier-cap snapshot (helper for the desktop app's pricing UI) ────


@router.get("/tiers")
async def get_tier_catalog(
    current_user: User = Depends(get_current_active_user),
) -> dict[str, Any]:
    """Return the public pricing catalog — what each tier costs per
    month and what monthly cap it includes. Surfaces in the desktop
    app's "Upgrade" page so users see prices before they hit Stripe."""
    return {
        "current_tier": current_user.tier.value,
        "tiers": {
            "trial": {
                "monthly_cap_cents": TIER_MONTHLY_CAP_CENTS["trial"],
                "monthly_price_cents": 0,
                "description": "Free trial — try a few hypothesis runs.",
            },
            "researcher": {
                "monthly_cap_cents": TIER_MONTHLY_CAP_CENTS["researcher"],
                "monthly_price_cents": 2000,
                "description": "Limited monthly hypotheses, full feature set, 1 user.",
            },
            "lab": {
                "monthly_cap_cents": TIER_MONTHLY_CAP_CENTS["lab"],
                "monthly_price_cents": 20000,
                "description": "Generous hypothesis volume, multi-user lab workspace.",
            },
            "institution": {
                "monthly_cap_cents": TIER_MONTHLY_CAP_CENTS["institution"],
                "monthly_price_cents": None,  # custom-quoted
                "description": "Volume pricing, BAA, dedicated support. Contact sales.",
            },
        },
    }
