"""
Compute Engine Operation Schemas — Parameter definitions for frontend form generation.

Every operation has a schema describing its inputs so the frontend can
auto-generate expert-mode configuration forms with proper input types,
validation, defaults, and grouping.
"""

from __future__ import annotations

from typing import Any


class ParamType:
    NUMBER = "number"
    INTEGER = "integer"
    STRING = "string"
    BOOLEAN = "boolean"
    SELECT = "select"
    MULTI_SELECT = "multi_select"
    ARRAY = "array"
    MATRIX = "matrix"
    FILE = "file"
    DATASET = "dataset"
    JSON = "json"
    RANGE = "range"


def P(name, label, ptype, required=False, default=None, description="",
      min=None, max=None, step=None, options=None, group="General",
      accept=None, placeholder=None, depends_on=None, **kw):
    """Build a parameter definition dict."""
    d = {"name": name, "label": label, "type": ptype, "required": required, "group": group}
    if description: d["description"] = description
    if default is not None: d["default"] = default
    if min is not None: d["min"] = min
    if max is not None: d["max"] = max
    if step is not None: d["step"] = step
    if options: d["options"] = options
    if accept: d["accept"] = accept
    if placeholder: d["placeholder"] = placeholder
    if depends_on: d["depends_on"] = depends_on
    d.update(kw)
    return d


def _sel(pairs):
    """Build options list from (value, label) pairs."""
    return [{"value": v, "label": l} for v, l in pairs]


# Reusable parameter fragments
_CONFIDENCE = P("confidence", "Confidence Level", "number", default=0.95, min=0.80, max=0.99, step=0.01, group="Options")
_ALPHA = P("alpha", "Significance Level", "number", default=0.05, min=0.001, max=0.20, step=0.005, group="Options")
_ALTERNATIVE = P("alternative", "Alternative", "select", default="two-sided",
                  options=_sel([("two-sided", "Two-sided"), ("less", "Less"), ("greater", "Greater")]), group="Options")
_CORRECTION = P("correction", "Multiple Testing Correction", "select", default="none",
                 options=_sel([("none", "None"), ("bonferroni", "Bonferroni"), ("holm", "Holm"),
                               ("bh", "Benjamini-Hochberg"), ("by", "Benjamini-Yekutieli")]), group="Options")

# ── Schema Registry ──────────────────────────────────────────────
OPERATION_SCHEMAS: dict[str, dict[str, Any]] = {}


# ════════════════════════════════════════════════════════════════
#  STATISTICS
# ════════════════════════════════════════════════════════════════

OPERATION_SCHEMAS["statistics/descriptive"] = {
    "title": "Descriptive Statistics",
    "description": "Compute mean, median, std, quartiles, skewness, kurtosis with confidence intervals",
    "params": [
        P("data", "Data", "array", required=True, placeholder="1.2, 3.4, 5.6, ..."),
        _CONFIDENCE,
        P("percentiles", "Custom Percentiles", "array", placeholder="10, 25, 50, 75, 90", group="Options"),
    ],
}

OPERATION_SCHEMAS["statistics/t_test"] = {
    "title": "Independent Samples t-Test",
    "description": "Compare means of two independent groups",
    "params": [
        P("group1", "Group 1", "array", required=True, placeholder="Values for group 1"),
        P("group2", "Group 2", "array", required=True, placeholder="Values for group 2"),
        P("equal_var", "Equal Variances", "boolean", default=True, description="Student's (checked) vs Welch's (unchecked)", group="Options"),
        _ALTERNATIVE, _CONFIDENCE,
    ],
}

OPERATION_SCHEMAS["statistics/paired_t_test"] = {
    "title": "Paired Samples t-Test",
    "description": "Compare means of paired/matched observations",
    "params": [
        P("group1", "Before / Condition A", "array", required=True),
        P("group2", "After / Condition B", "array", required=True),
        _ALTERNATIVE, _CONFIDENCE,
    ],
}

OPERATION_SCHEMAS["statistics/one_way_anova"] = {
    "title": "One-Way ANOVA",
    "description": "Compare means across 3+ independent groups",
    "params": [
        P("groups", "Groups Data", "json", required=True, description="Dict of group_name: [values] or list of arrays", placeholder='{"control": [1,2,3], "treatment": [4,5,6]}'),
        P("post_hoc", "Post-Hoc Test", "select", default="tukey",
          options=_sel([("tukey", "Tukey HSD"), ("bonferroni", "Bonferroni"), ("scheffe", "Scheffé"), ("none", "None")]), group="Options"),
        _ALPHA,
    ],
}

