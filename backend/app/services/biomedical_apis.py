"""
Extended Biomedical API Clients — Deep RAG Grounding

Integrates additional scientific data sources for maximum hypothesis grounding:
- Elsevier (Scopus + ScienceDirect) — Literature search with API key
- Springer Nature — Open access literature
- ChEBI — Chemical Entities of Biological Interest
- HCA (Human Cell Atlas) — Single-cell transcriptomics data
- Cell Ontology (CL) — Cell type ontology via OLS
- FMA (Foundational Model of Anatomy) — Anatomical ontology via OLS
- NCBI E-utilities extended — Gene, Protein, SNP databases
- KEGG extended — Disease, Drug, Compound entries

Rate limits respected:
- KEGG: 3 requests/sec
- Elsevier: 6 requests/sec
- Others: best-effort with backoff
"""

import asyncio
import time
from dataclasses import dataclass, field
from typing import Any, Optional

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)


# ======================== Elsevier (Scopus + ScienceDirect) ========================

@dataclass
class ScopusArticle:
    """An article from Elsevier Scopus."""
    scopus_id: str
    title: str
    authors: list[str]
    journal: str
    year: str
    doi: str = ""
    abstract: str = ""
    citation_count: int = 0
    keywords: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "scopus_id": self.scopus_id,
            "title": self.title,
            "authors": self.authors[:5],
            "journal": self.journal,
            "year": self.year,
            "doi": self.doi,
            "abstract": self.abstract[:500] if self.abstract else "",
            "citation_count": self.citation_count,
            "keywords": self.keywords[:10],
            "source": "Elsevier/Scopus",
        }

    def to_citation(self) -> str:
        author_str = ", ".join(self.authors[:3])
        if len(self.authors) > 3:
            author_str += " et al."
        doi_str = f" doi:{self.doi}" if self.doi else ""
        return f"{author_str} ({self.year}). {self.title}. {self.journal}.{doi_str}"


class ElsevierService:
    """
    Elsevier Scopus + ScienceDirect API client.

    Uses the Elsevier Developer APIs:
    - Scopus Search API for literature discovery
    - ScienceDirect Article Retrieval for full-text access
    - Abstract Retrieval for detailed metadata

    API docs: https://dev.elsevier.com/documentation/
    Rate limit: 6 requests/second per API key
    """

    SCOPUS_SEARCH_URL = "https://api.elsevier.com/content/search/scopus"
    SCOPUS_ABSTRACT_URL = "https://api.elsevier.com/content/abstract/scopus_id"
    SCIENCEDIRECT_SEARCH_URL = "https://api.elsevier.com/content/search/sciencedirect"

    def __init__(self, api_key: str = ""):
        self._api_key = api_key or getattr(settings, 'ELSEVIER_API_KEY', '')
        self._session = None
        self._last_request_time = 0.0
        self._rate_limit_delay = 0.17  # ~6 req/sec

    async def _get_session(self):
        if self._session is None:
            import aiohttp
            self._session = aiohttp.ClientSession()
        return self._session

    async def _rate_limit(self):
        elapsed = time.time() - self._last_request_time
        if elapsed < self._rate_limit_delay:
            await asyncio.sleep(self._rate_limit_delay - elapsed)
        self._last_request_time = time.time()

    def _headers(self) -> dict[str, str]:
        return {
            "X-ELS-APIKey": self._api_key,
            "Accept": "application/json",
        }

    async def search_scopus(
        self,
        query: str,
        max_results: int = 10,
        sort: str = "relevancy",
    ) -> list[ScopusArticle]:
        """
        Search Scopus for scientific literature.

        Args:
            query: Search query (supports Scopus query syntax)
            max_results: Maximum results to return
            sort: Sort order (relevancy, citedby-count, date)
        """
        if not self._api_key:
            logger.debug("Elsevier API key not configured")
            return []

        await self._rate_limit()
        session = await self._get_session()

        params = {
            "query": query,
            "count": str(min(max_results, 25)),
            "sort": sort,
            "field": "dc:title,dc:creator,prism:publicationName,prism:coverDate,prism:doi,dc:description,citedby-count,authkeywords",
        }

        try:
            async with session.get(
                self.SCOPUS_SEARCH_URL,
                params=params,
                headers=self._headers(),
            ) as resp:
                if resp.status == 429:
                    logger.warning("Elsevier rate limit hit, backing off")
                    await asyncio.sleep(2.0)
                    return []
                if resp.status != 200:
                    logger.warning(f"Scopus search failed: HTTP {resp.status}")
                    return []
                data = await resp.json()

            results = data.get("search-results", {}).get("entry", [])
            articles = []
            for entry in results:
                if entry.get("error"):
                    continue

                authors = []
                creator = entry.get("dc:creator", "")
                if creator:
                    authors = [creator]

                keywords = []
                authkeywords = entry.get("authkeywords", "")
                if authkeywords and isinstance(authkeywords, str):
                    keywords = [k.strip() for k in authkeywords.split("|")]

                year = ""
                cover_date = entry.get("prism:coverDate", "")
                if cover_date:
                    year = cover_date[:4]

                articles.append(ScopusArticle(
                    scopus_id=entry.get("dc:identifier", "").replace("SCOPUS_ID:", ""),
                    title=entry.get("dc:title", ""),
                    authors=authors,
                    journal=entry.get("prism:publicationName", ""),
                    year=year,
                    doi=entry.get("prism:doi", ""),
                    abstract=entry.get("dc:description", ""),
                    citation_count=int(entry.get("citedby-count", 0)),
                    keywords=keywords,
                ))

            logger.info(f"Scopus search '{query[:50]}...' returned {len(articles)} results")
            return articles

        except Exception as e:
            logger.warning(f"Scopus search failed: {e}")
            return []

    async def search_sciencedirect(
        self,
        query: str,
        max_results: int = 5,
    ) -> list[dict[str, Any]]:
        """Search ScienceDirect for full-text articles."""
        if not self._api_key:
            return []

        await self._rate_limit()
        session = await self._get_session()

        params = {
            "qs": query,
            "count": str(min(max_results, 25)),
            "display": "standard",
        }

        try:
            async with session.put(
                self.SCIENCEDIRECT_SEARCH_URL,
                json=params,
                headers=self._headers(),
            ) as resp:
                if resp.status != 200:
                    return []
                data = await resp.json()

            results = []
            for entry in data.get("search-results", {}).get("entry", []):
                results.append({
                    "title": entry.get("dc:title", ""),
                    "doi": entry.get("prism:doi", ""),
                    "journal": entry.get("prism:publicationName", ""),
                    "date": entry.get("prism:coverDate", ""),
                    "source": "ScienceDirect",
                })
            return results

        except Exception as e:
            logger.warning(f"ScienceDirect search failed: {e}")
            return []

    async def search_evidence(
        self,
        hypothesis_text: str,
        disease: str,
        max_articles: int = 5,
    ) -> list[ScopusArticle]:
        """Search Scopus for evidence relevant to a hypothesis."""
        import re
        stop_words = {
            "the", "a", "an", "is", "are", "was", "were", "be", "been",
            "have", "has", "had", "with", "from", "for", "of", "to", "in",
            "on", "at", "by", "as", "and", "or", "but", "not", "this",
            "that", "these", "those", "it", "its", "we", "our", "may",
        }
        words = re.findall(r'\b[a-zA-Z]{3,}\b', hypothesis_text.lower())
        key_terms = [w for w in words if w not in stop_words][:6]

        query = f"TITLE-ABS-KEY({disease}) AND TITLE-ABS-KEY({' AND '.join(key_terms[:3])})"
        articles = await self.search_scopus(query, max_results=max_articles)

        if not articles:
            # Fallback: simpler query
            query = f"TITLE-ABS-KEY({disease} {' '.join(key_terms[:2])})"
            articles = await self.search_scopus(query, max_results=max_articles)

        return articles

    async def close(self):
        if self._session:
            await self._session.close()
            self._session = None


