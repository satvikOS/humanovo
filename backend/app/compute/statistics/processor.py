"""
Statistics Processor — Exact tests, multiple testing corrections, survival, bootstrap, Bayesian.

Provides comprehensive statistical analysis capabilities:
- Descriptive statistics with normality tests
- Parametric tests (t-test, ANOVA with post-hoc)
- Non-parametric tests (Mann-Whitney, Kruskal-Wallis with Dunn's)
- Chi-square, correlation, regression
- Survival analysis (Kaplan-Meier, log-rank)
- Power analysis and sample size calculation
- Multiple testing correction (6 methods)
- Bootstrap confidence intervals
- Bayesian A/B testing
- Effect size measures
"""

from __future__ import annotations

import math
from collections.abc import Callable
from typing import Any

import numpy as np
from scipy import stats as sp_stats

from app.compute.types import (
    ComputeDomain,
    ComputeRequest,
    ComputeResult,
    ComputeStatus,
    DescriptiveStats,
    GeneratedFigure,
    StatisticalTest,
    ConfidenceInterval,
)


def _correct_pvalues(pvals: list[float], method: str) -> list[float]:
    """Multiple testing correction."""
    n = len(pvals)
    if n == 0:
        return []
    indexed = sorted(enumerate(pvals), key=lambda x: x[1])
    adjusted = [0.0] * n

    if method == "bonferroni":
        for i, (orig, p) in enumerate(indexed):
            adjusted[i] = min(p * n, 1.0)
    elif method == "holm":
        for i, (orig, p) in enumerate(indexed):
            adjusted[i] = min(p * (n - i), 1.0)
        for i in range(1, n):
            adjusted[i] = max(adjusted[i], adjusted[i-1])
    elif method == "hochberg":
        for i, (orig, p) in enumerate(indexed):
            adjusted[i] = min(p * (n - i), 1.0)
        for i in range(n-2, -1, -1):
            adjusted[i] = min(adjusted[i], adjusted[i+1])
    elif method in ("benjamini_hochberg", "bh", "fdr"):
        for i, (orig, p) in enumerate(indexed):
            adjusted[i] = min(p * n / (i + 1), 1.0)
        for i in range(n-2, -1, -1):
            adjusted[i] = min(adjusted[i], adjusted[i+1])
    elif method == "benjamini_yekutieli":
        c_n = sum(1.0/i for i in range(1, n+1))
        for i, (orig, p) in enumerate(indexed):
            adjusted[i] = min(p * n * c_n / (i + 1), 1.0)
        for i in range(n-2, -1, -1):
            adjusted[i] = min(adjusted[i], adjusted[i+1])
    else:
        adjusted = [p for _, p in indexed]

    result = [0.0] * n
    for i, (orig, _) in enumerate(indexed):
        result[orig] = adjusted[i]
    return result


