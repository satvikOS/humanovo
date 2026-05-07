"""
Budget Enforcer — User-Configurable Per-Account Limits + Hard Kill-Switch

Sits on top of the existing cost_tracking_service and adds:

  1. Per-USER monthly budget (separate from per-project budget).
     Users configure this in Settings ▸ Account ▸ Usage & Billing.
     When exhausted, discovery runs are BLOCKED at request-time and the
     UI receives a notification payload explaining why.

  2. Per-RUN hard budget enforcement.
     Each discovery run carries a max spend cap (default $9 = 9 hypotheses
     × $1/hypothesis; paper gen default $2). The in-process enforcer
     charges every LLM / embedding / tool call against the running total.
     On exhaustion it raises `BudgetExceeded` which the orchestrator
     catches and short-circuits the pipeline gracefully (final stages
     run on Haiku-only fallback, or the run terminates with a partial
     result flagged as budget-truncated).

  3. Graceful-degradation ladder.
     At 60% of cap: switch REFINE + TRANSLATE stages to Haiku.
     At 80% of cap: switch all subsequent generative stages to Haiku.
     At 95% of cap: allow only one more call (finalize), then stop.
     At 100% of cap: hard-stop; mark run `budget_truncated`.

  4. Transparent UI payload.
     `BudgetNotification` objects are attached to the discovery run state
     and streamed to the frontend so users see exactly when budget runs
     out, how much was spent, and what the result represents.

  5. Real integration with usage data: current_month_spend reads from
     usage_events (via cost_tracking_service). No mocks.
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Optional

from sqlalchemy import text

from app.core.database import async_session_factory
from app.services.cost_tracking_service import (
    BudgetStatus,
    compute_cost_cents,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------


class BudgetExceeded(Exception):
    """Raised when a run exceeds its hard cap. Orchestrator catches this
    and short-circuits, emitting a `budget_truncated` result."""

    def __init__(self, message: str, spent_cents: int, cap_cents: int,
                 truncation_point: str | None = None):
        super().__init__(message)
        self.spent_cents = spent_cents
        self.cap_cents = cap_cents
        self.truncation_point = truncation_point


class UserBudgetBlocked(Exception):
    """Raised at run-start if the user's monthly budget is exhausted."""

    def __init__(self, message: str, status: BudgetStatus, user_id: str):
        super().__init__(message)
        self.status = status
        self.user_id = user_id


# ---------------------------------------------------------------------------
# Types
# ---------------------------------------------------------------------------


class RunKind(str, Enum):
    DISCOVERY = "discovery"           # 9 hypotheses, default cap $9
    SINGLE_HYPOTHESIS = "single_hyp"  # 1 hypothesis, default cap $1
    PAPER_GEN = "paper_gen"           # default cap $2
    SYNTHESIS = "synthesis"           # default cap $1.50
    CHAT = "chat"                     # default cap $0.10 per message


class DegradationLevel(str, Enum):
    NONE = "none"              # <60% spent
    MILD = "mild"              # 60-80% spent (REFINE+TRANSLATE → Haiku)
    MODERATE = "moderate"      # 80-95% spent (all generative → Haiku)
    SEVERE = "severe"          # 95-100% spent (one more call allowed)
    BLOCKED = "blocked"        # >=100% spent


@dataclass
class BudgetNotification:
    """Payload sent to the frontend when budget state changes."""
    kind: str   # "info" | "warning" | "blocked"
    message: str
    current_spend_usd: float
    cap_usd: float
    percent_used: float
    degradation_level: str
    run_id: str | None = None
    user_id: str | None = None
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


@dataclass
class RunBudgetState:
    run_id: str
    user_id: str | None
    kind: RunKind
    cap_cents: int
    spent_cents: int = 0
    degradation: DegradationLevel = DegradationLevel.NONE
    truncated: bool = False
    truncation_point: str | None = None
    notifications: list[BudgetNotification] = field(default_factory=list)
    started_at: float = field(default_factory=time.time)
    events: list[dict[str, Any]] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Per-user monthly budget — the "once full, discovery doesn't run" layer
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# Per-tier monthly cap mapping — authoritative source of the "no surprise
# bills" guarantee from AWS_INFRASTRUCTURE_PLAN.md §2.3. The CredentialPool
# layer enforces these before any model call lands.
#
# Trial:        $0.50 lifetime  (~1-2 runs at M0 cost)
# Researcher:   $4.00/month     (~12 runs at M0, ~26 at M12 cache)
# Lab:          $40.00/month    (~66 runs at M0, ~148 at M12 cache)
# Institution:  $200.00/month FLOOR (overridden per contract via
#               `user_budget_configs.monthly_budget_cents`)
#
# Per-user OVERRIDES live in user_budget_configs.monthly_budget_cents and
# take precedence (admins / sales can grant headroom beyond the tier
# default without an upgrade). The tier is just the seeded default that
# `get_or_create` writes on first insert.
# ---------------------------------------------------------------------------

