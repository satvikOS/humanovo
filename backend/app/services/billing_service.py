"""
Billing & Usage Service — Cost tracking, budget management, and alerts.

Tracks every LLM call, embedding call, and data source API call.
Enforces project-level and global budget limits.
"""

import json
from datetime import datetime
from typing import Literal
from uuid import uuid4

from pydantic import BaseModel

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)

# Load model pricing from config
_PRICING: dict = {}
try:
    import os
    pricing_path = os.path.join(os.path.dirname(__file__), "../../config/model_pricing.json")
    if os.path.exists(pricing_path):
        with open(pricing_path) as f:
            _PRICING = json.load(f)
except Exception as e:
    logger.warning(f"Could not load model pricing: {e}")


class UsageEvent(BaseModel):
    id: str = ""
    project_id: str | None = None
    run_id: str | None = None
    run_type: str  # "discovery" | "synthesis" | "chat" | "embedding" | "data_source"
    model: str
    provider: str
    stage: str | None = None
    tokens_input: int = 0
    tokens_output: int = 0
    cost_cents: int = 0
    latency_ms: int | None = None
    success: bool = True
    error_type: str | None = None
    created_at: str | None = None


class BudgetStatus(BaseModel):
    status: Literal["ok", "warning", "blocked"]
    current_spend_cents: int = 0
    budget_cents: int = 0
    remaining_cents: int = 0
    threshold_pct: int = 80
    message: str = ""


class CostTracker:
    """Wraps every external API call to log cost and usage."""

    def __init__(self, db_session=None):
        self._db = db_session

    def compute_cost_cents(self, model: str, tokens_input: int, tokens_output: int) -> int:
        """Compute cost in cents from model pricing table."""
        pricing = _PRICING.get(model)
        if not pricing:
            return 0
        input_cost = (tokens_input / 1_000_000) * pricing.get("input_cost_per_1m_tokens_cents", 0)
        output_cost = (tokens_output / 1_000_000) * pricing.get("output_cost_per_1m_tokens_cents", 0)
        return round(input_cost + output_cost)

    async def track(
        self,
        project_id: str | None,
        run_id: str | None,
        run_type: str,
        model: str,
        provider: str,
        stage: str | None,
        tokens_input: int,
        tokens_output: int,
        latency_ms: int,
        success: bool,
        error_type: str | None = None,
    ) -> UsageEvent:
        """Log a usage event and update budget."""
        cost_cents = self.compute_cost_cents(model, tokens_input, tokens_output)
        event = UsageEvent(
            id=str(uuid4()),
            project_id=project_id,
            run_id=run_id,
            run_type=run_type,
            model=model,
            provider=provider,
            stage=stage,
            tokens_input=tokens_input,
            tokens_output=tokens_output,
            cost_cents=cost_cents,
            latency_ms=latency_ms,
            success=success,
            error_type=error_type,
            created_at=datetime.utcnow().isoformat(),
        )
        # Store in database
        if self._db:
            await self._store_event(event)
            # Update budget
            if project_id:
                await self._update_budget(project_id, cost_cents)
        return event

    async def _store_event(self, event: UsageEvent):
        if not self._db:
            return
        try:
            await self._db.execute(
                """INSERT INTO usage_events
                   (id, project_id, run_id, run_type, model, provider, stage,
                    tokens_input, tokens_output, cost_cents, latency_ms, success, error_type)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)""",
                event.id, event.project_id, event.run_id, event.run_type,
                event.model, event.provider, event.stage,
                event.tokens_input, event.tokens_output, event.cost_cents,
                event.latency_ms, event.success, event.error_type,
            )
        except Exception as e:
            logger.error(f"Failed to store usage event: {e}")

    async def _update_budget(self, project_id: str, cost_cents: int):
        if not self._db or cost_cents <= 0:
            return
        try:
            await self._db.execute(
                """UPDATE budget_configs
                   SET current_month_spend_cents = current_month_spend_cents + $1,
                       updated_at = NOW()
                   WHERE (scope = 'project' AND project_id = $2)
                      OR scope = 'global'""",
                cost_cents, project_id,
            )
        except Exception as e:
            logger.warning(f"Budget update failed: {e}")


class BudgetService:
    """Checks and enforces budget limits."""

    def __init__(self, db_session=None):
        self._db = db_session

    async def check_budget(self, project_id: str | None) -> BudgetStatus:
        """Check if we're within budget."""
        if not self._db:
            return BudgetStatus(status="ok", message="No database configured")
        try:
            # Check project budget
            if project_id:
                row = await self._db.fetch_one(
                    "SELECT * FROM budget_configs WHERE scope = 'project' AND project_id = $1",
                    project_id,
                )
                if row:
                    return self._evaluate_budget(dict(row))
            # Check global budget
            row = await self._db.fetch_one(
                "SELECT * FROM budget_configs WHERE scope = 'global'"
            )
            if row:
                return self._evaluate_budget(dict(row))
            return BudgetStatus(status="ok", message="No budget configured")
        except Exception as e:
            logger.warning(f"Budget check failed: {e}")
            return BudgetStatus(status="ok", message="Budget check failed, proceeding")

    def _evaluate_budget(self, budget: dict) -> BudgetStatus:
        current = budget.get("current_month_spend_cents", 0)
        limit = budget.get("monthly_budget_cents", 0)
        threshold = budget.get("alert_threshold_pct", 80)
        hard_limit = budget.get("hard_limit", False)
        remaining = max(0, limit - current)

        if hard_limit and current >= limit:
            return BudgetStatus(
                status="blocked", current_spend_cents=current,
                budget_cents=limit, remaining_cents=0,
                threshold_pct=threshold,
                message=f"Budget exceeded: ${current/100:.2f} / ${limit/100:.2f}"
            )
        elif current >= (limit * threshold / 100):
            return BudgetStatus(
                status="warning", current_spend_cents=current,
                budget_cents=limit, remaining_cents=remaining,
                threshold_pct=threshold,
                message=f"Budget warning: ${current/100:.2f} / ${limit/100:.2f} ({threshold}% threshold)"
            )
        return BudgetStatus(
            status="ok", current_spend_cents=current,
            budget_cents=limit, remaining_cents=remaining,
            threshold_pct=threshold,
        )
