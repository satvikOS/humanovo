"""
Advanced Biomechanics — EMG, FE bone analysis, micro-CT morphometry, muscle force estimation.

Full MATLAB-equivalent biomechanics pipeline.
"""

from __future__ import annotations

import base64
import io
import math
from collections.abc import Callable
from typing import Any

import numpy as np
from scipy import ndimage, optimize, sparse
from scipy import signal as sp_signal
from scipy import stats as sp_stats

from app.compute.types import (
    ComputeDomain,
    ComputeRequest,
    ComputeResult,
    ComputeStatus,
    GeneratedFigure,
)


def _sf(v: Any) -> float:
    f = float(v)
    if math.isnan(f) or math.isinf(f):
        return 0.0
    return f


def _fig_to_b64(fig) -> str:
    buf = io.BytesIO()
    fig.savefig(buf, format="svg", bbox_inches="tight")
    buf.seek(0)
    return base64.b64encode(buf.read()).decode()


class AdvancedBiomechanicsProcessor:
    """Advanced biomechanics — MATLAB equivalent."""

    OPERATIONS = [
        "emg_processing",
        "finite_element_bone",
        "micro_ct_morphometry",
        "muscle_force_estimation",
        "body_segment_parameters",
        "gait_events",
        "joint_stiffness",
    ]

    def list_operations(self) -> list[str]:
        return self.OPERATIONS

    async def execute(
        self, request: ComputeRequest, progress_callback: Callable | None = None
    ) -> ComputeResult:
        dispatch = {
            "emg_processing": self._emg_processing,
            "finite_element_bone": self._finite_element_bone,
            "micro_ct_morphometry": self._micro_ct_morphometry,
            "muscle_force_estimation": self._muscle_force_estimation,
            "body_segment_parameters": self._body_segment_parameters,
            "gait_events": self._gait_events,
            "joint_stiffness": self._joint_stiffness,
        }
        handler = dispatch.get(request.operation)
        if not handler:
            return ComputeResult(
                request_id=request.id, domain=ComputeDomain.BIOMECHANICS,
                operation=request.operation, status=ComputeStatus.FAILED,
                error=f"Unknown advanced biomechanics operation: {request.operation}",
            )
        try:
            return await handler(request, progress_callback)
        except Exception as exc:
            return ComputeResult(
                request_id=request.id, domain=ComputeDomain.BIOMECHANICS,
                operation=request.operation, status=ComputeStatus.FAILED,
                error=f"{type(exc).__name__}: {exc}",
            )

    # ── 1. EMG Processing (Full Pipeline) ──────────────────────────

    async def _emg_processing(self, request: ComputeRequest, progress_callback) -> ComputeResult:
        p = request.parameters
        emg_raw = np.asarray(p["emg_signal"], dtype=np.float64)
        fs = float(p.get("sampling_rate", 1000))
        mvc_value = p.get("mvc_value", None)
        figures = []
        nyq = fs / 2.0

        # Handle multi-channel
        if emg_raw.ndim == 1:
            emg_raw = emg_raw.reshape(1, -1)
        n_channels, n_samples = emg_raw.shape

        results_channels = []
        for ch in range(n_channels):
            raw = emg_raw[ch]

            # DC offset removal
            raw = raw - np.mean(raw)

            # Bandpass filter 20-450 Hz (4th order Butterworth)
            low = 20.0 / nyq
            high = min(450.0 / nyq, 0.99)
            b_bp, a_bp = sp_signal.butter(4, [low, high], btype="band")
            filtered = sp_signal.filtfilt(b_bp, a_bp, raw)

            # Notch filter (50 Hz and 60 Hz)
            for notch_freq in [50.0, 60.0]:
                if notch_freq < nyq:
                    b_notch, a_notch = sp_signal.iirnotch(notch_freq / nyq, Q=30)
                    filtered = sp_signal.filtfilt(b_notch, a_notch, filtered)

            # Full-wave rectification
            rectified = np.abs(filtered)

            # RMS envelope (sliding window)
            rms_window = max(int(0.05 * fs), 1)  # 50ms window
            rms_env = np.sqrt(np.convolve(rectified ** 2,
                                           np.ones(rms_window) / rms_window, mode="same"))

            # Linear envelope (low-pass 6 Hz Butterworth)
            b_lp, a_lp = sp_signal.butter(4, min(6.0 / nyq, 0.99), btype="low")
            linear_env = sp_signal.filtfilt(b_lp, a_lp, rectified)

            # MVC normalization
            if mvc_value is not None:
                mvc = float(mvc_value)
                if mvc > 0:
                    rms_env_norm = rms_env / mvc * 100  # %MVC
                    linear_env_norm = linear_env / mvc * 100
                else:
                    rms_env_norm = rms_env
                    linear_env_norm = linear_env
            else:
                rms_env_norm = rms_env
                linear_env_norm = linear_env

            # Onset detection (Bonato et al. 1998 double-threshold)
            # Threshold h = mean + 3*SD of baseline (first 0.5s or specified)
            baseline_samples = int(p.get("baseline_duration_s", 0.5) * fs)
            baseline_samples = min(baseline_samples, n_samples // 4)
            baseline = rectified[:baseline_samples]
            h = np.mean(baseline) + 3 * np.std(baseline)
            r_consecutive = max(int(p.get("onset_min_duration_s", 0.03) * fs), 3)

            onsets = []
            offsets = []
            above = rectified > h
            in_burst = False
            burst_start = 0
            consecutive_count = 0

            for i in range(len(above)):
                if above[i]:
                    if not in_burst:
                        burst_start = i
                    consecutive_count += 1
                    if consecutive_count >= r_consecutive and not in_burst:
                        in_burst = True
                        onsets.append(int(burst_start))
                else:
                    if in_burst:
                        offsets.append(int(i))
                        in_burst = False
                    consecutive_count = 0
            if in_burst:
                offsets.append(int(len(rectified) - 1))

            # Fatigue analysis: median frequency over time windows
            window_duration = float(p.get("fatigue_window_s", 1.0))
            window_samples = int(window_duration * fs)
            hop = window_samples // 2

            median_freqs = []
            mean_freqs = []
            time_windows = []

            for start in range(0, n_samples - window_samples, hop):
                segment = filtered[start:start + window_samples]
                freqs_seg, psd_seg = sp_signal.welch(segment, fs=fs,
                                                       nperseg=min(256, len(segment)))
                # Median frequency
                cumsum_psd = np.cumsum(psd_seg)
                if cumsum_psd[-1] > 0:
                    med_idx = np.searchsorted(cumsum_psd, cumsum_psd[-1] / 2)
                    median_freqs.append(_sf(freqs_seg[min(med_idx, len(freqs_seg) - 1)]))
                    # Mean frequency
                    mean_f = np.sum(freqs_seg * psd_seg) / np.sum(psd_seg)
                    mean_freqs.append(_sf(mean_f))
                else:
                    median_freqs.append(0.0)
                    mean_freqs.append(0.0)
                time_windows.append(_sf((start + window_samples / 2) / fs))

            # Fatigue slope (linear regression of median freq vs time)
            fatigue_slope = 0.0
            fatigue_r2 = 0.0
            if len(time_windows) > 2:
                tw = np.array(time_windows)
                mf = np.array(median_freqs)
                valid = mf > 0
                if np.sum(valid) > 2:
                    slope, intercept, r, _, _ = sp_stats.linregress(tw[valid], mf[valid])
                    fatigue_slope = _sf(slope)
                    fatigue_r2 = _sf(r ** 2)

            # Dimitrov fatigue index FInsm5
            # FInsm5 = moment_ratio(-1, 5) — spectral moments
            finsm5_values = []
            for start in range(0, n_samples - window_samples, hop):
                segment = filtered[start:start + window_samples]
                freqs_seg, psd_seg = sp_signal.welch(segment, fs=fs,
                                                       nperseg=min(256, len(segment)))
                m_neg1 = np.sum(freqs_seg ** (-1) * psd_seg) if np.all(freqs_seg[1:] > 0) else 0
                m_5 = np.sum(freqs_seg ** 5 * psd_seg)
                if m_5 > 0 and m_neg1 > 0:
                    finsm5_values.append(_sf(m_neg1 / m_5))
                else:
                    finsm5_values.append(0.0)

            # Amplitude analysis
            peak_amp = _sf(np.max(rectified))
            mean_amp = _sf(np.mean(rectified))
            rms_amp = _sf(np.sqrt(np.mean(rectified ** 2)))
            iemg = _sf(np.trapz(rectified, dx=1.0 / fs))

            # Frequency analysis (full signal)
            freqs_full, psd_full = sp_signal.welch(filtered, fs=fs,
                                                     nperseg=min(1024, n_samples))
            cumsum_full = np.cumsum(psd_full)
            total_power_full = cumsum_full[-1] if len(cumsum_full) > 0 else 0
            if total_power_full > 0:
                med_freq_full = freqs_full[np.searchsorted(cumsum_full, total_power_full / 2)]
                mean_freq_full = np.sum(freqs_full * psd_full) / np.sum(psd_full)
                # Bandwidth (spectral standard deviation)
                bw = np.sqrt(np.sum((freqs_full - mean_freq_full) ** 2 * psd_full) / np.sum(psd_full))
            else:
                med_freq_full = mean_freq_full = bw = 0.0

            ch_result = {
                "channel": ch,
                "amplitude_metrics": {
                    "peak": peak_amp, "mean": mean_amp, "rms": rms_amp,
                    "iEMG": iemg,
                },
                "frequency_metrics": {
                    "median_frequency_Hz": _sf(med_freq_full),
                    "mean_frequency_Hz": _sf(mean_freq_full),
                    "bandwidth_Hz": _sf(bw),
                    "total_power": _sf(total_power_full),
                },
                "fatigue_metrics": {
                    "fatigue_slope_Hz_per_s": fatigue_slope,
                    "fatigue_r_squared": fatigue_r2,
                    "median_freq_trend": median_freqs[:50],
                    "mean_freq_trend": mean_freqs[:50],
                    "time_windows": time_windows[:50],
                    "FInsm5": finsm5_values[:50],
                },
                "onset_detection": {
                    "onsets": onsets[:100],
                    "offsets": offsets[:100],
                    "n_bursts": len(onsets),
                    "threshold": _sf(h),
                },
                "envelope_rms": rms_env_norm[:500].tolist(),
                "envelope_linear": linear_env_norm[:500].tolist(),
            }
            results_channels.append(ch_result)

        # Figures (first channel)
        try:
            import matplotlib
            matplotlib.use("Agg")
            import matplotlib.pyplot as plt

            t = np.arange(n_samples) / fs

            # Raw + envelope
            fig1, (ax1a, ax1b) = plt.subplots(2, 1, figsize=(10, 6), sharex=True)
            ax1a.plot(t, emg_raw[0], "b-", linewidth=0.3, alpha=0.5)
            ax1a.set_ylabel("Raw EMG")
            ax1a.set_title("EMG Signal")
            # Use the first channel results for envelope
            env_len = min(len(results_channels[0]["envelope_rms"]), n_samples)
            ax1b.plot(t[:env_len], results_channels[0]["envelope_rms"][:env_len], "r-", linewidth=1)
            ax1b.set_ylabel("RMS Envelope")
            ax1b.set_xlabel("Time (s)")
            for onset in results_channels[0]["onset_detection"]["onsets"][:20]:
                ax1b.axvline(onset / fs, color="g", linestyle="--", alpha=0.5)
            figures.append(GeneratedFigure(title="EMG Signal & Envelope", format="svg",
                                            data=_fig_to_b64(fig1)))
            plt.close(fig1)

            # Power spectrum
            fig2, ax2 = plt.subplots(figsize=(8, 4))
            ax2.semilogy(freqs_full, psd_full, "b-")
            ax2.axvline(med_freq_full, color="r", linestyle="--", label=f"Median: {med_freq_full:.0f} Hz")
            ax2.axvline(mean_freq_full, color="g", linestyle="--", label=f"Mean: {mean_freq_full:.0f} Hz")
            ax2.set_xlabel("Frequency (Hz)")
            ax2.set_ylabel("PSD")
            ax2.set_title("EMG Power Spectrum")
            ax2.legend()
            figures.append(GeneratedFigure(title="EMG Spectrum", format="svg",
                                            data=_fig_to_b64(fig2)))
            plt.close(fig2)

            # Fatigue trend
            if len(time_windows) > 2:
                fig3, ax3 = plt.subplots(figsize=(8, 4))
                ax3.plot(time_windows, median_freqs, "bo-", markersize=3, label="Median Freq")
                ax3.plot(time_windows, mean_freqs, "rs-", markersize=3, label="Mean Freq")
                if fatigue_r2 > 0.1:
                    tw = np.array(time_windows)
                    ax3.plot(tw, fatigue_slope * tw + (median_freqs[0] - fatigue_slope * tw[0]),
                             "k--", label=f"Slope={fatigue_slope:.2f} Hz/s")
                ax3.set_xlabel("Time (s)")
                ax3.set_ylabel("Frequency (Hz)")
                ax3.set_title("EMG Fatigue Analysis")
                ax3.legend()
                figures.append(GeneratedFigure(title="Fatigue Trend", format="svg",
                                                data=_fig_to_b64(fig3)))
                plt.close(fig3)
        except ImportError:
            pass

        return ComputeResult(
            request_id=request.id, domain=ComputeDomain.BIOMECHANICS,
            operation="emg_processing", status=ComputeStatus.COMPLETED,
            results={"channels": results_channels, "n_channels": n_channels},
            figures=figures,
        )

    # ── 2. Finite Element Bone Analysis ────────────────────────────

    async def _finite_element_bone(self, request: ComputeRequest, progress_callback) -> ComputeResult:
        p = request.parameters
        nodes = np.asarray(p["nodes"], dtype=np.float64)  # (n_nodes, 3)
        elements = np.asarray(p["elements"], dtype=int)     # (n_elem, 4) for tetrahedra
        figures = []

        # Material properties
        E_default = float(p.get("youngs_modulus", 17000))  # MPa (cortical bone)
        nu = float(p.get("poissons_ratio", 0.3))

        # Per-element modulus from CT density if provided
        if "ct_density" in p:
            rho = np.asarray(p["ct_density"], dtype=np.float64)  # per element
            a_coeff = float(p.get("density_modulus_a", 6.85))  # Morgan 2003
            b_coeff = float(p.get("density_modulus_b", 1.49))
            E_elem = a_coeff * (np.abs(rho) ** b_coeff)
            E_elem = np.clip(E_elem, 1.0, 30000.0)
        else:
            E_elem = np.full(len(elements), E_default)

        n_nodes = len(nodes)
        n_dof = n_nodes * 3

        # Isotropic elasticity matrix D (6x6 Voigt)
        def make_D(E, nu_val):
            lam = E * nu_val / ((1 + nu_val) * (1 - 2 * nu_val))
            mu = E / (2 * (1 + nu_val))
            D = np.array([
                [lam + 2*mu, lam, lam, 0, 0, 0],
                [lam, lam + 2*mu, lam, 0, 0, 0],
                [lam, lam, lam + 2*mu, 0, 0, 0],
                [0, 0, 0, mu, 0, 0],
                [0, 0, 0, 0, mu, 0],
                [0, 0, 0, 0, 0, mu],
            ])
            return D

        # 4-node tetrahedral element stiffness: K_e = V * B^T * D * B
        rows_list, cols_list, vals_list = [], [], []

        elem_volumes = np.zeros(len(elements))
        for e_idx, elem in enumerate(elements):
            n0, n1, n2, n3 = elem
            x = nodes[[n0, n1, n2, n3]]

            # Shape function derivatives (constant for linear tet)
            # Jacobian: J = [x1-x0, x2-x0, x3-x0]^T
            J = np.array([x[1] - x[0], x[2] - x[0], x[3] - x[0]]).T
            det_J = np.linalg.det(J)
            if abs(det_J) < 1e-15:
                continue
            V = abs(det_J) / 6.0
            elem_volumes[e_idx] = V

            J_inv = np.linalg.inv(J)
            # dN/dx for 4-node tet
            dNdxi = np.array([[-1, -1, -1], [1, 0, 0], [0, 1, 0], [0, 0, 1]]).T
            dNdx = J_inv @ dNdxi  # 3x4

            # B matrix (6x12)
            B = np.zeros((6, 12))
            for i in range(4):
                B[0, 3*i] = dNdx[0, i]
                B[1, 3*i+1] = dNdx[1, i]
                B[2, 3*i+2] = dNdx[2, i]
                B[3, 3*i] = dNdx[1, i]; B[3, 3*i+1] = dNdx[0, i]
                B[4, 3*i+1] = dNdx[2, i]; B[4, 3*i+2] = dNdx[1, i]
                B[5, 3*i] = dNdx[2, i]; B[5, 3*i+2] = dNdx[0, i]

            D = make_D(E_elem[e_idx], nu)
            Ke = V * (B.T @ D @ B)

            # Assembly into global sparse matrix
            dofs = []
            for ni in elem:
                dofs.extend([3*ni, 3*ni+1, 3*ni+2])
            for i in range(12):
                for j in range(12):
                    if abs(Ke[i, j]) > 1e-15:
                        rows_list.append(dofs[i])
                        cols_list.append(dofs[j])
                        vals_list.append(Ke[i, j])

        # Assemble global stiffness
        K_global = sparse.csr_matrix((vals_list, (rows_list, cols_list)), shape=(n_dof, n_dof))

        # Force vector
        F = np.zeros(n_dof)
        if "forces" in p:
            for force_spec in p["forces"]:
                node_id = int(force_spec["node"])
                fx, fy, fz = float(force_spec.get("fx", 0)), float(force_spec.get("fy", 0)), float(force_spec.get("fz", 0))
                F[3*node_id] += fx
                F[3*node_id+1] += fy
                F[3*node_id+2] += fz

        # Boundary conditions (fixed nodes) — penalty method
        fixed_nodes = p.get("fixed_nodes", [])
        penalty = 1e20
        for fn in fixed_nodes:
            fn = int(fn)
            for d in range(3):
                dof = 3 * fn + d
                K_global[dof, dof] += penalty

        # Solve
        try:
            u = sparse.linalg.spsolve(K_global, F)
        except Exception as exc:
            return ComputeResult(
                request_id=request.id, domain=ComputeDomain.BIOMECHANICS,
                operation="finite_element_bone", status=ComputeStatus.FAILED,
                error=f"Solver failed: {exc}",
            )

        # Post-processing: element strains and stresses
        elem_strains = np.zeros((len(elements), 6))
        elem_stresses = np.zeros((len(elements), 6))
        von_mises = np.zeros(len(elements))
        principal_stresses = np.zeros((len(elements), 3))
        strain_energy = np.zeros(len(elements))

        for e_idx, elem in enumerate(elements):
            if elem_volumes[e_idx] < 1e-15:
                continue
            n0, n1, n2, n3 = elem
            x = nodes[[n0, n1, n2, n3]]
            J = np.array([x[1] - x[0], x[2] - x[0], x[3] - x[0]]).T
            J_inv = np.linalg.inv(J)
            dNdxi = np.array([[-1, -1, -1], [1, 0, 0], [0, 1, 0], [0, 0, 1]]).T
            dNdx = J_inv @ dNdxi

            B = np.zeros((6, 12))
            for i in range(4):
                B[0, 3*i] = dNdx[0, i]
                B[1, 3*i+1] = dNdx[1, i]
                B[2, 3*i+2] = dNdx[2, i]
                B[3, 3*i] = dNdx[1, i]; B[3, 3*i+1] = dNdx[0, i]
                B[4, 3*i+1] = dNdx[2, i]; B[4, 3*i+2] = dNdx[1, i]
                B[5, 3*i] = dNdx[2, i]; B[5, 3*i+2] = dNdx[0, i]

            dofs = []
            for ni in elem:
                dofs.extend([3*ni, 3*ni+1, 3*ni+2])
            u_e = u[dofs]

            strain = B @ u_e
            D = make_D(E_elem[e_idx], nu)
            stress = D @ strain

            elem_strains[e_idx] = strain
            elem_stresses[e_idx] = stress

            # Von Mises stress
            s = stress
            vm = math.sqrt(0.5 * ((s[0]-s[1])**2 + (s[1]-s[2])**2 + (s[2]-s[0])**2 + 6*(s[3]**2+s[4]**2+s[5]**2)))
            von_mises[e_idx] = vm

            # Principal stresses (eigenvalues of stress tensor)
            stress_tensor = np.array([[s[0], s[3], s[5]], [s[3], s[1], s[4]], [s[5], s[4], s[2]]])
            eigvals = np.sort(np.linalg.eigvalsh(stress_tensor))[::-1]
            principal_stresses[e_idx] = eigvals

            # Strain energy density
            strain_energy[e_idx] = 0.5 * np.dot(stress, strain)

        # Failure criterion: max principal strain > 0.7% for cortical bone
        failure_threshold = float(p.get("failure_strain", 0.007))
        max_principal_strain = np.max(elem_strains[:, :3], axis=1)
        failure_risk = (max_principal_strain > failure_threshold).astype(float)

        # Nodal displacements reshaped
        displ = u.reshape(-1, 3)

        return ComputeResult(
            request_id=request.id, domain=ComputeDomain.BIOMECHANICS,
            operation="finite_element_bone", status=ComputeStatus.COMPLETED,
            results={
                "max_displacement_mm": _sf(np.max(np.linalg.norm(displ, axis=1))),
                "max_von_mises_MPa": _sf(np.max(von_mises)),
                "mean_von_mises_MPa": _sf(np.mean(von_mises)),
                "max_principal_stress_MPa": _sf(np.max(principal_stresses)),
                "n_elements_at_risk": int(np.sum(failure_risk)),
                "total_strain_energy": _sf(np.sum(strain_energy * elem_volumes)),
                "displacements_summary": {
                    "max_x": _sf(np.max(displ[:, 0])), "max_y": _sf(np.max(displ[:, 1])),
                    "max_z": _sf(np.max(displ[:, 2])),
                },
                "von_mises_percentiles": {
                    "p50": _sf(np.percentile(von_mises, 50)),
                    "p95": _sf(np.percentile(von_mises, 95)),
                    "p99": _sf(np.percentile(von_mises, 99)),
                },
            },
            figures=figures,
        )

    # ── 3. Micro-CT Morphometry ────────────────────────────────────

    async def _micro_ct_morphometry(self, request: ComputeRequest, progress_callback) -> ComputeResult:
        p = request.parameters
        volume = np.asarray(p["binary_volume"], dtype=np.uint8)  # 3D: 1=bone, 0=marrow
        voxel_size = float(p.get("voxel_size_mm", 0.01))  # mm
        figures = []

        if volume.ndim != 3:
            return ComputeResult(
                request_id=request.id, domain=ComputeDomain.BIOMECHANICS,
                operation="micro_ct_morphometry", status=ComputeStatus.FAILED,
                error="binary_volume must be 3D array",
            )

        bone = volume > 0
        marrow = ~bone
        total_voxels = bone.size
        bone_voxels = np.sum(bone)
        voxel_vol = voxel_size ** 3  # mm³

        # BV/TV: Bone Volume Fraction
        bv_tv = _sf(bone_voxels / total_voxels)

        # BS (Bone Surface): count bone-marrow interface faces
        # For each voxel face shared between bone and marrow
        face_area = voxel_size ** 2
        surface_faces = 0
        for axis in range(3):
            shifted = np.roll(bone, 1, axis=axis)
            # Boundary between bone and non-bone
            interface = bone != shifted
            # Exclude wrap-around artifacts at edge
            slicing = [slice(None)] * 3
            slicing[axis] = slice(1, None)
            surface_faces += np.sum(interface[tuple(slicing)])

        bs = surface_faces * face_area  # mm²
        bv = bone_voxels * voxel_vol  # mm³
        tv = total_voxels * voxel_vol

        bs_bv = _sf(bs / bv) if bv > 0 else 0.0  # 1/mm
        bs_tv = _sf(bs / tv) if tv > 0 else 0.0

        # Tb.Th: Trabecular Thickness (distance transform method)
        bone_dist = ndimage.distance_transform_edt(bone, sampling=voxel_size)
        # Local thickness = 2 * distance at medial axis points
        # Simplified: mean of distance transform within bone * 2
        tb_th = _sf(2.0 * np.mean(bone_dist[bone])) if bone_voxels > 0 else 0.0

        # Tb.Sp: Trabecular Separation (distance transform of marrow)
        marrow_dist = ndimage.distance_transform_edt(marrow, sampling=voxel_size)
        tb_sp = _sf(2.0 * np.mean(marrow_dist[marrow])) if np.sum(marrow) > 0 else 0.0

        # Tb.N: Trabecular Number
        tb_n = _sf(bv_tv / tb_th) if tb_th > 0 else 0.0

        # SMI: Structure Model Index (0=plate, 3=rod, 4=sphere)
        # SMI = 6 * (S' * V) / S^2 where S' is derivative of surface w.r.t. dilation
        # Dilate bone by 1 voxel and measure surface change
        dilated = ndimage.binary_dilation(bone, iterations=1)
        dilated_voxels = np.sum(dilated)
        dil_surface = 0
        for axis in range(3):
            shifted = np.roll(dilated, 1, axis=axis)
            interface = dilated != shifted
            slicing = [slice(None)] * 3
            slicing[axis] = slice(1, None)
            dil_surface += np.sum(interface[tuple(slicing)])
        bs_dilated = dil_surface * face_area
        s_prime = (bs_dilated - bs) / voxel_size
        smi = _sf(6 * s_prime * bv / (bs ** 2)) if bs > 0 else 0.0

        # DA: Degree of Anisotropy (Mean Intercept Length tensor — simplified)
        # Cast rays in multiple directions and count bone/marrow transitions
        n_directions = 13  # Approximate MIL with grid-aligned + diagonal directions
        directions = [
            (1,0,0), (0,1,0), (0,0,1),
            (1,1,0), (1,0,1), (0,1,1),
            (1,-1,0), (1,0,-1), (0,1,-1),
            (1,1,1), (1,1,-1), (1,-1,1), (-1,1,1),
        ]
        mil_values = []
        for d in directions:
            # Sample random lines in this direction
            total_length = 0.0
            total_transitions = 0
            # Project along primary axis
            primary_axis = np.argmax(np.abs(d))
            n_samples = min(200, volume.shape[(primary_axis + 1) % 3])
            for _ in range(n_samples):
                # Random start point
                start = [np.random.randint(0, max(s-1, 1)) for s in volume.shape]
                length = 0
                transitions = 0
                prev_val = bone[tuple(start)]
                pos = list(start)
                for step in range(max(volume.shape)):
                    pos = [int(pos[k] + d[k]) for k in range(3)]
                    if any(pos[k] < 0 or pos[k] >= volume.shape[k] for k in range(3)):
                        break
                    curr_val = bone[tuple(pos)]
                    if curr_val != prev_val:
                        transitions += 1
                    prev_val = curr_val
                    length += np.sqrt(sum((dk * voxel_size) ** 2 for dk in d))
                total_length += length
                total_transitions += transitions
            mil = total_length / max(total_transitions, 1)
            mil_values.append(mil)

        mil_arr = np.array(mil_values)
        da = _sf(np.max(mil_arr) / np.min(mil_arr)) if np.min(mil_arr) > 0 else 1.0

        # Conn.D: Connectivity Density via Euler characteristic
        # Euler number approximation using voxel-based method
        labeled, n_components = ndimage.label(bone)
        # Simplified: Conn.D ~ (1 - Euler number) / TV
        # For trabecular bone, use simplified formula
        euler_number = n_components  # Approximate
        conn_d = _sf((1 - euler_number) / tv) if tv > 0 else 0.0

        # FD: Fractal Dimension (box counting)
        box_sizes = [2, 4, 8, 16, 32]
        box_counts = []
        for box_size in box_sizes:
            if box_size >= min(volume.shape):
                continue
            # Downsample by block max
            shape_trimmed = tuple(s - s % box_size for s in volume.shape)
            trimmed = bone[:shape_trimmed[0], :shape_trimmed[1], :shape_trimmed[2]]
            new_shape = tuple(s // box_size for s in shape_trimmed)
            if any(s == 0 for s in new_shape):
                continue
            reshaped = trimmed.reshape(new_shape[0], box_size, new_shape[1], box_size, new_shape[2], box_size)
            box_occupied = np.any(reshaped, axis=(1, 3, 5))
            box_counts.append(np.sum(box_occupied))

        fd = 0.0
        if len(box_counts) >= 2:
            valid_sizes = [s for s in box_sizes if s < min(volume.shape)][:len(box_counts)]
            log_sizes = np.log(1.0 / np.array(valid_sizes, dtype=float))
            log_counts = np.log(np.array(box_counts, dtype=float) + 1)
            if len(log_sizes) >= 2:
                fd = _sf(np.polyfit(log_sizes, log_counts, 1)[0])

        # Thickness distribution
        if bone_voxels > 0:
            thickness_vals = bone_dist[bone] * 2
            th_hist, th_bins = np.histogram(thickness_vals, bins=20)
            thickness_dist = {"counts": th_hist.tolist(),
                              "bin_edges": [_sf(b) for b in th_bins]}
        else:
            thickness_dist = {"counts": [], "bin_edges": []}

        morphometry = {
            "BV_TV": bv_tv, "BS_BV_1_mm": bs_bv, "BS_TV_1_mm": bs_tv,
            "Tb_Th_mm": tb_th, "Tb_Sp_mm": tb_sp, "Tb_N_1_mm": tb_n,
            "SMI": smi, "DA": da,
            "Conn_D_1_mm3": conn_d, "FD": fd,
            "BV_mm3": _sf(bv), "TV_mm3": _sf(tv), "BS_mm2": _sf(bs),
            "n_bone_voxels": int(bone_voxels),
            "thickness_distribution": thickness_dist,
        }

        return ComputeResult(
            request_id=request.id, domain=ComputeDomain.BIOMECHANICS,
            operation="micro_ct_morphometry", status=ComputeStatus.COMPLETED,
            results=morphometry,
            figures=figures,
        )

    # ── 4. Muscle Force Estimation (Static Optimization) ───────────

    async def _muscle_force_estimation(self, request: ComputeRequest, progress_callback) -> ComputeResult:
        p = request.parameters
        joint_moments = p["joint_moments"]  # dict: {joint_name: [moment_timeseries]}
        muscle_params = p["muscle_parameters"]  # dict: {muscle_name: {max_force, moment_arm, ...}}
        exponent = int(p.get("cost_exponent", 2))

        joints = list(joint_moments.keys())
        muscles = list(muscle_params.keys())
        n_muscles = len(muscles)

        # Get timeseries length
        first_joint = joints[0]
        moments = np.asarray(joint_moments[first_joint], dtype=np.float64)
        if moments.ndim == 0:
            moments = moments.reshape(1)
        n_timesteps = len(moments)

        # Build muscle parameter arrays
        f_max = np.array([float(muscle_params[m].get("max_isometric_force", 1000)) for m in muscles])
        moment_arms = {}
        for j in joints:
            moment_arms[j] = np.array([float(muscle_params[m].get(f"moment_arm_{j}",
                                              muscle_params[m].get("moment_arm", 0.05))) for m in muscles])

        # Force-length relationship (Gaussian approximation)
        def force_length(norm_length):
            return np.exp(-((norm_length - 1.0) / 0.45) ** 2)

        opt_lengths = np.array([float(muscle_params[m].get("optimal_length", 0.1)) for m in muscles])
        pennation = np.array([float(muscle_params[m].get("pennation_angle", 0)) for m in muscles])
        cos_penn = np.cos(np.radians(pennation))

        # Solve at each timestep
        all_activations = np.zeros((n_timesteps, n_muscles))
        all_forces = np.zeros((n_timesteps, n_muscles))
        all_costs = np.zeros(n_timesteps)
        all_residuals = np.zeros(n_timesteps)

        for t_idx in range(n_timesteps):
            # Target moments for this timestep
            target = {}
            for j in joints:
                jm = np.asarray(joint_moments[j], dtype=np.float64)
                target[j] = float(jm[t_idx]) if t_idx < len(jm) else 0.0

            # Objective: minimize sum(a_i^p)
            def objective(a):
                return np.sum(a ** exponent)

            # Constraints: sum(F_i * r_ij) = M_j for each joint
            constraints = []
            for j in joints:
                r = moment_arms[j]
                M_target = target[j]
                constraints.append({
                    "type": "eq",
                    "fun": lambda a, r=r, Mt=M_target: np.sum(a * f_max * cos_penn * r) - Mt,
                })

            # Bounds: 0 <= a_i <= 1
            bounds = [(0, 1)] * n_muscles
            a0 = np.full(n_muscles, 0.1)

            try:
                res = optimize.minimize(objective, a0, method="SLSQP",
                                         bounds=bounds, constraints=constraints,
                                         options={"maxiter": 200})
                a_opt = np.clip(res.x, 0, 1)
                all_activations[t_idx] = a_opt
                all_forces[t_idx] = a_opt * f_max * cos_penn
                all_costs[t_idx] = res.fun

                # Residuals
                for j in joints:
                    produced = np.sum(all_forces[t_idx] * moment_arms[j])
                    all_residuals[t_idx] += abs(produced - target[j])
            except Exception:
                all_activations[t_idx] = 0.0
                all_forces[t_idx] = 0.0

        return ComputeResult(
            request_id=request.id, domain=ComputeDomain.BIOMECHANICS,
            operation="muscle_force_estimation", status=ComputeStatus.COMPLETED,
            results={
                "muscle_names": muscles,
                "activations": all_activations.tolist(),
                "forces_N": all_forces.tolist(),
                "cost_function": [_sf(c) for c in all_costs],
                "residuals": [_sf(r) for r in all_residuals],
                "mean_activations": {m: _sf(np.mean(all_activations[:, i])) for i, m in enumerate(muscles)},
                "peak_forces": {m: _sf(np.max(all_forces[:, i])) for i, m in enumerate(muscles)},
            },
        )

    # ── 5. Body Segment Parameters ─────────────────────────────────

    async def _body_segment_parameters(self, request: ComputeRequest, progress_callback) -> ComputeResult:
        p = request.parameters
        body_mass = float(p["body_mass"])  # kg
        body_height = float(p["body_height"])  # m
        sex = p.get("sex", "male").lower()
        model = p.get("model", "de_leva_1996")

        # De Leva 1996 parameters (male/female)
        if model == "de_leva_1996":
            if sex == "male":
                segments = {
                    "head": {"mass_frac": 0.0694, "com_frac": 0.5002, "length_frac": 0.1395,
                             "rg_prox": 0.303, "rg_dist": 0.315, "rg_cg": 0.261},
                    "trunk": {"mass_frac": 0.4346, "com_frac": 0.4486, "length_frac": 0.2880,
                              "rg_prox": 0.372, "rg_dist": 0.347, "rg_cg": 0.191},
                    "upper_arm": {"mass_frac": 0.0271, "com_frac": 0.5772, "length_frac": 0.1860,
                                  "rg_prox": 0.285, "rg_dist": 0.269, "rg_cg": 0.158},
                    "forearm": {"mass_frac": 0.0162, "com_frac": 0.4574, "length_frac": 0.1460,
                                "rg_prox": 0.276, "rg_dist": 0.265, "rg_cg": 0.121},
                    "hand": {"mass_frac": 0.0061, "com_frac": 0.7900, "length_frac": 0.1080,
                             "rg_prox": 0.628, "rg_dist": 0.513, "rg_cg": 0.401},
                    "thigh": {"mass_frac": 0.1416, "com_frac": 0.4095, "length_frac": 0.2320,
                              "rg_prox": 0.329, "rg_dist": 0.311, "rg_cg": 0.149},
                    "shank": {"mass_frac": 0.0433, "com_frac": 0.4459, "length_frac": 0.2470,
                              "rg_prox": 0.255, "rg_dist": 0.249, "rg_cg": 0.103},
                    "foot": {"mass_frac": 0.0137, "com_frac": 0.4415, "length_frac": 0.1520,
                             "rg_prox": 0.257, "rg_dist": 0.245, "rg_cg": 0.124},
                }
            else:  # female
                segments = {
                    "head": {"mass_frac": 0.0668, "com_frac": 0.4841, "length_frac": 0.1395,
                             "rg_prox": 0.271, "rg_dist": 0.295, "rg_cg": 0.261},
                    "trunk": {"mass_frac": 0.4257, "com_frac": 0.4964, "length_frac": 0.2880,
                              "rg_prox": 0.357, "rg_dist": 0.339, "rg_cg": 0.171},
                    "upper_arm": {"mass_frac": 0.0255, "com_frac": 0.5754, "length_frac": 0.1730,
                                  "rg_prox": 0.278, "rg_dist": 0.260, "rg_cg": 0.148},
                    "forearm": {"mass_frac": 0.0138, "com_frac": 0.4559, "length_frac": 0.1380,
                                "rg_prox": 0.261, "rg_dist": 0.257, "rg_cg": 0.118},
                    "hand": {"mass_frac": 0.0056, "com_frac": 0.7474, "length_frac": 0.1000,
                             "rg_prox": 0.531, "rg_dist": 0.454, "rg_cg": 0.351},
                    "thigh": {"mass_frac": 0.1478, "com_frac": 0.3612, "length_frac": 0.2490,
                              "rg_prox": 0.369, "rg_dist": 0.364, "rg_cg": 0.162},
                    "shank": {"mass_frac": 0.0481, "com_frac": 0.4416, "length_frac": 0.2570,
                              "rg_prox": 0.271, "rg_dist": 0.267, "rg_cg": 0.114},
                    "foot": {"mass_frac": 0.0129, "com_frac": 0.4014, "length_frac": 0.1430,
                             "rg_prox": 0.299, "rg_dist": 0.279, "rg_cg": 0.139},
                }
        else:
            # Dempster 1955 simplified
            segments = {
                "head": {"mass_frac": 0.081, "com_frac": 0.500, "length_frac": 0.130},
                "trunk": {"mass_frac": 0.497, "com_frac": 0.500, "length_frac": 0.288},
                "upper_arm": {"mass_frac": 0.028, "com_frac": 0.436, "length_frac": 0.186},
                "forearm": {"mass_frac": 0.016, "com_frac": 0.430, "length_frac": 0.146},
                "hand": {"mass_frac": 0.006, "com_frac": 0.506, "length_frac": 0.108},
                "thigh": {"mass_frac": 0.100, "com_frac": 0.433, "length_frac": 0.232},
                "shank": {"mass_frac": 0.047, "com_frac": 0.433, "length_frac": 0.247},
                "foot": {"mass_frac": 0.014, "com_frac": 0.500, "length_frac": 0.152},
            }

        result_segments = {}
        for name, params in segments.items():
            seg_mass = body_mass * params["mass_frac"]
            seg_length = body_height * params["length_frac"]
            com_pos = seg_length * params["com_frac"]
            # Moment of inertia: I = m * (rg * L)^2
            rg = params.get("rg_cg", 0.15)
            inertia = seg_mass * (rg * seg_length) ** 2

            result_segments[name] = {
                "mass_kg": _sf(seg_mass),
                "length_m": _sf(seg_length),
                "com_from_proximal_m": _sf(com_pos),
                "com_fraction": _sf(params["com_frac"]),
                "moment_of_inertia_kg_m2": _sf(inertia),
                "radius_of_gyration": _sf(rg),
            }

        return ComputeResult(
            request_id=request.id, domain=ComputeDomain.BIOMECHANICS,
            operation="body_segment_parameters", status=ComputeStatus.COMPLETED,
            results={"model": model, "sex": sex, "body_mass_kg": body_mass,
                     "body_height_m": body_height, "segments": result_segments},
        )

    # ── 6. Gait Events Detection ───────────────────────────────────

    async def _gait_events(self, request: ComputeRequest, progress_callback) -> ComputeResult:
        p = request.parameters
        fs = float(p.get("sampling_rate", 100))
        method = p.get("method", "kinematic")
        figures = []

        if method in ("kinematic", "combined"):
            # Zeni et al. 2008: heel/toe marker velocity relative to pelvis
            heel = np.asarray(p.get("heel_marker", p.get("marker_data", [])), dtype=np.float64)
            if heel.ndim == 1:
                # 1D: AP position of heel marker relative to pelvis
                pos = heel
            elif heel.ndim == 2:
                # Take AP (first) component
                pos = heel[:, 0]
            else:
                pos = heel.flatten()

            n_samples = len(pos)
            if n_samples < 10:
                return ComputeResult(request_id=request.id, domain=ComputeDomain.BIOMECHANICS,
                                      operation="gait_events", status=ComputeStatus.FAILED,
                                      error="Insufficient marker data")

            # Velocity
            vel = np.gradient(pos, 1.0 / fs)

            # Heel strikes: local maxima of heel AP position (foot most anterior)
            hs_indices, _ = sp_signal.find_peaks(pos, distance=int(0.4 * fs),
                                                   prominence=0.01 * np.ptp(pos))
            # Toe offs: local minima of heel AP position (foot most posterior)
            to_indices, _ = sp_signal.find_peaks(-pos, distance=int(0.4 * fs),
                                                   prominence=0.01 * np.ptp(pos))

            heel_strikes = sorted([int(x) for x in hs_indices])
            toe_offs = sorted([int(x) for x in to_indices])

        elif method == "kinetic":
            # GRF threshold crossing
            grf = np.asarray(p["grf_vertical"], dtype=np.float64)
            threshold = float(p.get("grf_threshold_N", 20))

            heel_strikes = []
            toe_offs = []
            in_stance = grf[0] > threshold
            for i in range(1, len(grf)):
                if not in_stance and grf[i] > threshold:
                    heel_strikes.append(i)
                    in_stance = True
                elif in_stance and grf[i] < threshold:
                    toe_offs.append(i)
                    in_stance = False

            n_samples = len(grf)
        else:
            return ComputeResult(request_id=request.id, domain=ComputeDomain.BIOMECHANICS,
                                  operation="gait_events", status=ComputeStatus.FAILED,
                                  error=f"Unknown method: {method}")

        # Temporal parameters
        stride_times = []
        step_times = []
        stance_pcts = []
        swing_pcts = []
        double_support_pcts = []

        for i in range(len(heel_strikes) - 1):
            stride_time = (heel_strikes[i + 1] - heel_strikes[i]) / fs
            stride_times.append(stride_time)

            # Find toe off between these two heel strikes
            tos_between = [to for to in toe_offs if heel_strikes[i] < to < heel_strikes[i + 1]]
            if tos_between:
                stance_dur = (tos_between[0] - heel_strikes[i]) / fs
                swing_dur = stride_time - stance_dur
                stance_pcts.append(100 * stance_dur / stride_time if stride_time > 0 else 0)
                swing_pcts.append(100 * swing_dur / stride_time if stride_time > 0 else 0)

        # Step time (HS to next HS, if contralateral available)
        for i in range(len(heel_strikes) - 1):
            step_times.append((heel_strikes[i + 1] - heel_strikes[i]) / fs)

        cadence = _sf(60.0 / np.mean(step_times)) if step_times else 0.0

        # Spatial parameters (if position data available)
        spatial = {}
        if method == "kinematic" and heel.ndim >= 1:
            step_lengths = []
            for i in range(len(heel_strikes) - 1):
                sl = abs(pos[heel_strikes[i + 1]] - pos[heel_strikes[i]])
                step_lengths.append(_sf(sl))
            if step_lengths:
                spatial["mean_step_length_m"] = _sf(np.mean(step_lengths))
                spatial["stride_length_m"] = _sf(2 * np.mean(step_lengths))

        # Symmetry indices
        symmetry = {}
        if len(stride_times) >= 4:
            left = stride_times[::2]
            right = stride_times[1::2]
            if left and right:
                si = abs(np.mean(left) - np.mean(right)) / (0.5 * (np.mean(left) + np.mean(right))) * 100
                symmetry["stride_time_SI_percent"] = _sf(si)

        temporal = {
            "mean_stride_time_s": _sf(np.mean(stride_times)) if stride_times else 0.0,
            "std_stride_time_s": _sf(np.std(stride_times, ddof=1)) if len(stride_times) > 1 else 0.0,
            "mean_step_time_s": _sf(np.mean(step_times)) if step_times else 0.0,
            "mean_stance_percent": _sf(np.mean(stance_pcts)) if stance_pcts else 0.0,
            "mean_swing_percent": _sf(np.mean(swing_pcts)) if swing_pcts else 0.0,
            "cadence_steps_per_min": cadence,
            "n_strides": len(stride_times),
        }

        # Figure
        try:
            import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
            t_axis = np.arange(n_samples) / fs
            fig, ax = plt.subplots(figsize=(10, 4))
            if method in ("kinematic", "combined"):
                ax.plot(t_axis, pos, "b-", linewidth=0.8, label="Heel AP position")
            elif method == "kinetic":
                ax.plot(t_axis, grf, "b-", linewidth=0.8, label="Vertical GRF")
            for hs in heel_strikes:
                ax.axvline(hs / fs, color="g", linestyle="--", alpha=0.6, label="HS" if hs == heel_strikes[0] else "")
            for to in toe_offs:
                ax.axvline(to / fs, color="r", linestyle="--", alpha=0.6, label="TO" if to == toe_offs[0] else "")
            ax.set_xlabel("Time (s)"); ax.set_title("Gait Events"); ax.legend()
            figures.append(GeneratedFigure(title="Gait Events", format="svg", data=_fig_to_b64(fig)))
            plt.close(fig)
        except ImportError: pass

        return ComputeResult(
            request_id=request.id, domain=ComputeDomain.BIOMECHANICS,
            operation="gait_events", status=ComputeStatus.COMPLETED,
            results={"events": {"heel_strikes": heel_strikes, "toe_offs": toe_offs},
                     "temporal_parameters": temporal, "spatial_parameters": spatial,
                     "symmetry": symmetry, "method": method},
            figures=figures,
        )

    # ── 7. Joint Stiffness ─────────────────────────────────────────

    async def _joint_stiffness(self, request: ComputeRequest, progress_callback) -> ComputeResult:
        p = request.parameters
        angle = np.asarray(p["joint_angle"], dtype=np.float64)  # radians or degrees
        moment = np.asarray(p["joint_moment"], dtype=np.float64)  # Nm
        fs = float(p.get("sampling_rate", 100))
        angle_unit = p.get("angle_unit", "degrees")
        figures = []

        if angle_unit == "degrees":
            angle = np.radians(angle)

        if len(angle) != len(moment):
            min_len = min(len(angle), len(moment))
            angle = angle[:min_len]
            moment = moment[:min_len]

        # Quasi-static stiffness: dM/dθ via linear regression
        slope, intercept, r, p_val, se = sp_stats.linregress(angle, moment)
        stiffness_quasi = _sf(slope)  # Nm/rad
        r_squared = _sf(r ** 2)

        # Dynamic stiffness: second-order model I*θ'' + B*θ' + K*θ = M
        # System identification via least squares
        dt = 1.0 / fs
        theta_dot = np.gradient(angle, dt)
        theta_ddot = np.gradient(theta_dot, dt)

        # Build regression matrix: [θ'', θ', θ] * [I, B, K] = M
        # Remove mean from angle for better conditioning
        angle_centered = angle - np.mean(angle)
        A_matrix = np.column_stack([theta_ddot, theta_dot, angle_centered])
        try:
            params, residuals, rank, sv = np.linalg.lstsq(A_matrix, moment, rcond=None)
            I_est = _sf(params[0])  # kg·m² (inertia)
            B_est = _sf(params[1])  # Nm·s/rad (damping)
            K_est = _sf(params[2])  # Nm/rad (stiffness)

            # R² of dynamic model
            M_pred = A_matrix @ params
            ss_res = np.sum((moment - M_pred) ** 2)
            ss_tot = np.sum((moment - np.mean(moment)) ** 2)
            r2_dynamic = _sf(1 - ss_res / ss_tot) if ss_tot > 0 else 0.0
        except Exception:
            I_est = B_est = K_est = 0.0
            r2_dynamic = 0.0

        # Figure
        try:
            import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
            fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(12, 5))

            # Moment vs angle scatter with regression
            ax1.scatter(np.degrees(angle), moment, s=5, alpha=0.3, c="steelblue")
            ang_range = np.linspace(angle.min(), angle.max(), 100)
            ax1.plot(np.degrees(ang_range), slope * ang_range + intercept, "r-", linewidth=2,
                     label=f"K={stiffness_quasi:.1f} Nm/rad, R²={r_squared:.3f}")
            ax1.set_xlabel("Angle (deg)"); ax1.set_ylabel("Moment (Nm)")
            ax1.set_title("Quasi-static Stiffness"); ax1.legend()

            # Time series
            t = np.arange(len(angle)) / fs
            ax2.plot(t, moment, "b-", linewidth=0.8, label="Measured")
            if r2_dynamic > 0:
                ax2.plot(t, M_pred, "r--", linewidth=0.8, label=f"Model (R²={r2_dynamic:.3f})")
            ax2.set_xlabel("Time (s)"); ax2.set_ylabel("Moment (Nm)")
            ax2.set_title("Dynamic Model Fit"); ax2.legend()
            plt.tight_layout()
            figures.append(GeneratedFigure(title="Joint Stiffness", format="svg", data=_fig_to_b64(fig)))
            plt.close(fig)
        except ImportError: pass

        return ComputeResult(
            request_id=request.id, domain=ComputeDomain.BIOMECHANICS,
            operation="joint_stiffness", status=ComputeStatus.COMPLETED,
            results={
                "quasi_static_stiffness_Nm_per_rad": stiffness_quasi,
                "quasi_static_r_squared": r_squared,
                "dynamic_model": {
                    "inertia_kg_m2": I_est,
                    "damping_Nm_s_per_rad": B_est,
                    "stiffness_Nm_per_rad": K_est,
                    "r_squared": r2_dynamic,
                },
            },
            figures=figures,
        )
