"""Unit tests for the password-reset / email-verify token discipline.

Covers `_hash_token`, `_issue_token`, `_consume_token` from
`auth_recovery.py`. DB session is mocked — we test the contract,
not the SQL layer.

Locks in:
  • Token hashes are SHA-256 hex (64 chars), deterministic
  • Issuing a token invalidates pre-existing live tokens of the
    same kind for the same user
  • Consume returns the user_id on first use
  • Re-consume of the same token raises 410
"""
from __future__ import annotations

import hashlib
import secrets
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from app.api.v1.endpoints.auth_recovery import (
    PASSWORD_RESET_TTL,
    TOKEN_BYTES,
    _consume_token,
    _hash_token,
    _issue_token,
)


def test_hash_is_sha256_hex_64_chars():
    h = _hash_token("anything")
    assert len(h) == 64
    assert all(c in "0123456789abcdef" for c in h)
    # Deterministic.
    assert _hash_token("anything") == h
    # Different input → different hash.
    assert _hash_token("other") != h
    # Matches a vanilla sha256 — proves we're not adding a custom
    # secret pepper that would break recoverability across deploys.
    assert h == hashlib.sha256(b"anything").hexdigest()


@pytest.mark.asyncio
async def test_issue_token_returns_url_safe_value():
    db = MagicMock()
    db.execute = AsyncMock()
    user_id = uuid4()
    raw = await _issue_token(db, user_id, "password_reset", PASSWORD_RESET_TTL)
    # secrets.token_urlsafe outputs base64url; the encoded length is
    # ceil(TOKEN_BYTES * 4 / 3) before padding strip.
    expected_min = TOKEN_BYTES  # always at least N chars
    assert len(raw) >= expected_min
    # No characters that would break URL embedding.
    assert all(c.isalnum() or c in "-_" for c in raw)


@pytest.mark.asyncio
async def test_issue_token_invalidates_existing_live_tokens():
    """Single-active-token invariant: issuing a new password-reset
    must mark all existing live ones used."""
    db = MagicMock()
    db.execute = AsyncMock()
    user_id = uuid4()
    await _issue_token(db, user_id, "password_reset", PASSWORD_RESET_TTL)

    # First execute is the UPDATE invalidating live tokens; second is
    # the INSERT for the new one.
    assert db.execute.call_count == 2
    first_sql = str(db.execute.call_args_list[0].args[0])
    assert "UPDATE user_tokens" in first_sql
    assert "used_at = now()" in first_sql


@pytest.mark.asyncio
async def test_consume_token_returns_user_id_on_first_use():
    user_id = uuid4()
    db = MagicMock()
    result = MagicMock()
    result.first = MagicMock(return_value=(user_id,))
    db.execute = AsyncMock(return_value=result)

    out = await _consume_token(db, "raw-token-xyz", "password_reset")
    assert out == user_id

    # The query must use the HASH, not the raw token, in the WHERE.
    bound_params = db.execute.call_args.args[1]
    assert bound_params["h"] == _hash_token("raw-token-xyz")
    assert bound_params["kind"] == "password_reset"


@pytest.mark.asyncio
async def test_consume_token_410_when_not_found():
    """Bad token, wrong kind, already used, or expired — all map to
    the same 410 with a generic message (don't leak which it is)."""
    from fastapi import HTTPException

    db = MagicMock()
    result = MagicMock()
    result.first = MagicMock(return_value=None)
    db.execute = AsyncMock(return_value=result)

    with pytest.raises(HTTPException) as exc:
        await _consume_token(db, "bad-or-used-token", "password_reset")
    assert exc.value.status_code == 410
