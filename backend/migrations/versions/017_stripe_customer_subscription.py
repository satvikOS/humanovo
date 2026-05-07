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

The mapping `stripe_subscription_id → UserTier` is computed in
app.services.stripe_service via the price ID on the subscription's
first item (env-configured per tier — STRIPE_PRICE_RESEARCHER_MONTHLY,
STRIPE_PRICE_LAB_MONTHLY, STRIPE_PRICE_INSTITUTION_MONTHLY).
"""

from alembic import op
import sqlalchemy as sa


revision = "017_stripe_customer_subscription"
down_revision = "016_owner_id_on_notebook_activity_ingestion"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("stripe_customer_id", sa.String(64), nullable=True, unique=True),
    )
    op.add_column(
        "users",
        sa.Column("stripe_subscription_id", sa.String(64), nullable=True),
    )
    op.add_column(
        "users",
        sa.Column("stripe_subscription_status", sa.String(32), nullable=True),
    )
    # Lookups by these IDs happen in the webhook handler. The
    # stripe_customer_id index is implicit via the UNIQUE constraint;
    # add an explicit one for stripe_subscription_id since
    # subscription.{updated,deleted} webhooks resolve by it.
    op.create_index(
        "ix_users_stripe_subscription_id",
        "users",
        ["stripe_subscription_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_users_stripe_subscription_id", "users")
    op.drop_column("users", "stripe_subscription_status")
    op.drop_column("users", "stripe_subscription_id")
    op.drop_column("users", "stripe_customer_id")
