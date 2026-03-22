"""
Statistics Lambda Handler - Statistical analysis computations.
Stateless — no database needed.
"""

import json
import logging
import math
import traceback
from typing import Any

# Defensive powertools imports — Lambda must NEVER crash on cold start
try:
    from aws_lambda_powertools import Logger, Metrics
    from aws_lambda_powertools.event_handler import APIGatewayHttpResolver, Response
    from aws_lambda_powertools.utilities.typing import LambdaContext
    logger = Logger()
    metrics = Metrics()
except ImportError as _import_err:
    logging.error(f"aws_lambda_powertools import failed: {_import_err}")
    logger = logging.getLogger("statistics")
    logger.setLevel(logging.DEBUG)

    import re as _re_stub

    class APIGatewayHttpResolver:
        """Stub resolver when powertools is unavailable."""
        def __init__(self):
            self._routes = []
            self.current_event = None
        def _register(self, method, path, func):
            param_names = _re_stub.findall(r'<(\w+)>', path)
            pattern = _re_stub.sub(r'<\w+>', r'([^/]+)', path)
            pattern_re = _re_stub.compile(f'^{pattern}$')
            self._routes.append((method, pattern_re, param_names, func))
        def get(self, path):
            def decorator(func):
                self._register("GET", path, func)
                return func
            return decorator
        def post(self, path):
            def decorator(func):
                self._register("POST", path, func)
                return func
            return decorator
        def resolve(self, event, context):
            import json as _json
            http = event.get("requestContext", {}).get("http", {})
            method = http.get("method", "GET")
            path = event.get("rawPath", "/").split("?")[0]
            # strip stage prefix (e.g. /dev)
            parts = path.split("/")
            if len(parts) > 1 and parts[1] not in ("api",):
                path = "/" + "/".join(parts[2:])
            class _Evt:
                def __init__(self, ev):
                    self.raw_event = ev
                    self.query_string_parameters = ev.get("queryStringParameters") or {}
                    try:
                        self.json_body = _json.loads(ev.get("body", "{}") or "{}")
                    except Exception:
                        self.json_body = {}
            self.current_event = _Evt(event)
            for m, pat, params, func in self._routes:
                if m != method:
                    continue
                match = pat.match(path)
                if match:
                    args = match.groups()
                    kwargs = dict(zip(params, args))
                    result = func(**kwargs)
                    if isinstance(result, dict) or isinstance(result, list):
                        return {"statusCode": 200, "headers": {"Content-Type": "application/json"}, "body": _json.dumps(result, default=str)}
                    if hasattr(result, "status_code"):
                        return {"statusCode": result.status_code, "headers": {"Content-Type": getattr(result, "content_type", "application/json")}, "body": result.body if isinstance(result.body, str) else _json.dumps(result.body, default=str)}
                    return {"statusCode": 200, "headers": {"Content-Type": "application/json"}, "body": _json.dumps(result, default=str)}
            return {"statusCode": 404, "headers": {"Content-Type": "application/json"}, "body": _json.dumps({"detail": f"Not found: {method} {path}"})}

    class Response:
        def __init__(self, status_code=200, body="", content_type="application/json", headers=None):
            self.status_code = status_code
            self.body = body
            self.content_type = content_type

    LambdaContext = object

    class _NoopMetrics:
        def add_metric(self, **kwargs): pass
    metrics = _NoopMetrics()

app = APIGatewayHttpResolver()


# ── Helper functions ─────────────────────────────────────────────

def _mean(data):
    return sum(data) / len(data) if data else 0.0

def _variance(data, ddof=1):
    if len(data) <= ddof:
        return 0.0
    m = _mean(data)
    return sum((x - m) ** 2 for x in data) / (len(data) - ddof)

def _std(data, ddof=1):
    return math.sqrt(_variance(data, ddof))

