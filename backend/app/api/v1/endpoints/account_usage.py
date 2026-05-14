"""User-facing usage + cost dashboard endpoints.

Two surfaces:

  • GET /api/v1/account/usage — returns the authenticated user's
    cost + token totals across configurable windows (today, this
    week, this month, last 30 days), plus per-day points so a chart
    can render. Cap progress relative to their tier.

  • GET /api/v1/account/cost-preview — non-admin wrapper around the
    pre-flight cost estimator. Returns the same projection the
    Settings page displays, calibrated to the caller's tier. Lets
    the DiscoveryRunner UI show "this run will cost ~$X" before the
    user clicks Start.

Both endpoints scope strictly to `current_user.id` — a user can
ONLY see their own usage; admin role NOT required and NOT honoured
(an admin who wants to look at user X's usage hits /admin/ai/runs
filtered by user_id).
"""
from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user
from app.core.database import get_db
from app.core.rate_limit import rate_limit
from app.models.user import User


router = APIRouter()


@router.get(
    "/account/usage",
    dependencies=[Depends(rate_limit("user"))],
)
async def get_account_usage(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    days: int = Query(default=30, ge=1, le=365, description="Lookback window in days"),
) -> dict[str, Any]:
    """Return the authenticated user's spend snapshot + per-day series.

    Window-totals: cost cents and token count over the requested N
    days (default 30).
    Per-day series: list of {date, cost_cents, runs} for charting.
    Cap progress: this month's cost vs the user's tier monthly cap.
    """
    cutoff = datetime.now(UTC) - timedelta(days=days)
    user_id_str = str(current_user.id)

    # ─── Window totals ───────────────────────────────────────
    totals_row = (await db.execute(
        text(
            """
            SELECT
                COALESCE(SUM(cost_usd * 100), 0)::numeric AS cost_cents,
                COALESCE(SUM(tokens_input), 0) AS tokens_in,
                COALESCE(SUM(tokens_output), 0) AS tokens_out,
                COUNT(*) FILTER (WHERE event_type = 'pipeline.complete') AS runs_complete,
                COUNT(*) FILTER (WHERE event_type = 'pipeline.error') AS runs_aborted
            FROM audit_log
            WHERE user_id = :uid
              AND timestamp >= :cutoff
            """
        ),
        {"uid": user_id_str, "cutoff": cutoff},
    )).first()

    if totals_row:
        cost_cents = float(totals_row[0] or 0)
        tokens_in = int(totals_row[1] or 0)
        tokens_out = int(totals_row[2] or 0)
        runs_complete = int(totals_row[3] or 0)
        runs_aborted = int(totals_row[4] or 0)
    else:
        cost_cents = 0.0
        tokens_in = tokens_out = runs_complete = runs_aborted = 0

    # ─── Per-day series ──────────────────────────────────────
    series_rows = (await db.execute(
        text(
            """
            SELECT
                DATE(timestamp) AS day,
                COALESCE(SUM(cost_usd * 100), 0)::numeric AS cost_cents,
                COUNT(*) FILTER (WHERE event_type IN ('pipeline.complete', 'pipeline.error')) AS runs
            FROM audit_log
            WHERE user_id = :uid
              AND timestamp >= :cutoff
            GROUP BY DATE(timestamp)
            ORDER BY day ASC
            """
        ),
        {"uid": user_id_str, "cutoff": cutoff},
    )).all()
    per_day = [
        {
            "date": row[0].isoformat() if row[0] else None,
            "cost_cents": float(row[1] or 0),
            "runs": int(row[2] or 0),
        }
        for row in series_rows
    ]

    # ─── Tier cap progress (this calendar month) ─────────────
    month_start = datetime.now(UTC).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    month_cost_row = (await db.execute(
        text(
            """
            SELECT COALESCE(SUM(cost_usd * 100), 0)::numeric
            FROM audit_log
            WHERE user_id = :uid
              AND timestamp >= :month_start
            """
        ),
        {"uid": user_id_str, "month_start": month_start},
    )).first()
    month_cost_cents = float(month_cost_row[0] if month_cost_row else 0)

    # Resolve the user's tier cap. Pulled from the same table the
    # budget enforcer reads, so reads stay consistent.
    cap_row = (await db.execute(
        text(
            "SELECT current_month_spend_cents, hard_limit_cents "
            "FROM user_budget_configs WHERE user_id = :uid"
        ),
        {"uid": user_id_str},
    )).first()
    if cap_row:
        # The enforcer's view of spend may diverge from audit_log
        # (timing window, retries) — surface BOTH so the UI can
        # show "as billed" vs "as audited" if drift appears.
        budget_spend_cents = int(cap_row[0] or 0)
        cap_cents = int(cap_row[1] or 0)
    else:
        # No budget row yet (typical for fresh users) — fall back
        # to the trial cap so the percentage doesn't show 0/0.
        budget_spend_cents = 0
        cap_cents = 50  # TIER_MONTHLY_CAP_CENTS["trial"]

    cap_used_pct = (budget_spend_cents / cap_cents * 100) if cap_cents else 0

    return {
        "user_id": user_id_str,
        "tier": current_user.tier.value if hasattr(current_user.tier, "value") else str(current_user.tier),
        "window_days": days,
        "totals": {
            "cost_cents": cost_cents,
            "cost_usd": round(cost_cents / 100, 4),
            "tokens_input": tokens_in,
            "tokens_output": tokens_out,
            "runs_complete": runs_complete,
            "runs_aborted": runs_aborted,
        },
        "this_month": {
            "spend_cents_audit": month_cost_cents,
            "spend_cents_budget": budget_spend_cents,
            "cap_cents": cap_cents,
            "cap_used_pct": round(cap_used_pct, 2),
            "remaining_cents": max(0, cap_cents - budget_spend_cents),
        },
        "per_day": per_day,
        "overage_enabled": bool(getattr(current_user, "overage_enabled", False)),
    }