# ======================== Springer Nature ========================

class SpringerService:
    """
    Springer Nature Open Access API client.

    Provides access to Springer Nature's open access content including
    journal articles, book chapters, and protocols.

    API docs: https://dev.springernature.com/
    """

    SPRINGER_API_BASE = "https://api.springernature.com"

    def __init__(self, api_key: str = ""):
        self._api_key = api_key or getattr(settings, 'SPRINGER_API_KEY', '')
        self._session = None

    async def _get_session(self):
        if self._session is None:
            import aiohttp
            self._session = aiohttp.ClientSession()
        return self._session

    async def search_open_access(
        self,
        query: str,
        max_results: int = 5,
    ) -> list[dict[str, Any]]:
        """
        Search Springer Nature open access articles.

        Args:
            query: Search query
            max_results: Maximum results
        """
        session = await self._get_session()

        params = {
            "q": query,
            "p": str(min(max_results, 50)),
            "api_key": self._api_key,
        }

        try:
            async with session.get(
                f"{self.SPRINGER_API_BASE}/openaccess/json",
                params=params,
            ) as resp:
                if resp.status != 200:
                    logger.debug(f"Springer search returned HTTP {resp.status}")
                    return []
                data = await resp.json()

            results = []
            for record in data.get("records", []):
                authors = []
                for creator in record.get("creators", []):
                    authors.append(creator.get("creator", ""))

                results.append({
                    "title": record.get("title", ""),
                    "authors": authors[:5],
                    "journal": record.get("publicationName", ""),
                    "doi": record.get("doi", ""),
                    "year": record.get("publicationDate", "")[:4] if record.get("publicationDate") else "",
                    "abstract": record.get("abstract", "")[:500],
                    "url": record.get("url", [{}])[0].get("value", "") if record.get("url") else "",
                    "source": "Springer Nature",
                })

            logger.info(f"Springer search '{query[:50]}...' returned {len(results)} results")
            return results

        except Exception as e:
            logger.warning(f"Springer search failed: {e}")
            return []

    async def search_meta(
        self,
        query: str,
        max_results: int = 5,
    ) -> list[dict[str, Any]]:
        """Search Springer metadata (broader coverage including non-OA)."""
        session = await self._get_session()

        params = {
            "q": query,
            "p": str(min(max_results, 50)),
            "api_key": self._api_key,
        }

        try:
            async with session.get(
                f"{self.SPRINGER_API_BASE}/meta/v2/json",
                params=params,
            ) as resp:
                if resp.status != 200:
                    return []
                data = await resp.json()

            results = []
            for record in data.get("records", []):
                results.append({
                    "title": record.get("title", ""),
                    "doi": record.get("doi", ""),
                    "journal": record.get("publicationName", ""),
                    "year": record.get("publicationDate", "")[:4] if record.get("publicationDate") else "",
                    "type": record.get("contentType", ""),
                    "source": "Springer Nature (meta)",
                })

            return results

        except Exception as e:
            logger.warning(f"Springer meta search failed: {e}")
            return []

    async def close(self):
        if self._session:
            await self._session.close()
            self._session = None