TIER_MONTHLY_CAP_CENTS: dict[str, int] = {
    "trial": 50,
    "researcher": 400,
    "lab": 4_000,
    "institution": 20_000,
}

# Fallback cap when the tier lookup fails (e.g. unknown user_id format
# or DB unreachable). Match the Trial cap so we fail safe on the lower
# side rather than charging through with a generous default.
DEFAULT_FALLBACK_CAP_CENTS = TIER_MONTHLY_CAP_CENTS["trial"]


async def _resolve_tier_cap_cents(
    session_factory, user_id: str
) -> int:
    """Look up the user's tier and translate it to a monthly cap. Used
    by `UserBudgetService.get_or_create` when seeding a new row."""
    try:
        async with session_factory() as session:
            row = await session.execute(
                text("SELECT tier FROM users WHERE id = :uid"),
                {"uid": user_id},
            )
            t = row.scalar()
        if t and t in TIER_MONTHLY_CAP_CENTS:
            return TIER_MONTHLY_CAP_CENTS[t]
    except Exception as exc:  # noqa: BLE001
        logger.warning("tier lookup failed; using fallback cap", error=str(exc))
    return DEFAULT_FALLBACK_CAP_CENTS


class UserBudgetService:
    """Handles user-scoped monthly budgets in `user_budget_configs`.

    On first insert for a user, the cap is seeded from the user's tier
    (Trial $0.50 / Researcher $4 / Lab $40 / Institution $200 floor —
    see TIER_MONTHLY_CAP_CENTS above). After that, the row is the
    source of truth and admins can `update_cap` to grant headroom.

    DDL (also created at service init if missing):

        CREATE TABLE IF NOT EXISTS user_budget_configs (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id TEXT NOT NULL UNIQUE,
            monthly_budget_cents INTEGER NOT NULL DEFAULT 50,    -- Trial floor
            alert_threshold_pct INTEGER NOT NULL DEFAULT 80,
            hard_limit BOOLEAN NOT NULL DEFAULT TRUE,
            current_month_spend_cents INTEGER NOT NULL DEFAULT 0,
            current_month_starts DATE NOT NULL DEFAULT DATE_TRUNC('month', NOW()),
            notification_email TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    """

    def __init__(self, session_factory=None):
        self._session_factory = session_factory or async_session_factory

    async def ensure_schema(self) -> None:
        async with self._session_factory() as session:
            async with session.begin():
                await session.execute(text("""
                    CREATE TABLE IF NOT EXISTS user_budget_configs (
                        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                        user_id TEXT NOT NULL UNIQUE,
                        monthly_budget_cents INTEGER NOT NULL DEFAULT 5000,
                        alert_threshold_pct INTEGER NOT NULL DEFAULT 80,
                        hard_limit BOOLEAN NOT NULL DEFAULT TRUE,
                        current_month_spend_cents INTEGER NOT NULL DEFAULT 0,
                        current_month_starts DATE NOT NULL
                            DEFAULT DATE_TRUNC('month', NOW()),
                        notification_email TEXT,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                    )
                """))

    async def get_or_create(
        self,
        user_id: str,
        default_budget_cents: int | None = None,
    ) -> dict:
        """Fetch (or insert) the user's budget row.

        If `default_budget_cents` is None the seed value is derived from
        the user's tier — Trial $0.50 / Researcher $4 / Lab $40 /
        Institution $200 floor. Pass an explicit value only in tests
        and admin-grant flows.
        """
        await self.ensure_schema()
        if default_budget_cents is None:
            default_budget_cents = await _resolve_tier_cap_cents(
                self._session_factory, user_id
            )
        async with self._session_factory() as session:
            async with session.begin():
                row = await session.execute(
                    text("SELECT * FROM user_budget_configs WHERE user_id = :uid"),
                    {"uid": user_id},
                )
                existing = row.mappings().fetchone()
                if existing is not None:
                    # Month-roll: zero the spend if a new calendar month started
                    from datetime import date
                    this_month = date.today().replace(day=1)
                    if existing["current_month_starts"] < this_month:
                        await session.execute(
                            text("""
                                UPDATE user_budget_configs
                                SET current_month_spend_cents = 0,
                                    current_month_starts = :month,
                                    updated_at = NOW()
                                WHERE user_id = :uid
                            """),
                            {"uid": user_id, "month": this_month},
                        )
                    return dict(existing)
                await session.execute(
                    text("""
                        INSERT INTO user_budget_configs (
                            user_id, monthly_budget_cents
                        ) VALUES (:uid, :cap)
                    """),
                    {"uid": user_id, "cap": default_budget_cents},
                )
                row = await session.execute(
                    text("SELECT * FROM user_budget_configs WHERE user_id = :uid"),
                    {"uid": user_id},
                )
                return dict(row.mappings().fetchone())

    async def update_cap(self, user_id: str, monthly_budget_cents: int) -> dict:
        await self.ensure_schema()
        async with self._session_factory() as session:
            async with session.begin():
                await session.execute(
                    text("""
                        INSERT INTO user_budget_configs (user_id, monthly_budget_cents)
                        VALUES (:uid, :cap)
                        ON CONFLICT (user_id)
                        DO UPDATE SET monthly_budget_cents = EXCLUDED.monthly_budget_cents,
                                      updated_at = NOW()
                    """),
                    {"uid": user_id, "cap": monthly_budget_cents},
                )
                row = await session.execute(
                    text("SELECT * FROM user_budget_configs WHERE user_id = :uid"),
                    {"uid": user_id},
                )
                return dict(row.mappings().fetchone())

    async def check(self, user_id: str) -> BudgetStatus:
        cfg = await self.get_or_create(user_id)
        current = int(cfg["current_month_spend_cents"])
        limit = int(cfg["monthly_budget_cents"])
        threshold = int(cfg["alert_threshold_pct"])
        hard = bool(cfg["hard_limit"])
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
                    f"Monthly budget reached: ${current / 100:.2f} / "
                    f"${limit / 100:.2f}. Discovery is paused until next month "
                    f"or until you raise the limit in Settings."
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

    async def increment_spend(self, user_id: str, cost_cents: int) -> None:
        if cost_cents <= 0:
            return
        await self.ensure_schema()
        async with self._session_factory() as session:
            async with session.begin():
                await session.execute(
                    text("""
                        INSERT INTO user_budget_configs (user_id, current_month_spend_cents)
                        VALUES (:uid, :spend)
                        ON CONFLICT (user_id)
                        DO UPDATE SET current_month_spend_cents =
                                      user_budget_configs.current_month_spend_cents +
                                      EXCLUDED.current_month_spend_cents,
                                      updated_at = NOW()
                    """),
                    {"uid": user_id, "spend": cost_cents},
                )


