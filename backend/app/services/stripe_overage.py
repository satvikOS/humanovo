"""Usage-overage charging via Stripe Meter Events.

When a user's cumulative monthly cost exceeds their tier's cap, the
budget enforcer raises BudgetExceeded to abort the in-flight run.
But for users who've explicitly opted into overage billing
(`users.overage_enabled = TRUE`), we instead:

  1. Let the run complete (no abort).
  2. Bill the marginal cost to Stripe via the Meter API.
  3. Stripe accumulates the meter readings and rolls them into the
     next monthly invoice as a usage-based line item.

Why Meter Events vs. immediate-charge?
  • Meter aggregates a month of overage into one invoice line —
    fewer per-event fees vs. one Charge per discovery run.
  • Idempotency: each meter event carries an `identifier` field;
    duplicate identifiers are deduped by Stripe automatically.
  • Native to Stripe's usage-based-billing flow; the Subscription
    item is configured once with `usage_type=metered`, and meter
    events drive the price-per-unit calculation.

Pricing: $1.20 per discovery run beyond the tier cap. The Stripe
Meter is configured (out of band) to charge that price per
`humanovo_overage_run` unit. This module just records the event —
the Stripe-side aggregation + invoicing handles the rest.

Pre-flight: a user must have:
  • `users.overage_enabled = TRUE` (default FALSE — opt-in)
  • `users.stripe_subscription_id` populated (paying subscription)
Without both, overage is disabled and the budget enforcer's hard
abort fires as before.
"""
from __future__ import annotations

import logging
import time
from typing import Any

from app.core.config import settings


logger = logging.getLogger(__name__)


# Stripe Meter event_name (configured out-of-band in Stripe Dashboard
# → Billing → Meters). Matches the price tier's metered subscription
# item. Renaming this requires a coordinated config change in Stripe.
METER_EVENT_NAME = "humanovo_overage_run"
# Per-run overage price in cents — surfaced here for the
# pre-flight cost preview UI; the Stripe Meter is the authoritative
# price source at billing time.
OVERAGE_PRICE_PER_RUN_CENTS = 120


async def is_overage_eligible(user) -> bool:
    """Return True iff the user has opted into overage billing AND
    has an active Stripe subscription. Either condition false →
    overage is disabled and the budget cap is a hard wall."""
    overage_enabled = bool(getattr(user, "overage_enabled", False))
    stripe_sub = getattr(user, "stripe_subscription_id", None)
    return overage_enabled and bool(stripe_sub)


async def record_overage_event(
    *,
    user_id: str,
    stripe_customer_id: str,
    discovery_run_id: str,
    cost_cents: int,
) -> bool:
    """Send a Meter Event to Stripe for one over-cap run.

    Idempotent on (user_id, discovery_run_id): the `identifier` field
    is the discovery_run_id, so re-sending the same run produces no
    duplicate billing. Returns True on successful submit, False if
    Stripe SDK is unavailable / not configured.

    The cost_cents reflects the run's actual LLM spend, but the
    charged amount is determined by the Stripe Meter's price (one
    unit per call → one OVERAGE_PRICE_PER_RUN_CENTS charge per
    accumulated meter event in the billing period). cost_cents is
    passed in `payload` for forensic visibility on the Stripe
    dashboard, NOT to control the billed amount."""
    try:
        import stripe  # type: ignore
    except ImportError:
        logger.warning("overage: stripe SDK not installed")
        return False

    api_key = settings.stripe_secret_key_value if hasattr(settings, "stripe_secret_key_value") else None
    if not api_key:
        # Try the SecretStr field directly.
        skey = getattr(settings, "STRIPE_SECRET_KEY", None)
        api_key = skey.get_secret_value() if skey else None
    if not api_key:
        logger.warning("overage: STRIPE_SECRET_KEY not configured")
        return False

    stripe.api_key = api_key

    # Stripe Meter Events API:
    # https://docs.stripe.com/billing/subscriptions/usage-based/recording-usage
    # The `payload.value` field is the count of units; we send 1 per
    # discovery run. The Meter aggregates these per-customer per-period.
    try:
        # `identifier` makes the event idempotent — Stripe rejects
        # duplicates with the same identifier silently. discovery_run_id
        # is already a UUID per run; perfect for this.
        stripe.billing.MeterEvent.create(
            event_name=METER_EVENT_NAME,
            payload={
                "value": "1",
                "stripe_customer_id": stripe_customer_id,
                "humanovo_user_id": user_id,
                "humanovo_discovery_run_id": discovery_run_id,
                "humanovo_actual_cost_cents": str(cost_cents),
            },
            timestamp=int(time.time()),
            identifier=f"run-{discovery_run_id}",
        )
        logger.info(
            "overage_recorded user_id=%s run_id=%s cost_cents=%d",
            user_id, discovery_run_id, cost_cents,
        )
        return True
    except Exception as e:
        # Common transient: Stripe rate-limit, network, missing
        # subscription item. Log + return False; caller can retry
        # via the daily reconciliation script.
        logger.warning(
            "overage record failed user_id=%s run_id=%s: %s",
            user_id, discovery_run_id, e,
        )
        return False
