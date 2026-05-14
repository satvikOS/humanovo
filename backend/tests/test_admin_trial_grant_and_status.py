"""Unit tests for the admin trial-grant + status endpoints.

Mocked DB; locks in:
  • grant_trial idempotent extension (never shortens an existing
    longer trial)
  • grant_trial respects days bounds (1–90)
  • grant_trial 410 on hard-deleted target
  • get_user_status returns the lifecycle snapshot shape the admin
    dashboard depends on, gracefully degrading optional fields when
    sub-queries fail
"""
from __future__ import annotations

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints.admin_users import (
    get_user_status,
    grant_trial,
)


def _user(*, trial_ends_at=None, deleted_at=None):
    return SimpleNamespace(
        id=uuid4(),
        email="t@example.com",
        full_name="Target User",
        role=SimpleNamespace(value="researcher"),
        tier=SimpleNamespace(value="researcher"),
        is_active=True,
        is_verified=True,
        telemetry_opt_in=False,
        overage_enabled=False,
        trial_ends_at=trial_ends_at,
        delete_requested_at=None,
        deleted_at=deleted_at,
        stripe_customer_id=None,
        stripe_subscription_id=None,
        stripe_subscription_status=None,
        created_at=datetime(2026, 1, 1, tzinfo=UTC),
        last_login_at=None,
    )


def _db_with_target(target):
    db = MagicMock()
    db.commit = AsyncMock()
    result = MagicMock()
    result.scalar_one_or_none = MagicMock(return_value=target)
    db.execute = AsyncMock(return_value=result)
    return db


@pytest.mark.asyncio
async def test_grant_trial_sets_trial_ends_at_for_user_without_trial():
    target = _user(trial_ends_at=None)
    actor = _user()
    db = _db_with_target(target)
    with patch("app.api.v1.endpoints.admin_users._audit", new=AsyncMock()):
        out = await grant_trial(user_id=target.id, days=14, db=db, actor=actor)
    assert out["status"] == "granted"
    assert target.trial_ends_at is not None
    # Within tolerance of "now + 14 days".
    expected = datetime.now(UTC) + timedelta(days=14)
    assert abs((target.trial_ends_at - expected).total_seconds()) < 5


@pytest.mark.asyncio
async def test_grant_trial_extends_when_proposed_is_later():
    """Existing trial ends in 3 days. grant 14 → new end is 14d out."""
    target = _user(trial_ends_at=datetime.now(UTC) + timedelta(days=3))
    actor = _user()
    db = _db_with_target(target)
    with patch("app.api.v1.endpoints.admin_users._audit", new=AsyncMock()):
        out = await grant_trial(user_id=target.id, days=14, db=db, actor=actor)
    assert out["status"] == "granted"
    expected = datetime.now(UTC) + timedelta(days=14)
    assert abs((target.trial_ends_at - expected).total_seconds()) < 5


@pytest.mark.asyncio
async def test_grant_trial_no_change_when_existing_is_later():
    """Existing trial ends in 21 days; grant 14 → no change."""
    far_future = datetime.now(UTC) + timedelta(days=21)
    target = _user(trial_ends_at=far_future)
    actor = _user()
    db = _db_with_target(target)
    with patch("app.api.v1.endpoints.admin_users._audit", new=AsyncMock()):
        out = await grant_trial(user_id=target.id, days=14, db=db, actor=actor)
    assert out["status"] == "no_change_existing_is_later"
    assert target.trial_ends_at == far_future


@pytest.mark.asyncio
async def test_grant_trial_rejects_invalid_days():
    target = _user()
    actor = _user()
    db = _db_with_target(target)
    for bad in (0, -1, 91, 365):
        with pytest.raises(HTTPException) as exc:
            await grant_trial(user_id=target.id, days=bad, db=db, actor=actor)
        assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_grant_trial_410_for_hard_deleted_user():
    target = _user(deleted_at=datetime.now(UTC) - timedelta(days=1))
    actor = _user()
    db = _db_with_target(target)
    with pytest.raises(HTTPException) as exc:
        await grant_trial(user_id=target.id, days=14, db=db, actor=actor)
    assert exc.value.status_code == 410


# ─── get_user_status ───────────────────────────────────────────


def _db_for_status(target, *, latest_transition=None, crash_count=0, api_key_count=0):
    """Status endpoint runs multiple queries (target lookup, crash
    count, api-key count). Mock each in order."""
    db = MagicMock()

    # The first execute call (in _get_target_user) returns target.
    target_result = MagicMock()
    target_result.scalar_one_or_none = MagicMock(return_value=target)

    # Crash count + api-key count return tuples.
    crash_result = MagicMock()
    crash_result.first = MagicMock(return_value=(crash_count,))

    key_result = MagicMock()
    key_result.first = MagicMock(return_value=(api_key_count,))

    db.execute = AsyncMock(side_effect=[target_result, crash_result, key_result])
    return db


@pytest.mark.asyncio
async def test_status_returns_full_lifecycle_snapshot():
    target = _user(trial_ends_at=datetime.now(UTC) + timedelta(days=10))
    actor = _user()
    db = _db_for_status(target, crash_count=2, api_key_count=3)

    with patch(
        "app.services.subscription_state.latest_transition_for_user",
        new=AsyncMock(return_value={"to_status": "active", "to_tier": "lab"}),
    ):
        out = await get_user_status(user_id=target.id, db=db, actor=actor)

    assert out["user_id"] == str(target.id)
    assert out["email"] == target.email
    assert out["tier"] == "researcher"
    assert out["trial_ends_at"] is not None
    assert out["latest_subscription_transition"]["to_status"] == "active"
    assert out["crash_reports_last_7d"] == 2
    assert out["active_api_keys"] == 3


@pytest.mark.asyncio
async def test_status_degrades_gracefully_when_optional_queries_fail():
    """A missing crash_reports table or transient DB error on the
    optional sub-queries shouldn't 500 the status endpoint — fall
    through to 0 / null."""
    target = _user()
    actor = _user()

    # Override crash + api-key queries to raise.
    db = MagicMock()
    target_result = MagicMock()
    target_result.scalar_one_or_none = MagicMock(return_value=target)
    db.execute = AsyncMock(side_effect=[
        target_result,
        RuntimeError("crash_reports table missing"),
        RuntimeError("user_api_keys table missing"),
    ])

    with patch(
        "app.services.subscription_state.latest_transition_for_user",
        new=AsyncMock(side_effect=RuntimeError("subscription_transitions missing")),
    ):
        out = await get_user_status(user_id=target.id, db=db, actor=actor)

    assert out["user_id"] == str(target.id)
    assert out["latest_subscription_transition"] is None
    assert out["crash_reports_last_7d"] == 0
    assert out["active_api_keys"] == 0
