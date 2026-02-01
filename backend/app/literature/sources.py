"""
Literature Source Connectors

Connectors for various biomedical literature sources:
- PubMed/MEDLINE
- Patent databases (USPTO, EPO, WIPO)
- ClinicalTrials.gov
- bioRxiv/medRxiv
- FDA/EMA documents
"""

import hashlib
import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import date
from enum import Enum
from typing import Any

logger = logging.getLogger(__name__)


class SourceType(str, Enum):
    """Types of literature sources."""

    PUBMED = "pubmed"
    PATENT = "patent"
    CLINICAL_TRIAL = "clinical_trial"
    PREPRINT = "preprint"
    FDA_LABEL = "fda_label"
    GUIDELINE = "guideline"
    REVIEW = "review"


@dataclass
class LiteratureRecord:
    """Represents a literature record."""

    record_id: str
    source_type: SourceType
    title: str
    abstract: str | None = None
    full_text: str | None = None
    authors: list[str] = field(default_factory=list)
    publication_date: date | None = None
    journal: str | None = None
    doi: str | None = None
    pmid: str | None = None
    patent_number: str | None = None
    nct_id: str | None = None  # ClinicalTrials.gov ID
    keywords: list[str] = field(default_factory=list)
    mesh_terms: list[str] = field(default_factory=list)
    citations: int = 0
    url: str | None = None
    language: str = "en"
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "record_id": self.record_id,
            "source_type": self.source_type.value,
            "title": self.title,
            "abstract": self.abstract,
            "authors": self.authors,
            "publication_date": self.publication_date.isoformat()
            if self.publication_date
            else None,
            "journal": self.journal,
            "doi": self.doi,
            "pmid": self.pmid,
            "patent_number": self.patent_number,
            "nct_id": self.nct_id,
            "keywords": self.keywords,
            "mesh_terms": self.mesh_terms,
            "citations": self.citations,
            "url": self.url,
            "language": self.language,
            "metadata": self.metadata,
        }

    def get_text(self) -> str:
        """Get combined text for processing."""
        parts = []
        if self.title:
            parts.append(self.title)
        if self.abstract:
            parts.append(self.abstract)
        if self.full_text:
            parts.append(self.full_text)
        return "\n\n".join(parts)

    def get_content_hash(self) -> str:
        """Get hash of content for deduplication."""
        content = f"{self.title}|{self.abstract or ''}"
        return hashlib.md5(content.encode()).hexdigest()


class LiteratureSource(ABC):
    """Abstract base class for literature sources."""

    @abstractmethod
    async def search(self, query: str, max_results: int = 100, **kwargs) -> list[LiteratureRecord]:
        """Search for records."""
        pass

    @abstractmethod
    async def fetch(self, record_id: str) -> LiteratureRecord | None:
        """Fetch a specific record."""
        pass

    @abstractmethod
    async def fetch_batch(self, record_ids: list[str]) -> list[LiteratureRecord]:
        """Fetch multiple records."""
        pass

    @property
    @abstractmethod
    def source_type(self) -> SourceType:
        """Get source type."""
        pass


class PubMedSource(LiteratureSource):
    """PubMed/MEDLINE literature source."""

    BASE_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"

    def __init__(
        self,
        api_key: str | None = None,
        email: str | None = None,
        rate_limit: float = 3.0,  # requests per second
    ):
        """
        Initialize PubMed source.

        Args:
            api_key: NCBI API key
            email: Contact email (required by NCBI)
            rate_limit: Requests per second
        """
        self.api_key = api_key
        self.email = email
        self.rate_limit = rate_limit
        self._last_request = 0

    @property
    def source_type(self) -> SourceType:
        return SourceType.PUBMED

    async def search(
        self,
        query: str,
        max_results: int = 100,
        date_from: date | None = None,
        date_to: date | None = None,
        **kwargs,
    ) -> list[LiteratureRecord]:
        """
        Search PubMed.

        Args:
            query: Search query
            max_results: Maximum results
            date_from: Start date filter
            date_to: End date filter

        Returns:
            List of LiteratureRecords
        """
        # Note: In production, use actual NCBI API
        # This is a mock implementation
        logger.info(f"PubMed search: {query}, max_results={max_results}")

        # Mock results for demonstration
        # Use query hash to generate deterministic IDs for consistent URLs
        query_hash = hashlib.md5(query.encode()).hexdigest()
        records = []
        for i in range(min(max_results, 5)):
            # Generate deterministic PMID from query hash + index
            pmid_base = int(query_hash[:8], 16) % 90000000 + 10000000
            pmid = f"{pmid_base + i}"
            record = LiteratureRecord(
                record_id=f"pubmed_{i}_{query_hash[:8]}",
                source_type=SourceType.PUBMED,
                title=f"Research on {query} - Study {i + 1}",
                abstract=f"This study investigates {query} in the context of biomedical research. "
                f"Our findings suggest significant implications for understanding {query}.",
                authors=[f"Author {j}" for j in range(1, 4)],
                publication_date=date(2024, 1, i + 1),
                journal="Journal of Biomedical Research",
                pmid=pmid,
                keywords=[query, "biomedical", "research"],
                citations=10 * (i + 1),
                url=f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/",
            )
            records.append(record)

        return records

    async def fetch(self, record_id: str) -> LiteratureRecord | None:
        """Fetch a specific PubMed record."""
        # Mock implementation
        if record_id.startswith("pubmed_"):
            return LiteratureRecord(
                record_id=record_id,
                source_type=SourceType.PUBMED,
                title=f"Article {record_id}",
                abstract="Abstract content...",
                publication_date=date(2024, 1, 1),
            )
        return None

    async def fetch_batch(self, record_ids: list[str]) -> list[LiteratureRecord]:
        """Fetch multiple records."""
        results = []
        for rid in record_ids:
            record = await self.fetch(rid)
            if record:
                results.append(record)
        return results


