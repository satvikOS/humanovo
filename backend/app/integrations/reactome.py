"""
Reactome — pathway database + enrichment analysis.

No auth. https://reactome.org/ContentService

Methods we expose:
  - resolve_pathway(query) → list of pathway stIds + names
  - pathway(stId) → full pathway info: participants, components,
                    figures, diseases, disease stIds
  - pathways_for_protein(uniprot_accession) → pathway stIds containing
                                              that protein
  - enrichment(pathway_terms) → flat enrichment via the AnalysisService
                                https://reactome.org/AnalysisService
"""

from __future__ import annotations

from typing import Any

from app.integrations.base import IntegrationClient


class ReactomeClient(IntegrationClient):
    SERVICE = "reactome"
    BASE_URL = "https://reactome.org"
    RATE_PER_SECOND = 4.0
    MAX_CONCURRENT = 4

    # ---- resolve ---------------------------------------------------------

    async def resolve_pathway(
        self, query: str, species: str = "Homo sapiens",
    ) -> list[dict[str, Any]]:
        if not query:
            return []
        data = await self.fetch_json(
            "/ContentService/search/query",
            params={
                "query": query,
                "species": species,
                "types": "Pathway",
                "cluster": "false",
                "compact": "true",
            },
        )
        if not data:
            return []
        results: list[dict[str, Any]] = []
        for grp in data.get("results") or []:
            for entry in grp.get("entries") or []:
                results.append({
                    "stId": entry.get("stId"),
                    "name": entry.get("name"),
                    "species": entry.get("species"),
                    "type": entry.get("typeName"),
                })
        return results[:20]

    # ---- single pathway --------------------------------------------------

    async def pathway(self, stid: str) -> dict[str, Any] | None:
        if not stid:
            return None
        data = await self.fetch_json(f"/ContentService/data/pathway/{stid}/containedEvents")
        detail = await self.fetch_json(f"/ContentService/data/query/{stid}")
        if not detail:
            return None
        return {
            "stId": detail.get("stId"),
            "name": detail.get("displayName"),
            "species": ((detail.get("species") or [{}])[0]).get("displayName"),
            "has_diagram": detail.get("hasDiagram"),
            "diseases": [
                {"name": d.get("displayName"),
                 "doid": d.get("databaseName") + ":" + (d.get("identifier") or "")}
                for d in (detail.get("disease") or [])
            ],
            "contained_events":
                [e.get("stId") for e in (data or [])][:60],
        }

    # ---- protein → pathways ---------------------------------------------

    async def pathways_for_protein(
        self, uniprot_accession: str, species: str = "Homo sapiens",
    ) -> list[dict[str, Any]]:
        if not uniprot_accession:
            return []
        data = await self.fetch_json(
            f"/ContentService/data/mapping/UniProt/{uniprot_accession}/pathways",
            params={"species": species},
        )
        if not data or not isinstance(data, list):
            return []
        return [
            {
                "stId": p.get("stId"),
                "name": p.get("displayName"),
                "species": ((p.get("species") or [{}])[0]).get("displayName"),
            }
            for p in data
        ][:30]

    # ---- quick enrichment (gene symbols → enriched pathways) ------------

    async def enrichment(
        self,
        gene_symbols: list[str],
        species: str = "Homo sapiens",
    ) -> list[dict[str, Any]]:
        """Over-representation analysis on a gene set."""
        if not gene_symbols:
            return []
        # AnalysisService uses a separate base URL for this POST
        payload = "\n".join(gene_symbols)
        data = await self.fetch_json(
            "/AnalysisService/identifiers/projection",
            method="POST",
            params={"interactors": "false", "pageSize": 20, "page": 1,
                    "sortBy": "ENTITIES_PVALUE", "order": "ASC",
                    "resource": "TOTAL",
                    "species": species},
            json_body=payload,
            cache_ttl=60 * 60 * 24 * 7,
        )
        if not data:
            return []
        out = []
        for p in (data.get("pathways") or [])[:20]:
            stats = (p.get("entities") or {})
            out.append({
                "stId": p.get("stId"),
                "name": p.get("name"),
                "pValue": stats.get("pValue"),
                "fdr": stats.get("fdr"),
                "found": stats.get("found"),
                "total": stats.get("total"),
                "ratio": stats.get("ratio"),
            })
        return out


_singleton: ReactomeClient | None = None


def get_reactome_client() -> ReactomeClient:
    global _singleton
    if _singleton is None:
        _singleton = ReactomeClient()
    return _singleton
