"""
Patents Ingestion Agent

Specialized agent for ingesting patent data from USPTO PatentsView API
and other patent databases.
"""

import hashlib
from datetime import datetime
from typing import Any

import httpx

from app.agents.ingestion.base import (
    IngestionAgent,
    IngestionConfig,
    IngestionRecord,
    SourceType,
)
from app.core.http_allowlist import make_httpx_client
from app.core.logging import get_logger

logger = get_logger(__name__)


class PatentsConfig(IngestionConfig):
    """Configuration specific to patent ingestion."""

    # Patent office selection
    patent_offices: list[str] = ["USPTO"]  # USPTO, EPO, WIPO

    # Patent type filters
    patent_types: list[str] = []  # utility, design, plant, reissue

    # CPC classification filters (Cooperative Patent Classification)
    cpc_sections: list[str] = []  # A, B, C, D, E, F, G, H (A=Human necessities, C=Chemistry)
    cpc_classes: list[str] = []  # Specific CPC classes like A61K (Medical preparations)

    # Assignee filters
    assignee_types: list[str] = []  # Individual, Corporation, Government
    assignee_names: list[str] = []

    # Inventor filters
    inventor_countries: list[str] = []

    # Citation filters
    min_citations: int = 0

    # Application/grant date filters
    use_application_date: bool = False  # Use application date instead of grant date


