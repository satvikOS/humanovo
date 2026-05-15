"""User-facing billing endpoints — cancel + invoice list.

Two surfaces:

  POST /api/v1/account/cancel-subscription
    Schedule a cancellation at period end (Stripe-side) +
    capture the user's reason in cancellation_reasons for
    analytics. User keeps access until current_period_end;
    after that, customer.subscription.deleted webhook fires,
    state machine records the transition, and tier downgrades
    to trial.

  GET /api/v1/account/invoices?limit=20
    Last N Stripe invoices for the authenticated user. Returns
    amount, status, period, PDF link.
"""
from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user
from app.core.config import settings
from app.core.database import get_db
from app.core.rate_limit import rate_limit
from app.models.user import User


logger = logging.getLogger(__name__)
router = APIRouter()


VALID_REASON_CATEGORIES = {
    "price",       # "too expensive"
    "features",    # "missing X / Y didn't work for me"
    "bug",         # "kept hitting bugs"
    "churn",       # "moving to a different tool"
    "no_longer_needed",  # "project ended"
    "other",       # free text
}


class CancelSubscriptionRequest(BaseModel):
    reason_category: str = Field(
        description="One of: price | features | bug | churn | no_longer_needed | other",
    )
    reason_text: str | None = Field(default=None, max_length=2000)


def _stripe_api_key() -> str | None:
    skey = getattr(settings, "STRIPE_SECRET_KEY", None)
    if hasattr(skey, "get_secret_value"):
        return skey.get_secret_value()
    return skey if isinstance(skey, str) else None


@router.post(
    "/account/cancel-subscription",
    dependencies=[Depends(rate_limit("user"))],
)
async def cancel_subscription(
    body: CancelSubscriptionRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """Schedule cancellation at period end + record the reason.

    Implementation:
      1. Validate reason_category against the allowlist.
      2. Record the cancellation_reasons row regardless of Stripe
         outcome (we want analytics even if the actual Stripe call
         transiently fails — operator can retry the Stripe side).
      3. Call Stripe Subscription.modify(cancel_at_period_end=True)
         so the user keeps access until period end. The eventual
         customer.subscription.deleted webhook fires when the
         period ends; the state machine handles the tier downgrade
         + final email.
    """
    if body.reason_category not in VALID_REASON_CATEGORIES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"reason_category must be one of: {sorted(VALID_REASON_CATEGORIES)}.",
        )
    if not current_user.stripe_subscription_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="No active subscription to cancel.",
        )

    # Record reason FIRST — even if Stripe fails, we keep the
    # analytics signal. The operator can retry the Stripe side
    # manually from the dashboard.
    await db.execute(
        text(
            """
            INSERT INTO cancellation_reasons
                (user_id, reason_category, reason_text,
                 stripe_subscription_id, cancel_at_period_end)
            VALUES (:uid, :cat, :txt, :sub_id, TRUE)
            """
        ),
        {
            "uid": str(current_user.id),
            "cat": body.reason_category,
            "txt": body.reason_text,
            "sub_id": current_user.stripe_subscription_id,
        },
    )
    await db.commit()

    # Stripe side. Best-effort: log + 200 even on Stripe error so
    # the user sees a confirming UI; ops follow up via dashboard.
    stripe_result: dict[str, Any] = {"status": "scheduled"}
    try:
        import stripe  # type: ignore

        api_key = _stripe_api_key()
        if not api_key:
            stripe_result = {"status": "logged_only", "reason": "stripe not configured"}
        else:
            stripe.api_key = api_key
            sub = stripe.Subscription.modify(
                current_user.stripe_subscription_id,
                cancel_at_period_end=True,
            )
            stripe_result = {
                "status": "scheduled",
                "cancel_at": getattr(sub, "current_period_end", None),
            }
    except Exception as e:
        logger.warning(
            "stripe cancel failed user_id=%s sub_id=%s: %s",
            current_user.id, current_user.stripe_subscription_id, e,
        )
        stripe_result = {"status": "logged_only", "reason": f"stripe error: {e}"}

    return {
        "reason_recorded": True,
        "stripe": stripe_result,
        "message": (
            "Your subscription will end at the end of the current billing "
            "period. You keep access until then. To undo, manage your "
            "subscription via Settings → Billing → Customer Portal."
        ),
    }


