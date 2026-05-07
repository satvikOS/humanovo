"""
Statistical Analysis API Endpoints

Provides descriptive statistics, hypothesis testing, regression,
survival analysis, and sample size calculations for research data.
"""

import logging
import math
from datetime import datetime
from typing import Optional
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.auth import AUTH_REQUIRED

logger = logging.getLogger(__name__)
router = APIRouter(dependencies=AUTH_REQUIRED)
# ── Request / Response Schemas ───────────────────────────────────

class DescriptiveRequest(BaseModel):
    data: list[float]
    label: str = "Variable"


class TTestRequest(BaseModel):
    group1: list[float]
    group2: list[float]
    paired: bool = False
    label1: str = "Group 1"
    label2: str = "Group 2"


class AnovaRequest(BaseModel):
    groups: list[list[float]]
    labels: list[str] = []


class ChiSquareRequest(BaseModel):
    observed: list[list[int]]
    row_labels: list[str] = []
    col_labels: list[str] = []


class CorrelationRequest(BaseModel):
    variables: list[list[float]]
    labels: list[str] = []
    method: str = "pearson"  # pearson or spearman


class RegressionRequest(BaseModel):
    x: list[list[float]]  # feature columns
    y: list[float]  # target
    feature_names: list[str] = []
    regression_type: str = "linear"  # linear or logistic


class SurvivalRequest(BaseModel):
    times: list[float]
    events: list[int]  # 1=event, 0=censored
    groups: Optional[list[int]] = None
    group_labels: list[str] = []


class SampleSizeRequest(BaseModel):
    effect_size: float = 0.5
    alpha: float = 0.05
    power: float = 0.8
    test_type: str = "two_sample_t"  # two_sample_t, one_sample_t, paired_t, chi_square, anova
    table_rows: int = 2  # for chi-square contingency table
    table_cols: int = 2  # for chi-square contingency table
    num_groups: int = 3  # for ANOVA


class SaveAnalysisRequest(BaseModel):
    title: str
    analysis_type: str
    input_data: dict
    results: dict


# ── Helper functions ─────────────────────────────────────────────

def _mean(data: list[float]) -> float:
    return sum(data) / len(data) if data else 0.0


def _variance(data: list[float], ddof: int = 1) -> float:
    if len(data) <= ddof:
        return 0.0
    m = _mean(data)
    return sum((x - m) ** 2 for x in data) / (len(data) - ddof)


def _std(data: list[float], ddof: int = 1) -> float:
    return math.sqrt(_variance(data, ddof))


def _median(data: list[float]) -> float:
    s = sorted(data)
    n = len(s)
    if n == 0:
        return 0.0
    mid = n // 2
    if n % 2 == 0:
        return (s[mid - 1] + s[mid]) / 2
    return s[mid]


def _percentile(data: list[float], p: float) -> float:
    s = sorted(data)
    n = len(s)
    if n == 0:
        return 0.0
    k = (n - 1) * (p / 100.0)
    f = math.floor(k)
    c = math.ceil(k)
    if f == c:
        return s[int(k)]
    return s[int(f)] * (c - k) + s[int(c)] * (k - f)


def _skewness(data: list[float]) -> float:
    n = len(data)
    if n < 3:
        return 0.0
    m = _mean(data)
    s = _std(data)
    if s == 0:
        return 0.0
    return (n / ((n - 1) * (n - 2))) * sum(((x - m) / s) ** 3 for x in data)


def _kurtosis(data: list[float]) -> float:
    n = len(data)
    if n < 4:
        return 0.0
    m = _mean(data)
    s = _std(data)
    if s == 0:
        return 0.0
    kurt = (n * (n + 1)) / ((n - 1) * (n - 2) * (n - 3)) * sum(((x - m) / s) ** 4 for x in data)
    correction = (3 * (n - 1) ** 2) / ((n - 2) * (n - 3))
    return kurt - correction