@router.get(
    "/account/cost-preview",
    dependencies=[Depends(rate_limit("user"))],
)
async def get_cost_preview(
    n: int | None = Query(
        default=None,
        ge=1, le=300,
        description="Sub-agent fan-out (defaults to settings.SUB_AGENTS_PER_STAGE)",
    ),
    expected_loopbacks: int = Query(default=0, ge=0, le=3),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """Pre-flight cost estimate for a discovery run, scoped to the
    caller's tier. Mirrors /admin/ai/cost-estimate but enforces the
    user's monthly cap as the headroom for the projection.

    Returns the projected cost + a flag indicating whether the run
    would push the user over their tier cap (so the UI can show
    "Upgrade to keep going" before they hit the wall)."""
    from app.core.config import settings
    from app.services.agents.cost_estimator import estimate_run_cost
    from app.services.budget_enforcer_service import TIER_MONTHLY_CAP_CENTS

    n_subagents = n if n is not None else int(settings.SUB_AGENTS_PER_STAGE)
    estimate = estimate_run_cost(n_subagents=n_subagents, expected_loopbacks=expected_loopbacks)

    tier_value = (
        current_user.tier.value if hasattr(current_user.tier, "value")
        else str(current_user.tier)
    )
    cap_cents = TIER_MONTHLY_CAP_CENTS.get(tier_value, TIER_MONTHLY_CAP_CENTS.get("trial", 50))

    return {
        "n_subagents": estimate.n_subagents,
        "n_stages": estimate.n_stages,
        "expected_loopbacks": estimate.expected_loopbacks,
        "total_cost_cents": estimate.total_cost_cents,
        "total_cost_usd": round(estimate.total_cost_cents / 100, 4),
        "tier": tier_value,
        "tier_monthly_cap_cents": cap_cents,
        "would_exceed_cap_alone": estimate.total_cost_cents > cap_cents,
        "per_stage_breakdown": estimate.per_stage_breakdown,
        "overage_enabled": bool(getattr(current_user, "overage_enabled", False)),
        "overage_message": (
            "You have overage billing enabled — runs above your tier cap "
            "will be charged separately at $1.20 per run."
            if getattr(current_user, "overage_enabled", False)
            else "Runs above your tier cap will abort with a budget-exceeded "
                 "error. Enable overage billing in Settings to allow "
                 "automatic continuation."
        ),
    }


class BillingIntervalRequest(BaseModel):
    """Settings → Billing → "switch to annual" toggle. The actual
    Stripe-side price swap happens in the Customer Portal; this
    endpoint mirrors the user's preference locally so the
    cost-preview UI knows which cadence to project."""
    billing_interval: str  # 'monthly' | 'annual'


@router.put(
    "/account/billing-interval",
    dependencies=[Depends(rate_limit("user"))],
)
async def set_billing_interval(
    body: BillingIntervalRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    from fastapi import HTTPException, status

    if body.billing_interval not in ("monthly", "annual"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="billing_interval must be 'monthly' or 'annual'.",
        )
    await db.execute(
        text("UPDATE users SET billing_interval = :i WHERE id = :uid"),
        {"i": body.billing_interval, "uid": str(current_user.id)},
    )
    await db.commit()
    return {
        "status": "updated",
        "billing_interval": body.billing_interval,
        "note": (
            "Local preference saved. To actually switch your subscription "
            "to annual billing (with 17% discount), open the Stripe Customer "
            "Portal from Settings → Billing → Manage Subscription."
        ),
    }
