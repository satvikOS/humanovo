"""add users.has_completed_onboarding

First-run onboarding wizard (NEXT_SESSION B4): adds a boolean to
the users table so the wizard knows whether to fire on app load.
Existing users default to TRUE — they've effectively already
"completed" onboarding by virtue of being active before the
feature shipped, and we don't want to dunk them into a wizard
unprompted on the next deploy. New signups default to FALSE in
the application layer (the User model default at the ORM is
False; the column default below covers the edge case of someone
inserting outside the ORM).

Idempotence: ADD COLUMN IF NOT EXISTS. Re-runnable after partial
application.

Revision ID: 022_user_has_completed_onboarding
Revises: 020_owner_id_on_platform_entities
Create Date: 2026-05-08
"""
from __future__ import annotations

from alembic import op


revision = "022_user_has_completed_onboarding"
down_revision = "020_owner_id_on_platform_entities"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # New column. NOT NULL with a column-level DEFAULT so the
    # backfill for existing rows happens atomically inside the ALTER.
    # Postgres treats `ADD COLUMN ... DEFAULT ... NOT NULL` as a
    # metadata-only change as of 11+, so this is safe even on a
    # non-trivial users table.
    op.execute(
        "ALTER TABLE users "
        "ADD COLUMN IF NOT EXISTS has_completed_onboarding "
        "BOOLEAN NOT NULL DEFAULT TRUE"
    )

    # New signups should land with FALSE so the wizard fires; the ORM
    # default in app/models/user.py enforces that for application-layer
    # writes. The column-level default stays TRUE so any backfill /
    # SQL-direct insert during migration also lands in the "skip the
    # wizard" state — no surprise wizards for legacy rows.


def downgrade() -> None:
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS has_completed_onboarding")
