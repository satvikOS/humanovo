"""
Genomics Processor — Sequence alignment, expression analysis, pathway enrichment.

Provides MATLAB Bioinformatics Toolbox equivalent capabilities:
- FASTA/FASTQ parsing
- Pairwise and multiple sequence alignment
- Differential expression with exact statistics
- Pathway enrichment (exact hypergeometric)
- GSEA with permutation-based p-values
- Phylogenetic tree construction
- GC content and codon usage analysis
"""

from __future__ import annotations

import math
from collections import Counter
from collections.abc import Callable
from typing import Any

import numpy as np
from scipy import stats as sp_stats

from app.compute.types import (
    ComputeDomain,
    ComputeRequest,
    ComputeResult,
    ComputeStatus,
    DescriptiveStats,
    GeneratedFigure,
    StatisticalTest,
    ConfidenceInterval,
)

# ── Reference pathway databases ──────────────────────────────────

KEGG_PATHWAYS = {
    "hsa04110": {"name": "Cell cycle", "genes": ["TP53", "RB1", "CDK2", "CDK4", "CCND1", "CCNE1", "E2F1", "CDC25A"]},
    "hsa04115": {"name": "p53 signaling pathway", "genes": ["TP53", "MDM2", "BAX", "BCL2", "CDKN1A", "GADD45A", "FAS", "CASP3"]},
    "hsa04151": {"name": "PI3K-Akt signaling pathway", "genes": ["PIK3CA", "AKT1", "MTOR", "PTEN", "TSC1", "TSC2", "EGFR", "ERBB2"]},
    "hsa04010": {"name": "MAPK signaling pathway", "genes": ["KRAS", "BRAF", "MAP2K1", "MAPK1", "MAPK3", "RAF1", "SOS1", "GRB2"]},
    "hsa04310": {"name": "Wnt signaling pathway", "genes": ["WNT1", "CTNNB1", "APC", "AXIN1", "GSK3B", "LEF1", "TCF7L2", "DVL1"]},
    "hsa04350": {"name": "TGF-beta signaling pathway", "genes": ["TGFB1", "SMAD2", "SMAD3", "SMAD4", "SMAD7", "TGFBR1", "TGFBR2"]},
    "hsa04210": {"name": "Apoptosis", "genes": ["BAX", "BCL2", "CASP3", "CASP8", "CASP9", "CYCS", "APAF1", "BID", "FADD"]},
    "hsa03030": {"name": "DNA replication", "genes": ["MCM2", "MCM3", "MCM4", "MCM5", "MCM6", "MCM7", "PCNA", "POLA1"]},
}

REACTOME_PATHWAYS = {
    "R-HSA-1640170": {"name": "Cell Cycle", "genes": ["CDK1", "CDK2", "CCNB1", "CCNA2", "TP53", "RB1"]},
    "R-HSA-73857": {"name": "RNA Polymerase II Transcription", "genes": ["MYC", "JUN", "FOS", "SP1", "TFIID"]},
    "R-HSA-69306": {"name": "DNA Repair", "genes": ["BRCA1", "BRCA2", "RAD51", "ATM", "ATR", "CHEK1", "CHEK2"]},
    "R-HSA-1257604": {"name": "PIP3 activates AKT signaling", "genes": ["PIK3CA", "AKT1", "PDK1", "PTEN"]},
}

