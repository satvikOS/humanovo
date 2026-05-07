"""
Cardiovascular Signal Processing Module — MATLAB-equivalent capabilities.

Provides comprehensive cardiac signal analysis including QRS detection
(Pan-Tompkins), ECG delineation, HRV analysis, Windkessel hemodynamic
modeling, arrhythmia classification, pulse wave analysis, and cardiac
output estimation.
"""

from __future__ import annotations

import base64
import io
import logging
import math
from collections.abc import Callable
from typing import Any

import numpy as np
from scipy import integrate, interpolate, optimize
from scipy import signal as sp_signal

from app.compute.types import (
    ComputeDomain,
    ComputeRequest,
    ComputeResult,
    ComputeStatus,
    GeneratedFigure,
)

logger = logging.getLogger(__name__)


def _sf(val: Any) -> float:
    """Convert to JSON-safe float."""
    v = float(val)
    if np.isnan(v) or np.isinf(v):
        return 0.0
    return v


def _to_list(arr: np.ndarray) -> list[float]:
    """Convert numpy array to list of JSON-safe floats."""
    a = np.asarray(arr, dtype=np.float64)
    a = np.nan_to_num(a, nan=0.0, posinf=0.0, neginf=0.0)
    return a.tolist()


def _ok(request: ComputeRequest, **kwargs: Any) -> ComputeResult:
    return ComputeResult(
        request_id=request.id,
        domain=ComputeDomain.ELECTROPHYSIOLOGY,
        operation=request.operation,
        status=ComputeStatus.COMPLETED,
        **kwargs,
    )


def _fail(request: ComputeRequest, error: str) -> ComputeResult:
    return ComputeResult(
        request_id=request.id,
        domain=ComputeDomain.ELECTROPHYSIOLOGY,
        operation=request.operation,
        status=ComputeStatus.FAILED,
        error=error,
    )


def _fig_to_b64(fig) -> str:
    """Render matplotlib figure to base64 SVG."""
    buf = io.BytesIO()
    fig.savefig(buf, format="svg", bbox_inches="tight")
    buf.seek(0)
    return base64.b64encode(buf.read()).decode("utf-8")


def _make_figure(fig, title: str) -> GeneratedFigure:
    """Create a GeneratedFigure from a matplotlib figure as SVG."""
    from app.compute.types import FigureFormat
    return GeneratedFigure.from_matplotlib(fig, title, fmt=FigureFormat.SVG)


