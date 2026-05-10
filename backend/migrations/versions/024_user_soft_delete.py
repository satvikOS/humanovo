"""add users.delete_requested_at + users.deleted_at

GDPR Art. 17 (right to erasure) implementation. A user clicking
"Delete my account" populates `delete_requested_at`. The account is
immediately disabled (logins blocked, sessions invalidated) but rows
remain so an undo within the 30-day grace window can restore.

After the grace window, a daily cron picks up rows where
`delete_requested_at < now() - INTERVAL '30 days'` and hard-deletes
them: cascades through projects → hypotheses → audit log; the audit
log itself is RETAINED (Merkle chain integrity + HIPAA 7-year rule)
but the user-identifying columns are nulled out / replaced with
`deleted-user-{uuid}`.

`deleted_at` records the moment the hard-delete actually fired,
useful for the audit log + reconciling "user disappeared" support
tickets that come in after the grace window.

Both columns are NULLABLE — every row defaults to "not requested,
not deleted". Adding columns is metadata-only on PG 11+.

Idempotence: ADD COLUMN IF NOT EXISTS. Re-runnable after partial
application.

Revision ID: 024_user_soft_delete
Revises: 023_kg_node_embedding_and_owner
Create Date: 2026-05-10
"""
from __future__ import annotations

from alembic import op


revision = "024_user_soft_delete"
down_revision = "023_kg_node_embedding_and_owner"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE users "
        "ADD COLUMN IF NOT EXISTS delete_requested_at "
        "TIMESTAMP WITH TIME ZONE NULL"
    )
    op.execute(
        "ALTER TABLE users "
        "ADD COLUMN IF NOT EXISTS deleted_at "
        "TIMESTAMP WITH TIME ZONE NULL"
    )
    # Index on delete_requested_at so the daily hard-delete cron can
    # find candidate rows fast without a full table scan. Partial
    # index — only rows where the column is non-null are indexed.
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_users_delete_requested_at "
        "ON users (delete_requested_at) "
        "WHERE delete_requested_at IS NOT NULL"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_users_delete_requested_at")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS deleted_at")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS delete_requested_at")
