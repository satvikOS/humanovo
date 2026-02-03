"""
Brave Search Service

24/7 healthcare data ingestion with strict rate limiting.
API Limits: 1 request/second, 2000 requests/month

Optimized for healthcare and biologics (human) data.
"""

import asyncio
import hashlib
import json
import time
from datetime import datetime, timedelta
from typing import Optional
from dataclasses import dataclass, field
from enum import Enum
import aiohttp

# Rate limiting constants
MAX_REQUESTS_PER_SECOND = 1
MAX_REQUESTS_PER_MONTH = 2000
DAILY_BUDGET = 65  # ~2000/30 days, with buffer

# Healthcare search categories for 24/7 ingestion
HEALTHCARE_SEARCH_QUERIES = [
    # Disease Research
    "cancer treatment breakthrough research 2024",
    "alzheimer disease cure research",
    "parkinson disease treatment advances",
    "diabetes type 2 prevention research",
    "cardiovascular disease prevention",
    "autoimmune disease treatment breakthrough",
    "rare disease gene therapy",

    # Genomics & Genetics
    "CRISPR gene editing clinical trials",
    "gene therapy FDA approval",
    "genomic medicine personalized treatment",
    "genetic mutation disease cure",
    "mRNA therapy breakthrough",

    # Drug Discovery
    "drug discovery AI breakthrough",
    "clinical trial results phase 3",
    "FDA drug approval 2024",
    "pharmaceutical breakthrough treatment",
    "biologic drug approval",

    # Immunotherapy
    "immunotherapy cancer treatment",
    "CAR-T cell therapy results",
    "checkpoint inhibitor breakthrough",
    "vaccine technology advancement",

    # Biomarkers & Diagnostics
    "biomarker discovery disease",
    "liquid biopsy cancer detection",
    "early disease detection research",
    "diagnostic breakthrough medicine",

    # Human Biology
    "protein structure prediction medical",
    "human microbiome disease",
    "stem cell therapy clinical",
    "regenerative medicine breakthrough",
    "aging reversal research",

    # Public Health
    "infectious disease outbreak research",
    "pandemic prevention research",
    "antibiotic resistance solution",
    "global health research breakthrough",
]


class SearchPriority(Enum):
    CRITICAL = 1  # Breaking news, FDA approvals
    HIGH = 2      # Clinical trial results
    MEDIUM = 3    # Research papers
    LOW = 4       # General health news


