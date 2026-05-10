"""Pre-flight cost estimate for the swarm pipeline.

Endpoint: GET /admin/ai/cost-estimate

Returns a projected USD cost for one full 12-stage discovery run at
the current sub-agent fan-out (or an explicit `?n=...` override).
The desktop UI calls this before a user hits "Start discovery" so
the user sees what their next click will spend.

Response shape:

  {
    "n_subagents": 25,
    "n_stages": 12,
    "expected_loopbacks": 0,
    "sub_agent_cost_cents": 405.2,
    "aggregator_cost_cents": 91.7,
    "total_cost_cents": 496.9,
    "total_cost_usd": 4.97,
    "budget_per_run_cents": 200,
    "would_abort": true,
    "abort_reason": "Estimate ¢496.90 exceeds budget ¢200.00; "
                    "lower SUB_AGENTS_PER_STAGE or raise BUDGET_PER_RUN_CENTS.",
    "per_stage_breakdown": [...],
    "notes": "..."
  }

Scope: admin-only. The cost estimator carries no LLM call (pure math
on the pricing table) so it's cheap, but exposing the pricing detail
to unauthenticated callers leaks our cost basis."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query

from app.core.auth import ADMIN_REQUIRED
from app.core.config import settings
from app.core.rate_limit import rate_limit
from app.services.agents.cost_estimator import estimate_run_cost

router = APIRouter(dependencies=[*ADMIN_REQUIRED, Depends(rate_limit("admin"))])


@router.get("/admin/ai/cost-estimate")
async def get_cost_estimate(
    n: int | None = Query(
        default=None,
        description="Sub-agent fan-out override. Defaults to settings.SUB_AGENTS_PER_STAGE.",
        ge=1,
        le=1000,
    ),
    expected_loopbacks: int = Query(
        default=0,
        description="Expected critic loopbacks (0–3). Each loopback re-runs ~3 stages.",
        ge=0,
        le=3,
    ),
) -> dict[str, Any]:
    n_subagents = n if n is not None else int(settings.SUB_AGENTS_PER_STAGE)
    estimate = estimate_run_cost(
        n_subagents=n_subagents,
        expected_loopbacks=expected_loopbacks,
    )
    budget_cents = int(settings.BUDGET_PER_RUN_CENTS)
    would_abort = budget_cents > 0 and estimate.total_cost_cents > budget_cents
    abort_reason = None
    if would_abort:
        abort_reason = (
            f"Estimate ¢{estimate.total_cost_cents:.2f} exceeds budget "
            f"¢{budget_cents:.2f}; lower SUB_AGENTS_PER_STAGE or raise "
            f"BUDGET_PER_RUN_CENTS."
        )
    notes = (
        "Estimate is based on empirical per-stage averages from the "
        "AI integration smoke. Real-world costs typically land 10-20% "
        "under this projection; topics that trigger critic loopbacks "
        "(set expected_loopbacks=1 or 2) cost more."
    )
    return {
        "n_subagents": estimate.n_subagents,
        "n_stages": estimate.n_stages,
        "expected_loopbacks": estimate.expected_loopbacks,
        "sub_agent_cost_cents": estimate.sub_agent_cost_cents,
        "aggregator_cost_cents": estimate.aggregator_cost_cents,
        "total_cost_cents": estimate.total_cost_cents,
        "total_cost_usd": round(estimate.total_cost_cents / 100, 4),
        "budget_per_run_cents": budget_cents,
        "would_abort": would_abort,
        "abort_reason": abort_reason,
        "per_stage_breakdown": estimate.per_stage_breakdown,
        "notes": notes,
    }