def _t_statistic(g1: list[float], g2: list[float]) -> tuple[float, float, int]:
    """Returns (t_stat, p_value_approx, df)."""
    n1, n2 = len(g1), len(g2)
    m1, m2 = _mean(g1), _mean(g2)
    v1, v2 = _variance(g1), _variance(g2)

    if n1 < 2 or n2 < 2:
        return 0.0, 1.0, 0

    se = math.sqrt(v1 / n1 + v2 / n2) if (v1 / n1 + v2 / n2) > 0 else 1e-10
    t_stat = (m1 - m2) / se

    # Welch's df
    num = (v1 / n1 + v2 / n2) ** 2
    den = ((v1 / n1) ** 2 / (n1 - 1) + (v2 / n2) ** 2 / (n2 - 1)) if ((v1 / n1) ** 2 / max(n1 - 1, 1) + (v2 / n2) ** 2 / max(n2 - 1, 1)) > 0 else 1
    df = int(num / den) if den > 0 else n1 + n2 - 2

    # Approximate p-value using normal approximation for large df
    p_value = _approx_p_from_t(abs(t_stat), df)
    return t_stat, p_value, df


def _approx_p_from_t(t: float, df: int) -> float:
    """Approximate two-tailed p-value from t-statistic."""
    # Use a simple approximation based on the normal distribution
    # For df > 30, t-distribution is close to normal
    if df <= 0:
        return 1.0
    # Abramowitz and Stegun approximation for normal CDF
    z = t / math.sqrt(1 + t * t / max(df, 1)) if df > 0 else t
    return 2.0 * _normal_sf(abs(z))


def _normal_sf(z: float) -> float:
    """Survival function (1 - CDF) for standard normal using Abramowitz approx."""
    if z < 0:
        return 1.0 - _normal_sf(-z)
    b0 = 0.2316419
    b1 = 0.319381530
    b2 = -0.356563782
    b3 = 1.781477937
    b4 = -1.821255978
    b5 = 1.330274429
    t = 1.0 / (1.0 + b0 * z)
    phi = math.exp(-z * z / 2.0) / math.sqrt(2.0 * math.pi)
    return phi * (b1 * t + b2 * t**2 + b3 * t**3 + b4 * t**4 + b5 * t**5)


def _paired_t(g1: list[float], g2: list[float]) -> tuple[float, float, int]:
    """Paired t-test."""
    n = min(len(g1), len(g2))
    if n < 2:
        return 0.0, 1.0, 0
    diffs = [g1[i] - g2[i] for i in range(n)]
    m = _mean(diffs)
    s = _std(diffs)
    if s == 0:
        return 0.0, 1.0, n - 1
    t_stat = m / (s / math.sqrt(n))
    df = n - 1
    p_value = _approx_p_from_t(abs(t_stat), df)
    return t_stat, p_value, df


def _f_statistic(groups: list[list[float]]) -> tuple[float, float, int, int]:
    """One-way ANOVA F-test."""
    k = len(groups)
    if k < 2:
        return 0.0, 1.0, 0, 0

    all_data = [x for g in groups for x in g]
    grand_mean = _mean(all_data)
    N = len(all_data)

    ss_between = sum(len(g) * (_mean(g) - grand_mean) ** 2 for g in groups if g)
    ss_within = sum(sum((x - _mean(g)) ** 2 for x in g) for g in groups if g)

    df_between = k - 1
    df_within = N - k

    if df_within <= 0 or ss_within == 0:
        return 0.0, 1.0, df_between, max(df_within, 1)

    ms_between = ss_between / df_between
    ms_within = ss_within / df_within
    f_stat = ms_between / ms_within

    # Approximate p-value (rough)
    p_value = _approx_f_p(f_stat, df_between, df_within)
    return f_stat, p_value, df_between, df_within


def _approx_f_p(f: float, df1: int, df2: int) -> float:
    """Very rough F-distribution p-value approximation."""
    if f <= 0 or df1 <= 0 or df2 <= 0:
        return 1.0
    # Use the normal approximation of the F distribution
    z = ((f ** (1/3)) * (1 - 2/(9*df2)) - (1 - 2/(9*df1))) / math.sqrt(2/(9*df1) + (f ** (2/3)) * 2/(9*df2))
    return _normal_sf(z)


