"""
Unit tests for app.compute.signals.processor.SignalProcessor.

Tests operate on synthesized signals with known spectral content so
expected outputs (peak count, dominant frequency, band power) are
deterministic. Cardiovascular operations are not exercised here —
they're covered by integration tests with recorded waveforms.
"""
from __future__ import annotations

from typing import Any

import numpy as np
import pytest

from app.compute.signals.processor import SignalProcessor
from app.compute.types import ComputeDomain, ComputeRequest, ComputeStatus


def _req(op: str, **params: Any) -> ComputeRequest:
    return ComputeRequest(
        domain=ComputeDomain.ELECTROPHYSIOLOGY,
        operation=op,
        parameters=params,
    )


@pytest.fixture
def proc() -> SignalProcessor:
    return SignalProcessor()


def _sine(freq_hz: float, fs: float, duration_s: float, amp: float = 1.0) -> np.ndarray:
    t = np.arange(0, duration_s, 1.0 / fs)
    return amp * np.sin(2 * np.pi * freq_hz * t)


# ── compute_psd ────────────────────────────────────────────────────────


async def test_compute_psd_finds_dominant_frequency(proc: SignalProcessor) -> None:
    fs = 500.0
    sig = _sine(10.0, fs, 4.0)  # 10 Hz sine = strong alpha-band peak

    result = await proc.execute(
        _req("compute_psd", signal=sig.tolist(), sampling_rate=fs, method="welch")
    )
    assert result.status is ComputeStatus.COMPLETED
    dom = result.results["dominant_frequency_hz"]
    # Welch w/ default nperseg=256 → ~2 Hz resolution; 10 Hz should be spot-on.
    assert abs(dom - 10.0) < 2.0
    # Alpha band (8-13 Hz) should carry most of the power.
    bands = result.results["band_powers"]
    assert bands["alpha"] > bands["delta"]
    assert bands["alpha"] > bands["gamma"]


async def test_compute_psd_unknown_method_fails(proc: SignalProcessor) -> None:
    fs = 250.0
    sig = _sine(5.0, fs, 2.0)
    result = await proc.execute(
        _req("compute_psd", signal=sig.tolist(), sampling_rate=fs, method="mystery")
    )
    assert result.status is ComputeStatus.FAILED
    assert "Unknown PSD method" in (result.error or "")


# ── bandpass_filter ────────────────────────────────────────────────────


async def test_bandpass_filter_removes_out_of_band_energy(proc: SignalProcessor) -> None:
    fs = 500.0
    in_band = _sine(10.0, fs, 4.0)
    out_band = _sine(80.0, fs, 4.0)
    mixed = (in_band + out_band).tolist()

    result = await proc.execute(
        _req(
            "bandpass_filter",
            signal=mixed,
            sampling_rate=fs,
            filter_type="bandpass",
            low_freq=5.0,
            high_freq=20.0,
            order=4,
        )
    )
    assert result.status is ComputeStatus.COMPLETED
    filtered = np.array(result.results["filtered_signal"])
    # Filtered signal should be close to the in-band sine alone.
    in_arr = np.array(in_band)
    # Strong correlation, and low correlation with the out-of-band tone.
    corr_in = np.corrcoef(filtered, in_arr)[0, 1]
    corr_out = np.corrcoef(filtered, out_band)[0, 1]
    assert corr_in > 0.9
    assert abs(corr_out) < 0.3


async def test_bandpass_filter_requires_both_cutoffs(proc: SignalProcessor) -> None:
    fs = 250.0
    sig = _sine(10.0, fs, 2.0).tolist()
    # Missing high_freq → should fail fast.
    result = await proc.execute(
        _req("bandpass_filter", signal=sig, sampling_rate=fs, filter_type="bandpass", low_freq=5.0)
    )
    assert result.status is ComputeStatus.FAILED


# ── detect_peaks ───────────────────────────────────────────────────────


async def test_detect_peaks_counts_sine_peaks(proc: SignalProcessor) -> None:
    fs = 500.0
    # 2 Hz sine over 5 seconds → 10 peaks expected.
    sig = _sine(2.0, fs, 5.0)

    result = await proc.execute(
        _req(
            "detect_peaks",
            signal=sig.tolist(),
            sampling_rate=fs,
            method="threshold",
            min_distance_ms=200,
        )
    )
    assert result.status is ComputeStatus.COMPLETED
    n_peaks = result.results["n_peaks"]
    # Allow ±1 due to boundary effects.
    assert 9 <= n_peaks <= 11


# ── dispatcher error path ──────────────────────────────────────────────


async def test_unknown_signals_op_is_failed(proc: SignalProcessor) -> None:
    result = await proc.execute(_req("not_a_real_signal_op"))
    assert result.status is ComputeStatus.FAILED
    assert "Unknown operation" in (result.error or "")
