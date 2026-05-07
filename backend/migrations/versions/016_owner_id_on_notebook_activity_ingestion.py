"""add owner_id to notebook_pages, activities, ingestion_jobs

Revision ID: 016_owner_id_on_notebook_activity_ingestion
Revises: 015_owner_id_on_sessions_and_citations
Create Date: 2026-05-06

Closes the next batch of tenant-isolation gaps. NotebookPage,
Activity, and IngestionJob carry no project_id and no owner column,
so prior to this migration any signed-in user could read / mutate
every other user's notebook pages, activity timeline, and ingestion
job state.

Strategy:
  1. Add `owner_id UUID` (FK users.id ON DELETE CASCADE) — nullable
     for now so the migration is reversible against existing rows.
  2. No project-FK to backfill from; rows stay NULL until the
     operator reassigns. For the closed-beta dataset (a few users)
     this is expected to be a small number of orphan rows.
  3. Add an index on owner_id so the new tenant filters in the
     routers don't full-scan.
  4. Routers (notebook.py, activities.py, ingestion.py) filter
     `owner_id == current_user.id` on every R/U/D and refuse INSERT
     without owner_id — shipped in this commit.
  5. A follow-up migration once the tables are fully populated will
     ALTER the column to NOT NULL.
"""

import sqlalchemy as sa
from alembic import op

revision = "016_owner_id_on_notebook_activity_ingestion"
down_revision = "015_owner_id_on_sessions_and_citations"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for table in ("notebook_pages", "activities", "ingestion_jobs"):
        op.add_column(
            table,
            sa.Column(
                "owner_id",
                sa.dialects.postgresql.UUID(as_uuid=True),
                sa.ForeignKey("users.id", ondelete="CASCADE"),
                nullable=True,
            ),
        )
        op.create_index(
            f"ix_{table}_owner_id",
            table,
            ["owner_id"],
        )


def downgrade() -> None:
    for table in ("ingestion_jobs", "activities", "notebook_pages"):
        op.drop_index(f"ix_{table}_owner_id", table)
        op.drop_column(table, "owner_id")