class CardiacProcessor:
    """Cardiovascular signal processing computation engine.

    Implements MATLAB-equivalent algorithms for cardiac signal analysis:
    Pan-Tompkins QRS detection, ECG wave delineation, full HRV analysis,
    Windkessel hemodynamic modeling, arrhythmia classification, pulse wave
    analysis, and cardiac output estimation.
    """

    OPERATIONS = [
        "pan_tompkins_qrs",
        "ecg_delineation",
        "hrv_analysis",
        "windkessel_model",
        "arrhythmia_classification",
        "pulse_wave_analysis",
        "cardiac_output",
    ]

    def list_operations(self) -> list[str]:
        return self.OPERATIONS

    async def execute(
        self,
        request: ComputeRequest,
        progress_callback: Callable[[int, int], None] | None = None,
    ) -> ComputeResult:
        op = request.operation
        if op not in self.OPERATIONS:
            return _fail(request, f"Unknown operation: {op!r}. Available: {self.OPERATIONS}")
        handler = getattr(self, f"_{op}", None)
        if handler is None:
            return _fail(request, f"Operation {op!r} declared but not implemented.")
        try:
            return await handler(request, progress_callback)
        except Exception as exc:
            logger.exception("CardiacProcessor.%s failed", op)
            return _fail(request, str(exc))

    # ──────────────────────────────────────────────────────────────────
    # 1. Pan-Tompkins QRS Detection
    # ──────────────────────────────────────────────────────────────────

    async def _pan_tompkins_qrs(
        self, request: ComputeRequest, progress_callback: Callable | None = None,
    ) -> ComputeResult:
        params = request.parameters
        ecg = np.asarray(params["ecg_signal"], dtype=np.float64)
        fs = float(params["sampling_rate"])

        # Stage 1: Bandpass filter 5-15 Hz, 2nd-order Butterworth
        nyq = fs / 2.0
        low, high = 5.0 / nyq, min(15.0 / nyq, 0.99)
        b_bp, a_bp = sp_signal.butter(2, [low, high], btype="band")
        ecg_bp = sp_signal.filtfilt(b_bp, a_bp, ecg)

        # Stage 2: Derivative filter [-1, -2, 0, 2, 1] * (fs/8)
        deriv_coeffs = np.array([-1.0, -2.0, 0.0, 2.0, 1.0]) * (fs / 8.0)
        ecg_deriv = np.convolve(ecg_bp, deriv_coeffs, mode="same")

        # Stage 3: Squaring
        ecg_sq = ecg_deriv ** 2

        # Stage 4: Moving window integration (150 ms window)
        win_len = max(1, int(round(0.15 * fs)))
        win = np.ones(win_len) / win_len
        ecg_mwi = np.convolve(ecg_sq, win, mode="same")

        # Stage 5: Adaptive thresholding
        # Initialize thresholds from first 2 seconds
        init_len = min(int(2.0 * fs), len(ecg_mwi))
        spki = np.max(ecg_mwi[:init_len]) * 0.25  # signal peak running estimate
        npki = np.mean(ecg_mwi[:init_len]) * 0.5   # noise peak running estimate
        threshold1 = npki + 0.25 * (spki - npki)
        threshold2 = 0.5 * threshold1

        # Similarly for bandpass-filtered signal
        spki_bp = np.max(np.abs(ecg_bp[:init_len])) * 0.25
        npki_bp = np.mean(np.abs(ecg_bp[:init_len])) * 0.5
        threshold1_bp = npki_bp + 0.25 * (spki_bp - npki_bp)
        threshold2_bp = 0.5 * threshold1_bp

        refractory = int(round(0.2 * fs))  # 200 ms refractory period

        # Find candidate peaks in MWI
        min_dist = max(1, refractory)
        candidate_indices, _ = sp_signal.find_peaks(ecg_mwi, distance=min_dist)

        qrs_indices = []
        rr_history = []  # recent 8 RR intervals for adaptive thresholds
        rr_low = 0.0
        rr_high = float("inf")
        rr_avg = 0.0

        for i, idx in enumerate(candidate_indices):
            peak_val = ecg_mwi[idx]
            peak_bp = np.abs(ecg_bp[idx])

            is_qrs = False

            if peak_val > threshold1 and peak_bp > threshold1_bp:
                is_qrs = True
            elif peak_val > threshold2 and peak_bp > threshold2_bp:
                # Search-back: check if this is a missed beat
                if len(qrs_indices) > 0:
                    last_rr = (idx - qrs_indices[-1]) / fs
                    if rr_avg > 0 and last_rr > 1.66 * rr_avg:
                        is_qrs = True

            if is_qrs:
                # Refine: find actual R peak in original ECG around this index
                search_half = max(1, int(round(0.075 * fs)))
                lo = max(0, idx - search_half)
                hi = min(len(ecg), idx + search_half + 1)
                local_max_idx = lo + np.argmax(ecg[lo:hi])

                # Check refractory period
                if len(qrs_indices) > 0 and (local_max_idx - qrs_indices[-1]) < refractory:
                    # Update noise estimates
                    npki = 0.875 * npki + 0.125 * peak_val
                    npki_bp = 0.875 * npki_bp + 0.125 * peak_bp
                else:
                    qrs_indices.append(int(local_max_idx))
                    # Update signal peak estimates
                    spki = 0.875 * spki + 0.125 * peak_val
                    spki_bp = 0.875 * spki_bp + 0.125 * peak_bp

                    # Update RR history
                    if len(qrs_indices) >= 2:
                        rr = (qrs_indices[-1] - qrs_indices[-2]) / fs
                        rr_history.append(rr)
                        if len(rr_history) > 8:
                            rr_history.pop(0)
                        rr_avg = np.mean(rr_history)
                        rr_low = 0.92 * rr_avg
                        rr_high = 1.16 * rr_avg
            else:
                npki = 0.875 * npki + 0.125 * peak_val
                npki_bp = 0.875 * npki_bp + 0.125 * peak_bp

            # Update thresholds
            threshold1 = npki + 0.25 * (spki - npki)
            threshold2 = 0.5 * threshold1
            threshold1_bp = npki_bp + 0.25 * (spki_bp - npki_bp)
            threshold2_bp = 0.5 * threshold1_bp

        # Search-back pass for missed beats
        final_qrs = list(qrs_indices)
        if len(final_qrs) >= 2 and rr_avg > 0:
            i = 1
            while i < len(final_qrs):
                rr_gap = (final_qrs[i] - final_qrs[i - 1]) / fs
                if rr_gap > 1.66 * rr_avg:
                    lo_search = final_qrs[i - 1] + refractory
                    hi_search = final_qrs[i] - refractory
                    if lo_search < hi_search:
                        seg = ecg_mwi[lo_search:hi_search]
                        if len(seg) > 0:
                            local_peaks, _ = sp_signal.find_peaks(seg)
                            if len(local_peaks) > 0:
                                best = local_peaks[np.argmax(seg[local_peaks])]
                                if seg[best] > threshold2:
                                    new_idx = lo_search + best
                                    # Refine in original ECG
                                    s_lo = max(0, new_idx - int(0.075 * fs))
                                    s_hi = min(len(ecg), new_idx + int(0.075 * fs) + 1)
                                    new_idx = s_lo + np.argmax(ecg[s_lo:s_hi])
                                    final_qrs.insert(i, int(new_idx))
                                    i += 1
                i += 1

        qrs_indices = sorted(set(final_qrs))

        # Compute RR intervals and heart rate
        rr_intervals = np.diff(qrs_indices) / fs  # seconds
        heart_rate = 60.0 / rr_intervals if len(rr_intervals) > 0 else np.array([])

        return _ok(
            request,
            results={
                "qrs_indices": [int(x) for x in qrs_indices],
                "rr_intervals_s": _to_list(rr_intervals),
                "heart_rate_bpm": _to_list(heart_rate),
                "mean_heart_rate_bpm": _sf(np.mean(heart_rate)) if len(heart_rate) > 0 else 0.0,
                "num_beats": len(qrs_indices),
                "filtered_stages": {
                    "bandpass": _to_list(ecg_bp),
                    "derivative": _to_list(ecg_deriv),
                    "squared": _to_list(ecg_sq),
                    "integrated": _to_list(ecg_mwi),
                },
            },
        )

    # ──────────────────────────────────────────────────────────────────
    # 2. ECG Delineation (P-QRS-T wave boundaries)
    # ──────────────────────────────────────────────────────────────────

    async def _ecg_delineation(
        self, request: ComputeRequest, progress_callback: Callable | None = None,
    ) -> ComputeResult:
        params = request.parameters
        ecg = np.asarray(params["ecg_signal"], dtype=np.float64)
        fs = float(params["sampling_rate"])
        qrs_indices = params.get("qrs_indices", None)

        # Auto-detect if not provided
        if qrs_indices is None:
            sub_req = ComputeRequest(
                domain=ComputeDomain.ELECTROPHYSIOLOGY,
                operation="pan_tompkins_qrs",
                parameters={"ecg_signal": ecg.tolist(), "sampling_rate": fs},
            )
            det_result = await self._pan_tompkins_qrs(sub_req, None)
            qrs_indices = det_result.results.get("qrs_indices", [])

        qrs_indices = [int(x) for x in qrs_indices]
        n = len(ecg)

        # Smooth derivative for boundary detection
        deriv = np.gradient(ecg)
        # Mild lowpass for cleaner derivative
        if fs > 40:
            nyq = fs / 2.0
            b_lp, a_lp = sp_signal.butter(2, min(40.0 / nyq, 0.99), btype="low")
            ecg_smooth = sp_signal.filtfilt(b_lp, a_lp, ecg)
            deriv_smooth = np.gradient(ecg_smooth)
        else:
            ecg_smooth = ecg.copy()
            deriv_smooth = deriv.copy()

        waves = {
            "P_peaks": [], "P_onsets": [], "P_offsets": [],
            "Q_peaks": [], "R_peaks": list(qrs_indices),
            "S_peaks": [],
            "QRS_onsets": [], "QRS_offsets": [],
            "T_peaks": [], "T_onsets": [], "T_offsets": [],
        }
        intervals = {
            "PR_intervals_ms": [], "QRS_durations_ms": [],
            "QT_intervals_ms": [], "QTc_Bazett_ms": [],
            "QTc_Fridericia_ms": [], "QTc_Framingham_ms": [],
        }
        st_deviations = []

        for beat_i, r_idx in enumerate(qrs_indices):
            if r_idx < 0 or r_idx >= n:
                continue

            # --- Q wave: search backward from R for local minimum ---
            q_search_start = max(0, r_idx - int(0.08 * fs))
            seg_q = ecg_smooth[q_search_start:r_idx]
            if len(seg_q) > 2:
                q_rel = np.argmin(seg_q)
                q_idx = q_search_start + q_rel
            else:
                q_idx = max(0, r_idx - 1)
            waves["Q_peaks"].append(int(q_idx))

            # --- S wave: search forward from R for local minimum ---
            s_search_end = min(n, r_idx + int(0.08 * fs))
            seg_s = ecg_smooth[r_idx:s_search_end]
            if len(seg_s) > 2:
                s_rel = np.argmin(seg_s)
                s_idx = r_idx + s_rel
            else:
                s_idx = min(n - 1, r_idx + 1)
            waves["S_peaks"].append(int(s_idx))

            # --- QRS onset: search backward from Q using derivative threshold ---
            qrs_on_search = max(0, q_idx - int(0.04 * fs))
            seg_don = deriv_smooth[qrs_on_search:q_idx]
            if len(seg_don) > 1:
                thresh_on = 0.1 * np.max(np.abs(seg_don))
                crossings = np.where(np.abs(seg_don) < thresh_on)[0]
                qrs_onset = qrs_on_search + (crossings[-1] if len(crossings) > 0 else 0)
            else:
                qrs_onset = qrs_on_search
            waves["QRS_onsets"].append(int(qrs_onset))

            # --- QRS offset: search forward from S using derivative threshold ---
            qrs_off_search = min(n, s_idx + int(0.04 * fs))
            seg_doff = deriv_smooth[s_idx:qrs_off_search]
            if len(seg_doff) > 1:
                thresh_off = 0.1 * np.max(np.abs(seg_doff))
                crossings = np.where(np.abs(seg_doff) < thresh_off)[0]
                qrs_offset = s_idx + (crossings[0] if len(crossings) > 0 else len(seg_doff) - 1)
            else:
                qrs_offset = min(n - 1, s_idx + 1)
            waves["QRS_offsets"].append(int(qrs_offset))

            qrs_dur_ms = (qrs_offset - qrs_onset) / fs * 1000.0
            intervals["QRS_durations_ms"].append(_sf(qrs_dur_ms))

            # --- T wave: search in [QRS_end + 50ms, QRS_end + 400ms] ---
            t_lo = int(qrs_offset + 0.05 * fs)
            t_hi = int(min(n, qrs_offset + 0.40 * fs))
            if t_lo < t_hi and t_hi <= n:
                seg_t = ecg_smooth[t_lo:t_hi]
                if len(seg_t) > 2:
                    # T can be positive or negative; pick dominant polarity
                    t_pos_max = np.max(seg_t)
                    t_neg_min = np.min(seg_t)
                    if abs(t_pos_max) >= abs(t_neg_min):
                        t_rel = np.argmax(seg_t)
                    else:
                        t_rel = np.argmin(seg_t)
                    t_peak = t_lo + t_rel
                else:
                    t_peak = t_lo
            else:
                t_peak = min(n - 1, qrs_offset + int(0.15 * fs))
            waves["T_peaks"].append(int(t_peak))

            # T wave onset/offset via tangent method
            # T onset: between QRS offset and T peak
            t_onset_seg = ecg_smooth[qrs_offset:t_peak] if t_peak > qrs_offset else np.array([])
            if len(t_onset_seg) > 3:
                d_seg = np.gradient(t_onset_seg)
                max_slope_idx = np.argmax(np.abs(d_seg))
                slope = d_seg[max_slope_idx]
                intercept = t_onset_seg[max_slope_idx] - slope * max_slope_idx
                if abs(slope) > 1e-12:
                    baseline = np.mean(ecg_smooth[max(0, qrs_offset - int(0.01 * fs)):qrs_offset + 1])
                    cross_x = (baseline - intercept) / slope
                    t_onset = int(np.clip(qrs_offset + cross_x, qrs_offset, t_peak))
                else:
                    t_onset = qrs_offset
            else:
                t_onset = qrs_offset
            waves["T_onsets"].append(int(t_onset))

            # T offset: after T peak
            t_off_end = min(n, t_peak + int(0.20 * fs))
            t_offset_seg = ecg_smooth[t_peak:t_off_end] if t_off_end > t_peak else np.array([])
            if len(t_offset_seg) > 3:
                d_seg = np.gradient(t_offset_seg)
                max_slope_idx = np.argmax(np.abs(d_seg))
                slope = d_seg[max_slope_idx]
                intercept = t_offset_seg[max_slope_idx] - slope * max_slope_idx
                if abs(slope) > 1e-12:
                    baseline = np.mean(ecg_smooth[t_off_end - min(3, len(t_offset_seg)):t_off_end])
                    cross_x = (baseline - intercept) / slope
                    t_offset = int(np.clip(t_peak + cross_x, t_peak, t_off_end - 1))
                else:
                    t_offset = t_off_end - 1
            else:
                t_offset = min(n - 1, t_peak + int(0.10 * fs))
            waves["T_offsets"].append(int(t_offset))

            # QT interval
            qt_ms = (t_offset - qrs_onset) / fs * 1000.0
            intervals["QT_intervals_ms"].append(_sf(qt_ms))

            # QTc corrections
            # Need RR interval for this beat
            if beat_i > 0:
                rr_s = (qrs_indices[beat_i] - qrs_indices[beat_i - 1]) / fs
            elif beat_i < len(qrs_indices) - 1:
                rr_s = (qrs_indices[beat_i + 1] - qrs_indices[beat_i]) / fs
            else:
                rr_s = 1.0  # default 60 bpm
            rr_s = max(rr_s, 0.3)

            qt_s = qt_ms / 1000.0
            # Bazett: QTc = QT / sqrt(RR)
            qtc_bazett = qt_s / math.sqrt(rr_s) * 1000.0
            # Fridericia: QTc = QT / RR^(1/3)
            qtc_fridericia = qt_s / (rr_s ** (1.0 / 3.0)) * 1000.0
            # Framingham: QTc = QT + 0.154*(1 - RR)  (in seconds, convert)
            qtc_framingham = (qt_s + 0.154 * (1.0 - rr_s)) * 1000.0

            intervals["QTc_Bazett_ms"].append(_sf(qtc_bazett))
            intervals["QTc_Fridericia_ms"].append(_sf(qtc_fridericia))
            intervals["QTc_Framingham_ms"].append(_sf(qtc_framingham))

            # --- P wave: search before QRS onset ---
            if beat_i > 0:
                prev_t_off = waves["T_offsets"][beat_i - 1]
                p_lo = prev_t_off + int(0.02 * fs)
            else:
                p_lo = max(0, qrs_onset - int(0.30 * fs))
            p_hi = max(p_lo + 1, qrs_onset - int(0.02 * fs))
            p_hi = min(n, p_hi)

            if p_lo < p_hi:
                seg_p = ecg_smooth[p_lo:p_hi]
                if len(seg_p) > 2:
                    p_rel = np.argmax(seg_p)
                    p_peak = p_lo + p_rel
                else:
                    p_peak = p_lo
            else:
                p_peak = max(0, qrs_onset - int(0.15 * fs))
            waves["P_peaks"].append(int(p_peak))

            # P wave onset/offset (simplified tangent)
            p_onset_lo = max(0, p_peak - int(0.06 * fs))
            seg_p_on = ecg_smooth[p_onset_lo:p_peak]
            if len(seg_p_on) > 2:
                dp = np.gradient(seg_p_on)
                mi = np.argmax(np.abs(dp))
                thresh_p = 0.15 * np.max(np.abs(dp))
                crossings_p = np.where(np.abs(dp[:mi]) < thresh_p)[0]
                p_onset = p_onset_lo + (crossings_p[-1] if len(crossings_p) > 0 else 0)
            else:
                p_onset = p_onset_lo
            waves["P_onsets"].append(int(p_onset))

            p_offset_hi = min(n, p_peak + int(0.06 * fs))
            seg_p_off = ecg_smooth[p_peak:p_offset_hi]
            if len(seg_p_off) > 2:
                dp = np.gradient(seg_p_off)
                mi = np.argmax(np.abs(dp))
                thresh_p = 0.15 * np.max(np.abs(dp))
                crossings_p = np.where(np.abs(dp[mi:]) < thresh_p)[0]
                p_offset = p_peak + mi + (crossings_p[0] if len(crossings_p) > 0 else len(dp) - mi - 1)
            else:
                p_offset = min(n - 1, p_peak + int(0.03 * fs))
            waves["P_offsets"].append(int(p_offset))

            # PR interval
            pr_ms = (qrs_onset - p_onset) / fs * 1000.0
            intervals["PR_intervals_ms"].append(_sf(pr_ms))

            # ST deviation (measure at J-point + 60ms relative to baseline)
            j_point = qrs_offset
            st_measure_idx = min(n - 1, j_point + int(0.06 * fs))
            # Baseline: PR segment (between P offset and QRS onset)
            bl_lo = max(0, p_offset)
            bl_hi = max(bl_lo + 1, qrs_onset)
            baseline_val = np.mean(ecg_smooth[bl_lo:bl_hi]) if bl_hi > bl_lo else 0.0
            st_dev = ecg_smooth[st_measure_idx] - baseline_val
            st_deviations.append(_sf(st_dev))

        return _ok(
            request,
            results={
                "waves": {k: [int(x) for x in v] for k, v in waves.items()},
                "intervals": intervals,
                "ST_deviation": st_deviations,
                "num_beats_delineated": len(qrs_indices),
            },
        )

    # ── 3. HRV Analysis (Full Pipeline) ───────────────────────────

    async def _hrv_analysis(self, request: ComputeRequest, progress_callback) -> ComputeResult:
        p = request.parameters
        figures = []

        # Get RR intervals (ms)
        if "rr_intervals" in p:
            rr_raw = np.asarray(p["rr_intervals"], dtype=np.float64)
        elif "ecg_signal" in p:
            fs = float(p.get("sampling_rate", 500))
            req_copy = ComputeRequest(
                domain=ComputeDomain.ELECTROPHYSIOLOGY,
                operation="pan_tompkins_qrs",
                parameters={"ecg_signal": p["ecg_signal"], "sampling_rate": fs},
            )
            pt_result = await self._pan_tompkins_qrs(req_copy, None)
            rr_raw = np.asarray(pt_result.results.get("rr_intervals_ms", []))
        else:
            return ComputeResult(
                request_id=request.id, domain=ComputeDomain.ELECTROPHYSIOLOGY,
                operation="hrv_analysis", status=ComputeStatus.FAILED,
                error="Provide rr_intervals (ms) or ecg_signal + sampling_rate",
            )

        if len(rr_raw) < 10:
            return ComputeResult(
                request_id=request.id, domain=ComputeDomain.ELECTROPHYSIOLOGY,
                operation="hrv_analysis", status=ComputeStatus.FAILED,
                error="Need at least 10 RR intervals",
            )

        # Malik artifact correction: replace if >20% deviation from local median
        rr = rr_raw.copy()
        for i in range(len(rr)):
            start = max(0, i - 2)
            end = min(len(rr), i + 3)
            local_med = np.median(rr[start:end])
            if abs(rr[i] - local_med) / max(local_med, 1) > 0.20:
                rr[i] = local_med
        rr = rr[(rr > 200) & (rr < 2000)]
        if len(rr) < 10:
            return ComputeResult(
                request_id=request.id, domain=ComputeDomain.ELECTROPHYSIOLOGY,
                operation="hrv_analysis", status=ComputeStatus.FAILED,
                error="Too few valid RR intervals after artifact correction",
            )

        nn = rr
        diff_nn = np.diff(nn)

        # ── Time Domain ──
        mean_rr = _sf(np.mean(nn))
        sdnn = _sf(np.std(nn, ddof=1))
        rmssd = _sf(np.sqrt(np.mean(diff_nn ** 2)))
        pnn50 = _sf(100.0 * np.sum(np.abs(diff_nn) > 50) / len(diff_nn))
        pnn20 = _sf(100.0 * np.sum(np.abs(diff_nn) > 20) / len(diff_nn))
        sdsd = _sf(np.std(diff_nn, ddof=1))
        mean_hr = _sf(60000.0 / mean_rr) if mean_rr > 0 else 0.0
        hr_values = 60000.0 / nn
        sd_hr = _sf(np.std(hr_values, ddof=1))

        # SDANN (5-min segments)
        seg_len_ms = 5 * 60 * 1000
        cumul = np.cumsum(nn)
        seg_means = []
        seg_start = 0
        for i in range(len(cumul)):
            if cumul[i] - (cumul[seg_start - 1] if seg_start > 0 else 0) >= seg_len_ms:
                seg_means.append(np.mean(nn[seg_start:i + 1]))
                seg_start = i + 1
        if seg_start < len(nn):
            seg_means.append(np.mean(nn[seg_start:]))
        sdann = _sf(np.std(seg_means, ddof=1)) if len(seg_means) > 1 else 0.0

        # Triangular index
        bin_w = 128.0
        hist_counts, _ = np.histogram(nn, bins=np.arange(nn.min(), nn.max() + bin_w, bin_w))
        tri_index = _sf(len(nn) / np.max(hist_counts)) if np.max(hist_counts) > 0 else 0.0
        nonzero = np.nonzero(hist_counts)[0]
        tinn = _sf((nonzero[-1] - nonzero[0]) * bin_w) if len(nonzero) > 1 else 0.0

        time_domain = {
            "mean_RR_ms": mean_rr, "SDNN_ms": sdnn, "SDANN_ms": sdann,
            "RMSSD_ms": rmssd, "pNN50": pnn50, "pNN20": pnn20,
            "SDSD_ms": sdsd, "mean_HR_bpm": mean_hr, "SD_HR_bpm": sd_hr,
            "triangular_index": tri_index, "TINN_ms": tinn, "n_intervals": len(nn),
        }

        # ── Frequency Domain (Welch PSD on 4Hz resampled tachogram) ──
        cumul_time = np.cumsum(nn) / 1000.0
        cumul_time = cumul_time - cumul_time[0]
        fs_resamp = 4.0
        t_uniform = np.arange(0, cumul_time[-1], 1.0 / fs_resamp)
        if len(t_uniform) < 16:
            t_uniform = np.linspace(cumul_time[0], cumul_time[-1], max(16, len(nn)))
            fs_resamp = len(t_uniform) / (cumul_time[-1] - cumul_time[0] + 1e-10)

        interp_func = interpolate.interp1d(cumul_time, nn, kind="cubic", fill_value="extrapolate")
        tachogram = interp_func(t_uniform)
        tachogram = tachogram - np.mean(tachogram)

        nperseg = min(256, len(tachogram))
        freqs, psd = sp_signal.welch(tachogram, fs=fs_resamp, nperseg=nperseg,
                                      window="hann", noverlap=nperseg // 2)

        def band_power(f_low, f_high):
            mask = (freqs >= f_low) & (freqs <= f_high)
            return _sf(np.trapz(psd[mask], freqs[mask])) if np.any(mask) else 0.0

        vlf = band_power(0.003, 0.04)
        lf = band_power(0.04, 0.15)
        hf = band_power(0.15, 0.4)
        total_power = vlf + lf + hf
        lf_hf_ratio = _sf(lf / hf) if hf > 0 else 0.0
        lf_nu = _sf(100.0 * lf / (lf + hf)) if (lf + hf) > 0 else 0.0
        hf_nu = _sf(100.0 * hf / (lf + hf)) if (lf + hf) > 0 else 0.0

        frequency_domain = {
            "VLF_ms2": vlf, "LF_ms2": lf, "HF_ms2": hf,
            "total_power_ms2": _sf(total_power),
            "LF_HF_ratio": lf_hf_ratio, "LFnu": lf_nu, "HFnu": hf_nu,
        }

        # ── Nonlinear ──
        nn1 = nn[:-1]
        nn2 = nn[1:]
        sd1 = _sf(np.std(nn2 - nn1, ddof=1) / math.sqrt(2))
        sd2 = _sf(np.std(nn2 + nn1, ddof=1) / math.sqrt(2))
        sd_ratio = _sf(sd1 / sd2) if sd2 > 0 else 0.0
        ellipse_area = _sf(math.pi * sd1 * sd2)

        # Sample entropy (m=2, r=0.2*SDNN)
        def _sampen(data, m=2, r_val=None):
            if r_val is None:
                r_val = 0.2 * np.std(data, ddof=1)
            N = len(data)
            if N < m + 2:
                return 0.0
            def _count(m_val):
                count = 0
                templates = np.array([data[i:i + m_val] for i in range(N - m_val)])
                for i in range(len(templates)):
                    for j in range(i + 1, len(templates)):
                        if np.max(np.abs(templates[i] - templates[j])) <= r_val:
                            count += 1
                return count
            A = _count(m + 1)
            B = _count(m)
            return -math.log(A / B) if B > 0 and A > 0 else 0.0

        sampen = _sf(_sampen(nn[:300]))

        # DFA
        def _dfa(data):
            N = len(data)
            n_max = min(N // 4, 64)
            y = np.cumsum(data - np.mean(data))
            scales = np.unique(np.logspace(np.log10(4), np.log10(max(n_max, 5)), 20).astype(int))
            scales = scales[scales >= 4]
            flucts = []
            for n in scales:
                n_seg = N // n
                if n_seg < 1:
                    continue
                rms_vals = []
                for seg in range(n_seg):
                    segment = y[seg * n:(seg + 1) * n]
                    x_ax = np.arange(n)
                    coeffs = np.polyfit(x_ax, segment, 1)
                    trend = np.polyval(coeffs, x_ax)
                    rms_vals.append(np.sqrt(np.mean((segment - trend) ** 2)))
                flucts.append(np.mean(rms_vals))
            flucts = np.array(flucts[:len(scales)])
            scales = scales[:len(flucts)]
            if len(scales) < 4:
                return 0.0, 0.0, [], []
            log_n = np.log10(scales.astype(float))
            log_f = np.log10(np.array(flucts) + 1e-15)
            mask1 = (scales >= 4) & (scales <= 16)
            alpha1 = _sf(np.polyfit(log_n[mask1], log_f[mask1], 1)[0]) if np.sum(mask1) >= 2 else 0.0
            mask2 = (scales >= 16) & (scales <= 64)
            alpha2 = _sf(np.polyfit(log_n[mask2], log_f[mask2], 1)[0]) if np.sum(mask2) >= 2 else 0.0
            return alpha1, alpha2, log_n.tolist(), log_f.tolist()

        alpha1, alpha2, dfa_log_n, dfa_log_f = _dfa(nn)

        nonlinear = {
            "SD1_ms": sd1, "SD2_ms": sd2, "SD1_SD2_ratio": sd_ratio,
            "ellipse_area": ellipse_area,
            "sample_entropy": sampen,
            "DFA_alpha1": alpha1, "DFA_alpha2": alpha2,
        }

        # Figures
        try:
            import matplotlib
            matplotlib.use("Agg")
            import matplotlib.pyplot as plt
            fig1, ax1 = plt.subplots(figsize=(10, 3))
            ax1.plot(np.cumsum(nn) / 1000 / 60, nn, "b-", linewidth=0.5)
            ax1.set_xlabel("Time (min)"); ax1.set_ylabel("RR (ms)"); ax1.set_title("RR Tachogram")
            figures.append(GeneratedFigure(title="RR Tachogram", format="svg", data=_fig_to_b64(fig1)))
            plt.close(fig1)

            fig2, ax2 = plt.subplots(figsize=(6, 6))
            ax2.scatter(nn1, nn2, s=5, alpha=0.5, c="steelblue")
            ax2.set_xlabel("RR_n (ms)"); ax2.set_ylabel("RR_{n+1} (ms)")
            ax2.set_title(f"Poincare (SD1={sd1:.1f}, SD2={sd2:.1f})")
            ax2.set_aspect("equal")
            figures.append(GeneratedFigure(title="Poincare Plot", format="svg", data=_fig_to_b64(fig2)))
            plt.close(fig2)

            fig3, ax3 = plt.subplots(figsize=(8, 4))
            ax3.semilogy(freqs, psd, "k-", linewidth=0.8)
            ax3.axvspan(0.003, 0.04, alpha=0.15, color="gray", label="VLF")
            ax3.axvspan(0.04, 0.15, alpha=0.15, color="blue", label="LF")
            ax3.axvspan(0.15, 0.4, alpha=0.15, color="red", label="HF")
            ax3.set_xlabel("Frequency (Hz)"); ax3.set_ylabel("PSD (ms^2/Hz)"); ax3.legend(); ax3.set_xlim(0, 0.5)
            figures.append(GeneratedFigure(title="PSD", format="svg", data=_fig_to_b64(fig3)))
            plt.close(fig3)
        except ImportError:
            pass

        return ComputeResult(
            request_id=request.id, domain=ComputeDomain.ELECTROPHYSIOLOGY,
            operation="hrv_analysis", status=ComputeStatus.COMPLETED,
            results={"time_domain": time_domain, "frequency_domain": frequency_domain, "nonlinear": nonlinear},
            figures=figures,
        )

    # ── 4. Windkessel Model ────────────────────────────────────────

    async def _windkessel_model(self, request: ComputeRequest, progress_callback) -> ComputeResult:
        p = request.parameters
        model_type = p.get("model_type", "3element")
        fs = float(p.get("sampling_rate", 100))
        figures = []
        pressure_data = np.asarray(p["aortic_pressure"], dtype=np.float64) if "aortic_pressure" in p else None
        flow_data = np.asarray(p["flow"], dtype=np.float64) if "flow" in p else None

        if pressure_data is None and flow_data is None:
            return ComputeResult(
                request_id=request.id, domain=ComputeDomain.ELECTROPHYSIOLOGY,
                operation="windkessel_model", status=ComputeStatus.FAILED,
                error="Provide aortic_pressure or flow waveform",
            )

        t = np.arange(len(pressure_data if pressure_data is not None else flow_data)) / fs

        if model_type == "2element":
            if flow_data is not None and pressure_data is not None:
                Q_interp = interpolate.interp1d(t, flow_data, fill_value="extrapolate")
                def cost_2e(params):
                    R, C = params
                    if R <= 0 or C <= 0: return 1e12
                    sol = integrate.solve_ivp(lambda tt, PP: (Q_interp(tt) - PP / R) / C,
                                               [t[0], t[-1]], [pressure_data[0]], t_eval=t, method="RK45")
                    return np.sum((sol.y[0] - pressure_data) ** 2) if sol.success else 1e12
                mean_p = np.mean(pressure_data)
                mean_q = max(np.mean(flow_data), 1e-6)
                res = optimize.minimize(cost_2e, [mean_p / mean_q, 1.0], method="Nelder-Mead")
                R_fit, C_fit = res.x
                sol = integrate.solve_ivp(lambda tt, PP: (Q_interp(tt) - PP / R_fit) / C_fit,
                                           [t[0], t[-1]], [pressure_data[0]], t_eval=t, method="RK45")
                fitted = sol.y[0].tolist()
                model_params = {"R_peripheral": _sf(R_fit), "C_arterial": _sf(C_fit)}
            else:
                model_params = {"info": "2-element requires both pressure and flow"}
                fitted = (pressure_data if pressure_data is not None else flow_data).tolist()

        elif model_type == "3element":
            if flow_data is not None and pressure_data is not None:
                Q_interp = interpolate.interp1d(t, flow_data, fill_value="extrapolate")
                def cost_3e(params):
                    Rc, Rp, C = params
                    if any(x <= 0 for x in params): return 1e12
                    sol = integrate.solve_ivp(lambda tt, Pd: (Q_interp(tt) - Pd / Rp) / C,
                                               [t[0], t[-1]], [pressure_data[0] * 0.8], t_eval=t, method="RK45")
                    if sol.success:
                        P_total = Rc * flow_data + sol.y[0]
                        return np.sum((P_total - pressure_data) ** 2)
                    return 1e12
                mean_p = np.mean(pressure_data)
                mean_q = max(np.mean(flow_data), 1e-6)
                Rp_init = mean_p / mean_q
                res = optimize.minimize(cost_3e, [Rp_init * 0.05, Rp_init * 0.95, 1.0], method="Nelder-Mead")
                Rc_fit, Rp_fit, C_fit = res.x
                sol = integrate.solve_ivp(lambda tt, Pd: (Q_interp(tt) - Pd / Rp_fit) / C_fit,
                                           [t[0], t[-1]], [pressure_data[0] * 0.8], t_eval=t, method="RK45")
                fitted = (Rc_fit * flow_data + sol.y[0]).tolist()
                model_params = {"Rc_characteristic": _sf(Rc_fit), "Rp_peripheral": _sf(Rp_fit), "C_arterial": _sf(C_fit)}
            else:
                model_params = {"info": "3-element requires both pressure and flow"}
                fitted = (pressure_data if pressure_data is not None else flow_data).tolist()

        elif model_type == "4element":
            if flow_data is not None and pressure_data is not None:
                Q_interp = interpolate.interp1d(t, flow_data, fill_value="extrapolate")
                def cost_4e(params):
                    Rc, Rp, C, L = params
                    if any(x <= 0 for x in params): return 1e12
                    try:
                        def ode_4e(tt, state):
                            Pd, Qm = state
                            Q = Q_interp(tt)
                            dPd = (Qm - Pd / Rp) / C
                            dQm = (Q - Qm) / max(L, 1e-6)
                            return [dPd, dQm]
                        sol = integrate.solve_ivp(ode_4e, [t[0], t[-1]],
                                                   [pressure_data[0] * 0.8, flow_data[0]], t_eval=t, method="RK45")
                        if sol.success:
                            P_total = Rc * sol.y[1] + sol.y[0]
                            return np.sum((P_total - pressure_data) ** 2)
                    except Exception:
                        pass
                    return 1e12
                mean_p = np.mean(pressure_data)
                mean_q = max(np.mean(flow_data), 1e-6)
                Rp_init = mean_p / mean_q
                res = optimize.minimize(cost_4e, [Rp_init * 0.05, Rp_init * 0.95, 1.0, 0.01], method="Nelder-Mead")
                model_params = {"Rc": _sf(res.x[0]), "Rp": _sf(res.x[1]), "C": _sf(res.x[2]), "L": _sf(res.x[3])}
                fitted = pressure_data.tolist()
            else:
                model_params = {"info": "4-element requires both pressure and flow"}
                fitted = (pressure_data if pressure_data is not None else flow_data).tolist()
        else:
            return ComputeResult(
                request_id=request.id, domain=ComputeDomain.ELECTROPHYSIOLOGY,
                operation="windkessel_model", status=ComputeStatus.FAILED,
                error=f"Unknown model_type: {model_type}",
            )

        hemodynamic = {}
        if pressure_data is not None:
            hemodynamic = {"systolic": _sf(np.max(pressure_data)), "diastolic": _sf(np.min(pressure_data)),
                           "MAP": _sf(np.min(pressure_data) + np.ptp(pressure_data) / 3),
                           "pulse_pressure": _sf(np.ptp(pressure_data))}

        try:
            import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
            fig, ax = plt.subplots(figsize=(10, 4))
            if pressure_data is not None: ax.plot(t, pressure_data, "b-", label="Measured")
            ax.plot(t, fitted[:len(t)], "r--", label=f"Fitted ({model_type})")
            ax.set_xlabel("Time (s)"); ax.set_ylabel("Pressure"); ax.set_title(f"Windkessel {model_type}"); ax.legend()
            figures.append(GeneratedFigure(title="Windkessel Fit", format="svg", data=_fig_to_b64(fig)))
            plt.close(fig)
        except ImportError:
            pass

        return ComputeResult(
            request_id=request.id, domain=ComputeDomain.ELECTROPHYSIOLOGY,
            operation="windkessel_model", status=ComputeStatus.COMPLETED,
            results={"model_type": model_type, "model_parameters": model_params,
                     "hemodynamic_indices": hemodynamic, "fitted_pressure": fitted[:200]},
            figures=figures,
        )

    # ── 5. Arrhythmia Classification ──────────────────────────────

    async def _arrhythmia_classification(self, request: ComputeRequest, progress_callback) -> ComputeResult:
        p = request.parameters
        ecg = np.asarray(p["ecg_signal"], dtype=np.float64)
        fs = float(p.get("sampling_rate", 500))

        req_pt = ComputeRequest(domain=ComputeDomain.ELECTROPHYSIOLOGY, operation="pan_tompkins_qrs",
                                 parameters={"ecg_signal": ecg.tolist(), "sampling_rate": fs})
        pt_result = await self._pan_tompkins_qrs(req_pt, None)
        qrs_indices = np.asarray(pt_result.results.get("qrs_indices", []), dtype=int)
        rr_intervals = np.asarray(pt_result.results.get("rr_intervals_ms", []))

        if len(qrs_indices) < 3:
            return ComputeResult(request_id=request.id, domain=ComputeDomain.ELECTROPHYSIOLOGY,
                                  operation="arrhythmia_classification", status=ComputeStatus.FAILED,
                                  error="Need at least 3 QRS complexes")

        mean_hr = 60000.0 / np.mean(rr_intervals) if len(rr_intervals) > 0 else 0.0
        rr_cv = np.std(rr_intervals, ddof=1) / np.mean(rr_intervals) if np.mean(rr_intervals) > 0 else 0.0
        rr_regularity = 1.0 - min(rr_cv, 1.0)

        # QRS width estimation
        qrs_widths = []
        for r_idx in qrs_indices:
            r_idx = int(r_idx)
            window = int(0.15 * fs)
            start, end = max(0, r_idx - window), min(len(ecg), r_idx + window)
            seg = ecg[start:end]
            half_amp = ecg[r_idx] * 0.5
            above = np.where(seg > half_amp)[0]
            qrs_widths.append((above[-1] - above[0]) / fs * 1000 if len(above) > 1 else 80.0)
        mean_qrs_width = np.mean(qrs_widths) if qrs_widths else 80.0

        # P wave presence (simplified)
        p_wave_count = 0
        mean_amp = np.mean([abs(ecg[int(r)]) for r in qrs_indices])
        for r_idx in qrs_indices:
            r_idx = int(r_idx)
            ps, pe = max(0, r_idx - int(0.3 * fs)), max(0, r_idx - int(0.05 * fs))
            if pe > ps + 10:
                seg = ecg[ps:pe]
                nyq = fs / 2
                b, a = sp_signal.butter(2, min(15 / nyq, 0.99), btype="low")
                try:
                    sm = sp_signal.filtfilt(b, a, seg)
                    pks, _ = sp_signal.find_peaks(sm, prominence=0.02 * mean_amp)
                    if len(pks) > 0: p_wave_count += 1
                except Exception: pass
        p_wave_ratio = p_wave_count / len(qrs_indices)

        # Compensatory pauses (PVC)
        comp_pauses = 0
        if len(rr_intervals) > 2:
            med_rr = np.median(rr_intervals)
            for i in range(1, len(rr_intervals)):
                if rr_intervals[i] > 1.5 * med_rr and rr_intervals[i - 1] < 0.8 * med_rr:
                    comp_pauses += 1

        features = {"mean_HR_bpm": _sf(mean_hr), "rr_CV": _sf(rr_cv), "regularity": _sf(rr_regularity),
                     "mean_QRS_width_ms": _sf(mean_qrs_width), "p_wave_ratio": _sf(p_wave_ratio),
                     "compensatory_pauses": comp_pauses}

        # Rule-based classification
        cls = {}
        if 60 <= mean_hr <= 100 and rr_regularity > 0.85 and p_wave_ratio > 0.7 and mean_qrs_width < 120:
            cls["normal_sinus_rhythm"] = min(rr_regularity * p_wave_ratio, 1.0)
        if mean_hr < 60 and rr_regularity > 0.80 and p_wave_ratio > 0.7:
            cls["sinus_bradycardia"] = _sf(min((60 - mean_hr) / 60 * rr_regularity + 0.3, 1.0))
        if mean_hr > 100 and rr_regularity > 0.80 and p_wave_ratio > 0.7:
            cls["sinus_tachycardia"] = _sf(min((mean_hr - 100) / 100 * rr_regularity + 0.3, 1.0))
        if rr_regularity < 0.70 and p_wave_ratio < 0.4:
            cls["atrial_fibrillation"] = _sf(min((1 - rr_regularity) * (1 - p_wave_ratio) + 0.2, 1.0))
        if comp_pauses > 0 and mean_qrs_width > 120:
            cls["PVC"] = _sf(min(comp_pauses / max(len(qrs_indices), 1) * 5 + 0.3, 1.0))
        if mean_qrs_width > 120 and mean_hr > 100:
            cls["ventricular_tachycardia"] = _sf(min((mean_qrs_width - 120) / 80 + (mean_hr - 100) / 100, 1.0))
        if not cls:
            cls["unclassified"] = 0.5

        primary = max(cls, key=cls.get)
        return ComputeResult(
            request_id=request.id, domain=ComputeDomain.ELECTROPHYSIOLOGY,
            operation="arrhythmia_classification", status=ComputeStatus.COMPLETED,
            results={"classification": primary, "confidence": _sf(cls[primary]),
                     "all_classifications": {k: _sf(v) for k, v in sorted(cls.items(), key=lambda x: -x[1])},
                     "features": features},
        )

    # ── 6. Pulse Wave Analysis ─────────────────────────────────────

    async def _pulse_wave_analysis(self, request: ComputeRequest, progress_callback) -> ComputeResult:
        p = request.parameters
        waveform = np.asarray(p["pressure_waveform"], dtype=np.float64)
        fs = float(p.get("sampling_rate", 100))
        figures = []
        t = np.arange(len(waveform)) / fs

        nyq = fs / 2.0
        if fs > 10:
            b, a = sp_signal.butter(4, min(20 / nyq, 0.99), btype="low")
            wf_s = sp_signal.filtfilt(b, a, waveform)
        else:
            wf_s = waveform

        peaks, _ = sp_signal.find_peaks(wf_s, distance=int(0.4 * fs), prominence=0.1 * np.ptp(wf_s))
        troughs, _ = sp_signal.find_peaks(-wf_s, distance=int(0.4 * fs))

        if len(peaks) < 2:
            return ComputeResult(request_id=request.id, domain=ComputeDomain.ELECTROPHYSIOLOGY,
                                  operation="pulse_wave_analysis", status=ComputeStatus.FAILED,
                                  error="Could not detect sufficient pulse waves")

        sys_p = _sf(np.mean(waveform[peaks]))
        dia_p = _sf(np.mean(waveform[troughs])) if len(troughs) > 0 else _sf(np.min(waveform))

        # Dicrotic notch and augmentation index
        notch_indices = []
        aix_values = []
        for i in range(len(peaks) - 1):
            desc = wf_s[peaks[i]:peaks[i + 1]]
            if len(desc) < 10: continue
            local_mins, _ = sp_signal.find_peaks(-desc[1:-1])
            if len(local_mins) > 0:
                notch = peaks[i] + local_mins[0] + 1
                notch_indices.append(int(notch))
                aix = (waveform[peaks[i]] - waveform[notch]) / (sys_p - dia_p) * 100 if (sys_p - dia_p) > 0 else 0
                aix_values.append(_sf(aix))

        mean_aix = _sf(np.mean(aix_values)) if aix_values else 0.0

        # SEVR (Buckberg ratio)
        sevr_vals = []
        for i in range(min(len(peaks) - 1, len(notch_indices))):
            sys_area = np.trapz(waveform[peaks[i]:notch_indices[i]])
            dia_area = np.trapz(waveform[notch_indices[i]:peaks[i + 1]])
            if sys_area > 0: sevr_vals.append(dia_area / sys_area)
        sevr = _sf(np.mean(sevr_vals)) if sevr_vals else 0.0

        # PWV if two-site data
        pwv = None
        if "distal_waveform" in p and "distance_m" in p:
            distal = np.asarray(p["distal_waveform"], dtype=np.float64)
            d_prox = np.diff(wf_s); d_dist = np.diff(distal)
            prox_foot = np.argmax(d_prox[:len(d_prox)//2])
            dist_foot = np.argmax(d_dist[:len(d_dist)//2])
            tt = (dist_foot - prox_foot) / fs
            if tt > 0: pwv = _sf(float(p["distance_m"]) / tt)

        indices = {"systolic": sys_p, "diastolic": dia_p, "pulse_pressure": _sf(sys_p - dia_p),
                    "AIx_percent": mean_aix, "SEVR": sevr, "n_pulses": len(peaks)}
        if pwv is not None: indices["PWV_m_s"] = pwv

        try:
            import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
            fig, ax = plt.subplots(figsize=(10, 4))
            ax.plot(t, waveform, "b-", linewidth=0.8)
            ax.plot(t[peaks], waveform[peaks], "rv", markersize=6, label="Systolic")
            if len(troughs) > 0: ax.plot(t[troughs], waveform[troughs], "g^", markersize=6, label="Diastolic")
            for dn in notch_indices: ax.plot(t[dn], waveform[dn], "ko", markersize=4)
            ax.set_xlabel("Time (s)"); ax.set_ylabel("Pressure"); ax.set_title(f"Pulse Wave (AIx={mean_aix:.1f}%)")
            ax.legend()
            figures.append(GeneratedFigure(title="Pulse Wave Analysis", format="svg", data=_fig_to_b64(fig)))
            plt.close(fig)
        except ImportError: pass

        return ComputeResult(
            request_id=request.id, domain=ComputeDomain.ELECTROPHYSIOLOGY,
            operation="pulse_wave_analysis", status=ComputeStatus.COMPLETED,
            results={"indices": indices, "dicrotic_notches": notch_indices},
            figures=figures,
        )

    # ── 7. Cardiac Output ──────────────────────────────────────────

    async def _cardiac_output(self, request: ComputeRequest, progress_callback) -> ComputeResult:
        p = request.parameters
        method = p.get("method", "fick")

        if method == "fick":
            vo2 = float(p.get("vo2_ml_min", 250))
            cao2 = float(p.get("cao2_ml_dl", 20))
            cvo2 = float(p.get("cvo2_ml_dl", 15))
            avdiff = cao2 - cvo2
            if avdiff <= 0:
                return ComputeResult(request_id=request.id, domain=ComputeDomain.ELECTROPHYSIOLOGY,
                                      operation="cardiac_output", status=ComputeStatus.FAILED,
                                      error="CaO2 must be > CvO2")
            co = vo2 / (avdiff * 10)
            bsa = float(p.get("bsa_m2", 1.73))
            ci = co / bsa
            hr = float(p.get("heart_rate", 70))
            sv = co * 1000 / hr
            results = {"method": "fick", "cardiac_output_L_min": _sf(co), "cardiac_index_L_min_m2": _sf(ci),
                        "stroke_volume_mL": _sf(sv), "av_o2_diff": _sf(avdiff)}

        elif method == "thermodilution":
            vi = float(p.get("injectate_volume_ml", 10))
            tb = float(p.get("blood_temperature_c", 37))
            ti = float(p.get("injectate_temperature_c", 0))
            k = float(p.get("correction_factor", 1.08))
            if "temperature_curve" in p:
                tc = np.asarray(p["temperature_curve"], dtype=np.float64)
                fs_t = float(p.get("sampling_rate", 10))
                area = np.trapz(tc, dx=1.0/fs_t)
            else:
                area = float(p.get("curve_area", 1.0))
            co = vi * (tb - ti) * k / max(area, 1e-6) / 60.0
            bsa = float(p.get("bsa_m2", 1.73))
            results = {"method": "thermodilution", "cardiac_output_L_min": _sf(co),
                        "cardiac_index_L_min_m2": _sf(co / bsa),
                        "stroke_volume_mL": _sf(co * 1000 / float(p.get("heart_rate", 70)))}

        elif method == "pulse_contour":
            pressure = np.asarray(p["pressure_waveform"], dtype=np.float64)
            fs = float(p.get("sampling_rate", 100))
            hr = float(p.get("heart_rate", 70))
            cal = float(p.get("calibration_factor", 1.0))
            nyq = fs / 2.0
            b, a = sp_signal.butter(4, min(20 / nyq, 0.99), btype="low")
            ps = sp_signal.filtfilt(b, a, pressure)
            peaks, _ = sp_signal.find_peaks(ps, distance=int(0.4 * fs))
            if len(peaks) < 2:
                return ComputeResult(request_id=request.id, domain=ComputeDomain.ELECTROPHYSIOLOGY,
                                      operation="cardiac_output", status=ComputeStatus.FAILED,
                                      error="Insufficient pulses detected")
            sys_areas = []
            for pk in peaks:
                ss = max(0, pk - int(0.5 * fs))
                trough = ss + np.argmin(ps[ss:pk])
                sys_areas.append(np.trapz(pressure[trough:pk] - pressure[trough]) / fs)
            sv = np.mean(sys_areas) * cal
            co = sv * hr / 1000.0
            bsa = float(p.get("bsa_m2", 1.73))
            results = {"method": "pulse_contour", "cardiac_output_L_min": _sf(co),
                        "cardiac_index_L_min_m2": _sf(co / bsa), "stroke_volume_mL": _sf(sv)}
        else:
            return ComputeResult(request_id=request.id, domain=ComputeDomain.ELECTROPHYSIOLOGY,
                                  operation="cardiac_output", status=ComputeStatus.FAILED,
                                  error=f"Unknown method: {method}")

        # SVR if MAP available
        map_val = float(p.get("mean_arterial_pressure", 0))
        cvp = float(p.get("central_venous_pressure", 0))
        co_val = results.get("cardiac_output_L_min", 0)
        if co_val > 0 and map_val > 0:
            results["SVR_dynes_s_cm5"] = _sf((map_val - cvp) * 80 / co_val)

        return ComputeResult(
            request_id=request.id, domain=ComputeDomain.ELECTROPHYSIOLOGY,
            operation="cardiac_output", status=ComputeStatus.COMPLETED,
            results=results,
        )
