"""add project_documents table

Persistent storage for researcher-uploaded project artifacts (PDFs,
datasets, IRB docs, lab notes). Replaces the localStorage
`project-documents` key + IndexedDB blob shards on the frontend so
attachments survive device + browser swaps.

The `content` BYTEA column is fine for v1 (Postgres TOAST handles
big files transparently up to 1 GB per row). A follow-up migration
will mirror content to S3 and drop the column once production
storage is wired (see app.models.project_document for plan).

Revision ID: 020_project_documents
Revises: 019_saved_research_papers
Create Date: 2026-05-07
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "020_project_documents"
down_revision = "019_saved_research_papers"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "project_documents",
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
            "project_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("title", sa.String(length=512), nullable=False),
        sa.Column("doc_type", sa.String(length=64), nullable=False, server_default="Other"),
        sa.Column("authors", sa.String(length=1024), nullable=True),
        sa.Column("document_date", sa.Date(), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "tags",
            postgresql.ARRAY(sa.String()),
            nullable=False,
            server_default="{}",
        ),
        sa.Column("filename", sa.String(length=512), nullable=False),
        sa.Column("file_size", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column(
            "mime_type",
            sa.String(length=255),
            nullable=False,
            server_default="application/octet-stream",
        ),
        sa.Column("content", postgresql.BYTEA(), nullable=True),
        sa.Column(
            "knowledge_base",
            sa.String(length=16),
            nullable=False,
            server_default="private",
        ),
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
        "ix_project_documents_owner_id",
        "project_documents",
        ["owner_id"],
    )
    op.create_index(
        "ix_project_documents_project_id",
        "project_documents",
        ["project_id"],
    )
    op.create_index(
        "ix_project_documents_owner_project_created",
        "project_documents",
        ["owner_id", "project_id", "created_at"],
    )
    op.create_index(
        "ix_project_documents_doc_type",
        "project_documents",
        ["doc_type"],
    )


def downgrade() -> None:
    op.drop_index("ix_project_documents_doc_type", table_name="project_documents")
    op.drop_index("ix_project_documents_owner_project_created", table_name="project_documents")
    op.drop_index("ix_project_documents_project_id", table_name="project_documents")
    op.drop_index("ix_project_documents_owner_id", table_name="project_documents")
    op.drop_table("project_documents")
