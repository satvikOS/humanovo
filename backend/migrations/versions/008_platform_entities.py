"""Add platform entity tables

Creates tables for clinical trials, biobank, IRB, compliance, consent,
ML models, imaging, manuscripts, datasets, knowledge graph,
collaboration, audit log, and billing budgets.

Revision ID: 008_platform_entities
Revises: 007_billing_and_usage
Create Date: 2026-03-19
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers
revision: str = "008_platform_entities"
down_revision: Union[str, None] = "007_billing_and_usage"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # -----------------------------------------------------------------------
    # Clinical Trials
    # -----------------------------------------------------------------------
    op.create_table(
        "clinical_trials",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("protocol_number", sa.String(), unique=True, nullable=False),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("phase", sa.String(50), nullable=True),
        sa.Column("status", sa.String(50), default="planning", nullable=False),
        sa.Column("pi", sa.String(255), nullable=True),
        sa.Column("sponsor", sa.String(255), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("start_date", sa.String(50), nullable=True),
        sa.Column("estimated_end", sa.String(50), nullable=True),
        sa.Column("target_enrollment", sa.Integer(), default=0, nullable=False),
        sa.Column("current_enrollment", sa.Integer(), default=0, nullable=False),
        sa.Column("arms", postgresql.JSONB(), server_default="[]", nullable=False),
        sa.Column("budget", postgresql.JSONB(), server_default="{}", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        "trial_subjects",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("trial_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("clinical_trials.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("subject_number", sa.String(50), nullable=False),
        sa.Column("display_name", sa.String(255), nullable=True),
        sa.Column("age", sa.Integer(), nullable=True),
        sa.Column("sex", sa.String(10), nullable=True),
        sa.Column("arm", sa.String(100), nullable=True),
        sa.Column("status", sa.String(50), default="active", nullable=False),
        sa.Column("enrolled_date", sa.String(50), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        "trial_documents",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("trial_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("clinical_trials.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("document_type", sa.String(50), nullable=False),
        sa.Column("name", sa.String(500), nullable=False),
        sa.Column("status", sa.String(50), default="pending", nullable=False),
        sa.Column("version", sa.String(50), default="1.0", nullable=False),
        sa.Column("uploaded_by", sa.String(255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    # -----------------------------------------------------------------------
    # Biobank
    # -----------------------------------------------------------------------
    op.create_table(
        "storage_locations",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("temperature", sa.String(50), nullable=True),
        sa.Column("type", sa.String(50), nullable=True),
        sa.Column("capacity", sa.Integer(), default=500, nullable=False),
        sa.Column("used", sa.Integer(), default=0, nullable=False),
        sa.Column("racks", postgresql.JSONB(), server_default="[]", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        "biobank_samples",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("barcode", sa.String(50), unique=True, nullable=False),
        sa.Column("sample_type", sa.String(50), nullable=False),
        sa.Column("status", sa.String(50), default="available", nullable=False),
        sa.Column("project", sa.String(255), nullable=True),
        sa.Column("tissue_type", sa.String(255), nullable=True),
        sa.Column("patient_id", sa.String(100), nullable=True),
        sa.Column("collection_date", sa.String(50), nullable=True),
        sa.Column("storage_location_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("storage_locations.id", ondelete="SET NULL"), nullable=True, index=True),
        sa.Column("storage_details", postgresql.JSONB(), server_default="{}", nullable=False),
        sa.Column("quantity", sa.String(100), nullable=True),
        sa.Column("quality_score", sa.Float(), default=1.0, nullable=False),
        sa.Column("chain_of_custody", postgresql.JSONB(), server_default="[]", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    # -----------------------------------------------------------------------
    # IRB / Compliance / Consent
    # -----------------------------------------------------------------------
    op.create_table(
        "irb_submissions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("protocol_title", sa.String(500), nullable=False),
        sa.Column("irb_number", sa.String(100), unique=True, nullable=False),
        sa.Column("status", sa.String(50), default="pending", nullable=False),
        sa.Column("submission_date", sa.String(50), nullable=True),
        sa.Column("approval_date", sa.String(50), nullable=True),
        sa.Column("expiration_date", sa.String(50), nullable=True),
        sa.Column("pi", sa.String(255), nullable=True),
        sa.Column("risk_level", sa.String(100), nullable=True),
        sa.Column("review_type", sa.String(100), nullable=True),
        sa.Column("history", postgresql.JSONB(), server_default="[]", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        "data_use_agreements",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("agreement_type", sa.String(50), nullable=False),
        sa.Column("status", sa.String(50), default="draft", nullable=False),
        sa.Column("party", sa.String(500), nullable=True),
        sa.Column("start_date", sa.String(50), nullable=True),
        sa.Column("end_date", sa.String(50), nullable=True),
        sa.Column("data_types", postgresql.JSONB(), server_default="[]", nullable=False),
        sa.Column("restrictions", postgresql.JSONB(), server_default="[]", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        "consent_forms",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("version", sa.String(50), nullable=True),
        sa.Column("status", sa.String(50), default="draft", nullable=False),
        sa.Column("language", sa.String(100), default="English", nullable=False),
        sa.Column("irb_approved", sa.Boolean(), default=False, nullable=False),
        sa.Column("versions", postgresql.JSONB(), server_default="[]", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        "compliance_checklists",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("framework", sa.String(100), nullable=False),
        sa.Column("items", postgresql.JSONB(), server_default="[]", nullable=False),
        sa.Column("completion_pct", sa.Integer(), default=0, nullable=False),
        sa.Column("last_reviewed", sa.String(50), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    # -----------------------------------------------------------------------
    # ML Models
    # -----------------------------------------------------------------------
    op.create_table(
        "ml_models",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(500), nullable=False),
        sa.Column("model_type", sa.String(100), nullable=True),
        sa.Column("status", sa.String(50), default="draft", nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("version", sa.String(50), default="1.0", nullable=False),
        sa.Column("framework", sa.String(100), nullable=True),
        sa.Column("hyperparameters", postgresql.JSONB(), server_default="{}", nullable=False),
        sa.Column("features", postgresql.JSONB(), server_default="[]", nullable=False),
        sa.Column("target", sa.String(255), nullable=True),
        sa.Column("metrics", postgresql.JSONB(), server_default="{}", nullable=False),
        sa.Column("training_history", postgresql.JSONB(), server_default="[]", nullable=False),
        sa.Column("feature_importance", postgresql.JSONB(), server_default="[]", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    # -----------------------------------------------------------------------
    # Imaging
    # -----------------------------------------------------------------------
    op.create_table(
        "imaging_studies",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("modality", sa.String(100), nullable=True),
        sa.Column("body_part", sa.String(255), nullable=True),
        sa.Column("findings", sa.Text(), nullable=True),
        sa.Column("status", sa.String(50), default="pending", nullable=False),
        sa.Column("patient_id", sa.String(100), nullable=True),
        sa.Column("annotations", postgresql.JSONB(), server_default="[]", nullable=False),
        sa.Column("ai_analysis", postgresql.JSONB(), nullable=True),
        sa.Column("width", sa.Integer(), default=512, nullable=False),
        sa.Column("height", sa.Integer(), default=512, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    # -----------------------------------------------------------------------
    # Manuscripts
    # -----------------------------------------------------------------------
    op.create_table(
        "manuscripts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("status", sa.String(50), default="draft", nullable=False),
        sa.Column("journal_target", sa.String(255), nullable=True),
        sa.Column("sections", postgresql.JSONB(), server_default="{}", nullable=False),
        sa.Column("authors", postgresql.JSONB(), server_default="[]", nullable=False),
        sa.Column("keywords", postgresql.JSONB(), server_default="[]", nullable=False),
        sa.Column("submission_history", postgresql.JSONB(), server_default="[]", nullable=False),
        sa.Column("word_count", sa.Integer(), default=0, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    # -----------------------------------------------------------------------
    # Research Datasets
    # -----------------------------------------------------------------------
    op.create_table(
        "research_datasets",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(500), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("format", sa.String(50), default="csv", nullable=False),
        sa.Column("columns", postgresql.JSONB(), server_default="[]", nullable=False),
        sa.Column("rows", postgresql.JSONB(), server_default="[]", nullable=False),
        sa.Column("row_count", sa.Integer(), default=0, nullable=False),
        sa.Column("tags", postgresql.JSONB(), server_default="[]", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    # -----------------------------------------------------------------------
    # Knowledge Graph
    # -----------------------------------------------------------------------
    op.create_table(
        "knowledge_graph_nodes",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(500), nullable=False),
        sa.Column("type", sa.String(100), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("properties", postgresql.JSONB(), server_default="{}", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        "knowledge_graph_edges",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("source_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("knowledge_graph_nodes.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("target_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("knowledge_graph_nodes.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("source_name", sa.String(500), nullable=True),
        sa.Column("target_name", sa.String(500), nullable=True),
        sa.Column("relationship", sa.String(255), nullable=False),
        sa.Column("strength", sa.Float(), default=0.5, nullable=False),
        sa.Column("evidence", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    # -----------------------------------------------------------------------
    # Collaboration
    # -----------------------------------------------------------------------
    op.create_table(
        "collaboration_comments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("entity_type", sa.String(100), nullable=False),
        sa.Column("entity_id", sa.String(100), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("user_id", sa.String(100), nullable=False),
        sa.Column("user_name", sa.String(255), nullable=True),
        sa.Column("parent_id", sa.String(100), nullable=True),
        sa.Column("edited", sa.Boolean(), default=False, nullable=False),
        sa.Column("reactions", postgresql.JSONB(), server_default="{}", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        "project_shares",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", sa.String(100), nullable=False),
        sa.Column("user_id", sa.String(100), nullable=False),
        sa.Column("user_name", sa.String(255), nullable=True),
        sa.Column("permission", sa.String(50), default="viewer", nullable=False),
        sa.Column("status", sa.String(50), default="pending", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        "collaboration_notifications",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", sa.String(100), nullable=False),
        sa.Column("type", sa.String(100), nullable=False),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("message", sa.Text(), nullable=True),
        sa.Column("read", sa.Boolean(), default=False, nullable=False),
        sa.Column("entity_type", sa.String(100), nullable=True),
        sa.Column("entity_id", sa.String(100), nullable=True),
        sa.Column("actor_name", sa.String(255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    # -----------------------------------------------------------------------
    # Audit Log
    # -----------------------------------------------------------------------
    op.create_table(
        "audit_log_entries",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("action", sa.String(100), nullable=False),
        sa.Column("entity_type", sa.String(100), nullable=False),
        sa.Column("entity_id", sa.String(100), nullable=False),
        sa.Column("user_id", sa.String(100), nullable=False),
        sa.Column("user_name", sa.String(255), nullable=True),
        sa.Column("details", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    # -----------------------------------------------------------------------
    # Billing
    # -----------------------------------------------------------------------
    op.create_table(
        "billing_budgets",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("scope", sa.String(50), nullable=False),
        sa.Column("project_id", sa.String(100), nullable=True),
        sa.Column("monthly_budget_cents", sa.Integer(), nullable=False),
        sa.Column("alert_threshold_pct", sa.Integer(), default=80, nullable=False),
        sa.Column("hard_limit", sa.Boolean(), default=False, nullable=False),
        sa.Column("current_month_spend_cents", sa.Integer(), default=0, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        "billing_notifications",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("type", sa.String(100), nullable=False),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("message", sa.Text(), nullable=True),
        sa.Column("read", sa.Boolean(), default=False, nullable=False),
        sa.Column("budget_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("billing_budgets.id", ondelete="SET NULL"), nullable=True, index=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    # -----------------------------------------------------------------------
    # Saved Analyses
    # -----------------------------------------------------------------------
    op.create_table(
        "saved_analyses",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("analysis_type", sa.String(100), nullable=False),
        sa.Column("input_data", postgresql.JSONB(), server_default="{}", nullable=False),
        sa.Column("results", postgresql.JSONB(), server_default="{}", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    # -----------------------------------------------------------------------
    # Useful indexes
    # -----------------------------------------------------------------------
    op.create_index("ix_clinical_trials_status", "clinical_trials", ["status"])
    op.create_index("ix_biobank_samples_barcode", "biobank_samples", ["barcode"])
    op.create_index("ix_biobank_samples_status", "biobank_samples", ["status"])
    op.create_index("ix_irb_submissions_status", "irb_submissions", ["status"])
    op.create_index("ix_audit_log_entries_entity", "audit_log_entries", ["entity_type", "entity_id"])
    op.create_index("ix_audit_log_entries_user", "audit_log_entries", ["user_id"])
    op.create_index("ix_collaboration_comments_entity", "collaboration_comments", ["entity_type", "entity_id"])
    op.create_index("ix_collaboration_notifications_user", "collaboration_notifications", ["user_id"])
    op.create_index("ix_knowledge_graph_nodes_type", "knowledge_graph_nodes", ["type"])


def downgrade() -> None:
    # Drop indexes
    op.drop_index("ix_knowledge_graph_nodes_type", table_name="knowledge_graph_nodes")
    op.drop_index("ix_collaboration_notifications_user", table_name="collaboration_notifications")
    op.drop_index("ix_collaboration_comments_entity", table_name="collaboration_comments")
    op.drop_index("ix_audit_log_entries_user", table_name="audit_log_entries")
    op.drop_index("ix_audit_log_entries_entity", table_name="audit_log_entries")
    op.drop_index("ix_irb_submissions_status", table_name="irb_submissions")
    op.drop_index("ix_biobank_samples_status", table_name="biobank_samples")
    op.drop_index("ix_biobank_samples_barcode", table_name="biobank_samples")
    op.drop_index("ix_clinical_trials_status", table_name="clinical_trials")

    # Drop tables in reverse dependency order
    op.drop_table("saved_analyses")
    op.drop_table("billing_notifications")
    op.drop_table("billing_budgets")
    op.drop_table("audit_log_entries")
    op.drop_table("collaboration_notifications")
    op.drop_table("project_shares")
    op.drop_table("collaboration_comments")
    op.drop_table("knowledge_graph_edges")
    op.drop_table("knowledge_graph_nodes")
    op.drop_table("research_datasets")
    op.drop_table("manuscripts")
    op.drop_table("imaging_studies")
    op.drop_table("ml_models")
    op.drop_table("compliance_checklists")
    op.drop_table("consent_forms")
    op.drop_table("data_use_agreements")
    op.drop_table("irb_submissions")
    op.drop_table("biobank_samples")
    op.drop_table("storage_locations")
    op.drop_table("trial_documents")
    op.drop_table("trial_subjects")
    op.drop_table("clinical_trials")
