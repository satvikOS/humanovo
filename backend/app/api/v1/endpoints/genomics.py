"""
Genomics / Omics Analysis API Endpoints

Pathway analysis, GSEA, variant annotation, biomarker discovery.
"""

import logging
import math
import random
from datetime import datetime
from typing import Optional
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

logger = logging.getLogger(__name__)
router = APIRouter()

_omics_datasets: dict[str, dict] = {}

# Reference pathways
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


class GeneListRequest(BaseModel):
    genes: list[str]
    database: str = "kegg"  # kegg or reactome
    background_size: int = 20000


class GSEARequest(BaseModel):
    ranked_genes: list[dict]  # [{gene: str, score: float}]
    gene_set: str = "kegg"


class VariantRequest(BaseModel):
    variants: list[dict]  # [{gene, position, ref, alt}]


class BiomarkerRequest(BaseModel):
    expression_data: list[dict]  # [{gene, group1_values, group2_values}]
    alpha: float = 0.05


@router.post("/pathway-analysis")
async def pathway_analysis(request: GeneListRequest):
    query_genes = set(g.upper() for g in request.genes)
    pathways = KEGG_PATHWAYS if request.database == "kegg" else REACTOME_PATHWAYS

    results = []
    for pid, pdata in pathways.items():
        pathway_genes = set(pdata["genes"])
        overlap = query_genes & pathway_genes
        if not overlap:
            continue

        k = len(overlap)
        n = len(query_genes)
        K = len(pathway_genes)
        N = request.background_size

        # Hypergeometric p-value approximation
        # Use Fisher's exact test approximation
        expected = n * K / N
        if expected > 0:
            fold_enrichment = k / expected
        else:
            fold_enrichment = 0

        # Simple p-value approximation using Poisson
        p_value = 1.0
        if expected > 0:
            p_value = math.exp(-expected)
            for i in range(1, k):
                p_value += (expected ** i) * math.exp(-expected) / math.factorial(i)
            p_value = max(1 - p_value, 1e-10)

        results.append({
            "pathway_id": pid,
            "pathway_name": pdata["name"],
            "database": request.database,
            "overlap_genes": sorted(overlap),
            "overlap_count": k,
            "pathway_size": K,
            "fold_enrichment": round(fold_enrichment, 3),
            "p_value": round(p_value, 8),
            "significant": p_value < 0.05,
        })

    results.sort(key=lambda r: r["p_value"])

    return {
        "query_genes": len(query_genes),
        "database": request.database,
        "pathways_tested": len(pathways),
        "significant_pathways": sum(1 for r in results if r["significant"]),
        "results": results,
    }


