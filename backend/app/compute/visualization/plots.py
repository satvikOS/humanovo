"""
Publication-quality figure generation module.

Provides a PlotGenerator class with static methods for producing
server-side matplotlib figures across all supported biomedical domains.
Each method returns a GeneratedFigure ready for API serialisation.
"""

from __future__ import annotations

from typing import Any, Sequence

import matplotlib
matplotlib.use("Agg")

import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402

from app.compute.types import FigureFormat, GeneratedFigure  # noqa: E402


class PlotGenerator:
    """Static helpers that produce publication-ready matplotlib figures."""

    # ── Style ───────────────────────────────────────────────────────

    @staticmethod
    def configure_style() -> None:
        """Set matplotlib rcParams for publication-quality output."""
        plt.rcParams.update({
            "font.family": "serif",
            "font.size": 10,
            "figure.facecolor": "white",
            "axes.facecolor": "white",
            "savefig.facecolor": "white",
            "figure.autolayout": True,
            "savefig.dpi": 150,
            "figure.dpi": 150,
            "axes.grid": True,
            "grid.alpha": 0.3,
            "grid.linestyle": "--",
            "grid.linewidth": 0.5,
        })

    # ── Helpers ─────────────────────────────────────────────────────

    @staticmethod
    def _finalise(fig: matplotlib.figure.Figure, title: str) -> GeneratedFigure:
        """Convert a matplotlib figure to GeneratedFigure and close it."""
        result = GeneratedFigure.from_matplotlib(fig, title)
        plt.close(fig)
        return result

    # ── 1. Time Series ──────────────────────────────────────────────

    @staticmethod
    def time_series(
        data: np.ndarray | Sequence[np.ndarray],
        sampling_rate: float | None = None,
        times: np.ndarray | None = None,
        labels: list[str] | None = None,
        title: str = "",
        xlabel: str = "Time",
        ylabel: str = "Amplitude",
        figsize: tuple[float, float] = (10, 4),
    ) -> GeneratedFigure:
        """Plot one or more time-series traces."""
        PlotGenerator.configure_style()
        fig, ax = plt.subplots(figsize=figsize)

        # Normalise to list of arrays
        if isinstance(data, np.ndarray) and data.ndim == 1:
            traces = [data]
        elif isinstance(data, np.ndarray) and data.ndim == 2:
            traces = [data[i] for i in range(data.shape[0])]
        else:
            traces = list(data)

        if not traces or all(len(t) == 0 for t in traces):
            ax.text(0.5, 0.5, "No data", ha="center", va="center", transform=ax.transAxes)
            ax.set_title(title)
            return PlotGenerator._finalise(fig, title)

        for idx, trace in enumerate(traces):
            n = len(trace)
            if times is not None:
                t = times[:n]
            elif sampling_rate is not None and sampling_rate > 0:
                t = np.arange(n) / sampling_rate
            else:
                t = np.arange(n)
            label = labels[idx] if labels and idx < len(labels) else f"Trace {idx + 1}"
            ax.plot(t, trace, linewidth=0.8, label=label)

        ax.set_xlabel(xlabel)
        ax.set_ylabel(ylabel)
        ax.set_title(title)
        if len(traces) > 1 or labels:
            ax.legend(fontsize=8)

        return PlotGenerator._finalise(fig, title)

    # ── 2. Histogram ────────────────────────────────────────────────

    @staticmethod
    def histogram(
        data: np.ndarray,
        bins: int = 50,
        title: str = "",
        xlabel: str = "",
        ylabel: str = "Count",
        density: bool = False,
        kde: bool = True,
        figsize: tuple[float, float] = (8, 5),
    ) -> GeneratedFigure:
        """Histogram with optional KDE overlay and mean/median lines."""
        PlotGenerator.configure_style()
        fig, ax = plt.subplots(figsize=figsize)

        data = np.asarray(data, dtype=float)
        data = data[~np.isnan(data)]

        if len(data) == 0:
            ax.text(0.5, 0.5, "No data", ha="center", va="center", transform=ax.transAxes)
            ax.set_title(title)
            return PlotGenerator._finalise(fig, title)

        ax.hist(data, bins=bins, density=density, alpha=0.7, edgecolor="black", linewidth=0.5)

        # Mean / median
        mean_val = float(np.mean(data))
        median_val = float(np.median(data))
        ymin, ymax = ax.get_ylim()
        ax.axvline(mean_val, color="red", linestyle="--", linewidth=1, label=f"Mean = {mean_val:.3g}")
        ax.axvline(median_val, color="orange", linestyle="-.", linewidth=1, label=f"Median = {median_val:.3g}")

        # KDE overlay
        if kde and len(data) > 1:
            try:
                from scipy.stats import gaussian_kde

                xs = np.linspace(float(data.min()), float(data.max()), 300)
                kernel = gaussian_kde(data)
                kde_vals = kernel(xs)
                if not density:
                    bin_width = (data.max() - data.min()) / bins
                    kde_vals = kde_vals * len(data) * bin_width
                ax.plot(xs, kde_vals, color="darkblue", linewidth=1.5, label="KDE")
            except Exception:
                pass

        ax.set_xlabel(xlabel)
        ax.set_ylabel(ylabel)
        ax.set_title(title)
        ax.legend(fontsize=8)

        return PlotGenerator._finalise(fig, title)

    # ── 3. Scatter ──────────────────────────────────────────────────

    @staticmethod
    def scatter(
        x: np.ndarray,
        y: np.ndarray,
        title: str = "",
        xlabel: str = "",
        ylabel: str = "",
        regression_line: bool = False,
        figsize: tuple[float, float] = (8, 6),
    ) -> GeneratedFigure:
        """Scatter plot with optional OLS regression line, equation, and R²."""
        PlotGenerator.configure_style()
        fig, ax = plt.subplots(figsize=figsize)

        x = np.asarray(x, dtype=float)
        y = np.asarray(y, dtype=float)

        # Remove NaNs pairwise
        mask = ~(np.isnan(x) | np.isnan(y))
        x, y = x[mask], y[mask]

        if len(x) == 0:
            ax.text(0.5, 0.5, "No data", ha="center", va="center", transform=ax.transAxes)
            ax.set_title(title)
            return PlotGenerator._finalise(fig, title)

        ax.scatter(x, y, s=20, alpha=0.6, edgecolors="none")

        if regression_line and len(x) > 1:
            coeffs = np.polyfit(x, y, 1)
            poly = np.poly1d(coeffs)
            xs = np.linspace(float(x.min()), float(x.max()), 100)
            ax.plot(xs, poly(xs), color="red", linewidth=1.5)

            # R²
            ss_res = np.sum((y - poly(x)) ** 2)
            ss_tot = np.sum((y - np.mean(y)) ** 2)
            r2 = 1 - ss_res / ss_tot if ss_tot > 0 else 0.0
            eq_text = f"y = {coeffs[0]:.3g}x + {coeffs[1]:.3g}\nR² = {r2:.4f}"
            ax.text(
                0.05, 0.95, eq_text, transform=ax.transAxes,
                fontsize=9, verticalalignment="top",
                bbox=dict(boxstyle="round,pad=0.3", facecolor="white", alpha=0.8),
            )

        ax.set_xlabel(xlabel)
        ax.set_ylabel(ylabel)
        ax.set_title(title)

        return PlotGenerator._finalise(fig, title)

    # ── 4. Heatmap ──────────────────────────────────────────────────

    @staticmethod
    def heatmap(
        matrix: np.ndarray,
        row_labels: list[str] | None = None,
        col_labels: list[str] | None = None,
        title: str = "",
        cmap: str = "RdBu_r",
        annotate: bool = True,
        figsize: tuple[float, float] = (10, 8),
    ) -> GeneratedFigure:
        """Heatmap with optional annotations (auto-disabled for >20×20)."""
        PlotGenerator.configure_style()
        fig, ax = plt.subplots(figsize=figsize)

        matrix = np.asarray(matrix, dtype=float)
        if matrix.size == 0:
            ax.text(0.5, 0.5, "No data", ha="center", va="center", transform=ax.transAxes)
            ax.set_title(title)
            return PlotGenerator._finalise(fig, title)

        im = ax.imshow(matrix, cmap=cmap, aspect="auto")
        fig.colorbar(im, ax=ax, fraction=0.046, pad=0.04)

        rows, cols = matrix.shape
        if row_labels is not None:
            ax.set_yticks(range(rows))
            ax.set_yticklabels(row_labels[:rows], fontsize=8)
        if col_labels is not None:
            ax.set_xticks(range(cols))
            ax.set_xticklabels(col_labels[:cols], fontsize=8, rotation=45, ha="right")

        # Annotate only if small
        if annotate and rows < 20 and cols < 20:
            for i in range(rows):
                for j in range(cols):
                    val = matrix[i, j]
                    colour = "white" if abs(val - np.nanmean(matrix)) > np.nanstd(matrix) else "black"
                    ax.text(j, i, f"{val:.2f}", ha="center", va="center", fontsize=7, color=colour)

        ax.set_title(title)

        return PlotGenerator._finalise(fig, title)

    # ── 5. Volcano Plot ─────────────────────────────────────────────

    @staticmethod
    def volcano_plot(
        log2fc: np.ndarray,
        neg_log10p: np.ndarray,
        gene_names: list[str] | None = None,
        fc_threshold: float = 1.0,
        p_threshold: float = 0.05,
        title: str = "Volcano Plot",
        figsize: tuple[float, float] = (8, 6),
    ) -> GeneratedFigure:
        """Volcano plot: red=up, blue=down, gray=NS. Top genes labelled."""
        PlotGenerator.configure_style()
        fig, ax = plt.subplots(figsize=figsize)

        log2fc = np.asarray(log2fc, dtype=float)
        neg_log10p = np.asarray(neg_log10p, dtype=float)

        if len(log2fc) == 0:
            ax.text(0.5, 0.5, "No data", ha="center", va="center", transform=ax.transAxes)
            ax.set_title(title)
            return PlotGenerator._finalise(fig, title)

        neg_log10p_thresh = -np.log10(p_threshold) if p_threshold > 0 else 1.3

        # Classify
        up = (log2fc >= fc_threshold) & (neg_log10p >= neg_log10p_thresh)
        down = (log2fc <= -fc_threshold) & (neg_log10p >= neg_log10p_thresh)
        ns = ~(up | down)

        ax.scatter(log2fc[ns], neg_log10p[ns], c="gray", s=8, alpha=0.4, label="NS")
        ax.scatter(log2fc[up], neg_log10p[up], c="red", s=12, alpha=0.6, label="Up")
        ax.scatter(log2fc[down], neg_log10p[down], c="blue", s=12, alpha=0.6, label="Down")

        # Threshold lines
        ax.axhline(neg_log10p_thresh, color="black", linestyle="--", linewidth=0.7, alpha=0.5)
        ax.axvline(fc_threshold, color="black", linestyle="--", linewidth=0.7, alpha=0.5)
        ax.axvline(-fc_threshold, color="black", linestyle="--", linewidth=0.7, alpha=0.5)

        # Label top genes
        if gene_names is not None:
            sig_mask = up | down
            if np.any(sig_mask):
                sig_indices = np.where(sig_mask)[0]
                # Sort by significance
                top_idx = sig_indices[np.argsort(neg_log10p[sig_indices])[::-1]][:10]
                for idx in top_idx:
                    if idx < len(gene_names):
                        ax.annotate(
                            gene_names[idx],
                            (log2fc[idx], neg_log10p[idx]),
                            fontsize=6, alpha=0.8,
                            xytext=(5, 5), textcoords="offset points",
                        )

        ax.set_xlabel("log₂ Fold Change")
        ax.set_ylabel("-log₁₀ p-value")
        ax.set_title(title)
        ax.legend(fontsize=8, loc="upper right")

        return PlotGenerator._finalise(fig, title)

    # ── 6. Survival Curve ───────────────────────────────────────────

    @staticmethod
    def survival_curve(
        times_list: list[np.ndarray],
        survival_list: list[np.ndarray],
        ci_lower_list: list[np.ndarray] | None = None,
        ci_upper_list: list[np.ndarray] | None = None,
        group_labels: list[str] | None = None,
        title: str = "",
        figsize: tuple[float, float] = (8, 6),
    ) -> GeneratedFigure:
        """Kaplan-Meier step-function survival curves with CI bands."""
        PlotGenerator.configure_style()
        fig, ax = plt.subplots(figsize=figsize)

        if not times_list or not survival_list:
            ax.text(0.5, 0.5, "No data", ha="center", va="center", transform=ax.transAxes)
            ax.set_title(title)
            return PlotGenerator._finalise(fig, title)

        colours = plt.cm.tab10.colors  # type: ignore[attr-defined]

        for idx, (t, s) in enumerate(zip(times_list, survival_list)):
            t = np.asarray(t, dtype=float)
            s = np.asarray(s, dtype=float)
            label = group_labels[idx] if group_labels and idx < len(group_labels) else f"Group {idx + 1}"
            colour = colours[idx % len(colours)]

            ax.step(t, s, where="post", linewidth=1.5, color=colour, label=label)

            if ci_lower_list and ci_upper_list and idx < len(ci_lower_list) and idx < len(ci_upper_list):
                lo = np.asarray(ci_lower_list[idx], dtype=float)
                hi = np.asarray(ci_upper_list[idx], dtype=float)
                ax.fill_between(t, lo, hi, step="post", alpha=0.15, color=colour)

        ax.set_xlabel("Time")
        ax.set_ylabel("Survival Probability")
        ax.set_ylim(-0.05, 1.05)
        ax.set_title(title)
        ax.legend(fontsize=8)

        return PlotGenerator._finalise(fig, title)

    # ── 7. Spectrogram ──────────────────────────────────────────────

    @staticmethod
    def spectrogram_plot(
        times: np.ndarray,
        frequencies: np.ndarray,
        power: np.ndarray,
        title: str = "",
        freq_range: tuple[float, float] | None = None,
        figsize: tuple[float, float] = (10, 4),
    ) -> GeneratedFigure:
        """Spectrogram (pcolormesh in dB scale) with colorbar."""
        PlotGenerator.configure_style()
        fig, ax = plt.subplots(figsize=figsize)

        times = np.asarray(times, dtype=float)
        frequencies = np.asarray(frequencies, dtype=float)
        power = np.asarray(power, dtype=float)

        if power.size == 0:
            ax.text(0.5, 0.5, "No data", ha="center", va="center", transform=ax.transAxes)
            ax.set_title(title)
            return PlotGenerator._finalise(fig, title)

        # Convert to dB, avoiding log10(0)
        power_db = 10 * np.log10(np.maximum(power, 1e-20))

        mesh = ax.pcolormesh(times, frequencies, power_db, shading="auto", cmap="viridis")
        fig.colorbar(mesh, ax=ax, label="Power (dB)")

        if freq_range is not None:
            ax.set_ylim(freq_range)

        ax.set_xlabel("Time (s)")
        ax.set_ylabel("Frequency (Hz)")
        ax.set_title(title)

        return PlotGenerator._finalise(fig, title)

    # ── 8. PSD ──────────────────────────────────────────────────────

    @staticmethod
    def psd_plot(
        frequencies: np.ndarray,
        power: np.ndarray,
        bands: dict[str, tuple[float, float]] | None = None,
        title: str = "",
        figsize: tuple[float, float] = (8, 5),
    ) -> GeneratedFigure:
        """Power Spectral Density (semilogy) with optional shaded frequency bands."""
        PlotGenerator.configure_style()
        fig, ax = plt.subplots(figsize=figsize)

        frequencies = np.asarray(frequencies, dtype=float)
        power = np.asarray(power, dtype=float)

        if len(frequencies) == 0:
            ax.text(0.5, 0.5, "No data", ha="center", va="center", transform=ax.transAxes)
            ax.set_title(title)
            return PlotGenerator._finalise(fig, title)

        ax.semilogy(frequencies, power, linewidth=1, color="black")

        if bands:
            band_colours = plt.cm.Set2.colors  # type: ignore[attr-defined]
            for idx, (band_name, (flo, fhi)) in enumerate(bands.items()):
                colour = band_colours[idx % len(band_colours)]
                mask = (frequencies >= flo) & (frequencies <= fhi)
                if np.any(mask):
                    ax.fill_between(
                        frequencies[mask], power[mask], alpha=0.3,
                        color=colour, label=band_name,
                    )
            ax.legend(fontsize=8)

        ax.set_xlabel("Frequency (Hz)")
        ax.set_ylabel("Power (µV²/Hz)")
        ax.set_title(title)

        return PlotGenerator._finalise(fig, title)

    # ── 9. PK Curve ─────────────────────────────────────────────────

    @staticmethod
    def pk_curve(
        time: np.ndarray,
        concentration: np.ndarray,
        dose_times: np.ndarray | list[float] | None = None,
        therapeutic_min: float | None = None,
        therapeutic_max: float | None = None,
        title: str = "",
        figsize: tuple[float, float] = (10, 5),
    ) -> GeneratedFigure:
        """Pharmacokinetic curve with therapeutic window and dose markers."""
        PlotGenerator.configure_style()
        fig, ax = plt.subplots(figsize=figsize)

        time = np.asarray(time, dtype=float)
        concentration = np.asarray(concentration, dtype=float)

        if len(time) == 0:
            ax.text(0.5, 0.5, "No data", ha="center", va="center", transform=ax.transAxes)
            ax.set_title(title)
            return PlotGenerator._finalise(fig, title)

        ax.plot(time, concentration, linewidth=1.5, color="darkblue", label="Concentration")

        # Therapeutic window
        if therapeutic_min is not None and therapeutic_max is not None:
            ax.axhspan(therapeutic_min, therapeutic_max, alpha=0.15, color="green", label="Therapeutic window")
        elif therapeutic_min is not None:
            ax.axhline(therapeutic_min, color="green", linestyle="--", linewidth=0.8, label="Min therapeutic")
        elif therapeutic_max is not None:
            ax.axhline(therapeutic_max, color="red", linestyle="--", linewidth=0.8, label="Max therapeutic")

        # Dose markers
        if dose_times is not None:
            for dt in dose_times:
                ax.axvline(dt, color="red", linestyle=":", linewidth=0.8, alpha=0.7)
            # Single legend entry
            ax.axvline(np.nan, color="red", linestyle=":", linewidth=0.8, label="Dose")

        ax.set_xlabel("Time")
        ax.set_ylabel("Concentration")
        ax.set_title(title)
        ax.legend(fontsize=8)

        return PlotGenerator._finalise(fig, title)

    # ── 10. Joint Angle Curve ───────────────────────────────────────

    @staticmethod
    def joint_angle_curve(
        time_percent: np.ndarray,
        angles: np.ndarray | Sequence[np.ndarray],
        title: str = "",
        ylabel: str = "Angle (°)",
        figsize: tuple[float, float] = (8, 5),
    ) -> GeneratedFigure:
        """Joint angle versus gait-cycle percentage."""
        PlotGenerator.configure_style()
        fig, ax = plt.subplots(figsize=figsize)

        time_percent = np.asarray(time_percent, dtype=float)

        if len(time_percent) == 0:
            ax.text(0.5, 0.5, "No data", ha="center", va="center", transform=ax.transAxes)
            ax.set_title(title)
            return PlotGenerator._finalise(fig, title)

        # Normalise to list of arrays
        if isinstance(angles, np.ndarray) and angles.ndim == 1:
            traces = [angles]
        elif isinstance(angles, np.ndarray) and angles.ndim == 2:
            traces = [angles[i] for i in range(angles.shape[0])]
        else:
            traces = list(angles)

        colours = plt.cm.tab10.colors  # type: ignore[attr-defined]
        for idx, trace in enumerate(traces):
            trace = np.asarray(trace, dtype=float)
            ax.plot(time_percent[:len(trace)], trace, linewidth=1.2, color=colours[idx % len(colours)])

        ax.set_xlabel("Gait Cycle (%)")
        ax.set_ylabel(ylabel)
        ax.set_xlim(0, 100)
        ax.set_title(title)

        return PlotGenerator._finalise(fig, title)

    # ── 11. Forest Plot ─────────────────────────────────────────────

    @staticmethod
    def forest_plot(
        effects: np.ndarray | list[float],
        ci_lower: np.ndarray | list[float],
        ci_upper: np.ndarray | list[float],
        labels: list[str],
        title: str = "",
        figsize: tuple[float, float] = (8, 6),
    ) -> GeneratedFigure:
        """Forest plot with horizontal CI lines and diamond markers."""
        PlotGenerator.configure_style()
        fig, ax = plt.subplots(figsize=figsize)

        effects = np.asarray(effects, dtype=float)
        ci_lower = np.asarray(ci_lower, dtype=float)
        ci_upper = np.asarray(ci_upper, dtype=float)

        n = len(effects)
        if n == 0:
            ax.text(0.5, 0.5, "No data", ha="center", va="center", transform=ax.transAxes)
            ax.set_title(title)
            return PlotGenerator._finalise(fig, title)

        y_pos = np.arange(n)

        for i in range(n):
            ax.plot([ci_lower[i], ci_upper[i]], [y_pos[i], y_pos[i]], color="black", linewidth=1)
            ax.plot(effects[i], y_pos[i], marker="D", color="darkblue", markersize=7, zorder=5)

        ax.axvline(0, color="gray", linestyle="--", linewidth=0.8)
        ax.set_yticks(y_pos)
        ax.set_yticklabels(labels[:n], fontsize=9)
        ax.set_xlabel("Effect Size")
        ax.set_title(title)
        ax.invert_yaxis()

        return PlotGenerator._finalise(fig, title)

    # ── 12. Correlation Matrix ──────────────────────────────────────

    @staticmethod
    def correlation_matrix(
        matrix: np.ndarray,
        labels: list[str],
        title: str = "",
        figsize: tuple[float, float] = (10, 8),
    ) -> GeneratedFigure:
        """Lower-triangle correlation heatmap."""
        PlotGenerator.configure_style()
        fig, ax = plt.subplots(figsize=figsize)

        matrix = np.asarray(matrix, dtype=float)
        if matrix.size == 0:
            ax.text(0.5, 0.5, "No data", ha="center", va="center", transform=ax.transAxes)
            ax.set_title(title)
            return PlotGenerator._finalise(fig, title)

        n = matrix.shape[0]

        # Mask upper triangle
        mask = np.triu(np.ones_like(matrix, dtype=bool), k=1)
        masked = np.ma.array(matrix, mask=mask)  # type: ignore[attr-defined]

        im = ax.imshow(masked, cmap="RdBu_r", vmin=-1, vmax=1, aspect="auto")
        fig.colorbar(im, ax=ax, fraction=0.046, pad=0.04)

        ax.set_xticks(range(n))
        ax.set_xticklabels(labels[:n], fontsize=8, rotation=45, ha="right")
        ax.set_yticks(range(n))
        ax.set_yticklabels(labels[:n], fontsize=8)

        # Annotate if small enough
        if n < 20:
            for i in range(n):
                for j in range(i + 1):
                    ax.text(j, i, f"{matrix[i, j]:.2f}", ha="center", va="center", fontsize=7)

        ax.set_title(title)

        return PlotGenerator._finalise(fig, title)

    # ── 13. Box Plot ────────────────────────────────────────────────

    @staticmethod
    def box_plot(
        groups_data: list[np.ndarray],
        labels: list[str],
        title: str = "",
        ylabel: str = "",
        show_points: bool = True,
        figsize: tuple[float, float] = (8, 5),
    ) -> GeneratedFigure:
        """Box plot with optional jittered individual data points."""
        PlotGenerator.configure_style()
        fig, ax = plt.subplots(figsize=figsize)

        if not groups_data:
            ax.text(0.5, 0.5, "No data", ha="center", va="center", transform=ax.transAxes)
            ax.set_title(title)
            return PlotGenerator._finalise(fig, title)

        bp = ax.boxplot(
            [np.asarray(g, dtype=float) for g in groups_data],
            patch_artist=True, widths=0.6,
        )
        colours = plt.cm.Set2.colors  # type: ignore[attr-defined]
        for idx, patch in enumerate(bp["boxes"]):
            patch.set_facecolor(colours[idx % len(colours)])
            patch.set_alpha(0.7)

        if show_points:
            for idx, group in enumerate(groups_data):
                group = np.asarray(group, dtype=float)
                jitter = np.random.default_rng(42).normal(0, 0.04, size=len(group))
                ax.scatter(
                    np.full(len(group), idx + 1) + jitter,
                    group, s=12, alpha=0.5, color="black", zorder=3,
                )

        ax.set_xticklabels(labels[:len(groups_data)], fontsize=9)
        ax.set_ylabel(ylabel)
        ax.set_title(title)

        return PlotGenerator._finalise(fig, title)

    # ── 14. Bar Chart ───────────────────────────────────────────────

    @staticmethod
    def bar_chart(
        categories: list[str],
        values: np.ndarray | list[float],
        errors: np.ndarray | list[float] | None = None,
        title: str = "",
        ylabel: str = "",
        figsize: tuple[float, float] = (8, 5),
    ) -> GeneratedFigure:
        """Bar chart with optional error bars."""
        PlotGenerator.configure_style()
        fig, ax = plt.subplots(figsize=figsize)

        values = np.asarray(values, dtype=float)

        if len(values) == 0:
            ax.text(0.5, 0.5, "No data", ha="center", va="center", transform=ax.transAxes)
            ax.set_title(title)
            return PlotGenerator._finalise(fig, title)

        x = np.arange(len(values))
        err = np.asarray(errors, dtype=float) if errors is not None else None

        colours = plt.cm.Set2.colors  # type: ignore[attr-defined]
        bar_colours = [colours[i % len(colours)] for i in range(len(values))]

        ax.bar(
            x, values, yerr=err, capsize=4,
            color=bar_colours, edgecolor="black", linewidth=0.5, alpha=0.85,
        )
        ax.set_xticks(x)
        ax.set_xticklabels(categories[:len(values)], fontsize=9, rotation=30, ha="right")
        ax.set_ylabel(ylabel)
        ax.set_title(title)

        return PlotGenerator._finalise(fig, title)