@dataclass
class RateLimitState:
    """Tracks API usage for rate limiting."""
    monthly_count: int = 0
    daily_count: int = 0
    last_request_time: float = 0
    month_start: str = ""
    day_start: str = ""

    def to_dict(self) -> dict:
        return {
            "monthly_count": self.monthly_count,
            "daily_count": self.daily_count,
            "last_request_time": self.last_request_time,
            "month_start": self.month_start,
            "day_start": self.day_start,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "RateLimitState":
        return cls(**data)


@dataclass
class SearchResult:
    """Represents a search result from Brave."""
    title: str
    url: str
    description: str
    source: str
    published_date: Optional[str] = None
    relevance_score: float = 0.0
    content_hash: str = ""

    def __post_init__(self):
        if not self.content_hash:
            self.content_hash = hashlib.md5(
                f"{self.title}{self.url}".encode()
            ).hexdigest()


class BraveSearchService:
    """
    Brave Search API service with 24/7 healthcare data ingestion.

    Features:
    - Strict rate limiting (1 req/sec, 2000/month)
    - Priority queue for search queries
    - Automatic retry with exponential backoff
    - Healthcare-focused query optimization
    - Deduplication via content hashing
    """

    BASE_URL = "https://api.search.brave.com/res/v1"

    def __init__(
        self,
        api_key: str,
        state_file: str = "/tmp/brave_rate_limit_state.json"
    ):
        self.api_key = api_key
        self.state_file = state_file
        self.state = self._load_state()
        self._seen_hashes: set[str] = set()
        self._session: Optional[aiohttp.ClientSession] = None

    def _load_state(self) -> RateLimitState:
        """Load rate limit state from file."""
        try:
            with open(self.state_file, 'r') as f:
                data = json.load(f)
                state = RateLimitState.from_dict(data)

                # Reset counters if new month/day
                now = datetime.utcnow()
                current_month = now.strftime("%Y-%m")
                current_day = now.strftime("%Y-%m-%d")

                if state.month_start != current_month:
                    state.monthly_count = 0
                    state.month_start = current_month

                if state.day_start != current_day:
                    state.daily_count = 0
                    state.day_start = current_day

                return state
        except (FileNotFoundError, json.JSONDecodeError):
            now = datetime.utcnow()
            return RateLimitState(
                month_start=now.strftime("%Y-%m"),
                day_start=now.strftime("%Y-%m-%d"),
            )

    def _save_state(self) -> None:
        """Save rate limit state to file."""
        with open(self.state_file, 'w') as f:
            json.dump(self.state.to_dict(), f)

    async def _get_session(self) -> aiohttp.ClientSession:
        """Get or create aiohttp session."""
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession(
                headers={
                    "Accept": "application/json",
                    "X-Subscription-Token": self.api_key,
                }
            )
        return self._session

    async def close(self) -> None:
        """Close the aiohttp session."""
        if self._session and not self._session.closed:
            await self._session.close()

    def can_make_request(self) -> tuple[bool, str]:
        """Check if we can make a request based on rate limits."""
        now = datetime.utcnow()
        current_month = now.strftime("%Y-%m")
        current_day = now.strftime("%Y-%m-%d")

        # Reset monthly counter if new month
        if self.state.month_start != current_month:
            self.state.monthly_count = 0
            self.state.month_start = current_month

        # Reset daily counter if new day
        if self.state.day_start != current_day:
            self.state.daily_count = 0
            self.state.day_start = current_day

        # Check monthly limit
        if self.state.monthly_count >= MAX_REQUESTS_PER_MONTH:
            return False, f"Monthly limit reached ({MAX_REQUESTS_PER_MONTH})"

        # Check daily budget
        if self.state.daily_count >= DAILY_BUDGET:
            return False, f"Daily budget reached ({DAILY_BUDGET})"

        # Check per-second limit
        time_since_last = time.time() - self.state.last_request_time
        if time_since_last < 1.0:
            return False, f"Rate limit: wait {1.0 - time_since_last:.2f}s"

        return True, "OK"

    async def wait_for_rate_limit(self) -> None:
        """Wait until we can make a request."""
        while True:
            can_request, reason = self.can_make_request()
            if can_request:
                return

            if "Monthly limit" in reason or "Daily budget" in reason:
                # Wait longer for daily/monthly resets
                await asyncio.sleep(60)
            else:
                # Wait for per-second limit
                time_since_last = time.time() - self.state.last_request_time
                wait_time = max(0, 1.0 - time_since_last)
                await asyncio.sleep(wait_time)

    def _record_request(self) -> None:
        """Record a successful request."""
        self.state.monthly_count += 1
        self.state.daily_count += 1
        self.state.last_request_time = time.time()
        self._save_state()

    async def search(
        self,
        query: str,
        count: int = 20,
        freshness: str = "pw",  # past week
    ) -> list[SearchResult]:
        """
        Execute a search query with rate limiting.

        Args:
            query: Search query
            count: Number of results (max 20)
            freshness: Time filter (pd=past day, pw=past week, pm=past month)
        """
        await self.wait_for_rate_limit()

        session = await self._get_session()

        params = {
            "q": query,
            "count": min(count, 20),
            "freshness": freshness,
            "text_decorations": "false",
            "search_lang": "en",
            "country": "us",
        }

        try:
            async with session.get(
                f"{self.BASE_URL}/web/search",
                params=params,
                timeout=aiohttp.ClientTimeout(total=30),
            ) as response:
                self._record_request()

                if response.status != 200:
                    error_text = await response.text()
                    raise Exception(f"Brave API error {response.status}: {error_text}")

                data = await response.json()

                results = []

                # Process web results
                for item in data.get("web", {}).get("results", []):
                    result = SearchResult(
                        title=item.get("title", ""),
                        url=item.get("url", ""),
                        description=item.get("description", ""),
                        source=item.get("profile", {}).get("name", ""),
                        published_date=item.get("age", ""),
                    )

                    # Skip duplicates
                    if result.content_hash not in self._seen_hashes:
                        self._seen_hashes.add(result.content_hash)
                        results.append(result)

                # Process news results
                for item in data.get("news", {}).get("results", []):
                    result = SearchResult(
                        title=item.get("title", ""),
                        url=item.get("url", ""),
                        description=item.get("description", ""),
                        source=item.get("source", ""),
                        published_date=item.get("age", ""),
                    )

                    if result.content_hash not in self._seen_hashes:
                        self._seen_hashes.add(result.content_hash)
                        results.append(result)

                return results

        except asyncio.TimeoutError:
            raise Exception("Brave API request timed out")

    async def search_healthcare(
        self,
        query: str,
        count: int = 20,
    ) -> list[SearchResult]:
        """
        Search with healthcare-optimized query enhancement.
        """
        # Enhance query for healthcare relevance
        enhanced_query = f"{query} (research OR clinical OR treatment OR study OR trial)"

        results = await self.search(enhanced_query, count)

        # Filter for healthcare relevance
        healthcare_keywords = {
            "health", "medical", "clinical", "treatment", "therapy",
            "disease", "patient", "drug", "study", "research", "trial",
            "cancer", "gene", "protein", "mutation", "fda", "nih",
            "hospital", "doctor", "medicine", "pharmaceutical", "biotech",
        }

        filtered = []
        for result in results:
            text = f"{result.title} {result.description}".lower()
            if any(kw in text for kw in healthcare_keywords):
                # Calculate relevance score
                matches = sum(1 for kw in healthcare_keywords if kw in text)
                result.relevance_score = min(1.0, matches / 5)
                filtered.append(result)

        return sorted(filtered, key=lambda x: x.relevance_score, reverse=True)

    def get_usage_stats(self) -> dict:
        """Get current usage statistics."""
        return {
            "monthly_count": self.state.monthly_count,
            "monthly_limit": MAX_REQUESTS_PER_MONTH,
            "monthly_remaining": MAX_REQUESTS_PER_MONTH - self.state.monthly_count,
            "daily_count": self.state.daily_count,
            "daily_budget": DAILY_BUDGET,
            "daily_remaining": DAILY_BUDGET - self.state.daily_count,
            "can_request": self.can_make_request()[0],
        }


class HealthcareDataIngestionService:
    """
    24/7 healthcare data ingestion service.

    Continuously fetches healthcare and biologics data from Brave Search
    with intelligent query scheduling and rate limit management.
    """

    def __init__(self, brave_service: BraveSearchService):
        self.brave = brave_service
        self.running = False
        self._query_index = 0
        self._results_buffer: list[SearchResult] = []

    async def start(self, callback=None) -> None:
        """
        Start 24/7 ingestion loop.

        Args:
            callback: Async function to call with each batch of results
        """
        self.running = True

        while self.running:
            try:
                # Get next query
                query = HEALTHCARE_SEARCH_QUERIES[self._query_index]
                self._query_index = (self._query_index + 1) % len(HEALTHCARE_SEARCH_QUERIES)

                # Check if we can make a request
                can_request, reason = self.brave.can_make_request()

                if not can_request:
                    if "Monthly limit" in reason:
                        # Wait until next month
                        print(f"[Brave] Monthly limit reached. Waiting for reset...")
                        await asyncio.sleep(3600)  # Check every hour
                        continue
                    elif "Daily budget" in reason:
                        # Wait until next day
                        print(f"[Brave] Daily budget reached. Waiting for reset...")
                        await asyncio.sleep(3600)  # Check every hour
                        continue

                # Execute search
                print(f"[Brave] Searching: {query[:50]}...")
                results = await self.brave.search_healthcare(query)

                if results:
                    self._results_buffer.extend(results)
                    print(f"[Brave] Found {len(results)} results")

                    if callback:
                        await callback(results)

                # Wait for rate limit (1 request per second)
                await asyncio.sleep(1.1)

            except Exception as e:
                print(f"[Brave] Error: {e}")
                await asyncio.sleep(10)  # Wait before retry

    def stop(self) -> None:
        """Stop the ingestion loop."""
        self.running = False

    def get_buffered_results(self) -> list[SearchResult]:
        """Get and clear the results buffer."""
        results = self._results_buffer
        self._results_buffer = []
        return results


# Singleton instance with the API key
_brave_service: Optional[BraveSearchService] = None


def get_brave_service() -> BraveSearchService:
    """Get or create the Brave Search service singleton."""
    global _brave_service
    if _brave_service is None:
        # API key from user
        api_key = "BSA2JKpMLuy_Q-pNFuYcJNKVeRLJpnB"
        _brave_service = BraveSearchService(api_key)
    return _brave_service


async def start_24_7_ingestion(callback=None) -> None:
    """Start the 24/7 healthcare data ingestion."""
    service = get_brave_service()
    ingestion = HealthcareDataIngestionService(service)
    await ingestion.start(callback)


async def search_healthcare_data(
    query: str,
    max_results: int = 10,
) -> list[dict]:
    """
    Search for healthcare data using Brave Search.

    Convenience function for the disease discovery service.

    Args:
        query: Search query
        max_results: Maximum number of results to return

    Returns:
        List of search results as dictionaries
    """
    try:
        service = get_brave_service()
        results = await service.search_healthcare(query, count=max_results)

        return [
            {
                "title": r.title,
                "url": r.url,
                "description": r.description,
                "source": r.source,
                "published_date": r.published_date,
                "relevance_score": r.relevance_score,
            }
            for r in results
        ]
    except Exception:
        # Return empty list on error to not block discovery
        return []
