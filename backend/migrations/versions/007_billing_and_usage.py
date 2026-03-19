"""Add billing and usage tracking tables

Creates tables for:
- usage_events: Individual API usage event tracking
- usage_daily_summary: Aggregated daily usage statistics
- budget_configs: Budget configuration and spend limits
- notifications: User/project notification system

Revision ID: 007_billing_and_usage
Revises: 006_pgvector_management
Create Date: 2026-03-19
"""

from alembic import op
import sqlalchemy as sa


revision = "007_billing_and_usage"
down_revision = "006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── usage_events table ────────────────────────────────────────────
    op.execute("""
        CREATE TABLE IF NOT EXISTS usage_events (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
            run_id UUID,
            run_type VARCHAR(20) NOT NULL,
            model VARCHAR(100) NOT NULL,
            provider VARCHAR(50) NOT NULL,
            stage VARCHAR(30),
            tokens_input INTEGER NOT NULL DEFAULT 0,
            tokens_output INTEGER NOT NULL DEFAULT 0,
            cost_cents INTEGER NOT NULL DEFAULT 0,
            latency_ms INTEGER,
            success BOOLEAN NOT NULL DEFAULT TRUE,
            error_type VARCHAR(100),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS idx_usage_project ON usage_events(project_id)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_usage_created ON usage_events(created_at DESC)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_usage_model ON usage_events(model)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_usage_provider ON usage_events(provider)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_usage_run ON usage_events(run_id)")

    # ── usage_daily_summary table ─────────────────────────────────────
    op.execute("""
        CREATE TABLE IF NOT EXISTS usage_daily_summary (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            date DATE NOT NULL,
            project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
            model VARCHAR(100) NOT NULL,
            provider VARCHAR(50) NOT NULL,
            total_requests INTEGER NOT NULL DEFAULT 0,
            total_tokens_input BIGINT NOT NULL DEFAULT 0,
            total_tokens_output BIGINT NOT NULL DEFAULT 0,
            total_cost_cents INTEGER NOT NULL DEFAULT 0,
            total_errors INTEGER NOT NULL DEFAULT 0,
            avg_latency_ms FLOAT,
            UNIQUE(date, project_id, model, provider)
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS idx_daily_summary_date ON usage_daily_summary(date DESC)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_daily_summary_project ON usage_daily_summary(project_id)")

    # ── budget_configs table ──────────────────────────────────────────
    op.execute("""
        CREATE TABLE IF NOT EXISTS budget_configs (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            scope VARCHAR(20) NOT NULL,
            project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
            monthly_budget_cents INTEGER NOT NULL,
            alert_threshold_pct INTEGER NOT NULL DEFAULT 80,
            hard_limit BOOLEAN NOT NULL DEFAULT FALSE,
            current_month_spend_cents INTEGER DEFAULT 0,
            last_alert_sent_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE(scope, project_id)
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS idx_budget_scope ON budget_configs(scope)")

    # ── notifications table ───────────────────────────────────────────
    op.execute("""
        CREATE TABLE IF NOT EXISTS notifications (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID,
            project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
            type VARCHAR(50) NOT NULL,
            title VARCHAR(255) NOT NULL,
            message TEXT NOT NULL,
            severity VARCHAR(20) NOT NULL DEFAULT 'info',
            read BOOLEAN NOT NULL DEFAULT FALSE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read, created_at DESC)")


def downgrade() -> None:
    # Drop in reverse order
    op.execute("DROP TABLE IF EXISTS notifications")
    op.execute("DROP TABLE IF EXISTS budget_configs")
    op.execute("DROP TABLE IF EXISTS usage_daily_summary")
    op.execute("DROP TABLE IF EXISTS usage_events")
