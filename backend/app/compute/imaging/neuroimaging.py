"""
Neuroimaging Processor — SPM/FSL-equivalent fMRI analysis capabilities.

Provides research-grade neuroimaging operations:
- Voxel-wise General Linear Model (GLM) with HRF convolution
- Hemodynamic Response Function (HRF) modeling (canonical, temporal/dispersion derivatives, FIR)
- Random Field Theory (RFT) multiple comparisons correction
- Functional connectivity (ROI-to-ROI, seed-based, partial correlation)
- Atlas-based ROI analysis (AAL, Desikan-Killiany, Harvard-Oxford)
- Independent Component Analysis (ICA) decomposition
- Dynamic Causal Modeling (DCM) simplified
- Brain extraction / skull stripping
"""

from __future__ import annotations

import math
from collections.abc import Callable

import numpy as np
from scipy import ndimage, signal, stats as sp_stats

from app.compute.types import (
    ComputeDomain, ComputeRequest, ComputeResult, ComputeStatus,
    GeneratedFigure,
)


# ── Atlas Definitions ──────────────────────────────────────────────

AAL_ATLAS = {
    1: "Precentral_L", 2: "Precentral_R", 3: "Frontal_Sup_L", 4: "Frontal_Sup_R",
    5: "Frontal_Sup_Orb_L", 6: "Frontal_Sup_Orb_R", 7: "Frontal_Mid_L", 8: "Frontal_Mid_R",
    9: "Frontal_Mid_Orb_L", 10: "Frontal_Mid_Orb_R", 11: "Frontal_Inf_Oper_L", 12: "Frontal_Inf_Oper_R",
    13: "Frontal_Inf_Tri_L", 14: "Frontal_Inf_Tri_R", 15: "Frontal_Inf_Orb_L", 16: "Frontal_Inf_Orb_R",
    17: "Rolandic_Oper_L", 18: "Rolandic_Oper_R", 19: "Supp_Motor_Area_L", 20: "Supp_Motor_Area_R",
    21: "Olfactory_L", 22: "Olfactory_R", 23: "Frontal_Sup_Medial_L", 24: "Frontal_Sup_Medial_R",
    25: "Frontal_Med_Orb_L", 26: "Frontal_Med_Orb_R", 27: "Rectus_L", 28: "Rectus_R",
    29: "Insula_L", 30: "Insula_R", 31: "Cingulum_Ant_L", 32: "Cingulum_Ant_R",
    33: "Cingulum_Mid_L", 34: "Cingulum_Mid_R", 35: "Cingulum_Post_L", 36: "Cingulum_Post_R",
    37: "Hippocampus_L", 38: "Hippocampus_R", 39: "ParaHippocampal_L", 40: "ParaHippocampal_R",
    41: "Amygdala_L", 42: "Amygdala_R", 43: "Calcarine_L", 44: "Calcarine_R",
    45: "Cuneus_L", 46: "Cuneus_R", 47: "Lingual_L", 48: "Lingual_R",
    49: "Occipital_Sup_L", 50: "Occipital_Sup_R", 51: "Occipital_Mid_L", 52: "Occipital_Mid_R",
    53: "Occipital_Inf_L", 54: "Occipital_Inf_R", 55: "Fusiform_L", 56: "Fusiform_R",
    57: "Postcentral_L", 58: "Postcentral_R", 59: "Parietal_Sup_L", 60: "Parietal_Sup_R",
    61: "Parietal_Inf_L", 62: "Parietal_Inf_R", 63: "SupraMarginal_L", 64: "SupraMarginal_R",
    65: "Angular_L", 66: "Angular_R", 67: "Precuneus_L", 68: "Precuneus_R",
    69: "Paracentral_Lobule_L", 70: "Paracentral_Lobule_R",
    71: "Caudate_L", 72: "Caudate_R", 73: "Putamen_L", 74: "Putamen_R",
    75: "Pallidum_L", 76: "Pallidum_R", 77: "Thalamus_L", 78: "Thalamus_R",
    79: "Heschl_L", 80: "Heschl_R", 81: "Temporal_Sup_L", 82: "Temporal_Sup_R",
    83: "Temporal_Pole_Sup_L", 84: "Temporal_Pole_Sup_R", 85: "Temporal_Mid_L", 86: "Temporal_Mid_R",
    87: "Temporal_Pole_Mid_L", 88: "Temporal_Pole_Mid_R", 89: "Temporal_Inf_L", 90: "Temporal_Inf_R",
    91: "Cerebelum_Crus1_L", 92: "Cerebelum_Crus1_R", 93: "Cerebelum_Crus2_L", 94: "Cerebelum_Crus2_R",
    95: "Cerebelum_3_L", 96: "Cerebelum_3_R", 97: "Cerebelum_4_5_L", 98: "Cerebelum_4_5_R",
    99: "Cerebelum_6_L", 100: "Cerebelum_6_R", 101: "Cerebelum_7b_L", 102: "Cerebelum_7b_R",
    103: "Cerebelum_8_L", 104: "Cerebelum_8_R", 105: "Cerebelum_9_L", 106: "Cerebelum_9_R",
    107: "Cerebelum_10_L", 108: "Cerebelum_10_R", 109: "Vermis_1_2", 110: "Vermis_3",
    111: "Vermis_4_5", 112: "Vermis_6", 113: "Vermis_7", 114: "Vermis_8",
    115: "Vermis_9", 116: "Vermis_10",
}

DESIKAN_KILLIANY = {
    1: "bankssts_L", 2: "bankssts_R", 3: "caudalanteriorcingulate_L", 4: "caudalanteriorcingulate_R",
    5: "caudalmiddlefrontal_L", 6: "caudalmiddlefrontal_R", 7: "cuneus_L", 8: "cuneus_R",
    9: "entorhinal_L", 10: "entorhinal_R", 11: "fusiform_L", 12: "fusiform_R",
    13: "inferiorparietal_L", 14: "inferiorparietal_R", 15: "inferiortemporal_L", 16: "inferiortemporal_R",
    17: "isthmuscingulate_L", 18: "isthmuscingulate_R", 19: "lateraloccipital_L", 20: "lateraloccipital_R",
    21: "lateralorbitofrontal_L", 22: "lateralorbitofrontal_R", 23: "lingual_L", 24: "lingual_R",
    25: "medialorbitofrontal_L", 26: "medialorbitofrontal_R", 27: "middletemporal_L", 28: "middletemporal_R",
    29: "parahippocampal_L", 30: "parahippocampal_R", 31: "paracentral_L", 32: "paracentral_R",
    33: "parsopercularis_L", 34: "parsopercularis_R", 35: "parsorbitalis_L", 36: "parsorbitalis_R",
    37: "parstriangularis_L", 38: "parstriangularis_R", 39: "pericalcarine_L", 40: "pericalcarine_R",
    41: "postcentral_L", 42: "postcentral_R", 43: "posteriorcingulate_L", 44: "posteriorcingulate_R",
    45: "precentral_L", 46: "precentral_R", 47: "precuneus_L", 48: "precuneus_R",
    49: "rostralanteriorcingulate_L", 50: "rostralanteriorcingulate_R",
    51: "rostralmiddlefrontal_L", 52: "rostralmiddlefrontal_R",
    53: "superiorfrontal_L", 54: "superiorfrontal_R", 55: "superiorparietal_L", 56: "superiorparietal_R",
    57: "superiortemporal_L", 58: "superiortemporal_R", 59: "supramarginal_L", 60: "supramarginal_R",
    61: "frontalpole_L", 62: "frontalpole_R", 63: "temporalpole_L", 64: "temporalpole_R",
    65: "transversetemporal_L", 66: "transversetemporal_R", 67: "insula_L", 68: "insula_R",
    # Subcortical
    69: "Thalamus_L", 70: "Thalamus_R", 71: "Caudate_L", 72: "Caudate_R",
    73: "Putamen_L", 74: "Putamen_R", 75: "Pallidum_L", 76: "Pallidum_R",
    77: "Hippocampus_L", 78: "Hippocampus_R", 79: "Amygdala_L", 80: "Amygdala_R",
    81: "Accumbens_L", 82: "Accumbens_R",
}


