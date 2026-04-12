"""
Clinical / Psychiatry Processor — Research-grade clinical analysis capabilities.

Provides:
- Linear mixed-effects models (REML estimation, fitlme equivalent)
- Clinical rating scale scoring (HAM-D, PANSS, PHQ-9, GAD-7, MADRS, YMRS, CGI)
- Heart rate variability biomarkers (time-domain, frequency-domain, nonlinear)
- Classification with cross-validation and ROC/AUC
- Exploratory factor analysis with rotation
- Repeated measures ANOVA with sphericity corrections
- Intraclass correlation coefficient (ICC)
- Bland-Altman agreement analysis
- Clinical trial power analysis
"""

from __future__ import annotations

import math
from collections.abc import Callable
from typing import Any

import numpy as np
from scipy import stats as sp_stats, optimize, signal, linalg

from app.compute.types import (
    ComputeDomain, ComputeRequest, ComputeResult, ComputeStatus,
    DescriptiveStats, GeneratedFigure, FigureFormat, StatisticalTest, ConfidenceInterval,
)


class ClinicalProcessor:
    """Clinical and psychiatry computation processor."""

    OPERATIONS = [
        "mixed_effects_model", "clinical_scales", "hrv_analysis",
        "classification", "factor_analysis", "repeated_measures_anova",
        "icc", "bland_altman", "power_analysis_clinical",
    ]

    def list_operations(self) -> list[str]:
        return self.OPERATIONS

    async def execute(self, request: ComputeRequest, progress_callback: Callable | None = None) -> ComputeResult:
        dispatch = {op: getattr(self, f"_{op}") for op in self.OPERATIONS}
        handler = dispatch.get(request.operation)
        if not handler:
            return ComputeResult(
                request_id=request.id, domain=ComputeDomain.CLINICAL,
                operation=request.operation, status=ComputeStatus.FAILED,
                error=f"Unknown operation: {request.operation}",
            )
        try:
            return await handler(request, request.parameters)
        except Exception as e:
            return ComputeResult(
                request_id=request.id, domain=ComputeDomain.CLINICAL,
                operation=request.operation, status=ComputeStatus.FAILED, error=str(e),
            )

    # ── Mixed Effects Model ────────────────────────────────────────

    async def _mixed_effects_model(self, req: ComputeRequest, params: dict) -> ComputeResult:
        """Linear mixed-effects model via REML (fitlme equivalent).
        
        Parameters:
            y: dependent variable (n,)
            X: fixed effects design matrix (n, p)
            Z: random effects design matrix (n, q)
            groups: grouping variable (n,)
            fixed_names: names of fixed effects
            random_type: "intercept", "slope", "intercept+slope"
        """
        y = np.array(params["y"], dtype=float)
        X = np.array(params["X"], dtype=float)
        if X.ndim == 1:
            X = X.reshape(-1, 1)
        groups = np.array(params["groups"])
        fixed_names = params.get("fixed_names", [f"beta_{i}" for i in range(X.shape[1])])
        random_type = params.get("random_type", "intercept")

        n = len(y)
        p = X.shape[1]
        unique_groups = np.unique(groups)
        n_groups = len(unique_groups)

        # Build Z matrix based on random_type
        if "Z" in params:
            Z = np.array(params["Z"], dtype=float)
        else:
            if random_type == "intercept":
                # Random intercept per group
                Z = np.zeros((n, n_groups))
                for i, g in enumerate(unique_groups):
                    Z[groups == g, i] = 1.0
            elif random_type == "slope" and X.shape[1] >= 2:
                Z = np.zeros((n, n_groups))
                for i, g in enumerate(unique_groups):
                    Z[groups == g, i] = X[groups == g, 1]
            else:
                # Random intercept + slope
                Z = np.zeros((n, 2 * n_groups))
                for i, g in enumerate(unique_groups):
                    mask = groups == g
                    Z[mask, 2*i] = 1.0
                    if X.shape[1] >= 2:
                        Z[mask, 2*i+1] = X[mask, 1]

        q = Z.shape[1]

        # REML estimation via profile likelihood
        # Variance components: sigma2_e (residual), sigma2_u (random effect)
        def neg_reml_loglik(log_theta):
            sigma2_u = np.exp(log_theta[0])
            sigma2_e = np.exp(log_theta[1]) if len(log_theta) > 1 else 1.0

            V = sigma2_e * np.eye(n) + sigma2_u * Z @ Z.T
            try:
                L = np.linalg.cholesky(V)
            except np.linalg.LinAlgError:
                return 1e10

            # Solve V^-1 y and V^-1 X
            alpha = np.linalg.solve(V, y)
            VinvX = np.linalg.solve(V, X)

            # GLS estimate of fixed effects
            XtVinvX = X.T @ VinvX
            try:
                beta = np.linalg.solve(XtVinvX, VinvX.T @ y)
            except np.linalg.LinAlgError:
                return 1e10

            resid = y - X @ beta
            quad = resid @ np.linalg.solve(V, resid)

            # REML log-likelihood
            sign, logdet_V = np.linalg.slogdet(V)
            sign2, logdet_XtVinvX = np.linalg.slogdet(XtVinvX)
            reml_ll = -0.5 * ((n - p) * np.log(2 * np.pi) + logdet_V + logdet_XtVinvX + quad)
            return -reml_ll

        # Optimize
        result = optimize.minimize(neg_reml_loglik, [0.0, 0.0], method="Nelder-Mead",
                                   options={"maxiter": 1000, "xatol": 1e-8})
        sigma2_u = np.exp(result.x[0])
        sigma2_e = np.exp(result.x[1]) if len(result.x) > 1 else 1.0

        # Final estimates
        V = sigma2_e * np.eye(n) + sigma2_u * Z @ Z.T
        VinvX = np.linalg.solve(V, X)
        XtVinvX = X.T @ VinvX
        beta = np.linalg.solve(XtVinvX, VinvX.T @ y)
        
        # Standard errors
        try:
            var_beta = np.linalg.inv(XtVinvX)
            se_beta = np.sqrt(np.maximum(np.diag(var_beta), 0))
        except np.linalg.LinAlgError:
            se_beta = np.full(p, np.nan)

        # Satterthwaite df approximation (simplified)
        df_sat = np.full(p, float(n - p))
        for j in range(p):
            # Approximate effective df
            df_sat[j] = max(1, n_groups - 1) if j > 0 else max(1, n - p)

        t_values = beta / (se_beta + 1e-15)
        p_values = 2 * (1 - sp_stats.t.cdf(np.abs(t_values), df_sat))

        # ICC
        icc_val = sigma2_u / (sigma2_u + sigma2_e) if (sigma2_u + sigma2_e) > 0 else 0

        # R-squared (marginal and conditional)
        y_pred_fixed = X @ beta
        ss_total = np.sum((y - np.mean(y)) ** 2)
        ss_res_fixed = np.sum((y - y_pred_fixed) ** 2)
        r2_marginal = 1 - ss_res_fixed / ss_total if ss_total > 0 else 0

        # Conditional R² (includes random effects)
        u_hat = sigma2_u * Z.T @ np.linalg.solve(V, y - X @ beta)
        y_pred_full = X @ beta + Z @ u_hat
        ss_res_full = np.sum((y - y_pred_full) ** 2)
        r2_conditional = 1 - ss_res_full / ss_total if ss_total > 0 else 0

        # AIC/BIC
        n_params = p + 2  # fixed + variance components
        reml_ll = -result.fun
        aic = -2 * reml_ll + 2 * n_params
        bic = -2 * reml_ll + n_params * np.log(n)

        coef_table = []
        for j in range(p):
            coef_table.append({
                "name": fixed_names[j] if j < len(fixed_names) else f"beta_{j}",
                "estimate": round(float(beta[j]), 6),
                "se": round(float(se_beta[j]), 6),
                "df": round(float(df_sat[j]), 1),
                "t": round(float(t_values[j]), 4),
                "p": round(float(p_values[j]), 6),
            })

        return ComputeResult(
            request_id=req.id, domain=ComputeDomain.CLINICAL, operation="mixed_effects_model",
            results={
                "fixed_effects": coef_table,
                "random_effects": {
                    "sigma2_random": round(float(sigma2_u), 6),
                    "sigma2_residual": round(float(sigma2_e), 6),
                    "icc": round(float(icc_val), 4),
                },
                "r2_marginal": round(float(r2_marginal), 4),
                "r2_conditional": round(float(r2_conditional), 4),
                "aic": round(float(aic), 2),
                "bic": round(float(bic), 2),
                "reml_loglik": round(float(reml_ll), 2),
                "n_observations": n,
                "n_groups": n_groups,
            },
        )


    # ── Clinical Rating Scales ─────────────────────────────────────

    async def _clinical_scales(self, req: ComputeRequest, params: dict) -> ComputeResult:
        """Validated clinical rating scale scoring with subscales and severity."""
        scale = params["scale"].upper()
        items = params["items"]  # list of item scores

        if scale in ("HAMD", "HAM-D", "HDRS"):
            items = np.array(items[:17], dtype=float)
            total = float(np.sum(items))
            # Subscales
            core = float(np.sum(items[[0, 1, 2, 6]]))  # depressed mood, guilt, suicide, work
            sleep = float(np.sum(items[[3, 4, 5]]))  # insomnia early/mid/late
            anxiety = float(np.sum(items[[9, 10]]))  # anxiety psychic/somatic
            somatic = float(np.sum(items[[11, 12, 13]]))  # somatic GI/general, genital
            if total <= 7: severity = "Normal"
            elif total <= 13: severity = "Mild depression"
            elif total <= 18: severity = "Moderate depression"
            elif total <= 22: severity = "Severe depression"
            else: severity = "Very severe depression"
            
            result = {
                "scale": "HAM-D-17", "total": total, "severity": severity,
                "subscales": {"core": core, "sleep": sleep, "anxiety": anxiety, "somatic": somatic},
                "response": None, "remission": total <= 7,
            }
            if "baseline_total" in params:
                pct_change = (params["baseline_total"] - total) / params["baseline_total"] * 100
                result["response"] = pct_change >= 50
                result["pct_change"] = round(pct_change, 1)

        elif scale in ("PANSS",):
            items = np.array(items[:30], dtype=float)
            positive = float(np.sum(items[:7]))  # P1-P7
            negative = float(np.sum(items[7:14]))  # N1-N7
            general = float(np.sum(items[14:30]))  # G1-G16
            total = positive + negative + general
            # Marder (1997) 5-factor model — canonical indices
            # P1-P7 = 0-6, N1-N7 = 7-13, G1-G16 = 14-29
            marder = {
                # Positive: P1,P3,P5,P6,G9
                "positive": float(np.sum(items[[0, 2, 4, 5, 22]])),
                # Negative: N1,N2,N3,N4,N6,G7,G16
                "negative": float(np.sum(items[[7, 8, 9, 10, 12, 20, 29]])),
                # Disorganized: P2,N5,N7,G5,G10,G11,G13,G15
                "disorganized": float(np.sum(items[[1, 11, 13, 18, 23, 24, 26, 28]])),
                # Excited/hostility: P4,P7,G4,G8,G14
                "excited": float(np.sum(items[[3, 6, 17, 21, 27]])),
                # Anxiety/depression: G1,G2,G3,G6
                "depressed": float(np.sum(items[[14, 15, 16, 19]])),
            }
            # Andreasen et al. (2005) 8-item remission: P1,P2,P3,N1,N4,N6,G5,G9 all <= 3
            panss8_items = [items[i] for i in [0, 1, 2, 7, 10, 12, 18, 22]]
            remission = all(item <= 3 for item in panss8_items)
            
            result = {
                "scale": "PANSS", "total": total, "positive": positive, "negative": negative, "general": general,
                "marder_factors": marder, "remission_andreasen": remission,
            }

        elif scale in ("PHQ9", "PHQ-9"):
            items = np.array(items[:9], dtype=float)
            total = float(np.sum(items))
            if total <= 4: severity = "Minimal"
            elif total <= 9: severity = "Mild"
            elif total <= 14: severity = "Moderate"
            elif total <= 19: severity = "Moderately severe"
            else: severity = "Severe"
            
            result = {
                "scale": "PHQ-9", "total": total, "severity": severity,
                "provisional_mdd": total >= 10,
                "suicidality_flag": items[8] > 0 if len(items) > 8 else False,
                "functional_items": int(np.sum(items >= 2)),
            }

        elif scale in ("GAD7", "GAD-7"):
            items = np.array(items[:7], dtype=float)
            total = float(np.sum(items))
            if total <= 4: severity = "Minimal"
            elif total <= 9: severity = "Mild"
            elif total <= 14: severity = "Moderate"
            else: severity = "Severe"
            result = {"scale": "GAD-7", "total": total, "severity": severity, "clinical_threshold": total >= 10}

        elif scale in ("MADRS",):
            items = np.array(items[:10], dtype=float)
            total = float(np.sum(items))
            if total <= 6: severity = "Normal"
            elif total <= 19: severity = "Mild"
            elif total <= 34: severity = "Moderate"
            else: severity = "Severe"
            result = {
                "scale": "MADRS", "total": total, "severity": severity,
                "remission": total <= 10,
            }
            if "baseline_total" in params:
                pct = (params["baseline_total"] - total) / params["baseline_total"] * 100
                result["response"] = pct >= 50

        elif scale in ("YMRS",):
            items = np.array(items[:11], dtype=float)
            total = float(np.sum(items))
            if total <= 12: severity = "Remission"
            elif total <= 25: severity = "Minimal symptoms"
            elif total <= 37: severity = "Mild mania"
            else: severity = "Moderate-severe mania"
            result = {"scale": "YMRS", "total": total, "severity": severity}

        elif scale in ("CGI", "CGI-S", "CGI-I"):
            cgi_s = params.get("cgi_s", items[0] if len(items) > 0 else None)
            cgi_i = params.get("cgi_i", items[1] if len(items) > 1 else None)
            severity_map = {1: "Normal", 2: "Borderline", 3: "Mildly ill", 4: "Moderately ill", 5: "Markedly ill", 6: "Severely ill", 7: "Extremely ill"}
            improvement_map = {1: "Very much improved", 2: "Much improved", 3: "Minimally improved", 4: "No change", 5: "Minimally worse", 6: "Much worse", 7: "Very much worse"}
            result = {
                "scale": "CGI",
                "cgi_s": {"score": cgi_s, "label": severity_map.get(int(cgi_s), "Unknown")} if cgi_s else None,
                "cgi_i": {"score": cgi_i, "label": improvement_map.get(int(cgi_i), "Unknown")} if cgi_i else None,
                "responder": int(cgi_i) <= 2 if cgi_i else None,
            }
        else:
            return ComputeResult(
                request_id=req.id, domain=ComputeDomain.CLINICAL, operation="clinical_scales",
                status=ComputeStatus.FAILED, error=f"Unknown scale: {scale}. Supported: HAM-D, PANSS, PHQ-9, GAD-7, MADRS, YMRS, CGI",
            )

        return ComputeResult(
            request_id=req.id, domain=ComputeDomain.CLINICAL, operation="clinical_scales",
            results=result,
        )

    # ── HRV Analysis ───────────────────────────────────────────────

    async def _hrv_analysis(self, req: ComputeRequest, params: dict) -> ComputeResult:
        """Complete Heart Rate Variability analysis pipeline."""
        rr_intervals = np.array(params["rr_intervals"], dtype=float)  # in ms
        fs_resample = params.get("resample_rate", 4.0)  # Hz for freq-domain

        # Artifact correction: Malik method (>20% deviation from local median)
        window = params.get("artifact_window", 5)
        corrected = rr_intervals.copy()
        for i in range(len(corrected)):
            start = max(0, i - window)
            end = min(len(corrected), i + window + 1)
            local_median = np.median(corrected[start:end])
            if abs(corrected[i] - local_median) / (local_median + 1e-10) > 0.20:
                corrected[i] = local_median

        nn = corrected  # NN intervals after correction
        n = len(nn)

        # ── Time-Domain ──
        mean_nn = float(np.mean(nn))
        sdnn = float(np.std(nn, ddof=1))
        rmssd = float(np.sqrt(np.mean(np.diff(nn) ** 2)))
        nn_diff = np.abs(np.diff(nn))
        pnn50 = float(np.sum(nn_diff > 50) / len(nn_diff) * 100) if len(nn_diff) > 0 else 0
        pnn20 = float(np.sum(nn_diff > 20) / len(nn_diff) * 100) if len(nn_diff) > 0 else 0
        sdsd = float(np.std(np.diff(nn), ddof=1))
        nn50 = int(np.sum(nn_diff > 50))

        # Triangular index: total NN / max histogram bin
        hist_counts, _ = np.histogram(nn, bins=int(max(nn) - min(nn)) // 8 + 1)
        tri_index = float(n / (np.max(hist_counts) + 1)) if np.max(hist_counts) > 0 else 0

        # SDANN (5-min segments)
        segment_ms = 5 * 60 * 1000  # 5 minutes in ms
        cum_time = np.cumsum(nn)
        segment_means = []
        seg_start = 0
        for i in range(len(cum_time)):
            if cum_time[i] - cum_time[seg_start] >= segment_ms:
                segment_means.append(np.mean(nn[seg_start:i]))
                seg_start = i
        if seg_start < len(nn):
            segment_means.append(np.mean(nn[seg_start:]))
        sdann = float(np.std(segment_means, ddof=1)) if len(segment_means) > 1 else 0

        time_domain = {
            "mean_nn_ms": round(mean_nn, 2), "sdnn_ms": round(sdnn, 2), "sdann_ms": round(sdann, 2),
            "rmssd_ms": round(rmssd, 2), "sdsd_ms": round(sdsd, 2),
            "nn50": nn50, "pnn50_pct": round(pnn50, 2), "pnn20_pct": round(pnn20, 2),
            "triangular_index": round(tri_index, 2),
            "mean_hr_bpm": round(60000.0 / mean_nn, 1) if mean_nn > 0 else 0,
        }

        # ── Frequency-Domain (Welch PSD on resampled tachogram) ──
        cum_time_s = np.cumsum(nn) / 1000.0
        t_interp = np.arange(cum_time_s[0], cum_time_s[-1], 1.0 / fs_resample)
        nn_interp = np.interp(t_interp, cum_time_s, nn)
        nn_interp -= np.mean(nn_interp)  # Remove mean

        nperseg = min(len(nn_interp), int(5 * 60 * fs_resample))  # 5-min window
        freqs, psd = signal.welch(nn_interp, fs=fs_resample, nperseg=nperseg, noverlap=nperseg//2)

        vlf_mask = (freqs >= 0.003) & (freqs < 0.04)
        lf_mask = (freqs >= 0.04) & (freqs < 0.15)
        hf_mask = (freqs >= 0.15) & (freqs < 0.4)

        vlf_power = float(np.trapz(psd[vlf_mask], freqs[vlf_mask])) if vlf_mask.any() else 0
        lf_power = float(np.trapz(psd[lf_mask], freqs[lf_mask])) if lf_mask.any() else 0
        hf_power = float(np.trapz(psd[hf_mask], freqs[hf_mask])) if hf_mask.any() else 0
        total_power = vlf_power + lf_power + hf_power
        lf_hf_ratio = lf_power / (hf_power + 1e-10)
        lfnu = lf_power / (lf_power + hf_power + 1e-10) * 100
        hfnu = hf_power / (lf_power + hf_power + 1e-10) * 100

        freq_domain = {
            "vlf_ms2": round(vlf_power, 2), "lf_ms2": round(lf_power, 2), "hf_ms2": round(hf_power, 2),
            "total_power_ms2": round(total_power, 2), "lf_hf_ratio": round(lf_hf_ratio, 4),
            "lf_nu": round(lfnu, 1), "hf_nu": round(hfnu, 1),
        }

        # ── Nonlinear ──
        # Poincare plot: SD1, SD2
        x = nn[:-1]
        y = nn[1:]
        sd1 = float(np.std(y - x, ddof=1) / np.sqrt(2))
        sd2 = float(np.std(y + x, ddof=1) / np.sqrt(2))

        # Sample Entropy
        def sample_entropy(data, m=2, r_factor=0.2):
            r = r_factor * np.std(data)
            N = len(data)
            def count_matches(template_len):
                count = 0
                templates = np.array([data[i:i+template_len] for i in range(N - template_len)])
                for i in range(len(templates)):
                    dist = np.max(np.abs(templates[i] - templates), axis=1)
                    count += np.sum(dist < r) - 1  # exclude self-match
                return count
            A = count_matches(m + 1)
            B = count_matches(m)
            return -np.log(A / (B + 1e-10) + 1e-10) if B > 0 else 0

        sampen = sample_entropy(nn[:min(len(nn), 1000)])

        # DFA - Detrended Fluctuation Analysis
        def dfa(data, scales):
            N = len(data)
            y_cum = np.cumsum(data - np.mean(data))
            fluctuations = []
            valid_scales = []
            for s in scales:
                if s >= N:
                    continue
                n_segments = N // s
                if n_segments < 1:
                    continue
                rms_vals = []
                for i in range(n_segments):
                    segment = y_cum[i*s:(i+1)*s]
                    x_idx = np.arange(s)
                    coeffs = np.polyfit(x_idx, segment, 1)
                    trend = np.polyval(coeffs, x_idx)
                    rms_vals.append(np.sqrt(np.mean((segment - trend) ** 2)))
                if rms_vals:
                    fluctuations.append(np.mean(rms_vals))
                    valid_scales.append(s)
            return np.array(valid_scales), np.array(fluctuations)

        scales_short = np.arange(4, 17)
        scales_long = np.arange(16, 65)
        s_s, f_s = dfa(nn[:min(len(nn), 2000)], scales_short)
        s_l, f_l = dfa(nn[:min(len(nn), 2000)], scales_long)

        alpha1 = 0.0
        if len(s_s) >= 2 and len(f_s) >= 2:
            log_s = np.log(s_s[f_s > 0])
            log_f = np.log(f_s[f_s > 0])
            if len(log_s) >= 2:
                alpha1 = float(np.polyfit(log_s, log_f, 1)[0])

        alpha2 = 0.0
        if len(s_l) >= 2 and len(f_l) >= 2:
            log_s = np.log(s_l[f_l > 0])
            log_f = np.log(f_l[f_l > 0])
            if len(log_s) >= 2:
                alpha2 = float(np.polyfit(log_s, log_f, 1)[0])

        nonlinear = {
            "sd1_ms": round(sd1, 2), "sd2_ms": round(sd2, 2),
            "sd1_sd2_ratio": round(sd1 / (sd2 + 1e-10), 4),
            "ellipse_area": round(math.pi * sd1 * sd2, 2),
            "sample_entropy": round(float(sampen), 4),
            "dfa_alpha1": round(alpha1, 4), "dfa_alpha2": round(alpha2, 4),
        }

        # Figures
        figures = []
        try:
            import matplotlib
            matplotlib.use("Agg")
            import matplotlib.pyplot as plt
            fig, axes = plt.subplots(2, 2, figsize=(14, 10))
            # Tachogram
            axes[0, 0].plot(np.arange(len(nn)), nn, linewidth=0.5, color="steelblue")
            axes[0, 0].set_xlabel("Beat number")
            axes[0, 0].set_ylabel("NN interval (ms)")
            axes[0, 0].set_title("NN Interval Tachogram")
            # PSD
            axes[0, 1].semilogy(freqs, psd, "k-", linewidth=0.8)
            if vlf_mask.any(): axes[0, 1].fill_between(freqs[vlf_mask], psd[vlf_mask], alpha=0.3, label="VLF")
            if lf_mask.any(): axes[0, 1].fill_between(freqs[lf_mask], psd[lf_mask], alpha=0.3, color="red", label="LF")
            if hf_mask.any(): axes[0, 1].fill_between(freqs[hf_mask], psd[hf_mask], alpha=0.3, color="green", label="HF")
            axes[0, 1].set_xlabel("Frequency (Hz)")
            axes[0, 1].set_ylabel("PSD (ms²/Hz)")
            axes[0, 1].set_title(f"PSD (LF/HF = {lf_hf_ratio:.2f})")
            axes[0, 1].legend(fontsize=8)
            axes[0, 1].set_xlim(0, 0.5)
            # Poincare plot
            axes[1, 0].scatter(x, y, s=3, alpha=0.3, color="steelblue")
            axes[1, 0].set_xlabel("NN_n (ms)")
            axes[1, 0].set_ylabel("NN_n+1 (ms)")
            axes[1, 0].set_title(f"Poincaré Plot (SD1={sd1:.1f}, SD2={sd2:.1f})")
            axes[1, 0].set_aspect("equal")
            # NN distribution
            axes[1, 1].hist(nn, bins=50, color="steelblue", alpha=0.8, edgecolor="black", linewidth=0.3)
            axes[1, 1].set_xlabel("NN interval (ms)")
            axes[1, 1].set_ylabel("Count")
            axes[1, 1].set_title(f"NN Distribution (SDNN={sdnn:.1f}ms)")
            fig.tight_layout()
            figures.append(GeneratedFigure.from_matplotlib(fig, "hrv_analysis"))
            plt.close(fig)
        except ImportError:
            pass

        return ComputeResult(
            request_id=req.id, domain=ComputeDomain.CLINICAL, operation="hrv_analysis",
            results={
                "time_domain": time_domain, "frequency_domain": freq_domain, "nonlinear": nonlinear,
                "n_beats": n, "n_artifacts_corrected": int(np.sum(corrected != rr_intervals)),
                "recording_duration_min": round(float(np.sum(nn) / 60000), 1),
            },
            figures=figures,
        )


    # ── Classification ─────────────────────────────────────────────

    async def _classification(self, req: ComputeRequest, params: dict) -> ComputeResult:
        """Supervised classification with clinical validation metrics."""
        X = np.array(params["X"], dtype=float)
        y = np.array(params["y"], dtype=int)
        algorithm = params.get("algorithm", "logistic_regression")
        cv_folds = params.get("cv_folds", 10)
        feature_names = params.get("feature_names", [f"feature_{i}" for i in range(X.shape[1])])

        from sklearn.model_selection import StratifiedKFold, cross_val_predict
        from sklearn.metrics import (accuracy_score, precision_score, recall_score, f1_score,
                                      roc_auc_score, roc_curve, confusion_matrix, matthews_corrcoef,
                                      cohen_kappa_score, balanced_accuracy_score)
        from sklearn.preprocessing import StandardScaler

        scaler = StandardScaler()
        X_scaled = scaler.fit_transform(X)

        if algorithm == "logistic_regression":
            from sklearn.linear_model import LogisticRegression
            clf = LogisticRegression(max_iter=1000, random_state=42)
        elif algorithm == "svm_rbf":
            from sklearn.svm import SVC
            clf = SVC(kernel="rbf", probability=True, random_state=42)
        elif algorithm == "svm_linear":
            from sklearn.svm import SVC
            clf = SVC(kernel="linear", probability=True, random_state=42)
        elif algorithm == "random_forest":
            from sklearn.ensemble import RandomForestClassifier
            clf = RandomForestClassifier(n_estimators=100, random_state=42)
        elif algorithm == "gradient_boosting":
            from sklearn.ensemble import GradientBoostingClassifier
            clf = GradientBoostingClassifier(n_estimators=100, random_state=42)
        elif algorithm == "knn":
            from sklearn.neighbors import KNeighborsClassifier
            clf = KNeighborsClassifier(n_neighbors=5)
        else:
            from sklearn.linear_model import LogisticRegression
            clf = LogisticRegression(max_iter=1000, random_state=42)

        cv = StratifiedKFold(n_splits=cv_folds, shuffle=True, random_state=42)
        y_pred = cross_val_predict(clf, X_scaled, y, cv=cv)
        y_prob = cross_val_predict(clf, X_scaled, y, cv=cv, method="predict_proba")[:, 1] if hasattr(clf, "predict_proba") else None

        # Metrics
        acc = float(accuracy_score(y, y_pred))
        sens = float(recall_score(y, y_pred, zero_division=0))
        spec = float(recall_score(y, y_pred, pos_label=0, zero_division=0))
        ppv = float(precision_score(y, y_pred, zero_division=0))
        npv = float(precision_score(y, y_pred, pos_label=0, zero_division=0))
        f1 = float(f1_score(y, y_pred, zero_division=0))
        mcc = float(matthews_corrcoef(y, y_pred))
        kappa = float(cohen_kappa_score(y, y_pred))
        bal_acc = float(balanced_accuracy_score(y, y_pred))

        auc = float(roc_auc_score(y, y_prob)) if y_prob is not None else None
        cm = confusion_matrix(y, y_pred).tolist()

        # Feature importance
        clf.fit(X_scaled, y)
        if hasattr(clf, "feature_importances_"):
            importances = clf.feature_importances_
        elif hasattr(clf, "coef_"):
            importances = np.abs(clf.coef_[0]) if clf.coef_.ndim > 1 else np.abs(clf.coef_)
        else:
            importances = np.zeros(X.shape[1])

        feat_imp = sorted(
            [{"feature": feature_names[i], "importance": round(float(importances[i]), 4)} for i in range(len(importances))],
            key=lambda x: x["importance"], reverse=True,
        )

        # Figures
        figures = []
        try:
            import matplotlib
            matplotlib.use("Agg")
            import matplotlib.pyplot as plt
            fig, axes = plt.subplots(1, 3, figsize=(18, 5))
            # ROC
            if y_prob is not None:
                fpr, tpr, _ = roc_curve(y, y_prob)
                axes[0].plot(fpr, tpr, "b-", linewidth=2, label=f"AUC = {auc:.3f}")
                axes[0].plot([0, 1], [0, 1], "k--", linewidth=0.5)
                axes[0].set_xlabel("1 - Specificity")
                axes[0].set_ylabel("Sensitivity")
                axes[0].set_title("ROC Curve")
                axes[0].legend()
            # Confusion matrix
            cm_arr = np.array(cm)
            axes[1].imshow(cm_arr, cmap="Blues")
            for i in range(cm_arr.shape[0]):
                for j in range(cm_arr.shape[1]):
                    axes[1].text(j, i, str(cm_arr[i, j]), ha="center", va="center", fontsize=14)
            axes[1].set_xlabel("Predicted")
            axes[1].set_ylabel("Actual")
            axes[1].set_title("Confusion Matrix")
            # Feature importance
            top_n = min(15, len(feat_imp))
            axes[2].barh(range(top_n), [f["importance"] for f in feat_imp[:top_n]])
            axes[2].set_yticks(range(top_n))
            axes[2].set_yticklabels([f["feature"] for f in feat_imp[:top_n]], fontsize=8)
            axes[2].set_title("Feature Importance")
            axes[2].invert_yaxis()
            fig.tight_layout()
            figures.append(GeneratedFigure.from_matplotlib(fig, "classification_results"))
            plt.close(fig)
        except ImportError:
            pass

        return ComputeResult(
            request_id=req.id, domain=ComputeDomain.CLINICAL, operation="classification",
            results={
                "algorithm": algorithm, "cv_folds": cv_folds,
                "metrics": {
                    "accuracy": round(acc, 4), "balanced_accuracy": round(bal_acc, 4),
                    "sensitivity": round(sens, 4), "specificity": round(spec, 4),
                    "ppv": round(ppv, 4), "npv": round(npv, 4),
                    "f1_score": round(f1, 4), "mcc": round(mcc, 4),
                    "cohens_kappa": round(kappa, 4), "auc": round(auc, 4) if auc else None,
                },
                "confusion_matrix": cm,
                "feature_importance": feat_imp,
            },
            figures=figures,
        )

    # ── Factor Analysis ────────────────────────────────────────────

    async def _factor_analysis(self, req: ComputeRequest, params: dict) -> ComputeResult:
        """Exploratory Factor Analysis with rotation."""
        X = np.array(params["data"], dtype=float)
        n_factors = params.get("n_factors")
        rotation = params.get("rotation", "varimax")
        method = params.get("method", "principal_axis")
        variable_names = params.get("variable_names", [f"var_{i}" for i in range(X.shape[1])])

        n, p = X.shape
        # Standardize
        X_std = (X - X.mean(axis=0)) / (X.std(axis=0, ddof=1) + 1e-15)
        R = np.corrcoef(X_std.T)

        # KMO
        partial_corr = np.zeros_like(R)
        try:
            Rinv = np.linalg.inv(R + 0.001 * np.eye(p))
            D = np.diag(1.0 / np.sqrt(np.diag(Rinv) + 1e-15))
            partial_corr = -D @ Rinv @ D
            np.fill_diagonal(partial_corr, 1.0)
        except np.linalg.LinAlgError:
            pass
        
        r2_sum = np.sum(R**2) - p
        pr2_sum = np.sum(partial_corr**2) - p
        kmo_overall = r2_sum / (r2_sum + pr2_sum) if (r2_sum + pr2_sum) > 0 else 0

        # Bartlett's test
        det_R = np.linalg.det(R)
        chi2_bart = -((n - 1) - (2*p + 5)/6) * np.log(max(det_R, 1e-15))
        df_bart = p * (p - 1) / 2
        p_bart = 1 - sp_stats.chi2.cdf(chi2_bart, df_bart)

        # Auto-determine n_factors via parallel analysis if not specified
        if n_factors is None:
            eigenvalues = np.linalg.eigvalsh(R)[::-1]
            # Parallel analysis
            rng = np.random.default_rng(42)
            n_sim = 100
            random_eigs = np.zeros((n_sim, p))
            for i in range(n_sim):
                random_data = rng.standard_normal((n, p))
                random_eigs[i] = np.linalg.eigvalsh(np.corrcoef(random_data.T))[::-1]
            parallel_eigs = np.percentile(random_eigs, 95, axis=0)
            n_factors = int(np.sum(eigenvalues > parallel_eigs))
            n_factors = max(1, min(n_factors, p - 1))

        # Factor extraction
        eigenvalues, eigenvectors = np.linalg.eigh(R)
        idx = np.argsort(eigenvalues)[::-1]
        eigenvalues = eigenvalues[idx]
        eigenvectors = eigenvectors[:, idx]

        loadings = eigenvectors[:, :n_factors] * np.sqrt(np.maximum(eigenvalues[:n_factors], 0))

        # Rotation
        if rotation == "varimax" and n_factors > 1:
            # Varimax rotation
            rotated = loadings.copy()
            for _ in range(100):
                old = rotated.copy()
                for i in range(n_factors):
                    for j in range(i + 1, n_factors):
                        u = rotated[:, i]**2 - rotated[:, j]**2
                        v = 2 * rotated[:, i] * rotated[:, j]
                        num = 2 * (p * np.sum(u * v) - np.sum(u) * np.sum(v))
                        den = p * np.sum(u**2 - v**2) - (np.sum(u)**2 - np.sum(v)**2)
                        angle = 0.25 * np.arctan2(num, den + 1e-15)
                        cos_a, sin_a = np.cos(angle), np.sin(angle)
                        new_i = cos_a * rotated[:, i] + sin_a * rotated[:, j]
                        new_j = -sin_a * rotated[:, i] + cos_a * rotated[:, j]
                        rotated[:, i] = new_i
                        rotated[:, j] = new_j
                if np.max(np.abs(rotated - old)) < 1e-6:
                    break
            loadings = rotated

        communalities = np.sum(loadings**2, axis=1)
        uniquenesses = 1 - communalities
        var_explained = np.sum(loadings**2, axis=0) / p * 100

        # Factor scores (regression method)
        scores = X_std @ np.linalg.lstsq(R, loadings, rcond=None)[0]

        loadings_table = {}
        for i in range(p):
            loadings_table[variable_names[i]] = {
                f"Factor_{j+1}": round(float(loadings[i, j]), 4) for j in range(n_factors)
            }
            loadings_table[variable_names[i]]["communality"] = round(float(communalities[i]), 4)

        figures = []
        try:
            import matplotlib
            matplotlib.use("Agg")
            import matplotlib.pyplot as plt
            fig, axes = plt.subplots(1, 2, figsize=(14, 6))
            # Scree plot
            axes[0].plot(range(1, len(eigenvalues)+1), eigenvalues, "bo-", markersize=6)
            axes[0].axhline(1.0, color="red", linestyle="--", label="Kaiser criterion")
            axes[0].set_xlabel("Component")
            axes[0].set_ylabel("Eigenvalue")
            axes[0].set_title("Scree Plot with Parallel Analysis")
            axes[0].legend()
            # Loadings heatmap
            im = axes[1].imshow(loadings, cmap="RdBu_r", aspect="auto", vmin=-1, vmax=1)
            axes[1].set_yticks(range(p))
            axes[1].set_yticklabels(variable_names, fontsize=7)
            axes[1].set_xticks(range(n_factors))
            axes[1].set_xticklabels([f"F{i+1}" for i in range(n_factors)])
            axes[1].set_title(f"Factor Loadings ({rotation})")
            fig.colorbar(im, ax=axes[1])
            fig.tight_layout()
            figures.append(GeneratedFigure.from_matplotlib(fig, "factor_analysis"))
            plt.close(fig)
        except ImportError:
            pass

        return ComputeResult(
            request_id=req.id, domain=ComputeDomain.CLINICAL, operation="factor_analysis",
            results={
                "n_factors": n_factors, "rotation": rotation,
                "loadings": loadings_table,
                "variance_explained_pct": [round(float(v), 2) for v in var_explained],
                "cumulative_variance_pct": round(float(np.sum(var_explained)), 2),
                "kmo": round(float(kmo_overall), 4),
                "bartlett_chi2": round(float(chi2_bart), 2),
                "bartlett_p": round(float(p_bart), 6),
                "eigenvalues": [round(float(e), 4) for e in eigenvalues[:min(10, p)]],
            },
            figures=figures,
        )

    # ── Repeated Measures ANOVA ────────────────────────────────────

    async def _repeated_measures_anova(self, req: ComputeRequest, params: dict) -> ComputeResult:
        """Repeated measures ANOVA with sphericity correction."""
        data = np.array(params["data"], dtype=float)  # (subjects, conditions)
        condition_names = params.get("condition_names", [f"Cond_{i}" for i in range(data.shape[1])])

        n_subjects, k = data.shape
        grand_mean = np.mean(data)
        subject_means = np.mean(data, axis=1)
        condition_means = np.mean(data, axis=0)

        ss_between = n_subjects * np.sum((condition_means - grand_mean) ** 2)
        ss_subjects = k * np.sum((subject_means - grand_mean) ** 2)
        ss_total = np.sum((data - grand_mean) ** 2)
        ss_error = ss_total - ss_between - ss_subjects

        df_between = k - 1
        df_subjects = n_subjects - 1
        df_error = df_between * df_subjects

        ms_between = ss_between / df_between if df_between > 0 else 0
        ms_error = ss_error / df_error if df_error > 0 else 1e-10

        f_stat = ms_between / ms_error
        p_value = 1 - sp_stats.f.cdf(f_stat, df_between, df_error)
        eta_sq = ss_between / (ss_between + ss_error) if (ss_between + ss_error) > 0 else 0

        # Mauchly's test of sphericity
        diff_matrix = np.zeros((n_subjects, k * (k-1) // 2))
        idx = 0
        for i in range(k):
            for j in range(i+1, k):
                diff_matrix[:, idx] = data[:, i] - data[:, j]
                idx += 1
        S = np.cov(diff_matrix.T) if diff_matrix.shape[1] > 1 else np.array([[1.0]])
        p_dim = S.shape[0]
        if p_dim > 1:
            det_S = np.linalg.det(S)
            trace_S = np.trace(S)
            mauchly_w = det_S / (trace_S / p_dim) ** p_dim if trace_S > 0 else 1
            # Chi-square approximation
            f_val = (2 * p_dim**2 + p_dim + 2) / (6 * p_dim * (n_subjects - 1))
            chi2_mauchly = -(n_subjects - 1 - f_val) * np.log(max(mauchly_w, 1e-15))
            df_mauchly = p_dim * (p_dim - 1) / 2 - 1
            p_mauchly = 1 - sp_stats.chi2.cdf(chi2_mauchly, max(df_mauchly, 1))
        else:
            mauchly_w, chi2_mauchly, p_mauchly = 1.0, 0.0, 1.0

        # Greenhouse-Geisser epsilon
        if p_dim > 1 and trace_S > 0:
            gg_eps = trace_S**2 / (p_dim * np.sum(S**2))
            gg_eps = min(1.0, max(1.0 / (k - 1), gg_eps))
        else:
            gg_eps = 1.0

        # Corrected p-values
        p_gg = 1 - sp_stats.f.cdf(f_stat, df_between * gg_eps, df_error * gg_eps)

        # Post-hoc pairwise (Bonferroni)
        posthoc = []
        if p_value < 0.05:
            for i in range(k):
                for j in range(i+1, k):
                    t_res = sp_stats.ttest_rel(data[:, i], data[:, j])
                    posthoc.append({
                        "condition1": condition_names[i], "condition2": condition_names[j],
                        "t": round(float(t_res.statistic), 4),
                        "p": round(float(t_res.pvalue), 6),
                        "p_bonferroni": round(min(float(t_res.pvalue) * k*(k-1)/2, 1.0), 6),
                    })

        return ComputeResult(
            request_id=req.id, domain=ComputeDomain.CLINICAL, operation="repeated_measures_anova",
            results={
                "f_statistic": round(float(f_stat), 4), "p_value": round(float(p_value), 6),
                "partial_eta_squared": round(float(eta_sq), 4),
                "sphericity": {
                    "mauchly_w": round(float(mauchly_w), 4),
                    "chi2": round(float(chi2_mauchly), 4),
                    "p": round(float(p_mauchly), 6),
                    "sphericity_assumed": p_mauchly > 0.05,
                },
                "greenhouse_geisser": {"epsilon": round(float(gg_eps), 4), "p_corrected": round(float(p_gg), 6)},
                "posthoc": posthoc,
                "condition_means": {condition_names[i]: round(float(condition_means[i]), 4) for i in range(k)},
            },
            statistics=[StatisticalTest(
                test_name="Repeated Measures ANOVA", statistic=float(f_stat), p_value=float(p_value),
                degrees_of_freedom=float(df_between), effect_size=float(eta_sq), significant=p_value < 0.05,
            )],
        )

    # ── ICC ─────────────────────────────────────────────────────────

    async def _icc(self, req: ComputeRequest, params: dict) -> ComputeResult:
        """Intraclass Correlation Coefficient (Shrout & Fleiss 1979)."""
        data = np.array(params["data"], dtype=float)  # (n_subjects, n_raters)
        icc_type = params.get("type", "ICC(2,1)")

        n, k = data.shape
        grand_mean = np.mean(data)
        ss_rows = k * np.sum((np.mean(data, axis=1) - grand_mean)**2)
        ss_cols = n * np.sum((np.mean(data, axis=0) - grand_mean)**2)
        ss_total = np.sum((data - grand_mean)**2)
        ss_error = ss_total - ss_rows - ss_cols

        ms_rows = ss_rows / (n - 1)
        ms_cols = ss_cols / (k - 1) if k > 1 else 0
        ms_error = ss_error / ((n - 1) * (k - 1)) if (n-1)*(k-1) > 0 else 1e-10
        ms_within = (ss_total - ss_rows) / (n * (k - 1)) if n*(k-1) > 0 else 1e-10

        results = {}
        # ICC(1,1) - One-way random, single
        icc_1_1 = (ms_rows - ms_within) / (ms_rows + (k-1)*ms_within) if (ms_rows + (k-1)*ms_within) > 0 else 0
        results["ICC(1,1)"] = round(float(icc_1_1), 4)
        # ICC(2,1) - Two-way random, single
        icc_2_1 = (ms_rows - ms_error) / (ms_rows + (k-1)*ms_error + k*(ms_cols - ms_error)/n) if True else 0
        results["ICC(2,1)"] = round(float(icc_2_1), 4)
        # ICC(3,1) - Two-way mixed, single
        icc_3_1 = (ms_rows - ms_error) / (ms_rows + (k-1)*ms_error) if (ms_rows + (k-1)*ms_error) > 0 else 0
        results["ICC(3,1)"] = round(float(icc_3_1), 4)
        # Average measures
        results["ICC(1,k)"] = round(1 - 1/(1 + k*icc_1_1/(1-icc_1_1+1e-15)), 4)
        results["ICC(2,k)"] = round(1 - 1/(1 + k*icc_2_1/(1-icc_2_1+1e-15)), 4)
        results["ICC(3,k)"] = round(1 - 1/(1 + k*icc_3_1/(1-icc_3_1+1e-15)), 4)

        # Interpretation
        selected = results.get(icc_type, icc_2_1)
        if isinstance(selected, float):
            val = selected
        else:
            val = float(selected)
        if val < 0.5: interp = "Poor"
        elif val < 0.75: interp = "Moderate"
        elif val < 0.9: interp = "Good"
        else: interp = "Excellent"

        return ComputeResult(
            request_id=req.id, domain=ComputeDomain.CLINICAL, operation="icc",
            results={**results, "selected_type": icc_type, "selected_value": val, "interpretation": interp,
                     "n_subjects": n, "n_raters": k},
        )

    # ── Bland-Altman ───────────────────────────────────────────────

    async def _bland_altman(self, req: ComputeRequest, params: dict) -> ComputeResult:
        """Bland-Altman agreement analysis."""
        method1 = np.array(params["method1"], dtype=float)
        method2 = np.array(params["method2"], dtype=float)

        diff = method1 - method2
        mean_both = (method1 + method2) / 2
        bias = float(np.mean(diff))
        sd_diff = float(np.std(diff, ddof=1))
        n = len(diff)

        loa_upper = bias + 1.96 * sd_diff
        loa_lower = bias - 1.96 * sd_diff

        # CI for bias
        se_bias = sd_diff / np.sqrt(n)
        ci_bias = (bias - sp_stats.t.ppf(0.975, n-1) * se_bias, bias + sp_stats.t.ppf(0.975, n-1) * se_bias)

        # Proportional bias (regression of diff on mean)
        slope, intercept, r, p_prop, se_slope = sp_stats.linregress(mean_both, diff)

        figures = []
        try:
            import matplotlib
            matplotlib.use("Agg")
            import matplotlib.pyplot as plt
            fig, ax = plt.subplots(figsize=(10, 6))
            ax.scatter(mean_both, diff, s=20, alpha=0.6)
            ax.axhline(bias, color="red", linewidth=1.5, label=f"Bias = {bias:.3f}")
            ax.axhline(loa_upper, color="gray", linestyle="--", label=f"+1.96 SD = {loa_upper:.3f}")
            ax.axhline(loa_lower, color="gray", linestyle="--", label=f"-1.96 SD = {loa_lower:.3f}")
            if p_prop < 0.05:
                xs = np.linspace(mean_both.min(), mean_both.max(), 100)
                ax.plot(xs, slope * xs + intercept, "b-", linewidth=1, alpha=0.5, label="Proportional bias")
            ax.set_xlabel("Mean of Two Methods")
            ax.set_ylabel("Difference (Method 1 - Method 2)")
            ax.set_title("Bland-Altman Plot")
            ax.legend(fontsize=8)
            ax.grid(True, alpha=0.3)
            figures.append(GeneratedFigure.from_matplotlib(fig, "bland_altman"))
            plt.close(fig)
        except ImportError:
            pass

        return ComputeResult(
            request_id=req.id, domain=ComputeDomain.CLINICAL, operation="bland_altman",
            results={
                "bias": round(bias, 4), "sd_diff": round(sd_diff, 4),
                "loa_upper": round(loa_upper, 4), "loa_lower": round(loa_lower, 4),
                "ci_bias": [round(ci_bias[0], 4), round(ci_bias[1], 4)],
                "proportional_bias": {"slope": round(slope, 4), "p": round(float(p_prop), 6), "significant": p_prop < 0.05},
                "n": n,
            },
            figures=figures,
        )

    # ── Clinical Trial Power Analysis ──────────────────────────────

    async def _power_analysis_clinical(self, req: ComputeRequest, params: dict) -> ComputeResult:
        """Power analysis for clinical trial designs."""
        design = params.get("design", "parallel")
        outcome = params.get("outcome", "continuous")
        alpha = params.get("alpha", 0.05)
        power = params.get("power", 0.80)
        effect_size = params.get("effect_size", 0.5)
        dropout_rate = params.get("dropout_rate", 0.0)
        test_type = params.get("test_type", "superiority")

        z_alpha = sp_stats.norm.ppf(1 - alpha/2) if test_type == "superiority" else sp_stats.norm.ppf(1 - alpha)
        z_beta = sp_stats.norm.ppf(power)

        if outcome == "continuous":
            if design == "parallel":
                n_per_arm = math.ceil(2 * ((z_alpha + z_beta) / effect_size) ** 2)
                if test_type == "non_inferiority":
                    margin = params.get("non_inferiority_margin", 0.3)
                    n_per_arm = math.ceil(2 * ((z_alpha + z_beta) / (effect_size + margin)) ** 2)
            elif design == "crossover":
                rho = params.get("correlation", 0.5)
                n_total = math.ceil(((z_alpha + z_beta) / effect_size) ** 2 * 2 * (1 - rho))
                n_per_arm = n_total
            elif design == "cluster":
                m = params.get("cluster_size", 20)
                icc_val = params.get("icc", 0.05)
                deff = 1 + (m - 1) * icc_val
                n_per_arm = math.ceil(2 * ((z_alpha + z_beta) / effect_size) ** 2 * deff)
            else:
                n_per_arm = math.ceil(2 * ((z_alpha + z_beta) / effect_size) ** 2)
        elif outcome == "binary":
            p1 = params.get("p1", 0.5)
            p2 = params.get("p2", 0.3)
            p_bar = (p1 + p2) / 2
            n_per_arm = math.ceil(((z_alpha * math.sqrt(2*p_bar*(1-p_bar)) + z_beta * math.sqrt(p1*(1-p1) + p2*(1-p2))) / (p1 - p2)) ** 2)
        else:
            n_per_arm = math.ceil(2 * ((z_alpha + z_beta) / effect_size) ** 2)

        # Adjust for dropout
        if dropout_rate > 0:
            n_per_arm_adj = math.ceil(n_per_arm / (1 - dropout_rate))
        else:
            n_per_arm_adj = n_per_arm

        total_n = n_per_arm_adj * (2 if design != "crossover" else 1)

        # Power curve
        effect_sizes = np.linspace(0.1, 1.5, 50)
        powers = []
        for es in effect_sizes:
            z_stat = es * math.sqrt(n_per_arm / 2) - z_alpha
            powers.append(float(sp_stats.norm.cdf(z_stat)))

        figures = []
        try:
            import matplotlib
            matplotlib.use("Agg")
            import matplotlib.pyplot as plt
            fig, ax = plt.subplots(figsize=(8, 5))
            ax.plot(effect_sizes, powers, "b-", linewidth=2)
            ax.axhline(power, color="red", linestyle="--", alpha=0.5, label=f"Target power = {power}")
            ax.axvline(effect_size, color="green", linestyle="--", alpha=0.5, label=f"Effect size = {effect_size}")
            ax.set_xlabel("Effect Size (Cohen's d)")
            ax.set_ylabel("Power")
            ax.set_title(f"Power Curve (n = {n_per_arm} per arm)")
            ax.legend()
            ax.grid(True, alpha=0.3)
            ax.set_ylim(0, 1.05)
            figures.append(GeneratedFigure.from_matplotlib(fig, "power_curve"))
            plt.close(fig)
        except ImportError:
            pass

        return ComputeResult(
            request_id=req.id, domain=ComputeDomain.CLINICAL, operation="power_analysis_clinical",
            results={
                "n_per_arm": n_per_arm, "n_per_arm_adjusted": n_per_arm_adj,
                "total_n": total_n, "design": design, "outcome": outcome,
                "effect_size": effect_size, "alpha": alpha, "power": power,
                "test_type": test_type, "dropout_rate": dropout_rate,
            },
            figures=figures,
        )
