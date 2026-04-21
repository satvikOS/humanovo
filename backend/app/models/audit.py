"""
Audit ORM model.

The AuditRecord is the hash-chained, append-only compliance log.
Behavior (append / verify / export) lives in app.services.audit_service;
this module only defines the persistent schema so Alembic and every
consumer share a single source of truth.

Two audit tables coexist by design:
  * audit_log_entries (from migration 008) — plain CRUD trail keyed by user+entity
  * audit_records     (from migration 009) — SHA-256-chained compliance log
"""

from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, Float, Index, Integer, String
from sqlalchemy.dialects.postgresql import JSONB

from app.models.base import Base


class AuditRecord(Base):
    """Immutable audit log entry with hash chain."""

    __tablename__ = "audit_records"

    id = Column(String, primary_key=True)
    sequence = Column(Integer, nullable=False, autoincrement=True, unique=True)
    timestamp = Column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
    event_type = Column(String(64), nullable=False)
    severity = Column(String(16), nullable=False, default="info")

    # Actors
    user_id = Column(String, nullable=True)
    project_id = Column(String, nullable=True)
    execution_id = Column(String, nullable=True)
    session_id = Column(String, nullable=True)

    # Action context
    action = Column(String(128), nullable=False)
    resource_type = Column(String(64), nullable=True)
    resource_id = Column(String, nullable=True)

    # Payload
    details = Column(JSONB, nullable=True)
    ip_address = Column(String(64), nullable=True)
    user_agent = Column(String(512), nullable=True)

    # Cost / performance metrics
    duration_ms = Column(Integer, nullable=True)
    cost_usd = Column(Float, nullable=True)
    tokens_input = Column(Integer, nullable=True)
    tokens_output = Column(Integer, nullable=True)

    # Tamper-evidence
    record_hash = Column(String(64), nullable=False)
    previous_hash = Column(String(64), nullable=True)

    __table_args__ = (
        Index("idx_audit_timestamp", "timestamp"),
        Index("idx_audit_user", "user_id", "timestamp"),
        Index("idx_audit_project", "project_id", "timestamp"),
        Index("idx_audit_execution", "execution_id"),
        Index("idx_audit_event_type", "event_type", "timestamp"),
    )
