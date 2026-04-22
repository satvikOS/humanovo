"""reconcile evidence + hypothesis tables with ORM models

Revision ID: 011_model_drift_reconcile
Revises: 010_notebook_pages
Create Date: 2026-04-21

Adds columns that the ORM models reference but earlier migrations never
created. Without these ALTERs, GET /evidence and GET /hypotheses return
500 Internal Server Error because asyncpg can't find columns like
`evidence.abstract`, `evidence.snippet`, `evidence.source_type`, etc.

All ALTERs are IF NOT EXISTS — safe to re-run.
"""

from alembic import op


revision = "011_model_drift_reconcile"
down_revision = "010_notebook_pages"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── Evidence table ──────────────────────────────────────────────
    op.execute("ALTER TABLE evidence ADD COLUMN IF NOT EXISTS abstract TEXT")
    op.execute("ALTER TABLE evidence ADD COLUMN IF NOT EXISTS full_text TEXT")
    op.execute("ALTER TABLE evidence ADD COLUMN IF NOT EXISTS snippet TEXT")
    op.execute("ALTER TABLE evidence ADD COLUMN IF NOT EXISTS source_type VARCHAR(50)")
    op.execute("ALTER TABLE evidence ADD COLUMN IF NOT EXISTS doi VARCHAR(255)")
    op.execute("ALTER TABLE evidence ADD COLUMN IF NOT EXISTS entities VARCHAR[] DEFAULT '{}'")
    op.execute("ALTER TABLE evidence ADD COLUMN IF NOT EXISTS relations JSONB")
    op.execute("ALTER TABLE evidence ADD COLUMN IF NOT EXISTS citation_count INTEGER")
    op.execute("ALTER TABLE evidence ADD COLUMN IF NOT EXISTS embedding_model VARCHAR(100)")
    op.execute("ALTER TABLE evidence ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'pending'")
    op.execute("ALTER TABLE evidence ADD COLUMN IF NOT EXISTS notes TEXT")
    op.execute("ALTER TABLE evidence ADD COLUMN IF NOT EXISTS ingested_by VARCHAR(100)")
    op.execute("ALTER TABLE evidence ADD COLUMN IF NOT EXISTS ingestion_job_id UUID")
    op.execute("ALTER TABLE evidence ADD COLUMN IF NOT EXISTS raw_data JSONB")
    op.execute(
        "UPDATE evidence SET abstract = summary WHERE abstract IS NULL "
        "AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='evidence' AND column_name='summary')"
    )
    op.execute(
        "UPDATE evidence SET source_type = source::text WHERE source_type IS NULL "
        "AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='evidence' AND column_name='source')"
    )

    # ── Hypotheses table: add columns the ORM model expects ──────────
    op.execute("ALTER TABLE hypotheses ADD COLUMN IF NOT EXISTS model_used VARCHAR(100)")
    op.execute("ALTER TABLE hypotheses ADD COLUMN IF NOT EXISTS feasibility_score FLOAT DEFAULT 0.5")
    op.execute("ALTER TABLE hypotheses ADD COLUMN IF NOT EXISTS impact_score FLOAT DEFAULT 0.5")
    op.execute("ALTER TABLE hypotheses ADD COLUMN IF NOT EXISTS external_factors JSONB DEFAULT '[]'::jsonb")
    op.execute("ALTER TABLE hypotheses ADD COLUMN IF NOT EXISTS counter_arguments JSONB DEFAULT '[]'::jsonb")
    op.execute("ALTER TABLE hypotheses ADD COLUMN IF NOT EXISTS citations JSONB DEFAULT '[]'::jsonb")
    op.execute("ALTER TABLE hypotheses ADD COLUMN IF NOT EXISTS supporting_paths JSONB DEFAULT '[]'::jsonb")
    op.execute("ALTER TABLE hypotheses ADD COLUMN IF NOT EXISTS validated BOOLEAN DEFAULT FALSE")
    op.execute("ALTER TABLE hypotheses ADD COLUMN IF NOT EXISTS confidence FLOAT DEFAULT 0.0")
    op.execute("ALTER TABLE hypotheses ADD COLUMN IF NOT EXISTS statement TEXT")
    op.execute("ALTER TABLE hypotheses ADD COLUMN IF NOT EXISTS rationale TEXT")
    op.execute("ALTER TABLE hypotheses ADD COLUMN IF NOT EXISTS confidence_score FLOAT DEFAULT 0.0")
    op.execute("ALTER TABLE hypotheses ADD COLUMN IF NOT EXISTS supporting_count INTEGER DEFAULT 0")
    op.execute("ALTER TABLE hypotheses ADD COLUMN IF NOT EXISTS contradiction_count INTEGER DEFAULT 0")
    op.execute("ALTER TABLE hypotheses ADD COLUMN IF NOT EXISTS simulation_results JSONB")
    op.execute("ALTER TABLE hypotheses ADD COLUMN IF NOT EXISTS user_notes TEXT")
    op.execute("ALTER TABLE hypotheses ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1")
    op.execute("ALTER TABLE hypotheses ADD COLUMN IF NOT EXISTS generation_context JSONB")
    op.execute("ALTER TABLE hypotheses ADD COLUMN IF NOT EXISTS translational_roadmap JSONB")
    op.execute("UPDATE hypotheses SET statement = description WHERE statement IS NULL AND description IS NOT NULL")

    # ── evidence_references table (ORM has evidence_type + snippet + updated_at not in 001)
    op.execute("ALTER TABLE evidence_references ADD COLUMN IF NOT EXISTS evidence_type VARCHAR(50) DEFAULT 'supports'")
    op.execute("ALTER TABLE evidence_references ADD COLUMN IF NOT EXISTS snippet TEXT")
    op.execute("ALTER TABLE evidence_references ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()")

    # ── Projects table: columns the REST response helpers return ─────
    op.execute("ALTER TABLE projects ADD COLUMN IF NOT EXISTS tags VARCHAR[] DEFAULT '{}'")

    # ── Activities table (may be referenced by /activities) ──────────
    # Pre-existing table uses different columns (entity_id, project_name,
    # no project_id / user_id). Add missing FK-style columns idempotently.
    op.execute("""
        CREATE TABLE IF NOT EXISTS activities (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            type VARCHAR(50) NOT NULL,
            title TEXT NOT NULL,
            action VARCHAR(100),
            project_id UUID,
            user_id UUID,
            payload JSONB DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    op.execute("ALTER TABLE activities ADD COLUMN IF NOT EXISTS project_id UUID")
    op.execute("ALTER TABLE activities ADD COLUMN IF NOT EXISTS user_id UUID")
    op.execute("ALTER TABLE activities ADD COLUMN IF NOT EXISTS payload JSONB DEFAULT '{}'::jsonb")
    op.execute("CREATE INDEX IF NOT EXISTS idx_activities_created ON activities(created_at DESC)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_activities_project ON activities(project_id, created_at DESC)")


def downgrade() -> None:
    # No-op — these columns are now required by the ORM models, rolling
    # them back would break the app. Drop the table if we really need
    # to reverse.
    pass