def _median(data):
    s = sorted(data)
    n = len(s)
    if n == 0:
        return 0.0
    mid = n // 2
    if n % 2 == 0:
        return (s[mid - 1] + s[mid]) / 2
    return s[mid]

def _percentile(data, p):
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

def _skewness(data):
    n = len(data)
    if n < 3:
        return 0.0
    m = _mean(data)
    s = _std(data)
    if s == 0:
        return 0.0
    return (n / ((n - 1) * (n - 2))) * sum(((x - m) / s) ** 3 for x in data)

def _kurtosis(data):
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

def _normal_sf(z):
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

def _approx_p_from_t(t, df):
    if df <= 0:
        return 1.0
    z = t / math.sqrt(1 + t * t / max(df, 1)) if df > 0 else t
    return 2.0 * _normal_sf(abs(z))

def _t_statistic(g1, g2):
    n1, n2 = len(g1), len(g2)
    m1, m2 = _mean(g1), _mean(g2)
    v1, v2 = _variance(g1), _variance(g2)
    if n1 < 2 or n2 < 2:
        return 0.0, 1.0, 0
    se = math.sqrt(v1 / n1 + v2 / n2) if (v1 / n1 + v2 / n2) > 0 else 1e-10
    t_stat = (m1 - m2) / se
    num = (v1 / n1 + v2 / n2) ** 2
    den = ((v1 / n1) ** 2 / (n1 - 1) + (v2 / n2) ** 2 / (n2 - 1)) if ((v1 / n1) ** 2 / max(n1 - 1, 1) + (v2 / n2) ** 2 / max(n2 - 1, 1)) > 0 else 1
    df = int(num / den) if den > 0 else n1 + n2 - 2
    p_value = _approx_p_from_t(abs(t_stat), df)
    return t_stat, p_value, df

def _paired_t(g1, g2):
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

def _f_statistic(groups):
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
    p_value = _approx_f_p(f_stat, df_between, df_within)
    return f_stat, p_value, df_between, df_within

def _approx_f_p(f, df1, df2):
    if f <= 0 or df1 <= 0 or df2 <= 0:
        return 1.0
    z = ((f ** (1/3)) * (1 - 2/(9*df2)) - (1 - 2/(9*df1))) / math.sqrt(2/(9*df1) + (f ** (2/3)) * 2/(9*df2))
    return _normal_sf(z)

def _chi_square(observed):
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
    if df > 0:
        z = ((chi2 / df) ** (1/3) - (1 - 2/(9*df))) / math.sqrt(2/(9*df))
        p_value = _normal_sf(z)
    else:
        p_value = 1.0
    return chi2, p_value, df

def _pearson_corr(x, y):
    n = min(len(x), len(y))
    if n < 2:
        return 0.0
    mx, my = _mean(x[:n]), _mean(y[:n])
    num = sum((x[i] - mx) * (y[i] - my) for i in range(n))
    den_x = sum((x[i] - mx) ** 2 for i in range(n))
    den_y = sum((y[i] - my) ** 2 for i in range(n))
    den = math.sqrt(den_x * den_y)
    return num / den if den > 0 else 0.0

def _spearman_corr(x, y):
    n = min(len(x), len(y))
    if n < 2:
        return 0.0
    def _rank(data):
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

def _linear_regression(X, y):
    n = len(y)
    if n == 0:
        return {"coefficients": [], "intercept": 0, "r_squared": 0}
    p = len(X[0]) if X and X[0] else 0
    X_aug = [[1.0] + row for row in X]
    p_aug = p + 1
    XtX = [[sum(X_aug[k][i] * X_aug[k][j] for k in range(n)) for j in range(p_aug)] for i in range(p_aug)]
    Xty = [sum(X_aug[k][i] * y[k] for k in range(n)) for i in range(p_aug)]
    try:
        coeffs = _solve_linear(XtX, Xty)
    except Exception:
        coeffs = [0.0] * p_aug
    intercept = coeffs[0]
    betas = coeffs[1:]
    y_mean = _mean(y)
    y_pred = [sum(X_aug[i][j] * coeffs[j] for j in range(p_aug)) for i in range(n)]
    ss_res = sum((y[i] - y_pred[i]) ** 2 for i in range(n))
    ss_tot = sum((y[i] - y_mean) ** 2 for i in range(n))
    r_squared = 1 - (ss_res / ss_tot) if ss_tot > 0 else 0.0
    return {"coefficients": [round(b, 6) for b in betas], "intercept": round(intercept, 6), "r_squared": round(r_squared, 6), "predictions": [round(p, 4) for p in y_pred[:20]]}

