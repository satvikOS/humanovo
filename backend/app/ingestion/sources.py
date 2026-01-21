"""
Data Sources Module

Connectors for various biomedical data sources.
"""

from abc import ABC, abstractmethod
from datetime import datetime, timedelta
from typing import Any, AsyncIterator, Dict, List, Optional

import httpx
from pydantic import BaseModel

from app.core.config import settings
from app.core.logging import get_logger, LoggerMixin

logger = get_logger(__name__)


class DataRecord(BaseModel):
    """A single record from a data source."""

    source: str
    source_id: str
    title: str
    content: str
    abstract: Optional[str] = None
    authors: List[str] = []
    publication_date: Optional[datetime] = None
    url: Optional[str] = None
    metadata: Dict[str, Any] = {}


class DataSource(ABC, LoggerMixin):
    """Base class for data sources."""

    name: str = "base"

    def __init__(self):
        self.http_client = httpx.AsyncClient(timeout=30.0)

    @abstractmethod
    async def fetch(
        self,
        query: str,
        max_results: int = 100,
        date_from: Optional[datetime] = None,
        date_to: Optional[datetime] = None,
    ) -> List[DataRecord]:
        """Fetch records from the data source."""
        pass

    async def stream(
        self,
        query: str,
        batch_size: int = 100,
    ) -> AsyncIterator[DataRecord]:
        """Stream records from the data source."""
        records = await self.fetch(query, max_results=batch_size)
        for record in records:
            yield record

    async def close(self):
        """Close the HTTP client."""
        await self.http_client.aclose()


class PubMedSource(DataSource):
    """PubMed/NCBI data source."""

    name = "pubmed"

    def __init__(self):
        super().__init__()
        self.base_url = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
        self.email = settings.PUBMED_EMAIL

    async def fetch(
        self,
        query: str,
        max_results: int = 100,
        date_from: Optional[datetime] = None,
        date_to: Optional[datetime] = None,
    ) -> List[DataRecord]:
        """Fetch articles from PubMed."""
        self.logger.info("Fetching from PubMed", query=query[:50], max_results=max_results)

        # Build search parameters
        params = {
            "db": "pubmed",
            "term": query,
            "retmax": max_results,
            "retmode": "json",
            "email": self.email,
            "usehistory": "y",
        }

        if settings.PUBMED_API_KEY:
            params["api_key"] = settings.PUBMED_API_KEY.get_secret_value()

        # Add date filters
        if date_from:
            params["mindate"] = date_from.strftime("%Y/%m/%d")
        if date_to:
            params["maxdate"] = date_to.strftime("%Y/%m/%d")
        if date_from or date_to:
            params["datetype"] = "pdat"

        try:
            # Search for PMIDs
            search_url = f"{self.base_url}/esearch.fcgi"
            response = await self.http_client.get(search_url, params=params)
            response.raise_for_status()
            search_data = response.json()

            id_list = search_data.get("esearchresult", {}).get("idlist", [])
            if not id_list:
                return []

            # Fetch article details
            records = await self._fetch_article_details(id_list)

            self.logger.info("PubMed fetch complete", count=len(records))
            return records

        except Exception as e:
            self.logger.error("PubMed fetch failed", error=str(e))
            return []

    async def _fetch_article_details(
        self,
        pmids: List[str],
    ) -> List[DataRecord]:
        """Fetch detailed information for articles."""
        records = []

        # Fetch in batches of 200
        batch_size = 200
        for i in range(0, len(pmids), batch_size):
            batch = pmids[i:i + batch_size]

            params = {
                "db": "pubmed",
                "id": ",".join(batch),
                "retmode": "json",
                "email": self.email,
            }

            if settings.PUBMED_API_KEY:
                params["api_key"] = settings.PUBMED_API_KEY.get_secret_value()

            # Get summaries
            summary_url = f"{self.base_url}/esummary.fcgi"
            response = await self.http_client.get(summary_url, params=params)
            response.raise_for_status()
            summary_data = response.json()

            # Get abstracts
            fetch_params = {
                "db": "pubmed",
                "id": ",".join(batch),
                "rettype": "abstract",
                "retmode": "text",
                "email": self.email,
            }
            if settings.PUBMED_API_KEY:
                fetch_params["api_key"] = settings.PUBMED_API_KEY.get_secret_value()

            fetch_url = f"{self.base_url}/efetch.fcgi"
            abstract_response = await self.http_client.get(fetch_url, params=fetch_params)
            abstract_text = abstract_response.text

            # Parse results
            result_data = summary_data.get("result", {})
            for pmid in batch:
                if pmid == "uids" or pmid not in result_data:
                    continue

                article = result_data[pmid]
                title = article.get("title", "")
                authors = [a.get("name", "") for a in article.get("authors", [])]
                source = article.get("source", "")
                pub_date_str = article.get("pubdate", "")

                # Parse publication date
                pub_date = None
                try:
                    if pub_date_str:
                        # Handle various date formats
                        for fmt in ["%Y %b %d", "%Y %b", "%Y"]:
                            try:
                                pub_date = datetime.strptime(pub_date_str[:len(fmt.replace("%", ""))], fmt)
                                break
                            except ValueError:
                                continue
                except Exception:
                    pass

                records.append(
                    DataRecord(
                        source=self.name,
                        source_id=pmid,
                        title=title,
                        content=title,  # Will be enriched with full text if available
                        abstract=None,  # Would need additional fetch
                        authors=authors,
                        publication_date=pub_date,
                        url=f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/",
                        metadata={
                            "journal": source,
                            "pmid": pmid,
                        },
                    )
                )

        return records


