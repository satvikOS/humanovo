"""
Search Agent Module

Searches multiple sources (web, PubMed, databases) for relevant evidence.
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
        source: str = "web",
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
    """Search agent that queries multiple sources for evidence.

    Supports:
    - Google Custom Search
    - Brave Search
    - PubMed
    - ClinicalTrials.gov
    """

    agent_type = AgentType.SEARCH
    description = "Searches multiple sources for relevant biomedical evidence"

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.http_client = httpx.AsyncClient(timeout=30.0)

    def _setup_tools(self) -> None:
        """Set up search-specific tools."""
        self.register_tool(
            Tool(
                name="google_search",
                description="Search using Google Custom Search API",
                handler=self._google_search,
            )
        )
        self.register_tool(
            Tool(
                name="brave_search",
                description="Search using Brave Search API",
                handler=self._brave_search,
            )
        )
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
        """Execute search across configured sources.

        Args:
            context: Shared context
            query: Search query (uses context.query if not provided)
            **kwargs: Additional parameters (sources, max_results, etc.)

        Returns:
            AgentResult with search results
        """
        import time

        start_time = time.time()

        # Get query
        search_query = query or (context.query if context else "")
        if not search_query:
            return AgentResult(success=False, error="No query provided")

        sources = kwargs.get("sources", ["pubmed", "web"])
        max_results = kwargs.get("max_results", 10)
        include_snippets = kwargs.get("include_snippets", True)

        self.logger.info(
            "Search agent starting",
            query=search_query[:100],
            sources=sources,
        )

        # Run searches in parallel
        search_tasks = []
        for source in sources:
            if source == "google":
                search_tasks.append(self._google_search(search_query, max_results))
            elif source == "brave":
                search_tasks.append(self._brave_search(search_query, max_results))
            elif source == "pubmed":
                search_tasks.append(self._pubmed_search(search_query, max_results))
            elif source == "clinical_trials":
                search_tasks.append(self._clinical_trials_search(search_query, max_results))
            elif source == "web":
                # Default web search - try Google, fallback to Brave
                search_tasks.append(self._web_search(search_query, max_results))

        # Execute all searches
        results = await asyncio.gather(*search_tasks, return_exceptions=True)

        # Aggregate results
        all_results: list[SearchResult] = []
        errors = []

        for i, result in enumerate(results):
            if isinstance(result, Exception):
                errors.append(f"{sources[i]}: {str(result)}")
            elif isinstance(result, list):
                all_results.extend(result)

        # Deduplicate by URL
        seen_urls = set()
        unique_results = []
        for r in all_results:
            if r.url not in seen_urls:
                seen_urls.add(r.url)
                unique_results.append(r)

        # Sort by relevance
        unique_results.sort(key=lambda x: x.relevance_score, reverse=True)
        unique_results = unique_results[:max_results]

        duration_ms = int((time.time() - start_time) * 1000)

        self.record_step(
            action="search",
            input_data={"query": search_query, "sources": sources},
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
            sources=sources or ["pubmed", "web"],
            max_results=max_results,
            include_snippets=include_snippets,
        )
        return result.data.get("results", [])

    async def _web_search(
        self,
        query: str,
        max_results: int = 10,
    ) -> list[SearchResult]:
        """Generic web search - tries Google, then Brave."""
        try:
            return await self._google_search(query, max_results)
        except Exception:
            try:
                return await self._brave_search(query, max_results)
            except Exception:
                # Return empty if both fail
                return []

    async def _google_search(
        self,
        query: str,
        max_results: int = 10,
    ) -> list[SearchResult]:
        """Search using Google Custom Search API."""
        api_key = settings.GOOGLE_API_KEY
        cse_id = settings.GOOGLE_CSE_ID

        if not api_key or not cse_id:
            self.logger.debug("Google Search API not configured")
            return []

        url = "https://www.googleapis.com/customsearch/v1"
        params = {
            "key": api_key.get_secret_value(),
            "cx": cse_id,
            "q": query,
            "num": min(max_results, 10),
        }

        try:
            response = await self.http_client.get(url, params=params)
            response.raise_for_status()
            data = response.json()

            results = []
            for item in data.get("items", []):
                results.append(
                    SearchResult(
                        title=item.get("title", ""),
                        url=item.get("link", ""),
                        snippet=item.get("snippet", ""),
                        source="google",
                        relevance_score=0.7,
                    )
                )

            return results

        except Exception as e:
            self.logger.warning("Google search failed", error=str(e))
            raise

    async def _brave_search(
        self,
        query: str,
        max_results: int = 10,
    ) -> list[SearchResult]:
        """Search using Brave Search API."""
        api_key = settings.BRAVE_API_KEY

        if not api_key:
            self.logger.debug("Brave Search API not configured")
            return []

        url = "https://api.search.brave.com/res/v1/web/search"
        headers = {
            "X-Subscription-Token": api_key.get_secret_value(),
            "Accept": "application/json",
        }
        params = {
            "q": query,
            "count": max_results,
        }

        try:
            response = await self.http_client.get(url, headers=headers, params=params)
            response.raise_for_status()
            data = response.json()

            results = []
            for item in data.get("web", {}).get("results", []):
                results.append(
                    SearchResult(
                        title=item.get("title", ""),
                        url=item.get("url", ""),
                        snippet=item.get("description", ""),
                        source="brave",
                        relevance_score=0.65,
                    )
                )

            return results

        except Exception as e:
            self.logger.warning("Brave search failed", error=str(e))
            raise

    async def _pubmed_search(
        self,
        query: str,
        max_results: int = 10,
    ) -> list[SearchResult]:
        """Search PubMed using E-utilities API."""
        base_url = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"

        # Build search params
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
            # Step 1: Search for IDs
            search_url = f"{base_url}/esearch.fcgi"
            response = await self.http_client.get(search_url, params=search_params)
            response.raise_for_status()
            search_data = response.json()

            id_list = search_data.get("esearchresult", {}).get("idlist", [])
            if not id_list:
                return []

            # Step 2: Fetch summaries
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
                source = article.get("source", "")

                snippet = f"{author_str}. {source}. {pub_date}"

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
                            "journal": source,
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
                title = id_module.get("officialTitle", id_module.get("briefTitle", ""))
                status = status_module.get("overallStatus", "")
                brief_summary = desc_module.get("briefSummary", "")

                snippet = f"Status: {status}. {brief_summary[:200]}..."

                results.append(
                    SearchResult(
                        title=title,
                        url=f"https://clinicaltrials.gov/study/{nct_id}",
                        snippet=snippet,
                        source="clinical_trials",
                        relevance_score=0.75,
                        metadata={
                            "nct_id": nct_id,
                            "status": status,
                        },
                    )
                )

            return results

        except Exception as e:
            self.logger.warning("ClinicalTrials.gov search failed", error=str(e))
            raise

    async def close(self) -> None:
        """Close HTTP client."""
        await self.http_client.aclose()
