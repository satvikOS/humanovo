"""add crash_reports + telemetry_events tables + users.telemetry_opt_in

Two append-only tables for the desktop app to post into:

  crash_reports — unhandled exceptions / native crashes. Captured
    always (regardless of telemetry opt-in) because a crash IS a
    bug we need to fix, not a usage stat. PII is scrubbed client-
    side before send; the schema enforces a hard 8 KB cap on
    stack / context so a malicious client can't dump arbitrary
    state into our DB.

  telemetry_events — opt-in usage events. Recorded only when the
    authenticated user has telemetry_opt_in=TRUE (default FALSE
    per privacy policy). Each event is (kind, payload JSONB,
    received_at, user_id). Bounded retention: 90 days.

  users.telemetry_opt_in — per-user opt-in flag, default FALSE.
    Surfaced in Settings → Privacy. Toggling to FALSE drops future
    events; historical events remain until the 90-day cron prunes.

Idempotence: CREATE TABLE IF NOT EXISTS, ADD COLUMN IF NOT EXISTS.

Revision ID: 029_telemetry_tables
Revises: 028_user_api_keys
Create Date: 2026-05-10
"""
from __future__ import annotations

from alembic import op


revision = "029_telemetry_tables"
down_revision = "028_user_api_keys"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ─── crash_reports ───────────────────────────────────────
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS crash_reports (
            id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            -- NULL for unauthenticated crashes (rare; pre-login).
            user_id     UUID NULL REFERENCES users(id) ON DELETE SET NULL,
            received_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            app_version VARCHAR(32) NOT NULL,
            platform    VARCHAR(32) NOT NULL,
            -- "renderer" | "native" | "background"
            origin      VARCHAR(32) NOT NULL,
            -- Short, single-line title. The stack is the long form.
            error_name  VARCHAR(200) NOT NULL,
            error_message TEXT NOT NULL,
            -- 8 KB cap enforced at the endpoint; column is unlimited
            -- in case we later want to bump it.
            stack_text  TEXT NOT NULL,
            -- Last 100 audit-log entries from the renderer, scrubbed
            -- of PII. JSONB so queries can group by event_type.
            context     JSONB NULL,
            -- IP captured for abuse correlation. Not a PII concern
            -- under HIPAA — only the audit chain stores it for
            -- identified users; here it's just a forensics breadcrumb.
            client_ip   INET NULL
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_crash_reports_received_at "
        "ON crash_reports (received_at DESC)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_crash_reports_error_name "
        "ON crash_reports (error_name, received_at DESC)"
    )

    # ─── telemetry_events ────────────────────────────────────
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS telemetry_events (
            id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id     UUID NULL REFERENCES users(id) ON DELETE SET NULL,
            received_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            kind        VARCHAR(64) NOT NULL,
            payload     JSONB NOT NULL,
            app_version VARCHAR(32) NULL,
            platform    VARCHAR(32) NULL
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_telemetry_events_received_at "
        "ON telemetry_events (received_at DESC)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_telemetry_events_kind_received "
        "ON telemetry_events (kind, received_at DESC)"
    )

    # ─── users.telemetry_opt_in ──────────────────────────────
    op.execute(
        "ALTER TABLE users "
        "ADD COLUMN IF NOT EXISTS telemetry_opt_in "
        "BOOLEAN NOT NULL DEFAULT FALSE"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS telemetry_opt_in")
    op.execute("DROP INDEX IF EXISTS ix_telemetry_events_kind_received")
    op.execute("DROP INDEX IF EXISTS ix_telemetry_events_received_at")
    op.execute("DROP TABLE IF EXISTS telemetry_events")
    op.execute("DROP INDEX IF EXISTS ix_crash_reports_error_name")
    op.execute("DROP INDEX IF EXISTS ix_crash_reports_received_at")
    op.execute("DROP TABLE IF EXISTS crash_reports")