OPERATION_SCHEMAS["statistics/two_way_anova"] = {
    "title": "Two-Way ANOVA",
    "description": "Test effects of two factors and their interaction",
    "params": [
        P("data", "Response Variable", "array", required=True),
        P("factor_a", "Factor A Levels", "array", required=True, description="Group labels for factor A"),
        P("factor_b", "Factor B Levels", "array", required=True, description="Group labels for factor B"),
        _ALPHA,
    ],
}

OPERATION_SCHEMAS["statistics/mann_whitney"] = {
    "title": "Mann-Whitney U Test",
    "description": "Non-parametric test for two independent groups",
    "params": [
        P("group1", "Group 1", "array", required=True),
        P("group2", "Group 2", "array", required=True),
        _ALTERNATIVE,
    ],
}

OPERATION_SCHEMAS["statistics/wilcoxon_signed_rank"] = {
    "title": "Wilcoxon Signed-Rank Test",
    "description": "Non-parametric paired samples test",
    "params": [
        P("group1", "Sample 1", "array", required=True),
        P("group2", "Sample 2", "array", required=True),
        _ALTERNATIVE,
    ],
}

OPERATION_SCHEMAS["statistics/kruskal_wallis"] = {
    "title": "Kruskal-Wallis H Test",
    "description": "Non-parametric one-way ANOVA",
    "params": [
        P("groups", "Groups Data", "json", required=True),
    ],
}

OPERATION_SCHEMAS["statistics/chi_square"] = {
    "title": "Chi-Square Test",
    "description": "Test of independence for contingency tables",
    "params": [
        P("observed", "Observed Frequencies", "matrix", required=True, description="2D contingency table"),
        P("correction", "Yates Correction", "boolean", default=True, group="Options"),
    ],
}

OPERATION_SCHEMAS["statistics/correlation"] = {
    "title": "Correlation Analysis",
    "description": "Compute correlation coefficient between variables",
    "params": [
        P("x", "Variable X", "array", required=True),
        P("y", "Variable Y", "array", required=True),
        P("method", "Method", "select", default="pearson",
          options=_sel([("pearson", "Pearson r"), ("spearman", "Spearman rho"), ("kendall", "Kendall tau")]), group="Options"),
    ],
}

OPERATION_SCHEMAS["statistics/linear_regression"] = {
    "title": "Linear Regression",
    "description": "OLS regression with diagnostics",
    "params": [
        P("x", "Predictor(s)", "matrix", required=True, description="Single column or multiple predictors"),
        P("y", "Response", "array", required=True),
        _CONFIDENCE,
    ],
}

OPERATION_SCHEMAS["statistics/logistic_regression"] = {
    "title": "Logistic Regression",
    "description": "Binary outcome regression via IRLS",
    "params": [
        P("x", "Predictors", "matrix", required=True),
        P("y", "Binary Outcome (0/1)", "array", required=True),
        P("max_iter", "Max Iterations", "integer", default=100, min=10, max=1000, group="Options"),
    ],
}

OPERATION_SCHEMAS["statistics/survival"] = {
    "title": "Kaplan-Meier Survival Analysis",
    "description": "Survival curves with log-rank test",
    "params": [
        P("time", "Time to Event", "array", required=True),
        P("event", "Event Indicator (0/1)", "array", required=True),
        P("groups", "Group Labels", "array", description="Optional group variable for comparison"),
    ],
}

OPERATION_SCHEMAS["statistics/cox_regression"] = {
    "title": "Cox Proportional Hazards",
    "description": "Semi-parametric survival regression with hazard ratios",
    "params": [
        P("time", "Survival Time", "array", required=True),
        P("event", "Event (0/1)", "array", required=True),
        P("covariates", "Covariates Matrix", "matrix", required=True),
        P("covariate_names", "Covariate Names", "array", placeholder="age, sex, treatment"),
    ],
}

OPERATION_SCHEMAS["statistics/meta_analysis"] = {
    "title": "Meta-Analysis",
    "description": "Fixed/random effects meta-analysis with forest plot",
    "params": [
        P("effects", "Effect Sizes", "array", required=True),
        P("se", "Standard Errors", "array", required=True),
        P("study_names", "Study Names", "array"),
        P("method", "Method", "select", default="random",
          options=_sel([("random", "Random Effects (DerSimonian-Laird)"), ("fixed", "Fixed Effects")]), group="Options"),
    ],
}

