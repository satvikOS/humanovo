"""
Expression Analysis Processor — MATLAB-equivalent genomics expression capabilities.

Provides advanced transcriptomic analysis operations:
- DESeq2-equivalent negative binomial differential expression
- WGCNA-equivalent weighted gene co-expression network analysis
- Hierarchical clustergram with dendrograms
- Dimensionality reduction (PCA, t-SNE, UMAP)
- GSVA / ssGSEA / z-score gene set variation analysis
- Volcano plot generation
- Pathway topology-aware impact analysis
"""

from __future__ import annotations

import io
import base64
from collections.abc import Callable

import numpy as np
from scipy import stats as sp_stats
from scipy import optimize as sp_optimize
from scipy.spatial.distance import pdist, squareform
from scipy.cluster.hierarchy import linkage, fcluster, leaves_list, dendrogram

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import cm

from app.compute.types import (
    ComputeDomain,
    ComputeRequest,
    ComputeResult,
    ComputeStatus,
    GeneratedFigure,
    StatisticalTest,
)


# ── Utilities ───────────────────────────────────────────────────────


def _bh_adjust(p_values: np.ndarray) -> np.ndarray:
    """Benjamini-Hochberg FDR correction."""
    n = len(p_values)
    if n == 0:
        return np.array([])
    order = np.argsort(p_values)
    ranks = np.empty_like(order)
    ranks[order] = np.arange(1, n + 1)
    adjusted = p_values * n / ranks
    # enforce monotonicity in reverse rank order
    adj_sorted_idx = np.argsort(-ranks)
    adjusted_sorted = adjusted[adj_sorted_idx]
    for i in range(1, n):
        if adjusted_sorted[i] > adjusted_sorted[i - 1]:
            adjusted_sorted[i] = adjusted_sorted[i - 1]
    result = np.empty(n)
    result[adj_sorted_idx] = adjusted_sorted
    return np.clip(result, 0.0, 1.0)


def _fig_to_base64_svg(fig) -> str:
    """Render matplotlib figure to base64-encoded SVG."""
    buf = io.BytesIO()
    fig.savefig(buf, format="svg", bbox_inches="tight")
    plt.close(fig)
    buf.seek(0)
    return base64.b64encode(buf.read()).decode("utf-8")


def _make_figure(fig, title: str) -> GeneratedFigure:
    """Create GeneratedFigure from matplotlib figure."""
    from app.compute.types import FigureFormat
    return GeneratedFigure(
        title=title,
        format=FigureFormat.SVG,
        data_base64=_fig_to_base64_svg(fig),
        width=int(fig.get_figwidth() * 100),
        height=int(fig.get_figheight() * 100),
    )


# ── Reference pathway databases (for topology analysis) ────────────

_KEGG_TOPOLOGY = {
    "hsa04110": {
        "name": "Cell cycle",
        "genes": ["TP53", "RB1", "CDK2", "CDK4", "CCND1", "CCNE1", "E2F1", "CDC25A"],
        "edges": [("TP53", "CDK2"), ("TP53", "RB1"), ("RB1", "E2F1"), ("CDK4", "RB1"),
                  ("CCND1", "CDK4"), ("CCNE1", "CDK2"), ("E2F1", "CCNE1"), ("CDC25A", "CDK2")],
    },
    "hsa04115": {
        "name": "p53 signaling pathway",
        "genes": ["TP53", "MDM2", "BAX", "BCL2", "CDKN1A", "GADD45A", "FAS", "CASP3"],
        "edges": [("TP53", "MDM2"), ("TP53", "BAX"), ("TP53", "CDKN1A"), ("TP53", "GADD45A"),
                  ("TP53", "FAS"), ("BAX", "BCL2"), ("FAS", "CASP3")],
    },
    "hsa04151": {
        "name": "PI3K-Akt signaling pathway",
        "genes": ["PIK3CA", "AKT1", "MTOR", "PTEN", "TSC1", "TSC2", "EGFR", "ERBB2"],
        "edges": [("EGFR", "PIK3CA"), ("ERBB2", "PIK3CA"), ("PIK3CA", "AKT1"), ("AKT1", "MTOR"),
                  ("AKT1", "TSC1"), ("TSC1", "TSC2"), ("PTEN", "PIK3CA")],
    },
    "hsa04010": {
        "name": "MAPK signaling pathway",
        "genes": ["KRAS", "BRAF", "MAP2K1", "MAPK1", "MAPK3", "RAF1", "SOS1", "GRB2"],
        "edges": [("GRB2", "SOS1"), ("SOS1", "KRAS"), ("KRAS", "BRAF"), ("KRAS", "RAF1"),
                  ("BRAF", "MAP2K1"), ("RAF1", "MAP2K1"), ("MAP2K1", "MAPK1"), ("MAP2K1", "MAPK3")],
    },
    "hsa04310": {
        "name": "Wnt signaling pathway",
        "genes": ["WNT1", "CTNNB1", "APC", "AXIN1", "GSK3B", "LEF1", "TCF7L2", "DVL1"],
        "edges": [("WNT1", "DVL1"), ("DVL1", "GSK3B"), ("GSK3B", "CTNNB1"), ("APC", "CTNNB1"),
                  ("AXIN1", "GSK3B"), ("CTNNB1", "LEF1"), ("CTNNB1", "TCF7L2")],
    },
    "hsa04350": {
        "name": "TGF-beta signaling pathway",
        "genes": ["TGFB1", "SMAD2", "SMAD3", "SMAD4", "SMAD7", "TGFBR1", "TGFBR2"],
        "edges": [("TGFB1", "TGFBR2"), ("TGFBR2", "TGFBR1"), ("TGFBR1", "SMAD2"), ("TGFBR1", "SMAD3"),
                  ("SMAD2", "SMAD4"), ("SMAD3", "SMAD4"), ("SMAD7", "TGFBR1")],
    },
    "hsa04210": {
        "name": "Apoptosis",
        "genes": ["BAX", "BCL2", "CASP3", "CASP8", "CASP9", "CYCS", "APAF1", "BID", "FADD"],
        "edges": [("FADD", "CASP8"), ("CASP8", "BID"), ("BID", "BAX"), ("BAX", "CYCS"),
                  ("CYCS", "APAF1"), ("APAF1", "CASP9"), ("CASP9", "CASP3"), ("BCL2", "BAX")],
    },
}

_REACTOME_TOPOLOGY = {
    "R-HSA-1640170": {
        "name": "Cell Cycle",
        "genes": ["CDK1", "CDK2", "CCNB1", "CCNA2", "TP53", "RB1"],
        "edges": [("CCNB1", "CDK1"), ("CCNA2", "CDK2"), ("TP53", "CDK2"), ("RB1", "CDK2")],
    },
    "R-HSA-73857": {
        "name": "RNA Polymerase II Transcription",
        "genes": ["MYC", "JUN", "FOS", "SP1", "TFIID"],
        "edges": [("MYC", "TFIID"), ("JUN", "FOS"), ("SP1", "TFIID")],
    },
    "R-HSA-69306": {
        "name": "DNA Repair",
        "genes": ["BRCA1", "BRCA2", "RAD51", "ATM", "ATR", "CHEK1", "CHEK2"],
        "edges": [("ATM", "CHEK2"), ("ATR", "CHEK1"), ("BRCA1", "RAD51"), ("BRCA2", "RAD51"),
                  ("CHEK1", "BRCA1"), ("CHEK2", "BRCA1")],
    },
    "R-HSA-1257604": {
        "name": "PIP3 activates AKT signaling",
        "genes": ["PIK3CA", "AKT1", "PDK1", "PTEN"],
        "edges": [("PIK3CA", "PDK1"), ("PDK1", "AKT1"), ("PTEN", "PIK3CA")],
    },
}


# ── ExpressionProcessor ─────────────────────────────────────────────


