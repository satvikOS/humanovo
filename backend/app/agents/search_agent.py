"""
Search Agent Module

Searches biomedical databases (PubMed, ClinicalTrials.gov) for relevant
evidence. Web-search backends (Google, Brave) were removed for v1 — the
discovery pipeline grounds exclusively in open biomedical sources.
See docs/planning/SOURCES_ROADMAP.md.
"""

import asyncio
from typing import Any

import httpx

from app.agents.base import (
    AgentContext,
    AgentResult,
    AgentType,
    BaseAgent,
    Tool,
)
from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)


class SearchResult:
    """A single search result."""

    def __init__(
        self,
        title: str,
        url: str,
        snippet: str = "",
        source: str = "pubmed",
        relevance_score: float = 0.5,
        metadata: dict[str, Any] = None,
    ):
        self.title = title
        self.url = url
        self.snippet = snippet
        self.source = source
        self.relevance_score = relevance_score
        self.metadata = metadata or {}

    def to_dict(self) -> dict[str, Any]:
        return {
            "title": self.title,
            "url": self.url,
            "snippet": self.snippet,
            "source": self.source,
            "relevance_score": self.relevance_score,
            "metadata": self.metadata,
        }


class SearchAgent(BaseAgent):
    """Search agent that queries open biomedical sources for evidence.

    Supports:
    - PubMed (NCBI E-utilities)
    - ClinicalTrials.gov
    """

    agent_type = AgentType.SEARCH
    description = "Searches open biomedical sources for relevant evidence"

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.http_client = httpx.AsyncClient(timeout=30.0)

    def _setup_tools(self) -> None:
        """Set up search-specific tools."""
        self.register_tool(
            Tool(
                name="pubmed_search",
                description="Search PubMed for scientific literature",
                handler=self._pubmed_search,
            )
        )
        self.register_tool(
            Tool(
                name="clinical_trials_search",
                description="Search ClinicalTrials.gov",
                handler=self._clinical_trials_search,
            )
        )

    async def execute(
        self,
        context: AgentContext = None,
        query: str = None,
        **kwargs,
    ) -> AgentResult:
        """Execute search across configured sources."""
        import time

        start_time = time.time()

        search_query = query or (context.query if context else "")
        if not search_query:
            return AgentResult(success=False, error="No query provided")

        sources = kwargs.get("sources", ["pubmed", "clinical_trials"])
        max_results = kwargs.get("max_results", 10)

        self.logger.info(
            "Search agent starting",
            sources=sources,
        )

        search_tasks = []
        for source in sources:
            if source == "pubmed":
                search_tasks.append(self._pubmed_search(search_query, max_results))
            elif source == "clinical_trials":
                search_tasks.append(self._clinical_trials_search(search_query, max_results))
            # Web sources (google/brave) and the generic "web" alias were
            # removed in v1. Unknown sources are silently skipped so that
            # legacy callers passing source="web" don't error.

        results = await asyncio.gather(*search_tasks, return_exceptions=True)

        all_results: list[SearchResult] = []
        errors = []

        for i, result in enumerate(results):
            if isinstance(result, Exception):
                errors.append(f"{sources[i]}: {str(result)}")
            elif isinstance(result, list):
                all_results.extend(result)

        seen_urls = set()
        unique_results = []
        for r in all_results:
            if r.url not in seen_urls:
                seen_urls.add(r.url)
                unique_results.append(r)

        unique_results.sort(key=lambda x: x.relevance_score, reverse=True)
        unique_results = unique_results[:max_results]

        duration_ms = int((time.time() - start_time) * 1000)

        self.record_step(
            action="search",
            input_data={"sources": sources},
            output_data={"result_count": len(unique_results), "errors": errors},
            tool_calls=sources,
            duration_ms=duration_ms,
        )

        return AgentResult(
            success=len(unique_results) > 0 or len(errors) == 0,
            data={
                "results": [r.to_dict() for r in unique_results],
                "evidence": [r.to_dict() for r in unique_results],
                "query": search_query,
                "sources_searched": sources,
                "errors": errors,
                "summary": f"Found {len(unique_results)} results from {len(sources)} sources",
            },
        )

    async def search(
        self,
        query: str,
        sources: list[str] = None,
        max_results: int = 10,
        include_snippets: bool = True,
    ) -> list[dict[str, Any]]:
        """Convenience method for direct search."""
        result = await self.execute(
            query=query,
            sources=sources or ["pubmed", "clinical_trials"],
            max_results=max_results,
            include_snippets=include_snippets,
        )
        return result.data.get("results", [])

    async def _pubmed_search(
        self,
        query: str,
        max_results: int = 10,
    ) -> list[SearchResult]:
        """Search PubMed using E-utilities API."""
        base_url = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"

        search_params = {
            "db": "pubmed",
            "term": query,
            "retmax": max_results,
            "retmode": "json",
            "email": settings.PUBMED_EMAIL,
        }

        if settings.PUBMED_API_KEY:
            search_params["api_key"] = settings.PUBMED_API_KEY.get_secret_value()

        try:
            search_url = f"{base_url}/esearch.fcgi"
            response = await self.http_client.get(search_url, params=search_params)
            response.raise_for_status()
            search_data = response.json()

            id_list = search_data.get("esearchresult", {}).get("idlist", [])
            if not id_list:
                return []

            summary_params = {
                "db": "pubmed",
                "id": ",".join(id_list),
                "retmode": "json",
                "email": settings.PUBMED_EMAIL,
            }
            if settings.PUBMED_API_KEY:
                summary_params["api_key"] = settings.PUBMED_API_KEY.get_secret_value()

            summary_url = f"{base_url}/esummary.fcgi"
            response = await self.http_client.get(summary_url, params=summary_params)
            response.raise_for_status()
            summary_data = response.json()

            results = []
            for pmid in id_list:
                article = summary_data.get("result", {}).get(pmid, {})
                if not article or pmid == "uids":
                    continue

                title = article.get("title", "")
                authors = article.get("authors", [])
                author_str = ", ".join(a.get("name", "") for a in authors[:3])
                if len(authors) > 3:
                    author_str += " et al."

                pub_date = article.get("pubdate", "")
                source_journal = article.get("source", "")

                snippet = f"{author_str}. {source_journal}. {pub_date}"

                results.append(
                    SearchResult(
                        title=title,
                        url=f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/",
                        snippet=snippet,
                        source="pubmed",
                        relevance_score=0.8,
                        metadata={
                            "pmid": pmid,
                            "authors": [a.get("name", "") for a in authors],
                            "journal": source_journal,
                            "pub_date": pub_date,
                        },
                    )
                )

            return results

        except Exception as e:
            self.logger.warning("PubMed search failed", error=str(e))
            raise

    async def _clinical_trials_search(
        self,
        query: str,
        max_results: int = 10,
    ) -> list[SearchResult]:
        """Search ClinicalTrials.gov API."""
        url = "https://clinicaltrials.gov/api/v2/studies"
        params = {
            "query.term": query,
            "pageSize": max_results,
            "format": "json",
        }

        try:
            response = await self.http_client.get(url, params=params)
            response.raise_for_status()
            data = response.json()

            results = []
            for study in data.get("studies", []):
                protocol = study.get("protocolSection", {})
                id_module = protocol.get("identificationModule", {})
                status_module = protocol.get("statusModule", {})
                desc_module = protocol.get("descriptionModule", {})

                nct_id = id_module.get("nctId", "")
                title = id_module.get("briefTitle", "")
                status = status_module.get("overallStatus", "")
                summary = desc_module.get("briefSummary", "")

                results.append(
                    SearchResult(
                        title=title,
                        url=f"https://clinicaltrials.gov/study/{nct_id}",
                        snippet=f"[{status}] {summary[:200]}",
                        source="clinical_trials",
                        relevance_score=0.75,
                        metadata={
                            "nct_id": nct_id,
                            "status": status,
                            "phase": protocol.get("designModule", {}).get("phases", []),
                        },
                    )
                )

            return results

        except Exception as e:
            self.logger.warning("ClinicalTrials search failed", error=str(e))
            raise
