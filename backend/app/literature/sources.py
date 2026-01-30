"""
Literature Source Connectors

Connectors for various biomedical literature sources:
- PubMed/MEDLINE
- Patent databases (USPTO, EPO, WIPO)
- ClinicalTrials.gov
- bioRxiv/medRxiv
- FDA/EMA documents
"""

import logging
import asyncio
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime, date
from enum import Enum
from typing import Dict, List, Optional, Any, AsyncIterator
import re
import hashlib

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
    abstract: Optional[str] = None
    full_text: Optional[str] = None
    authors: List[str] = field(default_factory=list)
    publication_date: Optional[date] = None
    journal: Optional[str] = None
    doi: Optional[str] = None
    pmid: Optional[str] = None
    patent_number: Optional[str] = None
    nct_id: Optional[str] = None  # ClinicalTrials.gov ID
    keywords: List[str] = field(default_factory=list)
    mesh_terms: List[str] = field(default_factory=list)
    citations: int = 0
    url: Optional[str] = None
    language: str = "en"
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "record_id": self.record_id,
            "source_type": self.source_type.value,
            "title": self.title,
            "abstract": self.abstract,
            "authors": self.authors,
            "publication_date": self.publication_date.isoformat() if self.publication_date else None,
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
            "metadata": self.metadata
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
    async def search(
        self,
        query: str,
        max_results: int = 100,
        **kwargs
    ) -> List[LiteratureRecord]:
        """Search for records."""
        pass

    @abstractmethod
    async def fetch(
        self,
        record_id: str
    ) -> Optional[LiteratureRecord]:
        """Fetch a specific record."""
        pass

    @abstractmethod
    async def fetch_batch(
        self,
        record_ids: List[str]
    ) -> List[LiteratureRecord]:
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
        api_key: Optional[str] = None,
        email: Optional[str] = None,
        rate_limit: float = 3.0  # requests per second
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
        date_from: Optional[date] = None,
        date_to: Optional[date] = None,
        **kwargs
    ) -> List[LiteratureRecord]:
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
        records = []
        for i in range(min(max_results, 5)):
            record = LiteratureRecord(
                record_id=f"pubmed_{i}_{hashlib.md5(query.encode()).hexdigest()[:8]}",
                source_type=SourceType.PUBMED,
                title=f"Research on {query} - Study {i+1}",
                abstract=f"This study investigates {query} in the context of biomedical research. "
                        f"Our findings suggest significant implications for understanding {query}.",
                authors=[f"Author {j}" for j in range(1, 4)],
                publication_date=date(2024, 1, i + 1),
                journal="Journal of Biomedical Research",
                pmid=f"3{i}000000",
                keywords=[query, "biomedical", "research"],
                citations=10 * (i + 1),
                url=f"https://pubmed.ncbi.nlm.nih.gov/3{i}000000/"
            )
            records.append(record)

        return records

    async def fetch(
        self,
        record_id: str
    ) -> Optional[LiteratureRecord]:
        """Fetch a specific PubMed record."""
        # Mock implementation
        if record_id.startswith("pubmed_"):
            return LiteratureRecord(
                record_id=record_id,
                source_type=SourceType.PUBMED,
                title=f"Article {record_id}",
                abstract="Abstract content...",
                publication_date=date(2024, 1, 1)
            )
        return None

    async def fetch_batch(
        self,
        record_ids: List[str]
    ) -> List[LiteratureRecord]:
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

    def __init__(
        self,
        offices: Optional[List[PatentOffice]] = None,
        api_key: Optional[str] = None
    ):
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
        date_from: Optional[date] = None,
        date_to: Optional[date] = None,
        patent_type: Optional[str] = None,  # utility, design, plant
        **kwargs
    ) -> List[LiteratureRecord]:
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

        # Mock results
        records = []
        for i in range(min(max_results, 3)):
            record = LiteratureRecord(
                record_id=f"patent_{i}_{hashlib.md5(query.encode()).hexdigest()[:8]}",
                source_type=SourceType.PATENT,
                title=f"Method and composition for {query}",
                abstract=f"This invention relates to novel methods and compositions "
                        f"for {query} in therapeutic applications.",
                authors=[f"Inventor {j}" for j in range(1, 3)],
                publication_date=date(2024, 6, i + 1),
                patent_number=f"US{11000000 + i}",
                keywords=[query, "therapeutic", "composition"],
                url=f"https://patents.google.com/patent/US{11000000 + i}",
                metadata={
                    "assignee": f"Pharma Corp {i+1}",
                    "filing_date": "2023-01-15",
                    "patent_type": "utility",
                    "claims_count": 20 + i
                }
            )
            records.append(record)

        return records

    async def fetch(
        self,
        record_id: str
    ) -> Optional[LiteratureRecord]:
        """Fetch a specific patent."""
        if record_id.startswith("patent_"):
            return LiteratureRecord(
                record_id=record_id,
                source_type=SourceType.PATENT,
                title=f"Patent {record_id}",
                abstract="Patent abstract...",
                publication_date=date(2024, 1, 1),
                metadata={"patent_type": "utility"}
            )
        return None

    async def fetch_batch(
        self,
        record_ids: List[str]
    ) -> List[LiteratureRecord]:
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

    def __init__(
        self,
        include_results: bool = True,
        include_terminated: bool = False
    ):
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
        status: Optional[List[str]] = None,  # recruiting, completed, etc.
        phase: Optional[List[str]] = None,  # Phase 1, Phase 2, etc.
        **kwargs
    ) -> List[LiteratureRecord]:
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

        # Mock results
        records = []
        phases = ["Phase 1", "Phase 2", "Phase 3"]
        statuses = ["Recruiting", "Completed", "Active, not recruiting"]

        for i in range(min(max_results, 4)):
            record = LiteratureRecord(
                record_id=f"ct_{i}_{hashlib.md5(query.encode()).hexdigest()[:8]}",
                source_type=SourceType.CLINICAL_TRIAL,
                title=f"A Study of {query} in Adult Patients",
                abstract=f"This is a {phases[i % 3]} clinical trial evaluating {query} "
                        f"for treatment of relevant conditions.",
                authors=["Principal Investigator"],
                publication_date=date(2024, 3, i + 1),
                nct_id=f"NCT0{5000000 + i}",
                keywords=[query, "clinical trial", phases[i % 3]],
                url=f"https://clinicaltrials.gov/study/NCT0{5000000 + i}",
                metadata={
                    "phase": phases[i % 3],
                    "status": statuses[i % 3],
                    "enrollment": 100 + i * 50,
                    "sponsor": f"Research Institution {i+1}",
                    "primary_outcome": "Efficacy endpoint"
                }
            )
            records.append(record)

        return records

    async def fetch(
        self,
        record_id: str
    ) -> Optional[LiteratureRecord]:
        """Fetch a specific clinical trial."""
        if record_id.startswith("ct_") or record_id.startswith("NCT"):
            return LiteratureRecord(
                record_id=record_id,
                source_type=SourceType.CLINICAL_TRIAL,
                title=f"Clinical Trial {record_id}",
                abstract="Trial description...",
                nct_id=record_id if record_id.startswith("NCT") else None
            )
        return None

    async def fetch_batch(
        self,
        record_ids: List[str]
    ) -> List[LiteratureRecord]:
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
        servers: Optional[List[str]] = None  # biorxiv, medrxiv
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
        date_from: Optional[date] = None,
        date_to: Optional[date] = None,
        **kwargs
    ) -> List[LiteratureRecord]:
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

        # Mock results
        records = []
        for i in range(min(max_results, 3)):
            server = self.servers[i % len(self.servers)]
            record = LiteratureRecord(
                record_id=f"preprint_{i}_{hashlib.md5(query.encode()).hexdigest()[:8]}",
                source_type=SourceType.PREPRINT,
                title=f"Preprint: Novel findings on {query}",
                abstract=f"We report preliminary findings regarding {query}. "
                        f"This preprint has not yet been peer-reviewed.",
                authors=[f"Author {j}" for j in range(1, 5)],
                publication_date=date(2024, 11, i + 1),
                doi=f"10.1101/2024.11.{i+1:02d}.{600000 + i}",
                keywords=[query, "preprint", server],
                url=f"https://www.{server}.org/content/10.1101/2024.11.{i+1:02d}.{600000 + i}",
                journal=server,
                metadata={
                    "server": server,
                    "version": 1,
                    "peer_reviewed": False
                }
            )
            records.append(record)

        return records

    async def fetch(
        self,
        record_id: str
    ) -> Optional[LiteratureRecord]:
        """Fetch a specific preprint."""
        if record_id.startswith("preprint_"):
            return LiteratureRecord(
                record_id=record_id,
                source_type=SourceType.PREPRINT,
                title=f"Preprint {record_id}",
                abstract="Preprint abstract...",
                metadata={"peer_reviewed": False}
            )
        return None

    async def fetch_batch(
        self,
        record_ids: List[str]
    ) -> List[LiteratureRecord]:
        """Fetch multiple preprints."""
        results = []
        for rid in record_ids:
            record = await self.fetch(rid)
            if record:
                results.append(record)
        return results


# Factory function
def create_source(
    source_type: SourceType,
    **kwargs
) -> LiteratureSource:
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
