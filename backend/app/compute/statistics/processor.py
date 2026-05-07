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
        "descriptive", "t_test", "anova", "two_way_anova", "ancova",
        "mann_whitney", "kruskal_wallis", "wilcoxon_signed_rank", "friedman_test",
        "chi_square", "fishers_exact", "correlation", "partial_correlation",
        "regression", "cox_regression", "survival",
        "power_analysis", "multiple_testing_correction", "bootstrap",
        "bayesian_test", "effect_size", "meta_analysis",
        "normality_tests", "equivalence_test",
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

    # ── Two-Way ANOVA ───────────────────────────────────────────────

    async def _two_way_anova(self, req: ComputeRequest, params: dict) -> ComputeResult:
        """Two-way factorial ANOVA with interaction."""
        data = np.array(params["data"], dtype=float)
        factor_a = np.array(params["factor_a"])
        factor_b = np.array(params["factor_b"])

        levels_a = np.unique(factor_a)
        levels_b = np.unique(factor_b)
        grand_mean = np.mean(data)
        n_total = len(data)

        # Cell means and SS computation
        ss_a, ss_b, ss_ab, ss_within = 0.0, 0.0, 0.0, 0.0
        cell_ns = {}
        for a in levels_a:
            mask_a = factor_a == a
            mean_a = np.mean(data[mask_a])
            ss_a += np.sum(mask_a) * (mean_a - grand_mean) ** 2
        for b in levels_b:
            mask_b = factor_b == b
            mean_b = np.mean(data[mask_b])
            ss_b += np.sum(mask_b) * (mean_b - grand_mean) ** 2
        for a in levels_a:
            for b in levels_b:
                cell_mask = (factor_a == a) & (factor_b == b)
                if np.sum(cell_mask) == 0:
                    continue
                cell_data = data[cell_mask]
                cell_mean = np.mean(cell_data)
                mean_a = np.mean(data[factor_a == a])
                mean_b = np.mean(data[factor_b == b])
                ss_ab += len(cell_data) * (cell_mean - mean_a - mean_b + grand_mean) ** 2
                ss_within += np.sum((cell_data - cell_mean) ** 2)
                cell_ns[(str(a), str(b))] = len(cell_data)

        a_k = len(levels_a)
        b_k = len(levels_b)
        df_a = a_k - 1
        df_b = b_k - 1
        df_ab = df_a * df_b
        df_within = n_total - a_k * b_k

        ms_a = ss_a / df_a if df_a > 0 else 0
        ms_b = ss_b / df_b if df_b > 0 else 0
        ms_ab = ss_ab / df_ab if df_ab > 0 else 0
        ms_within = ss_within / df_within if df_within > 0 else 1e-10

        f_a = ms_a / ms_within
        f_b = ms_b / ms_within
        f_ab = ms_ab / ms_within
        p_a = 1 - sp_stats.f.cdf(f_a, df_a, df_within)
        p_b = 1 - sp_stats.f.cdf(f_b, df_b, df_within)
        p_ab = 1 - sp_stats.f.cdf(f_ab, df_ab, df_within)

        ss_total = ss_a + ss_b + ss_ab + ss_within
        eta_sq_a = ss_a / ss_total if ss_total > 0 else 0
        eta_sq_b = ss_b / ss_total if ss_total > 0 else 0
        eta_sq_ab = ss_ab / ss_total if ss_total > 0 else 0

        return ComputeResult(
            request_id=req.id, domain=ComputeDomain.STATISTICS, operation="two_way_anova",
            results={
                "anova_table": {
                    "factor_a": {"SS": round(ss_a, 4), "df": df_a, "MS": round(ms_a, 4), "F": round(f_a, 4), "p": round(p_a, 6), "eta_sq": round(eta_sq_a, 4)},
                    "factor_b": {"SS": round(ss_b, 4), "df": df_b, "MS": round(ms_b, 4), "F": round(f_b, 4), "p": round(p_b, 6), "eta_sq": round(eta_sq_b, 4)},
                    "interaction": {"SS": round(ss_ab, 4), "df": df_ab, "MS": round(ms_ab, 4), "F": round(f_ab, 4), "p": round(p_ab, 6), "eta_sq": round(eta_sq_ab, 4)},
                    "residual": {"SS": round(ss_within, 4), "df": df_within, "MS": round(ms_within, 4)},
                },
            },
            statistics=[
                StatisticalTest(test_name="Factor A", statistic=float(f_a), p_value=float(p_a), degrees_of_freedom=float(df_a), effect_size=float(eta_sq_a), significant=p_a < 0.05),
                StatisticalTest(test_name="Factor B", statistic=float(f_b), p_value=float(p_b), degrees_of_freedom=float(df_b), effect_size=float(eta_sq_b), significant=p_b < 0.05),
                StatisticalTest(test_name="A × B Interaction", statistic=float(f_ab), p_value=float(p_ab), degrees_of_freedom=float(df_ab), effect_size=float(eta_sq_ab), significant=p_ab < 0.05),
            ],
        )

    # ── ANCOVA ──────────────────────────────────────────────────────

    async def _ancova(self, req: ComputeRequest, params: dict) -> ComputeResult:
        """Analysis of Covariance — ANOVA adjusting for continuous covariates."""
        y = np.array(params["y"], dtype=float)
        groups = np.array(params["groups"])
        covariates = np.array(params["covariates"], dtype=float)
        if covariates.ndim == 1:
            covariates = covariates.reshape(-1, 1)

        unique_groups = np.unique(groups)
        n_groups = len(unique_groups)
        n = len(y)

        # Build design matrix: intercept + group dummies + covariates
        X = np.ones((n, 1))  # intercept
        for g in unique_groups[1:]:  # dummy coding, first group = reference
            X = np.column_stack([X, (groups == g).astype(float)])
        X = np.column_stack([X, covariates])

        # OLS fit
        beta = np.linalg.lstsq(X, y, rcond=None)[0]
        y_pred = X @ beta
        residuals = y - y_pred
        ss_res = float(np.sum(residuals ** 2))
        df_res = n - X.shape[1]
        ms_res = ss_res / df_res if df_res > 0 else 1e-10

        # Test group effect: compare full model vs model without group dummies
        X_reduced = np.column_stack([np.ones(n), covariates])
        beta_r = np.linalg.lstsq(X_reduced, y, rcond=None)[0]
        ss_res_r = float(np.sum((y - X_reduced @ beta_r) ** 2))
        ss_group = ss_res_r - ss_res
        df_group = n_groups - 1
        ms_group = ss_group / df_group if df_group > 0 else 0
        f_stat = ms_group / ms_res
        p_value = 1 - sp_stats.f.cdf(f_stat, df_group, df_res)

        # Adjusted group means
        cov_means = covariates.mean(axis=0)
        adjusted_means = {}
        for g in unique_groups:
            mask = groups == g
            x_row = np.concatenate([[1.0], [(g == ug) for ug in unique_groups[1:]], cov_means])
            adjusted_means[str(g)] = float(x_row @ beta)

        eta_sq = ss_group / (ss_group + ss_res) if (ss_group + ss_res) > 0 else 0

        return ComputeResult(
            request_id=req.id, domain=ComputeDomain.STATISTICS, operation="ancova",
            results={
                "adjusted_means": adjusted_means,
                "coefficients": beta.tolist(),
                "partial_eta_squared": round(eta_sq, 4),
            },
            statistics=[StatisticalTest(
                test_name="ANCOVA (group effect)", statistic=float(f_stat), p_value=float(p_value),
                degrees_of_freedom=float(df_group), effect_size=float(eta_sq), significant=p_value < 0.05,
            )],
        )

    # ── Wilcoxon Signed-Rank ────────────────────────────────────────

    async def _wilcoxon_signed_rank(self, req: ComputeRequest, params: dict) -> ComputeResult:
        """Wilcoxon signed-rank test for paired samples."""
        x = np.array(params["x"], dtype=float)
        y = np.array(params["y"], dtype=float)
        alternative = params.get("alternative", "two-sided")

        res = sp_stats.wilcoxon(x, y, alternative=alternative)
        n = len(x)
        # Matched-pairs rank biserial correlation
        d = x - y
        d = d[d != 0]
        r_plus = np.sum(np.arange(1, len(d) + 1)[np.argsort(np.abs(d))][d[np.argsort(np.abs(d))] > 0])
        r_minus = np.sum(np.arange(1, len(d) + 1)[np.argsort(np.abs(d))][d[np.argsort(np.abs(d))] < 0])
        r_effect = (r_plus - r_minus) / (r_plus + r_minus) if (r_plus + r_minus) > 0 else 0

        return ComputeResult(
            request_id=req.id, domain=ComputeDomain.STATISTICS, operation="wilcoxon_signed_rank",
            statistics=[StatisticalTest(
                test_name="Wilcoxon signed-rank", statistic=float(res.statistic), p_value=float(res.pvalue),
                effect_size=float(r_effect), significant=float(res.pvalue) < 0.05,
            )],
        )

    # ── Friedman Test ───────────────────────────────────────────────

    async def _friedman_test(self, req: ComputeRequest, params: dict) -> ComputeResult:
        """Friedman test for repeated measures (non-parametric)."""
        groups = [np.array(g, dtype=float) for g in params["groups"]]
        res = sp_stats.friedmanchisquare(*groups)

        # Kendall's W
        k = len(groups)
        n = len(groups[0])
        w = float(res.statistic) / (n * (k - 1)) if n * (k - 1) > 0 else 0

        # Post-hoc Nemenyi-like pairwise Wilcoxon
        posthoc = []
        if res.pvalue < 0.05 and params.get("posthoc", True):
            names = params.get("group_names", [f"Group_{i}" for i in range(k)])
            pvals = []
            comparisons = []
            for i in range(k):
                for j in range(i + 1, k):
                    w_res = sp_stats.wilcoxon(groups[i], groups[j])
                    comparisons.append({"group1": names[i], "group2": names[j], "p_value": float(w_res.pvalue)})
                    pvals.append(float(w_res.pvalue))
            adj = _correct_pvalues(pvals, "bonferroni")
            for c, ap in zip(comparisons, adj):
                c["p_adjusted"] = round(ap, 6)
                c["significant"] = ap < 0.05
            posthoc = comparisons

        return ComputeResult(
            request_id=req.id, domain=ComputeDomain.STATISTICS, operation="friedman_test",
            results={"kendalls_w": round(w, 4), "posthoc": posthoc},
            statistics=[StatisticalTest(
                test_name="Friedman", statistic=float(res.statistic), p_value=float(res.pvalue),
                degrees_of_freedom=float(k - 1), effect_size=float(w), significant=float(res.pvalue) < 0.05,
            )],
        )

    # ── Fisher's Exact Test ─────────────────────────────────────────

    async def _fishers_exact(self, req: ComputeRequest, params: dict) -> ComputeResult:
        """Fisher's exact test for 2x2 contingency tables."""
        table = np.array(params["table"], dtype=int)
        if table.shape != (2, 2):
            return ComputeResult(
                request_id=req.id, domain=ComputeDomain.STATISTICS, operation="fishers_exact",
                status=ComputeStatus.FAILED, error="Table must be 2x2",
            )

        alternative = params.get("alternative", "two-sided")
        odds_ratio, p_value = sp_stats.fisher_exact(table, alternative=alternative)

        # Confidence interval for odds ratio (Cornfield method approximation)
        a, b, c, d = table[0, 0], table[0, 1], table[1, 0], table[1, 1]
        log_or = math.log(odds_ratio) if odds_ratio > 0 else 0
        se_log_or = math.sqrt(1/(a+0.5) + 1/(b+0.5) + 1/(c+0.5) + 1/(d+0.5))
        ci = ConfidenceInterval(
            lower=math.exp(log_or - 1.96 * se_log_or),
            upper=math.exp(log_or + 1.96 * se_log_or),
        )

        return ComputeResult(
            request_id=req.id, domain=ComputeDomain.STATISTICS, operation="fishers_exact",
            results={"odds_ratio": round(float(odds_ratio), 4)},
            statistics=[StatisticalTest(
                test_name="Fisher's exact", statistic=float(odds_ratio), p_value=float(p_value),
                ci=ci, significant=p_value < 0.05,
            )],
        )

    # ── Partial Correlation ─────────────────────────────────────────

    async def _partial_correlation(self, req: ComputeRequest, params: dict) -> ComputeResult:
        """Partial correlation controlling for covariates."""
        x = np.array(params["x"], dtype=float)
        y = np.array(params["y"], dtype=float)
        covariates = np.array(params["covariates"], dtype=float)
        if covariates.ndim == 1:
            covariates = covariates.reshape(-1, 1)

        # Regress out covariates from x and y
        C = np.column_stack([np.ones(len(x)), covariates])
        beta_x = np.linalg.lstsq(C, x, rcond=None)[0]
        beta_y = np.linalg.lstsq(C, y, rcond=None)[0]
        res_x = x - C @ beta_x
        res_y = y - C @ beta_y

        r, p = sp_stats.pearsonr(res_x, res_y)
        n = len(x)
        k = covariates.shape[1]
        df = n - 2 - k

        return ComputeResult(
            request_id=req.id, domain=ComputeDomain.STATISTICS, operation="partial_correlation",
            results={"n_covariates": k, "df": df},
            statistics=[StatisticalTest(
                test_name="Partial Pearson r", statistic=float(r), p_value=float(p),
                degrees_of_freedom=float(df), significant=p < 0.05,
            )],
        )

    # ── Cox Proportional Hazards Regression ─────────────────────────

    async def _cox_regression(self, req: ComputeRequest, params: dict) -> ComputeResult:
        """Cox proportional hazards regression via Newton-Raphson (Breslow ties)."""
        times = np.array(params["times"], dtype=float)
        events = np.array(params["events"], dtype=int)
        X = np.array(params["covariates"], dtype=float)
        if X.ndim == 1:
            X = X.reshape(-1, 1)

        n, p = X.shape
        # Center covariates for numerical stability
        X_mean = X.mean(axis=0)
        X_c = X - X_mean

        # Sort by time (descending for risk set computation)
        order = np.argsort(-times)
        times_s = times[order]
        events_s = events[order]
        X_s = X_c[order]

        beta = np.zeros(p)
        max_iter = params.get("max_iter", 50)
        tol = 1e-8

        for iteration in range(max_iter):
            # Compute partial likelihood gradient and Hessian (Breslow method)
            exp_xb = np.exp(X_s @ beta)
            grad = np.zeros(p)
            hess = np.zeros((p, p))

            # Reverse cumulative sums for risk sets
            cum_exp = np.cumsum(exp_xb)
            cum_exp_x = np.cumsum((exp_xb[:, None] * X_s), axis=0)
            cum_exp_xx = np.zeros((n, p, p))
            for i in range(n):
                cum_exp_xx[i] = exp_xb[i] * np.outer(X_s[i], X_s[i])
            cum_exp_xx = np.cumsum(cum_exp_xx, axis=0)

            for i in range(n):
                if events_s[i] == 0:
                    continue
                risk_sum = cum_exp[i]
                risk_x = cum_exp_x[i]
                risk_xx = cum_exp_xx[i]

                if risk_sum <= 0:
                    continue

                z = risk_x / risk_sum
                grad += X_s[i] - z
                hess -= risk_xx / risk_sum - np.outer(z, z)

            # Newton step
            try:
                step = np.linalg.solve(hess, grad)
            except np.linalg.LinAlgError:
                step = np.linalg.lstsq(hess, grad, rcond=None)[0]

            beta -= step

            if np.max(np.abs(step)) < tol:
                break

        # Standard errors from inverse observed information
        try:
            var_beta = np.diag(np.linalg.inv(-hess))
            se_beta = np.sqrt(np.maximum(var_beta, 0))
        except np.linalg.LinAlgError:
            se_beta = np.full(p, np.nan)

        z_scores = beta / (se_beta + 1e-15)
        p_values = 2 * (1 - sp_stats.norm.cdf(np.abs(z_scores)))
        hr = np.exp(beta)
        hr_ci_lo = np.exp(beta - 1.96 * se_beta)
        hr_ci_hi = np.exp(beta + 1.96 * se_beta)

        # Concordance index (C-statistic)
        concordant = 0
        discordant = 0
        tied = 0
        for i in range(n):
            if events[i] == 0:
                continue
            risk_i = X[i] @ beta
            for j in range(n):
                if times[j] > times[i]:
                    risk_j = X[j] @ beta
                    if risk_i > risk_j:
                        concordant += 1
                    elif risk_i < risk_j:
                        discordant += 1
                    else:
                        tied += 1
        c_index = (concordant + 0.5 * tied) / (concordant + discordant + tied) if (concordant + discordant + tied) > 0 else 0.5

        covariate_names = params.get("covariate_names", [f"x{i}" for i in range(p)])
        coef_table = []
        for i in range(p):
            coef_table.append({
                "variable": covariate_names[i] if i < len(covariate_names) else f"x{i}",
                "coef": round(float(beta[i]), 6),
                "se": round(float(se_beta[i]), 6),
                "z": round(float(z_scores[i]), 4),
                "p": round(float(p_values[i]), 6),
                "hr": round(float(hr[i]), 4),
                "hr_ci_lower": round(float(hr_ci_lo[i]), 4),
                "hr_ci_upper": round(float(hr_ci_hi[i]), 4),
            })

        return ComputeResult(
            request_id=req.id, domain=ComputeDomain.STATISTICS, operation="cox_regression",
            results={
                "coefficients": coef_table,
                "concordance_index": round(c_index, 4),
                "n_events": int(events.sum()),
                "n_observations": n,
                "converged": iteration < max_iter - 1,
                "iterations": iteration + 1,
            },
        )

    # ── Meta-Analysis ───────────────────────────────────────────────

    async def _meta_analysis(self, req: ComputeRequest, params: dict) -> ComputeResult:
        """Fixed and random effects meta-analysis (inverse-variance method)."""
        effects = np.array(params["effects"], dtype=float)
        se = np.array(params["standard_errors"], dtype=float)
        study_names = params.get("study_names", [f"Study {i+1}" for i in range(len(effects))])
        method = params.get("method", "random")

        n = len(effects)
        w = 1.0 / (se ** 2)

        # Fixed effect
        theta_fixed = np.sum(w * effects) / np.sum(w)
        se_fixed = 1.0 / np.sqrt(np.sum(w))

        # Heterogeneity
        Q = float(np.sum(w * (effects - theta_fixed) ** 2))
        df = n - 1
        I2 = max(0, (Q - df) / Q * 100) if Q > 0 else 0
        p_het = 1 - sp_stats.chi2.cdf(Q, df) if df > 0 else 1.0

        # DerSimonian-Laird tau-squared
        c = np.sum(w) - np.sum(w ** 2) / np.sum(w)
        tau2 = max(0, (Q - df) / c) if c > 0 else 0

        # Random effects
        w_re = 1.0 / (se ** 2 + tau2)
        theta_re = np.sum(w_re * effects) / np.sum(w_re)
        se_re = 1.0 / np.sqrt(np.sum(w_re))

        if method == "fixed":
            theta, se_theta = theta_fixed, se_fixed
        else:
            theta, se_theta = theta_re, se_re

        z = theta / se_theta
        p_value = 2 * (1 - sp_stats.norm.cdf(abs(z)))
        ci = ConfidenceInterval(lower=theta - 1.96 * se_theta, upper=theta + 1.96 * se_theta)

        # Per-study weights and CIs
        study_results = []
        for i in range(n):
            study_ci = ConfidenceInterval(lower=effects[i] - 1.96 * se[i], upper=effects[i] + 1.96 * se[i])
            weight = float(w_re[i] / np.sum(w_re) * 100) if method == "random" else float(w[i] / np.sum(w) * 100)
            study_results.append({
                "study": study_names[i], "effect": round(float(effects[i]), 4),
                "ci_lower": round(float(study_ci.lower), 4), "ci_upper": round(float(study_ci.upper), 4),
                "weight_pct": round(weight, 1),
            })

        # Egger's test for publication bias
        egger_intercept, egger_se, egger_p = None, None, None
        if n >= 3:
            precision = 1.0 / se
            std_eff = effects / se
            slope_res = sp_stats.linregress(precision, std_eff)
            egger_intercept = round(float(slope_res.intercept), 4)
            egger_se = round(float(slope_res.stderr), 4)
            # t-test for intercept
            t_egger = slope_res.intercept / (slope_res.stderr + 1e-15)
            egger_p = round(2 * (1 - sp_stats.t.cdf(abs(t_egger), n - 2)), 6)

        # Forest plot
        figures = []
        try:
            import matplotlib
            matplotlib.use("Agg")
            import matplotlib.pyplot as plt
            fig, ax = plt.subplots(figsize=(10, max(4, n * 0.5 + 2)))
            y_pos = np.arange(n + 1)
            for i in range(n):
                ax.plot([effects[i] - 1.96 * se[i], effects[i] + 1.96 * se[i]], [n - i, n - i], "k-", linewidth=1)
                ax.plot(effects[i], n - i, "D", color="steelblue", markersize=6)
            # Summary diamond
            ax.plot(theta, 0, "D", color="red", markersize=10)
            ax.plot([ci.lower, ci.upper], [0, 0], "r-", linewidth=2)
            ax.axvline(0, color="gray", linestyle="--", linewidth=0.7)
            labels = study_names + [f"Summary ({method})"]
            ax.set_yticks(range(n + 1))
            ax.set_yticklabels(list(reversed(labels)))
            ax.set_xlabel("Effect Size")
            ax.set_title("Forest Plot")
            figures.append(GeneratedFigure.from_matplotlib(fig, "forest_plot"))
            plt.close(fig)
        except ImportError:
            pass

        return ComputeResult(
            request_id=req.id, domain=ComputeDomain.STATISTICS, operation="meta_analysis",
            results={
                "summary_effect": round(float(theta), 6), "summary_se": round(float(se_theta), 6),
                "method": method, "studies": study_results,
                "heterogeneity": {"Q": round(Q, 4), "df": df, "p": round(p_het, 6), "I2": round(I2, 1), "tau2": round(tau2, 6)},
                "eggers_test": {"intercept": egger_intercept, "se": egger_se, "p": egger_p} if egger_intercept is not None else None,
                "fixed_effect": round(float(theta_fixed), 6), "random_effect": round(float(theta_re), 6),
            },
            statistics=[StatisticalTest(
                test_name=f"Meta-analysis ({method})", statistic=float(z), p_value=float(p_value),
                ci=ci, significant=p_value < 0.05,
            )],
            figures=figures,
        )

    # ── Normality Tests ─────────────────────────────────────────────

    async def _normality_tests(self, req: ComputeRequest, params: dict) -> ComputeResult:
        """Comprehensive normality testing suite."""
        data = np.array(params["data"], dtype=float)
        data = data[~np.isnan(data)]
        n = len(data)

        tests = []

        # Shapiro-Wilk
        if 3 <= n <= 5000:
            sw_stat, sw_p = sp_stats.shapiro(data)
            tests.append(StatisticalTest(
                test_name="Shapiro-Wilk", statistic=float(sw_stat), p_value=float(sw_p), significant=sw_p < 0.05,
            ))

        # D'Agostino-Pearson (requires n >= 20)
        if n >= 20:
            k2_stat, k2_p = sp_stats.normaltest(data)
            tests.append(StatisticalTest(
                test_name="D'Agostino-Pearson K²", statistic=float(k2_stat), p_value=float(k2_p), significant=k2_p < 0.05,
            ))

        # Anderson-Darling
        ad_result = sp_stats.anderson(data, dist="norm")
        ad_sig = float(ad_result.statistic) > ad_result.critical_values[2]  # 5% level
        tests.append(StatisticalTest(
            test_name="Anderson-Darling", statistic=float(ad_result.statistic), p_value=0.05 if ad_sig else 0.10,
            significant=ad_sig,
        ))

        # Kolmogorov-Smirnov (against normal)
        ks_stat, ks_p = sp_stats.kstest(data, "norm", args=(np.mean(data), np.std(data, ddof=1)))
        tests.append(StatisticalTest(
            test_name="Kolmogorov-Smirnov", statistic=float(ks_stat), p_value=float(ks_p), significant=ks_p < 0.05,
        ))

        # Jarque-Bera
        jb_stat, jb_p = sp_stats.jarque_bera(data)
        tests.append(StatisticalTest(
            test_name="Jarque-Bera", statistic=float(jb_stat), p_value=float(jb_p), significant=jb_p < 0.05,
        ))

        # Skewness and kurtosis z-tests
        skew_val = float(sp_stats.skew(data))
        kurt_val = float(sp_stats.kurtosis(data))
        se_skew = math.sqrt(6.0 / n) if n > 2 else 1
        se_kurt = math.sqrt(24.0 / n) if n > 3 else 1

        # Q-Q plot
        figures = []
        try:
            import matplotlib
            matplotlib.use("Agg")
            import matplotlib.pyplot as plt
            fig, axes = plt.subplots(1, 2, figsize=(12, 5))
            # Q-Q plot
            sorted_data = np.sort(data)
            theoretical_q = sp_stats.norm.ppf(np.linspace(1/(2*n), 1 - 1/(2*n), n))
            axes[0].scatter(theoretical_q, sorted_data, s=10, alpha=0.6)
            lims = [min(theoretical_q.min(), sorted_data.min()), max(theoretical_q.max(), sorted_data.max())]
            axes[0].plot(lims, lims, "r--", linewidth=1)
            axes[0].set_xlabel("Theoretical Quantiles")
            axes[0].set_ylabel("Sample Quantiles")
            axes[0].set_title("Normal Q-Q Plot")
            # Histogram with normal overlay
            axes[1].hist(data, bins=min(50, n // 5 + 1), density=True, alpha=0.7, edgecolor="black", linewidth=0.5)
            xs = np.linspace(data.min(), data.max(), 200)
            axes[1].plot(xs, sp_stats.norm.pdf(xs, np.mean(data), np.std(data, ddof=1)), "r-", linewidth=2)
            axes[1].set_title("Histogram + Normal Fit")
            fig.tight_layout()
            figures.append(GeneratedFigure.from_matplotlib(fig, "normality_diagnostics"))
            plt.close(fig)
        except ImportError:
            pass

        return ComputeResult(
            request_id=req.id, domain=ComputeDomain.STATISTICS, operation="normality_tests",
            results={
                "n": n, "skewness": round(skew_val, 4), "kurtosis": round(kurt_val, 4),
                "skewness_z": round(skew_val / se_skew, 4), "kurtosis_z": round(kurt_val / se_kurt, 4),
                "conclusion": "Data appear normally distributed" if all(not t.significant for t in tests) else "Evidence against normality",
            },
            statistics=tests,
            figures=figures,
        )

    # ── Equivalence Test (TOST) ─────────────────────────────────────

    async def _equivalence_test(self, req: ComputeRequest, params: dict) -> ComputeResult:
        """Two One-Sided Tests (TOST) for equivalence."""
        g1 = np.array(params["group1"], dtype=float)
        g2 = np.array(params["group2"], dtype=float)
        margin = params["equivalence_margin"]
        alpha = params.get("alpha", 0.05)

        diff = np.mean(g1) - np.mean(g2)
        se = math.sqrt(np.var(g1, ddof=1) / len(g1) + np.var(g2, ddof=1) / len(g2))
        v1, v2 = np.var(g1, ddof=1), np.var(g2, ddof=1)
        n1, n2 = len(g1), len(g2)
        df = (v1/n1 + v2/n2) ** 2 / ((v1/n1)**2/(n1-1) + (v2/n2)**2/(n2-1)) if (v1/n1 + v2/n2) > 0 else n1 + n2 - 2

        # Upper test: H0: diff >= margin
        t_upper = (diff - margin) / se
        p_upper = sp_stats.t.cdf(t_upper, df)

        # Lower test: H0: diff <= -margin
        t_lower = (diff + margin) / se
        p_lower = 1 - sp_stats.t.cdf(t_lower, df)

        p_tost = max(p_upper, p_lower)
        equivalent = p_tost < alpha

        ci = sp_stats.t.interval(1 - 2 * alpha, df, loc=diff, scale=se)

        return ComputeResult(
            request_id=req.id, domain=ComputeDomain.STATISTICS, operation="equivalence_test",
            results={
                "mean_difference": round(float(diff), 6), "se": round(float(se), 6),
                "equivalence_margin": margin, "equivalent": equivalent,
                "ci_lower": round(float(ci[0]), 6), "ci_upper": round(float(ci[1]), 6),
            },
            statistics=[
                StatisticalTest(test_name="TOST upper", statistic=float(t_upper), p_value=float(p_upper), significant=p_upper < alpha),
                StatisticalTest(test_name="TOST lower", statistic=float(t_lower), p_value=float(p_lower), significant=p_lower < alpha),
                StatisticalTest(test_name="TOST (combined)", statistic=float(diff), p_value=float(p_tost), significant=equivalent),
            ],
        )
