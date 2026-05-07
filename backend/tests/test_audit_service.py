"""
Tests for app.services.audit_service.

The audit log is the wedge for SOC 2 / HIPAA compliance — every record is
hash-chained to the previous so any retroactive tamper is detectable.
These tests cover the contract the rest of the codebase relies on:

  - record() persists with monotonically increasing sequence + correct hash chain
  - the operation() context manager emits start + complete on success
    and start + error on exception, and times the duration
  - verify_chain() returns intact=True on a clean chain
  - verify_chain() detects record_hash tampering and previous_hash skips
  - export() round-trips JSON and CSV with the documented columns

Pattern matches test_discovery_sessions.py: fresh AsyncSession per test,
engine.dispose() between tests so asyncpg's pool re-binds to the current
loop. We use a fresh `AuditService()` per test rather than the singleton
so the in-memory `_previous_hash` doesn't leak across tests.
"""
from __future__ import annotations

import csv
import io
import json
import uuid
from datetime import UTC

import pytest
from sqlalchemy import delete

from app.core.database import async_session_factory, engine
from app.services.audit_service import (
    AuditContext,
    AuditEventType,
    AuditRecord,
    AuditService,
    AuditSeverity,
    _compute_record_hash,
)


@pytest.fixture(autouse=True)
async def _dispose_and_clear_audit():
    """Clear audit_records before each test and dispose the engine pool."""
    await engine.dispose()
    async with async_session_factory() as db:
        await db.execute(delete(AuditRecord))
        await db.commit()
    yield


def _ctx(**overrides) -> AuditContext:
    base = {
        "user_id": "u-" + uuid.uuid4().hex[:8],
        "project_id": "p-" + uuid.uuid4().hex[:8],
        "execution_id": "e-" + uuid.uuid4().hex[:8],
    }
    base.update(overrides)
    return AuditContext(**base)


# ──────────────────────────────────────────────────────────────────
# record()
# ──────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_record_persists_with_hash_and_sequence() -> None:
    svc = AuditService()
    ctx = _ctx()
    async with async_session_factory() as db:
        rec = await svc.record(
            db,
            event_type=AuditEventType.PIPELINE_START,
            action="run_pipeline",
            context=ctx,
            details={"disease": "ALS"},
        )
        await db.commit()
        assert rec.sequence == 1
        assert rec.previous_hash is None
        assert len(rec.record_hash) == 64  # sha256 hex
        assert rec.event_type == "pipeline.start"
        assert rec.user_id == ctx.user_id


@pytest.mark.asyncio
async def test_record_chains_hash_across_calls() -> None:
    svc = AuditService()
    ctx = _ctx()
    async with async_session_factory() as db:
        r1 = await svc.record(
            db, AuditEventType.PIPELINE_START, "a1", ctx, details={"i": 1},
        )
        r2 = await svc.record(
            db, AuditEventType.PIPELINE_COMPLETE, "a2", ctx, details={"i": 2},
        )
        r3 = await svc.record(
            db, AuditEventType.PIPELINE_ERROR, "a3", ctx, details={"i": 3},
        )
        await db.commit()
        assert r1.sequence < r2.sequence < r3.sequence
        assert r2.previous_hash == r1.record_hash
        assert r3.previous_hash == r2.record_hash
        assert r1.record_hash != r2.record_hash != r3.record_hash


@pytest.mark.asyncio
async def test_record_severity_defaults_to_info_and_stores_overrides() -> None:
    svc = AuditService()
    ctx = _ctx()
    async with async_session_factory() as db:
        r1 = await svc.record(
            db, AuditEventType.AUTH_LOGIN, "login", ctx,
        )
        r2 = await svc.record(
            db, AuditEventType.AUTH_FAILED, "login_failed", ctx,
            severity=AuditSeverity.WARNING,
        )
        await db.commit()
        assert r1.severity == "info"
        assert r2.severity == "warning"


@pytest.mark.asyncio
async def test_record_ensure_loaded_resumes_chain_from_db() -> None:
    """A new AuditService instance must pick up the latest seq+hash."""
    ctx = _ctx()
    svc1 = AuditService()
    async with async_session_factory() as db:
        r1 = await svc1.record(db, AuditEventType.DATA_READ, "r1", ctx)
        r2 = await svc1.record(db, AuditEventType.DATA_READ, "r2", ctx)
        await db.commit()

    # Fresh service should resume from the persisted tail.
    svc2 = AuditService()
    async with async_session_factory() as db:
        r3 = await svc2.record(db, AuditEventType.DATA_READ, "r3", ctx)
        await db.commit()
        assert r3.sequence == r2.sequence + 1
        assert r3.previous_hash == r2.record_hash