class ClinicalTrialsSource(DataSource):
    """ClinicalTrials.gov data source."""

    name = "clinical_trials"

    def __init__(self):
        super().__init__()
        self.base_url = "https://clinicaltrials.gov/api/v2/studies"

    async def fetch(
        self,
        query: str,
        max_results: int = 100,
        date_from: Optional[datetime] = None,
        date_to: Optional[datetime] = None,
    ) -> List[DataRecord]:
        """Fetch trials from ClinicalTrials.gov."""
        self.logger.info("Fetching from ClinicalTrials.gov", query=query[:50])

        params = {
            "query.term": query,
            "pageSize": min(max_results, 100),
            "format": "json",
        }

        # Add date filters
        if date_from:
            params["filter.advanced"] = f"AREA[StartDate]RANGE[{date_from.strftime('%m/%d/%Y')},MAX]"

        try:
            response = await self.http_client.get(self.base_url, params=params)
            response.raise_for_status()
            data = response.json()

            records = []
            for study in data.get("studies", []):
                protocol = study.get("protocolSection", {})
                id_module = protocol.get("identificationModule", {})
                status_module = protocol.get("statusModule", {})
                desc_module = protocol.get("descriptionModule", {})
                contacts_module = protocol.get("contactsLocationsModule", {})

                nct_id = id_module.get("nctId", "")
                title = id_module.get("officialTitle", id_module.get("briefTitle", ""))
                brief_summary = desc_module.get("briefSummary", "")
                detailed_description = desc_module.get("detailedDescription", "")
                status = status_module.get("overallStatus", "")

                # Get investigators as "authors"
                investigators = []
                for contact in contacts_module.get("overallOfficials", []):
                    name = contact.get("name", "")
                    if name:
                        investigators.append(name)

                # Parse start date
                start_date = None
                start_date_struct = status_module.get("startDateStruct", {})
                if start_date_struct:
                    try:
                        date_str = start_date_struct.get("date", "")
                        start_date = datetime.strptime(date_str, "%Y-%m-%d")
                    except ValueError:
                        pass

                content = f"{title}\n\n{brief_summary}\n\n{detailed_description}"

                records.append(
                    DataRecord(
                        source=self.name,
                        source_id=nct_id,
                        title=title,
                        content=content,
                        abstract=brief_summary,
                        authors=investigators,
                        publication_date=start_date,
                        url=f"https://clinicaltrials.gov/study/{nct_id}",
                        metadata={
                            "nct_id": nct_id,
                            "status": status,
                            "phase": protocol.get("designModule", {}).get("phases", []),
                        },
                    )
                )

            self.logger.info("ClinicalTrials fetch complete", count=len(records))
            return records

        except Exception as e:
            self.logger.error("ClinicalTrials fetch failed", error=str(e))
            return []


class DrugBankSource(DataSource):
    """DrugBank data source (requires API key)."""

    name = "drugbank"

    async def fetch(
        self,
        query: str,
        max_results: int = 100,
        **kwargs,
    ) -> List[DataRecord]:
        """Fetch drug information.

        Note: Actual implementation would require DrugBank API access.
        """
        self.logger.info("DrugBank source not fully implemented")
        return []


class ReactomeSource(DataSource):
    """Reactome pathway database source."""

    name = "reactome"

    def __init__(self):
        super().__init__()
        self.base_url = "https://reactome.org/ContentService"

    async def fetch(
        self,
        query: str,
        max_results: int = 100,
        **kwargs,
    ) -> List[DataRecord]:
        """Fetch pathway information from Reactome."""
        self.logger.info("Fetching from Reactome", query=query[:50])

        try:
            # Search for pathways
            search_url = f"{self.base_url}/search/query"
            params = {
                "query": query,
                "species": "Homo sapiens",
                "types": "Pathway",
                "cluster": "true",
            }

            response = await self.http_client.get(search_url, params=params)
            response.raise_for_status()
            data = response.json()

            records = []
            for result in data.get("results", [])[:max_results]:
                for entry in result.get("entries", []):
                    st_id = entry.get("stId", "")
                    name = entry.get("name", "")
                    summary = entry.get("summation", [""])[0] if entry.get("summation") else ""

                    records.append(
                        DataRecord(
                            source=self.name,
                            source_id=st_id,
                            title=name,
                            content=f"{name}\n\n{summary}",
                            abstract=summary,
                            url=f"https://reactome.org/content/detail/{st_id}",
                            metadata={
                                "reactome_id": st_id,
                                "species": "Homo sapiens",
                            },
                        )
                    )

            self.logger.info("Reactome fetch complete", count=len(records))
            return records

        except Exception as e:
            self.logger.error("Reactome fetch failed", error=str(e))
            return []


def get_source(source_name: str) -> DataSource:
    """Get a data source by name."""
    sources = {
        "pubmed": PubMedSource,
        "clinical_trials": ClinicalTrialsSource,
        "drugbank": DrugBankSource,
        "reactome": ReactomeSource,
    }

    source_class = sources.get(source_name)
    if source_class is None:
        raise ValueError(f"Unknown data source: {source_name}")

    return source_class()
