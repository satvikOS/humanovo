"""reconcile activities table with the ORM Activity model

Revision ID: 037_activities_schema_reconcile
Revises: 036_refund_records
Create Date: 2026-05-16

Migration 011 created `activities` with a minimal column set
(type/title/action/project_id/user_id/payload/created_at). The ORM
`Activity` model (app/models/activity.py) has since grown columns that
011 never added, so `GET /api/v1/activities` issues
`SELECT activities.description, activities.entity_id, ...` against a
table that lacks them and returns 500 Internal Server Error.

CI never caught this because the test database is built from the ORM
metadata (`create_all`), not from the migration chain — so the drift
only surfaces on a migration-built production database.

Adds the seven missing columns the model declares:
  • updated_at     — TimestampMixin
  • description    — Text
  • entity_id      — VARCHAR(100)
  • entity_type    — VARCHAR(50)
  • project_name   — VARCHAR(200)
  • metadata       — JSONB   (ORM attr `extra_metadata`, column "metadata")
  • annotation     — Text

The model also declares `type`/`action` as native PG enums while the
011 table made them VARCHAR. That mismatch is intentionally left alone:
it is a missing DB-level CHECK only — SELECT and INSERT both work with
the VARCHAR columns — and an in-place VARCHAR->enum conversion is a
riskier change than this 500 fix warrants.

All ALTERs are IF NOT EXISTS — safe to re-run.
"""

from alembic import op

revision = "037_activities_schema_reconcile"
down_revision = "036_refund_records"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE activities ADD COLUMN IF NOT EXISTS "
        "updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()"
    )
    op.execute("ALTER TABLE activities ADD COLUMN IF NOT EXISTS description TEXT")
    op.execute("ALTER TABLE activities ADD COLUMN IF NOT EXISTS entity_id VARCHAR(100)")
    op.execute("ALTER TABLE activities ADD COLUMN IF NOT EXISTS entity_type VARCHAR(50)")
    op.execute(
        "ALTER TABLE activities ADD COLUMN IF NOT EXISTS project_name VARCHAR(200)"
    )
    op.execute(
        "ALTER TABLE activities ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb"
    )
    op.execute("ALTER TABLE activities ADD COLUMN IF NOT EXISTS annotation TEXT")


def downgrade() -> None:
    # No-op — these columns are required by the ORM model; dropping them
    # would re-break GET /activities. Drop the table to truly reverse.
    pass
