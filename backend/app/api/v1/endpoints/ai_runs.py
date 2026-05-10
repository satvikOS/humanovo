"""Admin endpoint: list recent agent-layer pipeline runs.

Endpoint: GET /admin/ai/runs?limit=50&since=ISO8601

Queries the Merkle-chained audit log for PIPELINE_COMPLETE and
PIPELINE_ERROR records emitted by `audit_writer.write_swarm_audit`,
returns a chronological list of recent runs with cost / token /
loopback summary data. Lets operators monitor agent-layer activity
without spelunking the database.

Response shape:

  {
    "runs": [
      {
        "sequence": 12345,
        "timestamp": "2026-05-10T18:42:11Z",
        "event_type": "pipeline.complete",
        "execution_id": "run-abc",
        "duration_ms": 86740,
        "cost_usd": 0.6814,
        "tokens_input": 141518,
        "tokens_output": 16481,
        "stages_completed": 12,
        "loopbacks_fired": 1,
        "budget_aborted": false,
        "cost_by_model": { "swarm[bedrock/...]": 31.82, ... },
        "final_text_preview": "..."
      },
      ...
    ],
    "total_returned": 27,
    "lookback_window": "24h"
  }

Auth: admin only — exposes raw cost/token data + final-answer
previews that an unauthenticated caller shouldn't see."""
from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import ADMIN_REQUIRED
from app.core.database import get_db
from app.core.rate_limit import rate_limit


router = APIRouter(dependencies=[*ADMIN_REQUIRED, Depends(rate_limit("admin"))])


@router.get("/admin/ai/runs")
async def list_recent_runs(
    db: AsyncSession = Depends(get_db),
    limit: int = Query(
        default=50,
        ge=1,
        le=500,
        description="Max runs to return.",
    ),
    lookback_hours: int = Query(
        default=24,
        ge=1,
        le=720,  # 30 days max
        description="Only return runs newer than this many hours.",
    ),
    only_aborts: bool = Query(
        default=False,
        description="If true, return only budget-aborted (PIPELINE_ERROR) runs.",
    ),
) -> dict[str, Any]:
    # Local import to keep this endpoint module light at import time
    # (audit_service pulls in the AuditRecord model + Base metadata).
    from app.services.audit_service import AuditEventType, AuditRecord

    cutoff = datetime.now(UTC) - timedelta(hours=lookback_hours)

    event_types: list[str] = []
    if only_aborts:
        event_types = [AuditEventType.PIPELINE_ERROR.value]
    else:
        event_types = [
            AuditEventType.PIPELINE_COMPLETE.value,
            AuditEventType.PIPELINE_ERROR.value,
        ]

    stmt = (
        select(AuditRecord)
        .where(AuditRecord.timestamp >= cutoff)
        .where(AuditRecord.event_type.in_(event_types))
        .order_by(AuditRecord.sequence.desc())
        .limit(limit)
    )
    rows = (await db.execute(stmt)).scalars().all()

    runs: list[dict[str, Any]] = []
    for r in rows:
        # `details` is a JSONB column; safe to unpack defensively in
        # case schema drift introduces missing keys.
        d = r.details or {}
        runs.append({
            "sequence": r.sequence,
            "timestamp": r.timestamp.isoformat() if r.timestamp else None,
            "event_type": r.event_type,
            "execution_id": r.execution_id,
            "user_id": r.user_id,
            "project_id": r.project_id,
            "duration_ms": r.duration_ms,
            "cost_usd": float(r.cost_usd) if r.cost_usd is not None else None,
            "tokens_input": r.tokens_input,
            "tokens_output": r.tokens_output,
            "stages_completed": d.get("stages_completed"),
            "loopbacks_fired": d.get("loopbacks_fired"),
            "budget_aborted": d.get("budget_aborted", False),
            "budget_abort_message": d.get("budget_abort_message"),
            "cost_by_model": d.get("cost_by_model"),
            "reasoning_tokens": d.get("reasoning_tokens"),
            "final_text_preview": d.get("final_text_preview"),
        })

    return {
        "runs": runs,
        "total_returned": len(runs),
        "lookback_window_hours": lookback_hours,
        "only_aborts": only_aborts,
    }
