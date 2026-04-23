"""
Unit tests for the /compute/regression endpoint.

Pure-Python OLS implementation — these tests validate that the
returned slope, intercept, R², CI, and diagnostics arrays match
expected values for known clean and noisy data sets. Bypasses the
HTTP layer by calling the route handler directly.
"""
from __future__ import annotations

import math

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints.compute import (
    RegressionRequest,
    regression,
    _t_critical_95,
    _student_t_two_sided_p,
)


@pytest.mark.asyncio
async def test_regression_clean_line_recovers_slope_and_intercept() -> None:
    # y = 2x + 1 with no noise — recover the parameters exactly.
    x = list(range(1, 11))
    y = [2.0 * xi + 1.0 for xi in x]
    r = await regression(RegressionRequest(x=x, y=y))
    assert r.slope == pytest.approx(2.0, abs=1e-9)
    assert r.intercept == pytest.approx(1.0, abs=1e-9)
    assert r.r2 == pytest.approx(1.0, abs=1e-9)
    assert r.rmse == pytest.approx(0.0, abs=1e-9)
    # Fitted values exactly reproduce y; residuals are zero.
    assert all(abs(f - yi) < 1e-9 for f, yi in zip(r.fitted, y))
    assert all(abs(rr) < 1e-9 for rr in r.residuals)


@pytest.mark.asyncio
async def test_regression_noisy_line_returns_reasonable_ci() -> None:
    # Noisy y = 2x + 1, ε ~ small Gaussian-like.
    x = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    y = [3.1, 5.0, 7.2, 8.8, 11.1, 13.0, 14.9, 17.2, 19.1, 21.0]
    r = await regression(RegressionRequest(x=x, y=y))
    # Slope should land near 2 and lie inside its own 95% CI.
    assert 1.9 < r.slope < 2.1
    assert r.ci_slope[0] < r.slope < r.ci_slope[1]
    # CI width is reasonable (not collapsed, not absurdly wide).
    width = r.ci_slope[1] - r.ci_slope[0]
    assert 0.001 < width < 1.0
    # R² is high for clearly linear data.
    assert r.r2 > 0.99
    # P-value should be tiny.
    assert r.p_value < 1e-6


@pytest.mark.asyncio
async def test_regression_diagnostics_arrays_have_correct_length() -> None:
    x = list(range(1, 21))
    y = [2.0 * xi + 0.1 * (xi % 3) for xi in x]
    r = await regression(RegressionRequest(x=x, y=y))
    assert r.n == 20
    assert len(r.fitted) == 20
    assert len(r.residuals) == 20
    assert len(r.leverages) == 20
    assert len(r.cooks_d) == 20
    # Sum of leverages equals number of parameters (= 2 for simple OLS).
    assert sum(r.leverages) == pytest.approx(2.0, abs=1e-6)
    # Cook's distance is non-negative.
    assert all(d >= 0 for d in r.cooks_d)
    # Threshold is 4/n.
    assert r.cook_threshold == pytest.approx(4.0 / 20)


@pytest.mark.asyncio
async def test_regression_rejects_mismatched_lengths() -> None:
    with pytest.raises(HTTPException) as exc:
        await regression(RegressionRequest(x=[1, 2, 3], y=[1, 2]))
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_regression_rejects_too_few_observations() -> None:
    with pytest.raises(HTTPException) as exc:
        await regression(RegressionRequest(x=[1, 2], y=[1, 2]))
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_regression_rejects_zero_x_variance() -> None:
    with pytest.raises(HTTPException) as exc:
        await regression(RegressionRequest(x=[5, 5, 5, 5], y=[1, 2, 3, 4]))
    assert exc.value.status_code == 400


def test_t_critical_95_table_values() -> None:
    # Spot-check known values from a t-table.
    assert _t_critical_95(1) == pytest.approx(12.706, abs=1e-3)
    assert _t_critical_95(8) == pytest.approx(2.306, abs=1e-3)
    assert _t_critical_95(30) == pytest.approx(2.042, abs=1e-3)
    # Asymptotic approach to z=1.96 for very large df.
    assert _t_critical_95(10000) == pytest.approx(1.960, abs=0.01)


def test_t_critical_95_interpolation_between_table_entries() -> None:
    # df=35 is between 30 (2.042) and 40 (2.021); should interpolate.
    v = _t_critical_95(35)
    assert 2.020 < v < 2.043


def test_student_t_p_value_symmetric_about_zero() -> None:
    # p(t) and p(-t) should match for two-sided test.
    p_pos = _student_t_two_sided_p(2.0, 10)
    p_neg = _student_t_two_sided_p(-2.0, 10)
    assert p_pos == pytest.approx(p_neg, abs=1e-9)


def test_student_t_p_value_monotonic_in_magnitude() -> None:
    # As |t| grows, the two-sided p-value shrinks.
    df = 10
    p1 = _student_t_two_sided_p(1.0, df)
    p3 = _student_t_two_sided_p(3.0, df)
    p5 = _student_t_two_sided_p(5.0, df)
    assert p1 > p3 > p5
    # Sanity: t=0 gives p≈1 (or close to it).
    p0 = _student_t_two_sided_p(0.0, df)
    assert p0 > 0.99


def test_student_t_p_value_handles_invalid_df() -> None:
    p = _student_t_two_sided_p(2.0, 0)
    assert math.isnan(p)