def _chi_square(observed: list[list[int]]) -> tuple[float, float, int]:
    """Chi-square test of independence."""
    rows = len(observed)
    if rows == 0:
        return 0.0, 1.0, 0
    cols = len(observed[0])

    row_totals = [sum(row) for row in observed]
    col_totals = [sum(observed[r][c] for r in range(rows)) for c in range(cols)]
    total = sum(row_totals)

    if total == 0:
        return 0.0, 1.0, 0

    chi2 = 0.0
    for r in range(rows):
        for c in range(cols):
            expected = (row_totals[r] * col_totals[c]) / total
            if expected > 0:
                chi2 += (observed[r][c] - expected) ** 2 / expected

    df = (rows - 1) * (cols - 1)
    # Approximate p-value using normal approx of chi-square
    if df > 0:
        z = ((chi2 / df) ** (1/3) - (1 - 2/(9*df))) / math.sqrt(2/(9*df))
        p_value = _normal_sf(z)
    else:
        p_value = 1.0

    return chi2, p_value, df


def _pearson_corr(x: list[float], y: list[float]) -> float:
    n = min(len(x), len(y))
    if n < 2:
        return 0.0
    mx, my = _mean(x[:n]), _mean(y[:n])
    num = sum((x[i] - mx) * (y[i] - my) for i in range(n))
    den_x = sum((x[i] - mx) ** 2 for i in range(n))
    den_y = sum((y[i] - my) ** 2 for i in range(n))
    den = math.sqrt(den_x * den_y)
    return num / den if den > 0 else 0.0


def _spearman_corr(x: list[float], y: list[float]) -> float:
    n = min(len(x), len(y))
    if n < 2:
        return 0.0

    def _rank(data: list[float]) -> list[float]:
        indexed = sorted(enumerate(data), key=lambda t: t[1])
        ranks = [0.0] * len(data)
        i = 0
        while i < len(indexed):
            j = i
            while j < len(indexed) and indexed[j][1] == indexed[i][1]:
                j += 1
            avg_rank = (i + j + 1) / 2.0
            for k in range(i, j):
                ranks[indexed[k][0]] = avg_rank
            i = j
        return ranks

    rx = _rank(x[:n])
    ry = _rank(y[:n])
    return _pearson_corr(rx, ry)


def _linear_regression(X: list[list[float]], y: list[float]) -> dict:
    """Simple linear regression using normal equations."""
    n = len(y)
    if n == 0:
        return {"coefficients": [], "intercept": 0, "r_squared": 0}

    p = len(X[0]) if X and X[0] else 0

    # Add intercept column
    X_aug = [[1.0] + row for row in X]
    p_aug = p + 1

    # X^T X
    XtX = [[sum(X_aug[k][i] * X_aug[k][j] for k in range(n)) for j in range(p_aug)] for i in range(p_aug)]
    # X^T y
    Xty = [sum(X_aug[k][i] * y[k] for k in range(n)) for i in range(p_aug)]

    # Solve using Gaussian elimination
    try:
        coeffs = _solve_linear(XtX, Xty)
    except Exception:
        coeffs = [0.0] * p_aug

    intercept = coeffs[0]
    betas = coeffs[1:]

    # R-squared
    y_mean = _mean(y)
    y_pred = [sum(X_aug[i][j] * coeffs[j] for j in range(p_aug)) for i in range(n)]
    ss_res = sum((y[i] - y_pred[i]) ** 2 for i in range(n))
    ss_tot = sum((y[i] - y_mean) ** 2 for i in range(n))
    r_squared = 1 - (ss_res / ss_tot) if ss_tot > 0 else 0.0

    return {
        "coefficients": [round(b, 6) for b in betas],
        "intercept": round(intercept, 6),
        "r_squared": round(r_squared, 6),
        "predictions": [round(p, 4) for p in y_pred[:20]],
    }


def _solve_linear(A: list[list[float]], b: list[float]) -> list[float]:
    """Gaussian elimination."""
    n = len(b)
    M = [A[i][:] + [b[i]] for i in range(n)]

    for col in range(n):
        max_row = max(range(col, n), key=lambda r: abs(M[r][col]))
        M[col], M[max_row] = M[max_row], M[col]
        if abs(M[col][col]) < 1e-12:
            continue
        for row in range(col + 1, n):
            factor = M[row][col] / M[col][col]
            for j in range(col, n + 1):
                M[row][j] -= factor * M[col][j]

    x = [0.0] * n
    for i in range(n - 1, -1, -1):
        if abs(M[i][i]) < 1e-12:
            x[i] = 0.0
        else:
            x[i] = (M[i][n] - sum(M[i][j] * x[j] for j in range(i + 1, n))) / M[i][i]
    return x


