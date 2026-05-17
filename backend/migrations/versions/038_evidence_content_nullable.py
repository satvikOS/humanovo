"""drop the legacy NOT NULL on evidence.content

Revision ID: 038_evidence_content_nullable
Revises: 037_activities_schema_reconcile
Create Date: 2026-05-17

An early migration created `evidence` with a `content` column marked
NOT NULL. The ORM `Evidence` model (app/models/evidence.py) since moved
to `title` / `abstract` / `full_text` / `snippet` and never declared
`content`, so every ORM INSERT omits it and the migration-built
production table rejects the row with a NOT NULL violation.

CI never caught this because the test database is built from the ORM
metadata (`create_all`), where `content` simply doesn't exist — the
drift only bites a migration-built database (same class of bug as
migration 037 for `activities`).

Dropping the NOT NULL lets ORM-driven inserts succeed; `content` stays
as a nullable legacy column rather than being dropped, so any existing
rows / external readers are undisturbed.

Guarded by an information_schema check so it is a safe no-op when the
column was never created.
"""

from alembic import op

revision = "038_evidence_content_nullable"
down_revision = "037_activities_schema_reconcile"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'evidence' AND column_name = 'content'
            ) THEN
                ALTER TABLE evidence ALTER COLUMN content DROP NOT NULL;
            END IF;
        END $$;
        """
    )


def downgrade() -> None:
    # No-op — re-imposing NOT NULL would break ORM inserts again.
    pass