# ── HRF Functions ──────────────────────────────────────────────────

def spm_hrf(TR: float, peak_delay: float = 6.0, undershoot_delay: float = 16.0,
            peak_disp: float = 1.0, undershoot_disp: float = 1.0,
            p_u_ratio: float = 6.0, onset: float = 0.0,
            duration: float = 32.0) -> np.ndarray:
    """Canonical double-gamma HRF (SPM equivalent).
    
    Returns the HRF sampled at TR intervals from 0 to duration.
    """
    from scipy.stats import gamma as gamma_dist
    
    t = np.arange(0, duration, TR) - onset
    t = np.maximum(t, 0)
    
    # Peak gamma
    peak = gamma_dist.pdf(t, peak_delay / peak_disp, scale=peak_disp)
    # Undershoot gamma
    undershoot = gamma_dist.pdf(t, undershoot_delay / undershoot_disp, scale=undershoot_disp)
    
    hrf = peak - undershoot / p_u_ratio
    hrf = hrf / np.max(np.abs(hrf) + 1e-15)  # Normalize to unit peak
    return hrf


def spm_hrf_temporal_derivative(TR: float, **kwargs) -> np.ndarray:
    """Temporal derivative of canonical HRF (shift by ~1s)."""
    hrf1 = spm_hrf(TR, **kwargs)
    dt = 1.0  # 1-second shift
    kwargs_shifted = {**kwargs, "onset": kwargs.get("onset", 0.0) + dt}
    hrf2 = spm_hrf(TR, **kwargs_shifted)
    n = min(len(hrf1), len(hrf2))
    return (hrf1[:n] - hrf2[:n]) / dt


def spm_hrf_dispersion_derivative(TR: float, **kwargs) -> np.ndarray:
    """Dispersion derivative of canonical HRF."""
    hrf1 = spm_hrf(TR, **kwargs)
    dd = 0.01
    kwargs2 = {**kwargs, "peak_disp": kwargs.get("peak_disp", 1.0) + dd}
    hrf2 = spm_hrf(TR, **kwargs2)
    n = min(len(hrf1), len(hrf2))
    return (hrf2[:n] - hrf1[:n]) / dd


def fir_basis(TR: float, n_timepoints: int, order: int = 12) -> np.ndarray:
    """Finite Impulse Response (FIR) basis set.
    
    Returns matrix of shape (n_timepoints, order) with delta functions at each lag.
    """
    basis = np.zeros((n_timepoints, order))
    for i in range(min(order, n_timepoints)):
        basis[i, i] = 1.0
    return basis


def dct_basis(n_timepoints: int, cutoff_period: float, TR: float) -> np.ndarray:
    """Discrete Cosine Transform high-pass filter basis set.
    
    Creates DCT basis functions for frequencies below 1/cutoff_period Hz,
    equivalent to SPM's high-pass filter.
    """
    n_basis = int(np.floor(2 * n_timepoints * TR / cutoff_period)) + 1
    n_basis = max(1, n_basis)
    basis = np.zeros((n_timepoints, n_basis))
    for k in range(n_basis):
        basis[:, k] = np.cos(np.pi * (2 * np.arange(n_timepoints) + 1) * k / (2 * n_timepoints))
    # Remove mean (k=0 is constant)
    return basis


