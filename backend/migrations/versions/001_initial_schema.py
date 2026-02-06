"""Initial schema

Revision ID: 001_initial
Revises:
Create Date: 2024-02-06

Creates all initial database tables for GenUp.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers
revision: str = "001_initial"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create enum types
    op.execute("CREATE TYPE user_role AS ENUM ('admin', 'researcher', 'viewer')")
    op.execute("CREATE TYPE project_status AS ENUM ('active', 'paused', 'completed', 'archived')")
    op.execute("CREATE TYPE hypothesis_status AS ENUM ('draft', 'testing', 'validated', 'rejected', 'archived')")
    op.execute("CREATE TYPE evidence_source AS ENUM ('pubmed', 'clinical_trial', 'preprint', 'patent', 'web', 'manual', 'brave_search')")
    op.execute("CREATE TYPE simulation_status AS ENUM ('pending', 'running', 'completed', 'failed', 'cancelled')")
    op.execute("CREATE TYPE simulation_type AS ENUM ('monte_carlo', 'pathway', 'drug_response', 'epidemiological', 'custom')")
    op.execute("CREATE TYPE agent_task_status AS ENUM ('pending', 'running', 'completed', 'failed', 'cancelled')")
    op.execute("CREATE TYPE agent_task_type AS ENUM ('search', 'extraction', 'reasoning', 'verification', 'simulation', 'ingestion', 'discovery')")
    op.execute("CREATE TYPE ingestion_job_status AS ENUM ('pending', 'running', 'completed', 'failed', 'cancelled')")
    op.execute("CREATE TYPE ingestion_source AS ENUM ('pubmed', 'clinical_trials', 'preprints', 'patents', 'custom', 'brave_search')")

    # Users table
    op.create_table(
        "users",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("email", sa.String(255), unique=True, nullable=False, index=True),
        sa.Column("hashed_password", sa.String(255), nullable=False),
        sa.Column("full_name", sa.String(255), nullable=True),
        sa.Column("role", sa.Enum("admin", "researcher", "viewer", name="user_role"), default="researcher", nullable=False),
        sa.Column("is_active", sa.Boolean(), default=True, nullable=False),
        sa.Column("is_verified", sa.Boolean(), default=False, nullable=False),
        sa.Column("api_key", sa.String(64), unique=True, nullable=True, index=True),
        sa.Column("settings", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
    )

    # Projects table
    op.create_table(
        "projects",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False, index=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("disease_focus", sa.String(255), nullable=True, index=True),
        sa.Column("research_question", sa.Text(), nullable=True),
        sa.Column("tags", postgresql.ARRAY(sa.String()), default=[], nullable=False),
        sa.Column("status", sa.Enum("active", "paused", "completed", "archived", name="project_status"), default="active", nullable=False),
        sa.Column("owner_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True),
        sa.Column("hypothesis_count", sa.Integer(), default=0, nullable=False),
        sa.Column("evidence_count", sa.Integer(), default=0, nullable=False),
        sa.Column("simulation_count", sa.Integer(), default=0, nullable=False),
        sa.Column("settings", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
    )

    # Evidence table
    op.create_table(
        "evidence",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=True, index=True),
        sa.Column("title", sa.String(500), nullable=False, index=True),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("source", sa.Enum("pubmed", "clinical_trial", "preprint", "patent", "web", "manual", "brave_search", name="evidence_source"), nullable=False),
        sa.Column("source_url", sa.String(2000), nullable=True),
        sa.Column("source_id", sa.String(255), nullable=True, index=True),
        sa.Column("authors", postgresql.ARRAY(sa.String()), default=[], nullable=True),
        sa.Column("publication_date", sa.Date(), nullable=True),
        sa.Column("journal", sa.String(500), nullable=True),
        sa.Column("citations", sa.Integer(), default=0, nullable=True),
        sa.Column("quality_score", sa.Float(), default=0.5, nullable=False),
        sa.Column("relevance_score", sa.Float(), default=0.5, nullable=False),
        sa.Column("extracted_entities", postgresql.JSONB(), default={}, nullable=True),
        sa.Column("extracted_relations", postgresql.JSONB(), default=[], nullable=True),
        sa.Column("embedding_id", sa.String(255), nullable=True),
        sa.Column("tags", postgresql.ARRAY(sa.String()), default=[], nullable=False),
        sa.Column("metadata", postgresql.JSONB(), default={}, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
    )

    # Hypotheses table
    op.create_table(
        "hypotheses",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=True, index=True),
        sa.Column("title", sa.String(500), nullable=False, index=True),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("mechanism", sa.Text(), nullable=True),
        sa.Column("predictions", postgresql.JSONB(), default=[], nullable=True),
        sa.Column("status", sa.Enum("draft", "testing", "validated", "rejected", "archived", name="hypothesis_status"), default="draft", nullable=False),
        sa.Column("confidence_score", sa.Float(), default=0.0, nullable=False),
        sa.Column("evidence_score", sa.Float(), default=0.0, nullable=False),
        sa.Column("novelty_score", sa.Float(), default=0.5, nullable=False),
        sa.Column("target_entities", postgresql.JSONB(), default=[], nullable=True),
        sa.Column("source_entities", postgresql.JSONB(), default=[], nullable=True),
        sa.Column("supporting_evidence_ids", postgresql.ARRAY(postgresql.UUID(as_uuid=True)), default=[], nullable=True),
        sa.Column("contradicting_evidence_ids", postgresql.ARRAY(postgresql.UUID(as_uuid=True)), default=[], nullable=True),
        sa.Column("generated_by", sa.String(100), nullable=True),
        sa.Column("parent_hypothesis_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("hypotheses.id", ondelete="SET NULL"), nullable=True),
        sa.Column("tags", postgresql.ARRAY(sa.String()), default=[], nullable=False),
        sa.Column("metadata", postgresql.JSONB(), default={}, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
    )

    # Evidence references (many-to-many with hypotheses)
    op.create_table(
        "evidence_references",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("hypothesis_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("hypotheses.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("evidence_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("evidence.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("relationship_type", sa.String(50), default="supports", nullable=False),
        sa.Column("relevance_score", sa.Float(), default=1.0, nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    # Simulations table
    op.create_table(
        "simulations",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=True, index=True),
        sa.Column("hypothesis_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("hypotheses.id", ondelete="SET NULL"), nullable=True, index=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("simulation_type", sa.Enum("monte_carlo", "pathway", "drug_response", "epidemiological", "custom", name="simulation_type"), nullable=False),
        sa.Column("status", sa.Enum("pending", "running", "completed", "failed", "cancelled", name="simulation_status"), default="pending", nullable=False),
        sa.Column("parameters", postgresql.JSONB(), default={}, nullable=False),
        sa.Column("results", postgresql.JSONB(), nullable=True),
        sa.Column("statistics", postgresql.JSONB(), nullable=True),
        sa.Column("iterations", sa.Integer(), default=1000, nullable=False),
        sa.Column("completed_iterations", sa.Integer(), default=0, nullable=False),
        sa.Column("progress", sa.Float(), default=0.0, nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
    )

    # Agent tasks table
    op.create_table(
        "agent_tasks",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=True, index=True),
        sa.Column("task_type", sa.Enum("search", "extraction", "reasoning", "verification", "simulation", "ingestion", "discovery", name="agent_task_type"), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("status", sa.Enum("pending", "running", "completed", "failed", "cancelled", name="agent_task_status"), default="pending", nullable=False),
        sa.Column("priority", sa.Integer(), default=5, nullable=False),
        sa.Column("input_data", postgresql.JSONB(), default={}, nullable=True),
        sa.Column("output_data", postgresql.JSONB(), nullable=True),
        sa.Column("steps", postgresql.JSONB(), default=[], nullable=True),
        sa.Column("current_step", sa.Integer(), default=0, nullable=False),
        sa.Column("progress", sa.Float(), default=0.0, nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("retry_count", sa.Integer(), default=0, nullable=False),
        sa.Column("parent_task_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("agent_tasks.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
    )

    # Ingestion jobs table
    op.create_table(
        "ingestion_jobs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="SET NULL"), nullable=True, index=True),
        sa.Column("source", sa.Enum("pubmed", "clinical_trials", "preprints", "patents", "custom", "brave_search", name="ingestion_source"), nullable=False),
        sa.Column("query", sa.Text(), nullable=False),
        sa.Column("status", sa.Enum("pending", "running", "completed", "failed", "cancelled", name="ingestion_job_status"), default="pending", nullable=False),
        sa.Column("parameters", postgresql.JSONB(), default={}, nullable=True),
        sa.Column("total_items", sa.Integer(), default=0, nullable=False),
        sa.Column("processed_items", sa.Integer(), default=0, nullable=False),
        sa.Column("failed_items", sa.Integer(), default=0, nullable=False),
        sa.Column("progress", sa.Float(), default=0.0, nullable=False),
        sa.Column("results_summary", postgresql.JSONB(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
    )

    # Create indexes
    op.create_index("ix_evidence_full_text", "evidence", ["title", "content"], postgresql_using="gin", postgresql_ops={"title": "gin_trgm_ops", "content": "gin_trgm_ops"})
    op.create_index("ix_hypotheses_confidence", "hypotheses", ["confidence_score"])
    op.create_index("ix_agent_tasks_status_priority", "agent_tasks", ["status", "priority"])


def downgrade() -> None:
    # Drop tables in reverse order
    op.drop_table("ingestion_jobs")
    op.drop_table("agent_tasks")
    op.drop_table("simulations")
    op.drop_table("evidence_references")
    op.drop_table("hypotheses")
    op.drop_table("evidence")
    op.drop_table("projects")
    op.drop_table("users")

    # Drop enum types
    op.execute("DROP TYPE IF EXISTS ingestion_source")
    op.execute("DROP TYPE IF EXISTS ingestion_job_status")
    op.execute("DROP TYPE IF EXISTS agent_task_type")
    op.execute("DROP TYPE IF EXISTS agent_task_status")
    op.execute("DROP TYPE IF EXISTS simulation_type")
    op.execute("DROP TYPE IF EXISTS simulation_status")
    op.execute("DROP TYPE IF EXISTS evidence_source")
    op.execute("DROP TYPE IF EXISTS hypothesis_status")
    op.execute("DROP TYPE IF EXISTS project_status")
    op.execute("DROP TYPE IF EXISTS user_role")
