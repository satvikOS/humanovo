"""
Ensembl REST — gene / variant / VEP.

No auth. https://rest.ensembl.org

Methods:
  - lookup_gene_symbol(symbol) → gene metadata + coordinates
  - lookup_id(ensembl_id) → metadata for any Ensembl ID
  - vep_hgvs(hgvs) → variant effect predictor for an HGVS notation
                     (e.g. 'BRCA2:c.9976A>T', 'ENST00000380152.7:c.7988A>T')
  - vep_region(region, allele) → VEP for chromosomal region
  - xrefs_by_symbol(symbol) → external DB cross references (HGNC, NCBI, etc.)

Rate limit: Ensembl enforces 15 req/s hard. We set 8 to be polite and
rely on the shared IntegrationClient token-bucket.
"""

from __future__ import annotations

from typing import Any

from app.integrations.base import IntegrationClient


class EnsemblClient(IntegrationClient):
    SERVICE = "ensembl"
    BASE_URL = "https://rest.ensembl.org"
    RATE_PER_SECOND = 8.0
    MAX_CONCURRENT = 4

    async def lookup_gene_symbol(
        self,
        symbol: str,
        species: str = "homo_sapiens",
    ) -> dict[str, Any] | None:
        if not symbol:
            return None
        data = await self.fetch_json(
            f"/lookup/symbol/{species}/{symbol}",
            params={"expand": 0},
        )
        if not data:
            return None
        return {
            "id": data.get("id"),
            "assembly_name": data.get("assembly_name"),
            "biotype": data.get("biotype"),
            "description": data.get("description"),
            "display_name": data.get("display_name"),
            "strand": data.get("strand"),
            "seq_region_name": data.get("seq_region_name"),
            "start": data.get("start"),
            "end": data.get("end"),
            "source": data.get("source"),
            "version": data.get("version"),
        }

    async def lookup_id(self, ensembl_id: str) -> dict[str, Any] | None:
        if not ensembl_id:
            return None
        data = await self.fetch_json(
            f"/lookup/id/{ensembl_id}",
            params={"expand": 0},
        )
        if not data:
            return None
        return data

    async def vep_hgvs(
        self,
        hgvs: str,
        species: str = "human",
    ) -> list[dict[str, Any]]:
        """Variant effect prediction for an HGVS notation.

        Returns a list of per-allele consequences, each with:
          - most_severe_consequence
          - transcript_consequences (list, trimmed)
          - colocated_variants (list, trimmed)
          - regulatory_feature_consequences
          - sift / polyphen scores when available
        """
        if not hgvs:
            return []
        data = await self.fetch_json(
            f"/vep/{species}/hgvs/{hgvs}",
            params={"SpliceAI": 1, "CADD": 1},
            cache_ttl=60 * 60 * 24 * 14,
        )
        if not data:
            return []
        out = []
        for entry in data if isinstance(data, list) else [data]:
            out.append({
                "input": entry.get("input"),
                "most_severe_consequence": entry.get("most_severe_consequence"),
                "allele_string": entry.get("allele_string"),
                "assembly_name": entry.get("assembly_name"),
                "seq_region_name": entry.get("seq_region_name"),
                "start": entry.get("start"),
                "end": entry.get("end"),
                "strand": entry.get("strand"),
                "transcript_consequences":
                    self._tc((entry.get("transcript_consequences") or [])[:10]),
                "colocated_variants":
                    [
                        {
                            "id": cv.get("id"),
                            "frequencies": cv.get("frequencies"),
                            "phenotype_or_disease":
                                cv.get("phenotype_or_disease"),
                        }
                        for cv in (entry.get("colocated_variants") or [])[:10]
                    ],
                "regulatory_feature_consequences":
                    entry.get("regulatory_feature_consequences") or [],
            })
        return out

    @staticmethod
    def _tc(tcs: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return [
            {
                "gene_symbol": tc.get("gene_symbol"),
                "gene_id": tc.get("gene_id"),
                "transcript_id": tc.get("transcript_id"),
                "consequence_terms": tc.get("consequence_terms"),
                "impact": tc.get("impact"),
                "biotype": tc.get("biotype"),
                "amino_acids": tc.get("amino_acids"),
                "protein_start": tc.get("protein_start"),
                "sift_prediction": tc.get("sift_prediction"),
                "sift_score": tc.get("sift_score"),
                "polyphen_prediction": tc.get("polyphen_prediction"),
                "polyphen_score": tc.get("polyphen_score"),
                "cadd_phred": tc.get("cadd_phred"),
                "cadd_raw": tc.get("cadd_raw"),
                "spliceai_pred_ds_ag": tc.get("spliceai_pred_ds_ag"),
                "spliceai_pred_ds_al": tc.get("spliceai_pred_ds_al"),
                "spliceai_pred_ds_dg": tc.get("spliceai_pred_ds_dg"),
                "spliceai_pred_ds_dl": tc.get("spliceai_pred_ds_dl"),
            }
            for tc in tcs
        ]

    async def xrefs_by_symbol(
        self,
        symbol: str,
        species: str = "homo_sapiens",
    ) -> list[dict[str, Any]]:
        if not symbol:
            return []
        data = await self.fetch_json(
            f"/xrefs/symbol/{species}/{symbol}",
        )
        if not data or not isinstance(data, list):
            return []
        return data[:30]


_singleton: EnsemblClient | None = None


def get_ensembl_client() -> EnsemblClient:
    global _singleton
    if _singleton is None:
        _singleton = EnsemblClient()
    return _singleton
