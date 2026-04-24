"""
Europe PMC — full-text search + abstract retrieval + citation data.

No auth (the polite-pool email is sufficient).
https://europepmc.org/RestfulWebService

Methods:
  - search(query, page_size) → hits with PMID, DOI, title, abstract
  - full_text(pmcid) → XML / plain text body
  - citations(source_id, max) → who cites this paper
  - references(source_id, max) → what this paper cites
"""

from __future__ import annotations

from typing import Any

from app.integrations.base import IntegrationClient


class EuropePMCClient(IntegrationClient):
    SERVICE = "europepmc"
    BASE_URL = "https://www.ebi.ac.uk/europepmc/webservices/rest"
    RATE_PER_SECOND = 5.0
    MAX_CONCURRENT = 4

    async def search(
        self,
        query: str,
        page_size: int = 10,
        source: str | None = "MED",
    ) -> list[dict[str, Any]]:
        if not query:
            return []
        full_query = f"{query} AND SRC:{source}" if source else query
        data = await self.fetch_json(
            "/search",
            params={
                "query": full_query,
                "format": "json",
                "resultType": "core",
                "pageSize": page_size,
            },
        )
        if not data:
            return []
        hits = ((data.get("resultList") or {}).get("result") or [])
        return [
            {
                "pmid": r.get("pmid"),
                "pmcid": r.get("pmcid"),
                "doi": r.get("doi"),
                "title": r.get("title"),
                "author_string": r.get("authorString"),
                "journal": r.get("journalTitle"),
                "pub_year": r.get("pubYear"),
                "abstract": r.get("abstractText"),
                "cited_by_count": r.get("citedByCount"),
                "is_open_access": r.get("isOpenAccess") == "Y",
                "has_full_text": r.get("hasTextMinedTerms") == "Y",
                "source": r.get("source"),
            }
            for r in hits
        ]

    async def full_text(self, pmcid: str) -> str | None:
        """Return plain-text body for an open-access article."""
        if not pmcid:
            return None
        if not pmcid.startswith("PMC"):
            pmcid = f"PMC{pmcid}"
        data = await self.fetch_json(
            f"/{pmcid}/fullTextXML",
            cache_ttl=60 * 60 * 24 * 30,
            allow_cache=False,
        )
        # fetch_json returns {"_raw_text": ...} for non-JSON
        if isinstance(data, dict) and "_raw_text" in data:
            return data["_raw_text"]
        return None

    async def references(
        self, source: str, pmid_or_pmcid: str, page_size: int = 25,
    ) -> list[dict[str, Any]]:
        if not pmid_or_pmcid:
            return []
        data = await self.fetch_json(
            f"/{source}/{pmid_or_pmcid}/references",
            params={"format": "json", "pageSize": page_size, "page": 1},
        )
        if not data:
            return []
        return ((data.get("referenceList") or {})
                .get("reference") or [])[:page_size]

    async def citations(
        self, source: str, pmid_or_pmcid: str, page_size: int = 25,
    ) -> list[dict[str, Any]]:
        if not pmid_or_pmcid:
            return []
        data = await self.fetch_json(
            f"/{source}/{pmid_or_pmcid}/citations",
            params={"format": "json", "pageSize": page_size, "page": 1},
        )
        if not data:
            return []
        return ((data.get("citationList") or {})
                .get("citation") or [])[:page_size]


_singleton: EuropePMCClient | None = None


def get_europepmc_client() -> EuropePMCClient:
    global _singleton
    if _singleton is None:
        _singleton = EuropePMCClient()
    return _singleton
