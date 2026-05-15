"""add refund_records table

Captures every refund the admin endpoint issues (Stripe Refund.create)
so the team has a reviewable trail outside the Stripe dashboard:
who issued it, against which invoice, why, and whether Stripe
confirmed the refund or failed.

Schema:
  • id                     UUID PK
  • user_id                FK → users.id (CASCADE)  — customer being refunded
  • issued_by_admin_id     FK → users.id (SET NULL) — the admin who hit the
                                                       endpoint (NULL only if the
                                                       admin account was later
                                                       deleted; we keep the row)
  • stripe_invoice_id      TEXT NOT NULL — the invoice being refunded
  • stripe_charge_id       TEXT NULL — captured from the invoice for
                                        cross-reference; refund itself can
                                        be created against either
                                        charge_id or payment_intent
  • stripe_refund_id       TEXT NULL — Stripe's returned refund id;
                                        NULL when status='failed'
  • amount_cents           INTEGER NOT NULL
  • currency               TEXT NOT NULL DEFAULT 'usd'
  • reason                 TEXT NOT NULL — duplicate / fraudulent /
                                            requested_by_customer / other
                                            (matches Stripe's enum + 'other')
  • reason_text            TEXT NULL — free-form amplification
  • status                 TEXT NOT NULL — succeeded / pending / failed
  • error_message          TEXT NULL — only populated when status='failed'
  • created_at             TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()

Indexes:
  • (user_id, created_at DESC) — customer-history lookups
  • (status, created_at DESC) — ops dashboards filtering by failed
  • (stripe_invoice_id)       — dedup + invoice cross-reference

Idempotence: CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.

Revision ID: 036_refund_records
Revises: 035_cancellation_reasons
Create Date: 2026-05-15
"""
from __future__ import annotations

from alembic import op


revision = "036_refund_records"
down_revision = "035_cancellation_reasons"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS refund_records (
            id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            issued_by_admin_id  UUID NULL REFERENCES users(id) ON DELETE SET NULL,
            stripe_invoice_id   TEXT NOT NULL,
            stripe_charge_id    TEXT NULL,
            stripe_refund_id    TEXT NULL,
            amount_cents        INTEGER NOT NULL,
            currency            TEXT NOT NULL DEFAULT 'usd',
            reason              TEXT NOT NULL,
            reason_text         TEXT NULL,
            status              TEXT NOT NULL,
            error_message       TEXT NULL,
            created_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_refund_records_user "
        "ON refund_records (user_id, created_at DESC)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_refund_records_status "
        "ON refund_records (status, created_at DESC)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_refund_records_invoice "
        "ON refund_records (stripe_invoice_id)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_refund_records_invoice")
    op.execute("DROP INDEX IF EXISTS ix_refund_records_status")
    op.execute("DROP INDEX IF EXISTS ix_refund_records_user")
    op.execute("DROP TABLE IF EXISTS refund_records")
