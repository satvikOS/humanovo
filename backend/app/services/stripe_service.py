"""
Stripe billing service — Checkout + Customer Portal + webhook handler.

The bridge between humanovo's `UserTier` enum and Stripe subscriptions.
The desktop app surfaces billing through three calls:

  POST /billing/checkout   →  creates a Stripe Checkout Session, returns
                              the redirect URL the app opens in the OS
                              browser. After payment Stripe redirects to
                              `humanovo://billing/success` — the Tauri
                              shell registers that as a custom-protocol
                              handler and re-focuses the app window.
  POST /billing/portal     →  Stripe-hosted Customer Portal for managing
                              the subscription (cancel, swap card, swap
                              tier, see invoices). Same redirect pattern.
  POST /billing/webhook    →  unauthenticated endpoint Stripe POSTs to
                              with subscription events. We verify the
                              signature, then translate the event to a
                              `UserTier` change on the matching User row.

Tier ↔ Stripe price mapping is configured per-environment via the
STRIPE_PRICE_* env vars. The reverse map (price_id → UserTier) is
built once on import and used by the webhook handler to decide which
tier to set when a subscription is created or its price changes.

Failure modes worth knowing about:
  - Stripe libs not configured (no STRIPE_SECRET_KEY): every entry
    point in this module raises StripeNotConfiguredError. Endpoints
    catch it and return 503 with a clear message — useful in local
    dev / tests where you don't want to touch Stripe at all.
  - Webhook signature mismatch: returns 400, logs the headers but
    not the body (the body is hostile by definition).
  - Subscription event for a user we can't find via stripe_customer_id:
    log loudly + return 200 (Stripe retries on non-2xx, and a missing
    user is a permanent state that retries can't fix).
"""

from __future__ import annotations

import logging
from typing import Any
from uuid import UUID

from app.core.config import settings
from app.models.user import User, UserTier

logger = logging.getLogger(__name__)


class StripeNotConfiguredError(RuntimeError):
    """Raised when a Stripe API call is attempted without STRIPE_SECRET_KEY."""


class StripeWebhookSignatureError(RuntimeError):
    """Raised when an inbound webhook fails signature verification."""


# ─── Configuration ──────────────────────────────────────────────────


def _ensure_configured() -> None:
    """Raises StripeNotConfiguredError if the secret isn't set."""
    if settings.STRIPE_SECRET_KEY is None:
        raise StripeNotConfiguredError(
            "STRIPE_SECRET_KEY is not set; billing endpoints are disabled. "
            "Configure it in the env to enable Stripe."
        )


def _stripe_client():
    """Return the configured `stripe` module. Done inside a function so
    test code can monkey-patch the import without affecting production."""
    _ensure_configured()
    import stripe  # local import — only loaded when actually configured

    stripe.api_key = settings.STRIPE_SECRET_KEY.get_secret_value()
    return stripe


def _tier_to_price_id(tier: UserTier) -> str | None:
    """Map a UserTier to its configured Stripe price ID. None for tiers
    that don't have a paid Stripe product (Trial)."""
    return {
        UserTier.TRIAL: None,
        UserTier.RESEARCHER: settings.STRIPE_PRICE_RESEARCHER_MONTHLY,
        UserTier.LAB: settings.STRIPE_PRICE_LAB_MONTHLY,
        UserTier.INSTITUTION: settings.STRIPE_PRICE_INSTITUTION_MONTHLY,
    }.get(tier)


def _price_id_to_tier(price_id: str | None) -> UserTier:
    """Reverse-map a Stripe price ID back to a UserTier. Returns TRIAL
    for unknown / unset prices so a stale env var can't accidentally
    upgrade a user to a paid tier they didn't pay for."""
    if not price_id:
        return UserTier.TRIAL
    if price_id == settings.STRIPE_PRICE_RESEARCHER_MONTHLY:
        return UserTier.RESEARCHER
    if price_id == settings.STRIPE_PRICE_LAB_MONTHLY:
        return UserTier.LAB
    if price_id == settings.STRIPE_PRICE_INSTITUTION_MONTHLY:
        return UserTier.INSTITUTION
    logger.warning(
        "stripe price_id not in tier map; defaulting to TRIAL",
        extra={"price_id": price_id},
    )
    return UserTier.TRIAL


# ─── Customer + Checkout ────────────────────────────────────────────