def _solve_linear(A, b):
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

def _histogram(data, bins=10):
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


# ── Endpoints ────────────────────────────────────────────────────

@app.post("/api/v1/statistics/descriptive")
def descriptive_stats():
    body = app.current_event.json_body
    data = body.get("data", [])
    label = body.get("label", "Variable")
    if not data:
        return Response(status_code=422, content_type="application/json", body=json.dumps({"detail": "Data array cannot be empty"}))
    data = [float(x) for x in data]
    n = len(data)
    return {
        "label": label, "n": n,
        "mean": round(_mean(data), 6), "median": round(_median(data), 6),
        "std": round(_std(data), 6), "variance": round(_variance(data), 6),
        "min": round(min(data), 6), "max": round(max(data), 6),
        "range": round(max(data) - min(data), 6),
        "q1": round(_percentile(data, 25), 6), "q3": round(_percentile(data, 75), 6),
        "iqr": round(_percentile(data, 75) - _percentile(data, 25), 6),
        "skewness": round(_skewness(data), 6), "kurtosis": round(_kurtosis(data), 6),
        "sem": round(_std(data) / math.sqrt(n), 6) if n > 0 else 0,
        "ci_95_lower": round(_mean(data) - 1.96 * _std(data) / math.sqrt(n), 6) if n > 0 else 0,
        "ci_95_upper": round(_mean(data) + 1.96 * _std(data) / math.sqrt(n), 6) if n > 0 else 0,
        "histogram": _histogram(data, bins=10),
        "interpretation": f"The variable '{label}' has {n} observations with a mean of {round(_mean(data), 2)} (SD = {round(_std(data), 2)}). The distribution has skewness = {round(_skewness(data), 2)} and kurtosis = {round(_kurtosis(data), 2)}."
    }


@app.post("/api/v1/statistics/ttest")
def t_test():
    body = app.current_event.json_body
    g1 = [float(x) for x in body.get("group1", [])]
    g2 = [float(x) for x in body.get("group2", [])]
    paired = body.get("paired", False)
    label1 = body.get("label1", "Group 1")
    label2 = body.get("label2", "Group 2")
    if len(g1) < 2 or len(g2) < 2:
        return Response(status_code=422, content_type="application/json", body=json.dumps({"detail": "Each group must have at least 2 observations"}))
    if paired:
        if len(g1) != len(g2):
            return Response(status_code=422, content_type="application/json", body=json.dumps({"detail": "Paired t-test requires equal group sizes"}))
        t_stat, p_value, df = _paired_t(g1, g2)
        test_name = "Paired t-test"
    else:
        t_stat, p_value, df = _t_statistic(g1, g2)
        test_name = "Independent two-sample t-test (Welch's)"
    sig = "statistically significant" if p_value < 0.05 else "not statistically significant"
    m1, m2 = round(_mean(g1), 3), round(_mean(g2), 3)
    return {
        "test": test_name, "t_statistic": round(t_stat, 6), "p_value": round(p_value, 6),
        "degrees_of_freedom": df,
        "group1_stats": {"label": label1, "n": len(g1), "mean": m1, "std": round(_std(g1), 3)},
        "group2_stats": {"label": label2, "n": len(g2), "mean": m2, "std": round(_std(g2), 3)},
        "mean_difference": round(m1 - m2, 6), "significant_at_05": p_value < 0.05, "significant_at_01": p_value < 0.01,
        "effect_size_cohens_d": round((m1 - m2) / math.sqrt((_variance(g1) + _variance(g2)) / 2), 4) if (_variance(g1) + _variance(g2)) > 0 else 0,
        "interpretation": f"The {test_name} shows the difference between {label1} (M={m1}) and {label2} (M={m2}) is {sig} (t({df}) = {round(t_stat, 3)}, p = {round(p_value, 4)})."
    }


