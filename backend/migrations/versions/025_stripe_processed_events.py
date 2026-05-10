"""add stripe_processed_events table

Cross-process Stripe webhook idempotency. Today's billing endpoint
uses an in-process LRU (`_RECENT_EVENT_IDS`) which works fine for a
single-worker deployment but breaks under horizontal scale: worker A
sees event_id evt_X first, processes it, returns 200. Stripe doesn't
retry. But on the NEXT delivery (Stripe re-delivering for a different
reason), the load balancer routes to worker B which has an empty LRU
and re-applies the event — risking double-charge if the underlying
handler ever loses idempotency.

Persistent table backed by Postgres unique index gives true
cross-worker dedup. Insert with ON CONFLICT DO NOTHING; the row is
present iff this event_id has been seen before. Records the event
type + processed_at timestamp so the reconciliation script
(scripts/reconcile_stripe_billing.py, follow-on commit) can detect
events Stripe sent us that we never recorded — symptoms of either
webhook delivery failures or signature-verification false negatives.

Retention: 90 days. A nightly cron deletes rows older than that
(Stripe doesn't retry past 3 days; 90 gives a comfortable forensic
window for "did we process this?" support tickets).

Idempotence: CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS.

Revision ID: 025_stripe_processed_events
Revises: 024_user_soft_delete
Create Date: 2026-05-10
"""
from __future__ import annotations

from alembic import op


revision = "025_stripe_processed_events"
down_revision = "024_user_soft_delete"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS stripe_processed_events (
            event_id     TEXT PRIMARY KEY,
            event_type   TEXT NOT NULL,
            processed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            -- Stripe's `created` field on the event itself, useful for
            -- reconciling against Stripe's event log.
            stripe_created_at TIMESTAMP WITH TIME ZONE NULL,
            -- The customer_id on the event payload, when extractable;
            -- speeds up support queries ("what events did this customer
            -- have last week?").
            customer_id  TEXT NULL
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_stripe_processed_events_processed_at "
        "ON stripe_processed_events (processed_at DESC)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_stripe_processed_events_customer_id "
        "ON stripe_processed_events (customer_id) "
        "WHERE customer_id IS NOT NULL"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_stripe_processed_events_customer_id")
    op.execute("DROP INDEX IF EXISTS ix_stripe_processed_events_processed_at")
    op.execute("DROP TABLE IF EXISTS stripe_processed_events")
