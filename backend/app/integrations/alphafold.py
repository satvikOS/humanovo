"""
AlphaFold DB — protein structure predictions keyed by UniProt accession.

No auth required. Rate limit: the EBI polite pool accepts ~3 req/s per IP
for API clients that identify themselves via User-Agent (we send
humanovo/0.1 (mailto:...) via the shared base client).

What we pull:
  - /api/prediction/{uniprot}       → list of predictions with URLs to
                                       PDB + CIF + pLDDT + PAE files
  - pLDDT confidence                → integrated per-residue confidence
                                       for agents to weigh binding-pocket
                                       claims
Response fields we expose:
  - entry_id            (AF-XXXXX-F1)
  - uniprot_accession
  - uniprot_id
  - organism
  - uniprot_start / uniprot_end
  - latest_version
  - pdb_url, cif_url, bcif_url, pae_image_url, pae_doc_url
  - confidence_mean (0-100 pLDDT derived when available)
"""

from __future__ import annotations

from typing import Any

from app.integrations.base import IntegrationClient


class AlphaFoldClient(IntegrationClient):
    SERVICE = "alphafold"
    BASE_URL = "https://alphafold.ebi.ac.uk"
    RATE_PER_SECOND = 2.0
    MAX_CONCURRENT = 3

    async def predict(self, uniprot_accession: str) -> dict[str, Any] | None:
        """Return the canonical prediction metadata for a UniProt accession.

        Returns None when the accession has no AlphaFold record or the API
        is unreachable. The caller may handle this gracefully; this is a
        common case for non-model organisms or newly curated proteins.
        """
        if not uniprot_accession:
            return None
        data = await self.fetch_json(
            f"/api/prediction/{uniprot_accession}",
        )
        if not data:
            return None
        if isinstance(data, list):
            if not data:
                return None
            entry = data[0]
        else:
            entry = data

        return {
            "entry_id": entry.get("entryId"),
            "uniprot_accession": entry.get("uniprotAccession"),
            "uniprot_id": entry.get("uniprotId"),
            "gene_symbol": entry.get("gene") or entry.get("gene_symbol"),
            "organism_scientific_name":
                entry.get("organismScientificName")
                or entry.get("organism_scientific_name"),
            "uniprot_start": entry.get("uniprotStart"),
            "uniprot_end": entry.get("uniprotEnd"),
            "latest_version": entry.get("latestVersion"),
            "global_metric_value":
                entry.get("globalMetricValue")  # pLDDT mean, 0-100
                or entry.get("global_metric_value"),
            "pdb_url": entry.get("pdbUrl") or entry.get("pdb_url"),
            "cif_url": entry.get("cifUrl") or entry.get("cif_url"),
            "bcif_url": entry.get("bcifUrl") or entry.get("bcif_url"),
            "pae_image_url":
                entry.get("paeImageUrl") or entry.get("pae_image_url"),
            "pae_doc_url":
                entry.get("paeDocUrl") or entry.get("pae_doc_url"),
            "model_created_date":
                entry.get("modelCreatedDate")
                or entry.get("model_created_date"),
        }


_singleton: AlphaFoldClient | None = None


def get_alphafold_client() -> AlphaFoldClient:
    global _singleton
    if _singleton is None:
        _singleton = AlphaFoldClient()
    return _singleton
