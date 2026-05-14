"""add users.billing_interval — monthly | annual

Lets a paying user opt into annual billing for the 17% discount
(industry standard). Default `monthly` so existing rows + new
signups keep current behaviour; the user explicitly opts in via
Settings → Billing → Annual.

Stripe-side: the Customer Portal handles the price-swap UI when
the user toggles. The webhook captures the new price_id and writes
back through `apply_subscription_event` (existing path). This
column is the local source-of-truth used by the pre-flight cost
preview to show the right per-month figure.

Values:
  • 'monthly' — default
  • 'annual'  — flat 17% discount baked into the Stripe price
                catalog

Idempotence: ADD COLUMN IF NOT EXISTS.

Revision ID: 034_user_billing_interval
Revises: 033_promo_codes
Create Date: 2026-05-10
"""
from __future__ import annotations

from alembic import op


revision = "034_user_billing_interval"
down_revision = "033_promo_codes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE users "
        "ADD COLUMN IF NOT EXISTS billing_interval "
        "VARCHAR(16) NOT NULL DEFAULT 'monthly'"
    )
    # Constraint check is a best-effort guard; the application also
    # validates the value before writes.
    op.execute(
        """
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.constraint_column_usage
                WHERE constraint_name = 'users_billing_interval_check'
            ) THEN
                ALTER TABLE users
                ADD CONSTRAINT users_billing_interval_check
                CHECK (billing_interval IN ('monthly', 'annual'));
            END IF;
        END $$
        """
    )


def downgrade() -> None:
    op.execute(
        "ALTER TABLE users DROP CONSTRAINT IF EXISTS users_billing_interval_check"
    )
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS billing_interval")
