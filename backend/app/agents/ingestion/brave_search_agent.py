"""
Brave Search Agent

Web search agent using Brave Search API for finding
real-time information, news, and web content.
"""

import aiohttp
from datetime import datetime
from typing import Any
from pydantic import BaseModel

from app.core.logging import get_logger

logger = get_logger(__name__)


class BraveSearchResult(BaseModel):
    """A single search result from Brave."""

    title: str
    url: str
    description: str
    published_date: datetime | None = None
    source: str | None = None
    relevance_score: float = 0.0
    metadata: dict[str, Any] = {}


class BraveSearchConfig(BaseModel):
    """Configuration for Brave Search."""

    api_key: str
    search_type: str = "web"  # web, news, images
    country: str = "US"
    language: str = "en"
    safe_search: str = "moderate"
    freshness: str | None = None  # pd (past day), pw (past week), pm (past month), py (past year)


class BraveSearchAgent:
    """
    Agent for searching the web using Brave Search API.

    Features:
    - Web search with relevance ranking
    - News search for recent articles
    - Freshness filtering
    - Safe search
    """

    BASE_URL = "https://api.search.brave.com/res/v1"

    def __init__(self, config: BraveSearchConfig):
        self.config = config
        self._session: aiohttp.ClientSession | None = None

    async def _get_session(self) -> aiohttp.ClientSession:
        """Get or create HTTP session."""
        if self._session is None or self._session.closed:
            headers = {
                "Accept": "application/json",
                "Accept-Encoding": "gzip",
                "X-Subscription-Token": self.config.api_key,
            }
            self._session = aiohttp.ClientSession(headers=headers)
        return self._session

    async def search(
        self,
        query: str,
        count: int = 20,
        offset: int = 0,
        freshness: str | None = None,
    ) -> list[BraveSearchResult]:
        """
        Search the web using Brave Search.

        Args:
            query: Search query
            count: Number of results (max 20)
            offset: Pagination offset
            freshness: Time filter (pd, pw, pm, py)

        Returns:
            List of search results
        """
        session = await self._get_session()

        params = {
            "q": query,
            "count": min(count, 20),
            "offset": offset,
            "country": self.config.country,
            "search_lang": self.config.language,
            "safesearch": self.config.safe_search,
        }

        if freshness or self.config.freshness:
            params["freshness"] = freshness or self.config.freshness

        endpoint = f"{self.BASE_URL}/{self.config.search_type}/search"

        try:
            async with session.get(endpoint, params=params) as response:
                if response.status == 429:
                    logger.warning("Brave Search rate limited")
                    return []

                response.raise_for_status()
                data = await response.json()

            results = []

            # Parse web results
            web_results = data.get("web", {}).get("results", [])
            for i, result in enumerate(web_results):
                results.append(BraveSearchResult(
                    title=result.get("title", ""),
                    url=result.get("url", ""),
                    description=result.get("description", ""),
                    published_date=self._parse_date(result.get("age")),
                    source=result.get("profile", {}).get("name"),
                    relevance_score=1.0 - (i / len(web_results)),
                    metadata={
                        "favicon": result.get("profile", {}).get("img"),
                        "language": result.get("language"),
                    }
                ))

            # Parse news results if available
            news_results = data.get("news", {}).get("results", [])
            for i, result in enumerate(news_results):
                results.append(BraveSearchResult(
                    title=result.get("title", ""),
                    url=result.get("url", ""),
                    description=result.get("description", ""),
                    published_date=self._parse_date(result.get("age")),
                    source=result.get("source"),
                    relevance_score=0.9 - (i / max(len(news_results), 1)),
                    metadata={
                        "is_news": True,
                        "thumbnail": result.get("thumbnail", {}).get("src"),
                    }
                ))

            logger.info(
                "Brave search completed",
                query=query[:50],
                results=len(results),
            )

            return results

        except aiohttp.ClientError as e:
            logger.error("Brave search failed", error=str(e))
            return []

    async def search_news(
        self,
        query: str,
        count: int = 20,
        freshness: str = "pw",  # Past week by default
    ) -> list[BraveSearchResult]:
        """Search for news articles."""
        # Use news endpoint
        original_type = self.config.search_type
        self.config.search_type = "news"

        try:
            results = await self.search(query, count, freshness=freshness)
            return results
        finally:
            self.config.search_type = original_type

    async def search_healthcare(
        self,
        query: str,
        count: int = 20,
    ) -> list[BraveSearchResult]:
        """
        Search for healthcare-specific content.

        Adds healthcare-specific terms to improve relevance.
        """
        # Enhance query with healthcare context
        enhanced_query = f"{query} (research OR clinical OR treatment OR therapy OR study)"

        results = await self.search(enhanced_query, count)

        # Filter for healthcare-relevant results
        healthcare_keywords = [
            "health", "medical", "clinical", "treatment", "therapy",
            "disease", "patient", "drug", "study", "research",
            "ncbi", "pubmed", "nih", "fda", "who", "cdc",
            "cancer", "gene", "protein", "mutation", "trial"
        ]

        filtered = []
        for result in results:
            text = f"{result.title} {result.description} {result.url}".lower()
            if any(kw in text for kw in healthcare_keywords):
                result.relevance_score *= 1.2  # Boost healthcare content
                filtered.append(result)
            elif result.relevance_score > 0.7:  # Keep high-relevance non-healthcare
                filtered.append(result)

        return sorted(filtered, key=lambda r: r.relevance_score, reverse=True)

    def _parse_date(self, age_str: str | None) -> datetime | None:
        """Parse age string like '2 hours ago' to datetime."""
        if not age_str:
            return None

        now = datetime.utcnow()
        age_str = age_str.lower()

        try:
            if "hour" in age_str:
                hours = int(age_str.split()[0])
                return now.replace(hour=now.hour - hours)
            elif "day" in age_str:
                days = int(age_str.split()[0])
                return now.replace(day=now.day - days)
            elif "week" in age_str:
                weeks = int(age_str.split()[0])
                return now.replace(day=now.day - (weeks * 7))
            elif "month" in age_str:
                months = int(age_str.split()[0])
                return now.replace(month=now.month - months)
        except (ValueError, IndexError):
            pass

        return None

    async def close(self) -> None:
        """Close HTTP session."""
        if self._session and not self._session.closed:
            await self._session.close()


# Convenience function
async def brave_search(
    query: str,
    api_key: str,
    count: int = 10,
    healthcare_focused: bool = True,
) -> list[BraveSearchResult]:
    """
    Quick search using Brave API.

    Args:
        query: Search query
        api_key: Brave API key
        count: Number of results
        healthcare_focused: Filter for healthcare content

    Returns:
        List of search results
    """
    config = BraveSearchConfig(api_key=api_key)
    agent = BraveSearchAgent(config)

    try:
        if healthcare_focused:
            return await agent.search_healthcare(query, count)
        else:
            return await agent.search(query, count)
    finally:
        await agent.close()