# ======================== ChEBI ========================

@dataclass
class ChEBIEntity:
    """A chemical entity from ChEBI."""
    chebi_id: str
    name: str
    definition: str = ""
    formula: str = ""
    mass: str = ""
    inchikey: str = ""
    synonyms: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "chebi_id": self.chebi_id,
            "name": self.name,
            "definition": self.definition[:300] if self.definition else "",
            "formula": self.formula,
            "mass": self.mass,
            "synonyms": self.synonyms[:5],
            "source": "ChEBI",
        }


class ChEBIService:
    """
    ChEBI (Chemical Entities of Biological Interest) API client.

    Uses the ChEBI Web Services and OLS (Ontology Lookup Service) for
    chemical entity information relevant to drug discovery and metabolism.

    API: https://www.ebi.ac.uk/chebi/webServices.do
    OLS: https://www.ebi.ac.uk/ols4/api
    """

    CHEBI_OLS_URL = "https://www.ebi.ac.uk/ols4/api/search"
    CHEBI_WS_URL = "https://www.ebi.ac.uk/webservices/chebi/2.0"

    def __init__(self):
        self._session = None

    async def _get_session(self):
        if self._session is None:
            import aiohttp
            self._session = aiohttp.ClientSession()
        return self._session

    async def search(
        self,
        query: str,
        max_results: int = 5,
    ) -> list[ChEBIEntity]:
        """Search ChEBI for chemical entities via OLS."""
        session = await self._get_session()

        params = {
            "q": query,
            "ontology": "chebi",
            "rows": str(max_results),
            "exact": "false",
        }

        try:
            async with session.get(self.CHEBI_OLS_URL, params=params) as resp:
                if resp.status != 200:
                    return []
                data = await resp.json()

            entities = []
            for doc in data.get("response", {}).get("docs", []):
                synonyms = doc.get("synonym", [])
                if isinstance(synonyms, str):
                    synonyms = [synonyms]

                entities.append(ChEBIEntity(
                    chebi_id=doc.get("obo_id", doc.get("short_form", "")),
                    name=doc.get("label", ""),
                    definition=doc.get("description", [""])[0] if doc.get("description") else "",
                    synonyms=synonyms[:5],
                ))

            logger.info(f"ChEBI search '{query[:40]}...' returned {len(entities)} results")
            return entities

        except Exception as e:
            logger.warning(f"ChEBI search failed: {e}")
            return []

    async def get_entity(self, chebi_id: str) -> Optional[ChEBIEntity]:
        """Get detailed ChEBI entity by ID."""
        session = await self._get_session()

        try:
            async with session.get(
                f"https://www.ebi.ac.uk/ols4/api/ontologies/chebi/terms",
                params={"obo_id": chebi_id},
            ) as resp:
                if resp.status != 200:
                    return None
                data = await resp.json()

            terms = data.get("_embedded", {}).get("terms", [])
            if not terms:
                return None

            term = terms[0]
            return ChEBIEntity(
                chebi_id=chebi_id,
                name=term.get("label", ""),
                definition=term.get("description", [""])[0] if term.get("description") else "",
                synonyms=term.get("synonyms", [])[:5],
            )

        except Exception as e:
            logger.warning(f"ChEBI entity fetch failed: {e}")
            return None

    async def close(self):
        if self._session:
            await self._session.close()
            self._session = None


# ======================== Human Cell Atlas (HCA) ========================

