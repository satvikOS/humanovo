"""Multi-agent swarm orchestrator.

Coordinates a sequence of `GroundedAgent`s where each agent's output
becomes the next agent's input, optionally with shared tool access.
Models the typical Humanovo discovery pipeline shape:

    seed → expand → evidence → counter → revise → mechanism →
    validate → ground → score → refine → translate → finalize

Each stage runs its own grounded-agent loop with the project's tool
set, then hands its final answer to the next stage as the new query.
The swarm captures every step from every agent so the audit trail
shows the full multi-agent reasoning chain.

## Critic loopback

Stages can be marked `is_critic=True`. Critic stages additionally
receive a synthetic `request_pipeline_loopback` tool. When a critic
calls it, the swarm interprets the call as "this stage's QA/QC found
a problem the pipeline can't recover from going forward" — and the
swarm re-routes execution back to the named earlier stage with the
critic's reason prepended to that stage's input.

A pipeline-wide budget caps the total number of loopbacks (default 3)
to prevent infinite ping-pong between a stubborn critic and a stage
that can't satisfy it. After the budget is exhausted, loopback
requests are logged but ignored; the pipeline forces forward
progression to completion.

Per `feedback_grounded_agents`, every stage uses the same retrieval
tool set — no stage is allowed to "trust" the previous stage's output
as ground truth without independent retrieval if it makes a new
factual claim."""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any

from app.services.agents._types import (
    AgentResult,
    DEFAULT_GROUNDING_PROMPT,
    GroundedAgent,
    Tool,
)
from app.services.agents.pricing import TokenUsage


@dataclass
class SwarmStage:
    """One step in a swarm pipeline.

    `is_critic=True` enables loopback: the stage receives an extra
    `request_pipeline_loopback` tool, and the swarm checks whether the
    critic invoked it. If yes, the pipeline re-routes back to the
    earlier stage named in the call (subject to the swarm's loopback
    budget)."""
    name: str
    agent: GroundedAgent
    instruction: str
    """Stage-specific instruction prepended to the previous stage's output."""
    max_steps: int = 6
    system: str = DEFAULT_GROUNDING_PROMPT
    is_critic: bool = False


@dataclass
class SwarmStageResult:
    name: str
    model_label: str
    text: str
    latency_ms: int
    step_count: int
    tool_call_count: int
    usage: TokenUsage = field(default_factory=TokenUsage)
    """Token usage for this stage's run (input, output, reasoning,
    cached). Aggregated across every loop iteration the agent did
    inside its own .run()."""
    cost_cents: float = 0.0
    """Stage cost in cents, computed from `usage` against the model's
    pricing entry."""
    triggered_loopback_to: str | None = None
    loopback_reason: str | None = None
    iteration: int = 1
    """Counts re-runs. iteration=1 is the first pass, 2+ is a re-run
    triggered by a downstream critic loopback."""
    sub_agent_count: int = 0
    """How many sub-agents fanned out for this stage. 0 means a
    single-agent stage; >0 means the stage was a SubAgentSwarm with
    that many parallel sub-agents (+ 1 aggregator)."""
    sub_agent_successes: int = 0
    sub_agent_failures: int = 0


@dataclass
class LoopbackEvent:
    """One loopback transition logged for the audit trail."""
    from_stage: str
    to_stage: str
    reason: str
    iteration_after: int


@dataclass
class SwarmResult:
    """Aggregate result from `Swarm.run(...)`."""
    stages: list[SwarmStageResult]
    final_text: str
    total_latency_ms: int
    loopbacks: list[LoopbackEvent] = field(default_factory=list)
    """Every loopback transition that fired during this run."""
    full_traces: list[AgentResult] = field(default_factory=list)
    """Full per-agent traces (each AgentResult contains the step list)."""
    total_usage: TokenUsage = field(default_factory=TokenUsage)
    """Sum of every stage's usage, across all iterations including
    loopback re-runs. The financial truth for this pipeline run."""
    total_cost_cents: float = 0.0
    """Sum of every stage's cost_cents."""
    cost_by_model: dict[str, float] = field(default_factory=dict)
    """Per-model cost roll-up (e.g. "bedrock/claude-opus-4-1" → 45.2¢)
    so the operator can see which model is the spend center."""
    budget_aborted: bool = False
    """True when the run hit `Swarm.budget_cents` and stopped early.
    The final_text in this case will be the last stage's output — the
    pipeline returns whatever it has rather than empty."""
    budget_abort_message: str | None = None
    """Human-readable explanation of when/why the abort fired."""


