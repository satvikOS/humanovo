"""
Audit Trail Service

Records every pipeline execution, data access, and external API call
in a tamper-evident, append-only log suitable for HIPAA/SOC 2 audit.

Design principles:
  1. Append-only: audit records are never updated or deleted
  2. Tamper-evident: each record includes hash of previous record (chain)
  3. Complete: every LLM call, every API call, every data access
  4. Queryable: structured fields for fast filtering
  5. Exportable: CSV/JSON export for external audit

This is the wedge against Biomni (no audit, runs arbitrary code) and
Google AI Co-Scientist (black box). humanovo's enterprise sell.
"""

import hashlib
import json
import time
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from enum import Enum
from typing import Any

from sqlalchemy import Column, DateTime, Float, Index, Integer, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.models.base import Base

logger = get_logger(__name__)


# ─── Database Model ─────────────────────────────────────────────
# Co-located with the service by design: the AuditRecord schema and the
# hash-chain behavior that writes to it are a single compliance surface,
# versioned together. Alembic autogen picks it up via
# `app.services.audit_service` being imported from app.models.__init__.

class AuditRecord(Base):
    """Immutable audit log entry with hash chain."""

    __tablename__ = "audit_records"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    sequence = Column(Integer, nullable=False, autoincrement=True, unique=True)
    timestamp = Column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
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


# ─── Audit Event Types ──────────────────────────────────────────

class AuditEventType(str, Enum):
    # Pipeline
    PIPELINE_START = "pipeline.start"
    PIPELINE_COMPLETE = "pipeline.complete"
    PIPELINE_ERROR = "pipeline.error"
    STAGE_START = "pipeline.stage.start"
    STAGE_COMPLETE = "pipeline.stage.complete"
    STAGE_ERROR = "pipeline.stage.error"
    GROUNDING_GATE = "pipeline.grounding.gate"

    # LLM
    LLM_REQUEST = "llm.request"
    LLM_RESPONSE = "llm.response"
    LLM_ERROR = "llm.error"

    # External APIs
    API_REQUEST = "api.request"
    API_RESPONSE = "api.response"
    API_ERROR = "api.error"

    # Data access
    DATA_READ = "data.read"
    DATA_WRITE = "data.write"
    DATA_DELETE = "data.delete"
    DATA_EXPORT = "data.export"

    # Auth
    AUTH_LOGIN = "auth.login"
    AUTH_LOGOUT = "auth.logout"
    AUTH_FAILED = "auth.failed"
    AUTH_PERMISSION_DENIED = "auth.permission_denied"


class AuditSeverity(str, Enum):
    INFO = "info"
    NOTICE = "notice"
    WARNING = "warning"
    ERROR = "error"
    CRITICAL = "critical"


# ─── Hashing ────────────────────────────────────────────────────

def _compute_record_hash(
    sequence: int,
    timestamp: datetime,
    event_type: str,
    user_id: str | None,
    action: str,
    details: dict | None,
    previous_hash: str | None,
) -> str:
    """Compute SHA-256 hash of record fields + previous hash."""
    payload = {
        "sequence": sequence,
        "timestamp": timestamp.isoformat(),
        "event_type": event_type,
        "user_id": user_id or "",
        "action": action,
        "details": json.dumps(details, sort_keys=True, default=str) if details else "",
        "previous_hash": previous_hash or "",
    }
    blob = json.dumps(payload, sort_keys=True).encode("utf-8")
    return hashlib.sha256(blob).hexdigest()


# ─── Service ────────────────────────────────────────────────────

@dataclass
class AuditContext:
    """Context for a logical operation that may emit multiple audit records."""
    user_id: str | None = None
    project_id: str | None = None
    execution_id: str | None = None
    session_id: str | None = None
    ip_address: str | None = None
    user_agent: str | None = None


