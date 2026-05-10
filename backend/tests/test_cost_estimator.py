"""Unit tests for the swarm pre-flight cost estimator.

Covers the math layer in `app/services/agents/cost_estimator.py` —
no LLM calls, no DB, just pricing-table arithmetic. Verifies that:

  • Cost scales linearly with `n_subagents`.
  • Loopback expectations multiply target stages without over-counting.
  • The estimate uses real entries from `model_pricing.json` (not 0).
  • The aggregator share is bounded by the per-sub input cap (80
    sub-agents max in the aggregator's prompt).
"""
from __future__ import annotations

from app.services.agents.cost_estimator import (
    DEFAULT_STAGE_PROFILES,
    estimate_run_cost,
)


def test_estimate_zero_subagents_is_aggregator_only_floor() -> None:
    """An impossible config (0 sub-agents) still gives a non-negative
    estimate dominated by the aggregator pass."""
    est = estimate_run_cost(n_subagents=0)
    assert est.total_cost_cents >= 0
    assert est.aggregator_cost_cents >= 0
    assert est.sub_agent_cost_cents == 0


def test_estimate_scales_with_n_subagents() -> None:
    """Doubling N should roughly double sub-agent cost (aggregator
    cost has a fixed cap at 80 subs, so it asymptotes)."""
    e10 = estimate_run_cost(n_subagents=10)
    e20 = estimate_run_cost(n_subagents=20)
    # Sub-agent cost is exactly linear in N.
    assert abs(e20.sub_agent_cost_cents - 2 * e10.sub_agent_cost_cents) < 0.001


def test_estimate_aggregator_caps_at_80_subs_per_stage() -> None:
    """N=80 vs N=300 should give the same aggregator cost — the
    aggregator's input is capped at the first 80 sub-agent outputs
    so it doesn't blow up the input-token budget."""
    e80 = estimate_run_cost(n_subagents=80)
    e300 = estimate_run_cost(n_subagents=300)
    assert abs(e80.aggregator_cost_cents - e300.aggregator_cost_cents) < 0.001
    # But total cost still scales because sub-agents themselves do.
    assert e300.sub_agent_cost_cents > e80.sub_agent_cost_cents


def test_loopbacks_multiply_only_target_stages() -> None:
    """Adding 1 expected loopback should NOT double the total cost —
    only the loopback-target stages (mechanism, evidence, revise)
    re-run, the other 9 stages don't."""
    base = estimate_run_cost(n_subagents=25, expected_loopbacks=0)
    one = estimate_run_cost(n_subagents=25, expected_loopbacks=1)
    # Cost should rise but by less than 100% (not all stages re-run).
    assert one.total_cost_cents > base.total_cost_cents
    assert one.total_cost_cents < base.total_cost_cents * 2


def test_per_stage_breakdown_includes_every_stage() -> None:
    est = estimate_run_cost(n_subagents=4)
    # 12 stages from the discovery_orchestrator pipeline.
    assert len(est.per_stage_breakdown) == len(DEFAULT_STAGE_PROFILES)
    # Each entry has the required cost fields.
    for row in est.per_stage_breakdown:
        assert "stage" in row
        assert "model" in row
        assert "total_cost_cents" in row
        assert row["total_cost_cents"] >= 0


def test_estimate_at_n_25_is_reasonable() -> None:
    """Sanity guardrail: N=25 should land in single-digit dollars
    per run. If pricing changes balloon this past $20, the test
    surfaces the regression at PR time rather than after a billing
    surprise."""
    est = estimate_run_cost(n_subagents=25)
    assert 0 < est.total_cost_cents < 2000  # under $20
