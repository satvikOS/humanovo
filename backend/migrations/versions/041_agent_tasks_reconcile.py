"""reconcile agent_tasks table with the ORM AgentTask model

Revision ID: 041_agent_tasks_reconcile
Revises: 040_ingestion_jobs_reconcile
Create Date: 2026-05-17

Migration 001 created `agent_tasks` with an early column set. The ORM
`AgentTask` model (app/models/agent_task.py) has since grown a dozen
columns — execution timing, agent identity, token/cost accounting —
that no migration ever added, so `select(AgentTask)` 500s
(`GET /api/v1/agents/tasks`, `/agents/stats`).

Same drift class as migrations 037-040; CI misses it because the test
DB is built from ORM metadata, not the migration chain.

Adds every missing model column (nullable — an empty production table
makes that safe; the ORM enforces its own NOT NULL on insert). The
table's legacy `steps` / `current_step` columns are left in place
(harmless — the model just doesn't map them).

All ALTERs are IF NOT EXISTS — safe to re-run.
"""

from alembic import op

revision = "041_agent_tasks_reconcile"
down_revision = "040_ingestion_jobs_reconcile"
branch_labels = None
depends_on = None

_ADD_COLUMNS = [
    ("max_retries", "INTEGER DEFAULT 3"),
    ("queued_at", "TIMESTAMPTZ"),
    ("timeout_seconds", "INTEGER DEFAULT 600"),
    ("runtime_seconds", "FLOAT"),
    ("agent_id", "VARCHAR(100)"),
    ("agent_model", "VARCHAR(100)"),
    ("worker_id", "VARCHAR(100)"),
    ("error_details", "JSONB"),
    ("tokens_used", "INTEGER DEFAULT 0"),
    ("api_calls_made", "INTEGER DEFAULT 0"),
    ("cost_usd", "FLOAT DEFAULT 0"),
    ("tags", "VARCHAR[] DEFAULT '{}'"),
]


def upgrade() -> None:
    for name, coltype in _ADD_COLUMNS:
        op.execute(
            f"ALTER TABLE agent_tasks "
            f"ADD COLUMN IF NOT EXISTS {name} {coltype}"
        )


def downgrade() -> None:
    # No-op — these columns are required by the ORM model.
    pass
