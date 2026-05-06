"""add pricing tier to users

Revision ID: 014_user_pricing_tier
Revises: 013_citation_library
Create Date: 2026-05-06

Adds the `tier` column to `users` so the budget enforcer can derive
the per-month spend cap from the user's subscription tier instead of
hardcoded defaults. Cap mapping (USD/month, hard ceiling, enforced
in app.services.budget_enforcer_service):

  trial         $0.50 lifetime  (~1-2 runs)
  researcher    $4.00/month     (~12 runs at M0, ~26 at M12 cache)
  lab           $40.00/month    (~66 runs at M0, ~148 at M12 cache)
  institution   per-contract floor, configurable

Aligns with the >80% gross-margin model in
docs/planning/AWS_INFRASTRUCTURE_PLAN.md §0.

The `user_budget_configs.monthly_budget_cents` column from
007_billing_and_usage stays as the per-user OVERRIDE — admins / sales
can grant a Researcher higher headroom on a 1-off basis without
upgrading their tier. When the override is NULL the enforcer falls
back to the tier default; this keeps existing rows working unchanged.
"""

from alembic import op
import sqlalchemy as sa


revision = "014_user_pricing_tier"
down_revision = "013_citation_library"
branch_labels = None
depends_on = None


TIERS = ("trial", "researcher", "lab", "institution")


def upgrade() -> None:
    # Postgres ENUM for the tier. Created at the schema level so both
    # the User model + queries reference the same type.
    tier_enum = sa.Enum(*TIERS, name="user_tier")
    tier_enum.create(op.get_bind(), checkfirst=True)

    op.add_column(
        "users",
        sa.Column(
            "tier",
            tier_enum,
            nullable=False,
            server_default="trial",
        ),
    )
    op.create_index("ix_users_tier", "users", ["tier"])

    # Backfill a sensible default for existing rows: anyone with role
    # = admin gets institution (no cap interferes with internal work);
    # everyone else stays trial until they upgrade through Stripe.
    op.execute(
        "UPDATE users SET tier = 'institution' WHERE role = 'admin'"
    )


def downgrade() -> None:
    op.drop_index("ix_users_tier", "users")
    op.drop_column("users", "tier")
    sa.Enum(name="user_tier").drop(op.get_bind(), checkfirst=True)