@app.post("/api/v1/statistics/anova")
def anova():
    body = app.current_event.json_body
    groups = body.get("groups", [])
    labels = body.get("labels", [])
    if len(groups) < 2:
        return Response(status_code=422, content_type="application/json", body=json.dumps({"detail": "ANOVA requires at least 2 groups"}))
    groups = [[float(x) for x in g] for g in groups]
    for i, g in enumerate(groups):
        if len(g) < 2:
            return Response(status_code=422, content_type="application/json", body=json.dumps({"detail": f"Group {i+1} must have at least 2 observations"}))
    f_stat, p_value, df_between, df_within = _f_statistic(groups)
    labels = labels if labels else [f"Group {i+1}" for i in range(len(groups))]
    sig = "statistically significant" if p_value < 0.05 else "not statistically significant"
    group_stats = [{"label": labels[i] if i < len(labels) else f"Group {i+1}", "n": len(g), "mean": round(_mean(g), 3), "std": round(_std(g), 3)} for i, g in enumerate(groups)]
    return {
        "test": "One-way ANOVA", "f_statistic": round(f_stat, 6), "p_value": round(p_value, 6),
        "df_between": df_between, "df_within": df_within, "group_stats": group_stats,
        "significant_at_05": p_value < 0.05,
        "interpretation": f"The one-way ANOVA result is {sig} (F({df_between},{df_within}) = {round(f_stat, 3)}, p = {round(p_value, 4)})."
    }


@app.post("/api/v1/statistics/chi-square")
def chi_square_test():
    body = app.current_event.json_body
    observed = body.get("observed", [])
    row_labels = body.get("row_labels", [])
    col_labels = body.get("col_labels", [])
    if not observed or not observed[0]:
        return Response(status_code=422, content_type="application/json", body=json.dumps({"detail": "Observed data cannot be empty"}))
    chi2, p_value, df = _chi_square(observed)
    sig = "statistically significant" if p_value < 0.05 else "not statistically significant"
    total = sum(sum(row) for row in observed)
    rows = len(observed)
    cols = len(observed[0])
    min_dim = min(rows, cols) - 1
    cramers_v = math.sqrt(chi2 / (total * min_dim)) if total > 0 and min_dim > 0 else 0
    return {
        "test": "Chi-square test of independence", "chi_square_statistic": round(chi2, 6),
        "p_value": round(p_value, 6), "degrees_of_freedom": df, "cramers_v": round(cramers_v, 4),
        "significant_at_05": p_value < 0.05, "observed": observed,
        "row_labels": row_labels or [f"Row {i+1}" for i in range(rows)],
        "col_labels": col_labels or [f"Col {j+1}" for j in range(cols)],
        "interpretation": f"The chi-square test result is {sig} (chi2({df}) = {round(chi2, 3)}, p = {round(p_value, 4)}, Cramer's V = {round(cramers_v, 3)})."
    }