OPERATION_SCHEMAS["statistics/bootstrap"] = {
    "title": "Bootstrap Analysis",
    "description": "Non-parametric bootstrap confidence intervals",
    "params": [
        P("data", "Data", "array", required=True),
        P("statistic", "Statistic", "select", default="mean",
          options=_sel([("mean", "Mean"), ("median", "Median"), ("std", "Std Dev"), ("trimmed_mean", "Trimmed Mean")])),
        P("n_bootstrap", "Bootstrap Samples", "integer", default=10000, min=100, max=100000, group="Options"),
        P("ci_method", "CI Method", "select", default="bca",
          options=_sel([("bca", "BCa"), ("percentile", "Percentile"), ("basic", "Basic")]), group="Options"),
        _CONFIDENCE,
    ],
}

OPERATION_SCHEMAS["statistics/normality_tests"] = {
    "title": "Normality Tests",
    "description": "5 normality tests with Q-Q plot",
    "params": [
        P("data", "Data", "array", required=True),
        _ALPHA,
    ],
}

OPERATION_SCHEMAS["statistics/equivalence_test"] = {
    "title": "TOST Equivalence Test",
    "description": "Two One-Sided Tests for equivalence",
    "params": [
        P("group1", "Group 1", "array", required=True),
        P("group2", "Group 2", "array", required=True),
        P("margin", "Equivalence Margin", "number", required=True, description="Maximum acceptable difference", min=0),
        _ALPHA,
    ],
}


# ════════════════════════════════════════════════════════════════
#  ELECTROPHYSIOLOGY / CARDIOVASCULAR
# ════════════════════════════════════════════════════════════════

OPERATION_SCHEMAS["electrophysiology/bandpass_filter"] = {
    "title": "Bandpass Filter",
    "description": "Butterworth IIR bandpass filter",
    "params": [
        P("signal", "Signal Data", "array", required=True),
        P("sampling_rate", "Sampling Rate (Hz)", "number", required=True, default=256, min=1, max=100000),
        P("low_freq", "Low Cutoff (Hz)", "number", required=True, default=0.5, min=0.001),
        P("high_freq", "High Cutoff (Hz)", "number", required=True, default=40, max=50000),
        P("order", "Filter Order", "integer", default=4, min=1, max=10, group="Options"),
    ],
}

OPERATION_SCHEMAS["electrophysiology/notch_filter"] = {
    "title": "Notch Filter",
    "description": "Remove powerline interference",
    "params": [
        P("signal", "Signal Data", "array", required=True),
        P("sampling_rate", "Sampling Rate (Hz)", "number", required=True, default=256),
        P("freq", "Notch Frequency (Hz)", "number", default=50, description="50 Hz (Europe) or 60 Hz (US)"),
        P("quality", "Quality Factor", "number", default=30, min=1, max=100, group="Options"),
    ],
}

OPERATION_SCHEMAS["electrophysiology/compute_psd"] = {
    "title": "Power Spectral Density",
    "description": "Welch PSD with frequency band powers",
    "params": [
        P("signal", "Signal Data", "array", required=True),
        P("sampling_rate", "Sampling Rate (Hz)", "number", required=True, default=256),
        P("nperseg", "Segment Length", "integer", default=256, min=16, max=8192, group="Options"),
        P("window", "Window Function", "select", default="hann",
          options=_sel([("hann", "Hann"), ("hamming", "Hamming"), ("blackman", "Blackman"), ("bartlett", "Bartlett")]), group="Options"),
        P("overlap_frac", "Overlap Fraction", "number", default=0.5, min=0, max=0.9, step=0.1, group="Options"),
    ],
}

OPERATION_SCHEMAS["electrophysiology/pan_tompkins_qrs"] = {
    "title": "Pan-Tompkins QRS Detection",
    "description": "Detect QRS complexes in ECG with adaptive thresholding",
    "params": [
        P("ecg_signal", "ECG Signal", "array", required=True),
        P("sampling_rate", "Sampling Rate (Hz)", "number", required=True, default=360, min=100, max=10000),
    ],
}

OPERATION_SCHEMAS["electrophysiology/ecg_delineation"] = {
    "title": "ECG Wave Delineation",
    "description": "Detect P, QRS, T waves and compute intervals (PR, QT, QTc)",
    "params": [
        P("ecg_signal", "ECG Signal", "array", required=True),
        P("sampling_rate", "Sampling Rate (Hz)", "number", required=True, default=500),
        P("qrs_indices", "Pre-detected QRS Indices", "array", description="Optional — auto-detected if omitted"),
    ],
}

