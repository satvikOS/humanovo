"""add audit_records table

Revision ID: 0004_audit_records
Revises: (auto-detect)
Create Date: 2026-04-14

Adds the append-only, hash-chained audit log table used by
app.services.audit_service.AuditService for HIPAA/SOC 2 compliance.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


# revision identifiers
revision = '009_audit_records'
down_revision = '008_platform_entities'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'audit_records',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('sequence', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('timestamp', sa.DateTime(timezone=True), nullable=False),
        sa.Column('event_type', sa.String(64), nullable=False),
        sa.Column('severity', sa.String(16), nullable=False, server_default='info'),

        # Actors
        sa.Column('user_id', sa.String(), nullable=True),
        sa.Column('project_id', sa.String(), nullable=True),
        sa.Column('execution_id', sa.String(), nullable=True),
        sa.Column('session_id', sa.String(), nullable=True),

        # Action context
        sa.Column('action', sa.String(128), nullable=False),
        sa.Column('resource_type', sa.String(64), nullable=True),
        sa.Column('resource_id', sa.String(), nullable=True),

        # Payload
        sa.Column('details', JSONB(), nullable=True),
        sa.Column('ip_address', sa.String(64), nullable=True),
        sa.Column('user_agent', sa.String(512), nullable=True),

        # Cost/performance metrics
        sa.Column('duration_ms', sa.Integer(), nullable=True),
        sa.Column('cost_usd', sa.Float(), nullable=True),
        sa.Column('tokens_input', sa.Integer(), nullable=True),
        sa.Column('tokens_output', sa.Integer(), nullable=True),

        # Tamper-evidence
        sa.Column('record_hash', sa.String(64), nullable=False),
        sa.Column('previous_hash', sa.String(64), nullable=True),

        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('sequence'),
    )

    # Indices for common query patterns
    op.create_index('idx_audit_timestamp', 'audit_records', ['timestamp'])
    op.create_index('idx_audit_user', 'audit_records', ['user_id', 'timestamp'])
    op.create_index('idx_audit_project', 'audit_records', ['project_id', 'timestamp'])
    op.create_index('idx_audit_execution', 'audit_records', ['execution_id'])
    op.create_index('idx_audit_event_type', 'audit_records', ['event_type', 'timestamp'])


def downgrade() -> None:
    op.drop_index('idx_audit_event_type')
    op.drop_index('idx_audit_execution')
    op.drop_index('idx_audit_project')
    op.drop_index('idx_audit_user')
    op.drop_index('idx_audit_timestamp')
    op.drop_table('audit_records')
