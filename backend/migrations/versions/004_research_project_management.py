"""Add research project management tables per the v2 platform spec.

Creates tables for:
- discovery_runs: Track discovery pipeline executions
- synthesis_runs: Track backward/synthesis pipeline executions
- citation_cache: Cache verified citations (DOI/PMID lookup)
- imaging_records: Biomedical imaging metadata (MRI, EEG, etc.)
- hypothesis_feedback: Structured researcher feedback
- grounding_cache: pgvector-backed grounding for anti-hallucination
Also ALTERs projects table with new columns.

Revision ID: 004_research_project_management
Revises: 003_pgvector
Create Date: 2026-03-18
"""

from alembic import op
import sqlalchemy as sa


revision = "004_research_project_management"
down_revision = "003_pgvector"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── ALTER projects table with new columns ────────────────────────
    op.execute("ALTER TABLE projects ADD COLUMN IF NOT EXISTS discovery_config JSONB")
    op.execute("ALTER TABLE projects ADD COLUMN IF NOT EXISTS lab_profile JSONB")
    op.execute("ALTER TABLE projects ADD COLUMN IF NOT EXISTS total_discovery_runs INTEGER DEFAULT 0")
    op.execute("ALTER TABLE projects ADD COLUMN IF NOT EXISTS total_api_cost_cents INTEGER DEFAULT 0")
    op.execute("ALTER TABLE projects ADD COLUMN IF NOT EXISTS best_confidence_score FLOAT DEFAULT 0.0")
    op.execute("ALTER TABLE projects ADD COLUMN IF NOT EXISTS last_discovery_at TIMESTAMPTZ")

    # ── discovery_runs table ─────────────────────────────────────────
    # Migration 002 already created discovery_runs (pipeline-intelligence
    # schema, no project_id). Extend it here with the v2 columns
    # so both surface areas can coexist on one table.
    op.execute("""
        CREATE TABLE IF NOT EXISTS discovery_runs (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
            status VARCHAR(20) NOT NULL DEFAULT 'pending',
            disease VARCHAR(255) NOT NULL,
            discovery_type VARCHAR(50) NOT NULL,
            config JSONB NOT NULL DEFAULT '{}'::jsonb,
            num_rounds INTEGER NOT NULL DEFAULT 3,
            hypotheses_per_round INTEGER NOT NULL DEFAULT 3,
            best_hypothesis_id UUID,
            total_cost_cents INTEGER DEFAULT 0,
            total_duration_seconds FLOAT,
            pipeline_trace JSONB,
            error_message TEXT,
            visualization_data JSONB,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            completed_at TIMESTAMPTZ
        )
    """)
    # Guard the v2 column additions with IF NOT EXISTS so this
    # migration is idempotent after 002 pre-created the table.
    op.execute("ALTER TABLE discovery_runs ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE CASCADE")
    op.execute("ALTER TABLE discovery_runs ADD COLUMN IF NOT EXISTS config JSONB NOT NULL DEFAULT '{}'::jsonb")
    op.execute("ALTER TABLE discovery_runs ADD COLUMN IF NOT EXISTS num_rounds INTEGER NOT NULL DEFAULT 3")
    op.execute("ALTER TABLE discovery_runs ADD COLUMN IF NOT EXISTS best_hypothesis_id UUID")
    op.execute("ALTER TABLE discovery_runs ADD COLUMN IF NOT EXISTS total_cost_cents INTEGER DEFAULT 0")
    op.execute("ALTER TABLE discovery_runs ADD COLUMN IF NOT EXISTS pipeline_trace JSONB")
    op.execute("ALTER TABLE discovery_runs ADD COLUMN IF NOT EXISTS error_message TEXT")
    op.execute("ALTER TABLE discovery_runs ADD COLUMN IF NOT EXISTS visualization_data JSONB")
    op.execute("ALTER TABLE discovery_runs ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ")
    op.execute("CREATE INDEX IF NOT EXISTS idx_discovery_runs_project ON discovery_runs(project_id)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_discovery_runs_status ON discovery_runs(status)")

    # ── synthesis_runs table ─────────────────────────────────────────
    op.execute("""
        CREATE TABLE IF NOT EXISTS synthesis_runs (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            status VARCHAR(20) NOT NULL DEFAULT 'pending',
            hypothesis TEXT NOT NULL,
            field_scope TEXT,
            time_range JSONB,
            output_format VARCHAR(30) NOT NULL DEFAULT 'narrative',
            verbosity VARCHAR(20) NOT NULL DEFAULT 'standard',
            grant_type VARCHAR(30),
            citation_style VARCHAR(20) NOT NULL DEFAULT 'numbered',
            result JSONB,
            pipeline_trace JSONB,
            total_cost_cents INTEGER DEFAULT 0,
            total_duration_seconds FLOAT,
            error_message TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            completed_at TIMESTAMPTZ
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS idx_synthesis_runs_project ON synthesis_runs(project_id)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_synthesis_runs_status ON synthesis_runs(status)")

    # ── grounding_cache table (pgvector) ─────────────────────────────
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.execute("""
        CREATE TABLE IF NOT EXISTS grounding_cache (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            embedding_cohere vector(1024),
            embedding_openai vector(1536),
            content TEXT NOT NULL,
            source VARCHAR(100) NOT NULL,
            source_id VARCHAR(255),
            metadata JSONB,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_grounding_cohere
        ON grounding_cache USING ivfflat (embedding_cohere vector_cosine_ops)
        WITH (lists = 100)
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_grounding_openai
        ON grounding_cache USING ivfflat (embedding_openai vector_cosine_ops)
        WITH (lists = 100)
    """)
    op.execute("CREATE INDEX IF NOT EXISTS idx_grounding_source ON grounding_cache(source)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_grounding_updated ON grounding_cache(updated_at)")

    # ── citation_cache table ─────────────────────────────────────────
    op.execute("""
        CREATE TABLE IF NOT EXISTS citation_cache (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            doi VARCHAR(255) UNIQUE,
            pmid VARCHAR(20) UNIQUE,
            title TEXT NOT NULL,
            authors JSONB,
            journal VARCHAR(500),
            year INTEGER,
            verified BOOLEAN DEFAULT FALSE,
            verified_at TIMESTAMPTZ,
            metadata JSONB,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS idx_citation_doi ON citation_cache(doi) WHERE doi IS NOT NULL")
    op.execute("CREATE INDEX IF NOT EXISTS idx_citation_pmid ON citation_cache(pmid) WHERE pmid IS NOT NULL")

    # ── imaging_records table ────────────────────────────────────────
    op.execute("""
        CREATE TABLE IF NOT EXISTS imaging_records (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            file_path VARCHAR(1000) NOT NULL,
            file_name VARCHAR(255) NOT NULL,
            file_size_bytes BIGINT,
            format VARCHAR(20) NOT NULL,
            modality VARCHAR(50) NOT NULL,
            sub_modality VARCHAR(100),
            body_region VARCHAR(100),
            description TEXT,
            resolution JSONB,
            dimensions JSONB,
            acquisition_params JSONB,
            patient_id_hash VARCHAR(64),
            study_date DATE,
            series_description VARCHAR(500),
            linked_hypothesis_ids JSONB,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS idx_imaging_project ON imaging_records(project_id)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_imaging_modality ON imaging_records(modality)")

    # ── hypothesis_feedback table ────────────────────────────────────
    op.execute("""
        CREATE TABLE IF NOT EXISTS hypothesis_feedback (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            hypothesis_id UUID NOT NULL REFERENCES hypotheses(id) ON DELETE CASCADE,
            user_id UUID,
            overall_quality FLOAT NOT NULL,
            dimension_scores JSONB NOT NULL,
            boolean_flags JSONB,
            tags JSONB,
            free_text TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS idx_feedback_hypothesis ON hypothesis_feedback(hypothesis_id)")

    # ── Add feasibility and revision columns to hypotheses ───────────
    op.execute("ALTER TABLE hypotheses ADD COLUMN IF NOT EXISTS feasibility_score FLOAT")
    op.execute("ALTER TABLE hypotheses ADD COLUMN IF NOT EXISTS impact_score FLOAT")
    op.execute("ALTER TABLE hypotheses ADD COLUMN IF NOT EXISTS required_methods JSONB")
    op.execute("ALTER TABLE hypotheses ADD COLUMN IF NOT EXISTS counter_arguments JSONB")
    op.execute("ALTER TABLE hypotheses ADD COLUMN IF NOT EXISTS revisions JSONB")
    op.execute("ALTER TABLE hypotheses ADD COLUMN IF NOT EXISTS avg_feedback_quality FLOAT")
    op.execute("ALTER TABLE hypotheses ADD COLUMN IF NOT EXISTS feedback_count INTEGER DEFAULT 0")
    op.execute("ALTER TABLE hypotheses ADD COLUMN IF NOT EXISTS discovery_run_id UUID")


def downgrade() -> None:
    # Drop in reverse order
    op.execute("ALTER TABLE hypotheses DROP COLUMN IF EXISTS discovery_run_id")
    op.execute("ALTER TABLE hypotheses DROP COLUMN IF EXISTS feedback_count")
    op.execute("ALTER TABLE hypotheses DROP COLUMN IF EXISTS avg_feedback_quality")
    op.execute("ALTER TABLE hypotheses DROP COLUMN IF EXISTS revisions")
    op.execute("ALTER TABLE hypotheses DROP COLUMN IF EXISTS counter_arguments")
    op.execute("ALTER TABLE hypotheses DROP COLUMN IF EXISTS required_methods")
    op.execute("ALTER TABLE hypotheses DROP COLUMN IF EXISTS impact_score")
    op.execute("ALTER TABLE hypotheses DROP COLUMN IF EXISTS feasibility_score")

    op.execute("DROP TABLE IF EXISTS hypothesis_feedback")
    op.execute("DROP TABLE IF EXISTS imaging_records")
    op.execute("DROP TABLE IF EXISTS citation_cache")
    op.execute("DROP INDEX IF EXISTS idx_grounding_updated")
    op.execute("DROP INDEX IF EXISTS idx_grounding_source")
    op.execute("DROP INDEX IF EXISTS idx_grounding_openai")
    op.execute("DROP INDEX IF EXISTS idx_grounding_cohere")
    op.execute("DROP TABLE IF EXISTS grounding_cache")
    op.execute("DROP TABLE IF EXISTS synthesis_runs")
    op.execute("DROP TABLE IF EXISTS discovery_runs")

    op.execute("ALTER TABLE projects DROP COLUMN IF EXISTS last_discovery_at")
    op.execute("ALTER TABLE projects DROP COLUMN IF EXISTS best_confidence_score")
    op.execute("ALTER TABLE projects DROP COLUMN IF EXISTS total_api_cost_cents")
    op.execute("ALTER TABLE projects DROP COLUMN IF EXISTS total_discovery_runs")
    op.execute("ALTER TABLE projects DROP COLUMN IF EXISTS lab_profile")
    op.execute("ALTER TABLE projects DROP COLUMN IF EXISTS discovery_config")