OPERATION_SCHEMAS["electrophysiology/hrv_analysis"] = {
    "title": "Heart Rate Variability Analysis",
    "description": "Full HRV pipeline: time-domain, frequency-domain, nonlinear",
    "params": [
        P("rr_intervals", "RR Intervals (ms)", "array", description="Provide either RR intervals or ECG signal"),
        P("ecg_signal", "ECG Signal", "array", description="Alternative to RR intervals"),
        P("sampling_rate", "Sampling Rate (Hz)", "number", default=500, description="Required if ECG signal provided"),
        P("artifact_threshold", "Artifact Threshold (%)", "number", default=20, min=5, max=50, group="Preprocessing",
          description="Max % deviation from local median before correction"),
        P("freq_method", "Frequency Method", "select", default="welch",
          options=_sel([("welch", "Welch PSD"), ("ar", "Autoregressive")]), group="Frequency Domain"),
        P("resample_rate", "Tachogram Resample Rate (Hz)", "number", default=4, min=1, max=10, group="Frequency Domain"),
        P("vlf_range", "VLF Band (Hz)", "range", default=[0.003, 0.04], group="Frequency Domain"),
        P("lf_range", "LF Band (Hz)", "range", default=[0.04, 0.15], group="Frequency Domain"),
        P("hf_range", "HF Band (Hz)", "range", default=[0.15, 0.4], group="Frequency Domain"),
        P("sampen_m", "SampEn Embedding Dim", "integer", default=2, min=1, max=5, group="Nonlinear"),
        P("sampen_r", "SampEn Tolerance (x SDNN)", "number", default=0.2, min=0.05, max=0.5, group="Nonlinear"),
        P("dfa_short", "DFA Short Range", "range", default=[4, 16], group="Nonlinear"),
        P("dfa_long", "DFA Long Range", "range", default=[16, 64], group="Nonlinear"),
    ],
}

OPERATION_SCHEMAS["electrophysiology/windkessel_model"] = {
    "title": "Windkessel Hemodynamic Model",
    "description": "Fit 2/3/4-element Windkessel models to pressure/flow data",
    "params": [
        P("aortic_pressure", "Aortic Pressure Waveform", "array", required=True),
        P("flow", "Aortic Flow Waveform", "array"),
        P("sampling_rate", "Sampling Rate (Hz)", "number", required=True, default=100),
        P("model_type", "Model Type", "select", default="3element",
          options=_sel([("2element", "2-Element (RC)"), ("3element", "3-Element (Westkessel)"), ("4element", "4-Element (+Inertance)")])),
    ],
}

OPERATION_SCHEMAS["electrophysiology/arrhythmia_classification"] = {
    "title": "Arrhythmia Classification",
    "description": "Rule-based ECG rhythm classification with confidence scores",
    "params": [
        P("ecg_signal", "ECG Signal", "array", required=True),
        P("sampling_rate", "Sampling Rate (Hz)", "number", required=True, default=500),
    ],
}

OPERATION_SCHEMAS["electrophysiology/pulse_wave_analysis"] = {
    "title": "Pulse Wave Analysis",
    "description": "Augmentation index, SEVR, dicrotic notch detection",
    "params": [
        P("pressure_waveform", "Arterial Pressure Waveform", "array", required=True),
        P("sampling_rate", "Sampling Rate (Hz)", "number", required=True, default=100),
        P("distal_waveform", "Distal Waveform", "array", description="For PWV calculation"),
        P("distance_m", "Measurement Distance (m)", "number", description="Distance between sensors for PWV"),
    ],
}

OPERATION_SCHEMAS["electrophysiology/cardiac_output"] = {
    "title": "Cardiac Output Estimation",
    "description": "Fick, thermodilution, or pulse contour method",
    "params": [
        P("method", "Method", "select", required=True, default="fick",
          options=_sel([("fick", "Fick Principle"), ("thermodilution", "Thermodilution"), ("pulse_contour", "Pulse Contour")])),
        P("vo2_ml_min", "VO2 (mL/min)", "number", default=250, depends_on="method:fick", group="Fick"),
        P("cao2_ml_dl", "CaO2 (mL/dL)", "number", default=20, depends_on="method:fick", group="Fick"),
        P("cvo2_ml_dl", "CvO2 (mL/dL)", "number", default=15, depends_on="method:fick", group="Fick"),
        P("pressure_waveform", "Pressure Waveform", "array", depends_on="method:pulse_contour", group="Pulse Contour"),
        P("sampling_rate", "Sampling Rate (Hz)", "number", default=100, depends_on="method:pulse_contour", group="Pulse Contour"),
        P("heart_rate", "Heart Rate (bpm)", "number", default=70),
        P("bsa_m2", "BSA (m²)", "number", default=1.73),
    ],
}

