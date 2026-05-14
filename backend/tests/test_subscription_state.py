"""Unit tests for app/services/subscription_state.py.

Locks in the classifier contract (`_classify`) and the
record_transition flow (mocked DB).
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from app.services.subscription_state import (
    _classify,
    record_transition,
)


# ─── Classifier — pure function ─────────────────────────────────


def test_classify_upgrade():
    f = _classify("active", "active", "researcher", "lab")
    assert f["is_upgrade"] is True
    assert f["is_downgrade"] is False


def test_classify_downgrade():
    f = _classify("active", "active", "lab", "researcher")
    assert f["is_upgrade"] is False
    assert f["is_downgrade"] is True


def test_classify_lapse():
    f = _classify("active", "past_due", "lab", "lab")
    assert f["is_lapse"] is True
    assert f["is_recovery"] is False
    assert f["is_cancel"] is False


def test_classify_recovery():
    f = _classify("past_due", "active", "lab", "lab")
    assert f["is_recovery"] is True
    assert f["is_lapse"] is False


def test_classify_cancel():
    f = _classify("active", "canceled", "lab", "trial")
    assert f["is_cancel"] is True
    # Cancel is also a downgrade — both true.
    assert f["is_downgrade"] is True


def test_classify_trial_to_paid_is_upgrade_not_lapse():
    f = _classify("trialing", "active", "trial", "researcher")
    assert f["is_upgrade"] is True
    assert f["is_lapse"] is False


def test_classify_first_transition_no_from_status():
    """When from_status is None (first event for a new sub), no
    flag is set — we just know the new state."""
    f = _classify(None, "active", None, "researcher")
    assert f["is_upgrade"] is False
    assert f["is_downgrade"] is False
    assert f["is_lapse"] is False
    assert f["is_recovery"] is False
    assert f["is_cancel"] is False


# ─── record_transition — DB integration ─────────────────────────


def _db():
    db = MagicMock()
    db.execute = AsyncMock()
    return db


@pytest.mark.asyncio
async def test_no_op_transition_returns_none_and_skips_insert():
    """Stripe sometimes re-delivers the same state. record_transition
    must NOT add a row when from == to (both status AND tier)."""
    db = _db()
    out = await record_transition(
        db,
        user_id=uuid4(),
        from_status="active", to_status="active",
        from_tier="researcher", to_tier="researcher",
    )
    assert out is None
    db.execute.assert_not_called()


@pytest.mark.asyncio
async def test_transition_inserts_row_and_returns_classified():
    db = _db()
    uid = uuid4()
    out = await record_transition(
        db,
        user_id=uid,
        from_status="active", to_status="past_due",
        from_tier="lab", to_tier="lab",
        stripe_subscription_id="sub_123",
        stripe_event_id="evt_abc",
        metadata={"reason": "card_declined"},
    )
    assert out is not None
    assert out.is_lapse is True
    assert out.is_recovery is False
    db.execute.assert_called_once()

    bound = db.execute.call_args.args[1]
    assert bound["uid"] == str(uid)
    assert bound["fs"] == "active"
    assert bound["ts"] == "past_due"
    assert bound["sub_id"] == "sub_123"
    assert bound["evt"] == "evt_abc"
    assert "card_declined" in bound["meta"]


@pytest.mark.asyncio
async def test_status_changed_but_tier_unchanged_still_records():
    """active → past_due with same tier is the canonical lapse;
    must record."""
    db = _db()
    out = await record_transition(
        db,
        user_id=uuid4(),
        from_status="active", to_status="past_due",
        from_tier="researcher", to_tier="researcher",
    )
    assert out is not None
    assert out.is_lapse is True
    db.execute.assert_called_once()


@pytest.mark.asyncio
async def test_tier_changed_but_status_unchanged_still_records():
    """User mid-cycle upgrades from researcher → lab; status stays
    active. Must record (it's a real transition we want in history)."""
    db = _db()
    out = await record_transition(
        db,
        user_id=uuid4(),
        from_status="active", to_status="active",
        from_tier="researcher", to_tier="lab",
    )
    assert out is not None
    assert out.is_upgrade is True
    db.execute.assert_called_once()