class HCAService:
    """
    Human Cell Atlas Data Portal API client (Azul Service).

    Provides access to single-cell genomics data including:
    - Project metadata (studies, datasets)
    - File manifests
    - Cell type annotations

    API: https://service.azul.data.humancellatlas.org/
    Swagger: https://service.azul.data.humancellatlas.org/swagger/index.html
    """

    HCA_API_BASE = "https://service.azul.data.humancellatlas.org"

    def __init__(self, client_id: str = ""):
        self._client_id = client_id or getattr(settings, 'HCA_CLIENT_ID', '')
        self._session = None

    async def _get_session(self):
        if self._session is None:
            import aiohttp
            self._session = aiohttp.ClientSession()
        return self._session

    async def search_projects(
        self,
        query: str,
        organ: str = "",
        disease: str = "",
        max_results: int = 5,
    ) -> list[dict[str, Any]]:
        """
        Search HCA projects (datasets) by keyword, organ, or disease.

        Args:
            query: Free-text search
            organ: Filter by organ (e.g., "brain", "liver")
            disease: Filter by disease
            max_results: Maximum results
        """
        session = await self._get_session()

        params = {
            "catalog": "dcp44",
            "size": str(max_results),
        }

        # Build filters
        filters = {}
        if organ:
            filters["organ"] = {"is": [organ]}
        if disease:
            filters["sampleDisease"] = {"is": [disease]}

        if filters:
            import json
            params["filters"] = json.dumps(filters)

        try:
            async with session.get(
                f"{self.HCA_API_BASE}/index/projects",
                params=params,
            ) as resp:
                if resp.status != 200:
                    logger.debug(f"HCA search returned HTTP {resp.status}")
                    return []
                data = await resp.json()

            results = []
            for hit in data.get("hits", []):
                projects = hit.get("projects", [{}])
                project = projects[0] if projects else {}

                specimens = hit.get("specimens", [{}])
                specimen = specimens[0] if specimens else {}

                cell_suspensions = hit.get("cellSuspensions", [{}])
                cell_susp = cell_suspensions[0] if cell_suspensions else {}

                results.append({
                    "project_title": project.get("projectTitle", ""),
                    "project_id": project.get("projectShortname", ""),
                    "organs": specimen.get("organ", []),
                    "diseases": specimen.get("disease", []),
                    "species": specimen.get("species", []),
                    "cell_count": cell_susp.get("totalCells", 0),
                    "library_construction": hit.get("protocols", [{}])[0].get("libraryConstructionApproach", []) if hit.get("protocols") else [],
                    "source": "Human Cell Atlas",
                })

            logger.info(f"HCA search '{query[:40]}...' returned {len(results)} results")
            return results

        except Exception as e:
            logger.warning(f"HCA search failed: {e}")
            return []

    async def get_project_detail(self, project_id: str) -> Optional[dict[str, Any]]:
        """Get detailed project information."""
        session = await self._get_session()

        try:
            async with session.get(
                f"{self.HCA_API_BASE}/index/projects/{project_id}",
                params={"catalog": "dcp44"},
            ) as resp:
                if resp.status != 200:
                    return None
                return await resp.json()

        except Exception as e:
            logger.warning(f"HCA project detail failed: {e}")
            return None

    async def close(self):
        if self._session:
            await self._session.close()
            self._session = None


# ======================== Cell Ontology (CL) via OLS ========================

@dataclass
class CellType:
    """A cell type from the Cell Ontology."""
    cl_id: str
    name: str
    definition: str = ""
    synonyms: list[str] = field(default_factory=list)
    parents: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "cl_id": self.cl_id,
            "name": self.name,
            "definition": self.definition[:300] if self.definition else "",
            "synonyms": self.synonyms[:5],
            "parents": self.parents[:3],
            "source": "Cell Ontology",
        }


class CellOntologyService:
    """
    Cell Ontology (CL) API client via OLS (Ontology Lookup Service).

    The Cell Ontology provides a structured controlled vocabulary for cell types.
    Used for grounding cell-type references in hypotheses.

    Source: https://github.com/obophenotype/cell-ontology
    API: https://www.ebi.ac.uk/ols4/api
    """

    OLS_URL = "https://www.ebi.ac.uk/ols4/api"

    def __init__(self):
        self._session = None

    async def _get_session(self):
        if self._session is None:
            import aiohttp
            self._session = aiohttp.ClientSession()
        return self._session

    async def search(
        self,
        query: str,
        max_results: int = 5,
    ) -> list[CellType]:
        """Search the Cell Ontology for cell types."""
        session = await self._get_session()

        params = {
            "q": query,
            "ontology": "cl",
            "rows": str(max_results),
            "exact": "false",
        }

        try:
            async with session.get(f"{self.OLS_URL}/search", params=params) as resp:
                if resp.status != 200:
                    return []
                data = await resp.json()

            cell_types = []
            for doc in data.get("response", {}).get("docs", []):
                synonyms = doc.get("synonym", [])
                if isinstance(synonyms, str):
                    synonyms = [synonyms]

                description = doc.get("description", [])
                definition = description[0] if isinstance(description, list) and description else ""

                cell_types.append(CellType(
                    cl_id=doc.get("obo_id", doc.get("short_form", "")),
                    name=doc.get("label", ""),
                    definition=definition,
                    synonyms=synonyms[:5],
                ))

            logger.info(f"Cell Ontology search '{query[:40]}...' returned {len(cell_types)} results")
            return cell_types

        except Exception as e:
            logger.warning(f"Cell Ontology search failed: {e}")
            return []

    async def get_cell_type(self, cl_id: str) -> Optional[CellType]:
        """Get a specific cell type by CL ID."""
        session = await self._get_session()

        try:
            async with session.get(
                f"{self.OLS_URL}/ontologies/cl/terms",
                params={"obo_id": cl_id},
            ) as resp:
                if resp.status != 200:
                    return None
                data = await resp.json()

            terms = data.get("_embedded", {}).get("terms", [])
            if not terms:
                return None

            term = terms[0]
            description = term.get("description", [])
            definition = description[0] if isinstance(description, list) and description else ""

            return CellType(
                cl_id=cl_id,
                name=term.get("label", ""),
                definition=definition,
                synonyms=term.get("synonyms", [])[:5],
            )

        except Exception as e:
            logger.warning(f"Cell Ontology fetch failed: {e}")
            return None

    async def close(self):
        if self._session:
            await self._session.close()
            self._session = None


# ======================== FMA (Foundational Model of Anatomy) via OLS ========================

@dataclass
class AnatomicalEntity:
    """An anatomical entity from FMA."""
    fma_id: str
    name: str
    definition: str = ""
    synonyms: list[str] = field(default_factory=list)
    parents: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "fma_id": self.fma_id,
            "name": self.name,
            "definition": self.definition[:300] if self.definition else "",
            "synonyms": self.synonyms[:5],
            "source": "FMA",
        }