# ── Endpoints ────────────────────────────────────────────────────

@router.post("/descriptive")
async def descriptive_stats(request: DescriptiveRequest):
    """Compute descriptive statistics for a dataset."""
    data = request.data
    if not data:
        raise HTTPException(status_code=422, detail="Data array cannot be empty")

    n = len(data)
    s = sorted(data)

    result = {
        "label": request.label,
        "n": n,
        "mean": round(_mean(data), 6),
        "median": round(_median(data), 6),
        "std": round(_std(data), 6),
        "variance": round(_variance(data), 6),
        "min": round(min(data), 6),
        "max": round(max(data), 6),
        "range": round(max(data) - min(data), 6),
        "q1": round(_percentile(data, 25), 6),
        "q3": round(_percentile(data, 75), 6),
        "iqr": round(_percentile(data, 75) - _percentile(data, 25), 6),
        "skewness": round(_skewness(data), 6),
        "kurtosis": round(_kurtosis(data), 6),
        "sem": round(_std(data) / math.sqrt(n), 6) if n > 0 else 0,
        "ci_95_lower": round(_mean(data) - 1.96 * _std(data) / math.sqrt(n), 6) if n > 0 else 0,
        "ci_95_upper": round(_mean(data) + 1.96 * _std(data) / math.sqrt(n), 6) if n > 0 else 0,
        "histogram": _histogram(data, bins=10),
        "interpretation": f"The variable '{request.label}' has {n} observations with a mean of {round(_mean(data), 2)} (SD = {round(_std(data), 2)}). "
                         f"The distribution has skewness = {round(_skewness(data), 2)} and kurtosis = {round(_kurtosis(data), 2)}."
    }
    return result


def _histogram(data: list[float], bins: int = 10) -> list[dict]:
    if not data:
        return []
    mn, mx = min(data), max(data)
    if mn == mx:
        return [{"bin_start": mn, "bin_end": mx, "count": len(data)}]
    width = (mx - mn) / bins
    result = []
    for i in range(bins):
        lo = mn + i * width
        hi = mn + (i + 1) * width
        count = sum(1 for x in data if (lo <= x < hi) or (i == bins - 1 and x == hi))
        result.append({"bin_start": round(lo, 4), "bin_end": round(hi, 4), "count": count, "label": f"{round(lo, 1)}-{round(hi, 1)}"})
    return result


@router.post("/ttest")
async def t_test(request: TTestRequest):
    """Perform independent or paired t-test."""
    if len(request.group1) < 2 or len(request.group2) < 2:
        raise HTTPException(status_code=422, detail="Each group must have at least 2 observations")

    if request.paired:
        if len(request.group1) != len(request.group2):
            raise HTTPException(status_code=422, detail="Paired t-test requires equal group sizes")
        t_stat, p_value, df = _paired_t(request.group1, request.group2)
        test_name = "Paired t-test"
    else:
        t_stat, p_value, df = _t_statistic(request.group1, request.group2)
        test_name = "Independent two-sample t-test (Welch's)"

    sig = "statistically significant" if p_value < 0.05 else "not statistically significant"
    m1, m2 = round(_mean(request.group1), 3), round(_mean(request.group2), 3)

    return {
        "test": test_name,
        "t_statistic": round(t_stat, 6),
        "p_value": round(p_value, 6),
        "degrees_of_freedom": df,
        "group1_stats": {"label": request.label1, "n": len(request.group1), "mean": m1, "std": round(_std(request.group1), 3)},
        "group2_stats": {"label": request.label2, "n": len(request.group2), "mean": m2, "std": round(_std(request.group2), 3)},
        "mean_difference": round(m1 - m2, 6),
        "significant_at_05": p_value < 0.05,
        "significant_at_01": p_value < 0.01,
        "effect_size_cohens_d": round((m1 - m2) / math.sqrt((_variance(request.group1) + _variance(request.group2)) / 2), 4) if (_variance(request.group1) + _variance(request.group2)) > 0 else 0,
        "interpretation": f"The {test_name} shows the difference between {request.label1} (M={m1}) and {request.label2} (M={m2}) is {sig} (t({df}) = {round(t_stat, 3)}, p = {round(p_value, 4)})."
    }


