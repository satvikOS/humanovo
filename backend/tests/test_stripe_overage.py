"""Unit tests for the usage-overage charging path.

`stripe_overage.record_overage_event()` is the only side-effecting
function — covers:
  • Eligibility gate respects overage_enabled + stripe_subscription_id
  • Idempotency: the discovery_run_id flows into Stripe's
    `identifier` field for at-least-once safe replay
  • Stripe SDK / config missing → returns False without raising
  • Network / Stripe error → returns False, logs warning, doesn't
    bubble (callers run inside the discovery pipeline; a failed
    overage record shouldn't kill the run)
"""
from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from app.services.stripe_overage import (
    METER_EVENT_NAME,
    OVERAGE_PRICE_PER_RUN_CENTS,
    is_overage_eligible,
    record_overage_event,
)


@pytest.mark.asyncio
async def test_eligibility_requires_both_flag_and_subscription():
    # Both true → eligible.
    user = SimpleNamespace(overage_enabled=True, stripe_subscription_id="sub_123")
    assert await is_overage_eligible(user) is True

    # Flag off → not eligible.
    user = SimpleNamespace(overage_enabled=False, stripe_subscription_id="sub_123")
    assert await is_overage_eligible(user) is False

    # Subscription missing → not eligible (free-tier user can't have
    # overage even if they checked the box somehow).
    user = SimpleNamespace(overage_enabled=True, stripe_subscription_id=None)
    assert await is_overage_eligible(user) is False

    # Neither → not eligible.
    user = SimpleNamespace(overage_enabled=False, stripe_subscription_id=None)
    assert await is_overage_eligible(user) is False


def test_overage_price_constant_is_documented():
    """The price-per-run constant is referenced by the cost-estimator
    UI and must stay aligned with the Stripe Meter price configured
    in the dashboard. Lock the public name down."""
    assert OVERAGE_PRICE_PER_RUN_CENTS == 120
    assert METER_EVENT_NAME == "humanovo_overage_run"


@pytest.mark.asyncio
async def test_record_overage_event_uses_run_id_as_idempotency_key():
    """Stripe's MeterEvent.create dedupes on `identifier`. The
    discovery_run_id MUST flow into that field so a same-run replay
    doesn't double-bill."""
    fake_stripe = MagicMock()
    fake_stripe.billing.MeterEvent.create = MagicMock()

    with patch.dict("sys.modules", {"stripe": fake_stripe}), \
         patch("app.services.stripe_overage.settings") as mock_settings:
        # Settings: secret key set so we don't bail early.
        mock_settings.stripe_secret_key_value = "sk_test_xxx"

        ok = await record_overage_event(
            user_id="user-123",
            stripe_customer_id="cus_abc",
            discovery_run_id="run-uuid-456",
            cost_cents=350,
        )

    assert ok is True
    fake_stripe.billing.MeterEvent.create.assert_called_once()
    call_kwargs = fake_stripe.billing.MeterEvent.create.call_args.kwargs
    assert call_kwargs["event_name"] == METER_EVENT_NAME
    assert call_kwargs["identifier"] == "run-run-uuid-456"
    assert call_kwargs["payload"]["humanovo_user_id"] == "user-123"
    assert call_kwargs["payload"]["humanovo_discovery_run_id"] == "run-uuid-456"
    assert call_kwargs["payload"]["humanovo_actual_cost_cents"] == "350"


@pytest.mark.asyncio
async def test_record_overage_returns_false_when_stripe_unconfigured():
    fake_stripe = MagicMock()

    with patch.dict("sys.modules", {"stripe": fake_stripe}), \
         patch("app.services.stripe_overage.settings") as mock_settings:
        mock_settings.stripe_secret_key_value = None
        mock_settings.STRIPE_SECRET_KEY = None
        ok = await record_overage_event(
            user_id="u", stripe_customer_id="c",
            discovery_run_id="r", cost_cents=100,
        )

    assert ok is False
    fake_stripe.billing.MeterEvent.create.assert_not_called()


@pytest.mark.asyncio
async def test_record_overage_swallows_stripe_errors():
    """A Stripe outage must NOT propagate into the caller — the
    discovery pipeline is mid-run; we'd rather record the overage
    on the next reconciliation pass than crash the run."""
    fake_stripe = MagicMock()
    fake_stripe.billing.MeterEvent.create = MagicMock(
        side_effect=RuntimeError("stripe rate-limit"),
    )

    with patch.dict("sys.modules", {"stripe": fake_stripe}), \
         patch("app.services.stripe_overage.settings") as mock_settings:
        mock_settings.stripe_secret_key_value = "sk_test_xxx"
        ok = await record_overage_event(
            user_id="u", stripe_customer_id="c",
            discovery_run_id="r", cost_cents=100,
        )

    assert ok is False  # surface the failure, but don't raise