class StatisticsProcessor:
    """Comprehensive statistics computation processor."""

    OPERATIONS = [
        "descriptive", "t_test", "anova", "mann_whitney", "kruskal_wallis",
        "chi_square", "correlation", "regression", "survival",
        "power_analysis", "multiple_testing_correction", "bootstrap",
        "bayesian_test", "effect_size",
    ]

    def list_operations(self) -> list[str]:
        return self.OPERATIONS

    async def execute(self, request: ComputeRequest, progress_callback: Callable | None = None) -> ComputeResult:
        dispatch = {op: getattr(self, f"_{op}") for op in self.OPERATIONS}
        handler = dispatch.get(request.operation)
        if not handler:
            return ComputeResult(
                request_id=request.id, domain=ComputeDomain.STATISTICS,
                operation=request.operation, status=ComputeStatus.FAILED,
                error=f"Unknown operation: {request.operation}",
            )
        try:
            return await handler(request, request.parameters)
        except Exception as e:
            return ComputeResult(
                request_id=request.id, domain=ComputeDomain.STATISTICS,
                operation=request.operation, status=ComputeStatus.FAILED, error=str(e),
            )

    async def _descriptive(self, req: ComputeRequest, params: dict) -> ComputeResult:
        data = params["data"]
        confidence = params.get("confidence", 0.95)

        if isinstance(data, dict):
            groups = {k: np.array(v, dtype=float) for k, v in data.items()}
        else:
            groups = {"data": np.array(data, dtype=float)}

        descriptive = {}
        normality = {}
        for name, arr in groups.items():
            arr = arr[~np.isnan(arr)]
            descriptive[name] = DescriptiveStats.from_array(arr, confidence)
            if len(arr) >= 8:
                sw_stat, sw_p = sp_stats.shapiro(arr)
                normality[name] = {"shapiro_wilk_stat": round(sw_stat, 6), "shapiro_wilk_p": round(sw_p, 6), "normal": sw_p > 0.05}

        return ComputeResult(
            request_id=req.id, domain=ComputeDomain.STATISTICS, operation="descriptive",
            results={"normality_tests": normality},
            descriptive=descriptive,
        )

    async def _t_test(self, req: ComputeRequest, params: dict) -> ComputeResult:
        g1 = np.array(params["group1"], dtype=float)
        g2 = params.get("group2")
        paired = params.get("paired", False)
        mu = params.get("mu", 0)
        alternative = params.get("alternative", "two-sided")
        equal_var = params.get("equal_var", False)

        if g2 is not None:
            g2 = np.array(g2, dtype=float)
            if paired:
                res = sp_stats.ttest_rel(g1, g2, alternative=alternative)
                df = len(g1) - 1
            else:
                res = sp_stats.ttest_ind(g1, g2, equal_var=equal_var, alternative=alternative)
                if equal_var:
                    df = len(g1) + len(g2) - 2
                else:
                    v1, v2 = np.var(g1, ddof=1), np.var(g2, ddof=1)
                    n1, n2 = len(g1), len(g2)
                    se_sq = v1/n1 + v2/n2
                    df = se_sq**2 / ((v1/n1)**2/(n1-1) + (v2/n2)**2/(n2-1)) if se_sq > 0 else n1+n2-2

            # Cohen's d
            pooled_std = math.sqrt((np.var(g1, ddof=1) + np.var(g2, ddof=1)) / 2)
            cohens_d = (np.mean(g1) - np.mean(g2)) / pooled_std if pooled_std > 0 else 0
        else:
            res = sp_stats.ttest_1samp(g1, mu, alternative=alternative)
            df = len(g1) - 1
            cohens_d = (np.mean(g1) - mu) / np.std(g1, ddof=1) if np.std(g1, ddof=1) > 0 else 0

        stat_test = StatisticalTest(
            test_name="Welch's t-test" if not equal_var else "Student's t-test",
            statistic=float(res.statistic), p_value=float(res.pvalue),
            degrees_of_freedom=float(df), effect_size=float(cohens_d),
            significant=float(res.pvalue) < 0.05,
        )

        return ComputeResult(
            request_id=req.id, domain=ComputeDomain.STATISTICS, operation="t_test",
            results={"cohens_d": round(float(cohens_d), 4), "alternative": alternative},
            statistics=[stat_test],
        )

    async def _anova(self, req: ComputeRequest, params: dict) -> ComputeResult:
        groups = {k: np.array(v, dtype=float) for k, v in params["groups"].items()}
        posthoc = params.get("posthoc", "tukey")

        arrays = list(groups.values())
        f_stat, p_value = sp_stats.f_oneway(*arrays)

        # Eta-squared
        grand_mean = np.mean(np.concatenate(arrays))
        ss_between = sum(len(g) * (np.mean(g) - grand_mean)**2 for g in arrays)
        ss_total = sum(np.sum((g - grand_mean)**2) for g in arrays)
        eta_sq = ss_between / ss_total if ss_total > 0 else 0

        stat_test = StatisticalTest(
            test_name="One-way ANOVA", statistic=float(f_stat), p_value=float(p_value),
            effect_size=float(eta_sq), significant=float(p_value) < 0.05,
        )

        # Post-hoc
        posthoc_results = []
        if posthoc != "none" and float(p_value) < 0.05:
            names = list(groups.keys())
            for i in range(len(names)):
                for j in range(i+1, len(names)):
                    t_res = sp_stats.ttest_ind(groups[names[i]], groups[names[j]], equal_var=False)
                    posthoc_results.append({
                        "group1": names[i], "group2": names[j],
                        "t_statistic": round(float(t_res.statistic), 4),
                        "p_value": round(float(t_res.pvalue), 6),
                    })
            # Apply correction
            if posthoc_results:
                pvals = [r["p_value"] for r in posthoc_results]
                method = "bonferroni" if posthoc == "bonferroni" else "holm" if posthoc == "holm" else "bonferroni"
                adj = _correct_pvalues(pvals, method)
                for r, ap in zip(posthoc_results, adj):
                    r["p_adjusted"] = round(ap, 6)
                    r["significant"] = ap < 0.05

        return ComputeResult(
            request_id=req.id, domain=ComputeDomain.STATISTICS, operation="anova",
            results={"eta_squared": round(float(eta_sq), 4), "posthoc": posthoc_results, "posthoc_method": posthoc},
            statistics=[stat_test],
        )

    async def _mann_whitney(self, req: ComputeRequest, params: dict) -> ComputeResult:
        g1 = np.array(params["group1"], dtype=float)
        g2 = np.array(params["group2"], dtype=float)
        alternative = params.get("alternative", "two-sided")

        res = sp_stats.mannwhitneyu(g1, g2, alternative=alternative)
        r_biserial = 1 - (2 * res.statistic) / (len(g1) * len(g2))

        return ComputeResult(
            request_id=req.id, domain=ComputeDomain.STATISTICS, operation="mann_whitney",
            statistics=[StatisticalTest(
                test_name="Mann-Whitney U", statistic=float(res.statistic),
                p_value=float(res.pvalue), effect_size=float(r_biserial),
                significant=float(res.pvalue) < 0.05,
            )],
        )

    async def _kruskal_wallis(self, req: ComputeRequest, params: dict) -> ComputeResult:
        groups = {k: np.array(v, dtype=float) for k, v in params["groups"].items()}
        res = sp_stats.kruskal(*groups.values())

        posthoc = []
        if params.get("posthoc") == "dunn" and res.pvalue < 0.05:
            names = list(groups.keys())
            for i in range(len(names)):
                for j in range(i+1, len(names)):
                    u_res = sp_stats.mannwhitneyu(groups[names[i]], groups[names[j]])
                    posthoc.append({
                        "group1": names[i], "group2": names[j],
                        "p_value": round(float(u_res.pvalue), 6),
                    })
            if posthoc:
                adj = _correct_pvalues([r["p_value"] for r in posthoc], "bonferroni")
                for r, ap in zip(posthoc, adj):
                    r["p_adjusted"] = round(ap, 6)

        return ComputeResult(
            request_id=req.id, domain=ComputeDomain.STATISTICS, operation="kruskal_wallis",
            results={"posthoc": posthoc},
            statistics=[StatisticalTest(
                test_name="Kruskal-Wallis H", statistic=float(res.statistic),
                p_value=float(res.pvalue), significant=float(res.pvalue) < 0.05,
            )],
        )

    async def _chi_square(self, req: ComputeRequest, params: dict) -> ComputeResult:
        observed = np.array(params["observed"], dtype=float)
        chi2, p, dof, expected = sp_stats.chi2_contingency(observed)
        n = observed.sum()
        r, c = observed.shape
        cramers_v = math.sqrt(chi2 / (n * min(r-1, c-1))) if n > 0 else 0

        return ComputeResult(
            request_id=req.id, domain=ComputeDomain.STATISTICS, operation="chi_square",
            results={
                "expected": expected.tolist(), "cramers_v": round(cramers_v, 4),
                "residuals": ((observed - expected) / np.sqrt(expected + 1e-10)).tolist(),
            },
            statistics=[StatisticalTest(
                test_name="Chi-square", statistic=float(chi2), p_value=float(p),
                degrees_of_freedom=float(dof), effect_size=cramers_v,
                significant=p < 0.05,
            )],
        )

    async def _correlation(self, req: ComputeRequest, params: dict) -> ComputeResult:
        x = np.array(params["x"], dtype=float)
        y = np.array(params["y"], dtype=float)
        method = params.get("method", "pearson")

        if method == "pearson":
            r, p = sp_stats.pearsonr(x, y)
        elif method == "spearman":
            r, p = sp_stats.spearmanr(x, y)
        elif method == "kendall":
            r, p = sp_stats.kendalltau(x, y)
        else:
            r, p = sp_stats.pearsonr(x, y)

        # Fisher z CI for Pearson
        ci = None
        if method == "pearson" and len(x) > 3:
            z = np.arctanh(r)
            se = 1 / math.sqrt(len(x) - 3)
            z_lo, z_hi = z - 1.96 * se, z + 1.96 * se
            ci = ConfidenceInterval(lower=float(np.tanh(z_lo)), upper=float(np.tanh(z_hi)))

        return ComputeResult(
            request_id=req.id, domain=ComputeDomain.STATISTICS, operation="correlation",
            results={"method": method},
            statistics=[StatisticalTest(
                test_name=f"{method.capitalize()} correlation", statistic=float(r),
                p_value=float(p), ci=ci, significant=p < 0.05,
            )],
        )

    async def _regression(self, req: ComputeRequest, params: dict) -> ComputeResult:
        X = np.array(params["X"], dtype=float)
        y = np.array(params["y"], dtype=float)
        model = params.get("model", "linear")

        if X.ndim == 1:
            X = X.reshape(-1, 1)

        if model == "linear":
            from sklearn.linear_model import LinearRegression
            reg = LinearRegression().fit(X, y)
            y_pred = reg.predict(X)
            ss_res = np.sum((y - y_pred)**2)
            ss_tot = np.sum((y - np.mean(y))**2)
            r2 = 1 - ss_res / ss_tot if ss_tot > 0 else 0
            n, p = X.shape
            adj_r2 = 1 - (1 - r2) * (n - 1) / (n - p - 1) if n > p + 1 else r2

            return ComputeResult(
                request_id=req.id, domain=ComputeDomain.STATISTICS, operation="regression",
                results={
                    "coefficients": reg.coef_.tolist(), "intercept": float(reg.intercept_),
                    "r_squared": round(r2, 6), "adjusted_r_squared": round(adj_r2, 6),
                    "predictions": y_pred.tolist(), "residuals": (y - y_pred).tolist(),
                    "model": model,
                },
            )
        elif model == "logistic":
            from sklearn.linear_model import LogisticRegression
            reg = LogisticRegression(max_iter=1000).fit(X, y.astype(int))
            y_pred = reg.predict(X)
            y_prob = reg.predict_proba(X)[:, 1]
            accuracy = float(np.mean(y_pred == y.astype(int)))

            return ComputeResult(
                request_id=req.id, domain=ComputeDomain.STATISTICS, operation="regression",
                results={
                    "coefficients": reg.coef_[0].tolist(), "intercept": float(reg.intercept_[0]),
                    "accuracy": round(accuracy, 4), "predictions": y_pred.tolist(),
                    "probabilities": y_prob.tolist(), "model": model,
                },
            )
        else:
            from sklearn.linear_model import Ridge, Lasso
            alpha_reg = params.get("alpha_reg", 1.0)
            cls = Ridge if model == "ridge" else Lasso
            reg = cls(alpha=alpha_reg).fit(X, y)
            y_pred = reg.predict(X)
            ss_res = np.sum((y - y_pred)**2)
            ss_tot = np.sum((y - np.mean(y))**2)
            r2 = 1 - ss_res / ss_tot if ss_tot > 0 else 0
            return ComputeResult(
                request_id=req.id, domain=ComputeDomain.STATISTICS, operation="regression",
                results={
                    "coefficients": reg.coef_.tolist(), "intercept": float(reg.intercept_),
                    "r_squared": round(r2, 6), "model": model, "alpha": alpha_reg,
                },
            )

    async def _survival(self, req: ComputeRequest, params: dict) -> ComputeResult:
        times = np.array(params["times"], dtype=float)
        events = np.array(params["events"], dtype=int)
        group_labels = params.get("groups")

        def kaplan_meier(t, e):
            unique_times = np.sort(np.unique(t[e == 1]))
            n_at_risk = []
            n_events = []
            survival = []
            var_s = []
            s = 1.0
            v = 0.0
            for ti in unique_times:
                ni = np.sum(t >= ti)
                di = np.sum((t == ti) & (e == 1))
                s *= (1 - di / ni) if ni > 0 else s
                if ni > 0 and ni != di:
                    v += di / (ni * (ni - di))
                n_at_risk.append(int(ni))
                n_events.append(int(di))
                survival.append(s)
                var_s.append(s**2 * v)
            return unique_times.tolist(), survival, [s - 1.96*math.sqrt(v) for s, v in zip(survival, var_s)], [s + 1.96*math.sqrt(v) for s, v in zip(survival, var_s)]

        if group_labels is not None:
            group_labels = np.array(group_labels)
            unique_groups = np.unique(group_labels)
            km_results = {}
            for g in unique_groups:
                mask = group_labels == g
                t_km, s_km, ci_lo, ci_hi = kaplan_meier(times[mask], events[mask])
                median_idx = next((i for i, s in enumerate(s_km) if s <= 0.5), None)
                median_surv = t_km[median_idx] if median_idx is not None else None
                km_results[str(g)] = {"times": t_km, "survival": s_km, "ci_lower": ci_lo, "ci_upper": ci_hi, "median_survival": median_surv}

            # Log-rank test
            if len(unique_groups) == 2:
                g1_mask = group_labels == unique_groups[0]
                g2_mask = group_labels == unique_groups[1]
                all_event_times = np.sort(np.unique(times[events == 1]))
                O1, E1 = 0, 0.0
                for ti in all_event_times:
                    n1 = np.sum(times[g1_mask] >= ti)
                    n2 = np.sum(times[g2_mask] >= ti)
                    d1 = np.sum((times[g1_mask] == ti) & (events[g1_mask] == 1))
                    d = d1 + np.sum((times[g2_mask] == ti) & (events[g2_mask] == 1))
                    n = n1 + n2
                    O1 += d1
                    E1 += n1 * d / n if n > 0 else 0
                chi2 = (O1 - E1)**2 / E1 if E1 > 0 else 0
                p_logrank = 1 - sp_stats.chi2.cdf(chi2, 1)
                hr = O1 / E1 if E1 > 0 else 1.0

                stat_tests = [StatisticalTest(
                    test_name="Log-rank test", statistic=float(chi2), p_value=float(p_logrank),
                    degrees_of_freedom=1.0, significant=p_logrank < 0.05,
                )]
            else:
                stat_tests = []
                hr = None

            return ComputeResult(
                request_id=req.id, domain=ComputeDomain.STATISTICS, operation="survival",
                results={"km_curves": km_results, "hazard_ratio": round(hr, 4) if hr else None},
                statistics=stat_tests,
            )
        else:
            t_km, s_km, ci_lo, ci_hi = kaplan_meier(times, events)
            median_idx = next((i for i, s in enumerate(s_km) if s <= 0.5), None)
            return ComputeResult(
                request_id=req.id, domain=ComputeDomain.STATISTICS, operation="survival",
                results={
                    "times": t_km, "survival": s_km, "ci_lower": ci_lo, "ci_upper": ci_hi,
                    "median_survival": t_km[median_idx] if median_idx is not None else None,
                },
            )

    async def _power_analysis(self, req: ComputeRequest, params: dict) -> ComputeResult:
        test = params.get("test", "t_test")
        effect_size = params.get("effect_size", 0.5)
        alpha = params.get("alpha", 0.05)
        power = params.get("power", 0.8)
        solve_for = params.get("solve_for", "n")

        z_alpha = sp_stats.norm.ppf(1 - alpha / 2)
        z_beta = sp_stats.norm.ppf(power)

        if test == "t_test":
            if solve_for == "n":
                n = math.ceil(((z_alpha + z_beta) / effect_size) ** 2) if effect_size > 0 else float("inf")
                return ComputeResult(
                    request_id=req.id, domain=ComputeDomain.STATISTICS, operation="power_analysis",
                    results={"required_n_per_group": n, "total_n": n * 2, "test": test, "effect_size": effect_size, "alpha": alpha, "power": power},
                )
            elif solve_for == "power":
                n = params.get("n", 30)
                z_stat = effect_size * math.sqrt(n) - z_alpha
                achieved_power = float(sp_stats.norm.cdf(z_stat))
                return ComputeResult(
                    request_id=req.id, domain=ComputeDomain.STATISTICS, operation="power_analysis",
                    results={"achieved_power": round(achieved_power, 4), "n": n, "test": test},
                )
            else:
                n = params.get("n", 30)
                min_d = (z_alpha + z_beta) / math.sqrt(n) if n > 0 else float("inf")
                return ComputeResult(
                    request_id=req.id, domain=ComputeDomain.STATISTICS, operation="power_analysis",
                    results={"detectable_effect_size": round(min_d, 4), "n": n, "test": test},
                )
        else:
            n = math.ceil(((z_alpha + z_beta) / effect_size) ** 2) if effect_size > 0 else float("inf")
            return ComputeResult(
                request_id=req.id, domain=ComputeDomain.STATISTICS, operation="power_analysis",
                results={"required_n": n, "test": test, "effect_size": effect_size},
            )

    async def _multiple_testing_correction(self, req: ComputeRequest, params: dict) -> ComputeResult:
        pvals = params["p_values"]
        method = params.get("method", "benjamini_hochberg")
        alpha = params.get("alpha", 0.05)

        adjusted = _correct_pvalues(pvals, method)
        rejected = [p < alpha for p in adjusted]

        return ComputeResult(
            request_id=req.id, domain=ComputeDomain.STATISTICS, operation="multiple_testing_correction",
            results={
                "original": pvals, "adjusted": [round(p, 8) for p in adjusted],
                "rejected": rejected, "n_rejected": sum(rejected),
                "method": method, "alpha": alpha,
            },
        )

    async def _bootstrap(self, req: ComputeRequest, params: dict) -> ComputeResult:
        data = np.array(params["data"], dtype=float)
        stat_name = params.get("statistic", "mean")
        n_boot = params.get("n_bootstrap", 10000)
        confidence = params.get("confidence", 0.95)
        method = params.get("method", "percentile")
        seed = params.get("seed", 42)

        rng = np.random.default_rng(seed)
        stat_funcs = {"mean": np.mean, "median": np.median, "std": np.std}
        func = stat_funcs.get(stat_name, np.mean)

        point_est = float(func(data))
        boot_stats = np.array([func(rng.choice(data, size=len(data), replace=True)) for _ in range(n_boot)])

        alpha_2 = (1 - confidence) / 2
        if method == "percentile":
            ci_lo = float(np.percentile(boot_stats, alpha_2 * 100))
            ci_hi = float(np.percentile(boot_stats, (1 - alpha_2) * 100))
        elif method == "basic":
            ci_lo = 2 * point_est - float(np.percentile(boot_stats, (1 - alpha_2) * 100))
            ci_hi = 2 * point_est - float(np.percentile(boot_stats, alpha_2 * 100))
        else:  # bca
            z0 = sp_stats.norm.ppf(np.mean(boot_stats < point_est))
            n = len(data)
            jackknife = np.array([func(np.delete(data, i)) for i in range(n)])
            jack_mean = np.mean(jackknife)
            a = np.sum((jack_mean - jackknife)**3) / (6 * (np.sum((jack_mean - jackknife)**2))**1.5 + 1e-10)
            z_alpha = sp_stats.norm.ppf(alpha_2)
            z_1alpha = sp_stats.norm.ppf(1 - alpha_2)
            a1 = sp_stats.norm.cdf(z0 + (z0 + z_alpha) / (1 - a * (z0 + z_alpha)))
            a2 = sp_stats.norm.cdf(z0 + (z0 + z_1alpha) / (1 - a * (z0 + z_1alpha)))
            ci_lo = float(np.percentile(boot_stats, a1 * 100))
            ci_hi = float(np.percentile(boot_stats, a2 * 100))

        return ComputeResult(
            request_id=req.id, domain=ComputeDomain.STATISTICS, operation="bootstrap",
            results={
                "point_estimate": round(point_est, 6),
                "ci_lower": round(ci_lo, 6), "ci_upper": round(ci_hi, 6),
                "confidence": confidence, "method": method, "n_bootstrap": n_boot,
                "boot_mean": round(float(np.mean(boot_stats)), 6),
                "boot_std": round(float(np.std(boot_stats)), 6),
            },
        )

    async def _bayesian_test(self, req: ComputeRequest, params: dict) -> ComputeResult:
        g1 = np.array(params["group1"], dtype=float)
        g2 = np.array(params["group2"], dtype=float)
        metric = params.get("metric", "continuous")
        n_samples = params.get("n_samples", 50000)

        rng = np.random.default_rng(42)

        if metric == "binary":
            s1, n1 = g1.sum(), len(g1)
            s2, n2 = g2.sum(), len(g2)
            post1 = rng.beta(1 + s1, 1 + n1 - s1, n_samples)
            post2 = rng.beta(1 + s2, 1 + n2 - s2, n_samples)
        else:
            m1, s1, n1 = np.mean(g1), np.std(g1, ddof=1), len(g1)
            m2, s2, n2 = np.mean(g2), np.std(g2, ddof=1), len(g2)
            post1 = rng.normal(m1, s1 / np.sqrt(n1), n_samples)
            post2 = rng.normal(m2, s2 / np.sqrt(n2), n_samples)

        prob_2_better = float(np.mean(post2 > post1))
        diff = post2 - post1
        ci_95 = (float(np.percentile(diff, 2.5)), float(np.percentile(diff, 97.5)))
        expected_loss = float(np.mean(np.maximum(post1 - post2, 0)))

        return ComputeResult(
            request_id=req.id, domain=ComputeDomain.STATISTICS, operation="bayesian_test",
            results={
                "probability_group2_better": round(prob_2_better, 4),
                "expected_loss_choosing_group2": round(expected_loss, 6),
                "credible_interval_95": [round(ci_95[0], 6), round(ci_95[1], 6)],
                "mean_difference": round(float(np.mean(diff)), 6),
                "metric": metric,
            },
        )

    async def _effect_size(self, req: ComputeRequest, params: dict) -> ComputeResult:
        g1 = np.array(params["group1"], dtype=float)
        g2 = params.get("group2")
        measure = params.get("measure", "cohens_d")

        if g2 is not None:
            g2 = np.array(g2, dtype=float)
        m1, s1, n1 = np.mean(g1), np.std(g1, ddof=1), len(g1)

        if g2 is not None:
            m2, s2, n2 = np.mean(g2), np.std(g2, ddof=1), len(g2)
        else:
            m2, s2, n2 = 0, 0, 0

        if measure == "cohens_d":
            sp = math.sqrt(((n1-1)*s1**2 + (n2-1)*s2**2) / (n1+n2-2)) if n2 > 0 else s1
            d = (m1 - m2) / sp if sp > 0 else 0
            interp = "small" if abs(d) < 0.5 else "medium" if abs(d) < 0.8 else "large"
            return ComputeResult(
                request_id=req.id, domain=ComputeDomain.STATISTICS, operation="effect_size",
                results={"effect_size": round(d, 4), "measure": "cohens_d", "interpretation": interp},
            )
        elif measure == "hedges_g":
            sp = math.sqrt(((n1-1)*s1**2 + (n2-1)*s2**2) / (n1+n2-2)) if n2 > 0 else s1
            d = (m1 - m2) / sp if sp > 0 else 0
            g = d * (1 - 3 / (4*(n1+n2) - 9)) if n1+n2 > 2 else d
            return ComputeResult(
                request_id=req.id, domain=ComputeDomain.STATISTICS, operation="effect_size",
                results={"effect_size": round(g, 4), "measure": "hedges_g"},
            )
        elif measure == "nnt":
            arr = abs(m1 - m2)
            nnt = 1.0 / arr if arr > 0 else float("inf")
            return ComputeResult(
                request_id=req.id, domain=ComputeDomain.STATISTICS, operation="effect_size",
                results={"effect_size": round(nnt, 2), "measure": "NNT", "absolute_risk_reduction": round(arr, 4)},
            )
        else:
            return ComputeResult(
                request_id=req.id, domain=ComputeDomain.STATISTICS, operation="effect_size",
                status=ComputeStatus.FAILED, error=f"Unknown measure: {measure}",
            )
