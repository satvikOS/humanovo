"""Audit-log writer for SwarmResult / AgentResult.

Bridges the grounded-agent layer's in-memory traces into the
project's existing Merkle-chained audit log
(`app/services/audit_service.py`). Every production swarm run lands
as a sequence of audit records:

  • One LLM_REQUEST / LLM_RESPONSE pair per stage (with token/cost
    detail attached).
  • One STAGE_START / STAGE_COMPLETE pair per stage.
  • One PIPELINE_COMPLETE summary record (or PIPELINE_ERROR if the
    swarm aborted via budget cap).
  • Loopback transitions logged as STAGE_START records with iteration > 1
    plus a `triggered_by` field pointing at the critic that fired.

Why this matters: the Merkle chain in audit_service is what gives the
discovery pipeline its tamper-evident provenance. Every claim in a
final hypothesis must trace back to the LLM call(s) + tool result(s)
that produced it; without writing the swarm's per-stage cost/usage
into audit, the production audit log would have a gap when the new
agent layer is the active code path.

Usage from the orchestrator (Phase 3) or any caller of Swarm.run():

    from app.services.agents.audit_writer import write_swarm_audit
    result = await swarm.run(query, tools)
    await write_swarm_audit(db, result, context=audit_ctx)
"""
from __future__ import annotations

import logging
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from app.services.agents.swarm import SwarmResult


logger = logging.getLogger(__name__)


async def write_swarm_audit(
    db: "AsyncSession",
    result: "SwarmResult",
    *,
    context=None,
    pipeline_name: str = "discovery_pipeline",
) -> int:
    """Write a SwarmResult to the audit log. Returns the number of
    audit records emitted (1 summary + 2 per stage + 1 per loopback).

    Best-effort: a write failure on any individual record is logged
    but doesn't abort. The chain integrity invariant is maintained
    by the audit service's internal sequence counter.
    """
    # Local imports — keep this module free of heavy deps at import
    # time so the swarm-only smoke (which doesn't have SQLAlchemy
    # available) doesn't break.
    from app.services.audit_service import (
        AuditEventType,
        AuditSeverity,
        get_audit_service,
    )

    audit = get_audit_service()
    written = 0

    for stage in result.stages:
        # STAGE_START — one per iteration, so loopback re-runs show
        # as separate START events.
        try:
            await audit.record(
                db=db,
                event_type=AuditEventType.STAGE_START,
                action=f"{pipeline_name}.{stage.name}.start",
                context=context,
                resource_type="pipeline_stage",
                resource_id=stage.name,
                details={
                    "model_label": stage.model_label,
                    "iteration": stage.iteration,
                    "is_loopback_rerun": stage.iteration > 1,
                    "sub_agent_count": stage.sub_agent_count,
                },
            )
            written += 1
        except Exception as e:
            logger.warning("audit STAGE_START write failed (%s): %s", stage.name, e)

        # LLM_RESPONSE — captures token usage + cost. Severity bumps
        # to WARNING when the stage exited via max_steps without a
        # final answer so monitoring can surface degraded runs.
        severity = AuditSeverity.INFO
        if stage.text and "(stage exited without a narrative answer" in stage.text:
            severity = AuditSeverity.WARNING

        try:
            await audit.record(
                db=db,
                event_type=AuditEventType.LLM_RESPONSE,
                action=f"{pipeline_name}.{stage.name}.llm",
                context=context,
                severity=severity,
                resource_type="llm_call",
                resource_id=stage.model_label,
                details={
                    "stage": stage.name,
                    "iteration": stage.iteration,
                    "step_count": stage.step_count,
                    "tool_call_count": stage.tool_call_count,
                    "sub_agent_successes": stage.sub_agent_successes,
                    "sub_agent_failures": stage.sub_agent_failures,
                    "reasoning_tokens": stage.usage.reasoning_tokens,
                    "cached_tokens": stage.usage.cached_tokens,
                    "loopback_to": stage.triggered_loopback_to,
                    "loopback_reason": stage.loopback_reason,
                },
                duration_ms=stage.latency_ms,
                cost_usd=stage.cost_cents / 100.0,
                tokens_input=stage.usage.input_tokens,
                tokens_output=stage.usage.output_tokens,
            )
            written += 1
        except Exception as e:
            logger.warning("audit LLM_RESPONSE write failed (%s): %s", stage.name, e)

        # STAGE_COMPLETE — closes the bracket. Skipped when the stage
        # triggered a loopback (it'll re-START at iteration+1 next).
        if stage.triggered_loopback_to is not None:
            continue
        try:
            await audit.record(
                db=db,
                event_type=AuditEventType.STAGE_COMPLETE,
                action=f"{pipeline_name}.{stage.name}.complete",
                context=context,
                resource_type="pipeline_stage",
                resource_id=stage.name,
                details={
                    "iteration": stage.iteration,
                    "tokens_total": stage.usage.input_tokens + stage.usage.output_tokens,
                },
                duration_ms=stage.latency_ms,
                cost_usd=stage.cost_cents / 100.0,
            )
            written += 1
        except Exception as e:
            logger.warning("audit STAGE_COMPLETE write failed (%s): %s", stage.name, e)

    # PIPELINE summary — one record at the end of the run.
    summary_event = (
        AuditEventType.PIPELINE_ERROR
        if result.budget_aborted
        else AuditEventType.PIPELINE_COMPLETE
    )
    summary_severity = (
        AuditSeverity.ERROR if result.budget_aborted else AuditSeverity.INFO
    )
    try:
        await audit.record(
            db=db,
            event_type=summary_event,
            action=f"{pipeline_name}.run.complete",
            context=context,
            severity=summary_severity,
            resource_type="pipeline_run",
            details={
                "stages_completed": len(result.stages),
                "loopbacks_fired": len(result.loopbacks),
                "budget_aborted": result.budget_aborted,
                "budget_abort_message": result.budget_abort_message,
                "cost_by_model": result.cost_by_model,
                "reasoning_tokens": result.total_usage.reasoning_tokens,
                "final_text_preview": (result.final_text or "")[:500],
            },
            duration_ms=result.total_latency_ms,
            cost_usd=result.total_cost_cents / 100.0,
            tokens_input=result.total_usage.input_tokens,
            tokens_output=result.total_usage.output_tokens,
        )
        written += 1
    except Exception as e:
        logger.warning("audit PIPELINE summary write failed: %s", e)

    return written