class ExpressionProcessor:
    """Advanced genomics expression analysis processor."""

    OPERATIONS = [
        "negative_binomial_test",
        "coexpression_network",
        "clustergram",
        "dimensionality_reduction",
        "gene_set_variation",
        "volcano_plot",
        "pathway_topology",
    ]

    def list_operations(self) -> list[str]:
        return self.OPERATIONS

    async def execute(
        self, request: ComputeRequest, progress_callback: Callable | None = None,
    ) -> ComputeResult:
        dispatch = {
            "negative_binomial_test": self._negative_binomial_test,
            "coexpression_network": self._coexpression_network,
            "clustergram": self._clustergram,
            "dimensionality_reduction": self._dimensionality_reduction,
            "gene_set_variation": self._gene_set_variation,
            "volcano_plot": self._volcano_plot,
            "pathway_topology": self._pathway_topology,
        }
        op = request.operation
        if op not in dispatch:
            return ComputeResult(
                request_id=request.id,
                domain=ComputeDomain.GENOMICS,
                operation=op,
                status=ComputeStatus.FAILED,
                error=f"Unknown operation: {op}. Available: {self.OPERATIONS}",
            )
        try:
            return await dispatch[op](request, progress_callback)
        except Exception as exc:
            return ComputeResult(
                request_id=request.id,
                domain=ComputeDomain.GENOMICS,
                operation=op,
                status=ComputeStatus.FAILED,
                error=str(exc),
            )

    # ────────────────────────────────────────────────────────────────
    # 1. Negative Binomial Test (DESeq2-equivalent)
    # ────────────────────────────────────────────────────────────────

    async def _negative_binomial_test(
        self, request: ComputeRequest, progress_callback: Callable | None,
    ) -> ComputeResult:
        params = request.parameters
        data = request.data or {}
        count_matrix = np.array(data.get("count_matrix", params.get("count_matrix")), dtype=np.float64)
        conditions = data.get("conditions", params.get("conditions"))
        gene_names = data.get("gene_names", params.get("gene_names"))
        alpha = float(params.get("alpha", 0.1))

        n_genes, n_samples = count_matrix.shape
        if gene_names is None:
            gene_names = [f"gene_{i}" for i in range(n_genes)]

        unique_conds = sorted(set(conditions))
        if len(unique_conds) != 2:
            raise ValueError("Exactly two conditions required for differential expression.")
        cond_a, cond_b = unique_conds
        idx_a = np.array([i for i, c in enumerate(conditions) if c == cond_a])
        idx_b = np.array([i for i, c in enumerate(conditions) if c == cond_b])

        if progress_callback:
            await progress_callback(0.05, "Estimating size factors")

        # --- Size factor estimation (median-of-ratios, DESeq2 method) ---
        # Geometric mean per gene (excluding zeros)
        log_counts = np.where(count_matrix > 0, np.log(count_matrix), np.nan)
        geo_means = np.nanmean(log_counts, axis=1)
        # Filter genes with finite geometric mean
        valid_genes = np.isfinite(geo_means)
        size_factors = np.ones(n_samples)
        if np.any(valid_genes):
            log_ratios = log_counts[valid_genes] - geo_means[valid_genes, np.newaxis]
            size_factors = np.exp(np.nanmedian(log_ratios, axis=0))
        size_factors[size_factors == 0] = 1.0

        # Normalized counts
        normed = count_matrix / size_factors[np.newaxis, :]

        if progress_callback:
            await progress_callback(0.15, "Estimating gene-wise dispersions")

        # --- Gene-wise dispersion estimation (method of moments) ---
        base_mean = np.mean(normed, axis=1)
        mu_a = np.mean(normed[:, idx_a], axis=1)
        mu_b = np.mean(normed[:, idx_b], axis=1)

        dispersions = np.zeros(n_genes)
        for g in range(n_genes):
            counts_g = count_matrix[g, :]
            mu_g = size_factors * base_mean[g]
            mu_g = np.maximum(mu_g, 1e-8)
            var_g = np.var(counts_g, ddof=1) if n_samples > 1 else 0.0
            # Method of moments: var = mu + alpha * mu^2
            mean_mu = np.mean(mu_g)
            if mean_mu > 0 and var_g > mean_mu:
                dispersions[g] = (var_g - mean_mu) / (mean_mu ** 2)
            else:
                dispersions[g] = 0.01  # floor

        dispersions = np.maximum(dispersions, 1e-8)

        if progress_callback:
            await progress_callback(0.30, "Shrinking dispersions (empirical Bayes)")

        # --- Dispersion shrinkage toward fitted trend ---
        # Fit dispersion ~ mean trend: log(disp) = a + b/mean (parametric)
        valid = (base_mean > 0) & np.isfinite(dispersions) & (dispersions > 1e-8)
        if np.sum(valid) > 5:
            x_fit = base_mean[valid]
            y_fit = dispersions[valid]
            try:
                def disp_trend(mu, a0, a1):
                    return a0 + a1 / mu
                log_y = np.log(y_fit)
                inv_x = 1.0 / np.maximum(x_fit, 1e-6)
                # Simple linear regression in log space: log(disp) = a0 + a1/mu
                X_design = np.column_stack([np.ones_like(inv_x), inv_x])
                beta_hat, _, _, _ = np.linalg.lstsq(X_design, log_y, rcond=None)
                fitted_log_disp = X_design @ beta_hat
                fitted_disp = np.exp(fitted_log_disp)

                # Empirical Bayes shrinkage: weighted average of MLE and prior
                # Variance of log dispersions around trend
                residuals = log_y - fitted_log_disp
                prior_var = np.var(residuals)
                if prior_var < 0.01:
                    prior_var = 0.01

                # Apply shrinkage to all genes
                for g in range(n_genes):
                    if base_mean[g] > 0:
                        prior_log = beta_hat[0] + beta_hat[1] / max(base_mean[g], 1e-6)
                        mle_log = np.log(max(dispersions[g], 1e-8))
                        # Shrinkage weight
                        n_g = n_samples
                        mle_var = 2.0 / max(n_g - 2, 1)  # approx variance of MLE
                        w = prior_var / (prior_var + mle_var)
                        dispersions[g] = np.exp(w * mle_log + (1 - w) * prior_log)
            except Exception:
                pass  # keep moment estimates if fitting fails

        dispersions = np.maximum(dispersions, 1e-8)

        if progress_callback:
            await progress_callback(0.50, "Fitting NB GLM and computing Wald tests")

        # --- NB GLM fitting with IRLS and Wald test ---
        log2fc = np.zeros(n_genes)
        lfc_se = np.zeros(n_genes)
        wald_stat = np.zeros(n_genes)
        pvalues = np.ones(n_genes)

        for g in range(n_genes):
            counts_g = count_matrix[g, :]
            disp_g = dispersions[g]
            sf = size_factors

            # Design matrix: intercept + condition indicator
            X = np.zeros((n_samples, 2))
            X[:, 0] = 1.0  # intercept
            for j in idx_b:
                X[j, 1] = 1.0

            # IRLS for NB GLM (log link)
            # Initialize with log(normalized counts + 1)
            beta = np.zeros(2)
            mu_init = np.mean(normed[g, idx_a])
            if mu_init <= 0:
                mu_init = 0.5
            beta[0] = np.log(mu_init)
            mu_init_b = np.mean(normed[g, idx_b])
            if mu_init_b <= 0:
                mu_init_b = 0.5
            beta[1] = np.log(mu_init_b) - np.log(mu_init)

            converged = False
            for _irls_iter in range(25):
                eta = X @ beta
                # Clamp eta for numerical stability
                eta = np.clip(eta, -30, 30)
                mu = sf * np.exp(eta)
                mu = np.maximum(mu, 1e-8)

                # Variance function: V = mu + disp * mu^2
                var_g = mu + disp_g * mu ** 2
                var_g = np.maximum(var_g, 1e-8)

                # Working weights
                W = mu ** 2 / var_g
                W = np.maximum(W, 1e-10)

                # Working response
                z = eta + (counts_g - mu) / mu

                # Weighted least squares step
                XtWX = X.T @ np.diag(W) @ X
                XtWz = X.T @ (W * z)
                try:
                    beta_new = np.linalg.solve(XtWX + 1e-10 * np.eye(2), XtWz)
                except np.linalg.LinAlgError:
                    break

                if np.max(np.abs(beta_new - beta)) < 1e-6:
                    beta = beta_new
                    converged = True
                    break
                beta = beta_new

            # Standard errors from Fisher information
            eta = X @ beta
            eta = np.clip(eta, -30, 30)
            mu = sf * np.exp(eta)
            mu = np.maximum(mu, 1e-8)
            var_g = mu + disp_g * mu ** 2
            var_g = np.maximum(var_g, 1e-8)
            W = mu ** 2 / var_g
            W = np.maximum(W, 1e-10)
            XtWX = X.T @ np.diag(W) @ X
            try:
                cov_beta = np.linalg.inv(XtWX + 1e-10 * np.eye(2))
                se = np.sqrt(np.maximum(np.diag(cov_beta), 0.0))
            except np.linalg.LinAlgError:
                se = np.array([1e6, 1e6])

            log2fc[g] = beta[1] / np.log(2)
            lfc_se[g] = se[1] / np.log(2)
            if se[1] > 0:
                wald_stat[g] = beta[1] / se[1]
                pvalues[g] = 2.0 * sp_stats.norm.sf(np.abs(wald_stat[g]))
            else:
                wald_stat[g] = 0.0
                pvalues[g] = 1.0

        if progress_callback:
            await progress_callback(0.75, "Applying FDR correction and shrinkage")

        # --- Log2 fold change shrinkage (normal prior) ---
        # apeglm-style: shrink toward zero using prior on LFC
        lfc_var = np.var(log2fc[np.isfinite(log2fc)])
        if lfc_var > 0:
            prior_var_lfc = lfc_var
            shrunk_lfc = log2fc * (lfc_se ** 2 < prior_var_lfc).astype(float)
            # Bayesian shrinkage
            for g in range(n_genes):
                if lfc_se[g] > 0:
                    s2 = lfc_se[g] ** 2
                    shrunk_lfc[g] = log2fc[g] * prior_var_lfc / (prior_var_lfc + s2)
        else:
            shrunk_lfc = log2fc.copy()

        # BH FDR correction
        padj = _bh_adjust(pvalues)

        if progress_callback:
            await progress_callback(0.85, "Generating figures")

        # Build per-gene results
        gene_results = []
        for g in range(n_genes):
            gene_results.append({
                "gene": gene_names[g],
                "baseMean": float(base_mean[g]),
                "log2FoldChange": float(shrunk_lfc[g]),
                "lfcSE": float(lfc_se[g]),
                "stat": float(wald_stat[g]),
                "pvalue": float(pvalues[g]),
                "padj": float(padj[g]),
            })

        # --- MA Plot ---
        fig_ma, ax_ma = plt.subplots(figsize=(8, 6))
        colors_ma = np.where(padj < alpha, np.where(shrunk_lfc > 0, "red", "blue"), "grey")
        ax_ma.scatter(
            np.log10(base_mean + 1), shrunk_lfc,
            c=colors_ma, s=6, alpha=0.5, edgecolors="none",
        )
        ax_ma.axhline(0, color="black", linewidth=0.5)
        ax_ma.set_xlabel("log10(baseMean + 1)")
        ax_ma.set_ylabel("log2 Fold Change")
        ax_ma.set_title("MA Plot")
        fig_ma.tight_layout()

        # --- Volcano Plot ---
        neg_log10_p = -np.log10(np.maximum(pvalues, 1e-300))
        fig_vol, ax_vol = plt.subplots(figsize=(8, 6))
        up = (padj < alpha) & (shrunk_lfc > 0)
        down = (padj < alpha) & (shrunk_lfc < 0)
        ns = ~(up | down)
        ax_vol.scatter(shrunk_lfc[ns], neg_log10_p[ns], c="grey", s=6, alpha=0.4, label="NS")
        ax_vol.scatter(shrunk_lfc[up], neg_log10_p[up], c="red", s=8, alpha=0.6, label="Up")
        ax_vol.scatter(shrunk_lfc[down], neg_log10_p[down], c="blue", s=8, alpha=0.6, label="Down")
        ax_vol.set_xlabel("log2 Fold Change")
        ax_vol.set_ylabel("-log10(p-value)")
        ax_vol.set_title("Volcano Plot")
        ax_vol.legend(fontsize=8)
        fig_vol.tight_layout()

        figures = [_make_figure(fig_ma, "MA Plot"), _make_figure(fig_vol, "Volcano Plot")]

        n_up = int(np.sum(up))
        n_down = int(np.sum(down))
        stats_tests = [
            StatisticalTest(
                test_name="Wald test (NB GLM)",
                statistic=float(np.nanmedian(np.abs(wald_stat))),
                p_value=float(np.nanmedian(pvalues)),
                significant=(n_up + n_down) > 0,
                correction_method="Benjamini-Hochberg",
            )
        ]

        if progress_callback:
            await progress_callback(1.0, "Complete")

        return ComputeResult(
            request_id=request.id,
            domain=ComputeDomain.GENOMICS,
            operation="negative_binomial_test",
            status=ComputeStatus.COMPLETED,
            results={
                "gene_results": gene_results,
                "size_factors": size_factors.tolist(),
                "dispersions": dispersions.tolist(),
                "n_up": n_up,
                "n_down": n_down,
                "n_total_tested": n_genes,
                "alpha": alpha,
            },
            statistics=stats_tests,
            figures=figures,
        )

    # ────────────────────────────────────────────────────────────────
    # 2. Co-expression Network (WGCNA-equivalent)
    # ────────────────────────────────────────────────────────────────

    async def _coexpression_network(
        self, request: ComputeRequest, progress_callback: Callable | None,
    ) -> ComputeResult:
        params = request.parameters
        data = request.data or {}
        expr_matrix = np.array(data.get("expression_matrix", params.get("expression_matrix")), dtype=np.float64)
        gene_names = data.get("gene_names", params.get("gene_names"))
        sample_names = data.get("sample_names", params.get("sample_names"))
        traits = data.get("traits", params.get("traits"))  # optional dict: trait_name -> [values]
        soft_power = params.get("soft_threshold_power", None)
        signed = params.get("signed", True)
        min_module_size = int(params.get("min_module_size", 30))

        n_genes, n_samples = expr_matrix.shape
        if gene_names is None:
            gene_names = [f"gene_{i}" for i in range(n_genes)]

        if progress_callback:
            await progress_callback(0.05, "Computing correlation matrix")

        # --- Correlation matrix ---
        # Standardize each gene across samples
        means = np.mean(expr_matrix, axis=1, keepdims=True)
        stds = np.std(expr_matrix, axis=1, ddof=1, keepdims=True)
        stds[stds == 0] = 1.0
        standardized = (expr_matrix - means) / stds
        cor_matrix = (standardized @ standardized.T) / (n_samples - 1)
        np.fill_diagonal(cor_matrix, 1.0)
        cor_matrix = np.clip(cor_matrix, -1.0, 1.0)

        if progress_callback:
            await progress_callback(0.15, "Scale-free topology fitting")

        # --- Scale-free topology fitting to find optimal power ---
        if soft_power is None:
            powers = list(range(1, 21))
            r2_values = []
            for p in powers:
                if signed:
                    adj = ((1.0 + cor_matrix) / 2.0) ** p
                else:
                    adj = np.abs(cor_matrix) ** p
                np.fill_diagonal(adj, 0.0)
                connectivity = np.sum(adj, axis=0)
                connectivity = connectivity[connectivity > 0]
                if len(connectivity) < 10:
                    r2_values.append(0.0)
                    continue
                log_k = np.log10(connectivity)
                # Frequency histogram
                n_bins = max(10, int(np.sqrt(len(log_k))))
                hist, bin_edges = np.histogram(log_k, bins=n_bins)
                bin_centers = (bin_edges[:-1] + bin_edges[1:]) / 2
                nonzero = hist > 0
                if np.sum(nonzero) < 3:
                    r2_values.append(0.0)
                    continue
                log_pk = np.log10(hist[nonzero].astype(float))
                bx = bin_centers[nonzero]
                # Linear regression: log(p(k)) ~ log(k)
                slope, intercept, r_val, _, _ = sp_stats.linregress(bx, log_pk)
                # Signed R^2 (negative slope expected for scale-free)
                r2 = r_val ** 2
                if slope > 0:
                    r2 = -r2
                r2_values.append(r2)

            # Pick smallest power with R^2 > 0.85, or highest R^2
            soft_power = 6  # default
            for i, r2 in enumerate(r2_values):
                if r2 > 0.85:
                    soft_power = powers[i]
                    break
            else:
                if r2_values:
                    soft_power = powers[int(np.argmax(r2_values))]

        if progress_callback:
            await progress_callback(0.25, f"Building adjacency matrix (power={soft_power})")

        # --- Adjacency matrix ---
        if signed:
            adjacency = ((1.0 + cor_matrix) / 2.0) ** soft_power
        else:
            adjacency = np.abs(cor_matrix) ** soft_power
        np.fill_diagonal(adjacency, 0.0)

        if progress_callback:
            await progress_callback(0.35, "Computing Topological Overlap Matrix")

        # --- TOM (Topological Overlap Matrix) ---
        connectivity = np.sum(adjacency, axis=1)
        tom = np.zeros((n_genes, n_genes))
        for i in range(n_genes):
            for j in range(i + 1, n_genes):
                # Numerator: shared neighbors + direct connection
                l_ij = np.sum(adjacency[i, :] * adjacency[:, j])
                numerator = l_ij + adjacency[i, j]
                denominator = min(connectivity[i], connectivity[j]) + 1 - adjacency[i, j]
                if denominator > 0:
                    tom[i, j] = numerator / denominator
                tom[j, i] = tom[i, j]
        np.fill_diagonal(tom, 1.0)

        if progress_callback:
            await progress_callback(0.55, "Hierarchical clustering and module detection")

        # --- Hierarchical clustering on 1 - TOM ---
        dissimilarity = 1.0 - tom
        np.fill_diagonal(dissimilarity, 0.0)
        diss_condensed = squareform(dissimilarity, checks=False)
        diss_condensed = np.maximum(diss_condensed, 0.0)
        Z = linkage(diss_condensed, method="average")

        # --- Dynamic tree cut (adaptive) ---
        # Use a range of cut heights and pick the one giving best modularity
        min_mod_size = min(min_module_size, max(5, n_genes // 20))
        best_labels = None
        best_n_modules = 0

        for height_frac in np.arange(0.1, 0.95, 0.05):
            max_d = np.max(Z[:, 2]) if len(Z) > 0 else 1.0
            labels = fcluster(Z, t=height_frac * max_d, criterion="distance")
            # Filter small modules
            unique_labels, counts = np.unique(labels, return_counts=True)
            valid_modules = unique_labels[counts >= min_mod_size]
            if len(valid_modules) >= 2:
                # Reassign small module genes to module 0 (unassigned)
                new_labels = np.zeros_like(labels)
                for idx_m, mod in enumerate(valid_modules, 1):
                    new_labels[labels == mod] = idx_m
                n_mod = len(valid_modules)
                if n_mod > best_n_modules and n_mod <= 50:
                    best_n_modules = n_mod
                    best_labels = new_labels.copy()

        if best_labels is None:
            # Fallback: simple cut
            best_labels = fcluster(Z, t=max(2, n_genes // 50), criterion="maxclust")

        if progress_callback:
            await progress_callback(0.70, "Computing module eigengenes and hub genes")

        # --- Module eigengenes (first PC of each module) ---
        modules = {}
        module_eigengenes = {}
        unique_mods = sorted(set(best_labels))
        for mod in unique_mods:
            if mod == 0:
                continue
            member_idx = np.where(best_labels == mod)[0]
            mod_name = f"ME{mod}"
            modules[mod_name] = [gene_names[i] for i in member_idx]
            sub_expr = expr_matrix[member_idx, :]
            if sub_expr.shape[0] > 1:
                # Standardize
                sub_std = (sub_expr - np.mean(sub_expr, axis=1, keepdims=True))
                s = np.std(sub_expr, axis=1, ddof=1, keepdims=True)
                s[s == 0] = 1.0
                sub_std = sub_std / s
                # SVD for first PC
                U, S_vals, Vt = np.linalg.svd(sub_std, full_matrices=False)
                eigengene = Vt[0, :]
                # Sign convention: positive correlation with mean
                if np.corrcoef(eigengene, np.mean(sub_std, axis=0))[0, 1] < 0:
                    eigengene = -eigengene
                module_eigengenes[mod_name] = eigengene.tolist()
            else:
                module_eigengenes[mod_name] = sub_expr[0, :].tolist()

        # --- Hub gene identification (kME: module membership) ---
        hub_genes = {}
        for mod_name, members in modules.items():
            if mod_name not in module_eigengenes:
                continue
            me = np.array(module_eigengenes[mod_name])
            member_idx = [gene_names.index(g) for g in members]
            kme_values = []
            for gi in member_idx:
                gene_expr = expr_matrix[gi, :]
                r = np.corrcoef(gene_expr, me)[0, 1] if np.std(gene_expr) > 0 else 0.0
                kme_values.append((gene_names[gi], float(r)))
            kme_values.sort(key=lambda x: abs(x[1]), reverse=True)
            hub_genes[mod_name] = kme_values[:10]  # top 10 hub genes

        # --- Module-trait correlation ---
        module_trait_cor = {}
        if traits:
            for mod_name, me_vals in module_eigengenes.items():
                me = np.array(me_vals)
                trait_cors = {}
                for trait_name, trait_vals in traits.items():
                    tv = np.array(trait_vals, dtype=np.float64)
                    if len(tv) == len(me) and np.std(tv) > 0:
                        r, p = sp_stats.pearsonr(me, tv)
                        trait_cors[trait_name] = {"r": float(r), "p": float(p)}
                module_trait_cor[mod_name] = trait_cors

        if progress_callback:
            await progress_callback(1.0, "Complete")

        # Summary of adjacency
        adj_summary = {
            "soft_power": soft_power,
            "signed": signed,
            "mean_connectivity": float(np.mean(np.sum(adjacency, axis=0))),
            "median_connectivity": float(np.median(np.sum(adjacency, axis=0))),
        }

        return ComputeResult(
            request_id=request.id,
            domain=ComputeDomain.GENOMICS,
            operation="coexpression_network",
            status=ComputeStatus.COMPLETED,
            results={
                "modules": modules,
                "module_eigengenes": module_eigengenes,
                "hub_genes": hub_genes,
                "module_trait_correlation": module_trait_cor,
                "adjacency_summary": adj_summary,
                "n_modules": len(modules),
                "n_unassigned": int(np.sum(best_labels == 0)),
                "scale_free_r2": r2_values if soft_power is not None else [],
            },
        )

    # ────────────────────────────────────────────────────────────────
    # 3. Clustergram
    # ────────────────────────────────────────────────────────────────

    async def _clustergram(
        self, request: ComputeRequest, progress_callback: Callable | None,
    ) -> ComputeResult:
        params = request.parameters
        data = request.data or {}
        expr_matrix = np.array(data.get("expression_matrix", params.get("expression_matrix")), dtype=np.float64)
        row_labels = data.get("row_labels", params.get("row_labels"))
        col_labels = data.get("col_labels", params.get("col_labels"))
        linkage_method = params.get("linkage_method", "ward")
        distance_metric = params.get("distance_metric", "euclidean")
        standardize = params.get("standardize", True)

        n_rows, n_cols = expr_matrix.shape
        if row_labels is None:
            row_labels = [f"row_{i}" for i in range(n_rows)]
        if col_labels is None:
            col_labels = [f"col_{j}" for j in range(n_cols)]

        if progress_callback:
            await progress_callback(0.10, "Standardizing data")

        # --- Z-score normalization (row-wise) ---
        if standardize:
            row_means = np.mean(expr_matrix, axis=1, keepdims=True)
            row_stds = np.std(expr_matrix, axis=1, ddof=1, keepdims=True)
            row_stds[row_stds == 0] = 1.0
            z_matrix = (expr_matrix - row_means) / row_stds
        else:
            z_matrix = expr_matrix.copy()

        if progress_callback:
            await progress_callback(0.25, "Computing distance matrices")

        # --- Distance computation ---
        if distance_metric == "correlation":
            row_dist = pdist(z_matrix, metric="correlation")
            col_dist = pdist(z_matrix.T, metric="correlation")
        elif distance_metric == "cosine":
            row_dist = pdist(z_matrix, metric="cosine")
            col_dist = pdist(z_matrix.T, metric="cosine")
        else:
            row_dist = pdist(z_matrix, metric="euclidean")
            col_dist = pdist(z_matrix.T, metric="euclidean")

        # Replace NaN distances with max distance
        row_dist = np.nan_to_num(row_dist, nan=np.nanmax(row_dist) if len(row_dist) > 0 else 0.0)
        col_dist = np.nan_to_num(col_dist, nan=np.nanmax(col_dist) if len(col_dist) > 0 else 0.0)

        if progress_callback:
            await progress_callback(0.40, "Hierarchical clustering")

        # --- Linkage ---
        method = linkage_method if linkage_method in ("ward", "complete", "average", "single") else "ward"
        # Ward requires euclidean distance
        if method == "ward" and distance_metric != "euclidean":
            method = "average"

        row_linkage = linkage(row_dist, method=method) if n_rows > 1 else None
        col_linkage = linkage(col_dist, method=method) if n_cols > 1 else None

        if progress_callback:
            await progress_callback(0.55, "Computing optimal leaf ordering")

        # --- Optimal leaf ordering ---
        if row_linkage is not None:
            try:
                from scipy.cluster.hierarchy import optimal_leaf_ordering
                row_linkage = optimal_leaf_ordering(row_linkage, row_dist)
            except (ImportError, Exception):
                pass
            row_order = leaves_list(row_linkage).tolist()
        else:
            row_order = list(range(n_rows))

        if col_linkage is not None:
            try:
                from scipy.cluster.hierarchy import optimal_leaf_ordering
                col_linkage = optimal_leaf_ordering(col_linkage, col_dist)
            except (ImportError, Exception):
                pass
            col_order = leaves_list(col_linkage).tolist()
        else:
            col_order = list(range(n_cols))

        if progress_callback:
            await progress_callback(0.70, "Generating clustergram figure")

        # --- Clustergram figure with dendrograms ---
        fig = plt.figure(figsize=(12, 10))

        # Layout: dendrogram top, dendrogram left, heatmap center, colorbar right
        # Grid: 2x2 + colorbar
        gs = fig.add_gridspec(
            2, 3, width_ratios=[0.15, 0.8, 0.05], height_ratios=[0.15, 0.85],
            wspace=0.02, hspace=0.02,
        )

        # Row dendrogram (left)
        ax_row_dend = fig.add_subplot(gs[1, 0])
        if row_linkage is not None:
            dendrogram(row_linkage, orientation="left", ax=ax_row_dend,
                       no_labels=True, color_threshold=0, above_threshold_color="black")
        ax_row_dend.set_xticks([])
        ax_row_dend.set_yticks([])
        ax_row_dend.spines[:].set_visible(False)

        # Column dendrogram (top)
        ax_col_dend = fig.add_subplot(gs[0, 1])
        if col_linkage is not None:
            dendrogram(col_linkage, orientation="top", ax=ax_col_dend,
                       no_labels=True, color_threshold=0, above_threshold_color="black")
        ax_col_dend.set_xticks([])
        ax_col_dend.set_yticks([])
        ax_col_dend.spines[:].set_visible(False)

        # Heatmap
        ax_heat = fig.add_subplot(gs[1, 1])
        ordered_matrix = z_matrix[np.ix_(row_order, col_order)]
        vmax = np.percentile(np.abs(z_matrix), 95) if z_matrix.size > 0 else 1.0
        im = ax_heat.imshow(
            ordered_matrix, aspect="auto", cmap="RdBu_r",
            vmin=-vmax, vmax=vmax, interpolation="nearest",
        )

        # Labels
        if n_rows <= 80:
            ax_heat.set_yticks(range(n_rows))
            ax_heat.set_yticklabels([row_labels[i] for i in row_order], fontsize=max(4, 8 - n_rows // 20))
        else:
            ax_heat.set_yticks([])
        if n_cols <= 80:
            ax_heat.set_xticks(range(n_cols))
            ax_heat.set_xticklabels([col_labels[i] for i in col_order], fontsize=max(4, 8 - n_cols // 20), rotation=90)
        else:
            ax_heat.set_xticks([])

        # Colorbar
        ax_cbar = fig.add_subplot(gs[1, 2])
        plt.colorbar(im, cax=ax_cbar, label="Z-score" if standardize else "Value")

        fig.suptitle("Clustergram", fontsize=14, y=0.98)
        figures = [_make_figure(fig, "Clustergram")]

        # Build dendrogram data for results
        row_dend_data = {}
        col_dend_data = {}
        if row_linkage is not None:
            row_dend_data = {
                "linkage": row_linkage.tolist(),
                "leaves": row_order,
            }
        if col_linkage is not None:
            col_dend_data = {
                "linkage": col_linkage.tolist(),
                "leaves": col_order,
            }

        if progress_callback:
            await progress_callback(1.0, "Complete")

        return ComputeResult(
            request_id=request.id,
            domain=ComputeDomain.GENOMICS,
            operation="clustergram",
            status=ComputeStatus.COMPLETED,
            results={
                "row_order": row_order,
                "col_order": col_order,
                "row_dendrogram": row_dend_data,
                "col_dendrogram": col_dend_data,
                "z_matrix": ordered_matrix.tolist(),
                "ordered_row_labels": [row_labels[i] for i in row_order],
                "ordered_col_labels": [col_labels[i] for i in col_order],
            },
            figures=figures,
        )

    # ────────────────────────────────────────────────────────────────
    # 4. Dimensionality Reduction (PCA / t-SNE / UMAP)
    # ────────────────────────────────────────────────────────────────

    async def _dimensionality_reduction(
        self, request: ComputeRequest, progress_callback: Callable | None,
    ) -> ComputeResult:
        params = request.parameters
        data = request.data or {}
        data_matrix = np.array(data.get("data_matrix", params.get("data_matrix")), dtype=np.float64)
        method = params.get("method", "pca").lower()
        n_components = int(params.get("n_components", 2))
        labels = data.get("labels", params.get("labels"))
        sample_names = data.get("sample_names", params.get("sample_names"))

        n_samples, n_features = data_matrix.shape
        if sample_names is None:
            sample_names = [f"sample_{i}" for i in range(n_samples)]

        results = {}
        figures = []

        if method == "pca":
            results, figures = await self._run_pca(
                data_matrix, n_components, labels, sample_names, progress_callback,
            )
        elif method == "tsne":
            results, figures = await self._run_tsne(
                data_matrix, n_components, labels, sample_names, params, progress_callback,
            )
        elif method == "umap":
            results, figures = await self._run_umap(
                data_matrix, n_components, labels, sample_names, params, progress_callback,
            )
        else:
            raise ValueError(f"Unknown method: {method}. Use pca, tsne, or umap.")

        results["method"] = method
        results["n_components"] = n_components
        results["n_samples"] = n_samples
        results["n_features"] = n_features

        return ComputeResult(
            request_id=request.id,
            domain=ComputeDomain.GENOMICS,
            operation="dimensionality_reduction",
            status=ComputeStatus.COMPLETED,
            results=results,
            figures=figures,
        )

    async def _run_pca(
        self, X: np.ndarray, n_comp: int, labels, sample_names, progress_callback,
    ) -> tuple[dict, list]:
        if progress_callback:
            await progress_callback(0.10, "Centering data for PCA")

        n_samples, n_features = X.shape
        n_comp = min(n_comp, min(n_samples, n_features))

        # Center
        mean = np.mean(X, axis=0)
        X_centered = X - mean

        if progress_callback:
            await progress_callback(0.30, "Computing eigendecomposition")

        # Covariance matrix and eigen-decomposition
        if n_features <= n_samples:
            cov = (X_centered.T @ X_centered) / (n_samples - 1)
            eigenvalues, eigenvectors = np.linalg.eigh(cov)
            # Sort descending
            idx = np.argsort(eigenvalues)[::-1]
            eigenvalues = eigenvalues[idx]
            eigenvectors = eigenvectors[:, idx]
            loadings = eigenvectors[:, :n_comp]
            scores = X_centered @ loadings
        else:
            # Use SVD for high-dimensional case
            U, S, Vt = np.linalg.svd(X_centered, full_matrices=False)
            eigenvalues = (S ** 2) / (n_samples - 1)
            loadings = Vt[:n_comp, :].T
            scores = U[:, :n_comp] * S[:n_comp]

        total_var = np.sum(eigenvalues[eigenvalues > 0])
        explained_variance_ratio = eigenvalues[:n_comp] / total_var if total_var > 0 else np.zeros(n_comp)
        cumulative_variance = np.cumsum(explained_variance_ratio)

        if progress_callback:
            await progress_callback(0.60, "Generating PCA figures")

        # --- Scree plot ---
        n_show = min(20, len(eigenvalues))
        fig_scree, ax_scree = plt.subplots(figsize=(8, 5))
        ax_scree.bar(range(1, n_show + 1), explained_variance_ratio[:n_show] * 100, color="steelblue", alpha=0.7)
        ax2 = ax_scree.twinx()
        ax2.plot(range(1, n_show + 1), cumulative_variance[:n_show] * 100, "r-o", markersize=4)
        ax2.set_ylabel("Cumulative Variance (%)")
        ax_scree.set_xlabel("Principal Component")
        ax_scree.set_ylabel("Explained Variance (%)")
        ax_scree.set_title("Scree Plot")
        fig_scree.tight_layout()
        figs = [_make_figure(fig_scree, "Scree Plot")]

        # --- Scatter plot (2D or 3D) ---
        if n_comp >= 2:
            fig_scatter, ax_scatter = plt.subplots(figsize=(8, 7))
            if labels is not None:
                unique_labels = sorted(set(labels))
                cmap_scatter = cm.get_cmap("tab10", len(unique_labels))
                for idx_l, lbl in enumerate(unique_labels):
                    mask = np.array([l == lbl for l in labels])
                    ax_scatter.scatter(
                        scores[mask, 0], scores[mask, 1],
                        c=[cmap_scatter(idx_l)], label=str(lbl), s=40, alpha=0.7,
                    )
                ax_scatter.legend(fontsize=8, loc="best")
            else:
                ax_scatter.scatter(scores[:, 0], scores[:, 1], s=40, alpha=0.7)
            ax_scatter.set_xlabel(f"PC1 ({explained_variance_ratio[0]*100:.1f}%)")
            ax_scatter.set_ylabel(f"PC2 ({explained_variance_ratio[1]*100:.1f}%)")
            ax_scatter.set_title("PCA Scatter Plot")
            fig_scatter.tight_layout()
            figs.append(_make_figure(fig_scatter, "PCA Scatter"))

        # --- Biplot ---
        if n_comp >= 2 and loadings.shape[0] <= 50:
            fig_bi, ax_bi = plt.subplots(figsize=(9, 8))
            ax_bi.scatter(scores[:, 0], scores[:, 1], s=20, alpha=0.5, c="grey")
            # Scale loadings for visibility
            scale = np.max(np.abs(scores[:, :2])) / np.max(np.abs(loadings[:, :2]) + 1e-10) * 0.8
            for j in range(min(loadings.shape[0], 20)):
                ax_bi.arrow(0, 0, loadings[j, 0] * scale, loadings[j, 1] * scale,
                            head_width=scale * 0.02, head_length=scale * 0.01, fc="red", ec="red", alpha=0.6)
            ax_bi.set_xlabel(f"PC1 ({explained_variance_ratio[0]*100:.1f}%)")
            ax_bi.set_ylabel(f"PC2 ({explained_variance_ratio[1]*100:.1f}%)")
            ax_bi.set_title("PCA Biplot")
            fig_bi.tight_layout()
            figs.append(_make_figure(fig_bi, "PCA Biplot"))

        if progress_callback:
            await progress_callback(1.0, "PCA complete")

        return {
            "embedding": scores.tolist(),
            "explained_variance": eigenvalues[:n_comp].tolist(),
            "explained_variance_ratio": explained_variance_ratio.tolist(),
            "cumulative_variance": cumulative_variance.tolist(),
            "loadings": loadings.tolist(),
        }, figs

    async def _run_tsne(
        self, X: np.ndarray, n_comp: int, labels, sample_names, params, progress_callback,
    ) -> tuple[dict, list]:
        """Barnes-Hut t-SNE implementation."""
        perplexity = float(params.get("perplexity", 30.0))
        learning_rate = float(params.get("learning_rate", 200.0))
        n_iter = int(params.get("n_iter", 1000))
        random_state = int(params.get("random_state", 42))

        n_samples = X.shape[0]
        perplexity = min(perplexity, (n_samples - 1) / 3.0)

        if progress_callback:
            await progress_callback(0.10, "Computing pairwise distances for t-SNE")

        rng = np.random.RandomState(random_state)

        # Pairwise squared Euclidean distances
        sum_sq = np.sum(X ** 2, axis=1)
        D_sq = sum_sq[:, np.newaxis] + sum_sq[np.newaxis, :] - 2.0 * (X @ X.T)
        D_sq = np.maximum(D_sq, 0.0)
        np.fill_diagonal(D_sq, 0.0)

        if progress_callback:
            await progress_callback(0.20, "Computing conditional probabilities")

        # --- Compute joint probability matrix P (with perplexity calibration) ---
        P = np.zeros((n_samples, n_samples))
        target_entropy = np.log(perplexity)

        for i in range(n_samples):
            # Binary search for sigma_i
            beta_min, beta_max = -np.inf, np.inf
            beta = 1.0  # 1 / (2 * sigma^2)
            dists_i = D_sq[i, :]
            mask = np.ones(n_samples, dtype=bool)
            mask[i] = False

            for _ in range(50):
                exp_d = np.exp(-dists_i * beta)
                exp_d[i] = 0.0
                sum_exp = np.sum(exp_d)
                if sum_exp == 0:
                    sum_exp = 1e-10
                p_i = exp_d / sum_exp
                p_i[i] = 0.0

                # Shannon entropy
                p_nonzero = p_i[p_i > 1e-20]
                entropy = -np.sum(p_nonzero * np.log(p_nonzero))

                diff = entropy - target_entropy
                if np.abs(diff) < 1e-5:
                    break
                if diff > 0:
                    beta_min = beta
                    beta = beta * 2 if beta_max == np.inf else (beta + beta_max) / 2
                else:
                    beta_max = beta
                    beta = beta / 2 if beta_min == -np.inf else (beta + beta_min) / 2

            P[i, :] = p_i

        # Symmetrize
        P = (P + P.T) / (2.0 * n_samples)
        P = np.maximum(P, 1e-12)

        if progress_callback:
            await progress_callback(0.35, "Running t-SNE gradient descent")

        # --- Gradient descent ---
        Y = rng.randn(n_samples, n_comp) * 0.01
        Y_prev = Y.copy()
        gains = np.ones_like(Y)
        kl_history = []

        # Early exaggeration
        P_exag = P * 12.0

        for iteration in range(n_iter):
            P_use = P_exag if iteration < 250 else P

            # Compute Q (Student-t with 1 dof)
            diff_y = Y[:, np.newaxis, :] - Y[np.newaxis, :, :]
            dist_sq_y = np.sum(diff_y ** 2, axis=2)
            num = 1.0 / (1.0 + dist_sq_y)
            np.fill_diagonal(num, 0.0)
            Q = num / np.maximum(np.sum(num), 1e-10)
            Q = np.maximum(Q, 1e-12)

            # KL divergence
            if iteration % 50 == 0:
                kl = np.sum(P_use * np.log(P_use / Q))
                kl_history.append(float(kl))

            # Gradient
            pq_diff = (P_use - Q) * num
            gradient = np.zeros_like(Y)
            for i in range(n_samples):
                gradient[i] = 4.0 * np.sum(pq_diff[i, :, np.newaxis] * (Y[i] - Y), axis=0)

            # Adaptive learning rate with momentum
            momentum = 0.5 if iteration < 250 else 0.8
            gains = (gains + 0.2) * ((gradient > 0) != (Y - Y_prev > 0)).astype(float) +                     gains * 0.8 * ((gradient > 0) == (Y - Y_prev > 0)).astype(float)
            gains = np.maximum(gains, 0.01)

            Y_new = Y - learning_rate * gains * gradient + momentum * (Y - Y_prev)
            Y_prev = Y.copy()
            Y = Y_new
            # Center
            Y = Y - np.mean(Y, axis=0)

            if progress_callback and iteration % 100 == 0:
                frac = 0.35 + 0.55 * (iteration / n_iter)
                await progress_callback(frac, f"t-SNE iteration {iteration}/{n_iter}")

        if progress_callback:
            await progress_callback(0.92, "Generating t-SNE figure")

        # --- Figure ---
        fig, ax = plt.subplots(figsize=(8, 7))
        if labels is not None:
            unique_labels = sorted(set(labels))
            cmap_t = cm.get_cmap("tab10", len(unique_labels))
            for idx_l, lbl in enumerate(unique_labels):
                mask = np.array([l == lbl for l in labels])
                ax.scatter(Y[mask, 0], Y[mask, 1], c=[cmap_t(idx_l)], label=str(lbl), s=30, alpha=0.7)
            ax.legend(fontsize=8, loc="best")
        else:
            ax.scatter(Y[:, 0], Y[:, 1], s=30, alpha=0.7)
        ax.set_xlabel("t-SNE 1")
        ax.set_ylabel("t-SNE 2")
        ax.set_title(f"t-SNE (perplexity={perplexity:.0f})")
        fig.tight_layout()

        return {
            "embedding": Y.tolist(),
            "kl_divergence": kl_history,
            "parameters": {"perplexity": perplexity, "learning_rate": learning_rate, "n_iter": n_iter},
        }, [_make_figure(fig, "t-SNE")]

    async def _run_umap(
        self, X: np.ndarray, n_comp: int, labels, sample_names, params, progress_callback,
    ) -> tuple[dict, list]:
        """UMAP implementation: fuzzy simplicial set + SGD layout optimization."""
        n_neighbors = int(params.get("n_neighbors", 15))
        min_dist = float(params.get("min_dist", 0.1))
        n_epochs = int(params.get("n_epochs", 200))
        random_state = int(params.get("random_state", 42))

        n_samples = X.shape[0]
        n_neighbors = min(n_neighbors, n_samples - 1)
        rng = np.random.RandomState(random_state)

        if progress_callback:
            await progress_callback(0.10, "Computing k-nearest neighbors")

        # --- k-NN graph ---
        D_sq = np.sum(X ** 2, axis=1)[:, np.newaxis] + np.sum(X ** 2, axis=1)[np.newaxis, :] - 2.0 * (X @ X.T)
        D = np.sqrt(np.maximum(D_sq, 0.0))
        np.fill_diagonal(D, np.inf)

        knn_indices = np.zeros((n_samples, n_neighbors), dtype=int)
        knn_dists = np.zeros((n_samples, n_neighbors))
        for i in range(n_samples):
            idx_sorted = np.argsort(D[i, :])[:n_neighbors]
            knn_indices[i] = idx_sorted
            knn_dists[i] = D[i, idx_sorted]

        if progress_callback:
            await progress_callback(0.25, "Computing fuzzy simplicial set")

        # --- Smooth kNN distances (compute rho and sigma per point) ---
        rho = np.zeros(n_samples)
        sigma = np.ones(n_samples)
        target = np.log2(n_neighbors)

        for i in range(n_samples):
            dists_i = knn_dists[i]
            rho[i] = dists_i[0] if dists_i[0] > 0 else 1e-6

            # Binary search for sigma
            lo, hi = 1e-6, 1000.0
            for _ in range(64):
                mid = (lo + hi) / 2.0
                vals = np.exp(-(np.maximum(dists_i - rho[i], 0.0)) / mid)
                s = np.sum(vals)
                if s > target:
                    hi = mid
                else:
                    lo = mid
                if hi - lo < 1e-6:
                    break
            sigma[i] = (lo + hi) / 2.0

        # --- Fuzzy simplicial set (membership strengths) ---
        rows, cols, vals = [], [], []
        for i in range(n_samples):
            for k_idx in range(n_neighbors):
                j = knn_indices[i, k_idx]
                d = knn_dists[i, k_idx]
                w = np.exp(-(max(d - rho[i], 0.0)) / max(sigma[i], 1e-10))
                rows.append(i)
                cols.append(j)
                vals.append(w)

        # Symmetrize: w_sym = w + w^T - w * w^T
        W = np.zeros((n_samples, n_samples))
        for r, c, v in zip(rows, cols, vals):
            W[r, c] = v
        W_sym = W + W.T - W * W.T
        np.fill_diagonal(W_sym, 0.0)

        if progress_callback:
            await progress_callback(0.40, "Spectral initialization")

        # --- Spectral initialization ---
        # Graph Laplacian of the fuzzy set
        D_diag = np.sum(W_sym, axis=1)
        D_diag_inv_sqrt = np.where(D_diag > 0, 1.0 / np.sqrt(D_diag), 0.0)
        L_norm = np.eye(n_samples) - (D_diag_inv_sqrt[:, np.newaxis] * W_sym * D_diag_inv_sqrt[np.newaxis, :])
        L_norm = (L_norm + L_norm.T) / 2.0  # ensure symmetry

        try:
            eigenvalues_l, eigenvectors_l = np.linalg.eigh(L_norm)
            # Use eigenvectors corresponding to smallest non-zero eigenvalues
            init_embedding = eigenvectors_l[:, 1:n_comp + 1] * 10.0
        except Exception:
            init_embedding = rng.randn(n_samples, n_comp) * 0.01

        if progress_callback:
            await progress_callback(0.50, "SGD layout optimization")

        # --- Find a, b parameters for the distance weighting ---
        # Fit: 1/(1 + a*d^(2b)) to match desired min_dist
        def curve_fn(d_arr, a, b):
            return 1.0 / (1.0 + a * np.power(d_arr, 2 * b))

        d_test = np.linspace(0, 3.0, 300)
        target_curve = np.where(d_test <= min_dist, 1.0, np.exp(-(d_test - min_dist)))
        try:
            (a_param, b_param), _ = sp_optimize.curve_fit(curve_fn, d_test, target_curve, p0=[1.0, 1.0], maxfev=5000)
        except Exception:
            a_param, b_param = 1.0, 1.0

        # --- SGD optimization ---
        embedding = init_embedding.copy()

        # Build edge list from symmetric weights
        edge_rows, edge_cols, edge_weights = [], [], []
        for i in range(n_samples):
            for j in range(i + 1, n_samples):
                if W_sym[i, j] > 0.01:
                    edge_rows.append(i)
                    edge_cols.append(j)
                    edge_weights.append(W_sym[i, j])

        edge_rows = np.array(edge_rows, dtype=int)
        edge_cols = np.array(edge_cols, dtype=int)
        edge_weights = np.array(edge_weights)
        n_edges = len(edge_rows)

        if n_edges == 0:
            # Fallback if no edges
            embedding = rng.randn(n_samples, n_comp)
        else:
            epochs_per_sample = np.maximum(1.0, edge_weights.max() / edge_weights * n_epochs)

            for epoch in range(n_epochs):
                alpha_lr = 1.0 - epoch / n_epochs
                for e_idx in range(n_edges):
                    if epoch % max(1, int(epochs_per_sample[e_idx])) != 0:
                        continue
                    i, j = edge_rows[e_idx], edge_cols[e_idx]
                    diff = embedding[i] - embedding[j]
                    dist_sq = np.sum(diff ** 2)
                    dist_sq = max(dist_sq, 1e-6)

                    # Attractive force
                    grad_coeff = -2.0 * a_param * b_param * dist_sq ** (b_param - 1)
                    grad_coeff /= (1.0 + a_param * dist_sq ** b_param)
                    grad = grad_coeff * diff
                    embedding[i] += alpha_lr * np.clip(grad, -4, 4)
                    embedding[j] -= alpha_lr * np.clip(grad, -4, 4)

                    # Repulsive: sample a random negative
                    k = rng.randint(0, n_samples)
                    if k != i:
                        diff_neg = embedding[i] - embedding[k]
                        dist_sq_neg = np.sum(diff_neg ** 2)
                        dist_sq_neg = max(dist_sq_neg, 1e-6)
                        grad_rep = 2.0 * b_param / ((0.001 + dist_sq_neg) * (1.0 + a_param * dist_sq_neg ** b_param))
                        embedding[i] += alpha_lr * np.clip(grad_rep * diff_neg, -4, 4)

                if progress_callback and epoch % 20 == 0:
                    frac = 0.50 + 0.40 * (epoch / n_epochs)
                    await progress_callback(frac, f"UMAP epoch {epoch}/{n_epochs}")

        if progress_callback:
            await progress_callback(0.92, "Generating UMAP figure")

        # --- Figure ---
        fig, ax = plt.subplots(figsize=(8, 7))
        if labels is not None:
            unique_labels = sorted(set(labels))
            cmap_u = cm.get_cmap("tab10", len(unique_labels))
            for idx_l, lbl in enumerate(unique_labels):
                mask = np.array([l == lbl for l in labels])
                ax.scatter(embedding[mask, 0], embedding[mask, 1],
                           c=[cmap_u(idx_l)], label=str(lbl), s=30, alpha=0.7)
            ax.legend(fontsize=8, loc="best")
        else:
            ax.scatter(embedding[:, 0], embedding[:, 1], s=30, alpha=0.7)
        ax.set_xlabel("UMAP 1")
        ax.set_ylabel("UMAP 2")
        ax.set_title(f"UMAP (n_neighbors={n_neighbors}, min_dist={min_dist})")
        fig.tight_layout()

        return {
            "embedding": embedding.tolist(),
            "parameters": {
                "n_neighbors": n_neighbors,
                "min_dist": min_dist,
                "n_epochs": n_epochs,
                "a": float(a_param),
                "b": float(b_param),
            },
        }, [_make_figure(fig, "UMAP")]

    # ────────────────────────────────────────────────────────────────
    # 5. Gene Set Variation Analysis (GSVA / ssGSEA / z-score)
    # ────────────────────────────────────────────────────────────────

    async def _gene_set_variation(
        self, request: ComputeRequest, progress_callback: Callable | None,
    ) -> ComputeResult:
        params = request.parameters
        data = request.data or {}
        expr_matrix = np.array(data.get("expression_matrix", params.get("expression_matrix")), dtype=np.float64)
        gene_names = data.get("gene_names", params.get("gene_names"))
        sample_names = data.get("sample_names", params.get("sample_names"))
        gene_sets = data.get("gene_sets", params.get("gene_sets"))  # dict: set_name -> [gene_names]
        method = params.get("method", "gsva").lower()

        n_genes, n_samples = expr_matrix.shape
        if gene_names is None:
            gene_names = [f"gene_{i}" for i in range(n_genes)]
        if sample_names is None:
            sample_names = [f"sample_{j}" for j in range(n_samples)]

        gene_to_idx = {g: i for i, g in enumerate(gene_names)}
        gs_names = sorted(gene_sets.keys())

        if progress_callback:
            await progress_callback(0.10, f"Computing {method.upper()} enrichment scores")

        enrichment_scores = np.zeros((len(gs_names), n_samples))

        if method == "gsva":
            enrichment_scores = self._compute_gsva(
                expr_matrix, gene_names, gene_to_idx, gene_sets, gs_names,
            )
        elif method == "ssgsea":
            enrichment_scores = self._compute_ssgsea(
                expr_matrix, gene_names, gene_to_idx, gene_sets, gs_names,
            )
        elif method == "zscore":
            enrichment_scores = self._compute_zscore_enrichment(
                expr_matrix, gene_names, gene_to_idx, gene_sets, gs_names,
            )
        else:
            raise ValueError(f"Unknown method: {method}. Use gsva, ssgsea, or zscore.")

        if progress_callback:
            await progress_callback(0.80, "Generating heatmap")

        # --- Enrichment heatmap ---
        fig, ax = plt.subplots(figsize=(max(8, n_samples * 0.4), max(4, len(gs_names) * 0.3 + 2)))
        vmax = np.percentile(np.abs(enrichment_scores), 95) if enrichment_scores.size > 0 else 1.0
        if vmax == 0:
            vmax = 1.0
        im = ax.imshow(enrichment_scores, aspect="auto", cmap="RdBu_r", vmin=-vmax, vmax=vmax)
        ax.set_yticks(range(len(gs_names)))
        ax.set_yticklabels(gs_names, fontsize=8)
        if n_samples <= 40:
            ax.set_xticks(range(n_samples))
            ax.set_xticklabels(sample_names, fontsize=7, rotation=90)
        ax.set_title(f"{method.upper()} Enrichment Scores")
        plt.colorbar(im, ax=ax, shrink=0.7, label="Enrichment Score")
        fig.tight_layout()

        if progress_callback:
            await progress_callback(1.0, "Complete")

        return ComputeResult(
            request_id=request.id,
            domain=ComputeDomain.GENOMICS,
            operation="gene_set_variation",
            status=ComputeStatus.COMPLETED,
            results={
                "enrichment_scores": enrichment_scores.tolist(),
                "gene_set_names": gs_names,
                "sample_names": sample_names,
                "method": method,
            },
            figures=[_make_figure(fig, f"{method.upper()} Enrichment Heatmap")],
        )

    def _compute_gsva(
        self, expr: np.ndarray, gene_names: list, gene_to_idx: dict,
        gene_sets: dict, gs_names: list,
    ) -> np.ndarray:
        """GSVA: kernel density estimation of ranks, KS-like walk."""
        n_genes, n_samples = expr.shape
        scores = np.zeros((len(gs_names), n_samples))

        for j in range(n_samples):
            col = expr[:, j]
            # Rank genes in this sample
            rank_order = np.argsort(np.argsort(col)).astype(float)

            # Kernel density estimation of expression-level-weighted ranks
            # Use Gaussian kernel on ranks
            bw = max(1.0, n_genes * 0.05)
            grid = np.arange(n_genes, dtype=float)
            # KDE for each gene
            density = np.zeros(n_genes)
            for i in range(n_genes):
                density[i] = np.sum(np.exp(-0.5 * ((grid - rank_order[i]) / bw) ** 2))
            density /= np.sum(density) + 1e-10

            sorted_idx = np.argsort(rank_order)

            for gs_idx, gs_name in enumerate(gs_names):
                members = gene_sets[gs_name]
                member_idx = set()
                for g in members:
                    if g in gene_to_idx:
                        member_idx.add(gene_to_idx[g])

                if len(member_idx) == 0:
                    continue

                n_in = len(member_idx)
                n_out = n_genes - n_in

                # Walk the ranked list
                in_set = np.array([i in member_idx for i in sorted_idx], dtype=float)
                out_set = 1.0 - in_set

                # Weighted by density (expression level)
                weights = np.abs(density[sorted_idx])

                # Running sum (KS-like statistic)
                hit = np.cumsum(in_set * weights)
                hit_denom = np.sum(in_set * weights)
                if hit_denom > 0:
                    hit /= hit_denom

                miss = np.cumsum(out_set)
                miss_denom = np.sum(out_set)
                if miss_denom > 0:
                    miss /= miss_denom

                running_es = hit - miss

                # GSVA uses the difference of max and min
                es_max = np.max(running_es)
                es_min = np.min(running_es)
                if np.abs(es_max) > np.abs(es_min):
                    scores[gs_idx, j] = es_max
                else:
                    scores[gs_idx, j] = es_min

        return scores

    def _compute_ssgsea(
        self, expr: np.ndarray, gene_names: list, gene_to_idx: dict,
        gene_sets: dict, gs_names: list,
    ) -> np.ndarray:
        """ssGSEA: rank-based enrichment per sample."""
        n_genes, n_samples = expr.shape
        alpha_weight = 0.25  # weighting exponent
        scores = np.zeros((len(gs_names), n_samples))

        for j in range(n_samples):
            col = expr[:, j]
            ranks = sp_stats.rankdata(col, method="average")

            for gs_idx, gs_name in enumerate(gs_names):
                members = gene_sets[gs_name]
                member_idx = []
                for g in members:
                    if g in gene_to_idx:
                        member_idx.append(gene_to_idx[g])

                if len(member_idx) == 0:
                    continue

                n_in = len(member_idx)
                n_out = n_genes - n_in
                member_set = set(member_idx)

                # Sort genes by rank
                sorted_genes = np.argsort(ranks)[::-1]  # descending rank

                # Weighted walk
                in_set_weights = np.zeros(n_genes)
                for k, g_idx in enumerate(sorted_genes):
                    if g_idx in member_set:
                        in_set_weights[k] = np.abs(ranks[g_idx]) ** alpha_weight

                # Cumulative sums
                hit_sum = np.sum(in_set_weights)
                if hit_sum == 0:
                    continue

                running_hit = np.cumsum(in_set_weights) / hit_sum
                running_miss = np.cumsum(
                    np.array([1.0 if sorted_genes[k] not in member_set else 0.0 for k in range(n_genes)])
                ) / max(n_out, 1)

                es = running_hit - running_miss
                scores[gs_idx, j] = np.sum(es)  # integral-based

        # Normalize across samples
        for gs_idx in range(len(gs_names)):
            row = scores[gs_idx, :]
            rng = np.max(np.abs(row))
            if rng > 0:
                scores[gs_idx, :] = row / rng

        return scores

    def _compute_zscore_enrichment(
        self, expr: np.ndarray, gene_names: list, gene_to_idx: dict,
        gene_sets: dict, gs_names: list,
    ) -> np.ndarray:
        """Z-score method: mean z-score of gene set members per sample."""
        n_genes, n_samples = expr.shape
        scores = np.zeros((len(gs_names), n_samples))

        # Z-score normalize each gene across samples
        means = np.mean(expr, axis=1, keepdims=True)
        stds = np.std(expr, axis=1, ddof=1, keepdims=True)
        stds[stds == 0] = 1.0
        z = (expr - means) / stds

        for gs_idx, gs_name in enumerate(gs_names):
            members = gene_sets[gs_name]
            member_idx = [gene_to_idx[g] for g in members if g in gene_to_idx]
            if len(member_idx) == 0:
                continue
            # Combined z-score (Stouffer method)
            member_z = z[member_idx, :]
            scores[gs_idx, :] = np.mean(member_z, axis=0) * np.sqrt(len(member_idx))

        return scores

    # ────────────────────────────────────────────────────────────────
    # 6. Volcano Plot
    # ────────────────────────────────────────────────────────────────

    async def _volcano_plot(
        self, request: ComputeRequest, progress_callback: Callable | None,
    ) -> ComputeResult:
        params = request.parameters
        data = request.data or {}
        log2fc = np.array(data.get("log2fc", params.get("log2fc")), dtype=np.float64)
        pvalues = np.array(data.get("pvalues", params.get("pvalues")), dtype=np.float64)
        gene_names = data.get("gene_names", params.get("gene_names"))
        fc_threshold = float(params.get("fc_threshold", 1.0))
        p_threshold = float(params.get("p_threshold", 0.05))
        n_top_labels = int(params.get("n_top_labels", 10))

        n_genes = len(log2fc)
        if gene_names is None:
            gene_names = [f"gene_{i}" for i in range(n_genes)]

        if progress_callback:
            await progress_callback(0.20, "Classifying genes")

        neg_log10_p = -np.log10(np.maximum(pvalues, 1e-300))

        # Classification
        sig_up = (log2fc >= fc_threshold) & (pvalues <= p_threshold)
        sig_down = (log2fc <= -fc_threshold) & (pvalues <= p_threshold)
        nonsig = ~(sig_up | sig_down)

        n_up = int(np.sum(sig_up))
        n_down = int(np.sum(sig_down))
        n_ns = int(np.sum(nonsig))

        if progress_callback:
            await progress_callback(0.50, "Generating volcano plot figure")

        # --- Figure ---
        fig, ax = plt.subplots(figsize=(9, 7))

        ax.scatter(log2fc[nonsig], neg_log10_p[nonsig], c="grey", s=8, alpha=0.3, label=f"NS ({n_ns})")
        ax.scatter(log2fc[sig_up], neg_log10_p[sig_up], c="red", s=12, alpha=0.6, label=f"Up ({n_up})")
        ax.scatter(log2fc[sig_down], neg_log10_p[sig_down], c="blue", s=12, alpha=0.6, label=f"Down ({n_down})")

        # Threshold lines
        ax.axhline(-np.log10(p_threshold), color="grey", linestyle="--", linewidth=0.8, alpha=0.5)
        ax.axvline(fc_threshold, color="grey", linestyle="--", linewidth=0.8, alpha=0.5)
        ax.axvline(-fc_threshold, color="grey", linestyle="--", linewidth=0.8, alpha=0.5)

        # Label top hits
        significant = sig_up | sig_down
        if np.any(significant):
            sig_indices = np.where(significant)[0]
            # Sort by -log10(p) descending
            top_indices = sig_indices[np.argsort(-neg_log10_p[sig_indices])][:n_top_labels]
            for idx in top_indices:
                ax.annotate(
                    gene_names[idx],
                    (log2fc[idx], neg_log10_p[idx]),
                    fontsize=7, alpha=0.8,
                    xytext=(5, 5), textcoords="offset points",
                    arrowprops=dict(arrowstyle="-", color="grey", alpha=0.4),
                )

        ax.set_xlabel("log2 Fold Change")
        ax.set_ylabel("-log10(p-value)")
        ax.set_title("Volcano Plot")
        ax.legend(fontsize=9, loc="upper right")
        fig.tight_layout()

        if progress_callback:
            await progress_callback(1.0, "Complete")

        return ComputeResult(
            request_id=request.id,
            domain=ComputeDomain.GENOMICS,
            operation="volcano_plot",
            status=ComputeStatus.COMPLETED,
            results={
                "n_up": n_up,
                "n_down": n_down,
                "n_nonsignificant": n_ns,
                "fc_threshold": fc_threshold,
                "p_threshold": p_threshold,
                "top_up_genes": [
                    gene_names[i] for i in np.where(sig_up)[0][np.argsort(pvalues[sig_up])][:20]
                ] if n_up > 0 else [],
                "top_down_genes": [
                    gene_names[i] for i in np.where(sig_down)[0][np.argsort(pvalues[sig_down])][:20]
                ] if n_down > 0 else [],
            },
            figures=[_make_figure(fig, "Volcano Plot")],
        )

    # ────────────────────────────────────────────────────────────────
    # 7. Pathway Topology Analysis
    # ────────────────────────────────────────────────────────────────

    async def _pathway_topology(
        self, request: ComputeRequest, progress_callback: Callable | None,
    ) -> ComputeResult:
        params = request.parameters
        data = request.data or {}
        gene_list = data.get("gene_list", params.get("gene_list"))  # list of gene names
        fold_changes = data.get("fold_changes", params.get("fold_changes"))  # dict or list matching gene_list
        pathway_database = params.get("pathway_database", "kegg").lower()
        p_threshold = float(params.get("p_threshold", 0.05))

        if isinstance(fold_changes, list):
            fc_dict = {g: fc for g, fc in zip(gene_list, fold_changes)}
        elif isinstance(fold_changes, dict):
            fc_dict = fold_changes
        else:
            fc_dict = {g: 0.0 for g in gene_list}

        gene_set = set(gene_list)

        if progress_callback:
            await progress_callback(0.10, "Loading pathway topology")

        # Select pathway database
        if pathway_database == "reactome":
            pathways = _REACTOME_TOPOLOGY
        else:
            pathways = _KEGG_TOPOLOGY

        if progress_callback:
            await progress_callback(0.25, "Computing topology metrics")

        pathway_results = []

        for pw_id, pw_data in pathways.items():
            pw_name = pw_data["name"]
            pw_genes = pw_data["genes"]
            pw_edges = pw_data.get("edges", [])

            # Overlap between DE genes and pathway genes
            overlap = gene_set.intersection(set(pw_genes))
            if len(overlap) == 0:
                continue

            n_pw = len(pw_genes)
            n_overlap = len(overlap)

            # --- Build adjacency for topology ---
            gene_idx = {g: i for i, g in enumerate(pw_genes)}
            adj = np.zeros((n_pw, n_pw))
            for src, tgt in pw_edges:
                if src in gene_idx and tgt in gene_idx:
                    adj[gene_idx[src], gene_idx[tgt]] = 1.0
                    adj[gene_idx[tgt], gene_idx[src]] = 1.0  # undirected for centrality

            # --- Node centrality ---
            # Degree centrality
            degree = np.sum(adj, axis=1)
            max_deg = max(np.max(degree), 1.0)
            degree_centrality = degree / max_deg

            # Betweenness centrality (exact, via shortest paths)
            betweenness = np.zeros(n_pw)
            if n_pw > 2:
                # Floyd-Warshall for shortest paths
                dist_fw = np.full((n_pw, n_pw), np.inf)
                np.fill_diagonal(dist_fw, 0.0)
                # Predecessor count for path counting
                n_paths = np.zeros((n_pw, n_pw))
                np.fill_diagonal(n_paths, 1.0)

                for i in range(n_pw):
                    for j in range(n_pw):
                        if adj[i, j] > 0:
                            dist_fw[i, j] = 1.0
                            n_paths[i, j] = 1.0

                for k in range(n_pw):
                    for i in range(n_pw):
                        for j in range(n_pw):
                            new_dist = dist_fw[i, k] + dist_fw[k, j]
                            if new_dist < dist_fw[i, j]:
                                dist_fw[i, j] = new_dist
                                n_paths[i, j] = n_paths[i, k] * n_paths[k, j]
                            elif new_dist == dist_fw[i, j] and new_dist < np.inf:
                                n_paths[i, j] += n_paths[i, k] * n_paths[k, j]

                for v in range(n_pw):
                    bc = 0.0
                    for s in range(n_pw):
                        for t in range(n_pw):
                            if s != v and t != v and s != t:
                                if n_paths[s, t] > 0 and dist_fw[s, t] < np.inf:
                                    # Count paths through v
                                    if dist_fw[s, v] + dist_fw[v, t] == dist_fw[s, t]:
                                        paths_through = n_paths[s, v] * n_paths[v, t]
                                        bc += paths_through / n_paths[s, t]
                    betweenness[v] = bc

                # Normalize
                norm_factor = max((n_pw - 1) * (n_pw - 2), 1)
                betweenness /= norm_factor

            # --- Perturbation accumulation along paths ---
            # For each DE gene in pathway, compute perturbation factor = |FC| * centrality
            perturbation_factors = {}
            total_perturbation = 0.0
            for gene in overlap:
                if gene in gene_idx:
                    gi = gene_idx[gene]
                    fc = fc_dict.get(gene, 0.0)
                    centrality_weight = 0.5 * degree_centrality[gi] + 0.5 * betweenness[gi]
                    pf = abs(fc) * (1.0 + centrality_weight)
                    perturbation_factors[gene] = float(pf)
                    total_perturbation += pf

            # --- Perturbation propagation (1-step neighbors) ---
            accumulated_perturbation = total_perturbation
            for gene in overlap:
                if gene in gene_idx:
                    gi = gene_idx[gene]
                    fc = fc_dict.get(gene, 0.0)
                    # Propagate to neighbors
                    neighbors = np.where(adj[gi, :] > 0)[0]
                    for ni in neighbors:
                        neighbor_gene = pw_genes[ni]
                        neighbor_fc = fc_dict.get(neighbor_gene, 0.0)
                        # Accumulate dampened perturbation
                        accumulated_perturbation += abs(fc) * 0.5 * (1.0 + abs(neighbor_fc) * 0.1)

            # --- Impact score ---
            # Combine ORA p-value with perturbation
            # Hypergeometric test for enrichment
            # Using a simplified universe size
            N_universe = 20000
            k = n_overlap
            n = len(gene_list)
            K = n_pw
            if k > 0 and n > 0:
                pval_ora = float(sp_stats.hypergeom.sf(k - 1, N_universe, K, n))
            else:
                pval_ora = 1.0

            # Perturbation-based p-value (approximate via normal assumption)
            if n_pw > 1 and accumulated_perturbation > 0:
                # Expected perturbation under null
                mean_fc = np.mean([abs(fc_dict.get(g, 0.0)) for g in gene_list]) if gene_list else 0.0
                expected = n_overlap * mean_fc
                std_expected = max(np.std([abs(fc_dict.get(g, 0.0)) for g in gene_list]), 0.1) * np.sqrt(n_overlap)
                z_pert = (accumulated_perturbation - expected) / max(std_expected, 1e-6)
                pval_pert = float(sp_stats.norm.sf(abs(z_pert)) * 2)
            else:
                pval_pert = 1.0

            # Combined impact: Fisher method
            if pval_ora > 0 and pval_pert > 0:
                chi2_combined = -2.0 * (np.log(max(pval_ora, 1e-300)) + np.log(max(pval_pert, 1e-300)))
                impact_pvalue = float(sp_stats.chi2.sf(chi2_combined, df=4))
            else:
                impact_pvalue = min(pval_ora, pval_pert)

            pathway_results.append({
                "pathway_id": pw_id,
                "pathway_name": pw_name,
                "n_genes_in_pathway": n_pw,
                "n_overlap": n_overlap,
                "overlap_genes": sorted(overlap),
                "perturbation_factors": perturbation_factors,
                "accumulated_perturbation": float(accumulated_perturbation),
                "p_value_ora": pval_ora,
                "p_value_perturbation": pval_pert,
                "impact_p_value": impact_pvalue,
                "topology_metrics": {
                    "degree_centrality": {pw_genes[i]: float(degree_centrality[i]) for i in range(n_pw)},
                    "betweenness_centrality": {pw_genes[i]: float(betweenness[i]) for i in range(n_pw)},
                },
            })

        # Sort by impact p-value
        pathway_results.sort(key=lambda x: x["impact_p_value"])

        if progress_callback:
            await progress_callback(0.90, "Compiling results")

        # Aggregate
        pathway_scores = {r["pathway_id"]: r["impact_p_value"] for r in pathway_results}
        topology_metrics = {r["pathway_id"]: r["topology_metrics"] for r in pathway_results}
        impact_factors = {r["pathway_id"]: r["accumulated_perturbation"] for r in pathway_results}

        if progress_callback:
            await progress_callback(1.0, "Complete")

        return ComputeResult(
            request_id=request.id,
            domain=ComputeDomain.GENOMICS,
            operation="pathway_topology",
            status=ComputeStatus.COMPLETED,
            results={
                "pathway_results": pathway_results,
                "pathway_scores": pathway_scores,
                "topology_metrics": topology_metrics,
                "impact_factors": impact_factors,
                "database": pathway_database,
                "n_pathways_tested": len(pathway_results),
                "n_significant": sum(1 for r in pathway_results if r["impact_p_value"] < p_threshold),
            },
        )
