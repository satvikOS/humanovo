"""add missing values to agent_task_status / ingestion_job_status enums

Revision ID: 042_status_enum_values
Revises: 041_agent_tasks_reconcile
Create Date: 2026-05-17

Migration 001 created the `agent_task_status` and `ingestion_job_status`
PostgreSQL enum types with only {pending, running, completed, failed,
cancelled}. The ORM status enums have since grown extra states. The
list endpoints survive (they don't filter on status), but
`GET /api/v1/agents/stats` and `/ingestion/queue/stats` iterate every
ORM status value and run `WHERE status = $value` — binding a value the
PG enum type doesn't contain raises
`invalid input value for enum ...` and 500s.

Adds the missing values:
  agent_task_status     += queued, retrying
  ingestion_job_status  += queued, fetching, processing, indexing, partial

ADD VALUE IF NOT EXISTS is idempotent. (`running` stays in the enums
even though the ingestion model dropped it — an unused enum value is
harmless.)
"""

from alembic import op

revision = "042_status_enum_values"
down_revision = "041_agent_tasks_reconcile"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for val in ("queued", "retrying"):
        op.execute(
            f"ALTER TYPE agent_task_status ADD VALUE IF NOT EXISTS '{val}'"
        )
    for val in ("queued", "fetching", "processing", "indexing", "partial"):
        op.execute(
            f"ALTER TYPE ingestion_job_status ADD VALUE IF NOT EXISTS '{val}'"
        )


def downgrade() -> None:
    # PostgreSQL cannot remove enum values — no-op.
    pass
