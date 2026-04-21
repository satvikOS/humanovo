"""Billing and usage tracking tables.

Revision ID: 005_billing_and_usage
Revises: 004_research_project_management
Create Date: 2026-03-19
"""

from alembic import op

revision = "005_billing_and_usage"
down_revision = "005_data_source_registry"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # usage_events — individual API call cost records
    op.execute("""
    CREATE TABLE IF NOT EXISTS usage_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
        discovery_run_id UUID,
        synthesis_run_id UUID,
        stage_execution_id UUID,
        provider VARCHAR(50) NOT NULL,
        model_name VARCHAR(100) NOT NULL,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cached_tokens INTEGER NOT NULL DEFAULT 0,
        cost_cents NUMERIC(10, 4) NOT NULL DEFAULT 0,
        latency_ms INTEGER,
        stage_number INTEGER,
        stage_name VARCHAR(50),
        hypothesis_id UUID,
        round_number INTEGER,
        is_retry BOOLEAN DEFAULT FALSE,
        is_embedding BOOLEAN DEFAULT FALSE,
        is_search BOOLEAN DEFAULT FALSE,
        error_message TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    """)

    # usage_daily_summary — pre-aggregated daily billing
    op.execute("""
    CREATE TABLE IF NOT EXISTS usage_daily_summary (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        date DATE NOT NULL,
        project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
        provider VARCHAR(50) NOT NULL,
        model_name VARCHAR(100) NOT NULL,
        total_input_tokens BIGINT NOT NULL DEFAULT 0,
        total_output_tokens BIGINT NOT NULL DEFAULT 0,
        total_cached_tokens BIGINT NOT NULL DEFAULT 0,
        total_cost_cents NUMERIC(12, 4) NOT NULL DEFAULT 0,
        total_requests INTEGER NOT NULL DEFAULT 0,
        total_errors INTEGER NOT NULL DEFAULT 0,
        avg_latency_ms NUMERIC(10, 2),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(date, project_id, provider, model_name)
    );
    """)

    # budget_configs
    op.execute("""
    CREATE TABLE IF NOT EXISTS budget_configs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        scope VARCHAR(20) NOT NULL DEFAULT 'global',
        project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
        monthly_budget_cents INTEGER NOT NULL,
        alert_threshold_pct INTEGER NOT NULL DEFAULT 80,
        hard_limit BOOLEAN NOT NULL DEFAULT FALSE,
        current_month_spend_cents INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    """)

    # notifications
    op.execute("""
    CREATE TABLE IF NOT EXISTS notifications (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        type VARCHAR(50) NOT NULL,
        title VARCHAR(255) NOT NULL,
        message TEXT,
        severity VARCHAR(20) NOT NULL DEFAULT 'info',
        project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
        budget_id UUID REFERENCES budget_configs(id) ON DELETE SET NULL,
        read BOOLEAN NOT NULL DEFAULT FALSE,
        read_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    """)

    # Indexes
    op.execute("CREATE INDEX IF NOT EXISTS idx_usage_events_project ON usage_events(project_id);")
    op.execute("CREATE INDEX IF NOT EXISTS idx_usage_events_created ON usage_events(created_at);")
    op.execute("CREATE INDEX IF NOT EXISTS idx_usage_events_provider ON usage_events(provider, model_name);")
    op.execute("CREATE INDEX IF NOT EXISTS idx_usage_events_run ON usage_events(discovery_run_id);")
    op.execute("CREATE INDEX IF NOT EXISTS idx_usage_daily_date ON usage_daily_summary(date);")
    op.execute("CREATE INDEX IF NOT EXISTS idx_usage_daily_project ON usage_daily_summary(project_id, date);")
    op.execute("CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(read, created_at);")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS notifications;")
    op.execute("DROP TABLE IF EXISTS budget_configs;")
    op.execute("DROP TABLE IF EXISTS usage_daily_summary;")
    op.execute("DROP TABLE IF EXISTS usage_events;")
