"""add citation library tables

Revision ID: 013_citation_library
Revises: 012_discovery_sessions
Create Date: 2026-04-23

Three tables:
  citations          — personal reference library (distinct from
                       automated evidence ingestions)
  citation_folders   — hierarchical collections (parent_id self-FK)
  citation_highlights — PDF annotations per citation
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "013_citation_library"
down_revision = "012_discovery_sessions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "citations",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("type", sa.String(32), nullable=False, server_default="journal"),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("authors", postgresql.ARRAY(sa.String()), nullable=False, server_default="{}"),
        sa.Column("year", sa.Integer(), nullable=True),
        sa.Column("abstract", sa.Text(), nullable=True),
        sa.Column("journal", sa.String(512), nullable=True),
        sa.Column("volume", sa.String(32), nullable=True),
        sa.Column("issue", sa.String(32), nullable=True),
        sa.Column("pages", sa.String(64), nullable=True),
        sa.Column("publisher", sa.String(256), nullable=True),
        sa.Column("doi", sa.String(256), nullable=True),
        sa.Column("pmid", sa.String(64), nullable=True),
        sa.Column("pmcid", sa.String(64), nullable=True),
        sa.Column("arxiv_id", sa.String(64), nullable=True),
        sa.Column("isbn", sa.String(32), nullable=True),
        sa.Column("url", sa.Text(), nullable=True),
        sa.Column("tags", postgresql.ARRAY(sa.String()), nullable=False, server_default="{}"),
        sa.Column("folders", postgresql.JSONB(), nullable=False, server_default="[]"),
        sa.Column("starred", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("read", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("cite_key", sa.String(128), nullable=True),
        sa.Column("pdf_url", sa.Text(), nullable=True),
        sa.Column("pdf_file_id", sa.String(256), nullable=True),
        sa.Column("csl_json", postgresql.JSONB(), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
    )
    op.create_index("ix_citations_project_id", "citations", ["project_id"])
    op.create_index("ix_citations_doi", "citations", ["doi"])
    op.create_index("ix_citations_pmid", "citations", ["pmid"])
    op.create_index("ix_citations_starred", "citations", ["starred"])
    op.create_index("ix_citations_read", "citations", ["read"])
    op.create_index("ix_citations_updated_at", "citations", ["updated_at"])

    op.create_table(
        "citation_folders",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(256), nullable=False),
        sa.Column("parent_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("color", sa.String(32), nullable=True),
        sa.Column("icon", sa.String(32), nullable=True),
        sa.Column("order_index", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
    )
    op.create_index("ix_citation_folders_parent_id", "citation_folders", ["parent_id"])
    op.create_index("ix_citation_folders_project_id", "citation_folders", ["project_id"])

    op.create_table(
        "citation_highlights",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("citation_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("page", sa.Integer(), nullable=False),
        sa.Column("rect", postgresql.JSONB(), nullable=False, server_default="{}"),
        sa.Column("text", sa.Text(), nullable=True),
        sa.Column("color", sa.String(32), nullable=False, server_default="#C4956A"),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
    )
    op.create_index("ix_citation_highlights_citation_id", "citation_highlights", ["citation_id"])


def downgrade() -> None:
    op.drop_index("ix_citation_highlights_citation_id", table_name="citation_highlights")
    op.drop_table("citation_highlights")
    op.drop_index("ix_citation_folders_project_id", table_name="citation_folders")
    op.drop_index("ix_citation_folders_parent_id", table_name="citation_folders")
    op.drop_table("citation_folders")
    op.drop_index("ix_citations_updated_at", table_name="citations")
    op.drop_index("ix_citations_read", table_name="citations")
    op.drop_index("ix_citations_starred", table_name="citations")
    op.drop_index("ix_citations_pmid", table_name="citations")
    op.drop_index("ix_citations_doi", table_name="citations")
    op.drop_index("ix_citations_project_id", table_name="citations")
    op.drop_table("citations")