def get_or_create_customer(user: User) -> str:
    """Return the user's Stripe customer ID, creating one if needed.

    Stripe's `customers.create` is not idempotent on its own; we use
    the user.id as the `metadata.humanovo_user_id` and check for
    existing by email *before* creating to avoid duplicates if the
    DB write happens to fail mid-flight.
    """
    stripe = _stripe_client()
    if user.stripe_customer_id:
        return user.stripe_customer_id

    # Check first by email — Stripe allows multiple customers with the
    # same email, but we don't want that.
    existing = stripe.Customer.list(email=user.email, limit=1)
    if existing.data:
        return existing.data[0].id

    cust = stripe.Customer.create(
        email=user.email,
        name=user.full_name or user.email,
        metadata={"humanovo_user_id": str(user.id)},
    )
    return cust.id


def create_checkout_session(user: User, target_tier: UserTier) -> str:
    """Create a Stripe Checkout Session for `target_tier` and return
    the URL the client should redirect to.

    Raises ValueError if `target_tier` is TRIAL (Trial isn't paid) or
    has no configured price ID.
    """
    if target_tier == UserTier.TRIAL:
        raise ValueError("Cannot checkout for Trial tier (it's free)")

    price_id = _tier_to_price_id(target_tier)
    if not price_id:
        raise ValueError(
            f"No Stripe price configured for tier {target_tier.value}; "
            f"set STRIPE_PRICE_{target_tier.value.upper()}_MONTHLY"
        )

    stripe = _stripe_client()
    customer_id = get_or_create_customer(user)

    session = stripe.checkout.Session.create(
        mode="subscription",
        customer=customer_id,
        line_items=[{"price": price_id, "quantity": 1}],
        success_url=settings.STRIPE_CHECKOUT_SUCCESS_URL,
        cancel_url=settings.STRIPE_CHECKOUT_CANCEL_URL,
        # Carry the user.id and target tier into the session so the
        # webhook handler can resolve the user even if a race made
        # `customer.subscription.created` arrive before our DB write
        # of stripe_customer_id finishes. Belt-and-suspenders.
        metadata={
            "humanovo_user_id": str(user.id),
            "target_tier": target_tier.value,
        },
        client_reference_id=str(user.id),
    )
    logger.info(
        "stripe checkout session created",
        extra={
            "user_id": str(user.id),
            "target_tier": target_tier.value,
            "session_id": session.id,
        },
    )
    return session.url


def create_portal_session(user: User) -> str:
    """Create a Stripe Customer Portal session and return its URL.

    Used by the desktop app to surface a "Manage subscription" button
    that opens Stripe-hosted UI for cancellation, card updates, and
    invoice history.
    """
    if not user.stripe_customer_id:
        raise ValueError(
            "User has no Stripe customer record; complete a checkout "
            "first so we have a customer to open the portal for."
        )
    stripe = _stripe_client()
    sess = stripe.billing_portal.Session.create(
        customer=user.stripe_customer_id,
        return_url=settings.STRIPE_PORTAL_RETURN_URL,
    )
    return sess.url


# ─── Webhook ────────────────────────────────────────────────────────


def verify_webhook(payload: bytes, signature: str) -> Any:
    """Verify Stripe-Signature header and return the decoded event.

    Raises StripeWebhookSignatureError on any verification failure
    (bad signature, missing secret, malformed body). Caller should
    return 400 in that case.
    """
    if settings.STRIPE_WEBHOOK_SECRET is None:
        raise StripeWebhookSignatureError(
            "STRIPE_WEBHOOK_SECRET not configured"
        )
    stripe = _stripe_client()
    try:
        return stripe.Webhook.construct_event(
            payload=payload,
            sig_header=signature,
            secret=settings.STRIPE_WEBHOOK_SECRET.get_secret_value(),
        )
    except (
        stripe.error.SignatureVerificationError,  # type: ignore[attr-defined]
        ValueError,
    ) as exc:
        raise StripeWebhookSignatureError(str(exc)) from exc


def _resolve_tier_for_subscription(subscription: dict) -> UserTier:
    """Pull the subscription's first item's price ID and translate
    to a UserTier."""
    items = subscription.get("items", {}).get("data", [])
    if not items:
        return UserTier.TRIAL
    price_id = items[0].get("price", {}).get("id")
    return _price_id_to_tier(price_id)