# ════════════════════════════════════════════════════════════════
#  GENOMICS
# ════════════════════════════════════════════════════════════════

OPERATION_SCHEMAS["genomics/negative_binomial_test"] = {
    "title": "Negative Binomial Differential Expression",
    "description": "DESeq2-equivalent RNA-seq analysis with dispersion shrinkage",
    "params": [
        P("count_matrix", "Count Matrix", "matrix", required=True, description="Genes (rows) x Samples (columns)"),
        P("conditions", "Sample Conditions", "array", required=True, placeholder="control, control, treatment, treatment"),
        P("alpha", "FDR Threshold", "number", default=0.05, min=0.001, max=0.5, group="Options"),
        P("lfc_threshold", "Log2 FC Threshold", "number", default=0, min=0, max=5, step=0.1, group="Options"),
    ],
}

OPERATION_SCHEMAS["genomics/coexpression_network"] = {
    "title": "Co-Expression Network (WGCNA)",
    "description": "Weighted gene co-expression network analysis",
    "params": [
        P("expression_matrix", "Expression Matrix", "matrix", required=True, description="Genes x Samples"),
        P("soft_power", "Soft Threshold Power", "integer", default=0, description="0 = auto-detect via scale-free fit"),
        P("min_module_size", "Min Module Size", "integer", default=30, min=5, max=500, group="Options"),
        P("merge_threshold", "Module Merge Threshold", "number", default=0.25, min=0, max=1, step=0.05, group="Options"),
        P("network_type", "Network Type", "select", default="signed",
          options=_sel([("signed", "Signed"), ("unsigned", "Unsigned")]), group="Options"),
    ],
}

OPERATION_SCHEMAS["genomics/dimensionality_reduction"] = {
    "title": "Dimensionality Reduction",
    "description": "PCA, t-SNE, or UMAP embedding",
    "params": [
        P("data_matrix", "Data Matrix", "matrix", required=True, description="Samples x Features"),
        P("method", "Method", "select", required=True, default="pca",
          options=_sel([("pca", "PCA"), ("tsne", "t-SNE"), ("umap", "UMAP")])),
        P("n_components", "Components", "integer", default=2, min=2, max=50),
        P("labels", "Sample Labels", "array", description="For coloring the plot"),
        P("perplexity", "t-SNE Perplexity", "number", default=30, min=5, max=100, depends_on="method:tsne", group="t-SNE"),
        P("n_neighbors", "UMAP Neighbors", "integer", default=15, min=2, max=200, depends_on="method:umap", group="UMAP"),
        P("min_dist", "UMAP Min Distance", "number", default=0.1, min=0, max=1, step=0.05, depends_on="method:umap", group="UMAP"),
    ],
}

OPERATION_SCHEMAS["genomics/clustergram"] = {
    "title": "Clustergram / Heatmap",
    "description": "Hierarchical clustered heatmap with dendrograms",
    "params": [
        P("expression_matrix", "Expression Matrix", "matrix", required=True),
        P("row_labels", "Row Labels", "array"),
        P("col_labels", "Column Labels", "array"),
        P("linkage", "Linkage Method", "select", default="ward",
          options=_sel([("ward", "Ward"), ("complete", "Complete"), ("average", "Average"), ("single", "Single")]), group="Options"),
        P("distance", "Distance Metric", "select", default="euclidean",
          options=_sel([("euclidean", "Euclidean"), ("correlation", "1 - Correlation"), ("cosine", "Cosine")]), group="Options"),
        P("z_score", "Z-Score Normalize", "select", default="row",
          options=_sel([("row", "Row-wise"), ("col", "Column-wise"), ("none", "None")]), group="Options"),
    ],
}

OPERATION_SCHEMAS["genomics/volcano_plot"] = {
    "title": "Volcano Plot",
    "description": "Log2 fold change vs -log10(p-value) visualization",
    "params": [
        P("log2fc", "Log2 Fold Changes", "array", required=True),
        P("pvalues", "P-values", "array", required=True),
        P("gene_names", "Gene Names", "array"),
        P("fc_threshold", "FC Threshold", "number", default=1.0, min=0, group="Options"),
        P("p_threshold", "P-value Threshold", "number", default=0.05, min=0.0001, max=0.5, group="Options"),
    ],
}

# ════════════════════════════════════════════════════════════════
#  IMAGING / NEUROIMAGING
# ════════════════════════════════════════════════════════════════