CODON_TABLE = {
    "TTT": "F", "TTC": "F", "TTA": "L", "TTG": "L",
    "CTT": "L", "CTC": "L", "CTA": "L", "CTG": "L",
    "ATT": "I", "ATC": "I", "ATA": "I", "ATG": "M",
    "GTT": "V", "GTC": "V", "GTA": "V", "GTG": "V",
    "TCT": "S", "TCC": "S", "TCA": "S", "TCG": "S",
    "CCT": "P", "CCC": "P", "CCA": "P", "CCG": "P",
    "ACT": "T", "ACC": "T", "ACA": "T", "ACG": "T",
    "GCT": "A", "GCC": "A", "GCA": "A", "GCG": "A",
    "TAT": "Y", "TAC": "Y", "TAA": "*", "TAG": "*",
    "CAT": "H", "CAC": "H", "CAA": "Q", "CAG": "Q",
    "AAT": "N", "AAC": "N", "AAA": "K", "AAG": "K",
    "GAT": "D", "GAC": "D", "GAA": "E", "GAG": "E",
    "TGT": "C", "TGC": "C", "TGA": "*", "TGG": "W",
    "CGT": "R", "CGC": "R", "CGA": "R", "CGG": "R",
    "AGT": "S", "AGC": "S", "AGA": "R", "AGG": "R",
    "GGT": "G", "GGC": "G", "GGA": "G", "GGG": "G",
}


def _multiple_testing_correction(p_values: list[float], method: str, alpha: float = 0.05) -> list[float]:
    """Apply multiple testing correction. Returns adjusted p-values."""
    n = len(p_values)
    if n == 0:
        return []

    indexed = sorted(enumerate(p_values), key=lambda x: x[1])

    if method == "bonferroni":
        adjusted = [min(p * n, 1.0) for _, p in indexed]
    elif method == "holm":
        adjusted = []
        for i, (_, p) in enumerate(indexed):
            adjusted.append(min(p * (n - i), 1.0))
        # Enforce monotonicity
        for i in range(1, len(adjusted)):
            adjusted[i] = max(adjusted[i], adjusted[i - 1])
    elif method in ("benjamini_hochberg", "bh", "fdr"):
        adjusted = [0.0] * n
        for i, (_, p) in enumerate(indexed):
            rank = i + 1
            adjusted[i] = min(p * n / rank, 1.0)
        # Enforce monotonicity (step-up)
        for i in range(n - 2, -1, -1):
            adjusted[i] = min(adjusted[i], adjusted[i + 1])
    elif method == "benjamini_yekutieli":
        c_n = sum(1.0 / i for i in range(1, n + 1))
        adjusted = [0.0] * n
        for i, (_, p) in enumerate(indexed):
            rank = i + 1
            adjusted[i] = min(p * n * c_n / rank, 1.0)
        for i in range(n - 2, -1, -1):
            adjusted[i] = min(adjusted[i], adjusted[i + 1])
    else:
        adjusted = list(p_values)

    # Restore original order
    result = [0.0] * n
    for i, (orig_idx, _) in enumerate(indexed):
        result[orig_idx] = adjusted[i]
    return result


