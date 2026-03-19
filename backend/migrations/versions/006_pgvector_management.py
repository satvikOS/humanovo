"""Add pgvector management tables for cache monitoring and maintenance

Creates tables for:
- cache_stats_snapshots: Periodic snapshots of embedding cache statistics
- maintenance_log: Track maintenance task executions and outcomes

Revision ID: 006_pgvector_management
Revises: 005_data_source_registry
Create Date: 2026-03-19
"""

from alembic import op
import sqlalchemy as sa


revision = "006_pgvector_management"
down_revision = "005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── cache_stats_snapshots table ───────────────────────────────────
    op.execute("""
        CREATE TABLE IF NOT EXISTS cache_stats_snapshots (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            snapshot_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            total_entries INTEGER NOT NULL,
            total_size_bytes BIGINT,
            entries_with_cohere INTEGER,
            entries_with_openai INTEGER,
            entries_with_both INTEGER,
            source_counts JSONB,
            expiring_in_7_days INTEGER
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS idx_cache_stats_time ON cache_stats_snapshots(snapshot_at DESC)")

    # ── maintenance_log table ─────────────────────────────────────────
    op.execute("""
        CREATE TABLE IF NOT EXISTS maintenance_log (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            task_name VARCHAR(100) NOT NULL,
            started_at TIMESTAMPTZ NOT NULL,
            completed_at TIMESTAMPTZ,
            status VARCHAR(20) NOT NULL,
            entries_affected INTEGER,
            error_message TEXT,
            duration_seconds FLOAT
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS idx_maintenance_task ON maintenance_log(task_name, started_at DESC)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_maintenance_task")
    op.execute("DROP TABLE IF EXISTS maintenance_log")
    op.execute("DROP INDEX IF EXISTS idx_cache_stats_time")
    op.execute("DROP TABLE IF EXISTS cache_stats_snapshots")
