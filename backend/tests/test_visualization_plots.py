"""
Unit tests for app.compute.visualization.plots.PlotGenerator.

Every plot method exercises at least two paths: a data-present happy
path that asserts a real PNG was produced, and an empty-data path that
asserts the "No data" fallback renders without raising. We never
inspect the pixels — checking the PNG magic bytes and the metadata
fields is enough to catch the regressions we actually see in prod
(matplotlib version drift, figsize math, mask mishaps).
"""
from __future__ import annotations

import base64

import numpy as np
import pytest

from app.compute.types import FigureFormat
from app.compute.visualization.plots import PlotGenerator


PNG_MAGIC = b"\x89PNG\r\n\x1a\n"


def _assert_png(fig, title: str | None = None) -> None:
    # Core contract: every figure comes back as a base64-encoded PNG
    # with a non-zero canvas and the same title we passed in.
    assert fig.format == FigureFormat.PNG
    assert fig.data_base64 is not None and len(fig.data_base64) > 100
    assert fig.width > 0 and fig.height > 0
    if title is not None:
        assert fig.title == title
    raw = base64.b64decode(fig.data_base64)
    assert raw.startswith(PNG_MAGIC)


# ── time_series ────────────────────────────────────────────────────────


def test_time_series_single_trace_renders_png() -> None:
    data = np.sin(np.linspace(0, 2 * np.pi, 200))
    fig = PlotGenerator.time_series(data, sampling_rate=100.0, title="sine")
    _assert_png(fig, title="sine")


def test_time_series_multi_trace_with_labels() -> None:
    a = np.sin(np.linspace(0, 2 * np.pi, 100))
    b = np.cos(np.linspace(0, 2 * np.pi, 100))
    fig = PlotGenerator.time_series(
        np.vstack([a, b]),
        sampling_rate=50.0,
        labels=["sin", "cos"],
        title="trig",
    )
    _assert_png(fig, title="trig")


def test_time_series_empty_renders_no_data_fallback() -> None:
    # Empty list → "No data" placeholder, not a crash.
    fig = PlotGenerator.time_series([], title="empty")
    _assert_png(fig, title="empty")


# ── histogram ──────────────────────────────────────────────────────────


def test_histogram_with_kde() -> None:
    rng = np.random.default_rng(0)
    data = rng.standard_normal(500)
    fig = PlotGenerator.histogram(data, bins=30, title="normal", kde=True)
    _assert_png(fig, title="normal")


def test_histogram_drops_nans_silently() -> None:
    # Mixed NaNs should be filtered, not propagated into the render.
    data = np.array([1.0, np.nan, 2.0, 3.0, np.nan, 4.0])
    fig = PlotGenerator.histogram(data, bins=5, title="with-nans")
    _assert_png(fig, title="with-nans")


def test_histogram_empty_after_nan_strip() -> None:
    fig = PlotGenerator.histogram(np.array([np.nan, np.nan]), title="all-nan")
    _assert_png(fig, title="all-nan")


# ── scatter ────────────────────────────────────────────────────────────


def test_scatter_with_regression_line() -> None:
    x = np.linspace(0, 10, 50)
    y = 2 * x + 1 + np.random.default_rng(42).normal(0, 0.1, 50)
    fig = PlotGenerator.scatter(x, y, regression_line=True, title="y=2x+1")
    _assert_png(fig, title="y=2x+1")


def test_scatter_drops_nan_pairs() -> None:
    # Any row with a NaN in either axis must be dropped pairwise.
    x = np.array([1.0, 2.0, np.nan, 4.0])
    y = np.array([1.0, np.nan, 3.0, 4.0])
    fig = PlotGenerator.scatter(x, y, title="nan-pairs")
    _assert_png(fig, title="nan-pairs")


# ── heatmap ────────────────────────────────────────────────────────────


def test_heatmap_small_annotates() -> None:
    m = np.arange(16, dtype=float).reshape(4, 4)
    fig = PlotGenerator.heatmap(m, title="4x4")
    _assert_png(fig, title="4x4")


def test_heatmap_large_skips_annotations() -> None:
    # >20×20 should disable per-cell text; verifying render still works.
    m = np.random.default_rng(0).standard_normal((25, 25))
    fig = PlotGenerator.heatmap(m, annotate=True, title="25x25")
    _assert_png(fig, title="25x25")


def test_heatmap_empty() -> None:
    fig = PlotGenerator.heatmap(np.array([]).reshape(0, 0), title="empty")
    _assert_png(fig, title="empty")


# ── volcano_plot ───────────────────────────────────────────────────────


