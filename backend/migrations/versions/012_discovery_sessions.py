"""add discovery_sessions table

Revision ID: 012_discovery_sessions
Revises: 011_model_drift_reconcile
Create Date: 2026-04-23

Persists conversational Discovery sessions so the left-rail session
list reloads across tabs/devices and the agent config (model,
temperature, system prompt, tools) survives reopens.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "012_discovery_sessions"
down_revision = "011_model_drift_reconcile"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "discovery_sessions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("title", sa.String(500), nullable=False, server_default="New conversation"),
        sa.Column("pinned", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("agent_config", postgresql.JSONB(), nullable=False, server_default="{}"),
        sa.Column("messages", postgresql.JSONB(), nullable=False, server_default="[]"),
        sa.Column("last_run_id", sa.String(128), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
    )
    op.create_index("ix_discovery_sessions_project_id", "discovery_sessions", ["project_id"])
    op.create_index("ix_discovery_sessions_pinned", "discovery_sessions", ["pinned"])
    op.create_index("ix_discovery_sessions_updated_at", "discovery_sessions", ["updated_at"])


def downgrade() -> None:
    op.drop_index("ix_discovery_sessions_updated_at", table_name="discovery_sessions")
    op.drop_index("ix_discovery_sessions_pinned", table_name="discovery_sessions")
    op.drop_index("ix_discovery_sessions_project_id", table_name="discovery_sessions")
    op.drop_table("discovery_sessions")
