"""add subscription_transitions table — Stripe state change audit

Every time a Stripe subscription state changes (trialing → active,
active → past_due, past_due → canceled, etc.) the webhook handler
appends one row here. Two consumers:

  1. Billing dashboard — "user X went past_due on date Y; the
     downgrade fired 7 days later" — without this audit, the
     desktop UI would have to reconstruct the timeline from raw
     webhook events.

  2. Dunning + retention — the cron-based dunning service queries
     for users whose latest transition is `past_due` and joins
     against transition_at to decide which dunning email cadence
     (3-day / 7-day / 14-day) to fire.

Schema:
  • id             UUID PK
  • user_id        FK → users.id (CASCADE)
  • stripe_subscription_id  TEXT — copied here for redundancy when
                            the user's row gets nulled on hard-delete
  • from_status    TEXT NULL (NULL = first transition, e.g. on
                              subscription creation)
  • to_status      TEXT NOT NULL
  • from_tier      TEXT NULL
  • to_tier        TEXT NOT NULL
  • transition_at  TIMESTAMP WITH TIME ZONE NOT NULL
  • stripe_event_id TEXT — the Stripe event_id that drove this
                          (cross-reference for forensics)
  • metadata       JSONB NULL — webhook-specific extras
                              (cancel_at_period_end, etc.)

Idempotence: CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS.

Revision ID: 030_subscription_transitions
Revises: 029_telemetry_tables
Create Date: 2026-05-10
"""
from __future__ import annotations

from alembic import op


revision = "030_subscription_transitions"
down_revision = "029_telemetry_tables"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS subscription_transitions (
            id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id                 UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            stripe_subscription_id  TEXT NULL,
            from_status             TEXT NULL,
            to_status               TEXT NOT NULL,
            from_tier               TEXT NULL,
            to_tier                 TEXT NOT NULL,
            transition_at           TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            stripe_event_id         TEXT NULL,
            metadata                JSONB NULL
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_subscription_transitions_user_id "
        "ON subscription_transitions (user_id, transition_at DESC)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_subscription_transitions_status_at "
        "ON subscription_transitions (to_status, transition_at DESC)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_subscription_transitions_status_at")
    op.execute("DROP INDEX IF EXISTS ix_subscription_transitions_user_id")
    op.execute("DROP TABLE IF EXISTS subscription_transitions")
