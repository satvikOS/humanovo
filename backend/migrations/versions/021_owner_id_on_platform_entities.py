"""add owner_id to platform-shared models

Closes the tenant-isolation gap documented in
docs/planning/TENANT_ISOLATION_GAP.md. The 9 platform-shared
clinical / research models authenticated the caller via
AUTH_REQUIRED but did not check row ownership, allowing
authenticated cross-tenant access (read or mutate). This migration
adds the column; the endpoint rewiring in the same commit enforces
the filter at the application layer.

Models touched:
  - clinical_trials, trial_subjects, trial_documents
  - biobank_samples, storage_locations
  - irb_submissions, data_use_agreements, consent_forms,
    compliance_checklists
  - ml_models
  - imaging_studies
  - manuscripts
  - research_datasets
  - saved_analyses

Schema choice: owner_id is nullable=True at the schema layer for
two reasons:
  (a) pre-launch the tables may carry test rows we don't want to
      retroactively assign to a fictional user
  (b) the alternative - NOT NULL with a system-user backfill - costs
      a UPDATE pass over every row + a sentinel user that has no
      meaningful semantics.

The application layer enforces the filter on every read/write path:
list endpoints WHERE owner_id = current_user.id, write endpoints
SET owner_id = current_user.id, R/U/D paths use
fetch_owned_directly_or_404. Rows with NULL owner_id are
unreachable from any handler - they exist only as a transitional
state pre-launch and become orphans after first authenticated write.

Idempotence: every ADD COLUMN uses IF NOT EXISTS. Index creation
uses IF NOT EXISTS. Re-runnable after partial application.

Revision ID: 020_owner_id_on_platform_entities
Revises: 019_saved_research_papers
Create Date: 2026-05-08
"""
from __future__ import annotations

from alembic import op

revision = "020_owner_id_on_platform_entities"
down_revision = "020_project_documents"
branch_labels = None
depends_on = None


# Tables that gain owner_id directly.
DIRECT_OWNER_TABLES = (
    "clinical_trials",
    "biobank_samples",
    "storage_locations",
    "irb_submissions",
    "data_use_agreements",
    "consent_forms",
    "compliance_checklists",
    "ml_models",
    "imaging_studies",
    "manuscripts",
    "research_datasets",
    "saved_analyses",
)

# Cascading children inherit ownership through their parent FK; no
# direct column needed because the parent's owner_id is the source
# of truth (a TrialSubject is "owned" by whoever owns its
# ClinicalTrial). Listed here for documentation; if we later need a
# direct join we'll add the column then.
CASCADE_TABLES = (
    "trial_subjects",  # → clinical_trials
    "trial_documents",  # → clinical_trials
)


def upgrade() -> None:
    for tbl in DIRECT_OWNER_TABLES:
        op.execute(
            f"ALTER TABLE {tbl} ADD COLUMN IF NOT EXISTS owner_id UUID"
        )
        # FK to users(id). Documented as ON DELETE SET NULL so a user
        # deletion doesn't cascade-delete the row (the data may have
        # operational value to other admins); the row becomes orphan
        # and re-claimable.
        op.execute(
            f"DO $$ BEGIN "
            f"IF NOT EXISTS ("
            f"  SELECT 1 FROM pg_constraint "
            f"  WHERE conname = 'fk_{tbl}_owner_id_users'"
            f") THEN "
            f"ALTER TABLE {tbl} "
            f"ADD CONSTRAINT fk_{tbl}_owner_id_users "
            f"FOREIGN KEY (owner_id) REFERENCES users(id) "
            f"ON DELETE SET NULL; "
            f"END IF; END $$"
        )
        op.execute(
            f"CREATE INDEX IF NOT EXISTS ix_{tbl}_owner_id "
            f"ON {tbl} (owner_id)"
        )


def downgrade() -> None:
    for tbl in DIRECT_OWNER_TABLES:
        op.execute(f"DROP INDEX IF EXISTS ix_{tbl}_owner_id")
        op.execute(
            f"ALTER TABLE {tbl} "
            f"DROP CONSTRAINT IF EXISTS fk_{tbl}_owner_id_users"
        )
        op.execute(f"ALTER TABLE {tbl} DROP COLUMN IF EXISTS owner_id")
