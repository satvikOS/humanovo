"""Unit tests for the Stripe webhook → subscription-state-machine
integration.

Verifies:
  • apply_subscription_event captures from_status + from_tier BEFORE
    mutating the user row, then records the transition AFTER
  • The transition classification (upgrade/downgrade/lapse/recovery
    /cancel) is propagated into the response dict
  • A failed record_transition logs but doesn't break the webhook
    (Stripe already charged; we must honour the tier change)
"""
from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from app.models.user_tiers import UserTier
from app.services.stripe_service import apply_subscription_event


def _user(*, tier_value: str = "researcher", status: str = "active"):
    """Mock User row. tier is a SimpleNamespace mimicking the enum's
    .value attribute access; stripe_subscription_status is plain."""
    return SimpleNamespace(
        id=uuid4(),
        tier=SimpleNamespace(value=tier_value),
        stripe_customer_id="cus_test",
        stripe_subscription_id="sub_old",
        stripe_subscription_status=status,
    )


def _db_with_user(user):
    db = MagicMock()
    result = MagicMock()
    result.scalar_one_or_none = MagicMock(return_value=user)
    db.execute = AsyncMock(return_value=result)
    db.flush = AsyncMock()
    return db


@pytest.mark.asyncio
async def test_lapse_records_transition_with_lapse_flag():
    """active → past_due is the canonical lapse. The webhook should
    record the transition with is_lapse=True so the dunning cron
    picks it up."""
    user = _user(tier_value="lab", status="active")
    db = _db_with_user(user)
    subscription = {
        "id": "sub_test",
        "customer": "cus_test",
        "status": "past_due",
        "items": {"data": [{"price": {"id": "price_lab"}}]},
        "cancel_at_period_end": False,
        "current_period_end": 1700000000,
    }

    with patch(
        "app.services.stripe_service._resolve_tier_for_subscription",
        return_value=UserTier.LAB,
    ), patch(
        "app.services.subscription_state.record_transition",
        new=AsyncMock(return_value=SimpleNamespace(
            is_upgrade=False, is_downgrade=False, is_lapse=True,
            is_recovery=False, is_cancel=False,
        )),
    ) as mock_record:
        out = await apply_subscription_event(
            event_type="customer.subscription.updated",
            subscription=subscription,
            db=db,
        )

    mock_record.assert_called_once()
    call_kwargs = mock_record.call_args.kwargs
    assert call_kwargs["from_status"] == "active"
    assert call_kwargs["to_status"] == "past_due"
    assert call_kwargs["from_tier"] == "lab"
    assert out["transition"]["is_lapse"] is True


@pytest.mark.asyncio
async def test_upgrade_records_transition_with_upgrade_flag():
    user = _user(tier_value="researcher", status="active")
    db = _db_with_user(user)
    subscription = {
        "id": "sub_test",
        "customer": "cus_test",
        "status": "active",
        "items": {"data": [{"price": {"id": "price_lab"}}]},
    }
    with patch(
        "app.services.stripe_service._resolve_tier_for_subscription",
        return_value=UserTier.LAB,
    ), patch(
        "app.services.subscription_state.record_transition",
        new=AsyncMock(return_value=SimpleNamespace(
            is_upgrade=True, is_downgrade=False, is_lapse=False,
            is_recovery=False, is_cancel=False,
        )),
    ):
        out = await apply_subscription_event(
            event_type="customer.subscription.updated",
            subscription=subscription,
            db=db,
        )

    assert out["transition"]["is_upgrade"] is True
    assert out["new_tier"] == "lab"


@pytest.mark.asyncio
async def test_state_audit_failure_does_not_break_webhook():
    """The customer already paid (or already cancelled in Stripe).
    A state-machine audit row write failure must NOT roll back the
    tier change in the user row — we have to honour Stripe's truth."""
    user = _user(tier_value="researcher", status="active")
    db = _db_with_user(user)
    subscription = {
        "id": "sub_test",
        "customer": "cus_test",
        "status": "active",
        "items": {"data": [{"price": {"id": "price_lab"}}]},
    }

    with patch(
        "app.services.stripe_service._resolve_tier_for_subscription",
        return_value=UserTier.LAB,
    ), patch(
        "app.services.subscription_state.record_transition",
        new=AsyncMock(side_effect=RuntimeError("DB hiccup")),
    ):
        out = await apply_subscription_event(
            event_type="customer.subscription.updated",
            subscription=subscription,
            db=db,
        )

    # Webhook still returns "applied" — the user's tier was updated.
    assert out["status"] == "applied"
    assert out["new_tier"] == "lab"
    # transition is None because the audit write failed.
    assert out["transition"] is None
    # User row mutation flushed before the audit attempt.
    assert user.tier == UserTier.LAB or user.tier.value == "lab"


@pytest.mark.asyncio
async def test_deleted_event_records_cancel_transition():
    """customer.subscription.deleted → tier flips to trial, status
    sticks at "canceled" (per Stripe), transition.is_cancel=True."""
    user = _user(tier_value="lab", status="active")
    db = _db_with_user(user)
    subscription = {
        "id": "sub_test",
        "customer": "cus_test",
        "status": "canceled",
        "items": {"data": [{"price": {"id": "price_lab"}}]},
    }

    with patch(
        "app.services.subscription_state.record_transition",
        new=AsyncMock(return_value=SimpleNamespace(
            is_upgrade=False, is_downgrade=True, is_lapse=False,
            is_recovery=False, is_cancel=True,
        )),
    ) as mock_record:
        out = await apply_subscription_event(
            event_type="customer.subscription.deleted",
            subscription=subscription,
            db=db,
        )

    # Deleted → trial regardless of incoming status, so to_tier
    # should be "trial".
    call_kwargs = mock_record.call_args.kwargs
    assert call_kwargs["to_tier"] == "trial"
    assert call_kwargs["from_tier"] == "lab"
    assert out["transition"]["is_cancel"] is True