@app.post("/api/v1/statistics/correlation")
def correlation():
    body = app.current_event.json_body
    variables = body.get("variables", [])
    labels = body.get("labels", [])
    method = body.get("method", "pearson")
    if len(variables) < 2:
        return Response(status_code=422, content_type="application/json", body=json.dumps({"detail": "Need at least 2 variables"}))
    variables = [[float(x) for x in v] for v in variables]
    n_vars = len(variables)
    labels = labels if len(labels) == n_vars else [f"Var {i+1}" for i in range(n_vars)]
    corr_func = _spearman_corr if method == "spearman" else _pearson_corr
    matrix = []
    for i in range(n_vars):
        row = []
        for j in range(n_vars):
            if i == j:
                row.append(1.0)
            else:
                row.append(round(corr_func(variables[i], variables[j]), 6))
        matrix.append(row)
    pairs = []
    for i in range(n_vars):
        for j in range(i + 1, n_vars):
            pairs.append({"var1": labels[i], "var2": labels[j], "r": matrix[i][j], "abs_r": abs(matrix[i][j])})
    pairs.sort(key=lambda p: p["abs_r"], reverse=True)
    return {
        "method": method, "labels": labels, "matrix": matrix, "strongest_pairs": pairs[:5],
        "interpretation": f"Correlation matrix ({method}) computed for {n_vars} variables. " + (f"Strongest correlation: {pairs[0]['var1']} vs {pairs[0]['var2']} (r = {pairs[0]['r']})." if pairs else "")
    }


@app.post("/api/v1/statistics/regression")
def regression():
    body = app.current_event.json_body
    x = body.get("x", [])
    y = body.get("y", [])
    feature_names = body.get("feature_names", [])
    regression_type = body.get("regression_type", "linear")
    if not x or not y:
        return Response(status_code=422, content_type="application/json", body=json.dumps({"detail": "X and y data required"}))
    x = [[float(v) for v in row] for row in x]
    y = [float(v) for v in y]
    if len(x) != len(y):
        return Response(status_code=422, content_type="application/json", body=json.dumps({"detail": "X and y must have same length"}))
    feature_names = feature_names if feature_names else [f"X{i+1}" for i in range(len(x[0]) if x else 0)]
    result = _linear_regression(x, y)
    coeffs_table = [{"feature": feature_names[i] if i < len(feature_names) else f"X{i+1}", "coefficient": result["coefficients"][i]} for i in range(len(result["coefficients"]))]
    if regression_type == "linear":
        return {
            "type": "Linear Regression", "intercept": result["intercept"], "coefficients": coeffs_table,
            "r_squared": result["r_squared"],
            "adjusted_r_squared": round(1 - (1 - result["r_squared"]) * (len(y) - 1) / max(len(y) - len(x[0]) - 1, 1), 6),
            "n_observations": len(y), "n_features": len(x[0]) if x else 0,
            "predictions_sample": result["predictions"],
            "interpretation": f"Linear regression model with R2 = {result['r_squared']}. The model explains {round(result['r_squared'] * 100, 1)}% of the variance in the outcome."
        }
    else:
        return {
            "type": "Logistic Regression (approximation)", "intercept": result["intercept"],
            "coefficients": coeffs_table, "pseudo_r_squared": result["r_squared"],
            "n_observations": len(y),
            "interpretation": "Logistic regression approximation computed. For precise results with odds ratios, use a dedicated statistical package."
        }


