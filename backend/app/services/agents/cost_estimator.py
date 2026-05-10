"""Pre-flight cost estimator for the swarm pipeline.

Given a desired pipeline configuration (stage list, sub-agent count,
expected token volume per stage), produce an estimated USD cost for
one full run. Surfaces in two places:

  1. Backend admin endpoint `/admin/ai/cost-estimate` — returns JSON
     for the desktop UI's pre-flight panel ("This run will cost ~$X").
  2. CLI invocation from `swarm_smoke.py` — projection block printed
     after each smoke completes (already wired via SwarmResult).

The estimator uses *historical averages* per stage measured from the
smoke + production runs, plus the pricing table from
`app/services/agents/pricing.py`. As the pipeline accumulates real-
run telemetry, these defaults can be refined; for now they reflect
the empirical numbers from the 12-stage smoke at N=4 (LLM tokens
~141.5K input + 16.5K output + 14.8K reasoning = ~$0.68)."""
from __future__ import annotations

from dataclasses import dataclass

from app.services.agents.pricing import TokenUsage, cost_cents


@dataclass(frozen=True)
class StageCostProfile:
    """Average per-stage token volume measured empirically."""
    stage_name: str
    model_label: str
    avg_input_tokens: int
    avg_output_tokens: int
    avg_reasoning_tokens: int
    is_critic: bool = False


# Empirical averages from the latest CI smoke (run 25626377051,
# 4-sub-agent N + aggregator). These are PER-STAGE-SUB-AGENT averages;
# the estimator multiplies by N to project total cost. Values rounded
# to keep the projection conservative — the real run typically lands
# 10-20% under these.
DEFAULT_STAGE_PROFILES: list[StageCostProfile] = [
    StageCostProfile("seed", "claude-opus-4-1", 800, 100, 0),
    StageCostProfile("expand", "claude-sonnet-4-5", 600, 200, 0),
    StageCostProfile("evidence", "gpt-4o", 200, 50, 0),
    StageCostProfile("counter", "o4-mini", 250, 60, 200),
    StageCostProfile("revise", "o4-mini", 60, 20, 240),
    StageCostProfile("mechanism", "gpt-4o", 130, 30, 0),
    StageCostProfile("validate", "claude-sonnet-4-5", 600, 30, 0, is_critic=True),
    StageCostProfile("ground", "o4-mini", 200, 60, 200, is_critic=True),
    StageCostProfile("score", "gpt-4o", 100, 15, 0, is_critic=True),
    StageCostProfile("refine", "gpt-4o", 130, 20, 0),
    StageCostProfile("translate", "claude-sonnet-4-5", 500, 90, 0),
    StageCostProfile("finalize", "claude-sonnet-4-5", 500, 50, 0),
]
# Aggregator cost is dominated by passing all sub-agent outputs in.
# Roughly: N × 500 chars per sub ≈ 125 tokens per sub × N ≈ 125N input,
# plus a fixed ~300 output for the canonical answer.
AGGREGATOR_MODEL = "claude-sonnet-4-5"
AGGREGATOR_BASE_INPUT_TOKENS = 100
AGGREGATOR_PER_SUB_INPUT_TOKENS = 125
AGGREGATOR_OUTPUT_TOKENS = 300


@dataclass
class CostEstimate:
    n_subagents: int
    n_stages: int
    expected_loopbacks: int
    """Expected loopback re-runs (default 0; bump to 1-2 if the run is
    on a contested topic where critics typically loop)."""
    sub_agent_cost_cents: float
    aggregator_cost_cents: float
    total_cost_cents: float
    per_stage_breakdown: list[dict]


def estimate_run_cost(
    n_subagents: int,
    *,
    profiles: list[StageCostProfile] | None = None,
    expected_loopbacks: int = 0,
) -> CostEstimate:
    """Compute an estimate. `n_subagents` is the production sub-agent
    fan-out (typically 25 in safe-default mode, 300 if the operator
    has overridden). `expected_loopbacks` lets the caller bias the
    estimate up if they expect the topic to trigger critic loopbacks
    (which re-run earlier stages and double their cost)."""
    profiles = profiles or DEFAULT_STAGE_PROFILES
    per_stage: list[dict] = []
    sub_agent_total = 0.0
    aggregator_total = 0.0

    # Stages that are commonly the loopback TARGET get an extra
    # iteration cost added when expected_loopbacks > 0. Empirically
    # 'mechanism' (target of 'ground' critic) and 'evidence' (target
    # of 'score' critic) are the two repeat candidates.
    loopback_target_names = {"mechanism", "evidence", "revise"}

    for p in profiles:
        per_sub_usage = TokenUsage(
            input_tokens=p.avg_input_tokens,
            output_tokens=p.avg_output_tokens,
            reasoning_tokens=p.avg_reasoning_tokens,
        )
        per_sub_cost = cost_cents(p.model_label, per_sub_usage)
        sub_total_for_stage = per_sub_cost * n_subagents

        agg_input = AGGREGATOR_BASE_INPUT_TOKENS + AGGREGATOR_PER_SUB_INPUT_TOKENS * min(n_subagents, 80)
        agg_usage = TokenUsage(
            input_tokens=agg_input,
            output_tokens=AGGREGATOR_OUTPUT_TOKENS,
        )
        agg_cost_for_stage = cost_cents(AGGREGATOR_MODEL, agg_usage)

        # Loopback iteration multiplier — only loopback-target stages
        # pay the extra round.
        iter_multiplier = 1
        if expected_loopbacks > 0 and p.stage_name in loopback_target_names:
            iter_multiplier = 1 + min(expected_loopbacks, 2)

        sub_total_for_stage *= iter_multiplier
        agg_cost_for_stage *= iter_multiplier
        sub_agent_total += sub_total_for_stage
        aggregator_total += agg_cost_for_stage

        per_stage.append({
            "stage": p.stage_name,
            "model": p.model_label,
            "iterations": iter_multiplier,
            "sub_agent_cost_cents": round(sub_total_for_stage, 4),
            "aggregator_cost_cents": round(agg_cost_for_stage, 4),
            "total_cost_cents": round(sub_total_for_stage + agg_cost_for_stage, 4),
        })

    total = sub_agent_total + aggregator_total
    return CostEstimate(
        n_subagents=n_subagents,
        n_stages=len(profiles),
        expected_loopbacks=expected_loopbacks,
        sub_agent_cost_cents=round(sub_agent_total, 4),
        aggregator_cost_cents=round(aggregator_total, 4),
        total_cost_cents=round(total, 4),
        per_stage_breakdown=per_stage,
    )
