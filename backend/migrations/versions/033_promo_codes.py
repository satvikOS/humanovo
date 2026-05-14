"""add promo_codes + promo_redemptions tables

Two-table promo-code system:

  promo_codes — the code definitions
    • code TEXT UNIQUE — case-insensitive lookup key (e.g.
      "ACADEMIC50", "BETA2026"). Stored uppercase by convention.
    • kind TEXT — one of: percent_off | fixed_cents_off |
                   trial_extension
    • value INTEGER — percent (1-100) | cents | trial-days
    • description TEXT — human-readable for admin dashboard
    • expires_at TIMESTAMPTZ NULL — code unusable after this
    • max_redemptions INTEGER NULL — total cap across all users
    • min_email_domain TEXT NULL — if set, only redeemers whose
      email matches this domain (e.g. "@harvard.edu") can apply
    • created_by_user_id UUID — admin who minted it
    • created_at, revoked_at — admins can kill codes mid-life

  promo_redemptions — one row per (code, user)
    • promo_code_id FK
    • user_id FK
    • redeemed_at TIMESTAMPTZ
    • UNIQUE (promo_code_id, user_id) — no double-redeem

Idempotence: CREATE TABLE IF NOT EXISTS.

Revision ID: 033_promo_codes
Revises: 032_user_trial_ends_at
Create Date: 2026-05-10
"""
from __future__ import annotations

from alembic import op


revision = "033_promo_codes"
down_revision = "032_user_trial_ends_at"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS promo_codes (
            id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            code                TEXT NOT NULL,
            kind                TEXT NOT NULL,
            value               INTEGER NOT NULL,
            description         TEXT NULL,
            expires_at          TIMESTAMP WITH TIME ZONE NULL,
            max_redemptions     INTEGER NULL,
            min_email_domain    TEXT NULL,
            created_by_user_id  UUID NULL REFERENCES users(id) ON DELETE SET NULL,
            created_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            revoked_at          TIMESTAMP WITH TIME ZONE NULL,
            CONSTRAINT promo_codes_kind_check CHECK (kind IN ('percent_off', 'fixed_cents_off', 'trial_extension')),
            CONSTRAINT promo_codes_value_check CHECK (value > 0)
        )
        """
    )
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS ix_promo_codes_code "
        "ON promo_codes (UPPER(code))"
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS promo_redemptions (
            id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            promo_code_id  UUID NOT NULL REFERENCES promo_codes(id) ON DELETE CASCADE,
            user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            redeemed_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            CONSTRAINT promo_redemptions_unique UNIQUE (promo_code_id, user_id)
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_promo_redemptions_user "
        "ON promo_redemptions (user_id, redeemed_at DESC)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_promo_redemptions_user")
    op.execute("DROP TABLE IF EXISTS promo_redemptions")
    op.execute("DROP INDEX IF EXISTS ix_promo_codes_code")
    op.execute("DROP TABLE IF EXISTS promo_codes")