class Swarm:
    """Sequential multi-agent orchestrator with critic-driven loopback."""

    def __init__(
        self,
        stages: list[SwarmStage],
        *,
        loopback_budget: int = 3,
        budget_cents: float | None = None,
    ) -> None:
        if not stages:
            raise ValueError("Swarm requires at least one stage")
        self.stages = stages
        self.loopback_budget = loopback_budget
        # Hard cost cap. When running cost (sum of stage costs across
        # iterations including loopback re-runs) exceeds this, the
        # swarm aborts cleanly between stages — finishes the current
        # stage's already-dispatched calls, returns a SwarmResult
        # with a `budget_aborted=True` flag, doesn't kick off any
        # more stages. None = unlimited (for tests / development).
        self.budget_cents = budget_cents
        self._stage_index_by_name: dict[str, int] = {s.name: i for i, s in enumerate(stages)}

    async def run(
        self,
        query: str,
        tools: list[Tool],
    ) -> SwarmResult:
        t0 = time.monotonic()
        running_input = query
        traces: list[AgentResult] = []
        summaries: list[SwarmStageResult] = []
        loopbacks: list[LoopbackEvent] = []
        loopbacks_used = 0
        # Iteration counter per stage — increments every time we
        # re-enter a stage via loopback. Surfaced in summaries so a
        # reader can see which stages were retried and how many times.
        iteration_by_index: dict[int, int] = {}

        # Per-call loopback intent buffer. The injected tool writes
        # into this list; the swarm reads it after each critic stage
        # returns. We rebuild the list per stage so a buffered request
        # from a previous critic doesn't fire twice.
        pending_loopback: list[dict[str, Any]] = []

        async def _record_loopback(args: dict[str, Any]) -> dict[str, Any]:
            target = (args.get("target_stage") or "").strip()
            reason = (args.get("reason") or "").strip()
            if not target:
                return {"acknowledged": False, "error": "target_stage is required"}
            pending_loopback.append({"target_stage": target, "reason": reason})
            return {"acknowledged": True, "target_stage": target}

        loopback_tool = Tool(
            name="request_pipeline_loopback",
            description=(
                "Send the discovery pipeline back to an earlier stage to "
                "address a problem you've identified. Use sparingly — only "
                "when the issue cannot be repaired by a later stage. "
                "Specify the target stage by its short name (for example, "
                "'02-expand' or 'revise')."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "target_stage": {
                        "type": "string",
                        "description": (
                            "Name of the earlier stage to return to. "
                            "Either the full stage name (e.g. '05-revise') "
                            "or its short suffix (e.g. 'revise')."
                        ),
                    },
                    "reason": {
                        "type": "string",
                        "description": "Concise explanation of the issue the loopback should fix.",
                    },
                },
                "required": ["target_stage", "reason"],
            },
            handler=_record_loopback,
        )

        i = 0
        running_cost_cents = 0.0
        budget_aborted = False
        budget_abort_message: str | None = None
        while i < len(self.stages):
            # Budget circuit breaker — checked BEFORE dispatching the
            # next stage so we never spend more than we said we would.
            # The current stage's cost isn't known until it runs, so
            # the cap is enforced on cumulative spend from prior stages.
            if (
                self.budget_cents is not None
                and self.budget_cents > 0
                and running_cost_cents >= self.budget_cents
            ):
                budget_aborted = True
                budget_abort_message = (
                    f"Hit budget cap before stage '{self.stages[i].name}': "
                    f"running cost ¢{running_cost_cents:.2f} ≥ cap "
                    f"¢{self.budget_cents:.2f}. Stages {i}/{len(self.stages)} "
                    f"completed; remaining {len(self.stages) - i} skipped."
                )
                break
            stage = self.stages[i]
            iteration_by_index[i] = iteration_by_index.get(i, 0) + 1

            # Critic stages get the loopback tool in addition to the
            # caller's tool set. Other stages don't see it (no point
            # giving non-critics the ability to re-route).
            stage_tools = list(tools)
            if stage.is_critic and loopbacks_used < self.loopback_budget:
                stage_tools = [*tools, loopback_tool]

            stage_query = f"{stage.instruction}\n\n{running_input}".strip()
            pending_loopback.clear()  # fresh slot for THIS stage's intent
            result = await stage.agent.run(
                stage_query,
                tools=stage_tools,
                system=stage.system,
                max_steps=stage.max_steps,
            )
            traces.append(result)
            # Capture sub-swarm detail RIGHT NOW — if the same agent
            # instance is shared across stages (common pattern when one
            # SubAgentSwarm wraps the same model), the next stage's
            # call overwrites .last_detail. Snapshot it here before
            # any further .run() invocations.
            sa_snapshot = _read_sub_swarm_detail(stage.agent)

            triggered_target: str | None = None
            triggered_reason: str | None = None
            if (
                stage.is_critic
                and pending_loopback
                and loopbacks_used < self.loopback_budget
            ):
                req = pending_loopback[-1]
                target_idx = self._resolve_stage(req["target_stage"])
                if target_idx is not None and target_idx < i:
                    loopbacks_used += 1
                    triggered_target = self.stages[target_idx].name
                    triggered_reason = req["reason"]
                    next_iteration = iteration_by_index.get(target_idx, 0) + 1
                    loopbacks.append(LoopbackEvent(
                        from_stage=stage.name,
                        to_stage=triggered_target,
                        reason=triggered_reason,
                        iteration_after=next_iteration,
                    ))
                    sa_count, sa_ok, sa_fail = sa_snapshot
                    summaries.append(SwarmStageResult(
                        name=stage.name,
                        model_label=result.model_label,
                        text=result.text,
                        latency_ms=result.latency_ms,
                        step_count=len(result.steps),
                        tool_call_count=sum(len(s.tool_calls) for s in result.steps),
                        usage=result.usage,
                        cost_cents=result.cost_cents,
                        triggered_loopback_to=triggered_target,
                        loopback_reason=triggered_reason,
                        iteration=iteration_by_index[i],
                        sub_agent_count=sa_count,
                        sub_agent_successes=sa_ok,
                        sub_agent_failures=sa_fail,
                    ))
                    # Inject the critic's loopback note into the next
                    # stage's input so it can see what to fix.
                    running_input = (
                        f"[Loopback note from {stage.name}: {triggered_reason}]\n\n"
                        + (result.text.strip() or running_input)
                    )
                    # Loopback paths still spend money — count this
                    # critic stage's cost toward the running cap so
                    # a noisy critic that re-triggers many times can't
                    # bypass the budget circuit breaker.
                    running_cost_cents += result.cost_cents
                    i = target_idx
                    continue

            sa_count, sa_ok, sa_fail = sa_snapshot
            summaries.append(SwarmStageResult(
                name=stage.name,
                model_label=result.model_label,
                text=result.text,
                latency_ms=result.latency_ms,
                step_count=len(result.steps),
                tool_call_count=sum(len(s.tool_calls) for s in result.steps),
                usage=result.usage,
                cost_cents=result.cost_cents,
                triggered_loopback_to=None,
                loopback_reason=None,
                iteration=iteration_by_index[i],
                sub_agent_count=sa_count,
                sub_agent_successes=sa_ok,
                sub_agent_failures=sa_fail,
            ))

            if result.text.strip():
                running_input = result.text
            running_cost_cents += result.cost_cents
            i += 1

        # Surface the most recent non-loopback stage's text as the
        # final answer. (A run that ended on a loopback can't happen
        # — once loopback budget is exhausted we always advance — but
        # be defensive.)
        final_text = ""
        for s in reversed(summaries):
            if s.triggered_loopback_to is None and s.text.strip():
                final_text = s.text
                break
        if not final_text and summaries:
            final_text = summaries[-1].text

        total_latency_ms = int((time.monotonic() - t0) * 1000)

        # Aggregate financials. Sum every stage's usage + cost INCLUDING
        # re-runs (loopback iterations are real spend, not free retries),
        # and roll up by model so the operator can see which model is
        # the spend center.
        total_usage = TokenUsage()
        total_cost = 0.0
        cost_by_model: dict[str, float] = {}
        for s in summaries:
            total_usage = total_usage.add(s.usage)
            total_cost += s.cost_cents
            cost_by_model[s.model_label] = cost_by_model.get(s.model_label, 0.0) + s.cost_cents

        return SwarmResult(
            stages=summaries,
            final_text=final_text,
            total_latency_ms=total_latency_ms,
            loopbacks=loopbacks,
            full_traces=traces,
            total_usage=total_usage,
            total_cost_cents=total_cost,
            cost_by_model=cost_by_model,
            budget_aborted=budget_aborted,
            budget_abort_message=budget_abort_message,
        )

    def _resolve_stage(self, target: str) -> int | None:
        """Resolve a stage name from a critic's loopback request.
        Accepts the full stage name (`05-revise`) or just the short
        suffix (`revise`). Returns the stage index, or None if no
        match. Case-insensitive."""
        if not target:
            return None
        norm = target.strip().lower()
        # Exact match first.
        for i, s in enumerate(self.stages):
            if s.name.lower() == norm:
                return i
        # Suffix match (handles "revise" → "05-revise", etc.).
        for i, s in enumerate(self.stages):
            short = s.name.split("-", 1)[-1].lower() if "-" in s.name else s.name.lower()
            if short == norm:
                return i
        # Substring match as last resort.
        for i, s in enumerate(self.stages):
            if norm in s.name.lower():
                return i
        return None


def _read_sub_swarm_detail(agent: GroundedAgent) -> tuple[int, int, int]:
    """If `agent` is a SubAgentSwarm, return (n_total, n_success,
    n_failure) from its `last_detail` snapshot. Otherwise return
    (0, 0, 0) — single agents don't have sub-agent breakdown.

    Imported lazily to keep the swarm.py → sub_swarm.py edge soft —
    sub_swarm imports `Tool` / `AgentResult` from this package, so
    a top-level import here would create a cycle."""
    try:
        from app.services.agents.sub_swarm import SubAgentSwarm
    except ImportError:
        return (0, 0, 0)
    if not isinstance(agent, SubAgentSwarm):
        return (0, 0, 0)
    detail = agent.last_detail
    if detail is None:
        return (0, 0, 0)
    return (
        len(detail.sub_runs),
        detail.successful_runs,
        detail.failed_runs,
    )
