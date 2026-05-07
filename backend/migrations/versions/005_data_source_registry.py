"""Add data source health registry table

Creates tables for:
- data_source_health: Track health/status of external data sources by phase

Revision ID: 005_data_source_registry
Revises: 004_research_project_management
Create Date: 2026-03-19
"""

from alembic import op

revision = "005_data_source_registry"
down_revision = "004_research_project_management"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── data_source_health table ──────────────────────────────────────
    op.execute("""
        CREATE TABLE IF NOT EXISTS data_source_health (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            source_name VARCHAR(100) NOT NULL UNIQUE,
            phase INTEGER NOT NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'unconfigured',
            latency_ms FLOAT,
            last_successful_query TIMESTAMPTZ,
            last_error TEXT,
            last_checked TIMESTAMPTZ,
            total_queries INTEGER DEFAULT 0,
            total_errors INTEGER DEFAULT 0,
            config JSONB,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS idx_source_health_name ON data_source_health(source_name)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_source_health_status ON data_source_health(status)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_source_health_status")
    op.execute("DROP INDEX IF EXISTS idx_source_health_name")
    op.execute("DROP TABLE IF EXISTS data_source_health")