OPERATION_SCHEMAS["imaging/voxel_glm"] = {
    "title": "Voxel-wise General Linear Model",
    "description": "SPM-equivalent mass-univariate GLM with HRF convolution",
    "params": [
        P("volume_data", "4D fMRI Volume", "file", required=True, accept=".nii,.nii.gz"),
        P("conditions", "Condition Onsets", "json", required=True, description="Dict of condition_name: {onsets: [...], durations: [...]}"),
        P("tr", "Repetition Time (s)", "number", required=True, default=2.0, min=0.1, max=20),
        P("contrasts", "Contrasts", "json", description="Dict of contrast_name: [weights]"),
        P("motion_params", "Motion Parameters (6 cols)", "matrix", group="Confounds"),
        P("hrf_model", "HRF Model", "select", default="canonical",
          options=_sel([("canonical", "Canonical"), ("canonical+td", "Canonical + Temporal Derivative"),
                        ("canonical+td+dd", "Canonical + TD + Dispersion"), ("fir", "Finite Impulse Response")]), group="Options"),
        P("high_pass", "High-Pass Cutoff (s)", "number", default=128, min=20, max=500, group="Options"),
    ],
}

OPERATION_SCHEMAS["imaging/functional_connectivity"] = {
    "title": "Functional Connectivity",
    "description": "ROI-to-ROI or seed-based connectivity matrices",
    "params": [
        P("timeseries", "ROI Timeseries Matrix", "matrix", required=True, description="Timepoints x ROIs"),
        P("method", "Connectivity Method", "select", default="pearson",
          options=_sel([("pearson", "Pearson Correlation"), ("partial", "Partial Correlation (GraphicalLasso)"), ("seed_based", "Seed-Based")])),
        P("seed_index", "Seed ROI Index", "integer", depends_on="method:seed_based"),
        P("bandpass", "Bandpass Filter (Hz)", "range", default=[0.01, 0.1], group="Preprocessing"),
        P("confounds", "Confound Regressors", "matrix", group="Preprocessing"),
        P("fisher_z", "Fisher Z-Transform", "boolean", default=True, group="Options"),
    ],
}

OPERATION_SCHEMAS["imaging/atlas_roi_analysis"] = {
    "title": "Atlas-Based ROI Analysis",
    "description": "Extract regional statistics using brain atlases",
    "params": [
        P("volume_data", "3D/4D Brain Volume", "file", required=True, accept=".nii,.nii.gz"),
        P("atlas", "Atlas", "select", required=True, default="aal",
          options=_sel([("aal", "AAL (116 regions)"), ("desikan_killiany", "Desikan-Killiany (82 regions)"), ("custom", "Custom Atlas")])),
        P("metric", "Metric", "select", default="mean",
          options=_sel([("mean", "Mean"), ("median", "Median"), ("std", "Std Dev"), ("timeseries", "Mean Timeseries")])),
    ],
}

# ════════════════════════════════════════════════════════════════
#  BIOMECHANICS
# ════════════════════════════════════════════════════════════════

OPERATION_SCHEMAS["biomechanics/emg_processing"] = {
    "title": "EMG Processing Pipeline",
    "description": "Full EMG analysis: filtering, rectification, envelope, onset detection, fatigue",
    "params": [
        P("emg_signal", "EMG Signal", "array", required=True),
        P("sampling_rate", "Sampling Rate (Hz)", "number", required=True, default=1000, min=100, max=10000),
        P("mvc_value", "MVC Value", "number", description="Maximum voluntary contraction for normalization"),
        P("bandpass_low", "Bandpass Low (Hz)", "number", default=20, min=5, max=100, group="Filtering"),
        P("bandpass_high", "Bandpass High (Hz)", "number", default=450, min=100, max=5000, group="Filtering"),
        P("notch_freq", "Notch Frequency (Hz)", "select", default="50",
          options=_sel([("50", "50 Hz"), ("60", "60 Hz"), ("both", "Both")]), group="Filtering"),
        P("envelope_method", "Envelope Method", "select", default="rms",
          options=_sel([("rms", "RMS"), ("linear", "Linear (Low-pass)"), ("both", "Both")]), group="Envelope"),
        P("onset_threshold_sd", "Onset Threshold (x SD)", "number", default=3, min=1, max=10, group="Onset Detection"),
        P("onset_min_duration_s", "Min Burst Duration (s)", "number", default=0.03, min=0.01, max=0.5, group="Onset Detection"),
        P("fatigue_window_s", "Fatigue Window (s)", "number", default=1.0, min=0.1, max=10, group="Fatigue Analysis"),
    ],
}

