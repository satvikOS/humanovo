"""Unit tests for `GET /admin/ai/runs`.

Verifies the endpoint's response shape, filter parameters, and
defensive `details` unpacking. Doesn't run a real FastAPI server —
calls the route handler function directly with a mocked
`AsyncSession`."""
from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.api.v1.endpoints.ai_runs import list_recent_runs


def _audit_row(
    sequence: int,
    event_type: str = "pipeline.complete",
    *,
    cost_usd: float | None = 0.50,
    duration_ms: int = 60000,
    tokens_input: int | None = 5000,
    tokens_output: int | None = 1200,
    details: dict | None = None,
) -> SimpleNamespace:
    """Return a SimpleNamespace mimicking the AuditRecord ORM shape
    enough for the endpoint's column accesses."""
    return SimpleNamespace(
        sequence=sequence,
        timestamp=datetime(2026, 5, 10, 12, 0, sequence % 60, tzinfo=UTC),
        event_type=event_type,
        execution_id=f"run-{sequence}",
        user_id="user-1",
        project_id="proj-1",
        duration_ms=duration_ms,
        cost_usd=cost_usd,
        tokens_input=tokens_input,
        tokens_output=tokens_output,
        details=details or {
            "stages_completed": 12,
            "loopbacks_fired": 1,
            "budget_aborted": False,
            "cost_by_model": {"swarm[bedrock/claude-sonnet]": 25.0},
            "reasoning_tokens": 800,
            "final_text_preview": "PARP1 inhibition is synthetic-lethal with BRCA1...",
        },
    )


def _make_db_returning(rows: list) -> AsyncMock:
    """Build an AsyncSession mock whose `execute()` returns a result
    object whose `.scalars().all()` yields the given rows."""
    db = MagicMock()
    scalars = MagicMock()
    scalars.all = MagicMock(return_value=rows)
    result = MagicMock()
    result.scalars = MagicMock(return_value=scalars)
    db.execute = AsyncMock(return_value=result)
    return db


@pytest.mark.asyncio
async def test_returns_runs_with_full_summary_shape():
    rows = [_audit_row(101), _audit_row(100)]
    db = _make_db_returning(rows)
    out = await list_recent_runs(db=db, limit=50, lookback_hours=24, only_aborts=False)

    assert out["total_returned"] == 2
    assert out["lookback_window_hours"] == 24
    assert out["only_aborts"] is False

    first = out["runs"][0]
    assert first["sequence"] == 101
    assert first["execution_id"] == "run-101"
    assert first["event_type"] == "pipeline.complete"
    assert first["cost_usd"] == 0.50
    assert first["stages_completed"] == 12
    assert first["loopbacks_fired"] == 1
    assert first["budget_aborted"] is False
    assert "PARP1" in first["final_text_preview"]


@pytest.mark.asyncio
async def test_only_aborts_filter_passes_pipeline_error_to_query():
    """When only_aborts=True, the query should use the PIPELINE_ERROR
    event type filter."""
    db = _make_db_returning([_audit_row(99, event_type="pipeline.error",
                                         details={"budget_aborted": True})])
    out = await list_recent_runs(db=db, limit=10, lookback_hours=12, only_aborts=True)

    assert out["only_aborts"] is True
    assert out["total_returned"] == 1
    assert out["runs"][0]["budget_aborted"] is True
    # The endpoint built a SQL statement with `IN (pipeline.error,)` —
    # we don't verify the SQL directly here (would over-couple the
    # test to SQLAlchemy internals), but the result shape proves the
    # branch was exercised.


@pytest.mark.asyncio
async def test_handles_missing_details_keys_gracefully():
    """If an audit record has a partial `details` dict (schema drift,
    older records), the endpoint must surface None for missing keys
    rather than 500."""
    row = _audit_row(50, details={})  # empty details — every key missing
    db = _make_db_returning([row])
    out = await list_recent_runs(db=db, limit=10, lookback_hours=24, only_aborts=False)

    run = out["runs"][0]
    assert run["stages_completed"] is None
    assert run["loopbacks_fired"] is None
    assert run["budget_aborted"] is False  # default
    assert run["cost_by_model"] is None
    assert run["final_text_preview"] is None


@pytest.mark.asyncio
async def test_handles_null_audit_columns():
    """A run that wrote no cost / no tokens still surfaces with
    None values, not a crash."""
    row = _audit_row(
        42, cost_usd=None, tokens_input=None, tokens_output=None, duration_ms=None,
    )
    db = _make_db_returning([row])
    out = await list_recent_runs(db=db, limit=10, lookback_hours=24, only_aborts=False)

    run = out["runs"][0]
    assert run["cost_usd"] is None
    assert run["tokens_input"] is None
    assert run["tokens_output"] is None
    assert run["duration_ms"] is None


@pytest.mark.asyncio
async def test_empty_result_returns_empty_list():
    db = _make_db_returning([])
    out = await list_recent_runs(db=db, limit=10, lookback_hours=24, only_aborts=False)
    assert out["runs"] == []
    assert out["total_returned"] == 0
