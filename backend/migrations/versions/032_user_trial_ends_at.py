"""add users.trial_ends_at — 14-day free trial deadline

When a user signs up for a trial tier (no credit card needed), this
column gets stamped at now() + 14 days. The trial-expiry cron picks
up rows where:
  • trial_ends_at IS NOT NULL
  • now() crosses key thresholds (day-3 warning, expiry day)

At expiry, the cron flips tier → trial (free), records a
subscription_transition for the audit chain, and sends a final
email with an upgrade CTA.

NULL = either: paying customer (never on a trial), or already
       trial-converted (downgraded to free, this column reset NULL
       so the cron doesn't keep firing).

Idempotence: ADD COLUMN IF NOT EXISTS.

Revision ID: 032_user_trial_ends_at
Revises: 031_email_sends_dedup
Create Date: 2026-05-10
"""
from __future__ import annotations

from alembic import op


revision = "032_user_trial_ends_at"
down_revision = "031_email_sends_dedup"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE users "
        "ADD COLUMN IF NOT EXISTS trial_ends_at "
        "TIMESTAMP WITH TIME ZONE NULL"
    )
    # Partial index — only rows with a pending trial are indexed.
    # The cron scans this every day, so we want it fast even on a
    # large users table where most rows have NULL trial_ends_at.
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_users_trial_ends_at "
        "ON users (trial_ends_at) "
        "WHERE trial_ends_at IS NOT NULL"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_users_trial_ends_at")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS trial_ends_at")
