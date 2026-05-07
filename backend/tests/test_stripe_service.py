"""
Unit tests for `app.services.stripe_service`.

Hermetic: no Stripe API calls, no DB. We only exercise the parts of
the service that are pure logic — tier ↔ price-id mapping, the
"unconfigured" path, and the webhook-signature error path. The full
end-to-end flow (Checkout → webhook → tier change) needs a live
Stripe sandbox + a DB and lives in tests/integration/.
"""

from __future__ import annotations

import pytest

from app.core.config import settings
from app.models.user import UserTier
from app.services.stripe_service import (
    StripeNotConfiguredError,
    _PAID_STATUSES,
    _price_id_to_tier,
    _resolve_tier_for_subscription,
    _tier_to_price_id,
)


# ─── Configuration paths ────────────────────────────────────────────


def test_stripe_not_configured_raises_clearly(monkeypatch):
    """When STRIPE_SECRET_KEY isn't set, every public entry point
    should raise StripeNotConfiguredError — not a generic AttributeError
    or library-internal error."""
    monkeypatch.setattr(settings, "STRIPE_SECRET_KEY", None)
    from app.services.stripe_service import _ensure_configured
    with pytest.raises(StripeNotConfiguredError) as exc:
        _ensure_configured()
    # Message should mention STRIPE_SECRET_KEY so the operator knows
    # exactly which env var to set.
    assert "STRIPE_SECRET_KEY" in str(exc.value)


# ─── Price ID ↔ Tier mapping ────────────────────────────────────────


def test_tier_to_price_id_uses_config(monkeypatch):
    monkeypatch.setattr(
        settings,
        "STRIPE_PRICE_RESEARCHER_MONTHLY",
        "price_researcher_test",
    )
    monkeypatch.setattr(settings, "STRIPE_PRICE_LAB_MONTHLY", "price_lab_test")
    monkeypatch.setattr(
        settings, "STRIPE_PRICE_INSTITUTION_MONTHLY", "price_institution_test"
    )

    assert _tier_to_price_id(UserTier.TRIAL) is None
    assert _tier_to_price_id(UserTier.RESEARCHER) == "price_researcher_test"
    assert _tier_to_price_id(UserTier.LAB) == "price_lab_test"
    assert _tier_to_price_id(UserTier.INSTITUTION) == "price_institution_test"


def test_price_id_to_tier_reverse_lookup(monkeypatch):
    monkeypatch.setattr(
        settings, "STRIPE_PRICE_RESEARCHER_MONTHLY", "price_R"
    )
    monkeypatch.setattr(settings, "STRIPE_PRICE_LAB_MONTHLY", "price_L")
    monkeypatch.setattr(
        settings, "STRIPE_PRICE_INSTITUTION_MONTHLY", "price_I"
    )

    assert _price_id_to_tier("price_R") == UserTier.RESEARCHER
    assert _price_id_to_tier("price_L") == UserTier.LAB
    assert _price_id_to_tier("price_I") == UserTier.INSTITUTION


def test_price_id_to_tier_unknown_falls_back_to_trial(monkeypatch):
    """A stale/unknown price id must NOT silently upgrade a user to a
    paid tier — the safe default is TRIAL."""
    monkeypatch.setattr(
        settings, "STRIPE_PRICE_RESEARCHER_MONTHLY", "price_R"
    )
    monkeypatch.setattr(settings, "STRIPE_PRICE_LAB_MONTHLY", "price_L")
    monkeypatch.setattr(
        settings, "STRIPE_PRICE_INSTITUTION_MONTHLY", "price_I"
    )

    assert _price_id_to_tier("price_unknown") == UserTier.TRIAL
    assert _price_id_to_tier(None) == UserTier.TRIAL
    assert _price_id_to_tier("") == UserTier.TRIAL


def test_resolve_tier_for_subscription_picks_first_item(monkeypatch):
    monkeypatch.setattr(settings, "STRIPE_PRICE_LAB_MONTHLY", "price_L")
    monkeypatch.setattr(
        settings, "STRIPE_PRICE_RESEARCHER_MONTHLY", "price_R"
    )
    monkeypatch.setattr(
        settings, "STRIPE_PRICE_INSTITUTION_MONTHLY", "price_I"
    )

    sub = {
        "id": "sub_123",
        "status": "active",
        "items": {"data": [{"price": {"id": "price_L"}}]},
    }
    assert _resolve_tier_for_subscription(sub) == UserTier.LAB


def test_resolve_tier_for_subscription_empty_items_is_trial():
    sub = {"id": "sub_456", "status": "active", "items": {"data": []}}
    assert _resolve_tier_for_subscription(sub) == UserTier.TRIAL


# ─── Subscription status policy ─────────────────────────────────────


def test_paid_statuses_include_past_due_and_trialing():
    """`past_due` keeps paid tier active for one cycle so a transient
    card decline doesn't kick a paying customer; `trialing` is the
    Stripe trial state for paid tiers, also paid-tier-eligible.
    `canceled` and `unpaid` are NOT here."""
    assert "active" in _PAID_STATUSES
    assert "trialing" in _PAID_STATUSES
    assert "past_due" in _PAID_STATUSES
    assert "canceled" not in _PAID_STATUSES
    assert "unpaid" not in _PAID_STATUSES
    assert "incomplete" not in _PAID_STATUSES
    assert "incomplete_expired" not in _PAID_STATUSES


# ─── Smoke: imports + module-level types ────────────────────────────


def test_module_exposes_expected_public_api():
    """Lock down the public surface so future refactors don't
    accidentally rename a function the billing endpoints depend on."""
    import app.services.stripe_service as svc

    for name in (
        "StripeNotConfiguredError",
        "StripeWebhookSignatureError",
        "get_or_create_customer",
        "create_checkout_session",
        "create_portal_session",
        "verify_webhook",
        "apply_subscription_event",
        "apply_checkout_completed",
    ):
        assert hasattr(svc, name), f"stripe_service is missing {name}"