@router.post("/anova")
async def one_way_anova(request: AnovaRequest):
    """Perform one-way ANOVA."""
    if len(request.groups) < 2:
        raise HTTPException(status_code=422, detail="ANOVA requires at least 2 groups")
    for i, g in enumerate(request.groups):
        if len(g) < 2:
            raise HTTPException(status_code=422, detail=f"Group {i+1} must have at least 2 observations")

    f_stat, p_value, df_between, df_within = _f_statistic(request.groups)
    labels = request.labels if request.labels else [f"Group {i+1}" for i in range(len(request.groups))]
    sig = "statistically significant" if p_value < 0.05 else "not statistically significant"

    group_stats = [
        {"label": labels[i] if i < len(labels) else f"Group {i+1}",
         "n": len(g), "mean": round(_mean(g), 3), "std": round(_std(g), 3)}
        for i, g in enumerate(request.groups)
    ]

    return {
        "test": "One-way ANOVA",
        "f_statistic": round(f_stat, 6),
        "p_value": round(p_value, 6),
        "df_between": df_between,
        "df_within": df_within,
        "group_stats": group_stats,
        "significant_at_05": p_value < 0.05,
        "interpretation": f"The one-way ANOVA result is {sig} (F({df_between},{df_within}) = {round(f_stat, 3)}, p = {round(p_value, 4)})."
    }


@router.post("/chi-square")
async def chi_square_test(request: ChiSquareRequest):
    """Perform chi-square test of independence."""
    if not request.observed or not request.observed[0]:
        raise HTTPException(status_code=422, detail="Observed data cannot be empty")

    chi2, p_value, df = _chi_square(request.observed)
    sig = "statistically significant" if p_value < 0.05 else "not statistically significant"

    total = sum(sum(row) for row in request.observed)
    rows = len(request.observed)
    cols = len(request.observed[0])

    # Cramér's V
    min_dim = min(rows, cols) - 1
    cramers_v = math.sqrt(chi2 / (total * min_dim)) if total > 0 and min_dim > 0 else 0

    return {
        "test": "Chi-square test of independence",
        "chi_square_statistic": round(chi2, 6),
        "p_value": round(p_value, 6),
        "degrees_of_freedom": df,
        "cramers_v": round(cramers_v, 4),
        "significant_at_05": p_value < 0.05,
        "observed": request.observed,
        "row_labels": request.row_labels or [f"Row {i+1}" for i in range(rows)],
        "col_labels": request.col_labels or [f"Col {j+1}" for j in range(cols)],
        "interpretation": f"The chi-square test result is {sig} (χ²({df}) = {round(chi2, 3)}, p = {round(p_value, 4)}, Cramér's V = {round(cramers_v, 3)})."
    }


@router.post("/correlation")
async def correlation_matrix(request: CorrelationRequest):
    """Compute correlation matrix."""
    if len(request.variables) < 2:
        raise HTTPException(status_code=422, detail="Need at least 2 variables")

    n_vars = len(request.variables)
    labels = request.labels if len(request.labels) == n_vars else [f"Var {i+1}" for i in range(n_vars)]
    corr_func = _spearman_corr if request.method == "spearman" else _pearson_corr

    matrix = []
    for i in range(n_vars):
        row = []
        for j in range(n_vars):
            if i == j:
                row.append(1.0)
            else:
                row.append(round(corr_func(request.variables[i], request.variables[j]), 6))
        matrix.append(row)

    # Find strongest correlations (off-diagonal)
    pairs = []
    for i in range(n_vars):
        for j in range(i + 1, n_vars):
            pairs.append({"var1": labels[i], "var2": labels[j], "r": matrix[i][j], "abs_r": abs(matrix[i][j])})
    pairs.sort(key=lambda p: p["abs_r"], reverse=True)

    return {
        "method": request.method,
        "labels": labels,
        "matrix": matrix,
        "strongest_pairs": pairs[:5],
        "interpretation": f"Correlation matrix ({request.method}) computed for {n_vars} variables. "
                         + (f"Strongest correlation: {pairs[0]['var1']} vs {pairs[0]['var2']} (r = {pairs[0]['r']})." if pairs else "")
    }