OPERATION_SCHEMAS["biomechanics/micro_ct_morphometry"] = {
    "title": "Micro-CT Bone Morphometry",
    "description": "Compute BV/TV, Tb.Th, Tb.Sp, SMI, DA, and other Parfitt parameters",
    "params": [
        P("binary_volume", "Binary Volume (3D)", "file", required=True, accept=".npy,.npz,.nii,.tif",
          description="3D array where 1=bone, 0=marrow"),
        P("voxel_size_mm", "Voxel Size (mm)", "number", required=True, default=0.01, min=0.001, max=1, step=0.001),
    ],
}

OPERATION_SCHEMAS["biomechanics/gait_events"] = {
    "title": "Gait Event Detection",
    "description": "Detect heel strikes and toe offs from kinematic or kinetic data",
    "params": [
        P("heel_marker", "Heel Marker Position (AP)", "array", description="Anterior-posterior position"),
        P("grf_vertical", "Vertical GRF (N)", "array", description="For kinetic detection"),
        P("sampling_rate", "Sampling Rate (Hz)", "number", required=True, default=100),
        P("method", "Detection Method", "select", default="kinematic",
          options=_sel([("kinematic", "Kinematic (Zeni)"), ("kinetic", "GRF Threshold"), ("combined", "Combined")])),
        P("grf_threshold_N", "GRF Threshold (N)", "number", default=20, min=5, max=100, depends_on="method:kinetic", group="Kinetic"),
    ],
}

OPERATION_SCHEMAS["biomechanics/joint_stiffness"] = {
    "title": "Joint Stiffness Analysis",
    "description": "Quasi-static and dynamic stiffness estimation",
    "params": [
        P("joint_angle", "Joint Angle (deg)", "array", required=True),
        P("joint_moment", "Joint Moment (Nm)", "array", required=True),
        P("sampling_rate", "Sampling Rate (Hz)", "number", required=True, default=100),
        P("angle_unit", "Angle Unit", "select", default="degrees", options=_sel([("degrees", "Degrees"), ("radians", "Radians")])),
    ],
}

# ════════════════════════════════════════════════════════════════
#  CLINICAL
# ════════════════════════════════════════════════════════════════

OPERATION_SCHEMAS["clinical/mixed_effects_model"] = {
    "title": "Linear Mixed-Effects Model",
    "description": "REML estimation with random intercepts/slopes, Satterthwaite df",
    "params": [
        P("y", "Response Variable", "array", required=True),
        P("X", "Fixed Effects Matrix", "matrix", required=True),
        P("groups", "Group/Subject IDs", "array", required=True),
        P("random_effects", "Random Effects", "select", default="intercept",
          options=_sel([("intercept", "Random Intercept"), ("intercept_slope", "Random Intercept + Slope")])),
        P("fixed_names", "Fixed Effect Names", "array", placeholder="intercept, treatment, time"),
    ],
}

OPERATION_SCHEMAS["clinical/clinical_scales"] = {
    "title": "Clinical Rating Scales",
    "description": "Score clinical instruments with subscales and severity classification",
    "params": [
        P("scale", "Scale", "select", required=True,
          options=_sel([("hamd17", "HAM-D-17"), ("panss", "PANSS"), ("phq9", "PHQ-9"),
                        ("gad7", "GAD-7"), ("madrs", "MADRS"), ("ymrs", "YMRS"), ("cgi", "CGI"),
                        ("gcs", "Glasgow Coma Scale"), ("nihss", "NIH Stroke Scale"),
                        ("moca", "Montreal Cognitive Assessment")])),
        P("items", "Item Scores", "array",
          description="Item scores. Required for most scales. For GCS, you can use eye/verbal/motor fields instead."),
        P("eye", "GCS Eye Response (1-4)", "integer", min=1, max=4, description="GCS only", group="GCS"),
        P("verbal", "GCS Verbal Response (1-5)", "integer", min=1, max=5, description="GCS only", group="GCS"),
        P("motor", "GCS Motor Response (1-6)", "integer", min=1, max=6, description="GCS only", group="GCS"),
        P("education_years", "Years of Education", "integer", default=13, min=0, max=30,
          description="MoCA +1 bonus if ≤12 years", group="MoCA"),
        P("baseline_total", "Baseline Total (NIHSS)", "number", description="Prior total to flag ≥4/≥8-point improvement", group="NIHSS"),
    ],
}

