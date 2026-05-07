"""add owner_id to discovery_sessions and citations

Revision ID: 015_owner_id_on_sessions_and_citations
Revises: 014_user_pricing_tier
Create Date: 2026-05-06

Closes a tenant-isolation hole: DiscoverySession and Citation both
carry a nullable `project_id` and no other ownership column, so
prior to this migration any signed-in user could read / mutate
every other user's discovery sessions and citation library.

Strategy:
  1. Add `owner_id UUID` (FK users.id ON DELETE CASCADE) — nullable
     for now so the migration is reversible against existing rows.
  2. Backfill from Project.owner_id where project_id is set; rows
     without a project remain NULL (admin sweep can clean them up).
  3. Add an index on owner_id so the new tenant filters in the
     routers don't full-scan.
  4. The routers themselves filter `owner_id == current_user.id` and
     refuse INSERT without owner_id — both shipped in this commit.
  5. A follow-up migration once the tables are fully populated will
     ALTER the column to NOT NULL.

For the closed-beta dataset (a few users), the orphan-NULL count
is expected to be near zero. For production, the operator runs a
manual reassign / delete sweep before tightening to NOT NULL.
"""

import sqlalchemy as sa
from alembic import op

revision = "015_owner_id_on_sessions_and_citations"
down_revision = "014_user_pricing_tier"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for table in ("discovery_sessions", "citations", "citation_folders"):
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
        # Backfill from the parent project's owner where project_id is
        # populated. Rows without a project_id are left NULL — they're
        # effectively orphan rows from the pre-tenant era and the
        # operator decides whether to reassign or drop them.
        op.execute(
            f"""
            UPDATE {table} t
            SET owner_id = p.owner_id
            FROM projects p
            WHERE t.project_id = p.id
              AND t.owner_id IS NULL
            """
        )


def downgrade() -> None:
    for table in ("citation_folders", "citations", "discovery_sessions"):
        op.drop_index(f"ix_{table}_owner_id", table)
        op.drop_column(table, "owner_id")
