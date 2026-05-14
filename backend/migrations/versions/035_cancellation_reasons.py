"""add cancellation_reasons table

Captures the "why are you leaving?" survey from
POST /account/cancel-subscription so the product team can spot
trends (price too high, missing feature, switching to competitor).

Schema:
  • id              UUID PK
  • user_id         FK → users.id (CASCADE)
  • reason_category TEXT — small enum (price | features | bug |
                          churn | other) for chart aggregation
  • reason_text     TEXT NULL — free-text amplification
  • stripe_subscription_id  TEXT NULL — captured for cross-reference
  • cancel_at_period_end    BOOLEAN — what we actually scheduled
                                       with Stripe
  • recorded_at     TIMESTAMP WITH TIME ZONE DEFAULT now()

Idempotence: CREATE TABLE IF NOT EXISTS.

Revision ID: 035_cancellation_reasons
Revises: 034_user_billing_interval
Create Date: 2026-05-10
"""
from __future__ import annotations

from alembic import op


revision = "035_cancellation_reasons"
down_revision = "034_user_billing_interval"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS cancellation_reasons (
            id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id                 UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            reason_category         TEXT NOT NULL,
            reason_text             TEXT NULL,
            stripe_subscription_id  TEXT NULL,
            cancel_at_period_end    BOOLEAN NOT NULL DEFAULT TRUE,
            recorded_at             TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_cancellation_reasons_category "
        "ON cancellation_reasons (reason_category, recorded_at DESC)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_cancellation_reasons_user "
        "ON cancellation_reasons (user_id, recorded_at DESC)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_cancellation_reasons_user")
    op.execute("DROP INDEX IF EXISTS ix_cancellation_reasons_category")
    op.execute("DROP TABLE IF EXISTS cancellation_reasons")
