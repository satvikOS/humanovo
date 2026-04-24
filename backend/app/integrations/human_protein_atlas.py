"""
Human Protein Atlas — tissue, cell type, subcellular, pathology.

No auth.  https://www.proteinatlas.org

The HPA public XML endpoint per gene is the cheapest way to get:
  - RNA expression across tissues + cell types
  - Protein expression IHC scores
  - Subcellular location
  - Prognostic markers in cancer
  - Single-cell type specificity

We lean on their JSON endpoint:
  https://www.proteinatlas.org/<ensembl_id>.json
which ships a compact structured payload.
"""

from __future__ import annotations

from typing import Any

from app.integrations.base import IntegrationClient


class HumanProteinAtlasClient(IntegrationClient):
    SERVICE = "human_protein_atlas"
    BASE_URL = "https://www.proteinatlas.org"
    RATE_PER_SECOND = 2.0
    MAX_CONCURRENT = 2

    async def gene(self, ensembl_gene_id: str) -> dict[str, Any] | None:
        """Return trimmed HPA data for an Ensembl gene ID (e.g. ENSG00000141510)."""
        if not ensembl_gene_id:
            return None
        data = await self.fetch_json(f"/{ensembl_gene_id}.json")
        if not data:
            return None

        def _safe(key, fallback=None):
            return data.get(key) if data else fallback

        return {
            "ensembl_gene_id": ensembl_gene_id,
            "gene_symbol": _safe("Gene"),
            "gene_description": _safe("Gene description"),
            "chromosome": _safe("Chromosome"),
            "biotype": _safe("Gene synonym"),
            # Expression
            "rna_tissue_specificity": _safe("RNA tissue specificity"),
            "rna_tissue_distribution": _safe("RNA tissue distribution"),
            "rna_single_cell_type_specificity":
                _safe("RNA single cell type specificity"),
            "rna_cancer_specificity": _safe("RNA cancer specificity"),
            # Protein
            "antibody_staining": _safe("Antibody"),
            "protein_class": _safe("Protein class"),
            "secretome_location": _safe("Secretome location"),
            "subcellular_location": _safe("Subcellular location"),
            "subcellular_main_location": _safe("Subcellular main location"),
            # Disease biomarkers
            "disease_involvement": _safe("Disease involvement"),
            "prognostic_markers": {
                "breast_cancer": _safe("Pathology prognostics - Breast cancer"),
                "lung_cancer": _safe("Pathology prognostics - Lung cancer"),
                "liver_cancer": _safe("Pathology prognostics - Liver cancer"),
                "colorectal_cancer":
                    _safe("Pathology prognostics - Colorectal cancer"),
                "renal_cancer": _safe("Pathology prognostics - Renal cancer"),
                "glioma": _safe("Pathology prognostics - Glioma"),
            },
            "uniprot": _safe("Uniprot"),
        }


_singleton: HumanProteinAtlasClient | None = None


def get_hpa_client() -> HumanProteinAtlasClient:
    global _singleton
    if _singleton is None:
        _singleton = HumanProteinAtlasClient()
    return _singleton
