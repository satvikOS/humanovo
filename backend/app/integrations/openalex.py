"""
OpenAlex — scholarly works + concepts + institutions.

No key required; the polite pool honours `mailto=` in the query string.
https://api.openalex.org

Methods we expose:
  - works_for_concept(concept_id, filters, per_page) → list of Work summaries
  - work(id) → single work
  - concept_search(q) → list of concept IDs matching a term
  - works_citing(doi) → papers that cite `doi`
  - recent_biomedical_works(days, per_page) → biomedical-only recent papers
                                              (concept: C71924100 medicine +
                                              C86803240 biology roots)

Every request is tagged with `mailto=<PUBMED_EMAIL>` to stay in the
polite pool (10 rps sustained).
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from app.core.config import settings
from app.integrations.base import IntegrationClient


class OpenAlexClient(IntegrationClient):
    SERVICE = "openalex"
    BASE_URL = "https://api.openalex.org"
    RATE_PER_SECOND = 8.0
    MAX_CONCURRENT = 5

    def _polite(self, params: dict[str, Any]) -> dict[str, Any]:
        params = dict(params or {})
        if settings.PUBMED_EMAIL:
            params.setdefault("mailto", settings.PUBMED_EMAIL)
        return params

    async def work(self, work_id: str) -> dict[str, Any] | None:
        if not work_id:
            return None
        return await self.fetch_json(
            f"/works/{work_id}",
            params=self._polite({}),
        )

    async def works_search(
        self,
        query: str,
        per_page: int = 10,
        filter_concept_id: str | None = None,
        from_year: int | None = None,
    ) -> list[dict[str, Any]]:
        filters = []
        if filter_concept_id:
            filters.append(f"concepts.id:{filter_concept_id}")
        if from_year:
            filters.append(f"from_publication_date:{from_year}-01-01")
        params = self._polite({
            "search": query,
            "per-page": per_page,
            "per_page": per_page,
        })
        if filters:
            params["filter"] = ",".join(filters)
        data = await self.fetch_json("/works", params=params)
        if not data:
            return []
        return [self._trim_work(w) for w in (data.get("results") or [])][:per_page]

    async def works_citing(
        self, doi: str, per_page: int = 10,
    ) -> list[dict[str, Any]]:
        if not doi:
            return []
        data = await self.fetch_json(
            "/works",
            params=self._polite({
                "filter": f"cites:https://doi.org/{doi}",
                "per-page": per_page,
                "per_page": per_page,
            }),
        )
        if not data:
            return []
        return [self._trim_work(w) for w in (data.get("results") or [])][:per_page]

    async def concept_search(self, term: str) -> list[dict[str, Any]]:
        if not term:
            return []
        data = await self.fetch_json(
            "/concepts",
            params=self._polite({"search": term, "per-page": 10, "per_page": 10}),
        )
        if not data:
            return []
        return [
            {
                "id": c.get("id"),
                "display_name": c.get("display_name"),
                "level": c.get("level"),
                "works_count": c.get("works_count"),
                "cited_by_count": c.get("cited_by_count"),
            }
            for c in (data.get("results") or [])[:10]
        ]

    async def recent_biomedical_works(
        self, days: int = 14, per_page: int = 25,
    ) -> list[dict[str, Any]]:
        since = (datetime.now(UTC) - timedelta(days=days)).date().isoformat()
        data = await self.fetch_json(
            "/works",
            params=self._polite({
                # C71924100 = Medicine, C86803240 = Biology
                "filter": f"concepts.id:C71924100|C86803240,from_publication_date:{since}",
                "sort": "cited_by_count:desc",
                "per-page": per_page,
                "per_page": per_page,
            }),
        )
        if not data:
            return []
        return [self._trim_work(w) for w in (data.get("results") or [])][:per_page]

    @staticmethod
    def _trim_work(w: dict[str, Any]) -> dict[str, Any]:
        return {
            "id": w.get("id"),
            "doi": w.get("doi"),
            "title": w.get("title") or w.get("display_name"),
            "publication_year": w.get("publication_year"),
            "publication_date": w.get("publication_date"),
            "type": w.get("type"),
            "cited_by_count": w.get("cited_by_count"),
            "is_oa": (w.get("open_access") or {}).get("is_oa"),
            "oa_url": (w.get("open_access") or {}).get("oa_url"),
            "authorships":
                [a.get("author", {}).get("display_name")
                 for a in (w.get("authorships") or [])][:6],
            "concepts":
                [{"id": c.get("id"),
                  "display_name": c.get("display_name"),
                  "score": c.get("score")}
                 for c in (w.get("concepts") or [])][:8],
            "host_venue_display_name":
                (w.get("primary_location") or {}).get("source", {})
                    .get("display_name"),
        }


_singleton: OpenAlexClient | None = None


def get_openalex_client() -> OpenAlexClient:
    global _singleton
    if _singleton is None:
        _singleton = OpenAlexClient()
    return _singleton
