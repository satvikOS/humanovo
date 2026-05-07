"""add pricing tier to users

Revision ID: 014_user_pricing_tier
Revises: 013_citation_library
Create Date: 2026-05-06

Adds the `tier` column to `users` so the budget enforcer can derive
the per-month spend cap from the user's subscription tier instead of
hardcoded defaults. Cap mapping (USD/month, hard ceiling, enforced
in app.services.budget_enforcer_service):

  trial         capped (trial cap)
  researcher    monthly cap
  lab           monthly cap
  institution   per-contract floor, configurable

The `user_budget_configs.monthly_budget_cents` column from
007_billing_and_usage stays as the per-user OVERRIDE - admins / sales
can grant a Researcher higher headroom on a 1-off basis without
upgrading their tier. When the override is NULL the enforcer falls
back to the tier default; this keeps existing rows working unchanged.

Idempotence: ENUM creation uses checkfirst=True; the column ALTER and
the index CREATE both use IF NOT EXISTS so the migration is safely
re-runnable after partial application.
"""

import sqlalchemy as sa
from alembic import op

revision = "014_user_pricing_tier"
down_revision = "013_citation_library"
branch_labels = None
depends_on = None


TIERS = ("trial", "researcher", "lab", "institution")


def upgrade() -> None:
    # Postgres ENUM for the tier. Created at the schema level so both
    # the User model + queries reference the same type. checkfirst=True
    # is the documented Alembic-idempotent path for enum creation.
    tier_enum = sa.Enum(*TIERS, name="user_tier")
    tier_enum.create(op.get_bind(), checkfirst=True)

    op.execute(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS tier user_tier "
        "NOT NULL DEFAULT 'trial'"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_users_tier ON users (tier)"
    )

    # Backfill a sensible default for existing rows: anyone with role
    # = admin gets institution (no cap interferes with internal work);
    # everyone else stays trial until they upgrade through Stripe.
    op.execute(
        "UPDATE users SET tier = 'institution' WHERE role = 'admin' "
        "AND tier = 'trial'"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_users_tier")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS tier")
    sa.Enum(name="user_tier").drop(op.get_bind(), checkfirst=True)