class FMAService:
    """
    Foundational Model of Anatomy (FMA) API client via OLS.

    FMA is a reference ontology for anatomical knowledge.
    Used for grounding anatomical references in biomedical hypotheses.

    Source: http://purl.org/sig/ont/fma.owl
    API: https://www.ebi.ac.uk/ols4/api
    """

    OLS_URL = "https://www.ebi.ac.uk/ols4/api"

    def __init__(self):
        self._session = None

    async def _get_session(self):
        if self._session is None:
            import aiohttp
            self._session = aiohttp.ClientSession()
        return self._session

    async def search(
        self,
        query: str,
        max_results: int = 5,
    ) -> list[AnatomicalEntity]:
        """Search FMA for anatomical entities."""
        session = await self._get_session()

        params = {
            "q": query,
            "ontology": "fma",
            "rows": str(max_results),
            "exact": "false",
        }

        try:
            async with session.get(f"{self.OLS_URL}/search", params=params) as resp:
                if resp.status != 200:
                    return []
                data = await resp.json()

            entities = []
            for doc in data.get("response", {}).get("docs", []):
                synonyms = doc.get("synonym", [])
                if isinstance(synonyms, str):
                    synonyms = [synonyms]

                description = doc.get("description", [])
                definition = description[0] if isinstance(description, list) and description else ""

                entities.append(AnatomicalEntity(
                    fma_id=doc.get("obo_id", doc.get("short_form", "")),
                    name=doc.get("label", ""),
                    definition=definition,
                    synonyms=synonyms[:5],
                ))

            logger.info(f"FMA search '{query[:40]}...' returned {len(entities)} results")
            return entities

        except Exception as e:
            logger.warning(f"FMA search failed: {e}")
            return []

    async def close(self):
        if self._session:
            await self._session.close()
            self._session = None


# ======================== Extended NCBI E-utilities ========================

class NCBIExtendedService:
    """
    Extended NCBI E-utilities client.

    Beyond PubMed, provides access to:
    - Gene database — gene information and links
    - Protein database — protein sequences and annotations
    - SNP (dbSNP) — genetic variation data
    - ClinVar — clinical significance of variants
    - OMIM — Mendelian inheritance in man

    API: https://www.ncbi.nlm.nih.gov/books/NBK25500/
    """

    EUTILS_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"

    def __init__(self):
        self._session = None
        self._last_request_time = 0.0
        self._rate_limit_delay = 0.34

    async def _get_session(self):
        if self._session is None:
            import aiohttp
            self._session = aiohttp.ClientSession()
        return self._session

    async def _rate_limit(self):
        elapsed = time.time() - self._last_request_time
        if elapsed < self._rate_limit_delay:
            await asyncio.sleep(self._rate_limit_delay - elapsed)
        self._last_request_time = time.time()

    def _build_params(self, **kwargs) -> dict[str, str]:
        params = dict(kwargs)
        api_key = settings.PUBMED_API_KEY
        if api_key:
            key_val = api_key.get_secret_value() if hasattr(api_key, 'get_secret_value') else str(api_key)
            if key_val:
                params["api_key"] = key_val
        params["email"] = settings.PUBMED_EMAIL
        return params

    async def search_gene(self, query: str, max_results: int = 5) -> list[dict[str, Any]]:
        """Search NCBI Gene database."""
        await self._rate_limit()
        session = await self._get_session()

        # Search
        params = self._build_params(
            db="gene", term=f"({query}) AND Homo sapiens[Organism]",
            retmax=str(max_results), retmode="json",
        )

        try:
            async with session.get(f"{self.EUTILS_BASE}/esearch.fcgi", params=params) as resp:
                if resp.status != 200:
                    return []
                data = await resp.json()

            gene_ids = data.get("esearchresult", {}).get("idlist", [])
            if not gene_ids:
                return []

            # Fetch summaries
            await self._rate_limit()
            params = self._build_params(
                db="gene", id=",".join(gene_ids[:10]), retmode="json",
            )

            async with session.get(f"{self.EUTILS_BASE}/esummary.fcgi", params=params) as resp:
                if resp.status != 200:
                    return []
                data = await resp.json()

            results = []
            for gene_id in gene_ids:
                info = data.get("result", {}).get(gene_id, {})
                if not info or gene_id == "uids":
                    continue
                results.append({
                    "gene_id": gene_id,
                    "symbol": info.get("name", ""),
                    "description": info.get("description", ""),
                    "full_name": info.get("nomenclaturesymbol", ""),
                    "chromosome": info.get("chromosome", ""),
                    "map_location": info.get("maplocation", ""),
                    "organism": info.get("organism", {}).get("scientificname", ""),
                    "source": "NCBI Gene",
                })

            logger.info(f"NCBI Gene search '{query[:40]}...' returned {len(results)} results")
            return results

        except Exception as e:
            logger.warning(f"NCBI Gene search failed: {e}")
            return []

    async def search_clinvar(self, query: str, max_results: int = 5) -> list[dict[str, Any]]:
        """Search ClinVar for clinical significance of variants."""
        await self._rate_limit()
        session = await self._get_session()

        params = self._build_params(
            db="clinvar", term=query, retmax=str(max_results), retmode="json",
        )

        try:
            async with session.get(f"{self.EUTILS_BASE}/esearch.fcgi", params=params) as resp:
                if resp.status != 200:
                    return []
                data = await resp.json()

            variant_ids = data.get("esearchresult", {}).get("idlist", [])
            if not variant_ids:
                return []

            await self._rate_limit()
            params = self._build_params(
                db="clinvar", id=",".join(variant_ids[:10]), retmode="json",
            )

            async with session.get(f"{self.EUTILS_BASE}/esummary.fcgi", params=params) as resp:
                if resp.status != 200:
                    return []
                data = await resp.json()

            results = []
            for vid in variant_ids:
                info = data.get("result", {}).get(vid, {})
                if not info or vid == "uids":
                    continue
                results.append({
                    "clinvar_id": vid,
                    "title": info.get("title", ""),
                    "clinical_significance": info.get("clinical_significance", {}).get("description", ""),
                    "gene": info.get("genes", [{}])[0].get("symbol", "") if info.get("genes") else "",
                    "condition": ", ".join(
                        t.get("trait_name", "") for t in info.get("trait_set", []) if t.get("trait_name")
                    ),
                    "source": "ClinVar",
                })

            logger.info(f"ClinVar search '{query[:40]}...' returned {len(results)} results")
            return results

        except Exception as e:
            logger.warning(f"ClinVar search failed: {e}")
            return []

    async def close(self):
        if self._session:
            await self._session.close()
            self._session = None


