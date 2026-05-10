"""Password reset + email verification endpoints.

Four routes added to /api/v1/auth/:

  • POST /forgot-password   { email }                 → 200 always
                                                         (anti-enum)
  • POST /reset-password    { token, new_password }   → 200 / 400 / 410
  • POST /send-verification (auth)                    → 200 / 409
  • GET  /verify-email      ?token=...                → 200 / 410

Token discipline:
  • 32-byte URL-safe random; SHA-256 hashed at rest in user_tokens.
    The raw value never lands in the DB — only the hash. A leaked
    DB doesn't compromise live tokens.
  • Single-use: the moment a token is consumed, used_at is stamped
    and a re-use attempt returns 410.
  • Expiry: 1h for password_reset, 24h for email_verification.
  • One live token per (user, kind): issuing a new one
    invalidates any existing live token (single-active-token).

Anti-enumeration: /forgot-password ALWAYS returns 200 with a
generic "if an account exists you'll receive an email" message,
even when the email isn't registered. This prevents an attacker
from probing the user list by email.
"""
from __future__ import annotations

import hashlib
import logging
import secrets
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user
from app.core.database import get_db
from app.core.rate_limit import rate_limit
from app.models.user import User
from app.services.email_service import send_email


logger = logging.getLogger(__name__)
router = APIRouter()


PASSWORD_RESET_TTL = timedelta(hours=1)
EMAIL_VERIFY_TTL = timedelta(hours=24)
TOKEN_BYTES = 32

# How the password-reset / email-verify links land in the user's
# inbox. Operator overrides the host via settings; the path is
# hard-coded against the frontend's React Router.
PASSWORD_RESET_PATH = "/reset-password"
EMAIL_VERIFY_PATH = "/verify-email"


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _frontend_base() -> str:
    from app.core.config import settings
    return getattr(settings, "FRONTEND_BASE_URL", "https://app.humanovo.net").rstrip("/")


async def _invalidate_existing_live_tokens(
    db: AsyncSession, user_id, kind: str
) -> None:
    """Mark any non-expired, unused tokens of this kind as used so
    the user has at most ONE live token at a time per kind."""
    await db.execute(
        text(
            """
            UPDATE user_tokens
            SET used_at = now()
            WHERE user_id = :uid
              AND kind = :kind
              AND used_at IS NULL
              AND expires_at > now()
            """
        ),
        {"uid": str(user_id), "kind": kind},
    )


async def _issue_token(
    db: AsyncSession, user_id, kind: str, ttl: timedelta
) -> str:
    """Issue a fresh single-use token. Returns the RAW token (caller
    sends via email); the DB stores only the hash."""
    raw = secrets.token_urlsafe(TOKEN_BYTES)
    h = _hash_token(raw)
    expires = datetime.now(UTC) + ttl

    await _invalidate_existing_live_tokens(db, user_id, kind)
    await db.execute(
        text(
            """
            INSERT INTO user_tokens (user_id, token_hash, kind, expires_at)
            VALUES (:uid, :h, :kind, :expires)
            """
        ),
        {"uid": str(user_id), "h": h, "kind": kind, "expires": expires},
    )
    return raw


async def _consume_token(
    db: AsyncSession, raw_token: str, kind: str
):
    """Look up + atomically mark used. Returns the user_id on
    success, raises HTTPException on every failure mode."""
    h = _hash_token(raw_token)
    row = (await db.execute(
        text(
            """
            UPDATE user_tokens
            SET used_at = now()
            WHERE token_hash = :h
              AND kind = :kind
              AND used_at IS NULL
              AND expires_at > now()
            RETURNING user_id
            """
        ),
        {"h": h, "kind": kind},
    )).first()
    if row is None:
        # Could be: bad token, wrong kind, already used, or expired.
        # Don't leak which — same 410 for all.
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="Token is invalid, expired, or already used.",
        )
    return row[0]


# ─── Password reset ────────────────────────────────────────────


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str = Field(min_length=8, max_length=512)
    new_password: str = Field(min_length=8, max_length=256)


