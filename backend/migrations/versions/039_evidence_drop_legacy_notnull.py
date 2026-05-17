"""drop NOT NULL on all legacy evidence columns the ORM never populates

Revision ID: 039_evidence_drop_legacy_notnull
Revises: 038_evidence_content_nullable
Create Date: 2026-05-17

Migration 038 fixed `evidence.content`, but the migration-built table
carries further legacy NOT NULL columns (`source`, ...) that the ORM
`Evidence` model never declares, so ORM inserts keep failing one
column at a time.

Rather than chase them individually, this drops NOT NULL on *every*
`evidence` column that is not part of the set the ORM model actually
populates on insert:

  id, title, source_type   — always set by the model
  authors, entities, tags  — model columns with a list default
  created_at, updated_at   — TimestampMixin, filled by server_default

Every other column (legacy or current-but-optional) becomes nullable,
so an ORM-driven INSERT that omits it succeeds. Current optional model
columns (abstract, doi, journal, ...) are already nullable, so the
loop simply skips them — it only touches columns still marked NOT NULL.

CI never caught this: the test DB is built from ORM metadata, where
these legacy columns don't exist (same drift class as migrations 037
and 038).
"""

from alembic import op

revision = "039_evidence_drop_legacy_notnull"
down_revision = "038_evidence_content_nullable"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        DO $$
        DECLARE
            col record;
        BEGIN
            FOR col IN
                SELECT column_name
                FROM information_schema.columns
                WHERE table_name = 'evidence'
                  AND is_nullable = 'NO'
                  AND column_name NOT IN (
                      'id', 'title', 'source_type', 'authors',
                      'entities', 'tags', 'created_at', 'updated_at'
                  )
            LOOP
                EXECUTE format(
                    'ALTER TABLE evidence ALTER COLUMN %I DROP NOT NULL',
                    col.column_name
                );
            END LOOP;
        END $$;
        """
    )


def downgrade() -> None:
    # No-op — re-imposing NOT NULL would break ORM inserts again.
    pass