@app.post("/api/v1/statistics/survival")
def survival_analysis():
    body = app.current_event.json_body
    times = [float(x) for x in body.get("times", [])]
    events = [int(x) for x in body.get("events", [])]
    groups = body.get("groups")
    group_labels = body.get("group_labels", [])
    if not times or not events:
        return Response(status_code=422, content_type="application/json", body=json.dumps({"detail": "Times and events data required"}))
    if len(times) != len(events):
        return Response(status_code=422, content_type="application/json", body=json.dumps({"detail": "Times and events must have same length"}))

    def _kaplan_meier(t, e):
        combined = sorted(zip(t, e), key=lambda x: x[0])
        n_at_risk = len(combined)
        survival = 1.0
        curve = [{"time": 0, "survival": 1.0, "at_risk": n_at_risk, "events": 0}]
        i = 0
        while i < len(combined):
            ti = combined[i][0]
            d = 0
            c = 0
            while i < len(combined) and combined[i][0] == ti:
                if combined[i][1] == 1:
                    d += 1
                else:
                    c += 1
                i += 1
            if d > 0:
                survival *= (1 - d / n_at_risk)
            curve.append({"time": round(ti, 4), "survival": round(survival, 6), "at_risk": n_at_risk, "events": d})
            n_at_risk -= (d + c)
        return curve

    overall_curve = _kaplan_meier(times, events)
    median_survival = None
    for point in overall_curve:
        if point["survival"] <= 0.5:
            median_survival = point["time"]
            break
    result = {
        "analysis": "Kaplan-Meier Survival Analysis", "n_subjects": len(times),
        "n_events": sum(events), "n_censored": len(events) - sum(events),
        "median_survival": median_survival, "overall_curve": overall_curve,
        "interpretation": f"Kaplan-Meier analysis of {len(times)} subjects with {sum(events)} events. " + (f"Median survival time: {median_survival}." if median_survival else "Median survival not reached.")
    }
    if groups and len(groups) == len(times):
        groups = [int(g) for g in groups]
        unique_groups = sorted(set(groups))
        group_curves = {}
        for g in unique_groups:
            g_times = [times[i] for i in range(len(times)) if groups[i] == g]
            g_events = [events[i] for i in range(len(events)) if groups[i] == g]
            label = group_labels[g] if g < len(group_labels) else f"Group {g}"
            group_curves[label] = _kaplan_meier(g_times, g_events)
        result["group_curves"] = group_curves
    return result


@app.post("/api/v1/statistics/sample-size")
def sample_size_calculator():
    body = app.current_event.json_body
    d = float(body.get("effect_size", 0.5))
    alpha = float(body.get("alpha", 0.05))
    power = float(body.get("power", 0.8))
    test_type = body.get("test_type", "two_sample_t")
    z_alpha = 1.96 if alpha == 0.05 else (2.576 if alpha == 0.01 else 1.645)
    z_beta = 0.842 if abs(power - 0.8) < 0.01 else (1.282 if abs(power - 0.9) < 0.01 else 1.645)
    if test_type == "two_sample_t":
        n_per_group = math.ceil(2 * ((z_alpha + z_beta) / d) ** 2) if d > 0 else 0
        total_n = n_per_group * 2
        desc = f"Two-sample t-test: {n_per_group} per group, {total_n} total"
    elif test_type == "one_sample_t":
        n = math.ceil(((z_alpha + z_beta) / d) ** 2) if d > 0 else 0
        n_per_group = n
        total_n = n
        desc = f"One-sample t-test: {n} subjects needed"
    elif test_type == "chi_square":
        n = math.ceil(((z_alpha + z_beta) / d) ** 2) if d > 0 else 0
        n_per_group = n
        total_n = n
        desc = f"Chi-square test: {n} total subjects needed"
    else:
        n_per_group = 0
        total_n = 0
        desc = "Unknown test type"
    effect_interpretation = "small" if d < 0.3 else ("medium" if d < 0.7 else "large")
    return {
        "test_type": test_type, "effect_size": d, "effect_interpretation": effect_interpretation,
        "alpha": alpha, "power": power, "n_per_group": n_per_group, "total_n": total_n,
        "description": desc,
        "recommendations": [
            f"Based on a {effect_interpretation} effect size (d={d}), alpha={alpha}, power={power}",
            f"Required sample size: {total_n} total participants",
            "Consider adding 10-20% for dropout/attrition",
            f"Recommended total with 15% buffer: {math.ceil(total_n * 1.15)}",
        ]
    }


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """Lambda handler entry point."""
    try:
        return app.resolve(event, context)
    except Exception as e:
        print(f"[STATISTICS] UNHANDLED ERROR: {e}\n{traceback.format_exc()}")
        return {
            "statusCode": 500,
            "headers": {"Content-Type": "application/json"},
            "body": json.dumps({"detail": f"Internal server error: {str(e)}"}),
        }
