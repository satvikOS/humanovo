"""drop NOT NULL on legacy hypotheses columns the ORM never populates

Revision ID: 043_hypotheses_drop_legacy_notnull
Revises: 042_status_enum_values
Create Date: 2026-05-17

`POST /api/v1/hypotheses` 500s. Migration 001 created `hypotheses`
with `title` and `description` NOT NULL; the ORM `Hypothesis` model
later moved to `statement` / `rationale` and stopped populating the
legacy columns, so an ORM INSERT omits them and the migration-built
production table rejects the row with a NOT NULL violation.

Same drift class as migration 039 for `evidence` — CI misses it
because the test DB is built from ORM metadata, not the migration
chain.

Drops NOT NULL on every `hypotheses` column except the PK and the
server-default timestamps. The ORM still supplies values for every
column it actually inserts (statement, status, scores, tags, ...);
dropping NOT NULL there is harmless, and it clears the genuinely-unset
legacy columns (`title`, `description`, ...).
"""

from alembic import op

revision = "043_hypotheses_drop_legacy_notnull"
down_revision = "042_status_enum_values"
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
                WHERE table_name = 'hypotheses'
                  AND is_nullable = 'NO'
                  AND column_name NOT IN ('id', 'created_at', 'updated_at')
            LOOP
                EXECUTE format(
                    'ALTER TABLE hypotheses ALTER COLUMN %I DROP NOT NULL',
                    col.column_name
                );
            END LOOP;
        END $$;
        """
    )


def downgrade() -> None:
    # No-op — re-imposing NOT NULL would break ORM inserts again.
    pass
