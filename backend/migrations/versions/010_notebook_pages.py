"""add notebook_pages table

Revision ID: 010_notebook_pages
Revises: 009_audit_records
Create Date: 2026-04-21

The NotebookPage ORM model existed since the first import-cycle commit
but no migration created its backing table — the /api/v1/notebook/pages
endpoint returns 500 on a fresh DB. Add it here so the page list query
succeeds.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "010_notebook_pages"
down_revision = "009_audit_records"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "notebook_pages",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("title", sa.String(500), nullable=False, server_default="Untitled Page"),
        sa.Column("content", sa.Text(), nullable=False, server_default=""),
        sa.Column(
            "content_type",
            sa.Enum("markdown", "rich_text", "canvas", name="notebook_content_type"),
            nullable=False,
            server_default="markdown",
        ),
        sa.Column("tags", postgresql.ARRAY(sa.String()), nullable=False, server_default="{}"),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("versions", postgresql.JSONB(), nullable=False, server_default="[]"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
    )
    op.create_index("ix_notebook_pages_updated_at", "notebook_pages", ["updated_at"])


def downgrade() -> None:
    op.drop_index("ix_notebook_pages_updated_at", table_name="notebook_pages")
    op.drop_table("notebook_pages")
    op.execute("DROP TYPE IF EXISTS notebook_content_type")
