"""add saved_research_papers table

Stores AI-generated research-paper HTML artifacts bound to discovery
hypotheses. Replaces the localStorage `research-papers` key on the
frontend so generated papers survive device/browser swaps.

Revision ID: 019_saved_research_papers
Revises: 018_user_schema_reconcile
Create Date: 2026-05-07
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "019_saved_research_papers"
down_revision = "018_user_schema_reconcile"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "saved_research_papers",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "owner_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "hypothesis_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("hypotheses.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "project_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("projects.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("hypothesis_title", sa.String(length=1024), nullable=False),
        sa.Column("disease", sa.String(length=255), nullable=True),
        sa.Column("filename", sa.String(length=255), nullable=False),
        sa.Column("paper_html", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_saved_research_papers_owner_id",
        "saved_research_papers",
        ["owner_id"],
    )
    op.create_index(
        "ix_saved_research_papers_hypothesis_id",
        "saved_research_papers",
        ["hypothesis_id"],
    )
    op.create_index(
        "ix_saved_research_papers_project_id",
        "saved_research_papers",
        ["project_id"],
    )
    op.create_index(
        "ix_saved_research_papers_owner_project_created",
        "saved_research_papers",
        ["owner_id", "project_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_saved_research_papers_owner_project_created",
        table_name="saved_research_papers",
    )
    op.drop_index(
        "ix_saved_research_papers_project_id",
        table_name="saved_research_papers",
    )
    op.drop_index(
        "ix_saved_research_papers_hypothesis_id",
        table_name="saved_research_papers",
    )
    op.drop_index(
        "ix_saved_research_papers_owner_id",
        table_name="saved_research_papers",
    )
    op.drop_table("saved_research_papers")
