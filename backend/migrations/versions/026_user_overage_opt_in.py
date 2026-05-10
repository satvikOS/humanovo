"""add users.overage_enabled

Per-user opt-in for usage-based-billing overage charging via Stripe
Meter Events. When TRUE + a paying subscription is active, runs that
would have aborted at the tier cap instead complete and bill the
overage. When FALSE (default), the cap is a hard wall (BudgetExceeded).

Default FALSE so a freshly deployed schema doesn't accidentally
enable overage billing for every existing user — operators must
flip per-user via admin endpoint or self-service Settings UI.

Idempotence: ADD COLUMN IF NOT EXISTS.

Revision ID: 026_user_overage_opt_in
Revises: 025_stripe_processed_events
Create Date: 2026-05-10
"""
from __future__ import annotations

from alembic import op


revision = "026_user_overage_opt_in"
down_revision = "025_stripe_processed_events"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE users "
        "ADD COLUMN IF NOT EXISTS overage_enabled "
        "BOOLEAN NOT NULL DEFAULT FALSE"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS overage_enabled")