@router.post(
    "/forgot-password",
    dependencies=[Depends(rate_limit("auth"))],
)
async def forgot_password(
    body: ForgotPasswordRequest,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Issue a password-reset email. Always returns 200 with a
    generic message — anti-enumeration."""
    # Look up by email. Don't surface the result to the caller.
    user_row = (await db.execute(
        text("SELECT id, email FROM users WHERE email = :email"),
        {"email": body.email.lower()},
    )).first()

    if user_row is not None:
        user_id, _email = user_row
        try:
            raw = await _issue_token(db, user_id, "password_reset", PASSWORD_RESET_TTL)
            await db.commit()
            link = f"{_frontend_base()}{PASSWORD_RESET_PATH}?token={raw}"
            await send_email(
                to=body.email,
                subject="Reset your humanovo password",
                text=(
                    "We received a request to reset your humanovo password. "
                    f"Click the link below to set a new one (expires in 1 hour):\n\n"
                    f"{link}\n\n"
                    "If you didn't request this, you can ignore this email — "
                    "your password won't change."
                ),
                html=(
                    "<p>We received a request to reset your humanovo password.</p>"
                    f'<p><a href="{link}">Reset your password</a> '
                    "(link expires in 1 hour).</p>"
                    "<p>If you didn't request this, you can ignore this email — "
                    "your password won't change.</p>"
                ),
            )
        except Exception as e:
            # Token issue / email send failed — still return the
            # generic 200 to keep the anti-enumeration guarantee.
            logger.warning("forgot_password issue failed: %s", e)

    return {
        "status": "sent",
        "message": (
            "If an account exists for this email, a password-reset link "
            "has been sent. Check your inbox (and spam folder)."
        ),
    }


@router.post(
    "/reset-password",
    dependencies=[Depends(rate_limit("auth"))],
)
async def reset_password(
    body: ResetPasswordRequest,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Consume a password-reset token + set the new password. Single-
    use: the token is dead the moment this returns 200 (or 410)."""
    user_id = await _consume_token(db, body.token, "password_reset")

    # Update the user's password hash. The auth service has a
    # password-hashing helper — use that to keep the algorithm in
    # sync (currently Argon2 via passlib).
    from app.core.auth import hash_password

    new_hash = hash_password(body.new_password)
    await db.execute(
        text("UPDATE users SET password_hash = :h WHERE id = :uid"),
        {"h": new_hash, "uid": str(user_id)},
    )
    await db.commit()
    return {"status": "ok", "message": "Password reset successful. You can now log in."}


# ─── Email verification ────────────────────────────────────────


@router.post(
    "/send-verification",
    dependencies=[Depends(rate_limit("auth"))],
)
async def send_email_verification(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """Issue an email-verification link to the authenticated user's
    current email. 409 if the email is already verified — no point
    re-sending."""
    if current_user.is_verified and current_user.email_verified_at is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email is already verified.",
        )

    raw = await _issue_token(db, current_user.id, "email_verification", EMAIL_VERIFY_TTL)
    await db.commit()
    link = f"{_frontend_base()}{EMAIL_VERIFY_PATH}?token={raw}"
    await send_email(
        to=current_user.email,
        subject="Verify your humanovo email",
        text=(
            "Welcome to humanovo. Click the link below to verify your "
            f"email address (expires in 24 hours):\n\n{link}\n"
        ),
        html=(
            "<p>Welcome to humanovo.</p>"
            f'<p><a href="{link}">Verify your email</a> '
            "(link expires in 24 hours).</p>"
        ),
    )
    return {"status": "sent", "message": "Check your inbox for a verification link."}


@router.get(
    "/verify-email",
    dependencies=[Depends(rate_limit("auth"))],
)
async def verify_email(
    token: str = Query(..., min_length=8, max_length=512),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Consume an email-verification token + flip is_verified =
    TRUE on the matching user."""
    user_id = await _consume_token(db, token, "email_verification")
    await db.execute(
        text(
            """
            UPDATE users
            SET is_verified = TRUE,
                email_verified_at = now()
            WHERE id = :uid
            """
        ),
        {"uid": str(user_id)},
    )
    await db.commit()
    return {"status": "ok", "message": "Email verified successfully."}
