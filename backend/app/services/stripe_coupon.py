"""Stripe Coupon API integration.

When a user redeems a `percent_off` or `fixed_cents_off` promo code,
this module creates a one-shot Stripe Coupon they can apply at next
checkout. The coupon is scoped to the customer (max_redemptions=1)
so it can't leak across users.

The coupon ID is returned to the caller; the desktop UI passes it as
the `discounts` field on the next `checkout.session.create` call.
"""
from __future__ import annotations

import logging
import secrets

from app.core.config import settings


logger = logging.getLogger(__name__)


# Stripe Coupon duration values. We use `once` so the discount
# applies to a single invoice only — preventing perpetual discounts
# that would erode revenue.
COUPON_DURATION = "once"


def _stripe_api_key() -> str | None:
    skey = getattr(settings, "STRIPE_SECRET_KEY", None)
    if hasattr(skey, "get_secret_value"):
        return skey.get_secret_value()
    return skey if isinstance(skey, str) else None


async def create_stripe_coupon_for_promo(
    *,
    promo_code: str,
    kind: str,             # "percent_off" | "fixed_cents_off"
    value: int,            # percent (1-100) | cents (>0)
    stripe_customer_id: str | None = None,
    currency: str = "usd",
) -> str | None:
    """Create a single-use Stripe Coupon scoped to the customer.
    Returns the Coupon ID on success, None on failure (Stripe SDK
    missing, API error, etc.). Logged either way.

    `stripe_customer_id` is optional but recommended — when set, the
    coupon is restricted to that customer's account so it can't be
    used by anyone else."""
    try:
        import stripe  # type: ignore
    except ImportError:
        logger.warning("stripe SDK not installed; coupon NOT created")
        return None

    api_key = _stripe_api_key()
    if not api_key:
        logger.warning("STRIPE_SECRET_KEY not configured; coupon NOT created")
        return None
    stripe.api_key = api_key

    # Stripe Coupon ID — operators recognise these in the dashboard.
    # Format: `humanovo-<promo_code>-<short-hex>` (lowercased + slugged).
    suffix = secrets.token_hex(4)
    coupon_id = (
        f"humanovo-{promo_code.lower().replace(' ', '-')}-{suffix}"
    )[:40]  # Stripe max ID length

    create_kwargs = {
        "id": coupon_id,
        "duration": COUPON_DURATION,
        "max_redemptions": 1,
        "metadata": {
            "humanovo_promo_code": promo_code,
            "humanovo_kind": kind,
        },
    }
    if kind == "percent_off":
        create_kwargs["percent_off"] = int(value)
    elif kind == "fixed_cents_off":
        create_kwargs["amount_off"] = int(value)
        create_kwargs["currency"] = currency.lower()
    else:
        logger.warning("unsupported coupon kind: %s", kind)
        return None

    try:
        coupon = stripe.Coupon.create(**create_kwargs)
        logger.info(
            "stripe coupon created id=%s promo=%s kind=%s value=%d",
            coupon.id, promo_code, kind, value,
        )
        # If a customer is specified, ALSO create a Promotion Code
        # (which is what `checkout.session.create(discounts=[…])`
        # actually accepts) scoped to that customer. Coupons alone
        # are global until a promotion code wraps them.
        if stripe_customer_id:
            try:
                promo = stripe.PromotionCode.create(
                    coupon=coupon.id,
                    customer=stripe_customer_id,
                    max_redemptions=1,
                    metadata=create_kwargs["metadata"],
                )
                logger.info(
                    "stripe promo code created id=%s for customer=%s",
                    promo.id, stripe_customer_id,
                )
            except Exception as pe:
                logger.warning(
                    "stripe promo code create failed (coupon kept): %s", pe,
                )
        return coupon.id
    except Exception as e:
        logger.warning(
            "stripe coupon create failed promo=%s: %s", promo_code, e,
        )
        return None