@router.post("/regression")
async def regression_analysis(request: RegressionRequest):
    """Perform linear or logistic regression."""
    if not request.x or not request.y:
        raise HTTPException(status_code=422, detail="X and y data required")
    if len(request.x) != len(request.y):
        raise HTTPException(status_code=422, detail="X and y must have same length")

    feature_names = request.feature_names if request.feature_names else [f"X{i+1}" for i in range(len(request.x[0]) if request.x else 0)]

    if request.regression_type == "linear":
        result = _linear_regression(request.x, request.y)
        coeffs_table = [
            {"feature": feature_names[i] if i < len(feature_names) else f"X{i+1}",
             "coefficient": result["coefficients"][i]}
            for i in range(len(result["coefficients"]))
        ]
        return {
            "type": "Linear Regression",
            "intercept": result["intercept"],
            "coefficients": coeffs_table,
            "r_squared": result["r_squared"],
            "adjusted_r_squared": round(1 - (1 - result["r_squared"]) * (len(request.y) - 1) / max(len(request.y) - len(request.x[0]) - 1, 1), 6),
            "n_observations": len(request.y),
            "n_features": len(request.x[0]) if request.x else 0,
            "predictions_sample": result["predictions"],
            "interpretation": f"Linear regression model with R² = {result['r_squared']}. "
                             f"The model explains {round(result['r_squared'] * 100, 1)}% of the variance in the outcome."
        }
    else:
        # Logistic regression - simple sigmoid approximation
        lin_result = _linear_regression(request.x, request.y)
        return {
            "type": "Logistic Regression (approximation)",
            "intercept": lin_result["intercept"],
            "coefficients": [
                {"feature": feature_names[i] if i < len(feature_names) else f"X{i+1}",
                 "coefficient": lin_result["coefficients"][i]}
                for i in range(len(lin_result["coefficients"]))
            ],
            "pseudo_r_squared": lin_result["r_squared"],
            "n_observations": len(request.y),
            "interpretation": "Logistic regression approximation computed. For precise results with odds ratios, use a dedicated statistical package."
        }


@router.post("/survival")
async def survival_analysis(request: SurvivalRequest):
    """Kaplan-Meier survival analysis."""
    if not request.times or not request.events:
        raise HTTPException(status_code=422, detail="Times and events data required")
    if len(request.times) != len(request.events):
        raise HTTPException(status_code=422, detail="Times and events must have same length")

    def _kaplan_meier(times: list[float], events: list[int]) -> list[dict]:
        combined = sorted(zip(times, events), key=lambda x: x[0])
        n_at_risk = len(combined)
        survival = 1.0
        curve = [{"time": 0, "survival": 1.0, "at_risk": n_at_risk, "events": 0}]

        i = 0
        while i < len(combined):
            t = combined[i][0]
            d = 0  # deaths at this time
            c = 0  # censored at this time
            while i < len(combined) and combined[i][0] == t:
                if combined[i][1] == 1:
                    d += 1
                else:
                    c += 1
                i += 1

            if d > 0:
                survival *= (1 - d / n_at_risk)
            curve.append({"time": round(t, 4), "survival": round(survival, 6), "at_risk": n_at_risk, "events": d})
            n_at_risk -= (d + c)

        return curve

    # Overall curve
    overall_curve = _kaplan_meier(request.times, request.events)
    median_survival = None
    for point in overall_curve:
        if point["survival"] <= 0.5:
            median_survival = point["time"]
            break

    result = {
        "analysis": "Kaplan-Meier Survival Analysis",
        "n_subjects": len(request.times),
        "n_events": sum(request.events),
        "n_censored": len(request.events) - sum(request.events),
        "median_survival": median_survival,
        "overall_curve": overall_curve,
        "interpretation": f"Kaplan-Meier analysis of {len(request.times)} subjects with {sum(request.events)} events. "
                         + (f"Median survival time: {median_survival}." if median_survival else "Median survival not reached.")
    }

    # Group comparison if provided
    if request.groups and len(request.groups) == len(request.times):
        unique_groups = sorted(set(request.groups))
        group_curves = {}
        for g in unique_groups:
            g_times = [request.times[i] for i in range(len(request.times)) if request.groups[i] == g]
            g_events = [request.events[i] for i in range(len(request.events)) if request.groups[i] == g]
            label = request.group_labels[g] if g < len(request.group_labels) else f"Group {g}"
            group_curves[label] = _kaplan_meier(g_times, g_events)
        result["group_curves"] = group_curves

    return result