@router.post("/gsea")
async def gene_set_enrichment(request: GSEARequest):
    ranked = sorted(request.ranked_genes, key=lambda g: g.get("score", 0), reverse=True)
    gene_names = [g["gene"].upper() for g in ranked]
    pathways = KEGG_PATHWAYS if request.gene_set == "kegg" else REACTOME_PATHWAYS

    results = []
    for pid, pdata in pathways.items():
        gene_set = set(pdata["genes"])
        hits = [i for i, g in enumerate(gene_names) if g in gene_set]

        if not hits:
            continue

        n = len(gene_names)
        nh = len(hits)

        # Simplified enrichment score
        running_sum = []
        es = 0.0
        current = 0.0
        p_hit = 1.0 / nh if nh > 0 else 0
        p_miss = 1.0 / (n - nh) if (n - nh) > 0 else 0

        hit_set = set(hits)
        for i in range(n):
            if i in hit_set:
                current += p_hit
            else:
                current -= p_miss
            running_sum.append(round(current, 4))
            if abs(current) > abs(es):
                es = current

        nes = es * math.sqrt(nh) if nh > 0 else 0  # Normalized enrichment score

        results.append({
            "pathway_id": pid,
            "pathway_name": pdata["name"],
            "enrichment_score": round(es, 4),
            "normalized_es": round(nes, 4),
            "hits": nh,
            "leading_edge_genes": [gene_names[i] for i in hits[:5]],
            "running_sum": running_sum[::max(1, n // 50)],  # Downsample for visualization
        })

    results.sort(key=lambda r: abs(r["normalized_es"]), reverse=True)
    return {"results": results, "total_genes": len(gene_names), "gene_sets_tested": len(pathways)}


@router.post("/variant-annotation")
async def annotate_variants(request: VariantRequest):
    annotations = []
    for v in request.variants:
        gene = v.get("gene", "Unknown")
        pos = v.get("position", 0)
        ref = v.get("ref", "")
        alt = v.get("alt", "")

        # Simulated annotation
        impact_options = ["HIGH", "MODERATE", "LOW", "MODIFIER"]
        consequence_map = {
            "HIGH": ["frameshift_variant", "stop_gained", "splice_donor_variant"],
            "MODERATE": ["missense_variant", "inframe_deletion", "inframe_insertion"],
            "LOW": ["synonymous_variant", "splice_region_variant"],
            "MODIFIER": ["intron_variant", "upstream_gene_variant", "downstream_gene_variant"],
        }

        impact = random.choice(impact_options[:3])  # Bias toward higher impact
        consequences = consequence_map[impact]

        clinical_sigs = ["Pathogenic", "Likely pathogenic", "Uncertain significance", "Likely benign", "Benign"]
        weights = [0.1, 0.15, 0.4, 0.2, 0.15]
        clinical_sig = random.choices(clinical_sigs, weights=weights, k=1)[0]

        annotations.append({
            "gene": gene, "position": pos, "ref": ref, "alt": alt,
            "change": f"{gene}:{ref}{pos}{alt}",
            "impact": impact,
            "consequence": random.choice(consequences),
            "clinical_significance": clinical_sig,
            "allele_frequency": round(random.uniform(0.0001, 0.05), 6),
            "dbSNP": f"rs{random.randint(10000, 9999999)}",
            "cosmic": f"COSM{random.randint(100, 99999)}" if impact in ("HIGH", "MODERATE") else None,
        })

    return {
        "variants_annotated": len(annotations),
        "high_impact": sum(1 for a in annotations if a["impact"] == "HIGH"),
        "pathogenic": sum(1 for a in annotations if "athogenic" in a["clinical_significance"]),
        "annotations": annotations,
    }


@router.post("/biomarker-discovery")
async def discover_biomarkers(request: BiomarkerRequest):
    results = []
    for entry in request.expression_data:
        gene = entry.get("gene", "Unknown")
        g1 = entry.get("group1_values", [])
        g2 = entry.get("group2_values", [])

        if len(g1) < 2 or len(g2) < 2:
            continue

        mean1 = sum(g1) / len(g1)
        mean2 = sum(g2) / len(g2)
        log2fc = math.log2(max(mean2, 0.001) / max(mean1, 0.001))

        # Simple t-test
        var1 = sum((x - mean1) ** 2 for x in g1) / (len(g1) - 1) if len(g1) > 1 else 0
        var2 = sum((x - mean2) ** 2 for x in g2) / (len(g2) - 1) if len(g2) > 1 else 0
        se = math.sqrt(var1 / len(g1) + var2 / len(g2)) if (var1 / len(g1) + var2 / len(g2)) > 0 else 1e-10
        t_stat = (mean1 - mean2) / se

        # Approximate p-value
        df = len(g1) + len(g2) - 2
        z = abs(t_stat) / math.sqrt(1 + t_stat * t_stat / max(df, 1))
        p_value = 2 * 0.5 * math.erfc(z / math.sqrt(2)) if z > 0 else 1.0
        neg_log_p = -math.log10(max(p_value, 1e-300))

        results.append({
            "gene": gene,
            "mean_group1": round(mean1, 4),
            "mean_group2": round(mean2, 4),
            "log2_fold_change": round(log2fc, 4),
            "p_value": round(p_value, 8),
            "neg_log10_p": round(neg_log_p, 4),
            "significant": p_value < request.alpha and abs(log2fc) > 1,
            "direction": "up" if log2fc > 0 else "down",
        })

    results.sort(key=lambda r: r["p_value"])
    significant = [r for r in results if r["significant"]]

    return {
        "total_genes": len(results),
        "significant_biomarkers": len(significant),
        "alpha": request.alpha,
        "results": results,
        "volcano_data": [{"gene": r["gene"], "x": r["log2_fold_change"], "y": r["neg_log10_p"], "significant": r["significant"]} for r in results],
    }


# ── Omics Dataset Management ────────────────────────────────────

@router.get("/datasets")
async def list_omics_datasets():
    items = sorted(_omics_datasets.values(), key=lambda d: d["created_at"], reverse=True)
    return {"items": items, "total": len(items)}


@router.post("/datasets")
async def create_omics_dataset(name: str = Query(...), omics_type: str = Query("transcriptomics"), description: str = Query("")):
    did = str(uuid4())
    ds = {
        "id": did, "name": name, "omics_type": omics_type,
        "description": description, "sample_count": 0, "gene_count": 0,
        "created_at": datetime.utcnow().isoformat(),
    }
    _omics_datasets[did] = ds
    return ds


@router.delete("/datasets/{dataset_id}")
async def delete_omics_dataset(dataset_id: str):
    if dataset_id not in _omics_datasets:
        raise HTTPException(status_code=404, detail="Dataset not found")
    del _omics_datasets[dataset_id]
    return {"status": "deleted"}
