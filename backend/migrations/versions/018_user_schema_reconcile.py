"""reconcile users schema with current ORM

Adds the columns the User ORM has accumulated since the initial 001
migration: organization, bio, permissions, email_verified_at,
last_login_at, failed_login_attempts, locked_until, api_key_hash,
api_key_created_at. Drops `api_key` + `settings` which were renamed/
removed from the model. Without this migration every signup INSERT
hits asyncpg.exceptions.UndefinedColumnError at runtime.

Broader model-vs-schema reconciliation (orphan tables, deprecated
columns on hypotheses/discovery_runs/evidence) lives in a follow-up
once each is individually audited — those tables may have semantic
intent we don't want to drop.

Revision ID: 018_user_schema_reconcile
Revises: 017_stripe_customer_subscription
Create Date: 2026-05-07
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "018_user_schema_reconcile"
down_revision = "017_stripe_customer_subscription"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # New columns added to the User ORM since 001_initial_schema.
    op.add_column(
        "users",
        sa.Column("organization", sa.String(length=255), nullable=True),
    )
    op.add_column("users", sa.Column("bio", sa.Text(), nullable=True))
    op.add_column(
        "users",
        sa.Column(
            "permissions",
            postgresql.ARRAY(sa.String()),
            nullable=False,
            server_default="{}",
        ),
    )
    op.add_column(
        "users",
        sa.Column("email_verified_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "users",
        sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "users",
        sa.Column(
            "failed_login_attempts",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
    )
    op.add_column(
        "users",
        sa.Column("locked_until", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "users",
        sa.Column("api_key_hash", sa.String(length=255), nullable=True),
    )
    op.create_unique_constraint(
        "uq_users_api_key_hash", "users", ["api_key_hash"]
    )
    op.add_column(
        "users",
        sa.Column("api_key_created_at", sa.DateTime(timezone=True), nullable=True),
    )

    # Drop the legacy columns the model no longer references. Safe pre-
    # launch — no production data exists yet. The replacement is
    # api_key_hash (above), and `settings` was never wired to UI.
    op.drop_index("ix_users_api_key", table_name="users")
    op.drop_column("users", "api_key")
    op.drop_column("users", "settings")


def downgrade() -> None:
    op.add_column(
        "users",
        sa.Column("settings", sa.Text(), nullable=True),
    )
    op.add_column(
        "users",
        sa.Column("api_key", sa.String(length=64), nullable=True),
    )
    op.create_index("ix_users_api_key", "users", ["api_key"], unique=True)

    op.drop_column("users", "api_key_created_at")
    op.drop_constraint("uq_users_api_key_hash", "users", type_="unique")
    op.drop_column("users", "api_key_hash")
    op.drop_column("users", "locked_until")
    op.drop_column("users", "failed_login_attempts")
    op.drop_column("users", "last_login_at")
    op.drop_column("users", "email_verified_at")
    op.drop_column("users", "permissions")
    op.drop_column("users", "bio")
    op.drop_column("users", "organization")
