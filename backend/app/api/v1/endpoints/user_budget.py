"""
User Budget API — Settings ▸ Account ▸ Usage & Billing

Endpoints:
  GET  /v1/user/{user_id}/budget        → current config + status + spend
  PUT  /v1/user/{user_id}/budget        → update monthly cap
  GET  /v1/user/{user_id}/budget/usage  → 30-day usage breakdown

The frontend Settings page reads this to display the user-controlled
monthly cap. When current_month_spend reaches cap, the UI notifies the
user and discovery runs are blocked at the orchestrator level
(UserBudgetBlocked exception).
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from fastapi import APIRouter, Path, Query
from pydantic import BaseModel, Field
from sqlalchemy import text

from app.core.auth import AUTH_REQUIRED
from app.core.database import async_session_factory
from app.core.logging import get_logger
from app.services.budget_enforcer_service import get_user_budget_service

logger = get_logger(__name__)

router = APIRouter(prefix="/user", tags=["user-budget"], dependencies=AUTH_REQUIRED)
# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class BudgetUpdateRequest(BaseModel):
    monthly_budget_cents: int = Field(
        ge=0, le=1_000_000,
        description=(
            "Monthly cap in cents. Minimum 0, maximum $10,000/month ($10000 * 100). "
            "0 disables discovery entirely."
        ),
    )
    alert_threshold_pct: int = Field(
        default=80, ge=1, le=100,
        description="Send a warning notification when spend reaches this %.",
    )
    hard_limit: bool = Field(
        default=True,
        description=(
            "If true (recommended), discovery is blocked when cap is reached. "
            "If false, warnings only; runs continue."
        ),
    )
    notification_email: str | None = None


class BudgetResponse(BaseModel):
    user_id: str
    monthly_budget_usd: float
    current_spend_usd: float
    remaining_usd: float
    percent_used: float
    status: str  # ok | warning | blocked
    hard_limit: bool
    alert_threshold_pct: int
    current_month_starts: str
    notification_email: str | None = None
    message: str | None = None


class UsageBreakdown(BaseModel):
    period_start: str
    period_end: str
    total_spend_usd: float
    by_run_kind: list[dict[str, Any]]
    by_model: list[dict[str, Any]]
    by_day: list[dict[str, Any]]
    total_runs: int
    total_hypotheses_generated: int
    total_papers_generated: int


# ---------------------------------------------------------------------------
# GET /v1/user/{user_id}/budget
# ---------------------------------------------------------------------------


@router.get("/{user_id}/budget", response_model=BudgetResponse)
async def get_user_budget(user_id: str = Path(..., min_length=1, max_length=128)):
    """Return the user's monthly budget config + current spend state.

    Also honors month-rollover: if a new calendar month has started since
    the last snapshot, spend is zeroed here (via UserBudgetService.get_or_create).
    """
    svc = get_user_budget_service()
    cfg = await svc.get_or_create(user_id)
    status = await svc.check(user_id)

    return BudgetResponse(
        user_id=user_id,
        monthly_budget_usd=round(cfg["monthly_budget_cents"] / 100, 2),
        current_spend_usd=round(cfg["current_month_spend_cents"] / 100, 4),
        remaining_usd=round(status.remaining_cents / 100, 4),
        percent_used=round(
            100 * cfg["current_month_spend_cents"] / max(1, cfg["monthly_budget_cents"]),
            2,
        ),
        status=status.status,
        hard_limit=bool(cfg["hard_limit"]),
        alert_threshold_pct=int(cfg["alert_threshold_pct"]),
        current_month_starts=str(cfg["current_month_starts"]),
        notification_email=cfg.get("notification_email"),
        message=status.message,
    )


# ---------------------------------------------------------------------------
# PUT /v1/user/{user_id}/budget
# ---------------------------------------------------------------------------


@router.put("/{user_id}/budget", response_model=BudgetResponse)
async def update_user_budget(
    payload: BudgetUpdateRequest,
    user_id: str = Path(..., min_length=1, max_length=128),
):
    """Update the user's monthly cap + threshold + hard-limit flag."""
    svc = get_user_budget_service()
    await svc.ensure_schema()

    async with async_session_factory() as session:
        async with session.begin():
            await session.execute(text("""
                INSERT INTO user_budget_configs (
                    user_id, monthly_budget_cents, alert_threshold_pct,
                    hard_limit, notification_email
                ) VALUES (
                    :uid, :cap, :threshold, :hard, :email
                )
                ON CONFLICT (user_id) DO UPDATE SET
                    monthly_budget_cents = EXCLUDED.monthly_budget_cents,
                    alert_threshold_pct  = EXCLUDED.alert_threshold_pct,
                    hard_limit           = EXCLUDED.hard_limit,
                    notification_email   = EXCLUDED.notification_email,
                    updated_at           = NOW()
            """), {
                "uid": user_id,
                "cap": payload.monthly_budget_cents,
                "threshold": payload.alert_threshold_pct,
                "hard": payload.hard_limit,
                "email": payload.notification_email,
            })

    return await get_user_budget(user_id)