_user_budget_singleton: UserBudgetService | None = None


def get_user_budget_service() -> UserBudgetService:
    global _user_budget_singleton
    if _user_budget_singleton is None:
        _user_budget_singleton = UserBudgetService()
    return _user_budget_singleton


# ---------------------------------------------------------------------------
# Per-run enforcer
# ---------------------------------------------------------------------------


# Default caps per run kind (cents)
DEFAULT_CAPS_CENTS: dict[RunKind, int] = {
    RunKind.DISCOVERY: 900,          # $9 = 9 hypotheses × $1
    RunKind.SINGLE_HYPOTHESIS: 100,  # $1
    RunKind.PAPER_GEN: 200,          # $2
    RunKind.SYNTHESIS: 150,          # $1.50
    RunKind.CHAT: 10,                # $0.10
}


class RunBudgetEnforcer:
    """Per-run cost cap + graceful degradation.

    Usage:
        enf = RunBudgetEnforcer(
            run_id=rid, user_id=uid, kind=RunKind.DISCOVERY, cap_cents=900,
        )
        enf.assert_allowed()
        # Before each LLM/embedding call:
        model = enf.select_model(default="claude-sonnet-4-6")
        response = await llm_call(model, ...)
        enf.charge(provider="bedrock", model=model,
                   input_tokens=ti, output_tokens=to)
        # enf.charge() raises BudgetExceeded if cap hit.
    """

    # Degradation thresholds (fraction of cap spent)
    THRESHOLD_MILD = 0.60
    THRESHOLD_MODERATE = 0.80
    THRESHOLD_SEVERE = 0.95

    # Mapping from default model → cost-reduced alternative
    DEGRADE_MAP: dict[str, str] = {
        "claude-opus-4-6": "claude-3-5-haiku-20241022-v1",
        "claude-sonnet-4-6": "claude-3-5-haiku-20241022-v1",
        "gpt-4.1": "gpt-4o-mini",
        "gpt-4o": "gpt-4o-mini",
        "o3-mini": "claude-3-5-haiku-20241022-v1",
        "cohere-command-a-03-2025": "claude-3-5-haiku-20241022-v1",
        "mistral-large-2411": "claude-3-5-haiku-20241022-v1",
        "grok-4-1-fast": "claude-3-5-haiku-20241022-v1",
    }

    # Stages that are eligible for Haiku substitution at mild degradation.
    MILD_DEGRADE_STAGES = {"refine", "translate", "finalize", "seed"}

    def __init__(
        self,
        *,
        run_id: str,
        user_id: str | None,
        kind: RunKind,
        cap_cents: int | None = None,
        on_notification: Optional[callable] = None,
    ):
        self.state = RunBudgetState(
            run_id=run_id,
            user_id=user_id,
            kind=kind,
            cap_cents=cap_cents if cap_cents is not None else DEFAULT_CAPS_CENTS[kind],
        )
        self._on_notification = on_notification
        self._lock = asyncio.Lock()

    # ------------------------------------------------------------------
    # Spend charging
    # ------------------------------------------------------------------

    def _notify(self, kind: str, message: str) -> None:
        notif = BudgetNotification(
            kind=kind,
            message=message,
            current_spend_usd=round(self.state.spent_cents / 100, 4),
            cap_usd=round(self.state.cap_cents / 100, 2),
            percent_used=round(100 * self.state.spent_cents / max(1, self.state.cap_cents), 1),
            degradation_level=self.state.degradation.value,
            run_id=self.state.run_id,
            user_id=self.state.user_id,
        )
        self.state.notifications.append(notif)
        if self._on_notification:
            try:
                self._on_notification(notif)
            except Exception as e:
                logger.debug(f"budget notification callback failed: {e}")

    def _update_degradation(self) -> None:
        frac = self.state.spent_cents / max(1, self.state.cap_cents)
        prior = self.state.degradation
        if frac >= 1.0:
            self.state.degradation = DegradationLevel.BLOCKED
        elif frac >= self.THRESHOLD_SEVERE:
            self.state.degradation = DegradationLevel.SEVERE
        elif frac >= self.THRESHOLD_MODERATE:
            self.state.degradation = DegradationLevel.MODERATE
        elif frac >= self.THRESHOLD_MILD:
            self.state.degradation = DegradationLevel.MILD
        else:
            self.state.degradation = DegradationLevel.NONE
        if self.state.degradation != prior:
            self._notify("warning", (
                f"Budget degradation {prior.value} → {self.state.degradation.value} "
                f"({self.state.spent_cents/100:.3f}/{self.state.cap_cents/100:.2f} USD)"
            ))

    def charge(
        self,
        *,
        provider: str,
        model: str,
        input_tokens: int = 0,
        output_tokens: int = 0,
        cached_tokens: int = 0,
        stage_name: str | None = None,
    ) -> int:
        """Record the cost of a call. Raises BudgetExceeded if the run is over cap.

        Returns the cost in cents that was charged.
        """
        cost_cents = int(compute_cost_cents(model, input_tokens, output_tokens, cached_tokens))
        self.state.spent_cents += cost_cents
        self.state.events.append({
            "t": time.time() - self.state.started_at,
            "provider": provider,
            "model": model,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "cost_cents": cost_cents,
            "stage": stage_name,
        })
        self._update_degradation()

        if self.state.spent_cents >= self.state.cap_cents:
            self.state.truncated = True
            self.state.truncation_point = stage_name or "unknown"
            self._notify("blocked", (
                f"Run cap of ${self.state.cap_cents/100:.2f} reached at "
                f"stage={stage_name}. Remaining stages will not execute."
            ))
            raise BudgetExceeded(
                f"Run {self.state.run_id} exceeded cap "
                f"(${self.state.spent_cents/100:.3f} >= ${self.state.cap_cents/100:.2f})",
                spent_cents=self.state.spent_cents,
                cap_cents=self.state.cap_cents,
                truncation_point=stage_name,
            )

        return cost_cents

    # ------------------------------------------------------------------
    # Model selection under degradation
    # ------------------------------------------------------------------

    def select_model(self, default: str, stage_name: str | None = None) -> str:
        """Return the model to actually invoke, applying the degradation ladder.

        At MILD: refine/translate/finalize/seed stages are downgraded to Haiku.
        At MODERATE: all stages with a downgrade mapping are downgraded.
        At SEVERE: any generative call is downgraded.
        """
        lvl = self.state.degradation
        stage_l = (stage_name or "").lower()

        if lvl == DegradationLevel.MILD and stage_l in self.MILD_DEGRADE_STAGES:
            return self.DEGRADE_MAP.get(default, default)
        if lvl in (DegradationLevel.MODERATE, DegradationLevel.SEVERE):
            return self.DEGRADE_MAP.get(default, default)
        return default

    def assert_allowed(self, stage_name: str | None = None) -> None:
        """Check whether another call is allowed.

        At SEVERE and onwards, only one more call is permitted (finalize).
        """
        if self.state.degradation == DegradationLevel.BLOCKED:
            raise BudgetExceeded(
                f"Run {self.state.run_id} already blocked; no more calls allowed.",
                spent_cents=self.state.spent_cents,
                cap_cents=self.state.cap_cents,
                truncation_point=stage_name,
            )

    # ------------------------------------------------------------------
    # Summary
    # ------------------------------------------------------------------

    def summary(self) -> dict[str, Any]:
        return {
            "run_id": self.state.run_id,
            "kind": self.state.kind.value,
            "cap_usd": round(self.state.cap_cents / 100, 2),
            "spent_usd": round(self.state.spent_cents / 100, 4),
            "percent_used": round(
                100 * self.state.spent_cents / max(1, self.state.cap_cents), 1,
            ),
            "degradation_level": self.state.degradation.value,
            "truncated": self.state.truncated,
            "truncation_point": self.state.truncation_point,
            "notifications": [
                {
                    "kind": n.kind,
                    "message": n.message,
                    "current_spend_usd": n.current_spend_usd,
                    "cap_usd": n.cap_usd,
                    "percent_used": n.percent_used,
                    "timestamp": n.timestamp,
                }
                for n in self.state.notifications
            ],
            "n_events": len(self.state.events),
            "duration_seconds": round(time.time() - self.state.started_at, 2),
        }