def test_volcano_plot_classifies_genes() -> None:
    # Mix of up, down, and NS by construction.
    log2fc = np.array([2.0, -2.0, 0.2, 3.0, -0.1])
    neg_log10p = np.array([4.0, 5.0, 0.5, 6.0, 0.3])
    fig = PlotGenerator.volcano_plot(
        log2fc, neg_log10p,
        gene_names=["G1", "G2", "G3", "G4", "G5"],
        fc_threshold=1.0, p_threshold=0.05,
        title="volcano",
    )
    _assert_png(fig, title="volcano")


# ── survival_curve ─────────────────────────────────────────────────────


def test_survival_curve_with_ci_bands() -> None:
    t = np.linspace(0, 100, 20)
    s1 = np.clip(1 - t / 120, 0, 1)
    s2 = np.clip(1 - t / 80, 0, 1)
    lo1, hi1 = np.maximum(s1 - 0.05, 0), np.minimum(s1 + 0.05, 1)
    lo2, hi2 = np.maximum(s2 - 0.05, 0), np.minimum(s2 + 0.05, 1)
    fig = PlotGenerator.survival_curve(
        [t, t], [s1, s2], [lo1, lo2], [hi1, hi2],
        group_labels=["Control", "Treatment"], title="KM",
    )
    _assert_png(fig, title="KM")


def test_survival_curve_empty_is_fallback() -> None:
    fig = PlotGenerator.survival_curve([], [], title="empty-km")
    _assert_png(fig, title="empty-km")


# ── spectrogram + psd ──────────────────────────────────────────────────


def test_spectrogram_plot_db_scale() -> None:
    times = np.linspace(0, 1, 50)
    freqs = np.linspace(1, 50, 30)
    power = np.random.default_rng(0).random((30, 50)) + 1e-3
    fig = PlotGenerator.spectrogram_plot(times, freqs, power, title="spec")
    _assert_png(fig, title="spec")


def test_psd_plot_with_eeg_bands() -> None:
    freqs = np.linspace(0.5, 50, 500)
    power = 1.0 / (freqs + 1)  # 1/f-ish
    bands = {
        "delta": (0.5, 4.0),
        "theta": (4.0, 8.0),
        "alpha": (8.0, 13.0),
        "beta": (13.0, 30.0),
    }
    fig = PlotGenerator.psd_plot(freqs, power, bands=bands, title="psd")
    _assert_png(fig, title="psd")


# ── pk_curve ───────────────────────────────────────────────────────────


def test_pk_curve_with_therapeutic_window() -> None:
    t = np.linspace(0, 24, 100)
    c = 10 * np.exp(-0.1 * t)
    fig = PlotGenerator.pk_curve(
        t, c,
        dose_times=[0, 8, 16],
        therapeutic_min=2.0, therapeutic_max=15.0,
        title="pk",
    )
    _assert_png(fig, title="pk")


# ── joint angle / forest / correlation / box / bar ─────────────────────


def test_joint_angle_curve_multi_trace() -> None:
    gait = np.linspace(0, 100, 100)
    knee = 30 * np.sin(np.linspace(0, 2 * np.pi, 100))
    hip = 20 * np.cos(np.linspace(0, 2 * np.pi, 100))
    fig = PlotGenerator.joint_angle_curve(
        gait, np.vstack([knee, hip]), title="gait",
    )
    _assert_png(fig, title="gait")


def test_forest_plot_shows_effects() -> None:
    effects = [0.3, -0.1, 0.7, 0.0]
    lo = [0.1, -0.3, 0.4, -0.2]
    hi = [0.5, 0.1, 1.0, 0.2]
    labels = ["Trial 1", "Trial 2", "Trial 3", "Trial 4"]
    fig = PlotGenerator.forest_plot(effects, lo, hi, labels, title="forest")
    _assert_png(fig, title="forest")


def test_correlation_matrix_lower_triangle() -> None:
    # Masking the upper triangle used to blow up when matrix was a MaskedArray
    # subclass — this smoke test catches regressions in that code path.
    rng = np.random.default_rng(0)
    m = rng.standard_normal((5, 5))
    m = (m + m.T) / 2
    np.fill_diagonal(m, 1.0)
    fig = PlotGenerator.correlation_matrix(m, labels=list("abcde"), title="corr")
    _assert_png(fig, title="corr")


def test_box_plot_with_jitter() -> None:
    rng = np.random.default_rng(0)
    groups = [rng.standard_normal(30), rng.standard_normal(30) + 1.0]
    fig = PlotGenerator.box_plot(groups, ["A", "B"], title="box")
    _assert_png(fig, title="box")


def test_bar_chart_with_errorbars() -> None:
    fig = PlotGenerator.bar_chart(
        ["Alpha", "Beta", "Gamma"],
        [1.0, 2.0, 1.5],
        errors=[0.1, 0.2, 0.05],
        title="bars",
    )
    _assert_png(fig, title="bars")


def test_bar_chart_empty() -> None:
    fig = PlotGenerator.bar_chart([], [], title="empty-bars")
    _assert_png(fig, title="empty-bars")