class PatentSource(LiteratureSource):
    """Patent database source (USPTO, EPO, WIPO)."""

    class PatentOffice(str, Enum):
        USPTO = "uspto"
        EPO = "epo"
        WIPO = "wipo"
        ALL = "all"

    def __init__(self, offices: list[PatentOffice] | None = None, api_key: str | None = None):
        """
        Initialize patent source.

        Args:
            offices: Patent offices to search
            api_key: API key for patent databases
        """
        self.offices = offices or [self.PatentOffice.ALL]
        self.api_key = api_key

    @property
    def source_type(self) -> SourceType:
        return SourceType.PATENT

    async def search(
        self,
        query: str,
        max_results: int = 100,
        date_from: date | None = None,
        date_to: date | None = None,
        patent_type: str | None = None,  # utility, design, plant
        **kwargs,
    ) -> list[LiteratureRecord]:
        """
        Search patent databases.

        Args:
            query: Search query
            max_results: Maximum results
            date_from: Filing date start
            date_to: Filing date end
            patent_type: Type of patent

        Returns:
            List of LiteratureRecords
        """
        logger.info(f"Patent search: {query}, offices={self.offices}")

        # Mock results - use query hash for deterministic patent numbers
        query_hash = hashlib.md5(query.encode()).hexdigest()
        records = []
        for i in range(min(max_results, 3)):
            # Generate deterministic patent number from query hash + index
            patent_base = int(query_hash[:8], 16) % 9000000 + 11000000
            patent_num = f"US{patent_base + i}"
            record = LiteratureRecord(
                record_id=f"patent_{i}_{query_hash[:8]}",
                source_type=SourceType.PATENT,
                title=f"Method and composition for {query}",
                abstract=f"This invention relates to novel methods and compositions "
                f"for {query} in therapeutic applications.",
                authors=[f"Inventor {j}" for j in range(1, 3)],
                publication_date=date(2024, 6, i + 1),
                patent_number=patent_num,
                keywords=[query, "therapeutic", "composition"],
                url=f"https://patents.google.com/patent/{patent_num}",
                metadata={
                    "assignee": f"Pharma Corp {i + 1}",
                    "filing_date": "2023-01-15",
                    "patent_type": "utility",
                    "claims_count": 20 + i,
                },
            )
            records.append(record)

        return records

    async def fetch(self, record_id: str) -> LiteratureRecord | None:
        """Fetch a specific patent."""
        if record_id.startswith("patent_"):
            return LiteratureRecord(
                record_id=record_id,
                source_type=SourceType.PATENT,
                title=f"Patent {record_id}",
                abstract="Patent abstract...",
                publication_date=date(2024, 1, 1),
                metadata={"patent_type": "utility"},
            )
        return None

    async def fetch_batch(self, record_ids: list[str]) -> list[LiteratureRecord]:
        """Fetch multiple patents."""
        results = []
        for rid in record_ids:
            record = await self.fetch(rid)
            if record:
                results.append(record)
        return results


