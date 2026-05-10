"""add user_tokens table — password reset + email verification

Single table stores both flavours of one-time-use tokens via a
`kind` discriminator. Token VALUES are never stored; only the
SHA-256 hash. The raw token is delivered out-of-band (email link)
so a leaked DB doesn't trivially compromise live tokens.

Schema:
  • id           UUID PK
  • user_id      FK → users.id, ON DELETE CASCADE so user delete
                 wipes their pending tokens
  • token_hash   SHA-256 hex of the raw token (64 chars)
  • kind         'password_reset' | 'email_verification'
  • created_at   default now()
  • expires_at   1h after creation for password_reset, 24h for verify
  • used_at      NULL until consumed; once set, that row is dead
                 (prevents replay)

Index: (token_hash) UNIQUE — every token is single-use, so the
verify endpoint matches by hash.

Idempotence: CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS.

Revision ID: 027_user_tokens
Revises: 026_user_overage_opt_in
Create Date: 2026-05-10
"""
from __future__ import annotations

from alembic import op


revision = "027_user_tokens"
down_revision = "026_user_overage_opt_in"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS user_tokens (
            id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            token_hash  VARCHAR(64) NOT NULL,
            kind        VARCHAR(32) NOT NULL,
            created_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            expires_at  TIMESTAMP WITH TIME ZONE NOT NULL,
            used_at     TIMESTAMP WITH TIME ZONE NULL
        )
        """
    )
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS ix_user_tokens_token_hash "
        "ON user_tokens (token_hash)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_user_tokens_user_id_kind "
        "ON user_tokens (user_id, kind)"
    )
    # Partial index: live tokens only (not yet used + not expired).
    # Speeds up the "do you have any pending password resets?" query
    # without scanning the historical rows.
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_user_tokens_live "
        "ON user_tokens (user_id, kind, expires_at) "
        "WHERE used_at IS NULL"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_user_tokens_live")
    op.execute("DROP INDEX IF EXISTS ix_user_tokens_user_id_kind")
    op.execute("DROP INDEX IF EXISTS ix_user_tokens_token_hash")
    op.execute("DROP TABLE IF EXISTS user_tokens")
