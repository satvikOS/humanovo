"""
Cost Tracking Service per Project Jamison v2 Spec Section 21.

Wraps all LLM/embedding/API calls with cost recording to usage_events table.
Provides summary queries for billing dashboard.
"""

import json
import os
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any, Literal, Optional

from sqlalchemy import text

from app.core.database import async_session_factory
from app.core.logging import get_logger

logger = get_logger(__name__)


# ═══════════════════════════════════════════════════════════════════════
# Pricing loader — reads config/model_pricing.json once, caches in memory
# ═══════════════════════════════════════════════════════════════════════

_pricing: Optional[dict] = None


def _load_pricing() -> dict:
    global _pricing
    if _pricing is None:
        path = os.path.join(
            os.path.dirname(__file__), "../../config/model_pricing.json"
        )
        try:
            with open(path) as f:
                _pricing = json.load(f)
        except Exception as e:
            logger.warning(f"Could not load model pricing from {path}: {e}")
            _pricing = {}
    return _pricing


def compute_cost_cents(
    model_name: str,
    input_tokens: int,
    output_tokens: int,
    cached_tokens: int = 0,
) -> Decimal:
    """Compute cost in fractional cents using model_pricing.json.

    The pricing file stores costs per 1 million tokens in cents.
    Cached tokens are subtracted from input_tokens for billing
    (most providers charge nothing or a reduced rate for cached tokens;
    our pricing file does not carry a separate cached rate, so we treat
    cached tokens as free).
    """
    pricing = _load_pricing()
    entry = pricing.get(model_name)
    if not entry:
        # Try case-insensitive partial match
        for key, val in pricing.items():
            if key.lower() in model_name.lower() or model_name.lower() in key.lower():
                entry = val
                break
    if not entry:
        logger.warning(
            "No pricing entry for model %s — recording 0 cost", model_name
        )
        return Decimal("0")

    input_rate = Decimal(str(entry.get("input_cost_per_1m_tokens_cents", 0)))
    output_rate = Decimal(str(entry.get("output_cost_per_1m_tokens_cents", 0)))

    billable_input = max(0, input_tokens - cached_tokens)
    input_cost = Decimal(billable_input) * input_rate / Decimal("1000000")
    output_cost = Decimal(output_tokens) * output_rate / Decimal("1000000")
    return (input_cost + output_cost).quantize(Decimal("0.0001"))


# ═══════════════════════════════════════════════════════════════════════
# Data classes
# ═══════════════════════════════════════════════════════════════════════


@dataclass
class BudgetStatus:
    status: Literal["ok", "warning", "blocked"]
    current_spend_cents: int = 0
    budget_cents: int = 0
    remaining_cents: int = 0
    threshold_pct: int = 80
    hard_limit: bool = False
    message: str = ""


@dataclass
class UsageSummary:
    total_cost_cents: float = 0.0
    total_input_tokens: int = 0
    total_output_tokens: int = 0
    total_cached_tokens: int = 0
    total_requests: int = 0
    total_errors: int = 0
    period_start: Optional[str] = None
    period_end: Optional[str] = None
    by_provider: list[dict[str, Any]] = field(default_factory=list)
    by_model: list[dict[str, Any]] = field(default_factory=list)


# ═══════════════════════════════════════════════════════════════════════
# CostTracker
# ═══════════════════════════════════════════════════════════════════════


