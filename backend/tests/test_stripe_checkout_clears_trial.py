"""Unit test for the trial → paid conversion path.

Verifies `apply_checkout_completed` clears users.trial_ends_at on
successful checkout, so the trial-expiry cron drops the user from
its queue immediately.
"""
from __future__ import annotations

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from app.services.stripe_service import apply_checkout_completed


def _user(*, trial_ends_at=None, stripe_customer_id=None):
    return SimpleNamespace(
        id=uuid4(),
        stripe_customer_id=stripe_customer_id,
        trial_ends_at=trial_ends_at,
    )


def _db_with_user(user):
    db = MagicMock()
    result = MagicMock()
    result.scalar_one_or_none = MagicMock(return_value=user)
    db.execute = AsyncMock(return_value=result)
    db.flush = AsyncMock()
    return db


@pytest.mark.asyncio
async def test_checkout_clears_active_trial():
    """User on trial → checkout → trial_ends_at cleared, response
    indicates cleared_trial=True."""
    user = _user(trial_ends_at=datetime.now(UTC) + timedelta(days=10))
    db = _db_with_user(user)
    session = {
        "customer": "cus_test",
        "metadata": {"humanovo_user_id": str(user.id)},
    }
    out = await apply_checkout_completed(session, db)
    assert out["status"] == "applied"
    assert out["cleared_trial"] is True
    assert user.trial_ends_at is None
    assert user.stripe_customer_id == "cus_test"


@pytest.mark.asyncio
async def test_checkout_idempotent_when_no_trial():
    """User already paying (no trial) → checkout flow runs cleanly,
    cleared_trial=False, no exception."""
    user = _user(trial_ends_at=None, stripe_customer_id="cus_old")
    db = _db_with_user(user)
    session = {
        "customer": "cus_new",  # renewal / upgrade
        "metadata": {"humanovo_user_id": str(user.id)},
    }
    out = await apply_checkout_completed(session, db)
    assert out["status"] == "applied"
    assert out["cleared_trial"] is False
    assert user.trial_ends_at is None
    assert user.stripe_customer_id == "cus_new"


@pytest.mark.asyncio
async def test_checkout_skipped_when_user_id_missing():
    """No humanovo_user_id metadata → skip without crashing."""
    db = _db_with_user(None)
    session = {"customer": "cus_test", "metadata": {}}
    out = await apply_checkout_completed(session, db)
    assert out["status"] == "skipped"
    db.flush.assert_not_called()


@pytest.mark.asyncio
async def test_checkout_skipped_when_user_unknown():
    """Valid UUID but no matching user → skip + warn, no crash."""
    db = _db_with_user(None)  # query returns None
    session = {
        "customer": "cus_test",
        "metadata": {"humanovo_user_id": str(uuid4())},
    }
    out = await apply_checkout_completed(session, db)
    assert out["status"] == "skipped"
    assert out["reason"] == "unknown user"