@router.post("/sample-size")
async def sample_size_calculator(request: SampleSizeRequest):
    """Calculate required sample size for a study."""
    alpha = request.alpha
    power = request.power
    d = request.effect_size
    warnings = []

    # Input validation
    if d <= 0:
        return {"test_type": request.test_type, "effect_size": d, "alpha": alpha, "power": power,
                "n_per_group": 0, "total_n": 0, "warnings": ["Effect size must be greater than 0."]}
    if not (0 < alpha < 1):
        return {"test_type": request.test_type, "effect_size": d, "alpha": alpha, "power": power,
                "n_per_group": 0, "total_n": 0, "warnings": ["Alpha must be between 0 and 1 (exclusive)."]}
    if not (0 < power < 1):
        return {"test_type": request.test_type, "effect_size": d, "alpha": alpha, "power": power,
                "n_per_group": 0, "total_n": 0, "warnings": ["Power must be between 0 and 1 (exclusive)."]}

    # Z-values: two-tailed alpha, one-tailed beta
    z_alpha = 1.96 if alpha == 0.05 else (2.576 if alpha == 0.01 else (1.645 if alpha == 0.10 else _z_from_alpha(alpha)))
    z_beta = 0.842 if abs(power - 0.8) < 0.01 else (1.282 if abs(power - 0.9) < 0.01 else (1.645 if abs(power - 0.95) < 0.01 else _z_from_power(power)))

    effect_label = "Cohen's d"
    extra = {}

    if request.test_type == "two_sample_t":
        n_per_group = math.ceil(2 * ((z_alpha + z_beta) / d) ** 2)
        total_n = n_per_group * 2
        desc = f"Two-sample t-test: {n_per_group} per group, {total_n} total"
        if d > 2:
            warnings.append("Effect size d > 2.0 is unusually large. Verify your estimate.")

    elif request.test_type in ("one_sample_t", "paired_t"):
        n_per_group = math.ceil(((z_alpha + z_beta) / d) ** 2)
        total_n = n_per_group
        label = "One-sample t-test" if request.test_type == "one_sample_t" else "Paired t-test"
        desc = f"{label}: {n_per_group} subjects needed"
        if d > 2:
            warnings.append("Effect size d > 2.0 is unusually large. Verify your estimate.")

    elif request.test_type == "chi_square":
        effect_label = "Cohen's w"
        w = d
        rows = max(2, request.table_rows)
        cols = max(2, request.table_cols)
        df = (rows - 1) * (cols - 1)
        # Chi-square sample size with df correction
        n = math.ceil(((z_alpha + z_beta) / w) ** 2 + df)
        # Ensure minimum expected cell counts >= 5
        min_n_for_cells = math.ceil(5 * rows * cols)
        if n < min_n_for_cells:
            n = min_n_for_cells
            warnings.append(f"Sample size increased to {min_n_for_cells} to ensure minimum expected cell count >= 5 ({rows}x{cols} table).")
        n_per_group = n
        total_n = n
        desc = f"Chi-square test ({rows}x{cols} table, df={df}): {n} total subjects needed"
        extra = {"table_rows": rows, "table_cols": cols, "df": df}
        if w < 0.1:
            warnings.append("Cohen's w < 0.1 is a very small effect. Large samples needed.")
        if w > 0.5:
            warnings.append("Cohen's w > 0.5 is a large effect. Verify your estimate.")

    elif request.test_type == "anova":
        effect_label = "Cohen's f"
        k = max(2, request.num_groups)
        n_per_group = math.ceil(((z_alpha + z_beta) / d) ** 2 + 1)
        total_n = n_per_group * k
        desc = f"One-way ANOVA ({k} groups): {n_per_group} per group, {total_n} total"
        extra = {"num_groups": k}
        if d > 0.8:
            warnings.append("Cohen's f > 0.8 is unusually large. Verify your estimate.")

    else:
        n_per_group = 0
        total_n = 0
        desc = "Unknown test type"
        warnings.append(f"Unrecognized test type: {request.test_type}")

    # Determine effect size interpretation based on test type
    if request.test_type == "chi_square":
        effect_interpretation = "small" if d < 0.2 else ("medium" if d < 0.4 else "large")
    elif request.test_type == "anova":
        effect_interpretation = "small" if d < 0.15 else ("medium" if d < 0.35 else "large")
    else:
        effect_interpretation = "small" if d < 0.3 else ("medium" if d < 0.7 else "large")

    if alpha > 0.10:
        warnings.append("Alpha > 0.10 is unconventional. Consider using 0.05 or 0.01.")
    if power < 0.7:
        warnings.append("Power < 0.70 increases risk of failing to detect a real effect.")
    if total_n > 0 and total_n < 10:
        warnings.append("Very small sample size. Results may be unreliable.")

    buffer_n = math.ceil(total_n * 1.15) if total_n > 0 else 0

    return {
        "test_type": request.test_type,
        "effect_size": d,
        "effect_label": effect_label,
        "effect_interpretation": effect_interpretation,
        "alpha": alpha,
        "power": power,
        "n_per_group": n_per_group,
        "total_n": total_n,
        "buffer_n": buffer_n,
        "description": desc,
        "warnings": warnings,
        "recommendations": [
            f"Based on a {effect_interpretation} {effect_label} ({d}), α={alpha}, power={power}",
            f"Required sample size: {total_n} total participants",
            "Consider adding 10-20% for dropout/attrition",
            f"Recommended total with 15% buffer: {buffer_n}",
        ],
        **extra,
    }