# ======================== Extended KEGG ========================

class KEGGExtendedService:
    """
    Extended KEGG API client.

    Provides access to:
    - KEGG PATHWAY — metabolic and signaling pathways
    - KEGG DISEASE — human diseases
    - KEGG DRUG — approved and experimental drugs
    - KEGG COMPOUND — small molecules

    API: https://www.kegg.jp/kegg/rest/keggapi.html
    Rate limit: 3 requests/second
    """

    KEGG_BASE = "https://rest.kegg.jp"

    def __init__(self):
        self._session = None
        self._last_request_time = 0.0
        self._rate_limit_delay = 0.34  # ~3 req/sec

    async def _get_session(self):
        if self._session is None:
            import aiohttp
            self._session = aiohttp.ClientSession()
        return self._session

    async def _rate_limit(self):
        elapsed = time.time() - self._last_request_time
        if elapsed < self._rate_limit_delay:
            await asyncio.sleep(self._rate_limit_delay - elapsed)
        self._last_request_time = time.time()

    async def search_disease(self, query: str, max_results: int = 5) -> list[dict[str, Any]]:
        """Search KEGG DISEASE database."""
        await self._rate_limit()
        session = await self._get_session()

        try:
            async with session.get(f"{self.KEGG_BASE}/find/disease/{query}") as resp:
                if resp.status != 200:
                    return []
                text = await resp.text()

            results = []
            for line in text.strip().split("\n")[:max_results]:
                if "\t" in line:
                    parts = line.split("\t", 1)
                    results.append({
                        "id": parts[0].strip(),
                        "name": parts[1].strip() if len(parts) > 1 else "",
                        "source": "KEGG Disease",
                    })

            return results

        except Exception as e:
            logger.warning(f"KEGG Disease search failed: {e}")
            return []

    async def search_drug(self, query: str, max_results: int = 5) -> list[dict[str, Any]]:
        """Search KEGG DRUG database."""
        await self._rate_limit()
        session = await self._get_session()

        try:
            async with session.get(f"{self.KEGG_BASE}/find/drug/{query}") as resp:
                if resp.status != 200:
                    return []
                text = await resp.text()

            results = []
            for line in text.strip().split("\n")[:max_results]:
                if "\t" in line:
                    parts = line.split("\t", 1)
                    results.append({
                        "id": parts[0].strip(),
                        "name": parts[1].strip() if len(parts) > 1 else "",
                        "source": "KEGG Drug",
                    })

            return results

        except Exception as e:
            logger.warning(f"KEGG Drug search failed: {e}")
            return []

    async def search_compound(self, query: str, max_results: int = 5) -> list[dict[str, Any]]:
        """Search KEGG COMPOUND database."""
        await self._rate_limit()
        session = await self._get_session()

        try:
            async with session.get(f"{self.KEGG_BASE}/find/compound/{query}") as resp:
                if resp.status != 200:
                    return []
                text = await resp.text()

            results = []
            for line in text.strip().split("\n")[:max_results]:
                if "\t" in line:
                    parts = line.split("\t", 1)
                    results.append({
                        "id": parts[0].strip(),
                        "name": parts[1].strip() if len(parts) > 1 else "",
                        "source": "KEGG Compound",
                    })

            return results

        except Exception as e:
            logger.warning(f"KEGG Compound search failed: {e}")
            return []

    async def get_entry(self, entry_id: str) -> str:
        """Get a full KEGG entry (flat-file format)."""
        await self._rate_limit()
        session = await self._get_session()

        try:
            async with session.get(f"{self.KEGG_BASE}/get/{entry_id}") as resp:
                if resp.status != 200:
                    return ""
                return await resp.text()

        except Exception as e:
            logger.warning(f"KEGG get entry failed: {e}")
            return ""

    async def get_linked_pathways(self, gene_or_disease: str) -> list[dict[str, Any]]:
        """Get pathways linked to a gene or disease."""
        await self._rate_limit()
        session = await self._get_session()

        try:
            async with session.get(f"{self.KEGG_BASE}/link/pathway/{gene_or_disease}") as resp:
                if resp.status != 200:
                    return []
                text = await resp.text()

            results = []
            for line in text.strip().split("\n")[:10]:
                if "\t" in line:
                    parts = line.split("\t")
                    if len(parts) >= 2:
                        results.append({
                            "source": parts[0].strip(),
                            "pathway": parts[1].strip(),
                            "source_db": "KEGG",
                        })

            return results

        except Exception as e:
            logger.warning(f"KEGG link search failed: {e}")
            return []

    async def close(self):
        if self._session:
            await self._session.close()
            self._session = None


