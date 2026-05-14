"""add user_api_keys table — scoped, named, revocable

Replaces the single users.api_key_hash field with a many-to-one
table so users can mint multiple named keys with different scopes
(discovery:read, discovery:write, admin:*) and revoke individually.

Schema:
  • id           UUID PK
  • user_id      FK → users.id, ON DELETE CASCADE
  • name         Human-readable label ("CI pipeline", "Local dev")
  • prefix       First 8 chars of the raw key, stored in plaintext
                 for UI display ("apikey_AbC12...") — lets the user
                 identify keys without having to remember the secret
  • key_hash     SHA-256 of the raw key (64 hex chars). UNIQUE.
                 Raw value never persisted; shown once at creation.
  • scopes       TEXT[] — e.g. ['discovery:read', 'discovery:write']
                 Empty array = no scopes = read-only on /account.
  • created_at   default now()
  • last_used_at NULL until first use; updated by auth middleware
                 on every successful key auth
  • expires_at   NULL = never expires; otherwise denied past expiry
  • revoked_at   NULL = active; set = revoked, auth denies

Idempotence: CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS.

Revision ID: 028_user_api_keys
Revises: 027_user_tokens
Create Date: 2026-05-10
"""
from __future__ import annotations

from alembic import op


revision = "028_user_api_keys"
down_revision = "027_user_tokens"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS user_api_keys (
            id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            name          VARCHAR(120) NOT NULL,
            prefix        VARCHAR(16) NOT NULL,
            key_hash      VARCHAR(64) NOT NULL,
            scopes        TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
            created_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            last_used_at  TIMESTAMP WITH TIME ZONE NULL,
            expires_at    TIMESTAMP WITH TIME ZONE NULL,
            revoked_at    TIMESTAMP WITH TIME ZONE NULL
        )
        """
    )
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS ix_user_api_keys_key_hash "
        "ON user_api_keys (key_hash)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_user_api_keys_user_id "
        "ON user_api_keys (user_id) "
        "WHERE revoked_at IS NULL"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_user_api_keys_user_id")
    op.execute("DROP INDEX IF EXISTS ix_user_api_keys_key_hash")
    op.execute("DROP TABLE IF EXISTS user_api_keys")
