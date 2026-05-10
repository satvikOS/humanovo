"""Unit tests for /api/v1/account — GDPR Art. 17 + Art. 20 endpoints.

Exercises the route-handler layer with mocked SQLAlchemy session +
mocked User. No real DB needed; the contract is what we lock in:
  • POST /account/delete is idempotent (2nd call → same response)
  • Already-hard-deleted account → 410 Gone
  • GET /account/export builds a valid ZIP with manifest + profile
  • Export omits audit-log entries (HIPAA retention)
"""
from __future__ import annotations

import io
import json
import zipfile
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from app.api.v1.endpoints.account import (
    export_account_data,
    request_account_deletion,
)


def _user(
    *,
    delete_requested_at=None,
    deleted_at=None,
    is_active: bool = True,
):
    """Mock-friendly User. Mimics the SimpleNamespace shape with the
    attributes the endpoint reads — id, email, full_name, role, tier,
    delete state, created_at, etc."""
    return SimpleNamespace(
        id=uuid4(),
        email="user@example.com",
        full_name="Test User",
        role=SimpleNamespace(value="researcher"),
        tier=SimpleNamespace(value="researcher"),
        is_active=is_active,
        is_verified=True,
        has_completed_onboarding=True,
        created_at=datetime(2026, 1, 1, tzinfo=UTC),
        last_login_at=datetime(2026, 5, 1, tzinfo=UTC),
        delete_requested_at=delete_requested_at,
        deleted_at=deleted_at,
    )


@pytest.mark.asyncio
async def test_delete_first_request_sets_timestamp_and_disables():
    user = _user()
    db = MagicMock()
    db.commit = AsyncMock()

    out = await request_account_deletion(db=db, current_user=user)

    assert out["status"] == "deletion_requested"
    assert user.delete_requested_at is not None
    assert user.is_active is False
    db.commit.assert_called_once()
    # 30-day grace window is the documented contract.
    assert out["grace_window_days"] == 30


@pytest.mark.asyncio
async def test_delete_second_request_is_idempotent():
    """Two delete requests within the grace window yield the same
    response shape — no double-commit, same scheduled hard-delete date."""
    requested_at = datetime.now(UTC) - timedelta(days=2)
    user = _user(delete_requested_at=requested_at, is_active=False)
    db = MagicMock()
    db.commit = AsyncMock()

    out = await request_account_deletion(db=db, current_user=user)

    # No second commit — the bits are already set.
    db.commit.assert_not_called()
    assert out["requested_at"] == requested_at.isoformat()
    # Hard-delete scheduled exactly 30 days after the original request.
    expected_grace_end = requested_at + timedelta(days=30)
    assert out["scheduled_hard_delete_at"] == expected_grace_end.isoformat()


@pytest.mark.asyncio
async def test_delete_already_hard_deleted_returns_410():
    from fastapi import HTTPException

    user = _user(deleted_at=datetime.now(UTC) - timedelta(days=1))
    db = MagicMock()

    with pytest.raises(HTTPException) as exc:
        await request_account_deletion(db=db, current_user=user)
    assert exc.value.status_code == 410


@pytest.mark.asyncio
async def test_export_builds_valid_zip_with_manifest_and_profile():
    user = _user()
    # No owned tables = clean export with just profile + manifest.
    with patch(
        "app.api.v1.endpoints.account._owned_tables_for_export",
        return_value=[],
    ):
        db = MagicMock()
        response = await export_account_data(db=db, current_user=user)

    # StreamingResponse — peel out the ZIP bytes.
    chunks = []
    async for chunk in response.body_iterator:
        chunks.append(chunk if isinstance(chunk, bytes) else chunk.encode())
    zip_bytes = b"".join(chunks)

    zf = zipfile.ZipFile(io.BytesIO(zip_bytes))
    names = set(zf.namelist())
    assert "profile.json" in names
    assert "manifest.json" in names

    profile = json.loads(zf.read("profile.json"))
    assert profile["email"] == user.email
    assert profile["id"] == str(user.id)

    manifest = json.loads(zf.read("manifest.json"))
    assert manifest["schema_version"] == 1
    assert manifest["user_id"] == str(user.id)
    assert "audit-log entries are EXCLUDED" in manifest["note"]


@pytest.mark.asyncio
async def test_export_filename_includes_user_id_and_timestamp():
    user = _user()
    with patch(
        "app.api.v1.endpoints.account._owned_tables_for_export",
        return_value=[],
    ):
        response = await export_account_data(db=MagicMock(), current_user=user)
    cd = response.headers.get("content-disposition") or response.headers.get("Content-Disposition")
    assert cd is not None
    assert str(user.id) in cd
    assert "humanovo-export-" in cd
    assert ".zip" in cd