# ======================== Unified Extended Grounding Service ========================

class ExtendedGroundingService:
    """
    Extended scientific grounding service combining ALL available APIs.

    Adds to the base ScientificGroundingService:
    - Elsevier Scopus/ScienceDirect — premium literature with citation counts
    - Springer Nature — open access literature
    - ChEBI — chemical entity classification
    - HCA — single-cell genomics data
    - Cell Ontology — cell type definitions
    - FMA — anatomical entity definitions
    - NCBI Gene/ClinVar — gene and variant data
    - KEGG extended — disease/drug/compound linkages
    """

    def __init__(self):
        elsevier_key = getattr(settings, 'ELSEVIER_API_KEY', '')
        springer_key = getattr(settings, 'SPRINGER_API_KEY', '')
        hca_client_id = getattr(settings, 'HCA_CLIENT_ID', '')

        self.elsevier = ElsevierService(api_key=elsevier_key)
        self.springer = SpringerService(api_key=springer_key)
        self.chebi = ChEBIService()
        self.hca = HCAService(client_id=hca_client_id)
        self.cell_ontology = CellOntologyService()
        self.fma = FMAService()
        self.ncbi_ext = NCBIExtendedService()
        self.kegg_ext = KEGGExtendedService()

    async def ground_hypothesis_extended(
        self,
        hypothesis_text: str,
        disease: str,
        target_entities: list[str] = None,
        target_pathways: list[str] = None,
        target_chemicals: list[str] = None,
        target_cell_types: list[str] = None,
        target_organs: list[str] = None,
    ) -> dict[str, Any]:
        """
        Ground a hypothesis across ALL extended scientific databases.

        Returns consolidated evidence from Elsevier, Springer, ChEBI, HCA,
        Cell Ontology, FMA, NCBI Gene, ClinVar, and KEGG.
        """
        target_entities = target_entities or []
        target_pathways = target_pathways or []
        target_chemicals = target_chemicals or []
        target_cell_types = target_cell_types or []
        target_organs = target_organs or []

        tasks = []

        # Elsevier Scopus — literature with citation impact
        tasks.append(("elsevier", self.elsevier.search_evidence(
            hypothesis_text, disease, max_articles=5,
        )))

        # Springer Nature — open access literature
        tasks.append(("springer", self.springer.search_open_access(
            f"{disease} {' '.join(target_entities[:2])}", max_results=3,
        )))

        # ChEBI — chemical entities mentioned
        for chem in target_chemicals[:3]:
            tasks.append(("chebi", self.chebi.search(chem, max_results=2)))

        # HCA — single-cell data for disease/organ
        if target_organs:
            for organ in target_organs[:2]:
                tasks.append(("hca", self.hca.search_projects(
                    disease, organ=organ, disease=disease, max_results=2,
                )))
        else:
            tasks.append(("hca", self.hca.search_projects(
                disease, disease=disease, max_results=3,
            )))

        # Cell Ontology — cell types mentioned
        for ct in target_cell_types[:3]:
            tasks.append(("cell_ontology", self.cell_ontology.search(ct, max_results=2)))

        # FMA — anatomical entities
        for organ in target_organs[:3]:
            tasks.append(("fma", self.fma.search(organ, max_results=2)))

        # NCBI Gene — gene targets
        for entity in target_entities[:3]:
            tasks.append(("ncbi_gene", self.ncbi_ext.search_gene(entity, max_results=2)))

        # ClinVar — variant significance
        for entity in target_entities[:2]:
            tasks.append(("clinvar", self.ncbi_ext.search_clinvar(
                f"{entity} {disease}", max_results=2,
            )))

        # KEGG extended — disease, drug, compound linkages
        tasks.append(("kegg_disease", self.kegg_ext.search_disease(disease, max_results=3)))
        for entity in target_entities[:2]:
            tasks.append(("kegg_drug", self.kegg_ext.search_drug(entity, max_results=2)))
        for chem in target_chemicals[:2]:
            tasks.append(("kegg_compound", self.kegg_ext.search_compound(chem, max_results=2)))

        # Execute all in parallel
        results = await asyncio.gather(
            *[t[1] for t in tasks],
            return_exceptions=True,
        )

        # Aggregate results by source
        evidence = {
            "elsevier": [],
            "springer": [],
            "chebi": [],
            "hca": [],
            "cell_ontology": [],
            "fma": [],
            "ncbi_gene": [],
            "clinvar": [],
            "kegg_disease": [],
            "kegg_drug": [],
            "kegg_compound": [],
        }

        for (source, _), result in zip(tasks, results):
            if isinstance(result, Exception):
                logger.debug(f"Extended grounding {source} failed: {result}")
                continue
            if result:
                if isinstance(result, list):
                    for item in result:
                        if hasattr(item, 'to_dict'):
                            evidence[source].append(item.to_dict())
                        elif isinstance(item, dict):
                            evidence[source].append(item)
                elif isinstance(result, dict):
                    evidence[source].append(result)

        # Build evidence text
        evidence_text = self._format_extended_evidence(evidence)

        return {
            "extended_evidence": evidence,
            "extended_evidence_text": evidence_text,
            "elsevier_count": len(evidence["elsevier"]),
            "springer_count": len(evidence["springer"]),
            "chebi_count": len(evidence["chebi"]),
            "hca_count": len(evidence["hca"]),
            "cell_ontology_count": len(evidence["cell_ontology"]),
            "fma_count": len(evidence["fma"]),
            "ncbi_gene_count": len(evidence["ncbi_gene"]),
            "clinvar_count": len(evidence["clinvar"]),
            "kegg_disease_count": len(evidence["kegg_disease"]),
            "kegg_drug_count": len(evidence["kegg_drug"]),
            "kegg_compound_count": len(evidence["kegg_compound"]),
        }

    def _format_extended_evidence(self, evidence: dict[str, list]) -> str:
        """Format extended evidence into text for LLM consumption."""
        parts = []

        if evidence.get("elsevier"):
            parts.append("## Elsevier/Scopus Literature")
            for a in evidence["elsevier"]:
                parts.append(f"- **{a.get('title', 'Untitled')}** [{a.get('year', '')}] (Cited: {a.get('citation_count', 0)})")
                if a.get("abstract"):
                    parts.append(f"  Abstract: {a['abstract'][:300]}")
                if a.get("doi"):
                    parts.append(f"  DOI: {a['doi']}")

        if evidence.get("springer"):
            parts.append("\n## Springer Nature Open Access")
            for a in evidence["springer"]:
                parts.append(f"- **{a.get('title', 'Untitled')}** [{a.get('year', '')}]")
                if a.get("abstract"):
                    parts.append(f"  Abstract: {a['abstract'][:300]}")

        if evidence.get("chebi"):
            parts.append("\n## ChEBI Chemical Entities")
            for c in evidence["chebi"]:
                parts.append(f"- **{c.get('name', 'Unknown')}** ({c.get('chebi_id', '')})")
                if c.get("definition"):
                    parts.append(f"  Definition: {c['definition'][:200]}")

        if evidence.get("hca"):
            parts.append("\n## Human Cell Atlas Data")
            for h in evidence["hca"]:
                parts.append(f"- **{h.get('project_title', 'Unknown')}**")
                if h.get("organs"):
                    parts.append(f"  Organs: {', '.join(h['organs'][:5])}")
                if h.get("cell_count"):
                    parts.append(f"  Total cells: {h['cell_count']}")

        if evidence.get("cell_ontology"):
            parts.append("\n## Cell Ontology")
            for ct in evidence["cell_ontology"]:
                parts.append(f"- **{ct.get('name', 'Unknown')}** ({ct.get('cl_id', '')})")
                if ct.get("definition"):
                    parts.append(f"  Definition: {ct['definition'][:200]}")

        if evidence.get("fma"):
            parts.append("\n## FMA Anatomical Entities")
            for e in evidence["fma"]:
                parts.append(f"- **{e.get('name', 'Unknown')}** ({e.get('fma_id', '')})")

        if evidence.get("ncbi_gene"):
            parts.append("\n## NCBI Gene Data")
            for g in evidence["ncbi_gene"]:
                parts.append(f"- **{g.get('symbol', 'Unknown')}** (GeneID: {g.get('gene_id', '')})")
                if g.get("description"):
                    parts.append(f"  {g['description'][:200]}")
                if g.get("map_location"):
                    parts.append(f"  Location: {g['map_location']}")

        if evidence.get("clinvar"):
            parts.append("\n## ClinVar Variant Data")
            for v in evidence["clinvar"]:
                parts.append(f"- **{v.get('title', 'Unknown')}** — {v.get('clinical_significance', 'N/A')}")
                if v.get("condition"):
                    parts.append(f"  Condition: {v['condition'][:200]}")

        if evidence.get("kegg_disease"):
            parts.append("\n## KEGG Disease Entries")
            for d in evidence["kegg_disease"]:
                parts.append(f"- {d.get('id', '')} — {d.get('name', '')}")

        if evidence.get("kegg_drug"):
            parts.append("\n## KEGG Drug Entries")
            for d in evidence["kegg_drug"]:
                parts.append(f"- {d.get('id', '')} — {d.get('name', '')}")

        if evidence.get("kegg_compound"):
            parts.append("\n## KEGG Compound Entries")
            for c in evidence["kegg_compound"]:
                parts.append(f"- {c.get('id', '')} — {c.get('name', '')}")

        return "\n".join(parts) if parts else ""

    async def close(self):
        await asyncio.gather(
            self.elsevier.close(),
            self.springer.close(),
            self.chebi.close(),
            self.hca.close(),
            self.cell_ontology.close(),
            self.fma.close(),
            self.ncbi_ext.close(),
            self.kegg_ext.close(),
            return_exceptions=True,
        )


# Singleton
_extended_grounding: Optional[ExtendedGroundingService] = None


def get_extended_grounding_service() -> ExtendedGroundingService:
    """Get the global extended grounding service."""
    global _extended_grounding
    if _extended_grounding is None:
        _extended_grounding = ExtendedGroundingService()
    return _extended_grounding