# Map Stripe subscription status → whether to honor the paid tier.
# `canceled` and `unpaid` revert to TRIAL so a delinquent account can't
# keep burning the higher cap. `past_due` keeps the paid tier active for
# one cycle so a transient card decline doesn't kick a paying customer.
_PAID_STATUSES = {"active", "trialing", "past_due"}


async def apply_subscription_event(
    event_type: str,
    subscription: dict,
    db,  # AsyncSession; passed in to avoid an import cycle
) -> dict[str, Any]:
    """Translate a Stripe subscription event to a UserTier change.

    Returns a small dict describing what happened, useful for the
    webhook handler's response logging. Idempotent — re-processing the
    same event is safe (Stripe retries on non-2xx).
    """
    from sqlalchemy import select  # local import to dodge potential cycles

    customer_id = subscription.get("customer")
    if not customer_id:
        return {"status": "skipped", "reason": "no customer on subscription"}

    result = await db.execute(
        select(User).where(User.stripe_customer_id == customer_id)
    )
    user = result.scalar_one_or_none()
    if user is None:
        # This should be rare — `customer.subscription.created` fires
        # right after `customer.created`, both seconds after our
        # checkout. If it does happen, log and 200 (Stripe retries on
        # non-2xx, but the missing user is permanent state).
        logger.warning(
            "stripe webhook: no user for customer_id",
            extra={"customer_id": customer_id, "event_type": event_type},
        )
        return {"status": "skipped", "reason": "no user for customer_id"}

    sub_id = subscription.get("id")
    sub_status = subscription.get("status")

    if event_type == "customer.subscription.deleted":
        new_tier = UserTier.TRIAL
        new_sub_id = None
    elif sub_status in _PAID_STATUSES:
        new_tier = _resolve_tier_for_subscription(subscription)
        new_sub_id = sub_id
    else:
        # `canceled`, `unpaid`, `incomplete_expired`, etc. Revoke paid
        # access. We KEEP stripe_customer_id so the user can re-enter
        # checkout from the same identity.
        new_tier = UserTier.TRIAL
        new_sub_id = None

    old_tier = user.tier
    user.tier = new_tier
    user.stripe_subscription_id = new_sub_id
    user.stripe_subscription_status = sub_status
    await db.flush()

    logger.info(
        "stripe webhook applied",
        extra={
            "user_id": str(user.id),
            "event_type": event_type,
            "old_tier": old_tier.value if hasattr(old_tier, "value") else str(old_tier),
            "new_tier": new_tier.value,
            "subscription_id": sub_id,
            "subscription_status": sub_status,
        },
    )
    return {
        "status": "applied",
        "user_id": str(user.id),
        "old_tier": old_tier.value if hasattr(old_tier, "value") else str(old_tier),
        "new_tier": new_tier.value,
    }


async def apply_checkout_completed(
    session: dict,
    db,
) -> dict[str, Any]:
    """Persist the stripe_customer_id on the user when checkout
    completes, so subsequent subscription events resolve correctly.

    The actual tier change is driven by `customer.subscription.created`
    which fires immediately after — but persisting the customer_id here
    closes the race where the subscription event arrives first.
    """
    from sqlalchemy import select

    customer_id = session.get("customer")
    user_id_raw = (session.get("metadata") or {}).get("humanovo_user_id") or session.get(
        "client_reference_id"
    )
    if not customer_id or not user_id_raw:
        return {"status": "skipped", "reason": "missing customer or user_id"}

    try:
        user_uuid = UUID(user_id_raw)
    except (TypeError, ValueError):
        logger.warning(
            "stripe webhook: bad humanovo_user_id metadata",
            extra={"user_id_raw": user_id_raw, "customer_id": customer_id},
        )
        return {"status": "skipped", "reason": "bad user_id metadata"}

    result = await db.execute(select(User).where(User.id == user_uuid))
    user = result.scalar_one_or_none()
    if user is None:
        logger.warning(
            "stripe webhook: checkout.completed for unknown user",
            extra={"user_id": user_id_raw, "customer_id": customer_id},
        )
        return {"status": "skipped", "reason": "unknown user"}

    user.stripe_customer_id = customer_id
    await db.flush()
    return {"status": "applied", "user_id": user_id_raw, "customer_id": customer_id}