class AuditService:
    """Service for recording audit events."""

    def __init__(self):
        self._previous_hash: str | None = None
        self._sequence: int = 0
        self._loaded = False

    async def _ensure_loaded(self, db: AsyncSession) -> None:
        """Load the latest sequence and hash from the DB on first use."""
        if self._loaded:
            return
        from sqlalchemy import desc, select
        result = await db.execute(
            select(AuditRecord)
            .order_by(desc(AuditRecord.sequence))
            .limit(1)
        )
        latest = result.scalar_one_or_none()
        if latest:
            self._previous_hash = latest.record_hash
            self._sequence = latest.sequence
        self._loaded = True

    async def record(
        self,
        db: AsyncSession,
        event_type: AuditEventType,
        action: str,
        context: AuditContext | None = None,
        severity: AuditSeverity = AuditSeverity.INFO,
        resource_type: str | None = None,
        resource_id: str | None = None,
        details: dict[str, Any] | None = None,
        duration_ms: int | None = None,
        cost_usd: float | None = None,
        tokens_input: int | None = None,
        tokens_output: int | None = None,
    ) -> AuditRecord:
        """Append a record to the audit log."""
        await self._ensure_loaded(db)

        ctx = context or AuditContext()
        self._sequence += 1
        now = datetime.now(UTC)

        record_hash = _compute_record_hash(
            sequence=self._sequence,
            timestamp=now,
            event_type=event_type.value,
            user_id=ctx.user_id,
            action=action,
            details=details,
            previous_hash=self._previous_hash,
        )

        record = AuditRecord(
            id=str(uuid.uuid4()),
            sequence=self._sequence,
            timestamp=now,
            event_type=event_type.value,
            severity=severity.value,
            user_id=ctx.user_id,
            project_id=ctx.project_id,
            execution_id=ctx.execution_id,
            session_id=ctx.session_id,
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
            details=details,
            ip_address=ctx.ip_address,
            user_agent=ctx.user_agent,
            duration_ms=duration_ms,
            cost_usd=cost_usd,
            tokens_input=tokens_input,
            tokens_output=tokens_output,
            record_hash=record_hash,
            previous_hash=self._previous_hash,
        )

        db.add(record)
        await db.flush()
        self._previous_hash = record_hash
        return record

    @asynccontextmanager
    async def operation(
        self,
        db: AsyncSession,
        action: str,
        context: AuditContext,
        start_event: AuditEventType,
        complete_event: AuditEventType,
        error_event: AuditEventType,
        resource_type: str | None = None,
        resource_id: str | None = None,
    ) -> AsyncIterator[dict[str, Any]]:
        """
        Context manager that records start, complete (or error) events
        with timing.

        Usage:
            async with audit.operation(
                db, "run_pipeline", ctx,
                AuditEventType.PIPELINE_START,
                AuditEventType.PIPELINE_COMPLETE,
                AuditEventType.PIPELINE_ERROR,
            ) as op:
                result = await pipeline.run(...)
                op["details"] = {"stages_completed": result.stages_completed}
        """
        op_data: dict[str, Any] = {"details": {}}
        start = time.time()

        await self.record(
            db, start_event, action, context,
            resource_type=resource_type, resource_id=resource_id,
        )

        try:
            yield op_data
        except Exception as e:
            duration_ms = int((time.time() - start) * 1000)
            await self.record(
                db, error_event, action, context,
                severity=AuditSeverity.ERROR,
                resource_type=resource_type, resource_id=resource_id,
                details={**op_data.get("details", {}), "error": str(e)},
                duration_ms=duration_ms,
            )
            raise
        else:
            duration_ms = int((time.time() - start) * 1000)
            await self.record(
                db, complete_event, action, context,
                resource_type=resource_type, resource_id=resource_id,
                details=op_data.get("details") or None,
                duration_ms=duration_ms,
                cost_usd=op_data.get("cost_usd"),
                tokens_input=op_data.get("tokens_input"),
                tokens_output=op_data.get("tokens_output"),
            )

    # ─── Verification ──────────────────────────────────────────

    async def verify_chain(
        self,
        db: AsyncSession,
        start_sequence: int = 1,
        end_sequence: int | None = None,
    ) -> dict[str, Any]:
        """
        Verify the hash chain integrity over a range of records.
        Returns a report with any tampering detected.
        """
        from sqlalchemy import select

        stmt = (
            select(AuditRecord)
            .where(AuditRecord.sequence >= start_sequence)
            .order_by(AuditRecord.sequence)
        )
        if end_sequence is not None:
            stmt = stmt.where(AuditRecord.sequence <= end_sequence)

        result = await db.execute(stmt)
        records = result.scalars().all()

        prev_hash: str | None = None
        issues: list[dict[str, Any]] = []
        verified_count = 0

        for r in records:
            # Verify previous_hash matches
            if r.previous_hash != prev_hash:
                issues.append({
                    "sequence": r.sequence,
                    "id": r.id,
                    "issue": "previous_hash_mismatch",
                    "expected_previous": prev_hash,
                    "actual_previous": r.previous_hash,
                })
                # Re-anchor for continuation
                prev_hash = r.record_hash
                continue

            # Recompute the hash and verify
            expected_hash = _compute_record_hash(
                sequence=r.sequence,
                timestamp=r.timestamp,
                event_type=r.event_type,
                user_id=r.user_id,
                action=r.action,
                details=r.details,
                previous_hash=r.previous_hash,
            )
            if expected_hash != r.record_hash:
                issues.append({
                    "sequence": r.sequence,
                    "id": r.id,
                    "issue": "record_hash_mismatch",
                    "expected": expected_hash,
                    "actual": r.record_hash,
                })

            prev_hash = r.record_hash
            verified_count += 1

        return {
            "verified_count": verified_count,
            "total_records": len(records),
            "issues_found": len(issues),
            "intact": len(issues) == 0,
            "issues": issues,
        }

    # ─── Export ────────────────────────────────────────────────

    async def export(
        self,
        db: AsyncSession,
        format: str = "json",
        user_id: str | None = None,
        project_id: str | None = None,
        execution_id: str | None = None,
        start_time: datetime | None = None,
        end_time: datetime | None = None,
        event_types: list[str] | None = None,
    ) -> str:
        """Export audit records to JSON or CSV."""
        from sqlalchemy import and_, select

        stmt = select(AuditRecord)
        conditions = []

        if user_id:
            conditions.append(AuditRecord.user_id == user_id)
        if project_id:
            conditions.append(AuditRecord.project_id == project_id)
        if execution_id:
            conditions.append(AuditRecord.execution_id == execution_id)
        if start_time:
            conditions.append(AuditRecord.timestamp >= start_time)
        if end_time:
            conditions.append(AuditRecord.timestamp <= end_time)
        if event_types:
            conditions.append(AuditRecord.event_type.in_(event_types))

        if conditions:
            stmt = stmt.where(and_(*conditions))

        stmt = stmt.order_by(AuditRecord.sequence)
        result = await db.execute(stmt)
        records = result.scalars().all()

        if format == "json":
            return json.dumps([{
                "sequence": r.sequence,
                "timestamp": r.timestamp.isoformat(),
                "event_type": r.event_type,
                "severity": r.severity,
                "user_id": r.user_id,
                "project_id": r.project_id,
                "execution_id": r.execution_id,
                "action": r.action,
                "resource_type": r.resource_type,
                "resource_id": r.resource_id,
                "details": r.details,
                "duration_ms": r.duration_ms,
                "cost_usd": r.cost_usd,
                "record_hash": r.record_hash,
                "previous_hash": r.previous_hash,
            } for r in records], indent=2, default=str)

        elif format == "csv":
            import csv
            import io
            buffer = io.StringIO()
            writer = csv.writer(buffer)
            writer.writerow([
                "sequence", "timestamp", "event_type", "severity",
                "user_id", "project_id", "execution_id", "action",
                "resource_type", "resource_id", "duration_ms", "cost_usd",
                "record_hash",
            ])
            for r in records:
                writer.writerow([
                    r.sequence,
                    r.timestamp.isoformat() if r.timestamp else "",
                    r.event_type, r.severity,
                    r.user_id or "", r.project_id or "",
                    r.execution_id or "", r.action,
                    r.resource_type or "", r.resource_id or "",
                    r.duration_ms or "",
                    r.cost_usd or "",
                    r.record_hash,
                ])
            return buffer.getvalue()

        else:
            raise ValueError(f"Unsupported export format: {format}")


# ─── Singleton ──────────────────────────────────────────────────

_audit_service: AuditService | None = None


def get_audit_service() -> AuditService:
    global _audit_service
    if _audit_service is None:
        _audit_service = AuditService()
    return _audit_service
