"""add email_sends table — outbound email dedup + audit

Single row per outbound email. Lets the dunning cron (and any other
scheduled-send service) idempotently fire a cadence without
double-emailing a user when the cron retries or the queue replays.

Schema:
  • id            UUID PK
  • user_id       FK → users.id (CASCADE)
  • template_key  TEXT — e.g. "dunning.day_3" / "dunning.day_7" /
                   "trial.expiring_3d" / "trial.expired" — the
                   campaign + cadence step.
  • dedup_key     TEXT — caller-supplied uniqueness token. The
                   dunning cron uses `<user_id>:<template_key>:<lapse_date>`
                   so retries within the same lapse don't double-send.
                   (UNIQUE constraint enforces.)
  • sent_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
  • driver        TEXT — "log" | "ses" | "smtp" (which email_service
                   driver dispatched)
  • ok            BOOLEAN NOT NULL — True if driver returned True;
                   False on send-failure (logged for retry)

Idempotence: CREATE TABLE IF NOT EXISTS, CREATE UNIQUE INDEX IF NOT
EXISTS on dedup_key. Re-runnable.

Revision ID: 031_email_sends_dedup
Revises: 030_subscription_transitions
Create Date: 2026-05-10
"""
from __future__ import annotations

from alembic import op


revision = "031_email_sends_dedup"
down_revision = "030_subscription_transitions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS email_sends (
            id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id      UUID NULL REFERENCES users(id) ON DELETE CASCADE,
            template_key TEXT NOT NULL,
            dedup_key    TEXT NOT NULL,
            sent_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            driver       TEXT NOT NULL,
            ok           BOOLEAN NOT NULL
        )
        """
    )
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS ix_email_sends_dedup_key "
        "ON email_sends (dedup_key)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_email_sends_user_template "
        "ON email_sends (user_id, template_key, sent_at DESC)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_email_sends_user_template")
    op.execute("DROP INDEX IF EXISTS ix_email_sends_dedup_key")
    op.execute("DROP TABLE IF EXISTS email_sends")