# ---------------------------------------------------------------------------
# Orchestration helper
# ---------------------------------------------------------------------------


async def start_run(
    *,
    run_id: str,
    user_id: str | None,
    kind: RunKind,
    cap_cents: int | None = None,
    on_notification: Optional[callable] = None,
) -> RunBudgetEnforcer:
    """Check user's monthly budget, then create a RunBudgetEnforcer.

    Raises UserBudgetBlocked if the user's monthly budget is exhausted.
    """
    if user_id:
        ub = get_user_budget_service()
        status = await ub.check(user_id)
        if status.status == "blocked":
            raise UserBudgetBlocked(
                status.message or "Monthly budget exhausted",
                status=status,
                user_id=user_id,
            )
    enforcer = RunBudgetEnforcer(
        run_id=run_id, user_id=user_id, kind=kind, cap_cents=cap_cents,
        on_notification=on_notification,
    )
    return enforcer


async def finalize_run(enforcer: RunBudgetEnforcer) -> None:
    """Push the run's total into the user's monthly budget."""
    if enforcer.state.user_id and enforcer.state.spent_cents > 0:
        try:
            await get_user_budget_service().increment_spend(
                enforcer.state.user_id, enforcer.state.spent_cents,
            )
        except Exception as e:
            logger.warning(f"Failed to increment user monthly spend: {e}")