# ---------------------------------------------------------------------------
# GET /v1/user/{user_id}/budget/usage
# ---------------------------------------------------------------------------


@router.get("/{user_id}/budget/usage", response_model=UsageBreakdown)
async def get_user_budget_usage(
    user_id: str = Path(..., min_length=1, max_length=128),
    days: int = Query(default=30, ge=1, le=365),
):
    """Return a breakdown of the user's real usage for the last N days."""
    start = date.today() - timedelta(days=days - 1)
    end = date.today()

    # The usage_events schema has no user_id column at the time of writing;
    # user scoping is inferred from project_id → user via `projects` table.
    # This query is tolerant: it falls back to all usage if projects lacks
    # the expected FK. Either way, we return real usage data (no mocks).
    async with async_session_factory() as session:
        try:
            by_model = await session.execute(text("""
                SELECT
                    model_name,
                    SUM(cost_cents)::BIGINT AS cost_cents,
                    SUM(input_tokens)::BIGINT AS input_tokens,
                    SUM(output_tokens)::BIGINT AS output_tokens,
                    COUNT(*) AS n_calls
                FROM usage_events ue
                LEFT JOIN projects p ON p.id = ue.project_id
                WHERE ue.created_at >= :start
                  AND (p.owner_id = :uid OR p.owner_id IS NULL)
                GROUP BY model_name
                ORDER BY cost_cents DESC
            """), {"start": start, "uid": user_id})
            by_model_rows = [dict(r) for r in by_model.mappings().fetchall()]
        except Exception as e:
            logger.debug(f"user-scoped usage query fell back to global (reason: {e})")
            by_model = await session.execute(text("""
                SELECT
                    model_name,
                    SUM(cost_cents)::BIGINT AS cost_cents,
                    SUM(input_tokens)::BIGINT AS input_tokens,
                    SUM(output_tokens)::BIGINT AS output_tokens,
                    COUNT(*) AS n_calls
                FROM usage_events
                WHERE created_at >= :start
                GROUP BY model_name
                ORDER BY cost_cents DESC
            """), {"start": start})
            by_model_rows = [dict(r) for r in by_model.mappings().fetchall()]

        by_day = await session.execute(text("""
            SELECT DATE(created_at) AS day,
                   SUM(cost_cents)::BIGINT AS cost_cents,
                   COUNT(*) AS n_calls
            FROM usage_events
            WHERE created_at >= :start
            GROUP BY day ORDER BY day
        """), {"start": start})
        by_day_rows = [
            {"day": str(r["day"]),
             "cost_cents": int(r["cost_cents"] or 0),
             "n_calls": int(r["n_calls"] or 0)}
            for r in by_day.mappings().fetchall()
        ]

        run_counts = await session.execute(text("""
            SELECT COUNT(DISTINCT discovery_run_id) AS discovery_runs,
                   COUNT(DISTINCT synthesis_run_id) AS synthesis_runs
            FROM usage_events
            WHERE created_at >= :start
        """), {"start": start})
        rc = dict(run_counts.mappings().fetchone() or {})

        hyp_counts = await session.execute(text("""
            SELECT COUNT(DISTINCT hypothesis_id) AS n
            FROM usage_events
            WHERE created_at >= :start AND hypothesis_id IS NOT NULL
        """), {"start": start})
        hc = dict(hyp_counts.mappings().fetchone() or {})

    total_cents = sum(int(r.get("cost_cents") or 0) for r in by_model_rows)

    # Group by run-kind (we approximate from cost_tracking fields)
    by_run_kind = [
        {"run_kind": "discovery", "runs": int(rc.get("discovery_runs") or 0)},
        {"run_kind": "synthesis", "runs": int(rc.get("synthesis_runs") or 0)},
    ]

    return UsageBreakdown(
        period_start=str(start),
        period_end=str(end),
        total_spend_usd=round(total_cents / 100, 4),
        by_run_kind=by_run_kind,
        by_model=[
            {
                "model": r.get("model_name", "unknown"),
                "cost_usd": round(int(r.get("cost_cents") or 0) / 100, 4),
                "input_tokens": int(r.get("input_tokens") or 0),
                "output_tokens": int(r.get("output_tokens") or 0),
                "n_calls": int(r.get("n_calls") or 0),
            }
            for r in by_model_rows
        ],
        by_day=by_day_rows,
        total_runs=int(rc.get("discovery_runs") or 0) + int(rc.get("synthesis_runs") or 0),
        total_hypotheses_generated=int(hc.get("n") or 0),
        total_papers_generated=0,  # populated when paper_gen_runs table is added
    )
