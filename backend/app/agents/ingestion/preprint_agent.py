"""
Preprint Ingestion Agent

Specialized agent for ingesting preprints from bioRxiv and medRxiv
using their public API.
"""

import hashlib
from datetime import date, datetime, timedelta
from typing import Any

import aiohttp

from app.agents.ingestion.base import (
    IngestionAgent,
    IngestionConfig,
    IngestionRecord,
    SourceType,
)
from app.core.logging import get_logger

logger = get_logger(__name__)


class PreprintConfig(IngestionConfig):
    """Configuration specific to preprint ingestion."""

    # Server selection
    servers: list[str] = ["biorxiv", "medrxiv"]

    # Subject area filters (bioRxiv categories)
    subject_areas: list[str] = []
    # Examples: biochemistry, bioinformatics, cancer_biology, cell_biology,
    # clinical_trials, developmental_biology, epidemiology, genetics,
    # genomics, immunology, microbiology, molecular_biology, neuroscience,
    # pathology, pharmacology_and_toxicology, physiology, systems_biology

    # Version handling
    latest_version_only: bool = True

    # Publication status filter
    published_filter: bool | None = None  # None=all, True=published, False=not published

    # Sort options
    sort_by: str = "date"  # date, relevance_score


class PreprintIngestionAgent(IngestionAgent):
    """
    Agent for ingesting preprints from bioRxiv and medRxiv.

    Uses the bioRxiv/medRxiv API:
    - Content API for listing preprints by date range
    - Details API for individual preprints
    - Search via CrossRef for full-text search
    """

    source_type = SourceType.PREPRINT
    description = "bioRxiv/medRxiv preprint ingestion agent"

    # API endpoints
    BIORXIV_API = "https://api.biorxiv.org"
    MEDRXIV_API = "https://api.biorxiv.org"  # Same API, different collection
    CROSSREF_API = "https://api.crossref.org/works"

    def __init__(
        self,
        config: PreprintConfig | None = None,
        **kwargs,
    ):
        config = config or PreprintConfig()
        super().__init__(config=config, **kwargs)
        self.preprint_config: PreprintConfig = config
        self._session: aiohttp.ClientSession | None = None

    async def _get_session(self) -> aiohttp.ClientSession:
        """Get or create HTTP session."""
        if self._session is None or self._session.closed:
            timeout = aiohttp.ClientTimeout(total=60)
            self._session = aiohttp.ClientSession(timeout=timeout)
        return self._session

    async def _close_session(self) -> None:
        """Close HTTP session."""
        if self._session and not self._session.closed:
            await self._session.close()

    async def _fetch_by_date_range(
        self,
        server: str,
        start_date: date,
        end_date: date,
        cursor: int = 0,
    ) -> tuple[list[dict[str, Any]], int]:
        """
        Fetch preprints by date range.

        Returns:
            Tuple of (preprints, total_count)
        """
        await self._rate_limit()
        session = await self._get_session()

        # Format dates
        start_str = start_date.strftime("%Y-%m-%d")
        end_str = end_date.strftime("%Y-%m-%d")

        # Build URL
        url = f"{self.BIORXIV_API}/details/{server}/{start_str}/{end_str}/{cursor}"

        try:
            async with session.get(url) as response:
                response.raise_for_status()
                data = await response.json()

            self.state.metrics.api_calls_made += 1

            collection = data.get("collection", [])
            messages = data.get("messages", [])

            # Extract total count from messages
            total_count = 0
            for msg in messages:
                if "total" in msg.get("status", "").lower():
                    # Parse "Returning 30 results from cursor 0 for a total of 100"
                    parts = msg["status"].split()
                    for i, part in enumerate(parts):
                        if part == "total" and i + 2 < len(parts):
                            try:
                                total_count = int(parts[i + 2])
                            except ValueError:
                                pass

            return collection, total_count

        except aiohttp.ClientError as e:
            self.logger.error(f"{server} API error", error=str(e))
            raise

    async def _search_crossref(
        self,
        query: str,
        server: str,
        rows: int = 100,
        offset: int = 0,
    ) -> tuple[list[dict[str, Any]], int]:
        """
        Search preprints via CrossRef API.

        Returns:
            Tuple of (preprints, total_count)
        """
        await self._rate_limit()
        session = await self._get_session()

        # Build filter for specific preprint server
        if server == "biorxiv":
            prefix = "10.1101"
            filter_str = f"prefix:{prefix},type:posted-content"
        else:  # medrxiv
            prefix = "10.1101"
            filter_str = f"prefix:{prefix},type:posted-content"

        params = {
            "query": query,
            "filter": filter_str,
            "rows": rows,
            "offset": offset,
            "sort": "posted" if self.preprint_config.sort_by == "date" else "score",
            "order": "desc",
        }

        try:
            async with session.get(self.CROSSREF_API, params=params) as response:
                response.raise_for_status()
                data = await response.json()

            self.state.metrics.api_calls_made += 1

            message = data.get("message", {})
            items = message.get("items", [])
            total_count = message.get("total-results", 0)

            return items, total_count

        except aiohttp.ClientError as e:
            self.logger.error("CrossRef API error", error=str(e))
            raise

    def _parse_date(self, date_str: str | None) -> datetime | None:
        """Parse date string from API response."""
        if not date_str:
            return None
        try:
            return datetime.strptime(date_str, "%Y-%m-%d")
        except ValueError:
            try:
                return datetime.strptime(date_str, "%Y-%m-%dT%H:%M:%SZ")
            except ValueError:
                return None

    def _parse_crossref_date(self, date_parts: list[list[int]] | None) -> datetime | None:
        """Parse CrossRef date format [[year, month, day]]."""
        if not date_parts or not date_parts[0]:
            return None
        parts = date_parts[0]
        try:
            year = parts[0]
            month = parts[1] if len(parts) > 1 else 1
            day = parts[2] if len(parts) > 2 else 1
            return datetime(year, month, day)
        except (ValueError, IndexError):
            return None

    def _biorxiv_to_record(
        self,
        preprint: dict[str, Any],
        server: str,
    ) -> IngestionRecord:
        """Convert bioRxiv/medRxiv API response to IngestionRecord."""
        doi = preprint.get("doi", "")
        query_hash = hashlib.md5(self.config.query.encode()).hexdigest()[:8]

        # Extract version info
        version = preprint.get("version", "1")
        preprint_id = doi.split("/")[-1] if "/" in doi else doi

        # Extract authors
        authors = []
        author_str = preprint.get("authors", "")
        if author_str:
            # Authors are comma-separated in the API response
            authors = [a.strip() for a in author_str.split(";") if a.strip()]

        # Determine URL based on server
        base_url = f"https://www.{server}.org"
        url = f"{base_url}/content/{doi}v{version}"

        return IngestionRecord(
            record_id=f"preprint_{preprint_id}_{query_hash}",
            source_type=SourceType.PREPRINT,
            source_id=doi,
            title=preprint.get("title", ""),
            abstract=preprint.get("abstract", ""),
            authors=authors,
            publication_date=self._parse_date(preprint.get("date")),
            url=url,
            doi=doi,
            keywords=[preprint.get("category", "")] if preprint.get("category") else [],
            metadata={
                "doi": doi,
                "server": server,
                "version": version,
                "category": preprint.get("category"),
                "type": preprint.get("type"),
                "license": preprint.get("license"),
                "published": preprint.get("published"),
                "published_doi": preprint.get("published_doi"),
                "jatsxml": preprint.get("jatsxml"),
            },
        )

    def _crossref_to_record(
        self,
        item: dict[str, Any],
    ) -> IngestionRecord:
        """Convert CrossRef API response to IngestionRecord."""
        doi = item.get("DOI", "")
        query_hash = hashlib.md5(self.config.query.encode()).hexdigest()[:8]

        preprint_id = doi.split("/")[-1] if "/" in doi else doi

        # Extract title
        titles = item.get("title", [])
        title = titles[0] if titles else ""

        # Extract abstract
        abstract = item.get("abstract", "")
        # Clean up HTML tags if present
        if abstract:
            import re

            abstract = re.sub(r"<[^>]+>", "", abstract)

        # Extract authors
        authors = []
        for author in item.get("author", []):
            given = author.get("given", "")
            family = author.get("family", "")
            if family:
                name = f"{given} {family}".strip()
                authors.append(name)

        # Determine server from DOI or institution
        server = "biorxiv"  # Default
        institution = item.get("institution", [])
        if institution:
            inst_name = institution[0].get("name", "").lower()
            if "medrxiv" in inst_name:
                server = "medrxiv"

        # Build URL
        url = f"https://doi.org/{doi}"

        # Extract subjects/categories
        subjects = []
        for subj in item.get("subject", []):
            subjects.append(subj)

        return IngestionRecord(
            record_id=f"preprint_{preprint_id}_{query_hash}",
            source_type=SourceType.PREPRINT,
            source_id=doi,
            title=title,
            abstract=abstract,
            authors=authors,
            publication_date=self._parse_crossref_date(item.get("posted", {}).get("date-parts")),
            url=url,
            doi=doi,
            keywords=subjects,
            metadata={
                "doi": doi,
                "server": server,
                "publisher": item.get("publisher"),
                "subtype": item.get("subtype"),
                "license": [lic.get("URL") for lic in item.get("license", [])],
                "is_referenced_by_count": item.get("is-referenced-by-count", 0),
                "references_count": item.get("references-count", 0),
            },
        )

    async def fetch_batch(
        self,
        query: str,
        offset: int = 0,
        limit: int = 100,
        **kwargs,
    ) -> tuple[list[IngestionRecord], str | None]:
        """
        Fetch a batch of preprints.

        Uses different strategies based on whether a query is provided:
        - With query: Uses CrossRef API for full-text search
        - Without query: Uses bioRxiv/medRxiv date-range API

        Args:
            query: Search query
            offset: Starting offset
            limit: Maximum records to fetch

        Returns:
            Tuple of (records, next_cursor)
        """
        records = []

        if query:
            # Use CrossRef API for full-text search
            for server in self.preprint_config.servers:
                items, total_count = await self._search_crossref(
                    query=query,
                    server=server,
                    rows=limit // len(self.preprint_config.servers),
                    offset=offset,
                )

                for item in items:
                    try:
                        record = self._crossref_to_record(item)
                        records.append(record)
                    except Exception as e:
                        self.logger.warning("Failed to parse CrossRef item", error=str(e))

            self.logger.info(
                "CrossRef search results",
                preprints_found=len(records),
                query=query[:50],
            )
        else:
            # Use date-range API
            end_date = self.preprint_config.date_to or datetime.utcnow().date()
            start_date = self.preprint_config.date_from or (end_date - timedelta(days=30))

            if isinstance(end_date, datetime):
                end_date = end_date.date()
            if isinstance(start_date, datetime):
                start_date = start_date.date()

            for server in self.preprint_config.servers:
                preprints, total_count = await self._fetch_by_date_range(
                    server=server,
                    start_date=start_date,
                    end_date=end_date,
                    cursor=offset,
                )

                for preprint in preprints:
                    try:
                        # Filter by version if configured
                        if self.preprint_config.latest_version_only:
                            if preprint.get("version") != preprint.get("num_versions"):
                                continue

                        # Filter by subject area if configured
                        if self.preprint_config.subject_areas:
                            category = preprint.get("category", "").lower()
                            if not any(
                                subj.lower() in category
                                for subj in self.preprint_config.subject_areas
                            ):
                                continue

                        record = self._biorxiv_to_record(preprint, server)
                        records.append(record)
                    except Exception as e:
                        self.logger.warning("Failed to parse preprint", error=str(e))

            self.logger.info(
                "bioRxiv/medRxiv date range results",
                preprints_found=len(records),
                date_range=f"{start_date} to {end_date}",
            )

        # Determine next cursor
        next_offset = offset + len(records)
        next_cursor = str(next_offset) if len(records) == limit else None

        return records, next_cursor

    async def fetch_by_id(self, source_id: str) -> IngestionRecord | None:
        """
        Fetch a specific preprint by DOI.

        Args:
            source_id: DOI (e.g., 10.1101/2024.01.01.123456)

        Returns:
            IngestionRecord or None
        """
        # Clean DOI
        doi = source_id
        if not doi.startswith("10."):
            doi = f"10.1101/{doi}"

        await self._rate_limit()
        session = await self._get_session()

        # Try bioRxiv API first
        for server in self.preprint_config.servers:
            url = f"{self.BIORXIV_API}/details/{server}/{doi}"

            try:
                async with session.get(url) as response:
                    if response.status == 404:
                        continue
                    response.raise_for_status()
                    data = await response.json()

                self.state.metrics.api_calls_made += 1

                collection = data.get("collection", [])
                if collection:
                    # Get latest version
                    latest = max(collection, key=lambda x: int(x.get("version", 0)))
                    return self._biorxiv_to_record(latest, server)

            except aiohttp.ClientError:
                continue

        # Fallback to CrossRef
        try:
            crossref_url = f"{self.CROSSREF_API}/{doi}"
            async with session.get(crossref_url) as response:
                if response.status == 200:
                    data = await response.json()
                    item = data.get("message", {})
                    if item:
                        return self._crossref_to_record(item)
        except aiohttp.ClientError:
            pass

        return None

    async def fetch_recent(
        self,
        days: int = 7,
        max_results: int = 100,
    ) -> list[IngestionRecord]:
        """
        Fetch preprints from the last N days.

        Args:
            days: Number of days to look back
            max_results: Maximum preprints to fetch

        Returns:
            List of recent IngestionRecords
        """
        end_date = datetime.utcnow().date()
        start_date = end_date - timedelta(days=days)

        original_dates = (self.preprint_config.date_from, self.preprint_config.date_to)
        self.preprint_config.date_from = datetime.combine(start_date, datetime.min.time())
        self.preprint_config.date_to = datetime.combine(end_date, datetime.min.time())

        try:
            records, _ = await self.fetch_batch(query="", limit=max_results)
            return records
        finally:
            self.preprint_config.date_from, self.preprint_config.date_to = original_dates

    async def fetch_by_category(
        self,
        category: str,
        max_results: int = 100,
    ) -> list[IngestionRecord]:
        """
        Fetch preprints by subject category.

        Args:
            category: Subject area (e.g., 'neuroscience', 'genomics')
            max_results: Maximum preprints to fetch

        Returns:
            List of IngestionRecords in the category
        """
        original_areas = self.preprint_config.subject_areas
        self.preprint_config.subject_areas = [category]

        try:
            records, _ = await self.fetch_batch(query="", limit=max_results)
            return records
        finally:
            self.preprint_config.subject_areas = original_areas

    async def fetch_published_versions(
        self,
        doi: str,
    ) -> dict[str, Any] | None:
        """
        Check if a preprint has been published in a peer-reviewed journal.

        Args:
            doi: Preprint DOI

        Returns:
            Publication info if published, None otherwise
        """
        record = await self.fetch_by_id(doi)
        if record and record.metadata.get("published_doi"):
            return {
                "published": True,
                "published_doi": record.metadata["published_doi"],
                "preprint_doi": doi,
            }
        return None

    async def close(self) -> None:
        """Close resources."""
        await self._close_session()
