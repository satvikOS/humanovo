"""Unit tests for the auth middleware's API-key / JWT dispatch.

Covers `get_current_user` and `require_scope` from `app/core/auth.py`:
  • Bearer apikey_* → service-verification path
  • Bearer JWT → existing JWT path
  • Inactive user → None (denied) regardless of which path
  • require_scope: JWT bypass (always allowed), API-key with scope
    in list (allowed), API-key missing scope (403)
"""
from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials

from app.core.auth import get_current_user, require_scope


class _State:
    """Tiny stand-in for request.state — supports arbitrary attribute
    set/get, matches FastAPI's Starlette State behaviour."""
    pass


def _fake_request():
    req = SimpleNamespace(state=_State())
    return req


def _db_returning_user(user):
    db = MagicMock()
    result = MagicMock()
    result.scalar_one_or_none = MagicMock(return_value=user)
    db.execute = AsyncMock(return_value=result)
    return db


def _active_user(*, role="researcher"):
    return SimpleNamespace(
        id=uuid4(),
        email="user@example.com",
        is_active=True,
        role=SimpleNamespace(value=role),
    )


@pytest.mark.asyncio
async def test_apikey_path_invokes_service_and_stashes_scopes():
    user = _active_user()
    db = _db_returning_user(user)
    req = _fake_request()
    creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials="apikey_xxxxx")

    verification = SimpleNamespace(
        user_id=user.id, key_id=uuid4(),
        scopes=["discovery:read", "discovery:write"],
    )
    with patch(
        "app.services.api_key_service.verify_and_get_user_with_scopes",
        new=AsyncMock(return_value=verification),
    ):
        out = await get_current_user(request=req, credentials=creds, db=db)

    assert out is user
    assert req.state.granted_scopes == ["discovery:read", "discovery:write"]
    assert req.state.api_key_id == verification.key_id


@pytest.mark.asyncio
async def test_apikey_returns_none_when_verification_fails():
    db = MagicMock()
    db.execute = AsyncMock()  # never called
    req = _fake_request()
    creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials="apikey_bad")

    with patch(
        "app.services.api_key_service.verify_and_get_user_with_scopes",
        new=AsyncMock(return_value=None),
    ):
        out = await get_current_user(request=req, credentials=creds, db=db)

    assert out is None
    db.execute.assert_not_called()


@pytest.mark.asyncio
async def test_apikey_returns_none_for_inactive_user():
    inactive = _active_user()
    inactive.is_active = False
    db = _db_returning_user(inactive)
    req = _fake_request()
    creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials="apikey_xxx")

    verification = SimpleNamespace(user_id=inactive.id, key_id=uuid4(), scopes=[])
    with patch(
        "app.services.api_key_service.verify_and_get_user_with_scopes",
        new=AsyncMock(return_value=verification),
    ):
        out = await get_current_user(request=req, credentials=creds, db=db)

    assert out is None


@pytest.mark.asyncio
async def test_jwt_path_clears_scope_restriction():
    """JWT-authenticated requests have no scope restriction; state
    must reflect that so require_scope() returns the bypass branch."""
    user = _active_user()
    db = _db_returning_user(user)
    req = _fake_request()
    creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials="eyJalg.payload.sig")

    token_data = SimpleNamespace(user_id=user.id, email="x", role="researcher", exp=None)
    with patch("app.core.auth.decode_token", return_value=token_data):
        out = await get_current_user(request=req, credentials=creds, db=db)

    assert out is user
    assert req.state.granted_scopes is None
    assert req.state.api_key_id is None


@pytest.mark.asyncio
async def test_require_scope_allows_jwt_without_check():
    """JWT session = full powers; require_scope must NOT 403 even if
    no scope is in the state."""
    user = _active_user()
    req = _fake_request()
    req.state.granted_scopes = None  # JWT marker

    dep = require_scope("discovery:write")
    # The dependency is `async def _check(request, current_user)`.
    out = await dep(request=req, current_user=user)
    assert out is user


@pytest.mark.asyncio
async def test_require_scope_allows_api_key_with_matching_scope():
    user = _active_user()
    req = _fake_request()
    req.state.granted_scopes = ["discovery:read", "discovery:write"]

    dep = require_scope("discovery:write")
    out = await dep(request=req, current_user=user)
    assert out is user


@pytest.mark.asyncio
async def test_require_scope_403_when_api_key_missing_scope():
    user = _active_user()
    req = _fake_request()
    req.state.granted_scopes = ["discovery:read"]  # write missing

    dep = require_scope("discovery:write")
    with pytest.raises(HTTPException) as exc:
        await dep(request=req, current_user=user)
    assert exc.value.status_code == 403
    assert "discovery:write" in exc.value.detail