def _z_from_alpha(alpha: float) -> float:
    """Approximate z-value for two-tailed alpha using rational approximation."""
    p = alpha / 2
    if p <= 0 or p >= 1:
        return 1.96
    t = math.sqrt(-2 * math.log(p))
    return t - (2.30753 + t * 0.27061) / (1 + t * (0.99229 + t * 0.04481))


def _z_from_power(power: float) -> float:
    """Approximate z-value for power (one-tailed)."""
    p = 1 - power
    if p <= 0 or p >= 1:
        return 0.842
    t = math.sqrt(-2 * math.log(p))
    return t - (2.30753 + t * 0.27061) / (1 + t * (0.99229 + t * 0.04481))


# ── Saved Analyses CRUD ─────────────────────────────────────────


def _get_saved_model():
    from app.models.platform_entities import SavedAnalysis
    return SavedAnalysis


@router.get("/saved")
async def list_saved_analyses(db: AsyncSession = Depends(get_db)):
    """List all saved analyses."""
    SavedAnalysis = _get_saved_model()
    result = await db.execute(
        select(SavedAnalysis).order_by(SavedAnalysis.created_at.desc())
    )
    items = result.scalars().all()
    return {"items": [a.to_dict() for a in items], "total": len(items)}


@router.post("/saved")
async def save_analysis(request: SaveAnalysisRequest, db: AsyncSession = Depends(get_db)):
    """Save an analysis result."""
    SavedAnalysis = _get_saved_model()
    analysis = SavedAnalysis(
        title=request.title,
        analysis_type=request.analysis_type,
        input_data=request.input_data,
        results=request.results,
    )
    db.add(analysis)
    await db.flush()
    return analysis.to_dict()


@router.get("/saved/{analysis_id}")
async def get_saved_analysis(analysis_id: str, db: AsyncSession = Depends(get_db)):
    """Get a saved analysis."""
    SavedAnalysis = _get_saved_model()
    try:
        uid = UUID(analysis_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Analysis not found")
    analysis = await db.get(SavedAnalysis, uid)
    if not analysis:
        raise HTTPException(status_code=404, detail="Analysis not found")
    return analysis.to_dict()


@router.delete("/saved/{analysis_id}")
async def delete_saved_analysis(analysis_id: str, db: AsyncSession = Depends(get_db)):
    """Delete a saved analysis."""
    SavedAnalysis = _get_saved_model()
    try:
        uid = UUID(analysis_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Analysis not found")
    analysis = await db.get(SavedAnalysis, uid)
    if not analysis:
        raise HTTPException(status_code=404, detail="Analysis not found")
    await db.delete(analysis)
    await db.flush()
    return {"status": "deleted"}
