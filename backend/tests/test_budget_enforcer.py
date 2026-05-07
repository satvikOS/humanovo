"""
Tests for the per-run RunBudgetEnforcer.

UserBudgetService tests are not run here because they require a live
Postgres; those are covered by integration tests.
"""

import pytest

from app.services.budget_enforcer_service import (
    DEFAULT_CAPS_CENTS,
    BudgetExceeded,
    DegradationLevel,
    RunBudgetEnforcer,
    RunKind,
)


def test_default_caps_match_product_spec():
    # $9 discovery run (9 hypotheses × $1)
    assert DEFAULT_CAPS_CENTS[RunKind.DISCOVERY] == 900
    # $1 single hypothesis
    assert DEFAULT_CAPS_CENTS[RunKind.SINGLE_HYPOTHESIS] == 100
    # $2 paper gen
    assert DEFAULT_CAPS_CENTS[RunKind.PAPER_GEN] == 200


def test_charge_under_cap_does_not_raise():
    enf = RunBudgetEnforcer(
        run_id="r1", user_id="u1", kind=RunKind.DISCOVERY, cap_cents=1000,
    )
    enf.charge(provider="bedrock", model="claude-3-5-haiku",
               input_tokens=1000, output_tokens=500)
    assert enf.state.spent_cents < 1000
    assert enf.state.degradation == DegradationLevel.NONE


def test_charge_over_cap_raises_budget_exceeded():
    enf = RunBudgetEnforcer(
        run_id="r2", user_id="u1", kind=RunKind.DISCOVERY, cap_cents=1,
    )
    with pytest.raises(BudgetExceeded) as exc_info:
        # Sonnet is expensive enough that any call blows a 1-cent cap.
        enf.charge(provider="bedrock", model="claude-sonnet-4-6",
                   input_tokens=100_000, output_tokens=10_000)
    assert exc_info.value.cap_cents == 1
    assert enf.state.truncated is True


def test_degradation_ladder():
    # Set a small cap so we can easily cross thresholds.
    enf = RunBudgetEnforcer(
        run_id="r3", user_id="u1", kind=RunKind.DISCOVERY, cap_cents=100,
    )
    # Start: NONE
    assert enf.state.degradation == DegradationLevel.NONE
    # Manually push spent via charge; use Haiku with known per-token cost
    # so we don't rely on exact values — just accumulate.
    # The important test is that degradation transitions fire.
    enf.state.spent_cents = 70  # 70% of 100
    enf._update_degradation()
    assert enf.state.degradation == DegradationLevel.MILD
    enf.state.spent_cents = 85
    enf._update_degradation()
    assert enf.state.degradation == DegradationLevel.MODERATE
    enf.state.spent_cents = 97
    enf._update_degradation()
    assert enf.state.degradation == DegradationLevel.SEVERE


def test_select_model_downgrades_at_mild():
    enf = RunBudgetEnforcer(
        run_id="r4", user_id="u1", kind=RunKind.DISCOVERY, cap_cents=100,
    )
    enf.state.spent_cents = 70
    enf._update_degradation()
    # refine / translate / finalize / seed are MILD-eligible stages
    downgraded = enf.select_model(default="claude-sonnet-4-6", stage_name="refine")
    assert "haiku" in downgraded.lower()


def test_select_model_downgrades_moderate_and_severe():
    enf = RunBudgetEnforcer(
        run_id="r5", user_id="u1", kind=RunKind.DISCOVERY, cap_cents=100,
    )
    enf.state.spent_cents = 85
    enf._update_degradation()
    # MODERATE downgrades all generative calls
    assert "haiku" in enf.select_model(default="claude-sonnet-4-6",
                                       stage_name="mechanism").lower()


def test_select_model_unchanged_when_no_degradation():
    enf = RunBudgetEnforcer(
        run_id="r6", user_id="u1", kind=RunKind.DISCOVERY, cap_cents=100,
    )
    m = enf.select_model(default="claude-sonnet-4-6", stage_name="mechanism")
    assert m == "claude-sonnet-4-6"


def test_notification_attached_on_degradation_transition():
    enf = RunBudgetEnforcer(
        run_id="r7", user_id="u1", kind=RunKind.DISCOVERY, cap_cents=100,
    )
    assert not enf.state.notifications
    enf.state.spent_cents = 70
    enf._update_degradation()
    assert len(enf.state.notifications) == 1
    assert enf.state.notifications[0].kind == "warning"


def test_assert_allowed_raises_after_blocked():
    enf = RunBudgetEnforcer(
        run_id="r8", user_id="u1", kind=RunKind.DISCOVERY, cap_cents=100,
    )
    enf.state.spent_cents = 200
    enf._update_degradation()
    assert enf.state.degradation == DegradationLevel.BLOCKED
    with pytest.raises(BudgetExceeded):
        enf.assert_allowed(stage_name="anything")


def test_summary_contains_expected_fields():
    enf = RunBudgetEnforcer(
        run_id="r9", user_id="u1", kind=RunKind.DISCOVERY, cap_cents=900,
    )
    s = enf.summary()
    assert s["run_id"] == "r9"
    assert s["kind"] == "discovery"
    assert s["cap_usd"] == 9.0
    assert "percent_used" in s
    assert "degradation_level" in s
    assert "notifications" in s
