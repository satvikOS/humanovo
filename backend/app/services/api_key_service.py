"""API key generation + verification.

Token shape: `apikey_<43-char-base64url>` (Stripe-style prefix so a
key leaked into logs / errors / Slack is obvious at a glance).
The first 8 chars after the prefix are stored in plaintext as
`prefix` for UI display; the full key is SHA-256 hashed and stored
as `key_hash` UNIQUE. The raw value is shown ONCE at creation and
never recoverable.

Verification path (used by auth middleware):
  1. Caller sends `Authorization: Bearer apikey_xxx`
  2. Middleware hashes the value, looks up by key_hash
  3. Reject if not found, revoked, or expired
  4. Update last_used_at, return the owning user

Scope check is the caller's job — `verify_and_get_user_with_scopes`
returns (user, scopes), and the route decides whether the required
scope is in the granted list.
"""
from __future__ import annotations

import hashlib
import logging
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


logger = logging.getLogger(__name__)


PREFIX = "apikey_"
RAW_BYTES = 32  # → ~43 chars base64url
PREFIX_DISPLAY_LEN = 8  # how many chars of the raw key live in `prefix`


@dataclass
class IssuedKey:
    """Returned from `create_api_key` — the raw token is included
    because this is the ONLY chance to surface it; the DB only has
    the hash from here on."""
    id: UUID
    user_id: UUID
    name: str
    prefix: str
    raw_token: str          # apikey_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
    scopes: list[str]
    created_at: datetime
    expires_at: datetime | None


@dataclass
class KeyVerification:
    """Returned from `verify_and_get_user_with_scopes` on success."""
    user_id: UUID
    key_id: UUID
    scopes: list[str]


def _hash_key(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _generate_raw_token() -> tuple[str, str]:
    """Returns (raw_token, prefix_for_display)."""
    body = secrets.token_urlsafe(RAW_BYTES)
    raw = PREFIX + body
    # The displayed prefix is the literal PREFIX plus the first N
    # chars of the body — e.g. `apikey_AbC1d2Ef` — short enough to
    # render in a UI list without leaking the full secret.
    display = PREFIX + body[:PREFIX_DISPLAY_LEN]
    return raw, display


async def create_api_key(
    db: AsyncSession,
    *,
    user_id: UUID,
    name: str,
    scopes: list[str],
    expires_at: datetime | None = None,
) -> IssuedKey:
    """Mint a fresh API key for the user. Returns the IssuedKey
    including the raw token — the only time it's surfaced."""
    raw, display_prefix = _generate_raw_token()
    h = _hash_key(raw)

    row = (await db.execute(
        text(
            """
            INSERT INTO user_api_keys (user_id, name, prefix, key_hash, scopes, expires_at)
            VALUES (:uid, :name, :prefix, :h, :scopes, :expires_at)
            RETURNING id, created_at
            """
        ),
        {
            "uid": str(user_id),
            "name": name[:120],
            "prefix": display_prefix,
            "h": h,
            "scopes": scopes,
            "expires_at": expires_at,
        },
    )).first()

    return IssuedKey(
        id=row[0],
        user_id=user_id,
        name=name[:120],
        prefix=display_prefix,
        raw_token=raw,
        scopes=list(scopes),
        created_at=row[1],
        expires_at=expires_at,
    )


async def list_api_keys(db: AsyncSession, *, user_id: UUID) -> list[dict]:
    """Return non-revoked keys for the user, ordered by created_at DESC.
    Never includes the hash or raw token — only display fields."""
    rows = (await db.execute(
        text(
            """
            SELECT id, name, prefix, scopes, created_at, last_used_at, expires_at
            FROM user_api_keys
            WHERE user_id = :uid AND revoked_at IS NULL
            ORDER BY created_at DESC
            """
        ),
        {"uid": str(user_id)},
    )).all()
    return [
        {
            "id": str(r[0]),
            "name": r[1],
            "prefix": r[2],
            "scopes": list(r[3] or []),
            "created_at": r[4].isoformat() if r[4] else None,
            "last_used_at": r[5].isoformat() if r[5] else None,
            "expires_at": r[6].isoformat() if r[6] else None,
        }
        for r in rows
    ]


async def revoke_api_key(
    db: AsyncSession,
    *,
    user_id: UUID,
    key_id: UUID,
) -> bool:
    """Mark a key revoked. Returns True if a row was updated, False
    if no matching key existed (or already revoked). Scoped to the
    requesting user so user A can't revoke user B's key."""
    result = await db.execute(
        text(
            """
            UPDATE user_api_keys
            SET revoked_at = now()
            WHERE id = :kid AND user_id = :uid AND revoked_at IS NULL
            RETURNING id
            """
        ),
        {"kid": str(key_id), "uid": str(user_id)},
    )
    return result.scalar_one_or_none() is not None


async def verify_and_get_user_with_scopes(
    db: AsyncSession, *, raw_token: str,
) -> KeyVerification | None:
    """Look up by hash; reject revoked / expired. On success, update
    last_used_at and return (user_id, key_id, scopes)."""
    if not raw_token.startswith(PREFIX):
        return None
    h = _hash_key(raw_token)
    now = datetime.now(UTC)

    row = (await db.execute(
        text(
            """
            UPDATE user_api_keys
            SET last_used_at = :now
            WHERE key_hash = :h
              AND revoked_at IS NULL
              AND (expires_at IS NULL OR expires_at > :now)
            RETURNING id, user_id, scopes
            """
        ),
        {"h": h, "now": now},
    )).first()
    if row is None:
        return None
    return KeyVerification(
        user_id=row[1],
        key_id=row[0],
        scopes=list(row[2] or []),
    )
