"""
UniProt — canonical protein annotation + cross-references.

No auth. https://rest.uniprot.org — the most important protein DB in
biomedicine. We expose:

  - resolve_gene_symbol(symbol) → list[{'accession', 'id', 'name', 'organism'}]
  - entry(accession) → full entry trimmed to the fields agents actually use
  - sequence(accession) → plain sequence string
  - cross_refs(accession) → dict of xref-db to id list (PDB, Ensembl, etc.)

Everything is cached for 30 days. Sequences are cached for 90 days
(they never change once an accession is assigned).
"""

from __future__ import annotations

from typing import Any

from app.integrations.base import IntegrationClient


class UniProtClient(IntegrationClient):
    SERVICE = "uniprot"
    BASE_URL = "https://rest.uniprot.org"
    RATE_PER_SECOND = 5.0
    MAX_CONCURRENT = 5

    # ---- resolve a gene symbol to UniProt entries (homo sapiens by default)

    async def resolve_gene_symbol(
        self,
        symbol: str,
        organism_id: int = 9606,  # Human
        reviewed_only: bool = True,
        max_results: int = 5,
    ) -> list[dict[str, Any]]:
        if not symbol:
            return []
        query = f"gene_exact:{symbol} AND organism_id:{organism_id}"
        if reviewed_only:
            query += " AND reviewed:true"
        data = await self.fetch_json(
            "/uniprotkb/search",
            params={
                "query": query,
                "fields": "accession,id,protein_name,gene_primary,organism_name",
                "format": "json",
                "size": max_results,
            },
        )
        if not data:
            return []
        out: list[dict[str, Any]] = []
        for hit in (data.get("results") or [])[:max_results]:
            pnames = hit.get("proteinDescription", {}) or {}
            recname = ((pnames.get("recommendedName") or {}).get("fullName")
                       or {}).get("value")
            org = (hit.get("organism") or {}).get("scientificName")
            out.append({
                "accession": hit.get("primaryAccession"),
                "id": hit.get("uniProtkbId"),
                "name": recname,
                "organism": org,
                "gene": ((hit.get("genes") or [{}])[0].get("geneName") or {})
                    .get("value"),
            })
        return out

    # ---- canonical entry for an accession

    async def entry(self, accession: str) -> dict[str, Any] | None:
        if not accession:
            return None
        data = await self.fetch_json(
            f"/uniprotkb/{accession}",
            params={"format": "json"},
        )
        if not data:
            return None

        pnames = data.get("proteinDescription", {}) or {}
        recname = ((pnames.get("recommendedName") or {}).get("fullName")
                   or {}).get("value")
        genes = data.get("genes") or []
        gene_primary = ((genes[0].get("geneName") or {})
                        .get("value")) if genes else None
        function_comments = [
            (c.get("texts", [{}])[0] or {}).get("value")
            for c in (data.get("comments") or [])
            if c.get("commentType") == "FUNCTION"
        ]

        features = data.get("features") or []
        active_sites = [
            {
                "type": f.get("type"),
                "description": f.get("description"),
                "location": f.get("location"),
            }
            for f in features
            if f.get("type") in ("Active site", "Binding site", "Site")
        ][:20]

        return {
            "accession": data.get("primaryAccession"),
            "id": data.get("uniProtkbId"),
            "name": recname,
            "gene": gene_primary,
            "organism": (data.get("organism") or {}).get("scientificName"),
            "sequence_length": ((data.get("sequence") or {}).get("length")),
            "function_summary": function_comments[0] if function_comments else None,
            "active_sites": active_sites,
            "keywords": [k.get("name") for k in (data.get("keywords") or [])][:15],
            "pdb_ids": [
                r.get("id") for r in (data.get("uniProtKBCrossReferences") or [])
                if r.get("database") == "PDB"
            ][:10],
            "ensembl_gene_ids": [
                r.get("id") for r in (data.get("uniProtKBCrossReferences") or [])
                if r.get("database") == "Ensembl"
            ][:10],
            "reactome_pathway_ids": [
                r.get("id") for r in (data.get("uniProtKBCrossReferences") or [])
                if r.get("database") == "Reactome"
            ][:20],
        }

    # ---- sequence (rarely changes; aggressive TTL)

    async def sequence(self, accession: str) -> str | None:
        if not accession:
            return None
        data = await self.fetch_json(
            f"/uniprotkb/{accession}",
            params={"format": "json"},
            cache_ttl=60 * 60 * 24 * 90,
        )
        if not data:
            return None
        return (data.get("sequence") or {}).get("value")

    # ---- cross references (PDB, Ensembl, Reactome, KEGG, ...)

    async def cross_refs(self, accession: str) -> dict[str, list[str]]:
        if not accession:
            return {}
        data = await self.fetch_json(
            f"/uniprotkb/{accession}",
            params={"format": "json"},
        )
        if not data:
            return {}
        xrefs: dict[str, list[str]] = {}
        for r in data.get("uniProtKBCrossReferences") or []:
            db = r.get("database")
            xid = r.get("id")
            if db and xid:
                xrefs.setdefault(db, []).append(xid)
        return xrefs


_singleton: UniProtClient | None = None


def get_uniprot_client() -> UniProtClient:
    global _singleton
    if _singleton is None:
        _singleton = UniProtClient()
    return _singleton
