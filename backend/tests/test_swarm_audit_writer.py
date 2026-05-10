"""Unit tests for `app/services/agents/audit_writer.py`.

Covers:
  • Record-count math: each stage emits 3 audit records (START + LLM
    + COMPLETE) except loopback-triggering stages which emit 2 (no
    COMPLETE), plus 1 summary at the end.
  • PIPELINE_COMPLETE for normal runs, PIPELINE_ERROR for budget-
    aborted runs.
  • cost_usd / tokens_input / tokens_output correctly converted from
    cents → dollars and pulled off SwarmStageResult.
  • Audit-record write failures are best-effort: a single record's
    exception doesn't abort the rest of the writes.
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.agents.audit_writer import write_swarm_audit
from app.services.agents.pricing import TokenUsage
from app.services.agents.swarm import (
    LoopbackEvent,
    SwarmResult,
    SwarmStageResult,
)


def _stage(
    name: str,
    cost_cents: float = 1.0,
    iteration: int = 1,
    triggered_loopback_to: str | None = None,
) -> SwarmStageResult:
    return SwarmStageResult(
        name=name,
        model_label="bedrock/test",
        text="ok",
        latency_ms=100,
        step_count=2,
        tool_call_count=1,
        usage=TokenUsage(input_tokens=200, output_tokens=50),
        cost_cents=cost_cents,
        iteration=iteration,
        triggered_loopback_to=triggered_loopback_to,
        loopback_reason=("evidence weak" if triggered_loopback_to else None),
    )


@pytest.mark.asyncio
async def test_writes_three_records_per_normal_stage_plus_one_summary():
    """3 normal stages → 3*3 + 1 summary = 10 records."""
    result = SwarmResult(
        stages=[_stage("01-seed"), _stage("02-expand"), _stage("03-evidence")],
        final_text="done",
        total_latency_ms=1000,
        total_usage=TokenUsage(input_tokens=600, output_tokens=150),
        total_cost_cents=3.0,
    )
    fake_audit = MagicMock()
    fake_audit.record = AsyncMock()
    db = MagicMock()
    with patch(
        "app.services.audit_service.get_audit_service", return_value=fake_audit
    ):
        written = await write_swarm_audit(db, result)
    assert written == 10
    assert fake_audit.record.call_count == 10


@pytest.mark.asyncio
async def test_loopback_stage_skips_complete_record():
    """A stage that triggered a loopback emits 2 records (START +
    LLM_RESPONSE) but NOT a COMPLETE — the next iteration's START
    closes the bracket. 2 normal stages + 1 looper = 3*2 + 1*2 + 1
    summary = 9 records."""
    result = SwarmResult(
        stages=[
            _stage("01-seed"),
            _stage("02-expand"),
            _stage("09-score", triggered_loopback_to="03-evidence"),
        ],
        final_text="done",
        total_latency_ms=1000,
        loopbacks=[LoopbackEvent("09-score", "03-evidence", "weak", 2)],
        total_usage=TokenUsage(input_tokens=600, output_tokens=150),
        total_cost_cents=3.0,
    )
    fake_audit = MagicMock()
    fake_audit.record = AsyncMock()
    db = MagicMock()
    with patch(
        "app.services.audit_service.get_audit_service", return_value=fake_audit
    ):
        written = await write_swarm_audit(db, result)
    assert written == 9


@pytest.mark.asyncio
async def test_budget_abort_emits_pipeline_error_severity():
    """When budget_aborted=True, the summary record uses
    PIPELINE_ERROR + ERROR severity rather than PIPELINE_COMPLETE."""
    from app.services.audit_service import AuditEventType, AuditSeverity

    result = SwarmResult(
        stages=[_stage("01-seed", cost_cents=150.0)],
        final_text="aborted",
        total_latency_ms=500,
        total_usage=TokenUsage(input_tokens=200, output_tokens=50),
        total_cost_cents=150.0,
        budget_aborted=True,
        budget_abort_message="cap exceeded at stage 1",
    )
    fake_audit = MagicMock()
    fake_audit.record = AsyncMock()
    db = MagicMock()
    with patch(
        "app.services.audit_service.get_audit_service", return_value=fake_audit
    ):
        await write_swarm_audit(db, result)

    summary_call = fake_audit.record.call_args_list[-1]
    assert summary_call.kwargs["event_type"] == AuditEventType.PIPELINE_ERROR
    assert summary_call.kwargs["severity"] == AuditSeverity.ERROR
    assert summary_call.kwargs["details"]["budget_aborted"] is True


@pytest.mark.asyncio
async def test_individual_record_failure_does_not_abort():
    """If one audit.record() call raises, subsequent writes still
    happen — best-effort guarantee so a partial-write doesn't lose
    the whole audit trail for a run."""
    result = SwarmResult(
        stages=[_stage("01-seed"), _stage("02-expand")],
        final_text="done",
        total_latency_ms=1000,
        total_usage=TokenUsage(input_tokens=400, output_tokens=100),
        total_cost_cents=2.0,
    )
    fake_audit = MagicMock()
    # First call raises, subsequent calls succeed.
    side_effects = [RuntimeError("DB hiccup")] + [None] * 10
    fake_audit.record = AsyncMock(side_effect=side_effects)
    db = MagicMock()
    with patch(
        "app.services.audit_service.get_audit_service", return_value=fake_audit
    ):
        written = await write_swarm_audit(db, result)

    # Even though the first record threw, all 7 records were ATTEMPTED
    # (2 stages * 3 + 1 summary = 7). Written count = 6 (one failure).
    assert fake_audit.record.call_count == 7
    assert written == 6


@pytest.mark.asyncio
async def test_cost_usd_conversion():
    """SwarmStageResult.cost_cents (cents) → audit_record.cost_usd (dollars)."""
    result = SwarmResult(
        stages=[_stage("01-seed", cost_cents=42.5)],
        final_text="ok",
        total_latency_ms=100,
        total_usage=TokenUsage(input_tokens=200, output_tokens=50),
        total_cost_cents=42.5,
    )
    fake_audit = MagicMock()
    fake_audit.record = AsyncMock()
    db = MagicMock()
    with patch(
        "app.services.audit_service.get_audit_service", return_value=fake_audit
    ):
        await write_swarm_audit(db, result)

    # Find the LLM_RESPONSE record for the stage.
    llm_calls = [
        c for c in fake_audit.record.call_args_list
        if c.kwargs.get("resource_type") == "llm_call"
    ]
    assert len(llm_calls) == 1
    assert llm_calls[0].kwargs["cost_usd"] == pytest.approx(0.425)
    assert llm_calls[0].kwargs["tokens_input"] == 200
    assert llm_calls[0].kwargs["tokens_output"] == 50