class ClinicalTrialsSource(LiteratureSource):
    """ClinicalTrials.gov source."""

    BASE_URL = "https://clinicaltrials.gov/api/v2"

    def __init__(self, include_results: bool = True, include_terminated: bool = False):
        """
        Initialize ClinicalTrials.gov source.

        Args:
            include_results: Include trials with results
            include_terminated: Include terminated trials
        """
        self.include_results = include_results
        self.include_terminated = include_terminated

    @property
    def source_type(self) -> SourceType:
        return SourceType.CLINICAL_TRIAL

    async def search(
        self,
        query: str,
        max_results: int = 100,
        status: list[str] | None = None,  # recruiting, completed, etc.
        phase: list[str] | None = None,  # Phase 1, Phase 2, etc.
        **kwargs,
    ) -> list[LiteratureRecord]:
        """
        Search ClinicalTrials.gov.

        Args:
            query: Search query (condition, intervention, etc.)
            max_results: Maximum results
            status: Trial status filter
            phase: Phase filter

        Returns:
            List of LiteratureRecords
        """
        logger.info(f"ClinicalTrials.gov search: {query}")

        # Mock results - use query hash for deterministic NCT IDs
        query_hash = hashlib.md5(query.encode()).hexdigest()
        records = []
        phases = ["Phase 1", "Phase 2", "Phase 3"]
        statuses = ["Recruiting", "Completed", "Active, not recruiting"]

        for i in range(min(max_results, 4)):
            # Generate deterministic NCT ID from query hash + index
            nct_base = int(query_hash[:8], 16) % 9000000 + 1000000
            nct_id = f"NCT{nct_base + i:08d}"
            record = LiteratureRecord(
                record_id=f"ct_{i}_{query_hash[:8]}",
                source_type=SourceType.CLINICAL_TRIAL,
                title=f"A Study of {query} in Adult Patients",
                abstract=f"This is a {phases[i % 3]} clinical trial evaluating {query} "
                f"for treatment of relevant conditions.",
                authors=["Principal Investigator"],
                publication_date=date(2024, 3, i + 1),
                nct_id=nct_id,
                keywords=[query, "clinical trial", phases[i % 3]],
                url=f"https://clinicaltrials.gov/study/{nct_id}",
                metadata={
                    "phase": phases[i % 3],
                    "status": statuses[i % 3],
                    "enrollment": 100 + i * 50,
                    "sponsor": f"Research Institution {i + 1}",
                    "primary_outcome": "Efficacy endpoint",
                },
            )
            records.append(record)

        return records

    async def fetch(self, record_id: str) -> LiteratureRecord | None:
        """Fetch a specific clinical trial."""
        if record_id.startswith("ct_") or record_id.startswith("NCT"):
            return LiteratureRecord(
                record_id=record_id,
                source_type=SourceType.CLINICAL_TRIAL,
                title=f"Clinical Trial {record_id}",
                abstract="Trial description...",
                nct_id=record_id if record_id.startswith("NCT") else None,
            )
        return None

    async def fetch_batch(self, record_ids: list[str]) -> list[LiteratureRecord]:
        """Fetch multiple trials."""
        results = []
        for rid in record_ids:
            record = await self.fetch(rid)
            if record:
                results.append(record)
        return results


class PrePrintSource(LiteratureSource):
    """bioRxiv/medRxiv preprint source."""

    def __init__(
        self,
        servers: list[str] | None = None,  # biorxiv, medrxiv
    ):
        """
        Initialize preprint source.

        Args:
            servers: Preprint servers to search
        """
        self.servers = servers or ["biorxiv", "medrxiv"]

    @property
    def source_type(self) -> SourceType:
        return SourceType.PREPRINT

    async def search(
        self,
        query: str,
        max_results: int = 100,
        date_from: date | None = None,
        date_to: date | None = None,
        **kwargs,
    ) -> list[LiteratureRecord]:
        """
        Search preprint servers.

        Args:
            query: Search query
            max_results: Maximum results
            date_from: Start date
            date_to: End date

        Returns:
            List of LiteratureRecords
        """
        logger.info(f"Preprint search: {query}, servers={self.servers}")

        # Mock results - use query hash for deterministic DOIs and URLs
        query_hash = hashlib.md5(query.encode()).hexdigest()
        records = []
        for i in range(min(max_results, 3)):
            server = self.servers[i % len(self.servers)]
            # Generate deterministic DOI from query hash + index
            doi_base = int(query_hash[:8], 16) % 900000 + 100000
            doi = f"10.1101/2024.01.01.{doi_base + i}"
            record = LiteratureRecord(
                record_id=f"preprint_{i}_{query_hash[:8]}",
                source_type=SourceType.PREPRINT,
                title=f"Preprint: Novel findings on {query}",
                abstract=f"We report preliminary findings regarding {query}. "
                f"This preprint has not yet been peer-reviewed.",
                authors=[f"Author {j}" for j in range(1, 5)],
                publication_date=date(2024, 11, i + 1),
                doi=doi,
                keywords=[query, "preprint", server],
                url=f"https://www.{server}.org/content/{doi}",
                journal=server,
                metadata={"server": server, "version": 1, "peer_reviewed": False},
            )
            records.append(record)

        return records

    async def fetch(self, record_id: str) -> LiteratureRecord | None:
        """Fetch a specific preprint."""
        if record_id.startswith("preprint_"):
            return LiteratureRecord(
                record_id=record_id,
                source_type=SourceType.PREPRINT,
                title=f"Preprint {record_id}",
                abstract="Preprint abstract...",
                metadata={"peer_reviewed": False},
            )
        return None

    async def fetch_batch(self, record_ids: list[str]) -> list[LiteratureRecord]:
        """Fetch multiple preprints."""
        results = []
        for rid in record_ids:
            record = await self.fetch(rid)
            if record:
                results.append(record)
        return results


# Factory function
def create_source(source_type: SourceType, **kwargs) -> LiteratureSource:
    """
    Create a literature source.

    Args:
        source_type: Type of source
        **kwargs: Source-specific arguments

    Returns:
        LiteratureSource instance
    """
    sources = {
        SourceType.PUBMED: PubMedSource,
        SourceType.PATENT: PatentSource,
        SourceType.CLINICAL_TRIAL: ClinicalTrialsSource,
        SourceType.PREPRINT: PrePrintSource,
    }

    source_class = sources.get(source_type)
    if source_class:
        return source_class(**kwargs)

    raise ValueError(f"Unknown source type: {source_type}")