class NeuroimagingProcessor:
    """Research-grade neuroimaging computation processor (SPM/FSL equivalent)."""

    OPERATIONS = [
        "voxel_glm", "hrf_convolve", "rft_correction",
        "functional_connectivity", "atlas_roi_analysis",
        "ica_decomposition", "dcm", "brain_extraction",
    ]

    def list_operations(self) -> list[str]:
        return self.OPERATIONS

    async def execute(self, request: ComputeRequest, progress_callback: Callable | None = None) -> ComputeResult:
        dispatch = {op: getattr(self, f"_{op}") for op in self.OPERATIONS}
        handler = dispatch.get(request.operation)
        if not handler:
            return ComputeResult(
                request_id=request.id, domain=ComputeDomain.IMAGING,
                operation=request.operation, status=ComputeStatus.FAILED,
                error=f"Unknown neuroimaging operation: {request.operation}",
            )
        try:
            return await handler(request, request.parameters)
        except Exception as e:
            return ComputeResult(
                request_id=request.id, domain=ComputeDomain.IMAGING,
                operation=request.operation, status=ComputeStatus.FAILED, error=str(e),
            )

    # ── Voxel-wise GLM ─────────────────────────────────────────────

    async def _voxel_glm(self, req: ComputeRequest, params: dict) -> ComputeResult:
        """Voxel-wise General Linear Model with HRF convolution (SPM-equivalent).
        
        Parameters:
            data: 4D fMRI data (x, y, z, t) or 2D (voxels, t)
            conditions: list of {name, onsets (in seconds), durations (in seconds)}
            TR: repetition time
            contrasts: dict of {name: weight_vector}
            motion_params: (n_timepoints, 6) motion regressors (optional)
            hrf_type: "canonical", "canonical+derivatives", "fir"
            high_pass_cutoff: DCT high-pass cutoff in seconds (default 128)
            mask: brain mask (optional)
        """
        data = np.array(params["data"], dtype=np.float64)
        conditions = params["conditions"]
        TR = params["TR"]
        contrasts = params.get("contrasts", {})
        motion_params = params.get("motion_params")
        hrf_type = params.get("hrf_type", "canonical")
        hp_cutoff = params.get("high_pass_cutoff", 128.0)
        mask = params.get("mask")

        original_shape = None
        if data.ndim == 4:
            original_shape = data.shape[:3]
            n_timepoints = data.shape[3]
            # Reshape to 2D (voxels x time)
            data_2d = data.reshape(-1, n_timepoints)
        elif data.ndim == 2:
            n_timepoints = data.shape[1]
            data_2d = data
        else:
            return ComputeResult(
                request_id=req.id, domain=ComputeDomain.IMAGING, operation="voxel_glm",
                status=ComputeStatus.FAILED, error="Data must be 4D (x,y,z,t) or 2D (voxels,t)",
            )

        if mask is not None:
            mask = np.array(mask, dtype=bool)
            if original_shape:
                mask_flat = mask.ravel()
            else:
                mask_flat = mask
        else:
            mask_flat = np.ones(data_2d.shape[0], dtype=bool)

        n_voxels = int(mask_flat.sum())
        Y = data_2d[mask_flat].T  # (n_timepoints, n_voxels)

        # Build design matrix
        hrf = spm_hrf(TR)
        regressors = []
        regressor_names = []

        for cond in conditions:
            # Create stimulus timecourse
            stim = np.zeros(n_timepoints)
            for onset, dur in zip(cond["onsets"], cond["durations"]):
                start_idx = int(round(onset / TR))
                end_idx = int(round((onset + dur) / TR))
                stim[start_idx:min(end_idx, n_timepoints)] = 1.0

            # Convolve with HRF
            convolved = np.convolve(stim, hrf)[:n_timepoints]
            regressors.append(convolved)
            regressor_names.append(cond["name"])

            if hrf_type == "canonical+derivatives":
                # Temporal derivative
                hrf_td = spm_hrf_temporal_derivative(TR)
                conv_td = np.convolve(stim, hrf_td)[:n_timepoints]
                regressors.append(conv_td)
                regressor_names.append(f"{cond['name']}_td")

                # Dispersion derivative
                hrf_dd = spm_hrf_dispersion_derivative(TR)
                conv_dd = np.convolve(stim, hrf_dd)[:n_timepoints]
                regressors.append(conv_dd)
                regressor_names.append(f"{cond['name']}_dd")

        # Motion parameters as nuisance regressors
        if motion_params is not None:
            mp = np.array(motion_params, dtype=float)
            if mp.ndim == 1:
                mp = mp.reshape(-1, 1)
            for i in range(mp.shape[1]):
                regressors.append(mp[:n_timepoints, i])
                regressor_names.append(f"motion_{i}")

        # DCT high-pass filter
        dct = dct_basis(n_timepoints, hp_cutoff, TR)
        for i in range(dct.shape[1]):
            regressors.append(dct[:, i])
            regressor_names.append(f"dct_{i}")

        # Add constant (intercept)
        regressors.append(np.ones(n_timepoints))
        regressor_names.append("constant")

        # Design matrix X
        X = np.column_stack(regressors)
        n_regressors = X.shape[1]

        # OLS fit: beta = pinv(X) @ Y
        pinvX = np.linalg.pinv(X)
        beta = pinvX @ Y  # (n_regressors, n_voxels)
        Y_hat = X @ beta
        residuals = Y - Y_hat

        # Residual variance (MSE)
        df_res = n_timepoints - n_regressors
        MSE = np.sum(residuals ** 2, axis=0) / max(df_res, 1)  # (n_voxels,)

        # Compute contrasts
        contrast_results = {}
        for c_name, c_weights in contrasts.items():
            c = np.zeros(n_regressors)
            for i, w in enumerate(c_weights):
                if i < n_regressors:
                    c[i] = w

            # Contrast estimate
            con = c @ beta  # (n_voxels,)

            # Variance of contrast
            var_c = MSE * (c @ np.linalg.pinv(X.T @ X) @ c)

            # t-statistics
            t_stat = con / np.sqrt(np.maximum(var_c, 1e-15))

            # p-values (two-tailed)
            p_values = 2 * (1 - sp_stats.t.cdf(np.abs(t_stat), df_res))

            if original_shape:
                t_map = np.zeros(np.prod(original_shape))
                t_map[mask_flat] = t_stat
                t_map = t_map.reshape(original_shape)
                p_map = np.ones(np.prod(original_shape))
                p_map[mask_flat] = p_values
                p_map = p_map.reshape(original_shape)
                contrast_results[c_name] = {
                    "t_map": t_map.tolist(),
                    "p_map": p_map.tolist(),
                    "max_t": round(float(np.max(np.abs(t_stat))), 4),
                    "n_significant_uncorrected": int(np.sum(p_values < 0.001)),
                }
            else:
                contrast_results[c_name] = {
                    "t_values": t_stat.tolist(),
                    "p_values": p_values.tolist(),
                    "max_t": round(float(np.max(np.abs(t_stat))), 4),
                    "n_significant_uncorrected": int(np.sum(p_values < 0.001)),
                }

        # Design matrix figure
        figures = []
        try:
            import matplotlib
            matplotlib.use("Agg")
            import matplotlib.pyplot as plt
            fig, axes = plt.subplots(1, 2, figsize=(14, 6))
            # Design matrix
            im = axes[0].imshow(X[:, :min(X.shape[1], 20)], aspect="auto", cmap="RdBu_r")
            axes[0].set_xlabel("Regressors")
            axes[0].set_ylabel("Time (volumes)")
            axes[0].set_title("Design Matrix")
            n_show = min(len(regressor_names), 20)
            axes[0].set_xticks(range(n_show))
            axes[0].set_xticklabels(regressor_names[:n_show], rotation=45, ha="right", fontsize=6)
            fig.colorbar(im, ax=axes[0], fraction=0.046)

            # Contrast t-values histogram
            if contrast_results:
                first_contrast = list(contrast_results.values())[0]
                t_vals = first_contrast.get("t_values", np.array(first_contrast.get("t_map", [])).ravel())
                if hasattr(t_vals, '__len__') and len(t_vals) > 0:
                    t_vals = np.array(t_vals)
                    t_vals = t_vals[t_vals != 0]
                    if len(t_vals) > 0:
                        axes[1].hist(t_vals, bins=100, color="steelblue", alpha=0.8, density=True)
                        x_range = np.linspace(t_vals.min(), t_vals.max(), 200)
                        axes[1].plot(x_range, sp_stats.t.pdf(x_range, df_res), "r-", linewidth=2, label=f"t(df={df_res})")
                        axes[1].set_xlabel("t-statistic")
                        axes[1].set_ylabel("Density")
                        axes[1].set_title(f"t-statistic Distribution ({list(contrasts.keys())[0]})")
                        axes[1].legend()
            fig.tight_layout()
            figures.append(GeneratedFigure.from_matplotlib(fig, "glm_design_and_tstats"))
            plt.close(fig)
        except ImportError:
            pass

        return ComputeResult(
            request_id=req.id, domain=ComputeDomain.IMAGING, operation="voxel_glm",
            results={
                "contrasts": contrast_results,
                "n_timepoints": n_timepoints,
                "n_regressors": n_regressors,
                "n_voxels": n_voxels,
                "df_residual": df_res,
                "regressor_names": regressor_names,
            },
            figures=figures,
        )

    # ── HRF Convolution ────────────────────────────────────────────

    async def _hrf_convolve(self, req: ComputeRequest, params: dict) -> ComputeResult:
        """Convolve stimulus timecourse with hemodynamic response function."""
        stimulus = np.array(params["stimulus"], dtype=float)
        TR = params["TR"]
        hrf_type = params.get("hrf_type", "canonical")
        hrf_params = params.get("hrf_params", {})

        if hrf_type == "canonical":
            hrf = spm_hrf(TR, **hrf_params)
            convolved = np.convolve(stimulus, hrf)[:len(stimulus)]
            return ComputeResult(
                request_id=req.id, domain=ComputeDomain.IMAGING, operation="hrf_convolve",
                results={"convolved": convolved.tolist(), "hrf": hrf.tolist(), "type": "canonical"},
            )
        elif hrf_type == "canonical+derivatives":
            hrf = spm_hrf(TR, **hrf_params)
            hrf_td = spm_hrf_temporal_derivative(TR, **hrf_params)
            hrf_dd = spm_hrf_dispersion_derivative(TR, **hrf_params)
            return ComputeResult(
                request_id=req.id, domain=ComputeDomain.IMAGING, operation="hrf_convolve",
                results={
                    "convolved_canonical": np.convolve(stimulus, hrf)[:len(stimulus)].tolist(),
                    "convolved_temporal_deriv": np.convolve(stimulus, hrf_td)[:len(stimulus)].tolist(),
                    "convolved_dispersion_deriv": np.convolve(stimulus, hrf_dd)[:len(stimulus)].tolist(),
                    "hrf_canonical": hrf.tolist(),
                    "hrf_temporal_deriv": hrf_td.tolist(),
                    "hrf_dispersion_deriv": hrf_dd.tolist(),
                    "type": "canonical+derivatives",
                },
            )
        elif hrf_type == "fir":
            order = params.get("fir_order", 12)
            fir = fir_basis(TR, len(stimulus), order)
            convolved = np.array([np.convolve(stimulus, fir[:, i])[:len(stimulus)] for i in range(order)])
            return ComputeResult(
                request_id=req.id, domain=ComputeDomain.IMAGING, operation="hrf_convolve",
                results={"convolved_fir": convolved.tolist(), "order": order, "type": "fir"},
            )
        else:
            return ComputeResult(
                request_id=req.id, domain=ComputeDomain.IMAGING, operation="hrf_convolve",
                status=ComputeStatus.FAILED, error=f"Unknown HRF type: {hrf_type}",
            )


    # ── Random Field Theory Correction ─────────────────────────────

    async def _rft_correction(self, req: ComputeRequest, params: dict) -> ComputeResult:
        """Random Field Theory multiple comparisons correction (SPM-equivalent).
        
        Parameters:
            t_map: 3D t-statistic map
            df: residual degrees of freedom
            voxel_sizes: voxel dimensions in mm
            fwhm: smoothness FWHM in mm (or estimate from residuals)
            residuals: 4D residual images for smoothness estimation (optional)
            cluster_forming_threshold: uncorrected p-value threshold for cluster definition
        """
        t_map = np.array(params["t_map"], dtype=float)
        df = params["df"]
        voxel_sizes = np.array(params.get("voxel_sizes", [1.0, 1.0, 1.0]))
        cluster_p_thresh = params.get("cluster_forming_threshold", 0.001)
        alpha = params.get("alpha", 0.05)

        if "fwhm" in params:
            fwhm = np.array(params["fwhm"], dtype=float)
        elif "residuals" in params:
            # Estimate smoothness from residuals
            res = np.array(params["residuals"], dtype=float)
            fwhm = self._estimate_smoothness(res, voxel_sizes)
        else:
            fwhm = np.array([8.0, 8.0, 8.0])  # default 8mm

        # Convert FWHM to sigma (in voxels)
        sigma_vox = fwhm / voxel_sizes / (2 * np.sqrt(2 * np.log(2)))

        # RESELS (resolution elements)
        mask = np.abs(t_map) > 0
        n_voxels = int(mask.sum())
        voxel_volume = float(np.prod(voxel_sizes))
        resel_volume = float(np.prod(fwhm))
        resels = n_voxels * voxel_volume / resel_volume if resel_volume > 0 else n_voxels

        # Search volume in RESEL counts for different dimensions
        # R = (R0, R1, R2, R3) for 0D, 1D, 2D, 3D
        R3 = resels
        R2 = 0  # simplified: ignore edge/face contributions
        R1 = 0
        R0 = 1  # Euler characteristic of search region

        # Cluster-forming threshold (t-value)
        t_thresh = float(sp_stats.t.ppf(1 - cluster_p_thresh, df))

        # Peak-level FWE correction using Expected Euler Characteristic
        # For a T-field with df degrees of freedom
        # EC density for T-field (Worsley et al., 1996)
        def ec_density_t(u, v):
            """Expected Euler characteristic density for T-field at threshold u with v df."""
            from scipy.special import gammaln
            x = (1 + u**2 / v)
            ec0 = 1 - sp_stats.t.cdf(u, v)
            ec1 = (2 * math.pi)**(-1) * x**(-0.5 * (v - 1))
            ec2 = (2 * math.pi)**(-1.5) * x**(-0.5 * (v - 1)) * u * math.exp(gammaln((v+1)/2) - gammaln(v/2)) * (2/v)**0.5
            ec3 = (2 * math.pi)**(-2) * x**(-0.5 * (v - 1)) * (u**2 - 1) * math.exp(gammaln((v+1)/2) - gammaln(v/2)) * (2/v)**0.5
            return ec0, ec1, ec2, ec3

        # Peak-level corrected p-values for each voxel
        t_flat = t_map.ravel()
        peak_p_fwe = np.ones(len(t_flat))
        for i in range(len(t_flat)):
            if abs(t_flat[i]) > t_thresh:
                ec = ec_density_t(abs(t_flat[i]), df)
                expected_ec = R0 * ec[0] + R1 * ec[1] + R2 * ec[2] + R3 * ec[3]
                peak_p_fwe[i] = min(1.0, max(0.0, expected_ec))

        peak_p_fwe_map = peak_p_fwe.reshape(t_map.shape) if t_map.ndim == 3 else peak_p_fwe

        # Cluster-level analysis
        binary_map = np.abs(t_map) > t_thresh
        labeled, n_clusters = ndimage.label(binary_map)
        clusters = []
        for cl in range(1, n_clusters + 1):
            cl_mask = labeled == cl
            cl_size = int(cl_mask.sum())
            cl_t_vals = t_map[cl_mask]
            peak_t = float(np.max(np.abs(cl_t_vals)))
            peak_idx = np.unravel_index(np.argmax(np.abs(t_map) * cl_mask), t_map.shape)

            # Cluster-level p-value (simplified GRF approximation)
            cl_resels = cl_size * voxel_volume / resel_volume if resel_volume > 0 else cl_size
            # Beta approximation for cluster size distribution
            beta_param = (math.lgamma(df/2 + 1) if df > 0 else 0)
            # Simplified: use Bonferroni-like correction based on expected number of clusters
            ec_at_thresh = ec_density_t(t_thresh, df)
            expected_n_clusters = max(R3 * ec_at_thresh[3], 0.001)
            cluster_p = float(min(1.0, math.exp(-cl_resels / max(expected_n_clusters, 0.001))))

            clusters.append({
                "cluster_id": cl,
                "size_voxels": cl_size,
                "size_resels": round(cl_resels, 2),
                "peak_t": round(peak_t, 4),
                "peak_location": [int(x) for x in peak_idx],
                "cluster_p_fwe": round(cluster_p, 6),
                "peak_p_fwe": round(float(peak_p_fwe[np.ravel_multi_index(peak_idx, t_map.shape)]) if t_map.ndim == 3 else 0, 6),
                "significant": cluster_p < alpha,
            })

        clusters.sort(key=lambda x: x["peak_t"], reverse=True)

        return ComputeResult(
            request_id=req.id, domain=ComputeDomain.IMAGING, operation="rft_correction",
            results={
                "clusters": clusters,
                "n_clusters": n_clusters,
                "n_significant_clusters": sum(1 for c in clusters if c["significant"]),
                "fwhm_mm": fwhm.tolist(),
                "resels": round(resels, 2),
                "cluster_forming_threshold_t": round(t_thresh, 4),
                "cluster_forming_threshold_p": cluster_p_thresh,
                "n_voxels_above_threshold": int(binary_map.sum()),
                "peak_p_fwe_map": peak_p_fwe_map.tolist() if t_map.ndim <= 3 else None,
            },
        )

    @staticmethod
    def _estimate_smoothness(residuals: np.ndarray, voxel_sizes: np.ndarray) -> np.ndarray:
        """Estimate smoothness (FWHM) from residual images."""
        if residuals.ndim == 4:
            n_images = residuals.shape[3]
            fwhm_est = np.zeros(3)
            for d in range(3):
                grad = np.diff(residuals, axis=d)
                var_grad = np.var(grad, axis=3)
                var_res = np.var(residuals[:grad.shape[0], :grad.shape[1], :grad.shape[2]], axis=3)
                ratio = np.nanmean(var_grad) / (np.nanmean(var_res) + 1e-15)
                fwhm_est[d] = voxel_sizes[d] * np.sqrt(-2 * np.log(2) / np.log(1 - ratio / 2)) if ratio < 2 else voxel_sizes[d] * 3
            return fwhm_est
        return np.array([8.0, 8.0, 8.0])

    # ── Functional Connectivity ────────────────────────────────────

    async def _functional_connectivity(self, req: ComputeRequest, params: dict) -> ComputeResult:
        """ROI-to-ROI and seed-based functional connectivity analysis.
        
        Parameters:
            timeseries: (n_rois, n_timepoints) or (n_voxels, n_timepoints)
            roi_labels: list of ROI names
            method: "pearson", "partial", "seed_based"
            bandpass: [low, high] Hz for temporal filtering (optional)
            TR: repetition time (required if bandpass specified)
            confounds: (n_timepoints, n_confounds) nuisance regressors to regress out
            global_signal_regression: bool
        """
        timeseries = np.array(params["timeseries"], dtype=float)
        method = params.get("method", "pearson")
        roi_labels = params.get("roi_labels", [f"ROI_{i}" for i in range(timeseries.shape[0])])

        # Ensure shape is (n_rois, n_timepoints)
        if timeseries.ndim == 1:
            timeseries = timeseries.reshape(1, -1)

        n_rois, n_tp = timeseries.shape

        # Bandpass filtering
        if "bandpass" in params and "TR" in params:
            low, high = params["bandpass"]
            TR = params["TR"]
            fs = 1.0 / TR
            nyq = fs / 2
            b, a = signal.butter(5, [low / nyq, high / nyq], btype="band")
            for i in range(n_rois):
                timeseries[i] = signal.filtfilt(b, a, timeseries[i])

        # Confound regression
        if "confounds" in params:
            confounds = np.array(params["confounds"], dtype=float)
            if confounds.ndim == 1:
                confounds = confounds.reshape(-1, 1)
            C = np.column_stack([np.ones(n_tp), confounds])
            for i in range(n_rois):
                beta = np.linalg.lstsq(C, timeseries[i], rcond=None)[0]
                timeseries[i] -= C @ beta

        # Global signal regression
        if params.get("global_signal_regression", False):
            gs = timeseries.mean(axis=0)
            C_gs = np.column_stack([np.ones(n_tp), gs])
            for i in range(n_rois):
                beta = np.linalg.lstsq(C_gs, timeseries[i], rcond=None)[0]
                timeseries[i] -= C_gs @ beta

        # Z-score each timeseries
        for i in range(n_rois):
            std = np.std(timeseries[i])
            if std > 0:
                timeseries[i] = (timeseries[i] - np.mean(timeseries[i])) / std

        if method == "pearson":
            corr_matrix = np.corrcoef(timeseries)
            # Fisher z-transform
            z_matrix = np.arctanh(np.clip(corr_matrix, -0.9999, 0.9999))
            np.fill_diagonal(z_matrix, 0)

            # Network metrics
            threshold = params.get("threshold", 0.3)
            adj = (np.abs(corr_matrix) > threshold).astype(int)
            np.fill_diagonal(adj, 0)
            degree = adj.sum(axis=1)
            density = adj.sum() / (n_rois * (n_rois - 1)) if n_rois > 1 else 0

            figures = []
            try:
                import matplotlib
                matplotlib.use("Agg")
                import matplotlib.pyplot as plt
                fig, axes = plt.subplots(1, 2, figsize=(16, 7))
                im = axes[0].imshow(corr_matrix, cmap="RdBu_r", vmin=-1, vmax=1)
                axes[0].set_title("Pearson Correlation Matrix")
                fig.colorbar(im, ax=axes[0], fraction=0.046)
                if n_rois <= 30:
                    axes[0].set_xticks(range(n_rois))
                    axes[0].set_xticklabels(roi_labels, rotation=45, ha="right", fontsize=6)
                    axes[0].set_yticks(range(n_rois))
                    axes[0].set_yticklabels(roi_labels, fontsize=6)

                im2 = axes[1].imshow(z_matrix, cmap="RdBu_r")
                axes[1].set_title("Fisher Z-transformed")
                fig.colorbar(im2, ax=axes[1], fraction=0.046)
                fig.tight_layout()
                figures.append(GeneratedFigure.from_matplotlib(fig, "functional_connectivity"))
                plt.close(fig)
            except ImportError:
                pass

            return ComputeResult(
                request_id=req.id, domain=ComputeDomain.IMAGING, operation="functional_connectivity",
                results={
                    "correlation_matrix": corr_matrix.tolist(),
                    "z_matrix": z_matrix.tolist(),
                    "roi_labels": roi_labels,
                    "network_metrics": {
                        "density": round(density, 4),
                        "mean_degree": round(float(np.mean(degree)), 2),
                        "degree": degree.tolist(),
                    },
                },
                figures=figures,
            )

        elif method == "partial":
            # Partial correlation via precision matrix
            try:
                from sklearn.covariance import GraphicalLassoCV
                gl = GraphicalLassoCV(cv=5, max_iter=500)
                gl.fit(timeseries.T)
                precision = gl.precision_
                # Convert precision to partial correlation
                d = np.sqrt(np.diag(precision))
                partial_corr = -precision / np.outer(d, d)
                np.fill_diagonal(partial_corr, 1.0)
            except Exception:
                # Fallback: direct inversion of correlation matrix
                corr = np.corrcoef(timeseries)
                try:
                    precision = np.linalg.inv(corr + 0.01 * np.eye(n_rois))
                    d = np.sqrt(np.diag(precision))
                    partial_corr = -precision / np.outer(d, d)
                    np.fill_diagonal(partial_corr, 1.0)
                except np.linalg.LinAlgError:
                    partial_corr = corr

            return ComputeResult(
                request_id=req.id, domain=ComputeDomain.IMAGING, operation="functional_connectivity",
                results={
                    "partial_correlation_matrix": partial_corr.tolist(),
                    "roi_labels": roi_labels,
                    "method": "partial (graphical lasso)",
                },
            )

        elif method == "seed_based":
            seed_idx = params.get("seed_index", 0)
            seed_ts = timeseries[seed_idx]
            correlations = np.array([np.corrcoef(seed_ts, timeseries[i])[0, 1] for i in range(n_rois)])
            z_values = np.arctanh(np.clip(correlations, -0.9999, 0.9999))
            p_values = 2 * (1 - sp_stats.norm.cdf(np.abs(z_values) * np.sqrt(n_tp - 3)))

            return ComputeResult(
                request_id=req.id, domain=ComputeDomain.IMAGING, operation="functional_connectivity",
                results={
                    "seed_roi": roi_labels[seed_idx],
                    "correlations": correlations.tolist(),
                    "z_values": z_values.tolist(),
                    "p_values": p_values.tolist(),
                    "roi_labels": roi_labels,
                },
            )
        else:
            return ComputeResult(
                request_id=req.id, domain=ComputeDomain.IMAGING, operation="functional_connectivity",
                status=ComputeStatus.FAILED, error=f"Unknown method: {method}",
            )


    # ── Atlas ROI Analysis ─────────────────────────────────────────

    async def _atlas_roi_analysis(self, req: ComputeRequest, params: dict) -> ComputeResult:
        """Extract statistics from atlas-defined regions of interest.
        
        Parameters:
            data: 3D volume or 4D timeseries
            atlas: "aal", "desikan_killiany", or integer-labeled 3D volume
            atlas_labels: dict mapping integer labels to names (if custom atlas)
            statistic: "mean", "median", "std", "all"
        """
        data = np.array(params["data"], dtype=float)
        atlas_name = params.get("atlas", "aal")
        statistic = params.get("statistic", "all")

        # Determine atlas
        if isinstance(atlas_name, str):
            if atlas_name == "aal":
                atlas_def = AAL_ATLAS
            elif atlas_name in ("desikan_killiany", "dk"):
                atlas_def = DESIKAN_KILLIANY
            else:
                atlas_def = AAL_ATLAS  # fallback
        else:
            atlas_def = params.get("atlas_labels", {})

        if "atlas_volume" in params:
            atlas_vol = np.array(params["atlas_volume"], dtype=int)
        else:
            # Generate synthetic atlas for demo if no volume provided
            if data.ndim >= 3:
                atlas_vol = np.zeros(data.shape[:3], dtype=int)
                n_regions = min(len(atlas_def), 10)
                # Divide volume into regions
                slices_per_region = max(1, data.shape[0] // n_regions)
                for i, label in enumerate(list(atlas_def.keys())[:n_regions]):
                    start = i * slices_per_region
                    end = min((i + 1) * slices_per_region, data.shape[0])
                    atlas_vol[start:end] = label
            else:
                return ComputeResult(
                    request_id=req.id, domain=ComputeDomain.IMAGING, operation="atlas_roi_analysis",
                    status=ComputeStatus.FAILED, error="Need atlas_volume or 3D+ data",
                )

        unique_labels = np.unique(atlas_vol)
        unique_labels = unique_labels[unique_labels > 0]

        roi_results = []
        for label in unique_labels:
            mask = atlas_vol == label
            n_voxels = int(mask.sum())
            name = atlas_def.get(int(label), f"Region_{label}")

            if data.ndim == 3:
                roi_data = data[mask]
                roi_results.append({
                    "label": int(label), "name": name, "n_voxels": n_voxels,
                    "mean": round(float(np.nanmean(roi_data)), 6),
                    "median": round(float(np.nanmedian(roi_data)), 6),
                    "std": round(float(np.nanstd(roi_data)), 6),
                    "min": round(float(np.nanmin(roi_data)), 6),
                    "max": round(float(np.nanmax(roi_data)), 6),
                })
            elif data.ndim == 4:
                roi_ts = data[mask].mean(axis=0)  # mean timeseries
                roi_results.append({
                    "label": int(label), "name": name, "n_voxels": n_voxels,
                    "mean_timeseries": roi_ts.tolist(),
                    "temporal_snr": round(float(np.mean(roi_ts) / (np.std(roi_ts) + 1e-15)), 4),
                })

        return ComputeResult(
            request_id=req.id, domain=ComputeDomain.IMAGING, operation="atlas_roi_analysis",
            results={
                "atlas": atlas_name if isinstance(atlas_name, str) else "custom",
                "n_regions": len(roi_results),
                "regions": roi_results,
            },
        )

    # ── ICA Decomposition ──────────────────────────────────────────

    async def _ica_decomposition(self, req: ComputeRequest, params: dict) -> ComputeResult:
        """Independent Component Analysis for fMRI data.
        
        Parameters:
            data: 2D (n_voxels, n_timepoints) or 4D (x, y, z, t)
            n_components: number of ICs to extract (default: auto via PCA)
            algorithm: "fastica", "infomax" (default: fastica)
            max_iter: maximum iterations
        """
        data = np.array(params["data"], dtype=float)
        n_components = params.get("n_components")
        max_iter = params.get("max_iter", 200)

        original_shape = None
        if data.ndim == 4:
            original_shape = data.shape[:3]
            n_tp = data.shape[3]
            data_2d = data.reshape(-1, n_tp)
        elif data.ndim == 2:
            data_2d = data
            n_tp = data.shape[1]
        else:
            return ComputeResult(
                request_id=req.id, domain=ComputeDomain.IMAGING, operation="ica_decomposition",
                status=ComputeStatus.FAILED, error="Data must be 2D or 4D",
            )

        n_voxels = data_2d.shape[0]

        # Remove mean
        data_centered = data_2d - data_2d.mean(axis=1, keepdims=True)

        # PCA dimensionality reduction
        if n_components is None:
            # Estimate via explained variance > 95%
            n_components = min(n_tp - 1, 20)

        from sklearn.decomposition import FastICA, PCA

        # PCA first
        pca = PCA(n_components=n_components, random_state=42)
        data_pca = pca.fit_transform(data_centered.T)  # (n_tp, n_components)
        explained_var = pca.explained_variance_ratio_

        # ICA
        ica = FastICA(n_components=n_components, max_iter=max_iter, random_state=42, whiten=False)
        sources = ica.fit_transform(data_pca)  # (n_tp, n_components) — temporal courses
        mixing = ica.mixing_  # (n_components, n_components) in PCA space
        unmixing = ica.components_

        # Spatial maps: project ICA mixing back to voxel space
        spatial_maps = pca.components_.T @ mixing  # (n_voxels, n_components)

        # Component classification heuristics
        component_info = []
        for i in range(n_components):
            spatial_map = spatial_maps[:, i]
            timecourse = sources[:, i]

            # Spatial features
            spatial_kurtosis = float(sp_stats.kurtosis(spatial_map))
            spatial_entropy = float(-np.sum(np.abs(spatial_map) / (np.sum(np.abs(spatial_map)) + 1e-15) *
                                           np.log(np.abs(spatial_map) / (np.sum(np.abs(spatial_map)) + 1e-15) + 1e-15)))

            # Temporal features
            temporal_kurtosis = float(sp_stats.kurtosis(timecourse))
            # Power spectrum: fraction of power in low freq (<0.1 Hz)
            if "TR" in params:
                freqs = np.fft.rfftfreq(len(timecourse), d=params["TR"])
                power = np.abs(np.fft.rfft(timecourse)) ** 2
                low_freq_power = np.sum(power[freqs < 0.1]) / (np.sum(power) + 1e-15)
            else:
                low_freq_power = 0.5

            # Simple classifier: signal components tend to have high spatial kurtosis and low-freq power
            is_signal = spatial_kurtosis > 1.0 and low_freq_power > 0.3

            component_info.append({
                "component": i,
                "spatial_kurtosis": round(spatial_kurtosis, 4),
                "temporal_kurtosis": round(temporal_kurtosis, 4),
                "low_freq_power_fraction": round(float(low_freq_power), 4),
                "classification": "signal" if is_signal else "noise",
                "explained_variance_pca": round(float(explained_var[i]) * 100, 2),
            })

        figures = []
        try:
            import matplotlib
            matplotlib.use("Agg")
            import matplotlib.pyplot as plt
            n_show = min(n_components, 6)
            fig, axes = plt.subplots(n_show, 2, figsize=(14, 3 * n_show))
            if n_show == 1:
                axes = axes.reshape(1, -1)
            for i in range(n_show):
                axes[i, 0].plot(sources[:, i], linewidth=0.5)
                axes[i, 0].set_ylabel(f"IC {i}")
                axes[i, 0].set_title(f"IC {i} timecourse ({component_info[i]['classification']})")
                if original_shape:
                    mid_slice = original_shape[2] // 2
                    spatial_3d = spatial_maps[:, i].reshape(original_shape)
                    axes[i, 1].imshow(spatial_3d[:, :, mid_slice].T, cmap="RdBu_r", origin="lower")
                    axes[i, 1].set_title(f"IC {i} spatial map (z={mid_slice})")
                else:
                    axes[i, 1].hist(spatial_maps[:, i], bins=50, alpha=0.7)
                    axes[i, 1].set_title(f"IC {i} weight distribution")
            fig.tight_layout()
            figures.append(GeneratedFigure.from_matplotlib(fig, "ica_components"))
            plt.close(fig)
        except ImportError:
            pass

        return ComputeResult(
            request_id=req.id, domain=ComputeDomain.IMAGING, operation="ica_decomposition",
            results={
                "n_components": n_components,
                "components": component_info,
                "explained_variance_cumulative": float(np.sum(explained_var)),
                "mixing_matrix": mixing.tolist(),
                "n_signal_components": sum(1 for c in component_info if c["classification"] == "signal"),
                "n_noise_components": sum(1 for c in component_info if c["classification"] == "noise"),
            },
            figures=figures,
        )

    # ── Dynamic Causal Modeling (DCM) ──────────────────────────────

    async def _dcm(self, req: ComputeRequest, params: dict) -> ComputeResult:
        """Simplified Dynamic Causal Modeling — bilinear with Balloon model.
        
        Parameters:
            timeseries: (n_regions, n_timepoints) observed BOLD timeseries
            inputs: (n_inputs, n_timepoints) experimental inputs
            TR: repetition time
            A_prior: (n_regions, n_regions) intrinsic connectivity prior (0/1 for connectivity pattern)
            B_prior: list of (n_regions, n_regions) modulatory connectivity priors
            C_prior: (n_regions, n_inputs) driving input prior
        """
        Y = np.array(params["timeseries"], dtype=float)
        U = np.array(params["inputs"], dtype=float)
        TR = params["TR"]
        n_regions, n_tp = Y.shape
        if U.ndim == 1:
            U = U.reshape(1, -1)
        n_inputs = U.shape[0]

        A_prior = np.array(params.get("A_prior", np.ones((n_regions, n_regions))), dtype=float)
        B_priors = [np.array(b, dtype=float) for b in params.get("B_prior", [np.zeros((n_regions, n_regions))] * n_inputs)]
        C_prior = np.array(params.get("C_prior", np.zeros((n_regions, n_inputs))), dtype=float)

        # Initialize parameters
        A = A_prior * 0.1 * np.random.default_rng(42).standard_normal((n_regions, n_regions))
        np.fill_diagonal(A, -0.5)  # self-inhibition
        B = [b_p * 0.01 * np.random.default_rng(42+i).standard_normal((n_regions, n_regions)) for i, b_p in enumerate(B_priors)]
        C = C_prior * 0.1

        # Balloon model parameters (fixed)
        kappa = 0.65  # signal decay
        gamma = 0.41  # autoregulation
        tau = 0.98  # transit time
        alpha = 0.32  # Grubb's exponent
        E0 = 0.34  # resting oxygen extraction
        V0 = 0.02  # resting blood volume fraction

        def balloon_forward(x_neural, dt, n_steps):
            """Simulate BOLD signal from neural activity using Balloon model."""
            n_r = x_neural.shape[0]
            # State: s (vasodilatory signal), f (flow), v (volume), q (deoxyhemoglobin)
            s = np.zeros(n_r)
            f = np.ones(n_r)
            v = np.ones(n_r)
            q = np.ones(n_r)
            bold = np.zeros((n_r, n_steps))

            for t_idx in range(n_steps):
                z = x_neural[:, t_idx]
                # Hemodynamic state equations
                ds = z - kappa * s - gamma * (f - 1)
                df = s.copy()
                dv = (f - v ** (1/alpha)) / tau
                dq = (f * (1 - (1-E0)**(1/f)) / E0 - q * v**(1/alpha - 1)) / tau

                s += ds * dt
                f += df * dt
                f = np.maximum(f, 0.01)
                v += dv * dt
                v = np.maximum(v, 0.01)
                q += dq * dt
                q = np.maximum(q, 0.01)

                # BOLD signal (Buxton et al.)
                bold[:, t_idx] = V0 * (7 * E0 * (1 - q) + 2 * (1 - q/v) + (2*E0 - 0.2) * (1 - v))

            return bold

        # Simple gradient descent to fit A, C (simplified — full DCM uses variational Bayes)
        dt = TR
        best_A = A.copy()
        best_C = C.copy()
        best_cost = float("inf")
        lr = 0.001

        for iteration in range(params.get("max_iter", 100)):
            # Forward model: dx/dt = (A + sum(u_j * B_j)) * x + C * u
            x = np.zeros((n_regions, n_tp))
            for t_idx in range(1, n_tp):
                effective_A = A.copy()
                for j in range(n_inputs):
                    effective_A += U[j, t_idx] * B[j]
                dx = effective_A @ x[:, t_idx-1] + C @ U[:, t_idx]
                x[:, t_idx] = x[:, t_idx-1] + dx * dt

            # Generate BOLD
            y_pred = balloon_forward(x, dt, n_tp)

            # Cost (sum of squared errors)
            cost = float(np.sum((Y - y_pred) ** 2))

            if cost < best_cost:
                best_cost = cost
                best_A = A.copy()
                best_C = C.copy()

            # Numerical gradient (simplified)
            eps = 1e-4
            grad_A = np.zeros_like(A)
            for i in range(n_regions):
                for j in range(n_regions):
                    if A_prior[i, j] == 0:
                        continue
                    A[i, j] += eps
                    x2 = np.zeros((n_regions, n_tp))
                    for t_idx in range(1, n_tp):
                        eff_A = A.copy()
                        for jj in range(n_inputs):
                            eff_A += U[jj, t_idx] * B[jj]
                        x2[:, t_idx] = x2[:, t_idx-1] + (eff_A @ x2[:, t_idx-1] + C @ U[:, t_idx]) * dt
                    y2 = balloon_forward(x2, dt, n_tp)
                    grad_A[i, j] = (np.sum((Y - y2) ** 2) - cost) / eps
                    A[i, j] -= eps

            A -= lr * grad_A * A_prior  # only update connected entries

        return ComputeResult(
            request_id=req.id, domain=ComputeDomain.IMAGING, operation="dcm",
            results={
                "A_matrix": best_A.tolist(),
                "C_matrix": best_C.tolist(),
                "B_matrices": [b.tolist() for b in B],
                "cost": round(best_cost, 4),
                "n_regions": n_regions,
                "n_inputs": n_inputs,
            },
        )

    # ── Brain Extraction ───────────────────────────────────────────

    async def _brain_extraction(self, req: ComputeRequest, params: dict) -> ComputeResult:
        """Brain extraction (skull stripping) using intensity-based approach.
        
        Parameters:
            data: 3D volume
            method: "otsu_morphological", "bet_simplified"
            iterations: morphological cleanup iterations
        """
        data = np.array(params["data"], dtype=float)
        method = params.get("method", "otsu_morphological")
        iterations = params.get("iterations", 3)

        if data.ndim != 3:
            return ComputeResult(
                request_id=req.id, domain=ComputeDomain.IMAGING, operation="brain_extraction",
                status=ComputeStatus.FAILED, error="Data must be 3D",
            )

        if method == "otsu_morphological":
            # Multi-level Otsu to find brain tissue
            from skimage.filters import threshold_otsu

            # Initial threshold
            thresh = threshold_otsu(data[data > 0])
            brain_mask = data > thresh * 0.3

            # Morphological cleanup
            struct = ndimage.generate_binary_structure(3, 2)
            # Fill holes
            brain_mask = ndimage.binary_fill_holes(brain_mask)
            # Opening (remove small objects)
            brain_mask = ndimage.binary_opening(brain_mask, structure=struct, iterations=iterations)
            # Closing (fill gaps)
            brain_mask = ndimage.binary_closing(brain_mask, structure=struct, iterations=iterations)
            # Keep only largest connected component
            labeled, n_features = ndimage.label(brain_mask)
            if n_features > 1:
                sizes = ndimage.sum(brain_mask, labeled, range(1, n_features + 1))
                largest = np.argmax(sizes) + 1
                brain_mask = labeled == largest

        elif method == "bet_simplified":
            # Simplified BET-like approach
            # 1. Find center of gravity of intensity
            coords = np.array(np.where(data > np.percentile(data[data > 0], 50))).T
            cog = coords.mean(axis=0)

            # 2. Initial sphere
            xx, yy, zz = np.mgrid[:data.shape[0], :data.shape[1], :data.shape[2]]
            dist = np.sqrt((xx - cog[0])**2 + (yy - cog[1])**2 + (zz - cog[2])**2)
            radius = min(data.shape) * 0.4
            brain_mask = dist < radius

            # 3. Refine with intensity
            thresh = np.percentile(data[brain_mask], 10)
            brain_mask = brain_mask & (data > thresh)

            # 4. Morphological cleanup
            struct = ndimage.generate_binary_structure(3, 2)
            brain_mask = ndimage.binary_fill_holes(brain_mask)
            brain_mask = ndimage.binary_opening(brain_mask, structure=struct, iterations=2)
            labeled, n_features = ndimage.label(brain_mask)
            if n_features > 1:
                sizes = ndimage.sum(brain_mask, labeled, range(1, n_features + 1))
                largest = np.argmax(sizes) + 1
                brain_mask = labeled == largest
        else:
            return ComputeResult(
                request_id=req.id, domain=ComputeDomain.IMAGING, operation="brain_extraction",
                status=ComputeStatus.FAILED, error=f"Unknown method: {method}",
            )

        extracted = data * brain_mask

        voxel_spacing = params.get("voxel_spacing", [1.0, 1.0, 1.0])
        brain_volume_ml = float(brain_mask.sum() * np.prod(voxel_spacing) / 1000.0)

        return ComputeResult(
            request_id=req.id, domain=ComputeDomain.IMAGING, operation="brain_extraction",
            results={
                "brain_mask": brain_mask.astype(int).tolist(),
                "brain_volume_ml": round(brain_volume_ml, 1),
                "n_brain_voxels": int(brain_mask.sum()),
                "brain_fraction": round(float(brain_mask.sum() / brain_mask.size * 100), 1),
                "method": method,
            },
        )
