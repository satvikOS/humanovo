"""
PubMed Ingestion Agent

Specialized agent for ingesting biomedical literature from PubMed/MEDLINE
using NCBI E-utilities API.

HTTP transport: httpx (via the SSRF-allowlisted factory in
app.core.http_allowlist). Migrated from aiohttp in Sprint 1 / D7
follow-up so every outbound request from this agent goes through the
host-allowlist check before hitting the network.
"""

import hashlib
import xml.etree.ElementTree as ET
from datetime import date, datetime
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


class PubMedConfig(IngestionConfig):
    """Configuration specific to PubMed ingestion."""

    # NCBI API settings
    api_key: str | None = None
    email: str | None = None  # Required by NCBI

    # PubMed-specific filters
    publication_types: list[str] = []  # e.g., ["Journal Article", "Review"]
    mesh_terms: list[str] = []
    journals: list[str] = []

    # Date range
    date_type: str = "pdat"  # pdat (publication), edat (entrez), mdat (modification)

    # Sorting
    sort: str = "relevance"  # relevance, pub_date, first_author

    # Full text options
    fetch_pmc_text: bool = False  # Fetch full text from PMC if available


class PubMedIngestionAgent(IngestionAgent):
    """
    Agent for ingesting literature from PubMed/MEDLINE.

    Uses NCBI E-utilities API:
    - ESearch: Search and retrieve PMIDs
    - EFetch: Fetch article details
    - ELink: Find related articles
    """

    source_type = SourceType.PUBMED
    description = "PubMed/MEDLINE literature ingestion agent"

    EUTILS_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
    PMC_OA_BASE = "https://www.ncbi.nlm.nih.gov/pmc/oai/oai.cgi"

    def __init__(
        self,
        config: PubMedConfig | None = None,
        **kwargs,
    ):
        config = config or PubMedConfig()
        super().__init__(config=config, **kwargs)
        self.pubmed_config: PubMedConfig = config
        self._client: httpx.AsyncClient | None = None

    async def _get_session(self) -> httpx.AsyncClient:
        """Get or create the SSRF-allowlisted httpx client."""
        if self._client is None:
            self._client = make_httpx_client(timeout=30.0, follow_redirects=True)
        return self._client

    async def _close_session(self) -> None:
        """Close the httpx client."""
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    def _build_search_params(
        self,
        query: str,
        retstart: int = 0,
        retmax: int = 100,
    ) -> dict[str, str]:
        """Build ESearch parameters."""
        params = {
            "db": "pubmed",
            "term": query,
            "retstart": str(retstart),
            "retmax": str(retmax),
            "retmode": "json",
            "usehistory": "y",
        }

        # Add API key and email if provided
        if self.pubmed_config.api_key:
            params["api_key"] = self.pubmed_config.api_key
        if self.pubmed_config.email:
            params["email"] = self.pubmed_config.email

        # Add date range
        if self.pubmed_config.date_from:
            params["mindate"] = self.pubmed_config.date_from.strftime("%Y/%m/%d")
        if self.pubmed_config.date_to:
            params["maxdate"] = self.pubmed_config.date_to.strftime("%Y/%m/%d")
        if self.pubmed_config.date_from or self.pubmed_config.date_to:
            params["datetype"] = self.pubmed_config.date_type

        # Add sorting
        if self.pubmed_config.sort == "pub_date":
            params["sort"] = "pub_date"
        elif self.pubmed_config.sort == "first_author":
            params["sort"] = "first_author"

        return params

    async def _esearch(
        self,
        query: str,
        retstart: int = 0,
        retmax: int = 100,
    ) -> tuple[list[str], int, str | None, str | None]:
        """
        Execute ESearch to find PMIDs.

        Returns:
            Tuple of (pmids, total_count, webenv, query_key)
        """
        await self._rate_limit()
        session = await self._get_session()

        params = self._build_search_params(query, retstart, retmax)
        url = f"{self.EUTILS_BASE}/esearch.fcgi"

        try:
            response = await session.get(url, params=params)
            response.raise_for_status()
            data = response.json()

            result = data.get("esearchresult", {})
            pmids = result.get("idlist", [])
            total_count = int(result.get("count", 0))
            webenv = result.get("webenv")
            query_key = result.get("querykey")

            self.state.metrics.api_calls_made += 1

            return pmids, total_count, webenv, query_key

        except httpx.HTTPError as e:
            self.logger.error("ESearch failed", error=str(e))
            raise

    async def _efetch(
        self,
        pmids: list[str],
        webenv: str | None = None,
        query_key: str | None = None,
    ) -> list[dict[str, Any]]:
        """
        Execute EFetch to retrieve article details.

        Returns:
            List of article dictionaries
        """
        if not pmids and not (webenv and query_key):
            return []

        await self._rate_limit()
        session = await self._get_session()

        params = {
            "db": "pubmed",
            "retmode": "xml",
            "rettype": "abstract",
        }

        if webenv and query_key:
            params["WebEnv"] = webenv
            params["query_key"] = query_key
        else:
            params["id"] = ",".join(pmids)

        if self.pubmed_config.api_key:
            params["api_key"] = self.pubmed_config.api_key
        if self.pubmed_config.email:
            params["email"] = self.pubmed_config.email

        url = f"{self.EUTILS_BASE}/efetch.fcgi"

        try:
            response = await session.get(url, params=params)
            response.raise_for_status()
            xml_content = response.text

            self.state.metrics.api_calls_made += 1
            self.state.metrics.bytes_downloaded += len(xml_content.encode())

            return self._parse_pubmed_xml(xml_content)

        except httpx.HTTPError as e:
            self.logger.error("EFetch failed", error=str(e))
            raise

    def _parse_pubmed_xml(self, xml_content: str) -> list[dict[str, Any]]:
        """Parse PubMed XML response into article dictionaries."""
        articles = []

        try:
            root = ET.fromstring(xml_content)

            for article in root.findall(".//PubmedArticle"):
                article_data = self._parse_article(article)
                if article_data:
                    articles.append(article_data)

        except ET.ParseError as e:
            self.logger.error("XML parsing failed", error=str(e))

        return articles

    def _parse_article(self, article_elem: ET.Element) -> dict[str, Any] | None:
        """Parse a single PubmedArticle element."""
        try:
            medline = article_elem.find("MedlineCitation")
            if medline is None:
                return None

            # Get PMID
            pmid_elem = medline.find("PMID")
            pmid = pmid_elem.text if pmid_elem is not None else None
            if not pmid:
                return None

            # Get article details
            article = medline.find("Article")
            if article is None:
                return None

            # Title
            title_elem = article.find("ArticleTitle")
            title = title_elem.text if title_elem is not None else ""

            # Abstract
            abstract_elem = article.find("Abstract/AbstractText")
            abstract = ""
            if abstract_elem is not None:
                # Handle structured abstracts
                abstract_parts = article.findall("Abstract/AbstractText")
                abstract_texts = []
                for part in abstract_parts:
                    label = part.get("Label", "")
                    text = part.text or ""
                    if label:
                        abstract_texts.append(f"{label}: {text}")
                    else:
                        abstract_texts.append(text)
                abstract = " ".join(abstract_texts)

            # Authors
            authors = []
            author_list = article.find("AuthorList")
            if author_list is not None:
                for author in author_list.findall("Author"):
                    lastname = author.find("LastName")
                    forename = author.find("ForeName")
                    if lastname is not None:
                        name = lastname.text or ""
                        if forename is not None:
                            name = f"{forename.text} {name}"
                        authors.append(name)

            # Journal
            journal_elem = article.find("Journal/Title")
            journal = journal_elem.text if journal_elem is not None else None

            # Publication date
            pub_date = None
            pub_date_elem = article.find("Journal/JournalIssue/PubDate")
            if pub_date_elem is not None:
                year = pub_date_elem.find("Year")
                month = pub_date_elem.find("Month")
                day = pub_date_elem.find("Day")

                if year is not None:
                    try:
                        year_val = int(year.text)
                        month_val = self._parse_month(month.text) if month is not None else 1
                        day_val = int(day.text) if day is not None else 1
                        pub_date = date(year_val, month_val, day_val)
                    except (ValueError, TypeError):
                        pass

            # DOI
            doi = None
            article_ids = article_elem.find("PubmedData/ArticleIdList")
            if article_ids is not None:
                for id_elem in article_ids.findall("ArticleId"):
                    if id_elem.get("IdType") == "doi":
                        doi = id_elem.text
                        break

            # MeSH terms
            mesh_terms = []
            mesh_list = medline.find("MeshHeadingList")
            if mesh_list is not None:
                for mesh in mesh_list.findall("MeshHeading/DescriptorName"):
                    if mesh.text:
                        mesh_terms.append(mesh.text)

            # Keywords
            keywords = []
            keyword_list = medline.find("KeywordList")
            if keyword_list is not None:
                for kw in keyword_list.findall("Keyword"):
                    if kw.text:
                        keywords.append(kw.text)

            # Publication types
            pub_types = []
            pub_type_list = article.find("PublicationTypeList")
            if pub_type_list is not None:
                for pt in pub_type_list.findall("PublicationType"):
                    if pt.text:
                        pub_types.append(pt.text)

            # PMC ID (for full text)
            pmc_id = None
            if article_ids is not None:
                for id_elem in article_ids.findall("ArticleId"):
                    if id_elem.get("IdType") == "pmc":
                        pmc_id = id_elem.text
                        break

            return {
                "pmid": pmid,
                "title": title,
                "abstract": abstract,
                "authors": authors,
                "journal": journal,
                "publication_date": pub_date,
                "doi": doi,
                "mesh_terms": mesh_terms,
                "keywords": keywords,
                "publication_types": pub_types,
                "pmc_id": pmc_id,
            }

        except Exception as e:
            self.logger.warning("Failed to parse article", error=str(e))
            return None

    def _parse_month(self, month_str: str) -> int:
        """Parse month string to integer."""
        if not month_str:
            return 1

        month_map = {
            "jan": 1,
            "feb": 2,
            "mar": 3,
            "apr": 4,
            "may": 5,
            "jun": 6,
            "jul": 7,
            "aug": 8,
            "sep": 9,
            "oct": 10,
            "nov": 11,
            "dec": 12,
        }

        try:
            return int(month_str)
        except ValueError:
            return month_map.get(month_str.lower()[:3], 1)

    def _article_to_record(
        self,
        article: dict[str, Any],
    ) -> IngestionRecord:
        """Convert article dictionary to IngestionRecord."""
        pmid = article["pmid"]
        query_hash = hashlib.md5(self.config.query.encode()).hexdigest()[:8]

        return IngestionRecord(
            record_id=f"pubmed_{pmid}_{query_hash}",
            source_type=SourceType.PUBMED,
            source_id=pmid,
            title=article.get("title", ""),
            abstract=article.get("abstract"),
            authors=article.get("authors", []),
            publication_date=datetime.combine(article["publication_date"], datetime.min.time())
            if article.get("publication_date")
            else None,
            url=f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/",
            doi=article.get("doi"),
            keywords=article.get("keywords", []) + article.get("mesh_terms", []),
            metadata={
                "pmid": pmid,
                "journal": article.get("journal"),
                "mesh_terms": article.get("mesh_terms", []),
                "publication_types": article.get("publication_types", []),
                "pmc_id": article.get("pmc_id"),
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
        Fetch a batch of PubMed records.

        Args:
            query: PubMed search query
            offset: Starting offset
            limit: Maximum records to fetch

        Returns:
            Tuple of (records, next_cursor)
        """
        # Build enhanced query with filters
        enhanced_query = self._build_query(query)

        # Search for PMIDs
        pmids, total_count, webenv, query_key = await self._esearch(
            enhanced_query,
            retstart=offset,
            retmax=limit,
        )

        if not pmids:
            return [], None

        self.logger.info(
            "ESearch results",
            pmids_found=len(pmids),
            total_count=total_count,
            offset=offset,
        )

        # Fetch article details
        articles = await self._efetch(pmids, webenv, query_key)

        # Convert to records
        records = [self._article_to_record(a) for a in articles]

        # Determine next cursor
        next_offset = offset + len(pmids)
        next_cursor = str(next_offset) if next_offset < total_count else None

        return records, next_cursor

    async def fetch_by_id(self, source_id: str) -> IngestionRecord | None:
        """
        Fetch a specific PubMed article by PMID.

        Args:
            source_id: PubMed ID (PMID)

        Returns:
            IngestionRecord or None
        """
        # Clean PMID
        pmid = source_id.replace("PMID:", "").strip()

        articles = await self._efetch([pmid])
        if articles:
            return self._article_to_record(articles[0])

        return None

    def _build_query(self, base_query: str) -> str:
        """Build enhanced query with PubMed-specific filters."""
        query_parts = [base_query]

        # Add publication type filters
        if self.pubmed_config.publication_types:
            pt_filter = " OR ".join(
                f'"{pt}"[Publication Type]' for pt in self.pubmed_config.publication_types
            )
            query_parts.append(f"({pt_filter})")

        # Add MeSH term filters
        if self.pubmed_config.mesh_terms:
            mesh_filter = " OR ".join(
                f'"{term}"[MeSH Terms]' for term in self.pubmed_config.mesh_terms
            )
            query_parts.append(f"({mesh_filter})")

        # Add journal filters
        if self.pubmed_config.journals:
            journal_filter = " OR ".join(f'"{j}"[Journal]' for j in self.pubmed_config.journals)
            query_parts.append(f"({journal_filter})")

        # Add language filter
        if self.pubmed_config.language_filter:
            lang_filter = " OR ".join(
                f"{lang}[Language]" for lang in self.pubmed_config.language_filter
            )
            query_parts.append(f"({lang_filter})")

        return " AND ".join(query_parts)

    async def fetch_related(
        self,
        pmid: str,
        max_results: int = 20,
    ) -> list[IngestionRecord]:
        """
        Fetch articles related to a given PMID using ELink.

        Args:
            pmid: Source PMID
            max_results: Maximum related articles to fetch

        Returns:
            List of related IngestionRecords
        """
        await self._rate_limit()
        session = await self._get_session()

        params = {
            "dbfrom": "pubmed",
            "db": "pubmed",
            "id": pmid,
            "cmd": "neighbor_score",
            "retmode": "json",
        }

        if self.pubmed_config.api_key:
            params["api_key"] = self.pubmed_config.api_key

        url = f"{self.EUTILS_BASE}/elink.fcgi"

        try:
            response = await session.get(url, params=params)
            response.raise_for_status()
            data = response.json()

            self.state.metrics.api_calls_made += 1

            # Extract related PMIDs
            related_pmids = []
            linksets = data.get("linksets", [])
            for linkset in linksets:
                linksetdbs = linkset.get("linksetdbs", [])
                for db in linksetdbs:
                    if db.get("linkname") == "pubmed_pubmed":
                        links = db.get("links", [])
                        related_pmids.extend(links[:max_results])

            if not related_pmids:
                return []

            # Fetch article details
            articles = await self._efetch(related_pmids[:max_results])
            return [self._article_to_record(a) for a in articles]

        except httpx.HTTPError as e:
            self.logger.error("ELink failed", error=str(e))
            return []

    async def fetch_citations(
        self,
        pmid: str,
        max_results: int = 50,
    ) -> list[IngestionRecord]:
        """
        Fetch articles that cite a given PMID.

        Args:
            pmid: Source PMID
            max_results: Maximum citing articles to fetch

        Returns:
            List of citing IngestionRecords
        """
        await self._rate_limit()
        session = await self._get_session()

        params = {
            "dbfrom": "pubmed",
            "db": "pubmed",
            "id": pmid,
            "linkname": "pubmed_pubmed_citedin",
            "retmode": "json",
        }

        if self.pubmed_config.api_key:
            params["api_key"] = self.pubmed_config.api_key

        url = f"{self.EUTILS_BASE}/elink.fcgi"

        try:
            response = await session.get(url, params=params)
            response.raise_for_status()
            data = response.json()

            self.state.metrics.api_calls_made += 1

            # Extract citing PMIDs
            citing_pmids = []
            linksets = data.get("linksets", [])
            for linkset in linksets:
                linksetdbs = linkset.get("linksetdbs", [])
                for db in linksetdbs:
                    if db.get("linkname") == "pubmed_pubmed_citedin":
                        links = db.get("links", [])
                        citing_pmids.extend(links[:max_results])

            if not citing_pmids:
                return []

            # Fetch article details
            articles = await self._efetch(citing_pmids[:max_results])
            return [self._article_to_record(a) for a in articles]

        except httpx.HTTPError as e:
            self.logger.error("ELink (citations) failed", error=str(e))
            return []

    async def close(self) -> None:
        """Close resources."""
        await self._close_session()
