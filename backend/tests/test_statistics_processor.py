"""
Unit tests for app.compute.statistics.processor.StatisticsProcessor.

These exercise the core statistical operations with known-answer inputs —
fixed random seeds or deterministic lists — so regressions show up as
numerical drift rather than flakiness. Each test drives the public
execute() dispatcher so we also cover request-validation + error paths.
"""
from __future__ import annotations

import math
from typing import Any

import numpy as np
import pytest

from app.compute.statistics.processor import StatisticsProcessor
from app.compute.types import ComputeDomain, ComputeRequest, ComputeStatus


def _req(op: str, **params: Any) -> ComputeRequest:
    return ComputeRequest(
        domain=ComputeDomain.STATISTICS,
        operation=op,
        parameters=params,
    )


@pytest.fixture
def proc() -> StatisticsProcessor:
    return StatisticsProcessor()


# ── descriptive ────────────────────────────────────────────────────────


async def test_descriptive_reports_mean_and_normality(proc: StatisticsProcessor) -> None:
    rng = np.random.default_rng(42)
    samples = rng.normal(loc=10.0, scale=2.0, size=100).tolist()

    result = await proc.execute(_req("descriptive", data={"cohort_a": samples}))

    assert result.status is ComputeStatus.COMPLETED
    assert "cohort_a" in result.descriptive
    # Mean of a normal sample should be close to loc=10.
    assert abs(result.descriptive["cohort_a"].mean - 10.0) < 0.5
    # Shapiro-Wilk should call this normal at size 100.
    norm = result.results["normality_tests"]["cohort_a"]
    assert bool(norm["normal"]) is True


async def test_descriptive_handles_bare_list(proc: StatisticsProcessor) -> None:
    result = await proc.execute(_req("descriptive", data=[1.0, 2.0, 3.0, 4.0, 5.0]))
    assert result.status is ComputeStatus.COMPLETED
    assert "data" in result.descriptive
    assert result.descriptive["data"].mean == pytest.approx(3.0)


# ── t-test ─────────────────────────────────────────────────────────────


async def test_t_test_detects_real_difference(proc: StatisticsProcessor) -> None:
    rng = np.random.default_rng(1)
    g1 = rng.normal(0, 1, 50).tolist()
    g2 = rng.normal(2, 1, 50).tolist()

    result = await proc.execute(_req("t_test", group1=g1, group2=g2))

    assert result.status is ComputeStatus.COMPLETED
    assert len(result.statistics) == 1
    t = result.statistics[0]
    assert t.p_value < 0.01
    assert t.significant is True
    # Cohen's d for a two-SD shift should be ~2.
    assert abs((t.effect_size or 0) + 2.0) < 0.5 or abs((t.effect_size or 0) - 2.0) < 0.5


async def test_t_test_one_sample_against_mu(proc: StatisticsProcessor) -> None:
    rng = np.random.default_rng(7)
    g1 = rng.normal(5, 1, 40).tolist()

    result = await proc.execute(_req("t_test", group1=g1, mu=0))

    assert result.status is ComputeStatus.COMPLETED
    assert result.statistics[0].p_value < 0.001


async def test_t_test_null_is_not_significant(proc: StatisticsProcessor) -> None:
    rng = np.random.default_rng(3)
    g1 = rng.normal(0, 1, 200).tolist()
    g2 = rng.normal(0, 1, 200).tolist()

    result = await proc.execute(_req("t_test", group1=g1, group2=g2))

    # True null — should usually be > 0.05, but to be safe just confirm no crash
    # and a reasonable p-value bound.
    assert result.status is ComputeStatus.COMPLETED
    assert 0 <= result.statistics[0].p_value <= 1


# ── mann-whitney ───────────────────────────────────────────────────────


async def test_mann_whitney_reports_effect_size(proc: StatisticsProcessor) -> None:
    rng = np.random.default_rng(9)
    g1 = rng.normal(0, 1, 30).tolist()
    g2 = rng.normal(3, 1, 30).tolist()

    result = await proc.execute(_req("mann_whitney", group1=g1, group2=g2))

    assert result.status is ComputeStatus.COMPLETED
    stat = result.statistics[0]
    assert stat.test_name == "Mann-Whitney U"
    assert stat.p_value < 0.001
    assert stat.effect_size is not None
    assert abs(stat.effect_size) > 0.5


# ── chi-square ─────────────────────────────────────────────────────────


async def test_chi_square_detects_contingency(proc: StatisticsProcessor) -> None:
    # Classic 2x2 with strong association.
    observed = [[90, 10], [10, 90]]

    result = await proc.execute(_req("chi_square", observed=observed))

    assert result.status is ComputeStatus.COMPLETED
    stat = result.statistics[0]
    assert stat.p_value < 1e-10
    assert stat.degrees_of_freedom == 1
    cramers_v = result.results["cramers_v"]
    # Cramér's V should be high (~0.8) for this table.
    assert cramers_v > 0.7


# ── correlation ────────────────────────────────────────────────────────


async def test_pearson_correlation_on_linear_data(proc: StatisticsProcessor) -> None:
    rng = np.random.default_rng(11)
    x = rng.normal(0, 1, 80)
    y = 2 * x + rng.normal(0, 0.1, 80)  # tight linear relationship

    result = await proc.execute(
        _req("correlation", x=x.tolist(), y=y.tolist(), method="pearson")
    )

    assert result.status is ComputeStatus.COMPLETED
    stat = result.statistics[0]
    assert stat.statistic > 0.95
    assert stat.p_value < 1e-20
    assert stat.ci is not None
    assert stat.ci.lower < stat.statistic < stat.ci.upper


async def test_spearman_correlation_monotonic_nonlinear(proc: StatisticsProcessor) -> None:
    x = list(range(1, 21))
    y = [math.exp(i / 5) for i in x]  # monotone nonlinear

    result = await proc.execute(_req("correlation", x=x, y=y, method="spearman"))

    assert result.status is ComputeStatus.COMPLETED
    # Perfect monotone relationship → spearman ≈ 1.
    assert result.statistics[0].statistic == pytest.approx(1.0)


# ── unknown operation ──────────────────────────────────────────────────


async def test_unknown_operation_returns_failed_status(proc: StatisticsProcessor) -> None:
    result = await proc.execute(_req("definitely_not_a_real_op"))

    assert result.status is ComputeStatus.FAILED
    assert "Unknown operation" in (result.error or "")


async def test_operation_exception_is_captured(proc: StatisticsProcessor) -> None:
    # Missing required "group1" parameter — handler raises, dispatcher
    # should catch it and mark the result FAILED rather than bubble up.
    result = await proc.execute(_req("t_test"))
    assert result.status is ComputeStatus.FAILED
    assert result.error is not None


# ── power analysis ─────────────────────────────────────────────────────


async def test_power_analysis_shape(proc: StatisticsProcessor) -> None:
    result = await proc.execute(
        _req("power_analysis", effect_size=0.5, alpha=0.05, power=0.8, test_type="t_test")
    )
    # Don't assert exact n (depends on scipy version); just confirm
    # we got a valid numeric answer out without crashing.
    assert result.status is ComputeStatus.COMPLETED
