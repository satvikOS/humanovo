"""Unit tests for app/services/api_key_service.py.

Locks in the security-critical contract:
  • Raw token only surfaced at creation
  • Hash format is SHA-256 hex (64 chars), deterministic
  • Prefix is the literal `apikey_` + first 8 chars
  • Verification rejects: bad token, revoked, expired, unknown
  • Revoke is scoped to the user (no cross-tenant revoke)
"""
from __future__ import annotations

import hashlib
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from app.services.api_key_service import (
    PREFIX,
    PREFIX_DISPLAY_LEN,
    _generate_raw_token,
    _hash_key,
    create_api_key,
    revoke_api_key,
    verify_and_get_user_with_scopes,
)


def test_hash_is_sha256_hex_64_chars():
    h = _hash_key("apikey_xxx")
    assert len(h) == 64
    assert all(c in "0123456789abcdef" for c in h)
    assert h == hashlib.sha256(b"apikey_xxx").hexdigest()


def test_generate_raw_token_starts_with_prefix_and_yields_safe_charset():
    raw, display = _generate_raw_token()
    assert raw.startswith(PREFIX)
    assert display.startswith(PREFIX)
    # Display = PREFIX + first N chars of the body (URL-safe alphabet).
    assert len(display) == len(PREFIX) + PREFIX_DISPLAY_LEN
    body = raw[len(PREFIX):]
    assert all(c.isalnum() or c in "-_" for c in body)


def test_generate_raw_token_is_unique_per_call():
    raws = {_generate_raw_token()[0] for _ in range(50)}
    assert len(raws) == 50  # all distinct


def test_hash_of_generated_token_is_stable():
    raw, _ = _generate_raw_token()
    assert _hash_key(raw) == _hash_key(raw)


@pytest.mark.asyncio
async def test_create_api_key_persists_hash_not_raw():
    user_id = uuid4()
    db = MagicMock()
    inserted_id = uuid4()
    created = datetime.now(UTC)
    result = MagicMock()
    result.first = MagicMock(return_value=(inserted_id, created))
    db.execute = AsyncMock(return_value=result)

    issued = await create_api_key(
        db, user_id=user_id, name="CI pipeline",
        scopes=["discovery:read"],
    )

    bound = db.execute.call_args.args[1]
    # Hash matches the raw, raw never lands in the bind params under
    # any other key.
    assert bound["h"] == _hash_key(issued.raw_token)
    assert issued.raw_token not in bound.values()
    assert issued.raw_token.startswith(PREFIX)
    assert issued.prefix == bound["prefix"]
    assert issued.scopes == ["discovery:read"]


@pytest.mark.asyncio
async def test_verify_rejects_token_without_prefix():
    db = MagicMock()
    db.execute = AsyncMock()  # should never be called
    out = await verify_and_get_user_with_scopes(db, raw_token="not_a_real_key")
    assert out is None
    db.execute.assert_not_called()


@pytest.mark.asyncio
async def test_verify_returns_none_when_db_finds_nothing():
    """Revoked, expired, unknown hash — all map to None (don't leak
    which it is)."""
    db = MagicMock()
    result = MagicMock()
    result.first = MagicMock(return_value=None)
    db.execute = AsyncMock(return_value=result)

    out = await verify_and_get_user_with_scopes(db, raw_token="apikey_xxx")
    assert out is None


@pytest.mark.asyncio
async def test_verify_returns_user_and_scopes_on_match():
    user_id = uuid4()
    key_id = uuid4()
    db = MagicMock()
    result = MagicMock()
    result.first = MagicMock(return_value=(key_id, user_id, ["discovery:read"]))
    db.execute = AsyncMock(return_value=result)

    out = await verify_and_get_user_with_scopes(db, raw_token="apikey_xxx")
    assert out is not None
    assert out.user_id == user_id
    assert out.key_id == key_id
    assert out.scopes == ["discovery:read"]


@pytest.mark.asyncio
async def test_verify_query_filters_expired_and_revoked():
    """The SQL must check `revoked_at IS NULL AND (expires_at IS NULL
    OR expires_at > :now)`. Lock that in so a future refactor doesn't
    accidentally drop the filter."""
    db = MagicMock()
    result = MagicMock()
    result.first = MagicMock(return_value=None)
    db.execute = AsyncMock(return_value=result)

    await verify_and_get_user_with_scopes(db, raw_token="apikey_xxx")

    sql = str(db.execute.call_args.args[0])
    assert "revoked_at IS NULL" in sql
    assert "expires_at IS NULL OR expires_at >" in sql


@pytest.mark.asyncio
async def test_revoke_scoped_to_user():
    """User A can't revoke User B's key — the WHERE clause must
    include user_id = :uid."""
    user_id = uuid4()
    key_id = uuid4()
    db = MagicMock()
    result = MagicMock()
    result.scalar_one_or_none = MagicMock(return_value=str(key_id))
    db.execute = AsyncMock(return_value=result)

    ok = await revoke_api_key(db, user_id=user_id, key_id=key_id)
    assert ok is True

    bound = db.execute.call_args.args[1]
    assert bound["uid"] == str(user_id)
    assert bound["kid"] == str(key_id)
    sql = str(db.execute.call_args.args[0])
    assert "user_id = :uid" in sql
    assert "id = :kid" in sql


@pytest.mark.asyncio
async def test_revoke_returns_false_when_no_row_updated():
    db = MagicMock()
    result = MagicMock()
    result.scalar_one_or_none = MagicMock(return_value=None)
    db.execute = AsyncMock(return_value=result)

    ok = await revoke_api_key(db, user_id=uuid4(), key_id=uuid4())
    assert ok is False
