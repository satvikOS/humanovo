"""reconcile users schema with current ORM

Adds the columns the User ORM has accumulated since the initial 001
migration: organization, bio, permissions, email_verified_at,
last_login_at, failed_login_attempts, locked_until, api_key_hash,
api_key_created_at. Drops `api_key` + `settings` which were renamed/
removed from the model. Without this migration every signup INSERT
hits asyncpg.exceptions.UndefinedColumnError at runtime.

Broader model-vs-schema reconciliation (orphan tables, deprecated
columns on hypotheses/discovery_runs/evidence) lives in a follow-up
once each is individually audited - those tables may have semantic
intent we don't want to drop.

Idempotence: every ALTER uses `ADD COLUMN IF NOT EXISTS` /
`DROP COLUMN IF EXISTS` so a re-run after partial application is a
no-op rather than an error. Important for the recovery / reconcile
class of migrations.

Revision ID: 018_user_schema_reconcile
Revises: 017_stripe_customer_subscription
Create Date: 2026-05-07
"""
from __future__ import annotations

from alembic import op

revision = "018_user_schema_reconcile"
down_revision = "017_stripe_customer_subscription"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # New columns added to the User ORM since 001_initial_schema.
    # Each ALTER uses IF NOT EXISTS so the migration is re-runnable
    # after partial application.
    op.execute(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS organization VARCHAR(255)"
    )
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT")
    op.execute(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS permissions VARCHAR[] "
        "NOT NULL DEFAULT '{}'"
    )
    op.execute(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at "
        "TIMESTAMP WITH TIME ZONE"
    )
    op.execute(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at "
        "TIMESTAMP WITH TIME ZONE"
    )
    op.execute(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_attempts "
        "INTEGER NOT NULL DEFAULT 0"
    )
    op.execute(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until "
        "TIMESTAMP WITH TIME ZONE"
    )
    op.execute(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS api_key_hash VARCHAR(255)"
    )
    # Unique constraint and the api_key_created_at column live alongside
    # api_key_hash; both also IF NOT EXISTS-guarded.
    op.execute(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS api_key_created_at "
        "TIMESTAMP WITH TIME ZONE"
    )
    op.execute(
        "DO $$ BEGIN "
        "IF NOT EXISTS (SELECT 1 FROM pg_constraint "
        "WHERE conname = 'uq_users_api_key_hash') THEN "
        "ALTER TABLE users ADD CONSTRAINT uq_users_api_key_hash "
        "UNIQUE (api_key_hash); "
        "END IF; END $$"
    )

    # Drop the legacy columns the model no longer references. Safe pre-
    # launch - no production data exists yet. The replacement is
    # api_key_hash (above), and `settings` was never wired to UI.
    op.execute("DROP INDEX IF EXISTS ix_users_api_key")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS api_key")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS settings")


def downgrade() -> None:
    # Reverse of upgrade(), also IF [NOT] EXISTS-guarded.
    op.execute(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS settings TEXT"
    )
    op.execute(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS api_key VARCHAR(64)"
    )
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS ix_users_api_key "
        "ON users (api_key)"
    )

    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS api_key_created_at")
    op.execute(
        "ALTER TABLE users DROP CONSTRAINT IF EXISTS uq_users_api_key_hash"
    )
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS api_key_hash")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS locked_until")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS failed_login_attempts")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS last_login_at")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS email_verified_at")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS permissions")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS bio")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS organization")