OPERATION_SCHEMAS["clinical/classification"] = {
    "title": "Classification with Cross-Validation",
    "description": "Train classifiers with stratified k-fold CV and performance metrics",
    "params": [
        P("X", "Feature Matrix", "matrix", required=True),
        P("y", "Labels (0/1)", "array", required=True),
        P("algorithm", "Algorithm", "select", default="logistic_regression",
          options=_sel([("logistic_regression", "Logistic Regression"), ("svm", "SVM"),
                        ("random_forest", "Random Forest"), ("gradient_boosting", "Gradient Boosting"),
                        ("knn", "k-NN")])),
        P("n_folds", "CV Folds", "integer", default=5, min=2, max=20, group="Options"),
        P("feature_names", "Feature Names", "array"),
    ],
}

OPERATION_SCHEMAS["clinical/icc"] = {
    "title": "Intraclass Correlation Coefficient",
    "description": "All 6 ICC types (Shrout & Fleiss 1979)",
    "params": [
        P("ratings", "Ratings Matrix", "matrix", required=True, description="Subjects (rows) x Raters (columns)"),
        P("icc_type", "ICC Type", "select", default="ICC(2,1)",
          options=_sel([("ICC(1,1)", "ICC(1,1) — One-way random, single"), ("ICC(1,k)", "ICC(1,k) — One-way random, average"),
                        ("ICC(2,1)", "ICC(2,1) — Two-way random, single"), ("ICC(2,k)", "ICC(2,k) — Two-way random, average"),
                        ("ICC(3,1)", "ICC(3,1) — Two-way mixed, single"), ("ICC(3,k)", "ICC(3,k) — Two-way mixed, average")])),
    ],
}

OPERATION_SCHEMAS["clinical/bland_altman"] = {
    "title": "Bland-Altman Analysis",
    "description": "Method comparison with limits of agreement",
    "params": [
        P("method1", "Method 1 Measurements", "array", required=True),
        P("method2", "Method 2 Measurements", "array", required=True),
        _CONFIDENCE,
    ],
}

# ════════════════════════════════════════════════════════════════
#  PHARMACOKINETICS
# ════════════════════════════════════════════════════════════════

OPERATION_SCHEMAS["pharmacokinetics/one_compartment"] = {
    "title": "One-Compartment PK Model",
    "description": "First-order elimination PK model",
    "params": [
        P("dose", "Dose (mg)", "number", required=True, default=100),
        P("volume", "Volume of Distribution (L)", "number", required=True, default=50),
        P("clearance", "Clearance (L/h)", "number", required=True, default=5),
        P("time_points", "Time Points (h)", "array", placeholder="0, 0.5, 1, 2, 4, 8, 12, 24"),
        P("bioavailability", "Bioavailability (F)", "number", default=1.0, min=0, max=1, group="Options"),
    ],
}

OPERATION_SCHEMAS["pharmacokinetics/two_compartment"] = {
    "title": "Two-Compartment PK Model",
    "description": "Central + peripheral compartment model",
    "params": [
        P("dose", "Dose (mg)", "number", required=True, default=100),
        P("V1", "Central Volume (L)", "number", required=True, default=10),
        P("V2", "Peripheral Volume (L)", "number", required=True, default=30),
        P("CL", "Clearance (L/h)", "number", required=True, default=5),
        P("Q", "Inter-compartmental CL (L/h)", "number", required=True, default=10),
        P("time_points", "Time Points (h)", "array"),
    ],
}

OPERATION_SCHEMAS["pharmacokinetics/bioequivalence"] = {
    "title": "Bioequivalence Assessment",
    "description": "90% CI for AUC/Cmax ratios (test/reference)",
    "params": [
        P("auc_test", "AUC Test", "array", required=True),
        P("auc_ref", "AUC Reference", "array", required=True),
        P("cmax_test", "Cmax Test", "array", required=True),
        P("cmax_ref", "Cmax Reference", "array", required=True),
        P("be_limits", "BE Limits", "range", default=[0.80, 1.25], group="Options"),
    ],
}

OPERATION_SCHEMAS["pharmacokinetics/drug_interaction"] = {
    "title": "Drug-Drug Interaction",
    "description": "Enzyme inhibition/induction models with AUC ratio prediction",
    "params": [
        P("substrate_conc", "Substrate Concentrations", "array", required=True),
        P("velocity_control", "Velocity (Control)", "array", required=True),
        P("velocity_inhibited", "Velocity (+ Inhibitor)", "array", required=True),
        P("inhibitor_conc", "Inhibitor Concentration", "number", required=True),
        P("mechanism", "Mechanism", "select", default="competitive",
          options=_sel([("competitive", "Competitive"), ("noncompetitive", "Noncompetitive"),
                        ("uncompetitive", "Uncompetitive"), ("induction", "Enzyme Induction")])),
    ],
}
