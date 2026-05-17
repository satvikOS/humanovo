"""reconcile ingestion_jobs table with the ORM IngestionJob model

Revision ID: 040_ingestion_jobs_reconcile
Revises: 039_evidence_drop_legacy_notnull
Create Date: 2026-05-17

Migration 001 created `ingestion_jobs` with an early column set
(project_id/parameters/total_items/processed_items/results_summary/...).
The ORM `IngestionJob` model (app/models/ingestion_job.py) has since
been rewritten with a different, much larger column set, so
`select(IngestionJob)` references ~two dozen columns the
migration-built table never got — `GET /api/v1/ingestion/jobs`,
`/recurring` and `/queue/stats` all 500.

CI never caught this because the test DB is built from ORM metadata,
not the migration chain (same drift class as migrations 037-039).

Adds every missing model column (nullable — the ORM enforces its own
NOT NULL on insert; an empty production table makes nullable safe),
and converts the legacy `failed_items` column from INTEGER to JSONB
(the model redefined it as a JSONB list of failed-item records — a
name+type collision that breaks the SELECT result decoding).

All ALTERs are guarded / IF NOT EXISTS — safe to re-run.
"""

from alembic import op

revision = "040_ingestion_jobs_reconcile"
down_revision = "039_evidence_drop_legacy_notnull"
branch_labels = None
depends_on = None

# (name, type) for every column the ORM model declares that migration
# 001 / 016 did not create. All added nullable.
_ADD_COLUMNS = [
    ("name", "VARCHAR(255)"),
    ("description", "TEXT"),
    ("source_config", "JSONB"),
    ("filters", "JSONB"),
    ("date_from", "TIMESTAMPTZ"),
    ("date_to", "TIMESTAMPTZ"),
    ("items_found", "INTEGER DEFAULT 0"),
    ("items_fetched", "INTEGER DEFAULT 0"),
    ("items_processed", "INTEGER DEFAULT 0"),
    ("items_indexed", "INTEGER DEFAULT 0"),
    ("items_skipped", "INTEGER DEFAULT 0"),
    ("items_failed", "INTEGER DEFAULT 0"),
    ("queued_at", "TIMESTAMPTZ"),
    ("timeout_seconds", "INTEGER DEFAULT 3600"),
    ("runtime_seconds", "FLOAT"),
    ("worker_id", "VARCHAR(100)"),
    ("agent_task_id", "UUID"),
    ("error_details", "JSONB"),
    ("is_scheduled", "INTEGER DEFAULT 0"),
    ("schedule_cron", "VARCHAR(100)"),
    ("last_run_at", "TIMESTAMPTZ"),
    ("next_run_at", "TIMESTAMPTZ"),
    ("target_project_id", "UUID"),
    ("auto_process", "INTEGER DEFAULT 1"),
    ("auto_index", "INTEGER DEFAULT 1"),
    ("tags", "VARCHAR[] DEFAULT '{}'"),
]


def upgrade() -> None:
    for name, coltype in _ADD_COLUMNS:
        op.execute(
            f"ALTER TABLE ingestion_jobs "
            f"ADD COLUMN IF NOT EXISTS {name} {coltype}"
        )
    # The model declares `query` nullable; migration 001 made it NOT NULL.
    op.execute(
        "ALTER TABLE ingestion_jobs ALTER COLUMN query DROP NOT NULL"
    )
    # Legacy `failed_items` is INTEGER; the model redefined it as a JSONB
    # list. Convert in place (empty table in prod, so to_jsonb is a
    # no-op on rows). Guarded so a re-run after conversion is a no-op.
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'ingestion_jobs'
                  AND column_name = 'failed_items'
                  AND data_type IN ('integer', 'bigint', 'smallint')
            ) THEN
                ALTER TABLE ingestion_jobs ALTER COLUMN failed_items DROP DEFAULT;
                ALTER TABLE ingestion_jobs ALTER COLUMN failed_items DROP NOT NULL;
                ALTER TABLE ingestion_jobs
                    ALTER COLUMN failed_items TYPE JSONB
                    USING to_jsonb(failed_items);
            END IF;
        END $$;
        """
    )


def downgrade() -> None:
    # No-op — these columns are required by the ORM model.
    pass
