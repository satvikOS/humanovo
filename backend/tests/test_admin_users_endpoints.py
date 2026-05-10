"""Unit tests for /admin/users/{id}/disable | /restore | /restore-deletion.

Pure unit tests — DB session and audit service mocked; no live PG.
Locks in:
  • disable() flips is_active False, audits, idempotent on already-disabled
  • disable() refuses to disable the actor (foot-gun guard)
  • restore() flips is_active True, idempotent on already-active
  • restore() of a soft-deleted user → 409 (use restore-deletion)
  • restore() of a hard-deleted user → 410
  • restore-deletion() clears delete_requested_at + flips is_active
  • restore-deletion() of a hard-deleted user → 410
  • restore-deletion() with no pending delete → 400
"""
from __future__ import annotations

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from app.api.v1.endpoints.admin_users import (
    disable_user,
    restore_account_deletion,
    restore_user,
)


def _user(
    *,
    is_active: bool = True,
    delete_requested_at=None,
    deleted_at=None,
):
    u = SimpleNamespace(
        id=uuid4(),
        email="target@example.com",
        is_active=is_active,
        delete_requested_at=delete_requested_at,
        deleted_at=deleted_at,
    )
    return u


def _db_with_target(target):
    db = MagicMock()
    db.commit = AsyncMock()
    result = MagicMock()
    result.scalar_one_or_none = MagicMock(return_value=target)
    db.execute = AsyncMock(return_value=result)
    return db


@pytest.mark.asyncio
async def test_disable_flips_is_active_and_audits():
    target = _user(is_active=True)
    actor = _user(is_active=True)
    db = _db_with_target(target)
    with patch("app.api.v1.endpoints.admin_users._audit", new=AsyncMock()):
        out = await disable_user(user_id=target.id, db=db, actor=actor)
    assert out["status"] == "disabled"
    assert target.is_active is False
    db.commit.assert_called_once()


@pytest.mark.asyncio
async def test_disable_idempotent_when_already_disabled():
    target = _user(is_active=False)
    actor = _user()
    db = _db_with_target(target)
    out = await disable_user(user_id=target.id, db=db, actor=actor)
    assert out["status"] == "already_disabled"
    db.commit.assert_not_called()


@pytest.mark.asyncio
async def test_disable_refuses_self_target():
    """Foot-gun guard: an admin can't disable their own account
    through this endpoint (would lock them out, requiring DB
    intervention to recover)."""
    from fastapi import HTTPException
    actor = _user()
    db = _db_with_target(actor)  # target == actor
    with pytest.raises(HTTPException) as exc:
        await disable_user(user_id=actor.id, db=db, actor=actor)
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_restore_flips_is_active_back_true():
    target = _user(is_active=False)
    actor = _user()
    db = _db_with_target(target)
    with patch("app.api.v1.endpoints.admin_users._audit", new=AsyncMock()):
        out = await restore_user(user_id=target.id, db=db, actor=actor)
    assert out["status"] == "restored"
    assert target.is_active is True


@pytest.mark.asyncio
async def test_restore_409_when_user_has_pending_deletion():
    from fastapi import HTTPException
    target = _user(
        is_active=False,
        delete_requested_at=datetime.now(UTC) - timedelta(days=2),
    )
    actor = _user()
    db = _db_with_target(target)
    with pytest.raises(HTTPException) as exc:
        await restore_user(user_id=target.id, db=db, actor=actor)
    assert exc.value.status_code == 409


@pytest.mark.asyncio
async def test_restore_410_when_user_hard_deleted():
    from fastapi import HTTPException
    target = _user(
        is_active=False,
        deleted_at=datetime.now(UTC) - timedelta(days=1),
    )
    actor = _user()
    db = _db_with_target(target)
    with pytest.raises(HTTPException) as exc:
        await restore_user(user_id=target.id, db=db, actor=actor)
    assert exc.value.status_code == 410


@pytest.mark.asyncio
async def test_restore_deletion_clears_request_and_reactivates():
    target = _user(
        is_active=False,
        delete_requested_at=datetime.now(UTC) - timedelta(days=10),
    )
    actor = _user()
    db = _db_with_target(target)
    with patch("app.api.v1.endpoints.admin_users._audit", new=AsyncMock()):
        out = await restore_account_deletion(user_id=target.id, db=db, actor=actor)
    assert out["status"] == "deletion_cancelled"
    assert target.delete_requested_at is None
    assert target.is_active is True


@pytest.mark.asyncio
async def test_restore_deletion_400_when_no_pending_deletion():
    from fastapi import HTTPException
    target = _user(is_active=True)  # nothing pending
    actor = _user()
    db = _db_with_target(target)
    with pytest.raises(HTTPException) as exc:
        await restore_account_deletion(user_id=target.id, db=db, actor=actor)
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_restore_deletion_410_when_hard_deleted():
    from fastapi import HTTPException
    target = _user(
        is_active=False,
        deleted_at=datetime.now(UTC) - timedelta(days=1),
    )
    actor = _user()
    db = _db_with_target(target)
    with pytest.raises(HTTPException) as exc:
        await restore_account_deletion(user_id=target.id, db=db, actor=actor)
    assert exc.value.status_code == 410
