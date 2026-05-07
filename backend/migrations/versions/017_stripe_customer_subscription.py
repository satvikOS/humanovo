"""add Stripe customer/subscription columns to users

Revision ID: 017_stripe_customer_subscription
Revises: 016_owner_id_on_notebook_activity_ingestion
Create Date: 2026-05-06

Wires Stripe state to humanovo's User row so the per-tier monthly cap
(see migration 014_user_pricing_tier + TIER_MONTHLY_CAP_CENTS) can
follow real subscription transitions instead of admin-set defaults.

Columns:
  stripe_customer_id      `cus_...` from stripe.Customer.create. UNIQUE
                          so we never collide a customer with two users.
                          Nullable so trial-tier users with no Stripe
                          presence don't get an empty-string row.
  stripe_subscription_id  `sub_...` of the user's active subscription.
                          NULL when on trial. UPDATE'd on every
                          customer.subscription.{created,updated,deleted}
                          webhook so the field is the source of truth.
  stripe_subscription_status  `active` / `trialing` / `past_due` /
                          `canceled` / `unpaid` / etc. Surfaces in the
                          UI's billing tab so a user with a failed
                          payment sees the warning before their next
                          discovery run hits the cap-blocked path.

The mapping `stripe_subscription_id - UserTier` is computed in
app.services.stripe_service via the price ID on the subscription's
first item (env-configured per tier - STRIPE_PRICE_RESEARCHER_MONTHLY,
STRIPE_PRICE_LAB_MONTHLY, STRIPE_PRICE_INSTITUTION_MONTHLY).

Idempotence: every ALTER uses ADD/DROP COLUMN IF [NOT] EXISTS so the
migration is safely re-runnable after partial application.
"""

from alembic import op

revision = "017_stripe_customer_subscription"
down_revision = "016_owner_id_on_notebook_activity_ingestion"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id "
        "VARCHAR(64)"
    )
    op.execute(
        "DO $$ BEGIN "
        "IF NOT EXISTS (SELECT 1 FROM pg_constraint "
        "WHERE conname = 'users_stripe_customer_id_key') THEN "
        "ALTER TABLE users ADD CONSTRAINT users_stripe_customer_id_key "
        "UNIQUE (stripe_customer_id); "
        "END IF; END $$"
    )
    op.execute(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_subscription_id "
        "VARCHAR(64)"
    )
    op.execute(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS "
        "stripe_subscription_status VARCHAR(32)"
    )
    # Lookups by stripe_subscription_id happen in the webhook handler;
    # add an explicit index since subscription.{updated,deleted} webhooks
    # resolve by it.
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_users_stripe_subscription_id "
        "ON users (stripe_subscription_id)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_users_stripe_subscription_id")
    op.execute(
        "ALTER TABLE users DROP COLUMN IF EXISTS stripe_subscription_status"
    )
    op.execute(
        "ALTER TABLE users DROP COLUMN IF EXISTS stripe_subscription_id"
    )
    op.execute(
        "ALTER TABLE users DROP CONSTRAINT IF EXISTS "
        "users_stripe_customer_id_key"
    )
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS stripe_customer_id")