@router.get(
    "/account/invoices",
    dependencies=[Depends(rate_limit("user"))],
)
async def list_invoices(
    limit: int = Query(default=20, ge=1, le=100),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """List the user's last N Stripe invoices. Returns an empty
    array for users without a stripe_customer_id (free tier /
    trial users who've never been charged)."""
    if not current_user.stripe_customer_id:
        return {"invoices": [], "count": 0}

    try:
        import stripe  # type: ignore

        api_key = _stripe_api_key()
        if not api_key:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Billing service is not configured.",
            )
        stripe.api_key = api_key
        page = stripe.Invoice.list(
            customer=current_user.stripe_customer_id,
            limit=limit,
        )
        invoices = [
            {
                "id": inv.id,
                "amount_paid_cents": int(getattr(inv, "amount_paid", 0)),
                "amount_due_cents": int(getattr(inv, "amount_due", 0)),
                "currency": getattr(inv, "currency", "usd"),
                "status": getattr(inv, "status", None),
                "period_start": getattr(inv, "period_start", None),
                "period_end": getattr(inv, "period_end", None),
                "created": getattr(inv, "created", None),
                "hosted_invoice_url": getattr(inv, "hosted_invoice_url", None),
                "invoice_pdf": getattr(inv, "invoice_pdf", None),
                "subscription_id": getattr(inv, "subscription", None),
            }
            for inv in page.data
        ]
    except HTTPException:
        raise
    except Exception as e:
        logger.warning(
            "stripe invoice.list failed user_id=%s: %s",
            current_user.id, e,
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Could not fetch invoices from billing provider.",
        )

    return {"invoices": invoices, "count": len(invoices)}


class PortalSessionRequest(BaseModel):
    return_url: str | None = Field(
        default=None,
        description=(
            "URL Stripe should redirect to when the user clicks "
            "'Return to humanovo'. Defaults to the FRONTEND_BASE_URL "
            "account/billing page so we control the bounce-back."
        ),
    )


def _default_return_url() -> str:
    """Resolve the safe default return URL the Stripe Portal bounces
    back to. Reads FRONTEND_BASE_URL from settings; falls back to the
    public app domain so an unconfigured dev environment still gets
    a sane round-trip."""
    base = getattr(settings, "FRONTEND_BASE_URL", None) or "https://app.humanovo.net"
    return f"{base.rstrip('/')}/account/billing"


@router.post(
    "/account/billing/portal-session",
    dependencies=[Depends(rate_limit("user"))],
)
async def create_portal_session(
    body: PortalSessionRequest | None = None,
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """Mint a Stripe Customer Portal session and return its URL.

    The Portal is Stripe's hosted UI that lets the user update card,
    address, tax id, see invoices, and cancel — all surfaces we
    intentionally don't reimplement. The frontend opens the returned
    `url` in a new tab; when the user clicks "Return to humanovo"
    Stripe redirects back to `return_url`.

    Failure modes:
      • User has no stripe_customer_id → 409 (no billing relationship
        yet — likely a free-tier or trial user; nothing to manage).
      • Stripe not configured → 503.
      • Stripe API call fails → 502.

    The `return_url` argument is validated against a tiny allowlist
    of schemes (http/https only) to prevent a malicious frontend
    from injecting javascript: or arbitrary protocol URLs into the
    Stripe redirect.
    """
    if not current_user.stripe_customer_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "No billing relationship — start a subscription or "
                "trial first."
            ),
        )

    return_url = (body.return_url if body else None) or _default_return_url()
    # Belt-and-braces: don't let the frontend smuggle a non-http(s)
    # scheme into Stripe's redirect. Stripe itself validates but we
    # match their bar so a misuse is caught here with a clear 400.
    if not (return_url.startswith("https://") or return_url.startswith("http://")):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="return_url must be an http(s) URL.",
        )

    api_key = _stripe_api_key()
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Billing service is not configured.",
        )

    try:
        import stripe  # type: ignore
        stripe.api_key = api_key
        session = stripe.billing_portal.Session.create(
            customer=current_user.stripe_customer_id,
            return_url=return_url,
        )
    except Exception as e:
        logger.warning(
            "stripe billing_portal.Session.create failed user_id=%s: %s",
            current_user.id, e,
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Could not create billing-portal session.",
        ) from None

    return {
        "url": getattr(session, "url", None),
        "return_url": return_url,
        "expires_at": getattr(session, "expires_at", None),
    }