class CostTracker:
    """Records every external API call to usage_events and provides
    aggregation queries for the billing dashboard."""

    def __init__(self, session_factory=None):
        self._session_factory = session_factory or async_session_factory

    # ── Recording methods ──────────────────────────────────────────────

    async def record_llm_call(
        self,
        provider: str,
        model_name: str,
        input_tokens: int,
        output_tokens: int,
        cached_tokens: int = 0,
        latency_ms: Optional[int] = None,
        project_id: Optional[str] = None,
        discovery_run_id: Optional[str] = None,
        synthesis_run_id: Optional[str] = None,
        stage_execution_id: Optional[str] = None,
        stage_number: Optional[int] = None,
        stage_name: Optional[str] = None,
        hypothesis_id: Optional[str] = None,
        round_number: Optional[int] = None,
        is_retry: bool = False,
        error_message: Optional[str] = None,
    ) -> str:
        """Insert a single LLM call into usage_events with computed cost."""
        cost = compute_cost_cents(model_name, input_tokens, output_tokens, cached_tokens)

        async with self._session_factory() as session:
            async with session.begin():
                result = await session.execute(
                    text("""
                        INSERT INTO usage_events (
                            project_id, discovery_run_id, synthesis_run_id,
                            stage_execution_id, provider, model_name,
                            input_tokens, output_tokens, cached_tokens,
                            cost_cents, latency_ms,
                            stage_number, stage_name,
                            hypothesis_id, round_number,
                            is_retry, is_embedding, is_search,
                            error_message
                        ) VALUES (
                            :project_id, :discovery_run_id, :synthesis_run_id,
                            :stage_execution_id, :provider, :model_name,
                            :input_tokens, :output_tokens, :cached_tokens,
                            :cost_cents, :latency_ms,
                            :stage_number, :stage_name,
                            :hypothesis_id, :round_number,
                            :is_retry, FALSE, FALSE,
                            :error_message
                        )
                        RETURNING id
                    """),
                    {
                        "project_id": project_id,
                        "discovery_run_id": discovery_run_id,
                        "synthesis_run_id": synthesis_run_id,
                        "stage_execution_id": stage_execution_id,
                        "provider": provider,
                        "model_name": model_name,
                        "input_tokens": input_tokens,
                        "output_tokens": output_tokens,
                        "cached_tokens": cached_tokens,
                        "cost_cents": cost,
                        "latency_ms": latency_ms,
                        "stage_number": stage_number,
                        "stage_name": stage_name,
                        "hypothesis_id": hypothesis_id,
                        "round_number": round_number,
                        "is_retry": is_retry,
                        "error_message": error_message,
                    },
                )
                row = result.fetchone()

                # Update budget spend if project-scoped
                if project_id and cost > 0:
                    await self._increment_budget_spend(session, project_id, int(cost))

                return str(row[0])

    async def record_embedding_call(
        self,
        provider: str,
        model_name: str,
        token_count: int,
        latency_ms: Optional[int] = None,
        project_id: Optional[str] = None,
        discovery_run_id: Optional[str] = None,
        stage_number: Optional[int] = None,
        stage_name: Optional[str] = None,
        hypothesis_id: Optional[str] = None,
        error_message: Optional[str] = None,
    ) -> str:
        """Record an embedding API call (input_tokens = token_count, output = 0)."""
        cost = compute_cost_cents(model_name, token_count, 0)

        async with self._session_factory() as session:
            async with session.begin():
                result = await session.execute(
                    text("""
                        INSERT INTO usage_events (
                            project_id, discovery_run_id,
                            provider, model_name,
                            input_tokens, output_tokens, cached_tokens,
                            cost_cents, latency_ms,
                            stage_number, stage_name,
                            hypothesis_id,
                            is_retry, is_embedding, is_search,
                            error_message
                        ) VALUES (
                            :project_id, :discovery_run_id,
                            :provider, :model_name,
                            :token_count, 0, 0,
                            :cost_cents, :latency_ms,
                            :stage_number, :stage_name,
                            :hypothesis_id,
                            FALSE, TRUE, FALSE,
                            :error_message
                        )
                        RETURNING id
                    """),
                    {
                        "project_id": project_id,
                        "discovery_run_id": discovery_run_id,
                        "provider": provider,
                        "model_name": model_name,
                        "token_count": token_count,
                        "cost_cents": cost,
                        "latency_ms": latency_ms,
                        "stage_number": stage_number,
                        "stage_name": stage_name,
                        "hypothesis_id": hypothesis_id,
                        "error_message": error_message,
                    },
                )
                row = result.fetchone()

                if project_id and cost > 0:
                    await self._increment_budget_spend(session, project_id, int(cost))

                return str(row[0])

    async def record_search_call(
        self,
        provider: str,
        source_name: str,
        latency_ms: Optional[int] = None,
        project_id: Optional[str] = None,
        discovery_run_id: Optional[str] = None,
        stage_number: Optional[int] = None,
        stage_name: Optional[str] = None,
        hypothesis_id: Optional[str] = None,
        error_message: Optional[str] = None,
    ) -> str:
        """Record a data source / search API call (e.g. PubMed, ClinicalTrials).

        Most biomedical APIs are free, so cost_cents = 0 unless pricing
        is configured in model_pricing.json.
        """
        cost = compute_cost_cents(source_name, 0, 0)

        async with self._session_factory() as session:
            async with session.begin():
                result = await session.execute(
                    text("""
                        INSERT INTO usage_events (
                            project_id, discovery_run_id,
                            provider, model_name,
                            input_tokens, output_tokens, cached_tokens,
                            cost_cents, latency_ms,
                            stage_number, stage_name,
                            hypothesis_id,
                            is_retry, is_embedding, is_search,
                            error_message
                        ) VALUES (
                            :project_id, :discovery_run_id,
                            :provider, :source_name,
                            0, 0, 0,
                            :cost_cents, :latency_ms,
                            :stage_number, :stage_name,
                            :hypothesis_id,
                            FALSE, FALSE, TRUE,
                            :error_message
                        )
                        RETURNING id
                    """),
                    {
                        "project_id": project_id,
                        "discovery_run_id": discovery_run_id,
                        "provider": provider,
                        "source_name": source_name,
                        "cost_cents": cost,
                        "latency_ms": latency_ms,
                        "stage_number": stage_number,
                        "stage_name": stage_name,
                        "hypothesis_id": hypothesis_id,
                        "error_message": error_message,
                    },
                )
                row = result.fetchone()
                return str(row[0])

    # ── Query / summary methods ────────────────────────────────────────

    async def get_summary(
        self,
        project_id: Optional[str] = None,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
    ) -> UsageSummary:
        """Monthly (or custom range) usage summary with provider/model breakdowns."""
        if start_date is None:
            start_date = date.today().replace(day=1)
        if end_date is None:
            end_date = date.today()

        where_clauses = ["created_at >= :start_date", "created_at < :end_date + INTERVAL '1 day'"]
        params: dict[str, Any] = {
            "start_date": start_date,
            "end_date": end_date,
        }
        if project_id is not None:
            where_clauses.append("project_id = :project_id")
            params["project_id"] = project_id

        where_sql = " AND ".join(where_clauses)

        async with self._session_factory() as session:
            # Grand totals
            totals = await session.execute(
                text(f"""
                    SELECT
                        COALESCE(SUM(cost_cents), 0)        AS total_cost_cents,
                        COALESCE(SUM(input_tokens), 0)      AS total_input_tokens,
                        COALESCE(SUM(output_tokens), 0)     AS total_output_tokens,
                        COALESCE(SUM(cached_tokens), 0)     AS total_cached_tokens,
                        COUNT(*)                             AS total_requests,
                        COUNT(*) FILTER (WHERE error_message IS NOT NULL) AS total_errors
                    FROM usage_events
                    WHERE {where_sql}
                """),
                params,
            )
            t = totals.mappings().fetchone()

            # By provider
            prov_rows = await session.execute(
                text(f"""
                    SELECT
                        provider,
                        COALESCE(SUM(cost_cents), 0) AS cost_cents,
                        COALESCE(SUM(input_tokens), 0) AS input_tokens,
                        COALESCE(SUM(output_tokens), 0) AS output_tokens,
                        COUNT(*) AS requests
                    FROM usage_events
                    WHERE {where_sql}
                    GROUP BY provider
                    ORDER BY cost_cents DESC
                """),
                params,
            )

            # By model
            model_rows = await session.execute(
                text(f"""
                    SELECT
                        provider,
                        model_name,
                        COALESCE(SUM(cost_cents), 0) AS cost_cents,
                        COALESCE(SUM(input_tokens), 0) AS input_tokens,
                        COALESCE(SUM(output_tokens), 0) AS output_tokens,
                        COUNT(*) AS requests
                    FROM usage_events
                    WHERE {where_sql}
                    GROUP BY provider, model_name
                    ORDER BY cost_cents DESC
                """),
                params,
            )

            return UsageSummary(
                total_cost_cents=float(t["total_cost_cents"]),
                total_input_tokens=int(t["total_input_tokens"]),
                total_output_tokens=int(t["total_output_tokens"]),
                total_cached_tokens=int(t["total_cached_tokens"]),
                total_requests=int(t["total_requests"]),
                total_errors=int(t["total_errors"]),
                period_start=start_date.isoformat(),
                period_end=end_date.isoformat(),
                by_provider=[
                    {
                        "provider": r["provider"],
                        "cost_cents": float(r["cost_cents"]),
                        "input_tokens": int(r["input_tokens"]),
                        "output_tokens": int(r["output_tokens"]),
                        "requests": int(r["requests"]),
                    }
                    for r in prov_rows.mappings()
                ],
                by_model=[
                    {
                        "provider": r["provider"],
                        "model_name": r["model_name"],
                        "cost_cents": float(r["cost_cents"]),
                        "input_tokens": int(r["input_tokens"]),
                        "output_tokens": int(r["output_tokens"]),
                        "requests": int(r["requests"]),
                    }
                    for r in model_rows.mappings()
                ],
            )

    async def get_daily_breakdown(
        self,
        start_date: date,
        end_date: date,
        project_id: Optional[str] = None,
        group_by: str = "provider",
    ) -> list[dict[str, Any]]:
        """Daily cost breakdown grouped by provider or model."""
        where_clauses = [
            "created_at >= :start_date",
            "created_at < :end_date + INTERVAL '1 day'",
        ]
        params: dict[str, Any] = {
            "start_date": start_date,
            "end_date": end_date,
        }
        if project_id is not None:
            where_clauses.append("project_id = :project_id")
            params["project_id"] = project_id

        where_sql = " AND ".join(where_clauses)

        if group_by == "model":
            group_col = "model_name"
        else:
            group_col = "provider"

        async with self._session_factory() as session:
            rows = await session.execute(
                text(f"""
                    SELECT
                        DATE(created_at) AS day,
                        {group_col},
                        COALESCE(SUM(cost_cents), 0)    AS cost_cents,
                        COALESCE(SUM(input_tokens), 0)  AS input_tokens,
                        COALESCE(SUM(output_tokens), 0) AS output_tokens,
                        COUNT(*)                         AS requests,
                        ROUND(AVG(latency_ms)::numeric, 2) AS avg_latency_ms
                    FROM usage_events
                    WHERE {where_sql}
                    GROUP BY day, {group_col}
                    ORDER BY day, cost_cents DESC
                """),
                params,
            )

            return [
                {
                    "day": r["day"].isoformat() if r["day"] else None,
                    group_by: r[group_col],
                    "cost_cents": float(r["cost_cents"]),
                    "input_tokens": int(r["input_tokens"]),
                    "output_tokens": int(r["output_tokens"]),
                    "requests": int(r["requests"]),
                    "avg_latency_ms": float(r["avg_latency_ms"])
                    if r["avg_latency_ms"] is not None
                    else None,
                }
                for r in rows.mappings()
            ]

    async def get_model_breakdown(
        self,
        period: str = "30d",
        project_id: Optional[str] = None,
    ) -> list[dict[str, Any]]:
        """Cost breakdown by model over a time period (e.g. '7d', '30d', '90d')."""
        days = int(period.rstrip("d")) if period.endswith("d") else 30
        since = date.today() - timedelta(days=days)

        where_clauses = ["created_at >= :since"]
        params: dict[str, Any] = {"since": since}
        if project_id is not None:
            where_clauses.append("project_id = :project_id")
            params["project_id"] = project_id

        where_sql = " AND ".join(where_clauses)

        async with self._session_factory() as session:
            rows = await session.execute(
                text(f"""
                    SELECT
                        provider,
                        model_name,
                        COALESCE(SUM(cost_cents), 0)    AS cost_cents,
                        COALESCE(SUM(input_tokens), 0)  AS input_tokens,
                        COALESCE(SUM(output_tokens), 0) AS output_tokens,
                        COALESCE(SUM(cached_tokens), 0) AS cached_tokens,
                        COUNT(*)                         AS requests,
                        COUNT(*) FILTER (WHERE error_message IS NOT NULL) AS errors,
                        ROUND(AVG(latency_ms)::numeric, 2) AS avg_latency_ms
                    FROM usage_events
                    WHERE {where_sql}
                    GROUP BY provider, model_name
                    ORDER BY cost_cents DESC
                """),
                params,
            )

            return [
                {
                    "provider": r["provider"],
                    "model_name": r["model_name"],
                    "cost_cents": float(r["cost_cents"]),
                    "input_tokens": int(r["input_tokens"]),
                    "output_tokens": int(r["output_tokens"]),
                    "cached_tokens": int(r["cached_tokens"]),
                    "requests": int(r["requests"]),
                    "errors": int(r["errors"]),
                    "avg_latency_ms": float(r["avg_latency_ms"])
                    if r["avg_latency_ms"] is not None
                    else None,
                }
                for r in rows.mappings()
            ]

    async def get_project_costs(
        self,
        period: str = "30d",
    ) -> list[dict[str, Any]]:
        """Per-project cost totals over a time period."""
        days = int(period.rstrip("d")) if period.endswith("d") else 30
        since = date.today() - timedelta(days=days)

        async with self._session_factory() as session:
            rows = await session.execute(
                text("""
                    SELECT
                        ue.project_id,
                        p.name AS project_name,
                        COALESCE(SUM(ue.cost_cents), 0)    AS cost_cents,
                        COALESCE(SUM(ue.input_tokens), 0)  AS input_tokens,
                        COALESCE(SUM(ue.output_tokens), 0) AS output_tokens,
                        COUNT(*)                             AS requests,
                        COUNT(*) FILTER (WHERE ue.error_message IS NOT NULL) AS errors,
                        COUNT(DISTINCT ue.discovery_run_id)
                            FILTER (WHERE ue.discovery_run_id IS NOT NULL) AS discovery_runs,
                        COUNT(DISTINCT ue.synthesis_run_id)
                            FILTER (WHERE ue.synthesis_run_id IS NOT NULL) AS synthesis_runs
                    FROM usage_events ue
                    LEFT JOIN projects p ON p.id = ue.project_id
                    WHERE ue.created_at >= :since
                      AND ue.project_id IS NOT NULL
                    GROUP BY ue.project_id, p.name
                    ORDER BY cost_cents DESC
                """),
                {"since": since},
            )

            return [
                {
                    "project_id": str(r["project_id"]),
                    "project_name": r["project_name"],
                    "cost_cents": float(r["cost_cents"]),
                    "input_tokens": int(r["input_tokens"]),
                    "output_tokens": int(r["output_tokens"]),
                    "requests": int(r["requests"]),
                    "errors": int(r["errors"]),
                    "discovery_runs": int(r["discovery_runs"]),
                    "synthesis_runs": int(r["synthesis_runs"]),
                }
                for r in rows.mappings()
            ]

    async def check_budget(
        self,
        project_id: Optional[str] = None,
    ) -> BudgetStatus:
        """Check whether the project (or global) budget allows further spending."""
        async with self._session_factory() as session:
            # Try project-level budget first, fall back to global
            if project_id is not None:
                row = await session.execute(
                    text("""
                        SELECT id, scope, monthly_budget_cents,
                               alert_threshold_pct, hard_limit,
                               current_month_spend_cents
                        FROM budget_configs
                        WHERE scope = 'project' AND project_id = :project_id
                        LIMIT 1
                    """),
                    {"project_id": project_id},
                )
                budget = row.mappings().fetchone()
                if budget is not None:
                    return self._evaluate_budget(budget)

            # Global budget
            row = await session.execute(
                text("""
                    SELECT id, scope, monthly_budget_cents,
                           alert_threshold_pct, hard_limit,
                           current_month_spend_cents
                    FROM budget_configs
                    WHERE scope = 'global'
                    LIMIT 1
                """),
            )
            budget = row.mappings().fetchone()
            if budget is not None:
                return self._evaluate_budget(budget)

            return BudgetStatus(
                status="ok",
                message="No budget configured",
            )

    async def aggregate_daily(self) -> int:
        """Aggregate usage_events into usage_daily_summary.

        Designed to be called by a daily cron job. Uses an UPSERT so it
        is safe to re-run for the same day.

        Returns the number of summary rows upserted.
        """
        async with self._session_factory() as session:
            async with session.begin():
                result = await session.execute(
                    text("""
                        INSERT INTO usage_daily_summary (
                            date, project_id, provider, model_name,
                            total_input_tokens, total_output_tokens,
                            total_cached_tokens, total_cost_cents,
                            total_requests, total_errors, avg_latency_ms
                        )
                        SELECT
                            DATE(created_at)          AS day,
                            project_id,
                            provider,
                            model_name,
                            SUM(input_tokens),
                            SUM(output_tokens),
                            SUM(cached_tokens),
                            SUM(cost_cents),
                            COUNT(*),
                            COUNT(*) FILTER (WHERE error_message IS NOT NULL),
                            ROUND(AVG(latency_ms)::numeric, 2)
                        FROM usage_events
                        WHERE DATE(created_at) = CURRENT_DATE - INTERVAL '1 day'
                        GROUP BY day, project_id, provider, model_name
                        ON CONFLICT (date, project_id, provider, model_name)
                        DO UPDATE SET
                            total_input_tokens  = EXCLUDED.total_input_tokens,
                            total_output_tokens = EXCLUDED.total_output_tokens,
                            total_cached_tokens = EXCLUDED.total_cached_tokens,
                            total_cost_cents    = EXCLUDED.total_cost_cents,
                            total_requests      = EXCLUDED.total_requests,
                            total_errors        = EXCLUDED.total_errors,
                            avg_latency_ms      = EXCLUDED.avg_latency_ms
                    """)
                )
                return result.rowcount

    # ── Internal helpers ───────────────────────────────────────────────

    @staticmethod
    def _evaluate_budget(budget) -> BudgetStatus:
        """Evaluate a budget_configs row and return a BudgetStatus."""
        current = int(budget["current_month_spend_cents"])
        limit = int(budget["monthly_budget_cents"])
        threshold = int(budget["alert_threshold_pct"])
        hard = bool(budget["hard_limit"])
        remaining = max(0, limit - current)

        if hard and current >= limit:
            return BudgetStatus(
                status="blocked",
                current_spend_cents=current,
                budget_cents=limit,
                remaining_cents=0,
                threshold_pct=threshold,
                hard_limit=hard,
                message=(
                    f"Hard budget limit reached: "
                    f"${current / 100:.2f} / ${limit / 100:.2f}"
                ),
            )

        if limit > 0 and current >= (limit * threshold / 100):
            return BudgetStatus(
                status="warning",
                current_spend_cents=current,
                budget_cents=limit,
                remaining_cents=remaining,
                threshold_pct=threshold,
                hard_limit=hard,
                message=(
                    f"Budget warning ({threshold}% threshold): "
                    f"${current / 100:.2f} / ${limit / 100:.2f}"
                ),
            )

        return BudgetStatus(
            status="ok",
            current_spend_cents=current,
            budget_cents=limit,
            remaining_cents=remaining,
            threshold_pct=threshold,
            hard_limit=hard,
        )

    @staticmethod
    async def _increment_budget_spend(
        session, project_id: str, cost_cents: int
    ) -> None:
        """Atomically increment current_month_spend_cents on matching budgets."""
        try:
            await session.execute(
                text("""
                    UPDATE budget_configs
                    SET current_month_spend_cents = current_month_spend_cents + :cost,
                        updated_at = NOW()
                    WHERE (scope = 'project' AND project_id = :project_id)
                       OR scope = 'global'
                """),
                {"cost": cost_cents, "project_id": project_id},
            )
        except Exception as e:
            logger.warning("Budget spend increment failed: %s", e)


# ═══════════════════════════════════════════════════════════════════════
# Module-level singleton
# ═══════════════════════════════════════════════════════════════════════

_cost_tracker: Optional[CostTracker] = None


def get_cost_tracker() -> CostTracker:
    global _cost_tracker
    if _cost_tracker is None:
        _cost_tracker = CostTracker()
    return _cost_tracker