class PatentsIngestionAgent(IngestionAgent):
    """
    Agent for ingesting patent data from USPTO PatentsView API.

    Supports:
    - Full-text patent search
    - CPC classification filtering
    - Citation analysis
    - Assignee and inventor filtering
    """

    source_type = SourceType.PATENTS
    description = "USPTO/EPO/WIPO patent ingestion agent"

    # PatentsView API endpoint
    PATENTSVIEW_API = "https://api.patentsview.org/patents/query"

    # Output fields to request
    PATENT_FIELDS = [
        "patent_id",
        "patent_number",
        "patent_title",
        "patent_abstract",
        "patent_date",
        "patent_type",
        "patent_kind",
        "patent_num_claims",
        "patent_num_cited_by_us_patents",
        "patent_num_us_patent_citations",
        "patent_firstnamed_assignee_id",
        "patent_firstnamed_assignee_city",
        "patent_firstnamed_assignee_state",
        "patent_firstnamed_assignee_country",
        "patent_firstnamed_inventor_id",
        "patent_firstnamed_inventor_city",
        "patent_firstnamed_inventor_state",
        "patent_firstnamed_inventor_country",
    ]

    # Additional fields for detailed requests
    DETAIL_FIELDS = [
        "assignees",
        "inventors",
        "cpcs",
        "uspc_mainclasses",
        "claims",
    ]

    def __init__(
        self,
        config: PatentsConfig | None = None,
        **kwargs,
    ):
        config = config or PatentsConfig()
        super().__init__(config=config, **kwargs)
        self.patents_config: PatentsConfig = config
        self._session: httpx.AsyncClient | None = None

    async def _get_session(self) -> httpx.AsyncClient:
        """Get or create the SSRF-allowlisted httpx client."""
        if self._session is None:
            self._session = make_httpx_client(timeout=60.0, follow_redirects=True)
        return self._session

    async def _close_session(self) -> None:
        """Close HTTP session."""
        if self._session is not None:
            await self._session.aclose()
            self._session = None

    def _build_query(self, search_query: str) -> dict[str, Any]:
        """Build PatentsView API query."""
        # Build query criteria
        criteria = []

        # Full-text search on title and abstract
        if search_query:
            criteria.append(
                {
                    "_or": [
                        {"_text_any": {"patent_title": search_query}},
                        {"_text_any": {"patent_abstract": search_query}},
                    ]
                }
            )

        # Patent type filter
        if self.patents_config.patent_types:
            criteria.append(
                {"_or": [{"patent_type": pt} for pt in self.patents_config.patent_types]}
            )

        # CPC section filter (biomedical is typically A61, C07, C12)
        if self.patents_config.cpc_sections:
            criteria.append(
                {
                    "_or": [
                        {"cpc_section_id": section} for section in self.patents_config.cpc_sections
                    ]
                }
            )

        # CPC class filter
        if self.patents_config.cpc_classes:
            criteria.append(
                {
                    "_or": [
                        {"_begins": {"cpc_subgroup_id": cls}}
                        for cls in self.patents_config.cpc_classes
                    ]
                }
            )

        # Assignee name filter
        if self.patents_config.assignee_names:
            criteria.append(
                {
                    "_or": [
                        {"_contains": {"assignee_organization": name}}
                        for name in self.patents_config.assignee_names
                    ]
                }
            )

        # Inventor country filter
        if self.patents_config.inventor_countries:
            criteria.append(
                {
                    "_or": [
                        {"inventor_country": country}
                        for country in self.patents_config.inventor_countries
                    ]
                }
            )

        # Date range filter
        date_field = "app_date" if self.patents_config.use_application_date else "patent_date"
        if self.patents_config.date_from:
            criteria.append(
                {"_gte": {date_field: self.patents_config.date_from.strftime("%Y-%m-%d")}}
            )
        if self.patents_config.date_to:
            criteria.append(
                {"_lte": {date_field: self.patents_config.date_to.strftime("%Y-%m-%d")}}
            )

        # Citation filter
        if self.patents_config.min_citations > 0:
            criteria.append(
                {"_gte": {"patent_num_cited_by_us_patents": self.patents_config.min_citations}}
            )

        # Combine criteria
        if len(criteria) == 0:
            query = {"_gte": {"patent_date": "1976-01-01"}}  # All patents since 1976
        elif len(criteria) == 1:
            query = criteria[0]
        else:
            query = {"_and": criteria}

        return query

    async def _search_patents(
        self,
        query: str,
        page: int = 1,
        per_page: int = 100,
    ) -> tuple[list[dict[str, Any]], int]:
        """
        Search for patents using PatentsView API.

        Returns:
            Tuple of (patents, total_count)
        """
        await self._rate_limit()
        session = await self._get_session()

        # Build request body
        api_query = self._build_query(query)

        # Build output fields
        output_fields = self.PATENT_FIELDS.copy()
        if self.config.extract_full_text:
            output_fields.extend(self.DETAIL_FIELDS)

        request_body = {
            "q": api_query,
            "f": output_fields,
            "o": {
                "page": page,
                "per_page": min(per_page, 1000),  # API max is 1000
            },
            "s": [{"patent_date": "desc"}],  # Sort by date descending
        }

        try:
            response = await session.post(
                self.PATENTSVIEW_API,
                json=request_body,
                headers={"Content-Type": "application/json"},
            )
            response.raise_for_status()
            data = response.json()

            self.state.metrics.api_calls_made += 1

            patents = data.get("patents", [])
            total_count = data.get("total_patent_count", 0)

            return patents, total_count

        except httpx.HTTPError as e:
            self.logger.error("PatentsView API error", error=str(e))
            raise

    def _parse_date(self, date_str: str | None) -> datetime | None:
        """Parse date string from API response."""
        if not date_str:
            return None
        try:
            return datetime.strptime(date_str, "%Y-%m-%d")
        except ValueError:
            return None

    def _patent_to_record(
        self,
        patent: dict[str, Any],
    ) -> IngestionRecord:
        """Convert API patent response to IngestionRecord."""
        patent_number = patent.get("patent_number", "")
        patent_id = patent.get("patent_id", patent_number)
        query_hash = hashlib.md5(self.config.query.encode()).hexdigest()[:8]

        # Extract basic info
        title = patent.get("patent_title", "")
        abstract = patent.get("patent_abstract", "")

        # Extract inventors
        inventors = []
        inventor_data = patent.get("inventors", [])
        if inventor_data:
            for inv in inventor_data:
                name_parts = []
                if inv.get("inventor_first_name"):
                    name_parts.append(inv["inventor_first_name"])
                if inv.get("inventor_last_name"):
                    name_parts.append(inv["inventor_last_name"])
                if name_parts:
                    inventors.append(" ".join(name_parts))
        else:
            # Use first-named inventor from main fields
            first_inventor_id = patent.get("patent_firstnamed_inventor_id")
            if first_inventor_id:
                inventors.append(f"Inventor {first_inventor_id}")

        # Extract assignees
        assignees = []
        assignee_data = patent.get("assignees", [])
        if assignee_data:
            for asg in assignee_data:
                org = asg.get("assignee_organization")
                if org:
                    assignees.append(org)

        # Extract CPC classifications
        cpcs = []
        cpc_data = patent.get("cpcs", [])
        if cpc_data:
            for cpc in cpc_data:
                cpc_id = cpc.get("cpc_subgroup_id") or cpc.get("cpc_group_id")
                if cpc_id:
                    cpcs.append(cpc_id)

        # Extract claims
        claims = []
        claims_data = patent.get("claims", [])
        if claims_data:
            for claim in claims_data[:5]:  # First 5 claims
                claims.append(claim.get("claim_text", ""))

        # Build URL
        url = f"https://patents.google.com/patent/US{patent_number}"

        return IngestionRecord(
            record_id=f"patent_{patent_number}_{query_hash}",
            source_type=SourceType.PATENTS,
            source_id=patent_number,
            title=title,
            abstract=abstract,
            full_text="\n".join(claims) if claims else None,
            authors=inventors,
            publication_date=self._parse_date(patent.get("patent_date")),
            url=url,
            keywords=cpcs[:10],  # Use CPC codes as keywords
            metadata={
                "patent_number": patent_number,
                "patent_id": patent_id,
                "patent_type": patent.get("patent_type"),
                "patent_kind": patent.get("patent_kind"),
                "num_claims": patent.get("patent_num_claims"),
                "citations_received": patent.get("patent_num_cited_by_us_patents"),
                "citations_made": patent.get("patent_num_us_patent_citations"),
                "assignees": assignees,
                "inventors": inventors,
                "cpc_classifications": cpcs,
                "first_assignee_country": patent.get("patent_firstnamed_assignee_country"),
                "first_inventor_country": patent.get("patent_firstnamed_inventor_country"),
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
        Fetch a batch of patents.

        Args:
            query: Search query
            offset: Starting offset
            limit: Maximum records to fetch

        Returns:
            Tuple of (records, next_cursor)
        """
        # Convert offset to page number
        page = (offset // limit) + 1

        patents, total_count = await self._search_patents(
            query=query,
            page=page,
            per_page=limit,
        )

        self.logger.info(
            "PatentsView search results",
            patents_found=len(patents),
            total_count=total_count,
            page=page,
        )

        records = []
        for patent in patents:
            try:
                record = self._patent_to_record(patent)
                records.append(record)
            except Exception as e:
                self.logger.warning("Failed to parse patent", error=str(e))
                continue

        # Determine next cursor
        next_offset = offset + len(patents)
        next_cursor = str(next_offset) if next_offset < total_count else None

        return records, next_cursor

    async def fetch_by_id(self, source_id: str) -> IngestionRecord | None:
        """
        Fetch a specific patent by patent number.

        Args:
            source_id: Patent number (e.g., 11234567)

        Returns:
            IngestionRecord or None
        """
        # Clean patent number
        patent_number = source_id.replace("US", "").replace(",", "").strip()

        await self._rate_limit()
        session = await self._get_session()

        request_body = {
            "q": {"patent_number": patent_number},
            "f": self.PATENT_FIELDS + self.DETAIL_FIELDS,
        }

        try:
            response = await session.post(
                self.PATENTSVIEW_API,
                json=request_body,
                headers={"Content-Type": "application/json"},
            )
            response.raise_for_status()
            data = response.json()

            self.state.metrics.api_calls_made += 1

            patents = data.get("patents", [])
            if patents:
                return self._patent_to_record(patents[0])

            return None

        except httpx.HTTPError as e:
            self.logger.error("Failed to fetch patent", patent_number=patent_number, error=str(e))
            return None

    async def fetch_by_assignee(
        self,
        assignee_name: str,
        max_results: int = 100,
    ) -> list[IngestionRecord]:
        """
        Fetch patents by assignee name.

        Args:
            assignee_name: Company or organization name
            max_results: Maximum patents to fetch

        Returns:
            List of IngestionRecords
        """
        original_assignees = self.patents_config.assignee_names
        self.patents_config.assignee_names = [assignee_name]

        try:
            records, _ = await self.fetch_batch(query="", limit=max_results)
            return records
        finally:
            self.patents_config.assignee_names = original_assignees

    async def fetch_by_cpc(
        self,
        cpc_class: str,
        max_results: int = 100,
    ) -> list[IngestionRecord]:
        """
        Fetch patents by CPC classification.

        Common biomedical CPC classes:
        - A61K: Medical preparations
        - A61P: Therapeutic activity
        - C07K: Peptides
        - C12N: Microorganisms or enzymes
        - C12Q: Measuring or testing involving enzymes

        Args:
            cpc_class: CPC classification (e.g., A61K)
            max_results: Maximum patents to fetch

        Returns:
            List of IngestionRecords
        """
        original_classes = self.patents_config.cpc_classes
        self.patents_config.cpc_classes = [cpc_class]

        try:
            records, _ = await self.fetch_batch(query="", limit=max_results)
            return records
        finally:
            self.patents_config.cpc_classes = original_classes

    async def fetch_citing_patents(
        self,
        patent_number: str,
        max_results: int = 50,
    ) -> list[IngestionRecord]:
        """
        Fetch patents that cite a given patent.

        Args:
            patent_number: Source patent number
            max_results: Maximum citing patents to fetch

        Returns:
            List of citing IngestionRecords
        """
        await self._rate_limit()
        session = await self._get_session()

        # Query for patents that cite the given patent
        request_body = {
            "q": {"cited_patent_number": patent_number.replace("US", "")},
            "f": self.PATENT_FIELDS,
            "o": {"per_page": min(max_results, 1000)},
            "s": [{"patent_date": "desc"}],
        }

        try:
            response = await session.post(
                self.PATENTSVIEW_API,
                json=request_body,
                headers={"Content-Type": "application/json"},
            )
            response.raise_for_status()
            data = response.json()

            self.state.metrics.api_calls_made += 1

            patents = data.get("patents", [])
            return [self._patent_to_record(p) for p in patents]

        except httpx.HTTPError as e:
            self.logger.error("Failed to fetch citing patents", error=str(e))
            return []

    async def close(self) -> None:
        """Close resources."""
        await self._close_session()