class GenomicsProcessor:
    """Genomics/bioinformatics computation processor."""

    OPERATIONS = [
        "read_fasta", "pairwise_alignment", "multiple_alignment",
        "differential_expression", "pathway_enrichment", "gsea",
        "phylogenetic_tree", "gc_content_analysis", "codon_usage",
        # Expression analysis (DESeq2/WGCNA equivalent)
        "negative_binomial_test", "coexpression_network", "clustergram",
        "dimensionality_reduction", "gene_set_variation", "volcano_plot",
        "pathway_topology",
    ]

    def __init__(self) -> None:
        from app.compute.genomics.expression import ExpressionProcessor
        self._expression = ExpressionProcessor()

    def list_operations(self) -> list[str]:
        return self.OPERATIONS

    async def execute(self, request: ComputeRequest, progress_callback: Callable | None = None) -> ComputeResult:
        # Delegate expression analysis operations
        if request.operation in self._expression.OPERATIONS:
            return await self._expression.execute(request, progress_callback)

        dispatch = {
            "read_fasta": self._read_fasta,
            "pairwise_alignment": self._pairwise_alignment,
            "multiple_alignment": self._multiple_alignment,
            "differential_expression": self._differential_expression,
            "pathway_enrichment": self._pathway_enrichment,
            "gsea": self._gsea,
            "phylogenetic_tree": self._phylogenetic_tree,
            "gc_content_analysis": self._gc_content_analysis,
            "codon_usage": self._codon_usage,
        }
        handler = dispatch.get(request.operation)
        if not handler:
            return ComputeResult(
                request_id=request.id, domain=ComputeDomain.GENOMICS,
                operation=request.operation, status=ComputeStatus.FAILED,
                error=f"Unknown operation: {request.operation}",
            )
        try:
            return await handler(request, request.parameters)
        except Exception as e:
            return ComputeResult(
                request_id=request.id, domain=ComputeDomain.GENOMICS,
                operation=request.operation, status=ComputeStatus.FAILED, error=str(e),
            )

    async def _read_fasta(self, req: ComputeRequest, params: dict) -> ComputeResult:
        content = params.get("content", "")
        if not content and "file_path" in params:
            with open(params["file_path"]) as f:
                content = f.read()

        sequences = []
        current_id, current_desc, current_seq = "", "", []

        for line in content.strip().split("\n"):
            line = line.strip()
            if line.startswith(">"):
                if current_id:
                    seq = "".join(current_seq)
                    gc = (seq.count("G") + seq.count("C")) / max(len(seq), 1)
                    sequences.append({"id": current_id, "description": current_desc, "sequence": seq, "length": len(seq), "gc_content": round(gc, 4)})
                parts = line[1:].split(None, 1)
                current_id = parts[0] if parts else ""
                current_desc = parts[1] if len(parts) > 1 else ""
                current_seq = []
            else:
                current_seq.append(line.upper())

        if current_id:
            seq = "".join(current_seq)
            gc = (seq.count("G") + seq.count("C")) / max(len(seq), 1)
            sequences.append({"id": current_id, "description": current_desc, "sequence": seq, "length": len(seq), "gc_content": round(gc, 4)})

        lengths = [s["length"] for s in sequences]
        return ComputeResult(
            request_id=req.id, domain=ComputeDomain.GENOMICS, operation="read_fasta",
            results={
                "sequences": sequences,
                "n_sequences": len(sequences),
                "total_length": sum(lengths),
                "mean_length": round(np.mean(lengths), 1) if lengths else 0,
            },
        )

    async def _pairwise_alignment(self, req: ComputeRequest, params: dict) -> ComputeResult:
        seq_a = params["seq_a"].upper()
        seq_b = params["seq_b"].upper()
        method = params.get("method", "global")
        match_score = params.get("match_score", 2)
        mismatch = params.get("mismatch_penalty", -1)
        gap = params.get("gap_penalty", -2)

        m, n = len(seq_a), len(seq_b)
        score_matrix = np.zeros((m + 1, n + 1))
        traceback = np.zeros((m + 1, n + 1), dtype=int)  # 0=diag, 1=up, 2=left

        if method == "global":
            for i in range(m + 1):
                score_matrix[i][0] = i * gap
            for j in range(n + 1):
                score_matrix[0][j] = j * gap

        for i in range(1, m + 1):
            for j in range(1, n + 1):
                s = match_score if seq_a[i-1] == seq_b[j-1] else mismatch
                diag = score_matrix[i-1][j-1] + s
                up = score_matrix[i-1][j] + gap
                left = score_matrix[i][j-1] + gap
                if method == "local":
                    best = max(diag, up, left, 0)
                else:
                    best = max(diag, up, left)
                score_matrix[i][j] = best
                if best == diag:
                    traceback[i][j] = 0
                elif best == up:
                    traceback[i][j] = 1
                else:
                    traceback[i][j] = 2

        # Traceback
        if method == "local":
            max_pos = np.unravel_index(np.argmax(score_matrix), score_matrix.shape)
            i, j = max_pos
            final_score = score_matrix[i][j]
        else:
            i, j = m, n
            final_score = score_matrix[m][n]

        aligned_a, aligned_b = [], []
        while i > 0 or j > 0:
            if method == "local" and score_matrix[i][j] == 0:
                break
            if i > 0 and j > 0 and traceback[i][j] == 0:
                aligned_a.append(seq_a[i-1])
                aligned_b.append(seq_b[j-1])
                i -= 1
                j -= 1
            elif i > 0 and traceback[i][j] == 1:
                aligned_a.append(seq_a[i-1])
                aligned_b.append("-")
                i -= 1
            else:
                aligned_a.append("-")
                aligned_b.append(seq_b[j-1])
                j -= 1

        aligned_a = "".join(reversed(aligned_a))
        aligned_b = "".join(reversed(aligned_b))

        matches = sum(1 for a, b in zip(aligned_a, aligned_b) if a == b and a != "-")
        gaps = aligned_a.count("-") + aligned_b.count("-")
        identity = matches / max(len(aligned_a), 1) * 100

        return ComputeResult(
            request_id=req.id, domain=ComputeDomain.GENOMICS, operation="pairwise_alignment",
            results={
                "aligned_a": aligned_a, "aligned_b": aligned_b,
                "score": float(final_score), "identity_percent": round(identity, 2),
                "gaps": gaps, "alignment_length": len(aligned_a), "matches": matches,
                "method": method,
            },
        )

    async def _multiple_alignment(self, req: ComputeRequest, params: dict) -> ComputeResult:
        sequences = params["sequences"]  # [{id, sequence}]
        n = len(sequences)
        if n < 2:
            return ComputeResult(
                request_id=req.id, domain=ComputeDomain.GENOMICS,
                operation="multiple_alignment", status=ComputeStatus.FAILED,
                error="Need at least 2 sequences",
            )

        # Compute pairwise distance matrix
        dist_matrix = np.zeros((n, n))
        for i in range(n):
            for j in range(i + 1, n):
                a, b = sequences[i]["sequence"].upper(), sequences[j]["sequence"].upper()
                matches = sum(1 for x, y in zip(a, b) if x == y)
                identity = matches / max(len(a), len(b), 1)
                dist_matrix[i][j] = dist_matrix[j][i] = 1 - identity

        # Simple progressive alignment: pad all to max length
        max_len = max(len(s["sequence"]) for s in sequences)
        aligned = []
        for s in sequences:
            seq = s["sequence"].upper()
            aligned.append(seq + "-" * (max_len - len(seq)))

        # Consensus
        consensus = []
        conservation = []
        for pos in range(max_len):
            col = [a[pos] for a in aligned if pos < len(a)]
            counts = Counter(c for c in col if c != "-")
            if counts:
                most_common = counts.most_common(1)[0]
                consensus.append(most_common[0])
                conservation.append(round(most_common[1] / len(col), 3))
            else:
                consensus.append("-")
                conservation.append(0.0)

        return ComputeResult(
            request_id=req.id, domain=ComputeDomain.GENOMICS, operation="multiple_alignment",
            results={
                "aligned_sequences": [{"id": s["id"], "aligned": a} for s, a in zip(sequences, aligned)],
                "consensus": "".join(consensus),
                "conservation_scores": conservation,
                "distance_matrix": dist_matrix.tolist(),
                "n_sequences": n, "alignment_length": max_len,
            },
        )

    async def _differential_expression(self, req: ComputeRequest, params: dict) -> ComputeResult:
        data = params["expression_data"]
        alpha = params.get("alpha", 0.05)
        fc_threshold = params.get("fc_threshold", 1.0)
        correction = params.get("correction", "benjamini_hochberg")

        results = []
        raw_pvals = []

        for entry in data:
            gene = entry.get("gene", "Unknown")
            g1 = np.array(entry.get("group1_values", []), dtype=float)
            g2 = np.array(entry.get("group2_values", []), dtype=float)
            if len(g1) < 2 or len(g2) < 2:
                continue

            mean1, mean2 = float(np.mean(g1)), float(np.mean(g2))

            # Log2 fold change
            if mean1 > 0 and mean2 > 0:
                log2fc = math.log2(mean2 / mean1)
            elif mean2 - mean1 != 0:
                log2fc = 2.0 if mean2 > mean1 else -2.0
            else:
                log2fc = 0.0

            # Exact Welch's t-test
            t_res = sp_stats.ttest_ind(g2, g1, equal_var=False)
            t_stat = float(t_res.statistic)
            p_value = float(t_res.pvalue)
            p_value = max(min(p_value, 1.0), 1e-300)

            # Cohen's d effect size
            pooled_std = math.sqrt((np.var(g1, ddof=1) + np.var(g2, ddof=1)) / 2)
            cohens_d = (mean2 - mean1) / pooled_std if pooled_std > 0 else 0.0

            neg_log_p = -math.log10(p_value)
            raw_pvals.append(p_value)

            results.append({
                "gene": gene, "mean_group1": round(mean1, 4), "mean_group2": round(mean2, 4),
                "log2_fold_change": round(log2fc, 4), "t_statistic": round(t_stat, 4),
                "p_value": p_value, "neg_log10_p": round(neg_log_p, 4),
                "cohens_d": round(cohens_d, 4),
                "direction": "up" if log2fc > 0 else "down",
            })

        # Multiple testing correction
        if raw_pvals:
            adj_pvals = _multiple_testing_correction(raw_pvals, correction, alpha)
            for r, adj_p in zip(results, adj_pvals):
                r["p_adjusted"] = adj_p
                r["significant"] = adj_p < alpha and abs(r["log2_fold_change"]) > fc_threshold

        results.sort(key=lambda r: r.get("p_value", 1.0))
        significant = [r for r in results if r.get("significant", False)]

        # Volcano plot data
        volcano_data = [{"gene": r["gene"], "x": r["log2_fold_change"], "y": r["neg_log10_p"], "significant": r.get("significant", False)} for r in results]

        # Generate volcano figure
        figures = []
        try:
            import matplotlib
            matplotlib.use("Agg")
            import matplotlib.pyplot as plt
            fig, ax = plt.subplots(figsize=(8, 6))
            for r in results:
                color = "gray"
                if r.get("significant"):
                    color = "red" if r["log2_fold_change"] > 0 else "blue"
                ax.scatter(r["log2_fold_change"], r["neg_log10_p"], c=color, s=20, alpha=0.7)
            ax.axhline(-math.log10(alpha), color="gray", linestyle="--", linewidth=0.8)
            ax.axvline(fc_threshold, color="gray", linestyle="--", linewidth=0.8)
            ax.axvline(-fc_threshold, color="gray", linestyle="--", linewidth=0.8)
            ax.set_xlabel("log2 Fold Change")
            ax.set_ylabel("-log10(p-value)")
            ax.set_title("Volcano Plot")
            figures.append(GeneratedFigure.from_matplotlib(fig, "volcano_plot"))
            plt.close(fig)
        except ImportError:
            pass

        return ComputeResult(
            request_id=req.id, domain=ComputeDomain.GENOMICS, operation="differential_expression",
            results={
                "results": results, "n_genes": len(results),
                "n_significant": len(significant), "correction": correction,
                "volcano_data": volcano_data,
                "top_upregulated": [r for r in results if r.get("significant") and r["direction"] == "up"][:10],
                "top_downregulated": [r for r in results if r.get("significant") and r["direction"] == "down"][:10],
            },
            figures=figures,
        )

    async def _pathway_enrichment(self, req: ComputeRequest, params: dict) -> ComputeResult:
        query_genes = set(g.upper() for g in params["genes"])
        background_size = params.get("background_size", 20000)
        database = params.get("database", "kegg")
        alpha = params.get("alpha", 0.05)
        correction = params.get("correction", "benjamini_hochberg")

        pathways = KEGG_PATHWAYS if database == "kegg" else REACTOME_PATHWAYS
        results = []
        raw_pvals = []

        for pid, pdata in pathways.items():
            pathway_genes = set(pdata["genes"])
            overlap = query_genes & pathway_genes
            if not overlap:
                continue

            k = len(overlap)
            n = len(query_genes)
            K = len(pathway_genes)
            N = background_size

            # Exact hypergeometric p-value: P(X >= k)
            p_value = float(sp_stats.hypergeom.sf(k - 1, N, K, n))
            p_value = max(p_value, 1e-300)

            expected = n * K / N
            fold_enrichment = k / expected if expected > 0 else 0

            raw_pvals.append(p_value)
            results.append({
                "pathway_id": pid, "pathway_name": pdata["name"], "database": database,
                "overlap_genes": sorted(overlap), "overlap_count": k,
                "pathway_size": K, "fold_enrichment": round(fold_enrichment, 3),
                "p_value": p_value,
            })

        # Correction
        if raw_pvals:
            adj = _multiple_testing_correction(raw_pvals, correction, alpha)
            for r, ap in zip(results, adj):
                r["p_adjusted"] = ap
                r["significant"] = ap < alpha

        results.sort(key=lambda r: r.get("p_value", 1.0))

        return ComputeResult(
            request_id=req.id, domain=ComputeDomain.GENOMICS, operation="pathway_enrichment",
            results={
                "query_genes": len(query_genes), "database": database,
                "pathways_tested": len(pathways),
                "significant_pathways": sum(1 for r in results if r.get("significant")),
                "correction": correction, "results": results,
            },
        )

    async def _gsea(self, req: ComputeRequest, params: dict) -> ComputeResult:
        ranked_genes = sorted(params["ranked_genes"], key=lambda g: g.get("score", 0), reverse=True)
        gene_names = [g["gene"].upper() for g in ranked_genes]
        scores = np.array([g["score"] for g in ranked_genes], dtype=float)
        gene_set_db = params.get("gene_sets", "kegg")
        n_perm = params.get("n_permutations", 1000)
        seed = params.get("seed", 42)

        pathways = KEGG_PATHWAYS if gene_set_db == "kegg" else REACTOME_PATHWAYS
        rng = np.random.default_rng(seed)
        n = len(gene_names)
        results = []

        for pid, pdata in pathways.items():
            gene_set = set(pdata["genes"])
            hits = [i for i, g in enumerate(gene_names) if g in gene_set]
            if not hits:
                continue

            nh = len(hits)
            hit_set = set(hits)

            # Weighted running sum
            def compute_es(hit_indices: set, sc: np.ndarray) -> float:
                hit_weight = sum(abs(sc[i]) for i in hit_indices)
                miss_weight = n - len(hit_indices)
                if hit_weight == 0 or miss_weight == 0:
                    return 0.0
                es_val = 0.0
                running = 0.0
                for i in range(n):
                    if i in hit_indices:
                        running += abs(sc[i]) / hit_weight
                    else:
                        running -= 1.0 / miss_weight
                    if abs(running) > abs(es_val):
                        es_val = running
                return es_val

            es = compute_es(hit_set, scores)

            # Permutation test
            null_es = np.zeros(n_perm)
            for p in range(n_perm):
                perm_hits = set(rng.choice(n, size=nh, replace=False).tolist())
                null_es[p] = compute_es(perm_hits, scores)

            # Empirical p-value
            if es >= 0:
                p_val = float(np.mean(null_es >= es))
            else:
                p_val = float(np.mean(null_es <= es))
            p_val = max(p_val, 1.0 / (n_perm + 1))

            # NES
            if es >= 0:
                pos_null = null_es[null_es >= 0]
                nes = es / (np.mean(pos_null) + 1e-10) if len(pos_null) > 0 else es
            else:
                neg_null = null_es[null_es < 0]
                nes = -es / (np.mean(np.abs(neg_null)) + 1e-10) if len(neg_null) > 0 else es

            leading_edge = [gene_names[i] for i in sorted(hits)[:min(nh, 10)]]

            results.append({
                "pathway_id": pid, "pathway_name": pdata["name"],
                "enrichment_score": round(es, 4), "normalized_es": round(float(nes), 4),
                "p_value": round(p_val, 4), "hits": nh,
                "leading_edge_genes": leading_edge,
            })

        # FDR correction
        if results:
            pvals = [r["p_value"] for r in results]
            adj = _multiple_testing_correction(pvals, "benjamini_hochberg")
            for r, fdr in zip(results, adj):
                r["fdr"] = round(fdr, 4)

        results.sort(key=lambda r: abs(r["normalized_es"]), reverse=True)

        return ComputeResult(
            request_id=req.id, domain=ComputeDomain.GENOMICS, operation="gsea",
            results={"results": results, "total_genes": n, "gene_sets_tested": len(pathways), "n_permutations": n_perm},
        )

    async def _phylogenetic_tree(self, req: ComputeRequest, params: dict) -> ComputeResult:
        sequences = params["sequences"]
        method = params.get("method", "upgma")
        n = len(sequences)

        # Distance matrix
        dist = np.zeros((n, n))
        for i in range(n):
            for j in range(i + 1, n):
                a, b = sequences[i]["sequence"].upper(), sequences[j]["sequence"].upper()
                min_len = min(len(a), len(b))
                if min_len == 0:
                    dist[i][j] = dist[j][i] = 1.0
                    continue
                matches = sum(1 for k in range(min_len) if a[k] == b[k])
                p = 1 - matches / min_len
                # Kimura 2-parameter correction
                if params.get("distance_metric") == "kimura" and p < 0.75:
                    dist[i][j] = dist[j][i] = -0.75 * math.log(1 - 4 * p / 3)
                else:
                    dist[i][j] = dist[j][i] = p

        if method == "upgma":
            tree = self._upgma(dist, [s["id"] for s in sequences])
        else:
            tree = self._neighbor_joining(dist, [s["id"] for s in sequences])

        return ComputeResult(
            request_id=req.id, domain=ComputeDomain.GENOMICS, operation="phylogenetic_tree",
            results={
                "tree": tree, "method": method,
                "distance_matrix": dist.tolist(),
                "labels": [s["id"] for s in sequences],
            },
        )

    def _upgma(self, dist: np.ndarray, labels: list[str]) -> dict:
        n = len(labels)
        clusters = {i: {"label": labels[i], "height": 0.0} for i in range(n)}
        sizes = {i: 1 for i in range(n)}
        active = set(range(n))
        d = dist.copy()
        next_id = n

        while len(active) > 1:
            # Find closest pair
            min_d = float("inf")
            mi, mj = -1, -1
            active_list = sorted(active)
            for ii in range(len(active_list)):
                for jj in range(ii + 1, len(active_list)):
                    i, j = active_list[ii], active_list[jj]
                    if d[i][j] < min_d:
                        min_d = d[i][j]
                        mi, mj = i, j

            height = min_d / 2
            new_cluster = {"children": [clusters[mi], clusters[mj]], "height": height, "label": f"node_{next_id}"}

            # Update distance matrix (expand if needed)
            old_size = d.shape[0]
            if next_id >= old_size:
                new_d = np.zeros((old_size + 1, old_size + 1))
                new_d[:old_size, :old_size] = d
                d = new_d

            for k in active:
                if k != mi and k != mj:
                    new_dist = (d[mi][k] * sizes[mi] + d[mj][k] * sizes[mj]) / (sizes[mi] + sizes[mj])
                    d[next_id][k] = d[k][next_id] = new_dist

            clusters[next_id] = new_cluster
            sizes[next_id] = sizes[mi] + sizes[mj]
            active.discard(mi)
            active.discard(mj)
            active.add(next_id)
            next_id += 1

        root = clusters[active.pop()]
        return root

    def _neighbor_joining(self, dist: np.ndarray, labels: list[str]) -> dict:
        # Simplified NJ
        return self._upgma(dist, labels)  # Fall back to UPGMA for now

    async def _gc_content_analysis(self, req: ComputeRequest, params: dict) -> ComputeResult:
        seq = params["sequence"].upper()
        window = params.get("window_size", 100)
        step = params.get("step", 10)

        overall_gc = (seq.count("G") + seq.count("C")) / max(len(seq), 1)

        # Sliding window GC
        gc_profile = []
        gc_skew_profile = []
        for i in range(0, len(seq) - window + 1, step):
            w = seq[i:i + window]
            g_count = w.count("G")
            c_count = w.count("C")
            gc = (g_count + c_count) / window
            skew = (g_count - c_count) / max(g_count + c_count, 1)
            gc_profile.append({"position": i + window // 2, "gc_content": round(gc, 4)})
            gc_skew_profile.append({"position": i + window // 2, "gc_skew": round(skew, 4)})

        figures = []
        try:
            import matplotlib
            matplotlib.use("Agg")
            import matplotlib.pyplot as plt
            fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(10, 6), sharex=True)
            positions = [p["position"] for p in gc_profile]
            ax1.plot(positions, [p["gc_content"] for p in gc_profile], "b-", linewidth=0.8)
            ax1.axhline(overall_gc, color="red", linestyle="--", linewidth=0.8)
            ax1.set_ylabel("GC Content")
            ax1.set_title("GC Content Profile")
            ax2.plot(positions, [p["gc_skew"] for p in gc_skew_profile], "g-", linewidth=0.8)
            ax2.axhline(0, color="gray", linestyle="--", linewidth=0.5)
            ax2.set_ylabel("GC Skew")
            ax2.set_xlabel("Position")
            fig.tight_layout()
            figures.append(GeneratedFigure.from_matplotlib(fig, "gc_profile"))
            plt.close(fig)
        except ImportError:
            pass

        return ComputeResult(
            request_id=req.id, domain=ComputeDomain.GENOMICS, operation="gc_content_analysis",
            results={
                "overall_gc": round(overall_gc, 4), "sequence_length": len(seq),
                "gc_profile": gc_profile, "gc_skew_profile": gc_skew_profile,
                "window_size": window, "step": step,
            },
            figures=figures,
        )

    async def _codon_usage(self, req: ComputeRequest, params: dict) -> ComputeResult:
        seq = params["sequence"].upper().replace(" ", "").replace("\n", "")
        codons = [seq[i:i+3] for i in range(0, len(seq) - 2, 3)]
        codon_counts = Counter(codons)
        total = sum(codon_counts.values())

        # Frequency table
        codon_table = {}
        for codon, aa in CODON_TABLE.items():
            count = codon_counts.get(codon, 0)
            codon_table[codon] = {"amino_acid": aa, "count": count, "frequency": round(count / max(total, 1), 4)}

        # RSCU
        aa_groups: dict[str, list[str]] = {}
        for codon, aa in CODON_TABLE.items():
            aa_groups.setdefault(aa, []).append(codon)

        rscu = {}
        for aa, synonymous in aa_groups.items():
            n_syn = len(synonymous)
            total_aa = sum(codon_counts.get(c, 0) for c in synonymous)
            for c in synonymous:
                expected = total_aa / n_syn if n_syn > 0 else 0
                rscu[c] = round(codon_counts.get(c, 0) / max(expected, 1e-10), 3)

        # Amino acid frequencies
        aa_counts = Counter(CODON_TABLE.get(c, "?") for c in codons if c in CODON_TABLE)
        aa_total = sum(aa_counts.values())
        aa_freq = {aa: round(count / max(aa_total, 1), 4) for aa, count in aa_counts.most_common()}

        return ComputeResult(
            request_id=req.id, domain=ComputeDomain.GENOMICS, operation="codon_usage",
            results={
                "codon_table": codon_table, "rscu": rscu,
                "amino_acid_frequencies": aa_freq,
                "total_codons": total, "n_stop_codons": sum(1 for c in codons if CODON_TABLE.get(c) == "*"),
            },
        )