# ──────────────────────────────────────────────────────────────────
# operation() context manager
# ──────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_operation_emits_start_and_complete_on_success() -> None:
    svc = AuditService()
    ctx = _ctx()
    async with async_session_factory() as db:
        async with svc.operation(
            db, "run_pipeline", ctx,
            AuditEventType.PIPELINE_START,
            AuditEventType.PIPELINE_COMPLETE,
            AuditEventType.PIPELINE_ERROR,
            resource_type="pipeline",
            resource_id="pipe-1",
        ) as op:
            op["details"] = {"stages_completed": 12}
            op["cost_usd"] = 0.42
        await db.commit()

        from sqlalchemy import select
        result = await db.execute(
            select(AuditRecord).order_by(AuditRecord.sequence)
        )
        rows = result.scalars().all()
        assert [r.event_type for r in rows] == [
            "pipeline.start",
            "pipeline.complete",
        ]
        complete = rows[1]
        assert complete.duration_ms is not None and complete.duration_ms >= 0
        assert complete.cost_usd == 0.42
        assert complete.details == {"stages_completed": 12}
        assert complete.resource_type == "pipeline"
        assert complete.resource_id == "pipe-1"


@pytest.mark.asyncio
async def test_operation_emits_start_and_error_on_exception() -> None:
    svc = AuditService()
    ctx = _ctx()
    async with async_session_factory() as db:
        with pytest.raises(RuntimeError, match="boom"):
            async with svc.operation(
                db, "run_pipeline", ctx,
                AuditEventType.PIPELINE_START,
                AuditEventType.PIPELINE_COMPLETE,
                AuditEventType.PIPELINE_ERROR,
            ):
                raise RuntimeError("boom")
        await db.commit()

        from sqlalchemy import select
        result = await db.execute(
            select(AuditRecord).order_by(AuditRecord.sequence)
        )
        rows = result.scalars().all()
        assert [r.event_type for r in rows] == [
            "pipeline.start",
            "pipeline.error",
        ]
        err = rows[1]
        assert err.severity == "error"
        assert "boom" in (err.details or {}).get("error", "")
        assert err.duration_ms is not None and err.duration_ms >= 0


# ──────────────────────────────────────────────────────────────────
# verify_chain()
# ──────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_verify_chain_intact_on_clean_log() -> None:
    svc = AuditService()
    ctx = _ctx()
    async with async_session_factory() as db:
        for i in range(5):
            await svc.record(
                db, AuditEventType.DATA_READ, f"action-{i}", ctx,
                details={"i": i},
            )
        await db.commit()
        report = await svc.verify_chain(db)
        assert report["intact"] is True
        assert report["issues_found"] == 0
        assert report["verified_count"] == 5
        assert report["total_records"] == 5


@pytest.mark.asyncio
async def test_verify_chain_detects_record_hash_tamper() -> None:
    svc = AuditService()
    ctx = _ctx()
    async with async_session_factory() as db:
        await svc.record(db, AuditEventType.DATA_READ, "r1", ctx)
        await svc.record(db, AuditEventType.DATA_READ, "r2", ctx)
        await db.commit()

        # Tamper: rewrite the action without updating record_hash.
        from sqlalchemy import select, update
        result = await db.execute(
            select(AuditRecord).order_by(AuditRecord.sequence).limit(1)
        )
        first = result.scalar_one()
        await db.execute(
            update(AuditRecord)
            .where(AuditRecord.id == first.id)
            .values(action="HACKED")
        )
        await db.commit()

        report = await svc.verify_chain(db)
        assert report["intact"] is False
        assert report["issues_found"] >= 1
        assert any(
            issue["issue"] == "record_hash_mismatch"
            for issue in report["issues"]
        )


@pytest.mark.asyncio
async def test_verify_chain_detects_previous_hash_skip() -> None:
    """If a record's previous_hash doesn't match the prior record's hash,
    the chain reports a previous_hash_mismatch."""
    svc = AuditService()
    ctx = _ctx()
    async with async_session_factory() as db:
        await svc.record(db, AuditEventType.DATA_READ, "r1", ctx)
        await svc.record(db, AuditEventType.DATA_READ, "r2", ctx)
        await svc.record(db, AuditEventType.DATA_READ, "r3", ctx)
        await db.commit()

        # Tamper: rewrite r2's previous_hash to a bogus value.
        from sqlalchemy import select, update
        result = await db.execute(
            select(AuditRecord).where(AuditRecord.sequence == 2)
        )
        r2 = result.scalar_one()
        await db.execute(
            update(AuditRecord)
            .where(AuditRecord.id == r2.id)
            .values(previous_hash="0" * 64)
        )
        await db.commit()

        report = await svc.verify_chain(db)
        assert report["intact"] is False
        assert any(
            issue["issue"] == "previous_hash_mismatch"
            for issue in report["issues"]
        )


