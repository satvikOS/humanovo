"""
Electrophysiology Signal Processor — EEG, ECG, and PSG signal processing.

Provides filtering, spectral analysis, peak detection, artifact removal,
event-related potentials, coherence, and Hjorth parameter computation
for biomedical electrophysiology data.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from typing import Any

import numpy as np

from app.compute.types import (
    ComputeDomain,
    ComputeRequest,
    ComputeResult,
    ComputeStatus,
    DescriptiveStats,
    FigureFormat,
    GeneratedFigure,
    StatisticalTest,
)

logger = logging.getLogger(__name__)

_OPERATIONS = [
    "load_edf",
    "bandpass_filter",
    "notch_filter",
    "compute_psd",
    "compute_spectrogram",
    "detect_peaks",
    "remove_artifacts",
    "compute_erp",
    "coherence",
    "hjorth_parameters",
    # Cardiovascular (MATLAB equivalent)
    "pan_tompkins_qrs",
    "ecg_delineation",
    "hrv_analysis",
    "windkessel_model",
    "arrhythmia_classification",
    "pulse_wave_analysis",
    "cardiac_output",
]

# Standard EEG frequency bands (Hz)
_FREQ_BANDS: dict[str, tuple[float, float]] = {
    "delta": (0.5, 4.0),
    "theta": (4.0, 8.0),
    "alpha": (8.0, 13.0),
    "beta": (13.0, 30.0),
    "gamma": (30.0, 100.0),
}


def _safe_float(val: Any) -> float:
    """Convert a value to a JSON-safe float (no NaN/Inf)."""
    v = float(val)
    if np.isnan(v) or np.isinf(v):
        return 0.0
    return v


def _array_to_list(arr: np.ndarray) -> list[float]:
    """Convert a numpy array to a list of JSON-safe floats."""
    result = np.asarray(arr, dtype=np.float64)
    result = np.nan_to_num(result, nan=0.0, posinf=0.0, neginf=0.0)
    return result.tolist()


def _make_result(request: ComputeRequest, **kwargs: Any) -> ComputeResult:
    """Build a successful ComputeResult from keyword arguments."""
    return ComputeResult(
        request_id=request.id,
        domain=ComputeDomain.ELECTROPHYSIOLOGY,
        operation=request.operation,
        status=ComputeStatus.COMPLETED,
        **kwargs,
    )


def _fail(request: ComputeRequest, error: str) -> ComputeResult:
    """Build a failed ComputeResult."""
    return ComputeResult(
        request_id=request.id,
        domain=ComputeDomain.ELECTROPHYSIOLOGY,
        operation=request.operation,
        status=ComputeStatus.FAILED,
        error=error,
    )


class SignalProcessor:
    """Electrophysiology signal processing computation engine.

    Dispatches operations such as EDF loading, filtering, spectral analysis,
    peak detection, artifact removal, ERP computation, coherence analysis,
    Hjorth parameter extraction, and cardiovascular signal processing.
    """

    def __init__(self) -> None:
        from app.compute.signals.cardiac import CardiacProcessor
        self._cardiac = CardiacProcessor()

    # ── Public interface ────────────────────────────────────────────

    @staticmethod
    def list_operations() -> list[str]:
        """Return names of all supported operations."""
        return list(_OPERATIONS)

    async def execute(
        self,
        request: ComputeRequest,
        progress_callback: Callable[[int, int], None] | None = None,
    ) -> ComputeResult:
        """Execute an electrophysiology computation request."""
        op = request.operation
        if op not in _OPERATIONS:
            return _fail(request, f"Unknown operation: {op!r}. Available: {_OPERATIONS}")

        # Delegate cardiovascular operations
        if op in self._cardiac.OPERATIONS:
            return await self._cardiac.execute(request, progress_callback)

        handler = getattr(self, f"_op_{op}", None)
        if handler is None:
            return _fail(request, f"Operation {op!r} is declared but not implemented.")

        try:
            return await handler(request, progress_callback)
        except ImportError as exc:
            return _fail(
                request,
                f"Missing dependency for operation {op!r}: {exc}. "
                "Please install the required package.",
            )
        except Exception as exc:
            logger.exception("Signal processing operation %s failed", op)
            return _fail(request, f"{type(exc).__name__}: {exc}")

    # ── 1. load_edf ─────────────────────────────────────────────────

    async def _op_load_edf(
        self,
        request: ComputeRequest,
        progress_callback: Callable[[int, int], None] | None,
    ) -> ComputeResult:
        import pyedflib

        params = request.parameters
        file_path: str = params.get("file_path", "")
        if not file_path:
            return _fail(request, "Parameter 'file_path' is required.")

        reader = pyedflib.EdfReader(file_path)
        try:
            n_channels = reader.signals_in_file
            channel_names = reader.getSignalLabels()
            sampling_rates: list[float] = []
            signal_stats: dict[str, DescriptiveStats] = {}
            channel_info: list[dict[str, Any]] = []

            for i in range(n_channels):
                if progress_callback:
                    progress_callback(i, n_channels)

                fs = float(reader.getSampleFrequency(i))
                sampling_rates.append(fs)
                sig = reader.readSignal(i)

                stats = DescriptiveStats.from_array(np.asarray(sig))
                signal_stats[channel_names[i]] = stats

                channel_info.append({
                    "name": channel_names[i],
                    "sampling_rate": fs,
                    "n_samples": len(sig),
                    "physical_min": _safe_float(reader.getPhysicalMinimum(i)),
                    "physical_max": _safe_float(reader.getPhysicalMaximum(i)),
                })

            duration_seconds = _safe_float(reader.getFileDuration())

            if progress_callback:
                progress_callback(n_channels, n_channels)

            return _make_result(
                request,
                results={
                    "channel_names": list(channel_names),
                    "sampling_rates": sampling_rates,
                    "duration_seconds": duration_seconds,
                    "n_channels": n_channels,
                    "channels": channel_info,
                },
                descriptive=signal_stats,
            )
        finally:
            reader.close()

    # ── 2. bandpass_filter ──────────────────────────────────────────

    async def _op_bandpass_filter(
        self,
        request: ComputeRequest,
        progress_callback: Callable[[int, int], None] | None,
    ) -> ComputeResult:
        from scipy.signal import butter, filtfilt, freqz

        params = request.parameters
        signal = np.asarray(params["signal"], dtype=np.float64)
        fs: float = float(params["sampling_rate"])
        filter_type: str = params.get("filter_type", "bandpass")
        order: int = int(params.get("order", 4))

        low_freq = params.get("low_freq")
        high_freq = params.get("high_freq")
        nyq = fs / 2.0

        # Build Wn depending on filter type
        if filter_type in ("bandpass", "bandstop"):
            if low_freq is None or high_freq is None:
                return _fail(request, f"Both 'low_freq' and 'high_freq' required for {filter_type}.")
            wn = [float(low_freq) / nyq, float(high_freq) / nyq]
        elif filter_type == "lowpass":
            if high_freq is None:
                return _fail(request, "'high_freq' is required for lowpass filter.")
            wn = float(high_freq) / nyq
        elif filter_type == "highpass":
            if low_freq is None:
                return _fail(request, "'low_freq' is required for highpass filter.")
            wn = float(low_freq) / nyq
        else:
            return _fail(request, f"Unknown filter_type: {filter_type!r}")

        b, a = butter(order, wn, btype=filter_type)
        filtered = filtfilt(b, a, signal)

        # Frequency response figure
        w, h = freqz(b, a, worN=2048, fs=fs)
        figures = self._plot_frequency_response(w, h, filter_type, fs)

        if progress_callback:
            progress_callback(1, 1)

        return _make_result(
            request,
            results={
                "filtered_signal": _array_to_list(filtered),
                "filter_coefficients": {"b": _array_to_list(b), "a": _array_to_list(a)},
            },
            figures=figures,
        )

    @staticmethod
    def _plot_frequency_response(
        w: np.ndarray, h: np.ndarray, filter_type: str, fs: float
    ) -> list[GeneratedFigure]:
        try:
            import matplotlib
            matplotlib.use("Agg")
            import matplotlib.pyplot as plt

            fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(8, 6))

            magnitude_db = 20 * np.log10(np.maximum(np.abs(h), 1e-15))
            ax1.plot(w, magnitude_db, "b-", linewidth=1.5)
            ax1.set_ylabel("Magnitude (dB)")
            ax1.set_title(f"Frequency Response — {filter_type}")
            ax1.set_xlim(0, fs / 2)
            ax1.grid(True, alpha=0.3)

            phase = np.unwrap(np.angle(h))
            ax2.plot(w, np.degrees(phase), "r-", linewidth=1.5)
            ax2.set_xlabel("Frequency (Hz)")
            ax2.set_ylabel("Phase (degrees)")
            ax2.set_xlim(0, fs / 2)
            ax2.grid(True, alpha=0.3)

            fig.tight_layout()
            gen = GeneratedFigure.from_matplotlib(fig, f"Frequency Response ({filter_type})")
            plt.close(fig)
            return [gen]
        except ImportError:
            logger.warning("matplotlib not available — skipping frequency response figure.")
            return []

    # ── 3. notch_filter ─────────────────────────────────────────────

    async def _op_notch_filter(
        self,
        request: ComputeRequest,
        progress_callback: Callable[[int, int], None] | None,
    ) -> ComputeResult:
        from scipy.signal import filtfilt, iirnotch

        params = request.parameters
        signal = np.asarray(params["signal"], dtype=np.float64)
        fs: float = float(params["sampling_rate"])
        freq: float = float(params.get("freq", 60.0))
        quality_factor: float = float(params.get("quality_factor", 30.0))

        b, a = iirnotch(freq, quality_factor, fs)
        filtered = filtfilt(b, a, signal)

        if progress_callback:
            progress_callback(1, 1)

        return _make_result(
            request,
            results={
                "filtered_signal": _array_to_list(filtered),
                "notch_freq_hz": freq,
                "quality_factor": quality_factor,
                "filter_coefficients": {"b": _array_to_list(b), "a": _array_to_list(a)},
            },
        )

    # ── 4. compute_psd ──────────────────────────────────────────────

    async def _op_compute_psd(
        self,
        request: ComputeRequest,
        progress_callback: Callable[[int, int], None] | None,
    ) -> ComputeResult:
        from scipy.signal import periodogram, welch, windows

        params = request.parameters
        signal = np.asarray(params["signal"], dtype=np.float64)
        fs: float = float(params["sampling_rate"])
        method: str = params.get("method", "welch")
        window_size: int | None = params.get("window_size")
        overlap: int | None = params.get("overlap")

        nperseg = int(window_size) if window_size else min(256, len(signal))
        noverlap = int(overlap) if overlap else nperseg // 2

        if method == "welch":
            freqs, psd = welch(signal, fs=fs, nperseg=nperseg, noverlap=noverlap)
        elif method == "periodogram":
            freqs, psd = periodogram(signal, fs=fs)
        elif method == "multitaper":
            freqs, psd = self._multitaper_psd(signal, fs, nperseg)
        else:
            return _fail(request, f"Unknown PSD method: {method!r}")

        # Band powers
        band_powers: dict[str, float] = {}
        freq_resolution = freqs[1] - freqs[0] if len(freqs) > 1 else 1.0
        for band_name, (lo, hi) in _FREQ_BANDS.items():
            mask = (freqs >= lo) & (freqs <= hi)
            band_powers[band_name] = _safe_float(np.trapz(psd[mask], freqs[mask])) if mask.any() else 0.0

        total_power = _safe_float(np.trapz(psd, freqs))
        dominant_idx = int(np.argmax(psd))
        dominant_freq = _safe_float(freqs[dominant_idx])

        figures = self._plot_psd(freqs, psd, band_powers, method)

        if progress_callback:
            progress_callback(1, 1)

        return _make_result(
            request,
            results={
                "frequencies": _array_to_list(freqs),
                "power": _array_to_list(psd),
                "band_powers": band_powers,
                "dominant_frequency_hz": dominant_freq,
                "total_power": total_power,
                "method": method,
            },
            figures=figures,
        )

    @staticmethod
    def _multitaper_psd(
        signal: np.ndarray, fs: float, nperseg: int
    ) -> tuple[np.ndarray, np.ndarray]:
        """Compute PSD using DPSS (Slepian) multitaper method."""
        from scipy.signal.windows import dpss

        n = len(signal)
        nw = 4.0  # time-half-bandwidth product
        k = int(2 * nw) - 1  # number of tapers
        tapers = dpss(n, nw, Kmax=k)

        # Compute individual periodograms for each taper and average
        nfft = max(n, 256)
        psd_sum = np.zeros(nfft // 2 + 1)
        for taper in tapers:
            windowed = signal * taper
            spectrum = np.fft.rfft(windowed, n=nfft)
            psd_sum += np.abs(spectrum) ** 2

        psd = psd_sum / (k * fs)
        freqs = np.fft.rfftfreq(nfft, d=1.0 / fs)
        return freqs, psd

    @staticmethod
    def _plot_psd(
        freqs: np.ndarray,
        psd: np.ndarray,
        band_powers: dict[str, float],
        method: str,
    ) -> list[GeneratedFigure]:
        try:
            import matplotlib
            matplotlib.use("Agg")
            import matplotlib.pyplot as plt

            fig, ax = plt.subplots(figsize=(10, 5))
            ax.semilogy(freqs, psd, "k-", linewidth=0.8, label="PSD")

            band_colors = {
                "delta": "#4e79a7",
                "theta": "#f28e2b",
                "alpha": "#e15759",
                "beta": "#76b7b2",
                "gamma": "#59a14f",
            }
            for band_name, (lo, hi) in _FREQ_BANDS.items():
                mask = (freqs >= lo) & (freqs <= hi)
                if mask.any():
                    ax.fill_between(
                        freqs[mask], psd[mask], alpha=0.3,
                        color=band_colors.get(band_name, "gray"),
                        label=f"{band_name} ({lo}-{hi} Hz)",
                    )

            ax.set_xlabel("Frequency (Hz)")
            ax.set_ylabel("Power Spectral Density (V²/Hz)")
            ax.set_title(f"Power Spectral Density — {method}")
            ax.legend(fontsize=8)
            ax.set_xlim(0, min(freqs[-1], 100))
            ax.grid(True, alpha=0.3)
            fig.tight_layout()
            gen = GeneratedFigure.from_matplotlib(fig, f"PSD ({method})")
            plt.close(fig)
            return [gen]
        except ImportError:
            return []

    # ── 5. compute_spectrogram ──────────────────────────────────────

    async def _op_compute_spectrogram(
        self,
        request: ComputeRequest,
        progress_callback: Callable[[int, int], None] | None,
    ) -> ComputeResult:
        from scipy.signal import spectrogram as sp_spectrogram

        params = request.parameters
        signal = np.asarray(params["signal"], dtype=np.float64)
        fs: float = float(params["sampling_rate"])
        window_sec: float = float(params.get("window_size", 1.0))
        overlap_ratio: float = float(params.get("overlap_ratio", 0.5))
        freq_range: list[float] | None = params.get("freq_range")

        nperseg = int(window_sec * fs)
        noverlap = int(nperseg * overlap_ratio)

        f, t, Sxx = sp_spectrogram(signal, fs=fs, nperseg=nperseg, noverlap=noverlap)

        # Optionally restrict frequency range
        if freq_range and len(freq_range) == 2:
            lo, hi = float(freq_range[0]), float(freq_range[1])
            freq_mask = (f >= lo) & (f <= hi)
            f = f[freq_mask]
            Sxx = Sxx[freq_mask, :]

        figures = self._plot_spectrogram(f, t, Sxx, fs)

        if progress_callback:
            progress_callback(1, 1)

        return _make_result(
            request,
            results={
                "times": _array_to_list(t),
                "frequencies": _array_to_list(f),
                "power": [_array_to_list(row) for row in Sxx],
            },
            figures=figures,
        )

    @staticmethod
    def _plot_spectrogram(
        f: np.ndarray, t: np.ndarray, Sxx: np.ndarray, fs: float
    ) -> list[GeneratedFigure]:
        try:
            import matplotlib
            matplotlib.use("Agg")
            import matplotlib.pyplot as plt

            fig, ax = plt.subplots(figsize=(10, 5))
            # Use log scale for power to improve visibility
            Sxx_db = 10 * np.log10(np.maximum(Sxx, 1e-20))
            pcm = ax.pcolormesh(t, f, Sxx_db, shading="gouraud", cmap="viridis")
            cbar = fig.colorbar(pcm, ax=ax)
            cbar.set_label("Power/Frequency (dB/Hz)")
            ax.set_xlabel("Time (s)")
            ax.set_ylabel("Frequency (Hz)")
            ax.set_title("Spectrogram")
            fig.tight_layout()
            gen = GeneratedFigure.from_matplotlib(fig, "Spectrogram")
            plt.close(fig)
            return [gen]
        except ImportError:
            return []

    # ── 6. detect_peaks ─────────────────────────────────────────────

    async def _op_detect_peaks(
        self,
        request: ComputeRequest,
        progress_callback: Callable[[int, int], None] | None,
    ) -> ComputeResult:
        from scipy.signal import find_peaks

        params = request.parameters
        signal = np.asarray(params["signal"], dtype=np.float64)
        fs: float = float(params["sampling_rate"])
        method: str = params.get("method", "threshold")
        min_distance_ms: float = float(params.get("min_distance_ms", 200))
        min_height: float | None = params.get("min_height")

        min_distance_samples = max(1, int(min_distance_ms / 1000.0 * fs))

        if method == "threshold":
            kwargs: dict[str, Any] = {"distance": min_distance_samples}
            if min_height is not None:
                kwargs["height"] = float(min_height)
            peak_indices, _ = find_peaks(signal, **kwargs)

        elif method == "derivative":
            # Zero-crossing of first derivative
            d1 = np.diff(signal)
            # Peak where derivative goes from positive to negative
            zero_crossings = np.where((d1[:-1] > 0) & (d1[1:] <= 0))[0] + 1
            # Apply minimum distance
            if len(zero_crossings) > 1:
                peak_indices = self._enforce_min_distance(
                    zero_crossings, signal, min_distance_samples
                )
            else:
                peak_indices = zero_crossings
            # Apply minimum height
            if min_height is not None:
                peak_indices = peak_indices[signal[peak_indices] >= float(min_height)]

        elif method == "pan_tompkins":
            peak_indices = self._pan_tompkins(signal, fs, min_distance_samples)

        else:
            return _fail(request, f"Unknown peak detection method: {method!r}")

        peak_indices = np.asarray(peak_indices, dtype=np.int64)
        peak_times = peak_indices / fs
        peak_amplitudes = signal[peak_indices] if len(peak_indices) > 0 else np.array([])

        results: dict[str, Any] = {
            "peak_indices": peak_indices.tolist(),
            "peak_times": _array_to_list(peak_times),
            "peak_amplitudes": _array_to_list(peak_amplitudes),
            "n_peaks": len(peak_indices),
        }

        descriptive: dict[str, DescriptiveStats] = {}

        # Compute inter-peak intervals (RR intervals for ECG)
        if len(peak_indices) > 1:
            intervals = np.diff(peak_times)
            results["intervals"] = _array_to_list(intervals)
            interval_stats = DescriptiveStats.from_array(intervals)
            descriptive["interval_stats"] = interval_stats

            mean_interval = float(np.mean(intervals))
            if mean_interval > 0:
                results["heart_rate_bpm"] = _safe_float(60.0 / mean_interval)

        if progress_callback:
            progress_callback(1, 1)

        return _make_result(request, results=results, descriptive=descriptive)

    @staticmethod
    def _enforce_min_distance(
        indices: np.ndarray, signal: np.ndarray, min_dist: int
    ) -> np.ndarray:
        """Keep only the highest peak within each min_dist window."""
        if len(indices) == 0:
            return indices
        # Sort by amplitude descending
        order = np.argsort(-signal[indices])
        sorted_idx = indices[order]
        keep = np.ones(len(sorted_idx), dtype=bool)
        for i in range(len(sorted_idx)):
            if not keep[i]:
                continue
            # Suppress nearby lower peaks
            dist = np.abs(sorted_idx - sorted_idx[i])
            too_close = (dist < min_dist) & (dist > 0)
            keep[too_close & (np.arange(len(sorted_idx)) > i)] = False
        return np.sort(sorted_idx[keep])

    @staticmethod
    def _pan_tompkins(signal: np.ndarray, fs: float, min_distance: int) -> np.ndarray:
        """Simplified Pan-Tompkins QRS detector for ECG R-peak detection.

        Steps: bandpass 5-15 Hz -> differentiate -> square -> moving window integration -> threshold
        """
        from scipy.signal import butter, filtfilt, find_peaks

        # 1. Bandpass filter 5-15 Hz
        nyq = fs / 2.0
        low = min(5.0 / nyq, 0.99)
        high = min(15.0 / nyq, 0.99)
        if low >= high:
            high = min(low + 0.1, 0.99)
        b, a = butter(2, [low, high], btype="bandpass")
        filtered = filtfilt(b, a, signal)

        # 2. Differentiate
        diff_sig = np.diff(filtered)

        # 3. Square
        squared = diff_sig ** 2

        # 4. Moving window integration (150 ms window)
        win_size = max(1, int(0.15 * fs))
        kernel = np.ones(win_size) / win_size
        integrated = np.convolve(squared, kernel, mode="same")

        # 5. Adaptive threshold
        threshold = 0.5 * np.max(integrated)
        peaks, _ = find_peaks(integrated, height=threshold, distance=min_distance)

        # Refine: find the actual R-peak (maximum in original signal near each detected peak)
        search_window = int(0.05 * fs)  # ±50 ms
        refined = []
        for p in peaks:
            lo = max(0, p - search_window)
            hi = min(len(signal), p + search_window + 1)
            refined.append(lo + int(np.argmax(signal[lo:hi])))

        return np.array(refined, dtype=np.int64)

    # ── 7. remove_artifacts ─────────────────────────────────────────

    async def _op_remove_artifacts(
        self,
        request: ComputeRequest,
        progress_callback: Callable[[int, int], None] | None,
    ) -> ComputeResult:
        params = request.parameters
        signals = [np.asarray(ch, dtype=np.float64) for ch in params["signals"]]
        fs: float = float(params["sampling_rate"])
        method: str = params.get("method", "threshold")

        if method == "threshold":
            cleaned, artifact_indices, n_removed = self._artifact_threshold(signals, params)
        elif method == "ica":
            cleaned, artifact_indices, n_removed = self._artifact_ica(signals, params)
        elif method == "regression":
            cleaned, artifact_indices, n_removed = self._artifact_regression(signals, params)
        else:
            return _fail(request, f"Unknown artifact removal method: {method!r}")

        if progress_callback:
            progress_callback(1, 1)

        return _make_result(
            request,
            results={
                "cleaned_signals": [_array_to_list(ch) for ch in cleaned],
                "artifact_indices": [idx.tolist() if isinstance(idx, np.ndarray) else idx
                                     for idx in artifact_indices],
                "n_artifacts_removed": n_removed,
                "method": method,
            },
        )

    @staticmethod
    def _artifact_threshold(
        signals: list[np.ndarray], params: dict[str, Any]
    ) -> tuple[list[np.ndarray], list[Any], int]:
        """Zero out segments exceeding an amplitude threshold."""
        threshold = float(params.get("threshold", 100.0))  # microvolts
        window_samples = int(params.get("window_samples", 1))

        cleaned = []
        all_indices: list[list[int]] = []
        total_removed = 0

        for sig in signals:
            bad = np.where(np.abs(sig) > threshold)[0]
            # Expand to windows
            bad_set: set[int] = set()
            for idx in bad:
                start = max(0, idx - window_samples)
                end = min(len(sig), idx + window_samples + 1)
                bad_set.update(range(start, end))

            c = sig.copy()
            bad_arr = np.array(sorted(bad_set), dtype=np.int64)
            if len(bad_arr) > 0:
                c[bad_arr] = 0.0
            cleaned.append(c)
            all_indices.append(bad_arr.tolist())
            total_removed += len(bad_arr)

        return cleaned, all_indices, total_removed

    @staticmethod
    def _artifact_ica(
        signals: list[np.ndarray], params: dict[str, Any]
    ) -> tuple[list[np.ndarray], list[Any], int]:
        """Use FastICA to identify and remove artifact components by kurtosis."""
        from scipy.stats import kurtosis
        from sklearn.decomposition import FastICA

        kurtosis_threshold = float(params.get("kurtosis_threshold", 5.0))

        # Stack channels: shape (n_channels, n_samples)
        data = np.array(signals)
        n_channels = data.shape[0]

        n_components = min(n_channels, int(params.get("n_components", n_channels)))
        ica = FastICA(n_components=n_components, random_state=42, max_iter=500)

        # Fit ICA: data.T -> (n_samples, n_channels)
        sources = ica.fit_transform(data.T)  # (n_samples, n_components)
        mixing = ica.mixing_  # (n_channels, n_components)

        # Identify artifact components by excess kurtosis
        artifact_components: list[int] = []
        for i in range(sources.shape[1]):
            k = float(kurtosis(sources[:, i]))
            if abs(k) > kurtosis_threshold:
                artifact_components.append(i)

        # Zero out artifact components and reconstruct
        cleaned_sources = sources.copy()
        cleaned_sources[:, artifact_components] = 0.0
        reconstructed = cleaned_sources @ mixing.T  # (n_samples, n_channels)

        cleaned = [reconstructed[:, i] for i in range(n_channels)]
        return cleaned, artifact_components, len(artifact_components)

    @staticmethod
    def _artifact_regression(
        signals: list[np.ndarray], params: dict[str, Any]
    ) -> tuple[list[np.ndarray], list[Any], int]:
        """Remove artifacts via regression against a reference channel."""
        ref_index = int(params.get("reference_channel", 0))
        if ref_index >= len(signals):
            ref_index = 0

        reference = signals[ref_index]
        cleaned = []
        total_removed = 0

        for i, sig in enumerate(signals):
            if i == ref_index:
                cleaned.append(sig.copy())
                continue

            # Regress signal on reference
            ref_mean = reference - np.mean(reference)
            sig_mean = sig - np.mean(sig)
            denom = np.dot(ref_mean, ref_mean)
            if denom == 0:
                cleaned.append(sig.copy())
                continue
            beta = np.dot(sig_mean, ref_mean) / denom
            residual = sig - beta * reference
            cleaned.append(residual)
            total_removed += 1  # one regression pass per channel

        return cleaned, [], total_removed

    # ── 8. compute_erp ──────────────────────────────────────────────

    async def _op_compute_erp(
        self,
        request: ComputeRequest,
        progress_callback: Callable[[int, int], None] | None,
    ) -> ComputeResult:
        params = request.parameters
        signal = np.asarray(params["signal"], dtype=np.float64)
        fs: float = float(params["sampling_rate"])
        event_times: list[float] = [float(t) for t in params["event_times"]]
        pre_ms: float = float(params.get("pre_stimulus_ms", 200))
        post_ms: float = float(params.get("post_stimulus_ms", 800))
        baseline_ms: float = float(params.get("baseline_ms", 200))

        pre_samples = int(pre_ms / 1000.0 * fs)
        post_samples = int(post_ms / 1000.0 * fs)
        baseline_samples = int(baseline_ms / 1000.0 * fs)

        epoch_length = pre_samples + post_samples
        epochs: list[np.ndarray] = []
        warnings: list[str] = []

        for i, t_event in enumerate(event_times):
            if progress_callback:
                progress_callback(i, len(event_times))

            onset_sample = int(t_event * fs)
            start = onset_sample - pre_samples
            end = onset_sample + post_samples

            if start < 0 or end > len(signal):
                warnings.append(f"Event at {t_event:.3f}s skipped (out of bounds).")
                continue

            epoch = signal[start:end].copy()

            # Baseline correction: subtract mean of the baseline period
            baseline_region = epoch[:baseline_samples]
            epoch -= np.mean(baseline_region)
            epochs.append(epoch)

        if len(epochs) == 0:
            return _fail(request, "No valid epochs could be extracted.")

        epoch_matrix = np.array(epochs)
        erp = np.mean(epoch_matrix, axis=0)
        erp_std = np.std(epoch_matrix, axis=0, ddof=1) if len(epochs) > 1 else np.zeros_like(erp)
        times = np.linspace(-pre_ms, post_ms, epoch_length)

        # Peak latency and amplitude (in post-stimulus window)
        post_start_idx = pre_samples
        post_erp = erp[post_start_idx:]
        peak_idx_in_post = int(np.argmax(np.abs(post_erp)))
        peak_latency_ms = _safe_float(times[post_start_idx + peak_idx_in_post])
        peak_amplitude = _safe_float(post_erp[peak_idx_in_post])

        figures = self._plot_erp(times, erp, erp_std, len(epochs))

        if progress_callback:
            progress_callback(len(event_times), len(event_times))

        return _make_result(
            request,
            results={
                "erp_waveform": _array_to_list(erp),
                "times": _array_to_list(times),
                "n_trials": len(epochs),
                "std_envelope": _array_to_list(erp_std),
                "peak_latency_ms": peak_latency_ms,
                "peak_amplitude": peak_amplitude,
            },
            figures=figures,
            warnings=warnings,
        )

    @staticmethod
    def _plot_erp(
        times: np.ndarray,
        erp: np.ndarray,
        erp_std: np.ndarray,
        n_trials: int,
    ) -> list[GeneratedFigure]:
        try:
            import matplotlib
            matplotlib.use("Agg")
            import matplotlib.pyplot as plt

            fig, ax = plt.subplots(figsize=(10, 5))
            ax.plot(times, erp, "b-", linewidth=1.5, label="ERP mean")
            ax.fill_between(
                times, erp - erp_std, erp + erp_std,
                alpha=0.2, color="blue", label="±1 SD",
            )
            ax.axvline(0, color="red", linestyle="--", linewidth=1, label="Stimulus onset")
            ax.axhline(0, color="gray", linestyle="-", linewidth=0.5)
            ax.set_xlabel("Time (ms)")
            ax.set_ylabel("Amplitude")
            ax.set_title(f"Event-Related Potential (N={n_trials})")
            ax.legend(fontsize=8)
            ax.grid(True, alpha=0.3)
            fig.tight_layout()
            gen = GeneratedFigure.from_matplotlib(fig, f"ERP (N={n_trials})")
            plt.close(fig)
            return [gen]
        except ImportError:
            return []

    # ── 9. coherence ────────────────────────────────────────────────

    async def _op_coherence(
        self,
        request: ComputeRequest,
        progress_callback: Callable[[int, int], None] | None,
    ) -> ComputeResult:
        from scipy.signal import coherence as sp_coherence

        params = request.parameters
        sig_a = np.asarray(params["signal_a"], dtype=np.float64)
        sig_b = np.asarray(params["signal_b"], dtype=np.float64)
        fs: float = float(params["sampling_rate"])
        window_size: int | None = params.get("window_size")

        nperseg = int(window_size) if window_size else min(256, len(sig_a))
        f, cxy = sp_coherence(sig_a, sig_b, fs=fs, nperseg=nperseg)

        # Peak coherence
        peak_idx = int(np.argmax(cxy))
        peak_freq = _safe_float(f[peak_idx])
        peak_coh = _safe_float(cxy[peak_idx])

        # Mean coherence per frequency band
        mean_coherence_by_band: dict[str, float] = {}
        for band_name, (lo, hi) in _FREQ_BANDS.items():
            mask = (f >= lo) & (f <= hi)
            if mask.any():
                mean_coherence_by_band[band_name] = _safe_float(np.mean(cxy[mask]))
            else:
                mean_coherence_by_band[band_name] = 0.0

        if progress_callback:
            progress_callback(1, 1)

        return _make_result(
            request,
            results={
                "frequencies": _array_to_list(f),
                "coherence": _array_to_list(cxy),
                "peak_coherence_frequency_hz": peak_freq,
                "peak_coherence": peak_coh,
                "mean_coherence_by_band": mean_coherence_by_band,
            },
        )

    # ── 10. hjorth_parameters ───────────────────────────────────────

    async def _op_hjorth_parameters(
        self,
        request: ComputeRequest,
        progress_callback: Callable[[int, int], None] | None,
    ) -> ComputeResult:
        params = request.parameters
        signal = np.asarray(params["signal"], dtype=np.float64)

        # Activity = variance of the signal
        activity = _safe_float(np.var(signal))

        # First derivative
        d1 = np.diff(signal)
        var_d1 = float(np.var(d1))

        # Second derivative
        d2 = np.diff(d1)
        var_d2 = float(np.var(d2))

        # Mobility = sqrt(var(d1) / var(signal))
        mobility = _safe_float(np.sqrt(var_d1 / activity)) if activity > 0 else 0.0

        # Complexity = mobility(d1) / mobility(signal)
        mobility_d1 = _safe_float(np.sqrt(var_d2 / var_d1)) if var_d1 > 0 else 0.0
        complexity = _safe_float(mobility_d1 / mobility) if mobility > 0 else 0.0

        if progress_callback:
            progress_callback(1, 1)

        return _make_result(
            request,
            results={
                "activity": activity,
                "mobility": mobility,
                "complexity": complexity,
            },
        )