# ──────────────────────────────────────────────────────────────────
# export()
# ──────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_export_json_round_trip() -> None:
    svc = AuditService()
    ctx = _ctx()
    async with async_session_factory() as db:
        await svc.record(
            db, AuditEventType.LLM_REQUEST, "infer", ctx,
            details={"model": "claude-opus", "prompt_tokens": 100},
            tokens_input=100,
            tokens_output=200,
            cost_usd=0.05,
        )
        await db.commit()
        out = await svc.export(db, format="json")
        parsed = json.loads(out)
        assert isinstance(parsed, list)
        assert len(parsed) == 1
        assert parsed[0]["event_type"] == "llm.request"
        assert parsed[0]["action"] == "infer"
        assert parsed[0]["details"]["model"] == "claude-opus"
        assert parsed[0]["cost_usd"] == 0.05


@pytest.mark.asyncio
async def test_export_csv_has_documented_columns() -> None:
    svc = AuditService()
    ctx = _ctx()
    async with async_session_factory() as db:
        await svc.record(db, AuditEventType.DATA_WRITE, "write", ctx)
        await db.commit()
        out = await svc.export(db, format="csv")
        reader = csv.reader(io.StringIO(out))
        header = next(reader)
        assert header == [
            "sequence", "timestamp", "event_type", "severity",
            "user_id", "project_id", "execution_id", "action",
            "resource_type", "resource_id", "duration_ms", "cost_usd",
            "record_hash",
        ]
        rows = list(reader)
        assert len(rows) == 1
        assert rows[0][2] == "data.write"
        assert rows[0][7] == "write"


@pytest.mark.asyncio
async def test_export_filters_by_user_id() -> None:
    svc = AuditService()
    alice = _ctx(user_id="alice")
    bob = _ctx(user_id="bob")
    async with async_session_factory() as db:
        await svc.record(db, AuditEventType.AUTH_LOGIN, "login", alice)
        await svc.record(db, AuditEventType.AUTH_LOGIN, "login", bob)
        await svc.record(db, AuditEventType.AUTH_LOGOUT, "logout", alice)
        await db.commit()
        out = await svc.export(db, format="json", user_id="alice")
        parsed = json.loads(out)
        assert len(parsed) == 2
        assert all(r["user_id"] == "alice" for r in parsed)


@pytest.mark.asyncio
async def test_export_unsupported_format_raises() -> None:
    svc = AuditService()
    async with async_session_factory() as db:
        with pytest.raises(ValueError, match="Unsupported export format"):
            await svc.export(db, format="xml")


# ──────────────────────────────────────────────────────────────────
# _compute_record_hash
# ──────────────────────────────────────────────────────────────────


def test_compute_record_hash_is_deterministic() -> None:
    from datetime import datetime
    ts = datetime(2026, 5, 5, 12, 0, 0, tzinfo=UTC)
    h1 = _compute_record_hash(
        sequence=1, timestamp=ts, event_type="data.read",
        user_id="u1", action="read", details={"k": "v"},
        previous_hash=None,
    )
    h2 = _compute_record_hash(
        sequence=1, timestamp=ts, event_type="data.read",
        user_id="u1", action="read", details={"k": "v"},
        previous_hash=None,
    )
    assert h1 == h2 and len(h1) == 64


def test_compute_record_hash_changes_with_any_field() -> None:
    from datetime import datetime
    ts = datetime(2026, 5, 5, 12, 0, 0, tzinfo=UTC)
    base = {
        "sequence": 1, "timestamp": ts, "event_type": "data.read",
        "user_id": "u1", "action": "read", "details": {"k": "v"},
        "previous_hash": None,
    }
    h0 = _compute_record_hash(**base)
    h1 = _compute_record_hash(**{**base, "user_id": "u2"})
    h2 = _compute_record_hash(**{**base, "action": "delete"})
    h3 = _compute_record_hash(**{**base, "details": {"k": "w"}})
    h4 = _compute_record_hash(**{**base, "previous_hash": "abc"})
    assert len({h0, h1, h2, h3, h4}) == 5
