"""
Humanovo Data Sources Module

Implements connectors for 60+ biomedical data sources across 4 phases.
Phase 1 (21 sources): Fully implemented with search, parsing, and rate limiting.
Phase 2-4 (~40 sources): Stub classes for future implementation.

Includes the DataSourceOrchestrator for coordinating queries across all sources.
"""

import asyncio
import json
import time
import urllib.parse
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Optional

import aiohttp

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

@dataclass
class DataSourceResult:
    """Standardized result from any data source query."""

    source: str
    query: str
    total_results: int = 0
    results: list[dict[str, Any]] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)
    error: Optional[str] = None
    elapsed_seconds: float = 0.0
    cached: bool = False

    @property
    def success(self) -> bool:
        return self.error is None

    def to_dict(self) -> dict[str, Any]:
        return {
            "source": self.source,
            "query": self.query,
            "total_results": self.total_results,
            "results": self.results,
            "metadata": self.metadata,
            "error": self.error,
            "elapsed_seconds": self.elapsed_seconds,
            "cached": self.cached,
            "success": self.success,
        }


# ---------------------------------------------------------------------------
# Rate limiter
# ---------------------------------------------------------------------------

class RateLimiter:
    """Simple token-bucket rate limiter for API calls."""

    def __init__(self, calls_per_second: float = 3.0):
        self.min_interval = 1.0 / calls_per_second
        self._last_call: float = 0.0
        self._lock = asyncio.Lock()

    async def acquire(self) -> None:
        async with self._lock:
            now = time.monotonic()
            wait = self.min_interval - (now - self._last_call)
            if wait > 0:
                await asyncio.sleep(wait)
            self._last_call = time.monotonic()


# ---------------------------------------------------------------------------
# Abstract base
# ---------------------------------------------------------------------------

class DataSourceBase(ABC):
    """Abstract base class for all biomedical data sources."""

    name: str = "unknown"
    base_url: str = ""
    category: str = "general"
    phase: int = 1
    description: str = ""

    def __init__(self) -> None:
        self.rate_limiter = RateLimiter(calls_per_second=self._rate_limit())
        self._session: Optional[aiohttp.ClientSession] = None

    def _rate_limit(self) -> float:
        """Override to set source-specific rate limit."""
        return 3.0

    async def _get_session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            timeout = aiohttp.ClientTimeout(total=30)
            self._session = aiohttp.ClientSession(timeout=timeout)
        return self._session

    async def close(self) -> None:
        if self._session and not self._session.closed:
            await self._session.close()

    @abstractmethod
    async def search(self, query: str, max_results: int = 20) -> DataSourceResult:
        """Execute a search and return standardized results."""

    async def _safe_search(self, query: str, max_results: int = 20) -> DataSourceResult:
        """Wrapper with error handling and timing."""
        start = time.monotonic()
        try:
            await self.rate_limiter.acquire()
            result = await self.search(query, max_results)
            result.elapsed_seconds = time.monotonic() - start
            return result
        except Exception as exc:
            logger.error("data_source_error", source=self.name, error=str(exc))
            return DataSourceResult(
                source=self.name,
                query=query,
                error=str(exc),
                elapsed_seconds=time.monotonic() - start,
            )

    def info(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "base_url": self.base_url,
            "category": self.category,
            "phase": self.phase,
            "description": self.description,
        }


# ===================================================================
# PHASE 1 — 21 fully implemented data sources
# ===================================================================


class PubMedSource(DataSourceBase):
    """NCBI PubMed — biomedical literature."""

    name = "pubmed"
    base_url = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
    category = "literature"
    phase = 1
    description = "Biomedical literature from MEDLINE, life science journals, and online books."

    def _rate_limit(self) -> float:
        return 3.0  # NCBI allows 3/s without API key, 10/s with

    async def search(self, query: str, max_results: int = 20) -> DataSourceResult:
        session = await self._get_session()
        # Step 1: ESearch
        search_params = {
            "db": "pubmed",
            "term": query,
            "retmax": max_results,
            "retmode": "json",
            "sort": "relevance",
        }
        api_key = getattr(settings, "NCBI_API_KEY", None)
        if api_key:
            search_params["api_key"] = api_key

        async with session.get(f"{self.base_url}/esearch.fcgi", params=search_params) as resp:
            data = await resp.json()

        id_list = data.get("esearchresult", {}).get("idlist", [])
        total = int(data.get("esearchresult", {}).get("count", 0))

        if not id_list:
            return DataSourceResult(source=self.name, query=query, total_results=total)

        # Step 2: ESummary for details
        summary_params = {
            "db": "pubmed",
            "id": ",".join(id_list),
            "retmode": "json",
        }
        if api_key:
            summary_params["api_key"] = api_key

        async with session.get(f"{self.base_url}/esummary.fcgi", params=summary_params) as resp:
            summary_data = await resp.json()

        results = []
        for pmid in id_list:
            article = summary_data.get("result", {}).get(pmid, {})
            results.append({
                "id": pmid,
                "title": article.get("title", ""),
                "authors": [a.get("name", "") for a in article.get("authors", [])],
                "journal": article.get("source", ""),
                "pub_date": article.get("pubdate", ""),
                "doi": article.get("elocationid", ""),
                "url": f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/",
            })

        return DataSourceResult(
            source=self.name, query=query, total_results=total, results=results,
        )


class ClinicalTrialsSource(DataSourceBase):
    """ClinicalTrials.gov — clinical study registry."""

    name = "clinicaltrials"
    base_url = "https://clinicaltrials.gov/api/v2"
    category = "clinical"
    phase = 1
    description = "Registry of clinical studies conducted around the world."

    async def search(self, query: str, max_results: int = 20) -> DataSourceResult:
        session = await self._get_session()
        params = {
            "query.term": query,
            "pageSize": min(max_results, 100),
            "format": "json",
        }
        async with session.get(f"{self.base_url}/studies", params=params) as resp:
            data = await resp.json()

        studies = data.get("studies", [])
        total = data.get("totalCount", len(studies))
        results = []
        for study in studies:
            proto = study.get("protocolSection", {})
            ident = proto.get("identificationModule", {})
            status = proto.get("statusModule", {})
            results.append({
                "id": ident.get("nctId", ""),
                "title": ident.get("briefTitle", ""),
                "status": status.get("overallStatus", ""),
                "phase": proto.get("designModule", {}).get("phases", []),
                "conditions": proto.get("conditionsModule", {}).get("conditions", []),
                "url": f"https://clinicaltrials.gov/study/{ident.get('nctId', '')}",
            })

        return DataSourceResult(
            source=self.name, query=query, total_results=total, results=results,
        )


class OpenFDASource(DataSourceBase):
    """openFDA — FDA open data on drugs, devices, and food."""

    name = "openfda"
    base_url = "https://api.fda.gov"
    category = "regulatory"
    phase = 1
    description = "FDA open data including drug adverse events, labeling, and recalls."

    async def search(self, query: str, max_results: int = 20) -> DataSourceResult:
        session = await self._get_session()
        params = {
            "search": query,
            "limit": min(max_results, 100),
        }
        api_key = getattr(settings, "OPENFDA_API_KEY", None)
        if api_key:
            params["api_key"] = api_key

        async with session.get(f"{self.base_url}/drug/event.json", params=params) as resp:
            data = await resp.json()

        raw_results = data.get("results", [])
        total = data.get("meta", {}).get("results", {}).get("total", len(raw_results))
        results = []
        for event in raw_results:
            patient = event.get("patient", {})
            drugs = patient.get("drug", [])
            results.append({
                "id": event.get("safetyreportid", ""),
                "receive_date": event.get("receivedate", ""),
                "serious": event.get("serious", ""),
                "drugs": [d.get("medicinalproduct", "") for d in drugs],
                "reactions": [r.get("reactionmeddrapt", "") for r in patient.get("reaction", [])],
            })

        return DataSourceResult(
            source=self.name, query=query, total_results=total, results=results,
        )


class UniProtSource(DataSourceBase):
    """UniProt — universal protein knowledgebase."""

    name = "uniprot"
    base_url = "https://rest.uniprot.org"
    category = "protein"
    phase = 1
    description = "Comprehensive protein sequence and functional information."

    async def search(self, query: str, max_results: int = 20) -> DataSourceResult:
        session = await self._get_session()
        params = {
            "query": query,
            "format": "json",
            "size": min(max_results, 500),
            "fields": "accession,id,protein_name,gene_names,organism_name,length,ec",
        }
        async with session.get(f"{self.base_url}/uniprotkb/search", params=params) as resp:
            data = await resp.json()

        entries = data.get("results", [])
        total = len(entries)
        results = []
        for entry in entries:
            protein_desc = entry.get("proteinDescription", {})
            rec_name = protein_desc.get("recommendedName", {}).get("fullName", {}).get("value", "")
            results.append({
                "accession": entry.get("primaryAccession", ""),
                "id": entry.get("uniProtkbId", ""),
                "protein_name": rec_name,
                "gene_names": [g.get("geneName", {}).get("value", "") for g in entry.get("genes", [])],
                "organism": entry.get("organism", {}).get("scientificName", ""),
                "length": entry.get("sequence", {}).get("length", 0),
                "url": f"https://www.uniprot.org/uniprot/{entry.get('primaryAccession', '')}",
            })

        return DataSourceResult(
            source=self.name, query=query, total_results=total, results=results,
        )


class KEGGSource(DataSourceBase):
    """KEGG — Kyoto Encyclopedia of Genes and Genomes."""

    name = "kegg"
    base_url = "https://rest.kegg.jp"
    category = "pathway"
    phase = 1
    description = "Biological pathways, diseases, drugs, and genomic information."

    async def search(self, query: str, max_results: int = 20) -> DataSourceResult:
        session = await self._get_session()
        # KEGG find endpoint for general search
        async with session.get(f"{self.base_url}/find/pathway/{query}") as resp:
            text = await resp.text()

        results = []
        lines = [l for l in text.strip().split("\n") if l]
        for line in lines[:max_results]:
            parts = line.split("\t", 1)
            if len(parts) == 2:
                pathway_id, name = parts
                results.append({
                    "id": pathway_id.strip(),
                    "name": name.strip(),
                    "url": f"https://www.kegg.jp/entry/{pathway_id.strip()}",
                })

        return DataSourceResult(
            source=self.name, query=query, total_results=len(results), results=results,
        )


class DrugBankSource(DataSourceBase):
    """DrugBank — drug and drug target database."""

    name = "drugbank"
    base_url = "https://go.drugbank.com/unearth/q"
    category = "drug"
    phase = 1
    description = "Comprehensive drug and drug target information."

    async def search(self, query: str, max_results: int = 20) -> DataSourceResult:
        session = await self._get_session()
        # DrugBank open search endpoint
        params = {
            "query": query,
            "searcher": "drugs",
            "button": "",
            "utf8": "✓",
        }
        headers = {"Accept": "application/json"}
        try:
            async with session.get(self.base_url, params=params, headers=headers) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    items = data if isinstance(data, list) else data.get("results", [])
                else:
                    # DrugBank may require auth; return limited result
                    items = []
        except (aiohttp.ContentTypeError, Exception):
            items = []

        results = []
        for item in items[:max_results]:
            if isinstance(item, dict):
                results.append({
                    "id": item.get("drugbank_id", item.get("id", "")),
                    "name": item.get("name", ""),
                    "description": item.get("description", "")[:300],
                    "url": f"https://go.drugbank.com/drugs/{item.get('drugbank_id', '')}",
                })

        return DataSourceResult(
            source=self.name, query=query, total_results=len(results), results=results,
        )


class ChEMBLSource(DataSourceBase):
    """ChEMBL — bioactivity database for drug-like molecules."""

    name = "chembl"
    base_url = "https://www.ebi.ac.uk/chembl/api/data"
    category = "drug"
    phase = 1
    description = "Bioactivity data for drug-like small molecules."

    async def search(self, query: str, max_results: int = 20) -> DataSourceResult:
        session = await self._get_session()
        params = {
            "q": query,
            "limit": min(max_results, 20),
            "format": "json",
        }
        async with session.get(f"{self.base_url}/molecule/search", params=params) as resp:
            data = await resp.json()

        molecules = data.get("molecules", [])
        total = data.get("page_meta", {}).get("total_count", len(molecules))
        results = []
        for mol in molecules:
            results.append({
                "chembl_id": mol.get("molecule_chembl_id", ""),
                "name": mol.get("pref_name", ""),
                "max_phase": mol.get("max_phase", ""),
                "molecule_type": mol.get("molecule_type", ""),
                "first_approval": mol.get("first_approval", ""),
                "oral": mol.get("oral", False),
                "url": f"https://www.ebi.ac.uk/chembl/compound_report_card/{mol.get('molecule_chembl_id', '')}",
            })

        return DataSourceResult(
            source=self.name, query=query, total_results=total, results=results,
        )


class DisGeNETSource(DataSourceBase):
    """DisGeNET — gene-disease associations."""

    name = "disgenet"
    base_url = "https://www.disgenet.org/api"
    category = "disease"
    phase = 1
    description = "Collections of genes and variants associated with human diseases."

    async def search(self, query: str, max_results: int = 20) -> DataSourceResult:
        session = await self._get_session()
        headers = {"Accept": "application/json"}
        api_key = getattr(settings, "DISGENET_API_KEY", None)
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"

        params = {"disease": query, "limit": min(max_results, 100)}
        async with session.get(
            f"{self.base_url}/gda/disease/{query}", params=params, headers=headers,
        ) as resp:
            data = await resp.json() if resp.status == 200 else []

        if not isinstance(data, list):
            data = data.get("results", []) if isinstance(data, dict) else []

        results = []
        for assoc in data[:max_results]:
            results.append({
                "gene_symbol": assoc.get("gene_symbol", ""),
                "gene_id": assoc.get("geneid", ""),
                "disease_name": assoc.get("disease_name", ""),
                "disease_id": assoc.get("diseaseid", ""),
                "score": assoc.get("score", 0.0),
                "source": assoc.get("source", ""),
            })

        return DataSourceResult(
            source=self.name, query=query, total_results=len(results), results=results,
        )


class STRINGSource(DataSourceBase):
    """STRING — protein-protein interaction networks."""

    name = "string"
    base_url = "https://string-db.org/api"
    category = "interaction"
    phase = 1
    description = "Known and predicted protein-protein interactions."

    async def search(self, query: str, max_results: int = 20) -> DataSourceResult:
        session = await self._get_session()
        params = {
            "identifiers": query,
            "species": 9606,  # Homo sapiens
            "limit": min(max_results, 50),
            "caller_identity": "humanovo",
        }
        async with session.get(
            f"{self.base_url}/json/network", params=params,
        ) as resp:
            data = await resp.json()

        if not isinstance(data, list):
            data = []

        results = []
        for interaction in data[:max_results]:
            results.append({
                "protein_a": interaction.get("preferredName_A", ""),
                "protein_b": interaction.get("preferredName_B", ""),
                "score": interaction.get("score", 0.0),
                "nscore": interaction.get("nscore", 0.0),
                "escore": interaction.get("escore", 0.0),
                "dscore": interaction.get("dscore", 0.0),
            })

        return DataSourceResult(
            source=self.name, query=query, total_results=len(results), results=results,
        )


class ReactomeSource(DataSourceBase):
    """Reactome — biological pathway database."""

    name = "reactome"
    base_url = "https://reactome.org/ContentService"
    category = "pathway"
    phase = 1
    description = "Curated and peer-reviewed pathway database."

    async def search(self, query: str, max_results: int = 20) -> DataSourceResult:
        session = await self._get_session()
        params = {"query": query, "cluster": "true"}
        headers = {"Accept": "application/json"}
        async with session.get(
            f"{self.base_url}/search/query", params=params, headers=headers,
        ) as resp:
            data = await resp.json()

        entries = data.get("results", [])
        results = []
        for group in entries:
            for entry in group.get("entries", [])[:max_results]:
                results.append({
                    "id": entry.get("stId", ""),
                    "name": entry.get("name", ""),
                    "type": entry.get("exactType", ""),
                    "species": entry.get("species", ""),
                    "compartment": entry.get("compartmentNames", []),
                    "url": f"https://reactome.org/content/detail/{entry.get('stId', '')}",
                })
                if len(results) >= max_results:
                    break

        return DataSourceResult(
            source=self.name, query=query, total_results=len(results), results=results,
        )


class OMIMSource(DataSourceBase):
    """OMIM — Online Mendelian Inheritance in Man."""

    name = "omim"
    base_url = "https://api.omim.org/api"
    category = "genetics"
    phase = 1
    description = "Catalog of human genes and genetic disorders."

    async def search(self, query: str, max_results: int = 20) -> DataSourceResult:
        session = await self._get_session()
        api_key = getattr(settings, "OMIM_API_KEY", None)
        params: dict[str, Any] = {
            "search": query,
            "limit": min(max_results, 20),
            "format": "json",
            "include": "geneMap",
        }
        if api_key:
            params["apiKey"] = api_key

        async with session.get(f"{self.base_url}/entry/search", params=params) as resp:
            data = await resp.json() if resp.status == 200 else {}

        entries = (
            data.get("omim", {})
            .get("searchResponse", {})
            .get("entryList", [])
        )
        total = data.get("omim", {}).get("searchResponse", {}).get("totalResults", 0)
        results = []
        for item in entries:
            entry = item.get("entry", {})
            results.append({
                "mim_number": entry.get("mimNumber", ""),
                "title": entry.get("titles", {}).get("preferredTitle", ""),
                "status": entry.get("status", ""),
                "url": f"https://omim.org/entry/{entry.get('mimNumber', '')}",
            })

        return DataSourceResult(
            source=self.name, query=query, total_results=total, results=results,
        )


class PharmGKBSource(DataSourceBase):
    """PharmGKB — pharmacogenomics knowledgebase."""

    name = "pharmgkb"
    base_url = "https://api.pharmgkb.org/v1"
    category = "pharmacogenomics"
    phase = 1
    description = "Pharmacogenomic relationships between drugs, genes, and diseases."

    async def search(self, query: str, max_results: int = 20) -> DataSourceResult:
        session = await self._get_session()
        params = {"view": "max"}
        headers = {"Accept": "application/json"}
        async with session.get(
            f"{self.base_url}/search/{query}", params=params, headers=headers,
        ) as resp:
            data = await resp.json() if resp.status == 200 else {}

        hits = data.get("data", [])
        results = []
        for hit in hits[:max_results]:
            obj = hit.get("object", {}) if isinstance(hit, dict) else {}
            results.append({
                "id": obj.get("id", ""),
                "name": obj.get("name", ""),
                "type": hit.get("objectType", ""),
                "url": f"https://www.pharmgkb.org/{hit.get('objectType', 'unknown').lower()}/{obj.get('id', '')}",
            })

        return DataSourceResult(
            source=self.name, query=query, total_results=len(results), results=results,
        )


class GeneOntologySource(DataSourceBase):
    """Gene Ontology — functional annotation of genes."""

    name = "gene_ontology"
    base_url = "https://api.geneontology.org/api"
    category = "ontology"
    phase = 1
    description = "Structured vocabulary describing gene and gene product attributes."

    async def search(self, query: str, max_results: int = 20) -> DataSourceResult:
        session = await self._get_session()
        params = {
            "q": query,
            "rows": min(max_results, 100),
            "category": "bioentity",
        }
        async with session.get(f"{self.base_url}/search/entity/autocomplete/{query}", params=params) as resp:
            data = await resp.json() if resp.status == 200 else {}

        docs = data.get("docs", [])
        results = []
        for doc in docs[:max_results]:
            results.append({
                "id": doc.get("id", ""),
                "label": doc.get("label", ""),
                "category": doc.get("category", []),
                "taxon": doc.get("taxon", ""),
                "taxon_label": doc.get("taxon_label", ""),
                "url": f"http://amigo.geneontology.org/amigo/term/{doc.get('id', '')}",
            })

        return DataSourceResult(
            source=self.name, query=query, total_results=len(results), results=results,
        )


class HumanProteinAtlasSource(DataSourceBase):
    """Human Protein Atlas — protein expression in human tissues."""

    name = "human_protein_atlas"
    base_url = "https://www.proteinatlas.org/api"
    category = "protein"
    phase = 1
    description = "Protein expression profiles in human tissues and cells."

    async def search(self, query: str, max_results: int = 20) -> DataSourceResult:
        session = await self._get_session()
        params = {"format": "json"}
        async with session.get(
            f"{self.base_url}/search_download.php?search={query}&columns=g,eg,up,rnats&compress=no",
            params=params,
        ) as resp:
            data = await resp.json() if resp.status == 200 else []

        if not isinstance(data, list):
            data = []

        results = []
        for entry in data[:max_results]:
            results.append({
                "gene": entry.get("Gene", ""),
                "ensembl": entry.get("Ensembl", ""),
                "uniprot": entry.get("Uniprot", ""),
                "rna_tissue_specificity": entry.get("RNA tissue specificity", ""),
                "url": f"https://www.proteinatlas.org/{entry.get('Ensembl', '')}",
            })

        return DataSourceResult(
            source=self.name, query=query, total_results=len(results), results=results,
        )


class COSMICSource(DataSourceBase):
    """COSMIC — Catalogue of Somatic Mutations in Cancer."""

    name = "cosmic"
    base_url = "https://cancer.sanger.ac.uk/cosmic/search"
    category = "cancer"
    phase = 1
    description = "Somatic mutation information related to human cancers."

    async def search(self, query: str, max_results: int = 20) -> DataSourceResult:
        session = await self._get_session()
        headers = {"Accept": "application/json"}
        api_key = getattr(settings, "COSMIC_API_KEY", None)
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"

        params = {"q": query, "pageSize": min(max_results, 25)}
        try:
            async with session.get(self.base_url, params=params, headers=headers) as resp:
                data = await resp.json() if resp.status == 200 else {}
        except (aiohttp.ContentTypeError, Exception):
            data = {}

        hits = data.get("hits", []) if isinstance(data, dict) else []
        results = []
        for hit in hits[:max_results]:
            results.append({
                "id": hit.get("id", ""),
                "gene": hit.get("gene_name", ""),
                "mutation": hit.get("mutation_cds", ""),
                "disease": hit.get("primary_site", ""),
                "url": f"https://cancer.sanger.ac.uk/cosmic/gene/analysis?ln={hit.get('gene_name', '')}",
            })

        return DataSourceResult(
            source=self.name, query=query, total_results=len(results), results=results,
        )


class IntActSource(DataSourceBase):
    """IntAct — molecular interaction database."""

    name = "intact"
    base_url = "https://www.ebi.ac.uk/intact/ws/interaction"
    category = "interaction"
    phase = 1
    description = "Molecular interaction data from literature curation and direct submissions."

    async def search(self, query: str, max_results: int = 20) -> DataSourceResult:
        session = await self._get_session()
        params = {"query": query, "number": 0, "size": min(max_results, 50)}
        headers = {"Accept": "application/json"}
        async with session.get(
            f"{self.base_url}/findInteractions", params=params, headers=headers,
        ) as resp:
            data = await resp.json() if resp.status == 200 else {}

        content = data.get("content", [])
        total = data.get("totalElements", len(content))
        results = []
        for item in content[:max_results]:
            results.append({
                "interaction_ac": item.get("ac", ""),
                "type": item.get("typeMI", {}).get("shortName", ""),
                "molecule_a": item.get("moleculeA", {}).get("identifier", ""),
                "molecule_b": item.get("moleculeB", {}).get("identifier", ""),
                "detection_method": item.get("detectionMethodMI", {}).get("shortName", ""),
                "publication": item.get("publicationIdentifier", ""),
            })

        return DataSourceResult(
            source=self.name, query=query, total_results=total, results=results,
        )


class BioGRIDSource(DataSourceBase):
    """BioGRID — biological general repository for interaction datasets."""

    name = "biogrid"
    base_url = "https://webservice.thebiogrid.org/interactions"
    category = "interaction"
    phase = 1
    description = "Genetic and protein interactions curated from literature."

    async def search(self, query: str, max_results: int = 20) -> DataSourceResult:
        session = await self._get_session()
        api_key = getattr(settings, "BIOGRID_API_KEY", None)
        params: dict[str, Any] = {
            "searchNames": "true",
            "geneList": query,
            "taxId": 9606,
            "max": min(max_results, 100),
            "format": "json",
            "includeHeader": "true",
        }
        if api_key:
            params["accessKey"] = api_key

        try:
            async with session.get(self.base_url, params=params) as resp:
                data = await resp.json() if resp.status == 200 else {}
        except (aiohttp.ContentTypeError, Exception):
            data = {}

        if not isinstance(data, dict):
            data = {}

        results = []
        for key, interaction in list(data.items())[:max_results]:
            if not isinstance(interaction, dict):
                continue
            results.append({
                "biogrid_id": interaction.get("BIOGRID_INTERACTION_ID", ""),
                "gene_a": interaction.get("OFFICIAL_SYMBOL_A", ""),
                "gene_b": interaction.get("OFFICIAL_SYMBOL_B", ""),
                "system": interaction.get("EXPERIMENTAL_SYSTEM", ""),
                "throughput": interaction.get("THROUGHPUT", ""),
                "pubmed_id": interaction.get("PUBMED_ID", ""),
            })

        return DataSourceResult(
            source=self.name, query=query, total_results=len(results), results=results,
        )


class EnsemblSource(DataSourceBase):
    """Ensembl — genome browser and annotation."""

    name = "ensembl"
    base_url = "https://rest.ensembl.org"
    category = "genomics"
    phase = 1
    description = "Vertebrate genome annotation, variation, and regulation data."

    async def search(self, query: str, max_results: int = 20) -> DataSourceResult:
        session = await self._get_session()
        headers = {"Content-Type": "application/json", "Accept": "application/json"}
        params = {"query": query, "species": "human"}
        async with session.get(
            f"{self.base_url}/xrefs/symbol/homo_sapiens/{query}", headers=headers,
        ) as resp:
            data = await resp.json() if resp.status == 200 else []

        if not isinstance(data, list):
            data = [data] if isinstance(data, dict) else []

        results = []
        for entry in data[:max_results]:
            results.append({
                "id": entry.get("id", ""),
                "type": entry.get("type", ""),
                "display_id": entry.get("display_id", ""),
                "version": entry.get("version", ""),
                "url": f"https://www.ensembl.org/Homo_sapiens/Gene/Summary?g={entry.get('id', '')}",
            })

        return DataSourceResult(
            source=self.name, query=query, total_results=len(results), results=results,
        )


class PDBSource(DataSourceBase):
    """PDB — Protein Data Bank for 3D structures."""

    name = "pdb"
    base_url = "https://search.rcsb.org/rcsbsearch/v2"
    category = "structure"
    phase = 1
    description = "3D structural data of biological macromolecules."

    async def search(self, query: str, max_results: int = 20) -> DataSourceResult:
        session = await self._get_session()
        search_body = {
            "query": {
                "type": "terminal",
                "service": "full_text",
                "parameters": {"value": query},
            },
            "return_type": "entry",
            "request_options": {
                "paginate": {"start": 0, "rows": min(max_results, 50)},
                "results_content_type": ["experimental"],
            },
        }
        headers = {"Content-Type": "application/json"}
        async with session.post(
            f"{self.base_url}/query", json=search_body, headers=headers,
        ) as resp:
            data = await resp.json() if resp.status == 200 else {}

        hits = data.get("result_set", [])
        total = data.get("total_count", len(hits))
        results = []
        for hit in hits[:max_results]:
            pdb_id = hit.get("identifier", "")
            results.append({
                "pdb_id": pdb_id,
                "score": hit.get("score", 0.0),
                "url": f"https://www.rcsb.org/structure/{pdb_id}",
            })

        return DataSourceResult(
            source=self.name, query=query, total_results=total, results=results,
        )


class MeSHSource(DataSourceBase):
    """MeSH — Medical Subject Headings vocabulary."""

    name = "mesh"
    base_url = "https://id.nlm.nih.gov/mesh"
    category = "ontology"
    phase = 1
    description = "NLM controlled vocabulary for indexing biomedical literature."

    async def search(self, query: str, max_results: int = 20) -> DataSourceResult:
        session = await self._get_session()
        params = {
            "query": query,
            "limit": min(max_results, 50),
            "match": "contains",
        }
        headers = {"Accept": "application/json"}
        async with session.get(
            f"{self.base_url}/sparql", params={
                "query": f'PREFIX meshv: <http://id.nlm.nih.gov/mesh/vocab#> '
                         f'SELECT ?d ?name WHERE {{ ?d a meshv:Descriptor . '
                         f'?d meshv:prefLabel ?name . '
                         f'FILTER(CONTAINS(LCASE(?name), LCASE("{query}"))) }} LIMIT {min(max_results, 50)}',
                "format": "JSON",
            }, headers=headers,
        ) as resp:
            data = await resp.json() if resp.status == 200 else {}

        bindings = data.get("results", {}).get("bindings", [])
        results = []
        for b in bindings[:max_results]:
            uri = b.get("d", {}).get("value", "")
            mesh_id = uri.rsplit("/", 1)[-1] if uri else ""
            results.append({
                "mesh_id": mesh_id,
                "name": b.get("name", {}).get("value", ""),
                "uri": uri,
                "url": f"https://id.nlm.nih.gov/mesh/{mesh_id}.html",
            })

        return DataSourceResult(
            source=self.name, query=query, total_results=len(results), results=results,
        )


class EuropePMCSource(DataSourceBase):
    """Europe PMC — European life science literature."""

    name = "europe_pmc"
    base_url = "https://www.ebi.ac.uk/europepmc/webservices/rest"
    category = "literature"
    phase = 1
    description = "Full-text biomedical and life science literature."

    async def search(self, query: str, max_results: int = 20) -> DataSourceResult:
        session = await self._get_session()
        params = {
            "query": query,
            "resultType": "core",
            "pageSize": min(max_results, 25),
            "format": "json",
            "sort": "RELEVANCE",
        }
        async with session.get(f"{self.base_url}/search", params=params) as resp:
            data = await resp.json()

        result_list = data.get("resultList", {}).get("result", [])
        total = data.get("hitCount", len(result_list))
        results = []
        for article in result_list[:max_results]:
            results.append({
                "id": article.get("id", ""),
                "source": article.get("source", ""),
                "pmid": article.get("pmid", ""),
                "title": article.get("title", ""),
                "authors": article.get("authorString", ""),
                "journal": article.get("journalTitle", ""),
                "pub_year": article.get("pubYear", ""),
                "cited_by": article.get("citedByCount", 0),
                "doi": article.get("doi", ""),
                "url": f"https://europepmc.org/article/{article.get('source', 'MED')}/{article.get('id', '')}",
            })

        return DataSourceResult(
            source=self.name, query=query, total_results=total, results=results,
        )


# ===================================================================
# PHASE 2 STUBS — Specialized & Emerging Sources
# ===================================================================

class GWASCatalogSource(DataSourceBase):
    """NHGRI-EBI GWAS Catalog."""
    name = "gwas_catalog"
    base_url = "https://www.ebi.ac.uk/gwas/rest/api"
    category = "genetics"
    phase = 2
    description = "Genome-wide association study catalog."

    async def search(self, query: str, max_results: int = 20) -> DataSourceResult:
        session = await self._get_session()
        encoded = urllib.parse.quote(query)
        params = {"q": encoded, "size": min(max_results, 20)}
        async with session.get(
            f"{self.base_url}/search/associations", params=params,
        ) as resp:
            data = await resp.json() if resp.status == 200 else {}

        embedded = data.get("_embedded", {})
        associations = embedded.get("associations", [])
        results = []
        for assoc in associations[:max_results]:
            results.append({
                "id": assoc.get("associationId", ""),
                "risk_allele": assoc.get("riskFrequency", ""),
                "p_value": assoc.get("pvalue", ""),
                "trait": ", ".join(
                    t.get("trait", "") for t in assoc.get("efoTraits", [])
                ),
                "region": assoc.get("region", ""),
                "mapped_gene": assoc.get("mappedGene", ""),
            })

        return DataSourceResult(
            source=self.name, query=query, total_results=len(results), results=results,
        )


class ClinVarSource(DataSourceBase):
    """NCBI ClinVar — clinical significance of genomic variants."""
    name = "clinvar"
    base_url = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
    category = "genetics"
    phase = 2
    description = "Relationships between genomic variation and health."

    async def search(self, query: str, max_results: int = 20) -> DataSourceResult:
        session = await self._get_session()
        params = {
            "db": "clinvar",
            "term": query,
            "retmax": min(max_results, 20),
            "retmode": "json",
        }
        api_key = getattr(settings, "NCBI_API_KEY", None)
        if api_key:
            params["api_key"] = api_key

        async with session.get(f"{self.base_url}/esearch.fcgi", params=params) as resp:
            data = await resp.json()

        search_result = data.get("esearchresult", {})
        id_list = search_result.get("idlist", [])
        total = int(search_result.get("count", 0))

        if not id_list:
            return DataSourceResult(source=self.name, query=query, total_results=total)

        # Fetch summaries
        summary_params = {
            "db": "clinvar",
            "id": ",".join(id_list),
            "retmode": "json",
        }
        if api_key:
            summary_params["api_key"] = api_key

        async with session.get(f"{self.base_url}/esummary.fcgi", params=summary_params) as resp:
            summary_data = await resp.json()

        results = []
        for uid in id_list:
            entry = summary_data.get("result", {}).get(uid, {})
            results.append({
                "id": uid,
                "title": entry.get("title", ""),
                "clinical_significance": entry.get("clinical_significance", {}).get("description", ""),
                "gene_sort": entry.get("gene_sort", ""),
                "variation_set": entry.get("variation_set", []),
                "url": f"https://www.ncbi.nlm.nih.gov/clinvar/variation/{uid}/",
            })

        return DataSourceResult(
            source=self.name, query=query, total_results=total, results=results,
        )


class RefSeqSource(DataSourceBase):
    """NCBI RefSeq — reference sequences."""
    name = "refseq"
    base_url = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
    category = "genomics"
    phase = 2
    description = "NCBI reference sequence database."

    async def search(self, query: str, max_results: int = 20) -> DataSourceResult:
        session = await self._get_session()
        params = {
            "db": "nuccore",
            "term": f"{query}[Gene Name] AND refseq[filter]",
            "retmax": min(max_results, 20),
            "retmode": "json",
        }
        api_key = getattr(settings, "NCBI_API_KEY", None)
        if api_key:
            params["api_key"] = api_key

        async with session.get(f"{self.base_url}/esearch.fcgi", params=params) as resp:
            data = await resp.json()

        search_result = data.get("esearchresult", {})
        id_list = search_result.get("idlist", [])
        total = int(search_result.get("count", 0))

        if not id_list:
            return DataSourceResult(source=self.name, query=query, total_results=total)

        summary_params = {
            "db": "nuccore",
            "id": ",".join(id_list),
            "retmode": "json",
        }
        if api_key:
            summary_params["api_key"] = api_key

        async with session.get(f"{self.base_url}/esummary.fcgi", params=summary_params) as resp:
            summary_data = await resp.json()

        results = []
        for uid in id_list:
            entry = summary_data.get("result", {}).get(uid, {})
            results.append({
                "id": uid,
                "accession": entry.get("accessionversion", entry.get("caption", "")),
                "title": entry.get("title", ""),
                "organism": entry.get("organism", ""),
                "length": entry.get("slen", 0),
                "url": f"https://www.ncbi.nlm.nih.gov/nuccore/{uid}",
            })

        return DataSourceResult(
            source=self.name, query=query, total_results=total, results=results,
        )


class GeneCardsSource(DataSourceBase):
    """GeneCards — human gene database."""
    name = "genecards"
    base_url = "https://www.genecards.org"
    category = "genomics"
    phase = 2
    description = "Integrative database of human gene information."

    async def search(self, query: str, max_results: int = 20) -> DataSourceResult:
        session = await self._get_session()
        # Use NCBI Gene as proxy for GeneCards
        params = {
            "db": "gene",
            "term": f"{query}[Gene Name] AND Homo sapiens[Organism]",
            "retmax": min(max_results, 20),
            "retmode": "json",
        }
        api_key = getattr(settings, "NCBI_API_KEY", None)
        if api_key:
            params["api_key"] = api_key

        async with session.get(
            "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi", params=params,
        ) as resp:
            data = await resp.json()

        search_result = data.get("esearchresult", {})
        id_list = search_result.get("idlist", [])
        total = int(search_result.get("count", 0))

        if not id_list:
            return DataSourceResult(source=self.name, query=query, total_results=total)

        summary_params = {
            "db": "gene",
            "id": ",".join(id_list),
            "retmode": "json",
        }
        if api_key:
            summary_params["api_key"] = api_key

        async with session.get(
            "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi", params=summary_params,
        ) as resp:
            summary_data = await resp.json()

        results = []
        for uid in id_list:
            entry = summary_data.get("result", {}).get(uid, {})
            results.append({
                "id": uid,
                "name": entry.get("name", ""),
                "description": entry.get("description", ""),
                "organism": entry.get("organism", {}).get("scientificname", ""),
                "chromosome": entry.get("chromosome", ""),
                "map_location": entry.get("maplocation", ""),
                "url": f"https://www.genecards.org/cgi-bin/carddisp.pl?gene={entry.get('name', query)}",
            })

        return DataSourceResult(
            source=self.name, query=query, total_results=total, results=results,
        )


class OpenTargetsSource(DataSourceBase):
    """Open Targets — drug target identification."""
    name = "open_targets"
    base_url = "https://api.platform.opentargets.org/api/v4/graphql"
    category = "drug"
    phase = 2
    description = "Systematic identification and prioritization of drug targets."

    async def search(self, query: str, max_results: int = 20) -> DataSourceResult:
        session = await self._get_session()
        graphql_query = {
            "query": """
                query SearchQuery($queryString: String!, $size: Int!) {
                    search(queryString: $queryString, entityNames: ["target", "disease", "drug"], page: {size: $size, index: 0}) {
                        total
                        hits {
                            id
                            entity
                            name
                            description
                            score
                        }
                    }
                }
            """,
            "variables": {
                "queryString": query,
                "size": min(max_results, 20),
            },
        }
        headers = {"Content-Type": "application/json"}
        async with session.post(
            self.base_url, json=graphql_query, headers=headers,
        ) as resp:
            data = await resp.json() if resp.status == 200 else {}

        search_data = data.get("data", {}).get("search", {})
        hits = search_data.get("hits", [])
        total = search_data.get("total", len(hits))

        results = []
        for hit in hits[:max_results]:
            results.append({
                "id": hit.get("id", ""),
                "entity": hit.get("entity", ""),
                "name": hit.get("name", ""),
                "description": (hit.get("description") or "")[:300],
                "score": hit.get("score", 0.0),
                "url": f"https://platform.opentargets.org/{hit.get('entity', 'target')}/{hit.get('id', '')}",
            })

        return DataSourceResult(
            source=self.name, query=query, total_results=total, results=results,
        )


class BindingDBSource(DataSourceBase):
    """BindingDB — binding affinities of drug-target interactions."""
    name = "bindingdb"
    base_url = "https://www.bindingdb.org/axis2/services/BDBService"
    category = "drug"
    phase = 2
    description = "Measured binding affinities of protein-ligand interactions."

    async def search(self, query: str, max_results: int = 20) -> DataSourceResult:
        session = await self._get_session()
        encoded = urllib.parse.quote(query)
        try:
            async with session.get(
                f"{self.base_url}/getLigandsByTarget?target={encoded}",
                headers={"Accept": "application/json"},
            ) as resp:
                text = await resp.text()
                # BindingDB may return XML; try JSON first
                try:
                    data = await resp.json() if resp.status == 200 else {}
                except (aiohttp.ContentTypeError, Exception):
                    data = {}
        except Exception:
            data = {}

        items = data if isinstance(data, list) else data.get("results", []) if isinstance(data, dict) else []
        results = []
        for item in items[:max_results]:
            if isinstance(item, dict):
                results.append({
                    "monomer_id": item.get("monomerid", ""),
                    "affinity": item.get("affinity", ""),
                    "affinity_type": item.get("affinityType", ""),
                    "smiles": item.get("smiles", "")[:200],
                    "target": item.get("target", query),
                    "url": f"https://www.bindingdb.org/bind/chemsearch/marvin/MolStructure.jsp?monomerid={item.get('monomerid', '')}",
                })

        return DataSourceResult(
            source=self.name, query=query, total_results=len(results), results=results,
        )


class TTDSource(DataSourceBase):
    """Therapeutic Target Database."""
    name = "ttd"
    base_url = "https://db.idrblab.net/ttd/"
    category = "drug"
    phase = 2
    description = "Therapeutic targets and corresponding drugs."

    async def search(self, query: str, max_results: int = 20) -> DataSourceResult:
        session = await self._get_session()
        encoded = urllib.parse.quote(query)
        try:
            async with session.get(
                f"https://db.idrblab.net/ttd/api/target/search/{encoded}",
                headers={"Accept": "application/json"},
            ) as resp:
                data = await resp.json() if resp.status == 200 else {}
        except (aiohttp.ContentTypeError, Exception):
            data = {}

        targets = data if isinstance(data, list) else data.get("targets", []) if isinstance(data, dict) else []
        results = []
        for target in (targets if isinstance(targets, list) else [])[:max_results]:
            if isinstance(target, dict):
                results.append({
                    "id": target.get("TTD_Target_ID", target.get("id", "")),
                    "name": target.get("Target_Name", target.get("name", "")),
                    "type": target.get("Target_Type", target.get("type", "")),
                    "function": (target.get("Function", target.get("function", "")) or "")[:300],
                    "url": f"https://db.idrblab.net/ttd/data/target/details/{target.get('TTD_Target_ID', target.get('id', ''))}",
                })

        return DataSourceResult(
            source=self.name, query=query, total_results=len(results), results=results,
        )


class SEASource(DataSourceBase):
    """Similarity Ensemble Approach."""
    name = "sea"
    base_url = "https://sea.bkslab.org"
    category = "drug"
    phase = 2
    description = "Relating proteins based on the set-wise chemical similarity of their ligands."

    async def search(self, query: str, max_results: int = 20) -> DataSourceResult:
        session = await self._get_session()
        encoded = urllib.parse.quote(query)
        # Use PubChem as proxy for SEA
        async with session.get(
            f"https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/{encoded}/JSON",
        ) as resp:
            data = await resp.json() if resp.status == 200 else {}

        compounds = data.get("PC_Compounds", [])
        results = []
        for compound in compounds[:max_results]:
            cid = compound.get("id", {}).get("id", {}).get("cid", "")
            props = {}
            for prop in compound.get("props", []):
                label = prop.get("urn", {}).get("label", "")
                value = prop.get("value", {})
                val = value.get("sval", value.get("ival", value.get("fval", "")))
                if label:
                    props[label] = val
            results.append({
                "cid": cid,
                "iupac_name": props.get("IUPAC Name", ""),
                "molecular_formula": props.get("Molecular Formula", ""),
                "molecular_weight": props.get("Molecular Weight", ""),
                "smiles": props.get("SMILES", props.get("Canonical", "")),
                "url": f"https://pubchem.ncbi.nlm.nih.gov/compound/{cid}",
            })

        return DataSourceResult(
            source=self.name, query=query, total_results=len(results), results=results,
        )


class ChemSpiderSource(DataSourceBase):
    """ChemSpider — chemical structure database."""
    name = "chemspider"
    base_url = "https://api.rsc.org/compounds/v1"
    category = "chemistry"
    phase = 2
    description = "Chemical structure database from the Royal Society of Chemistry."

    async def search(self, query: str, max_results: int = 20) -> DataSourceResult:
        session = await self._get_session()
        encoded = urllib.parse.quote(query)
        # Use PubChem as proxy for ChemSpider
        async with session.get(
            f"https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/{encoded}/property/MolecularFormula,MolecularWeight,IUPACName,InChIKey,CanonicalSMILES/JSON",
        ) as resp:
            data = await resp.json() if resp.status == 200 else {}

        properties = data.get("PropertyTable", {}).get("Properties", [])
        results = []
        for prop in properties[:max_results]:
            cid = prop.get("CID", "")
            results.append({
                "cid": cid,
                "molecular_formula": prop.get("MolecularFormula", ""),
                "molecular_weight": prop.get("MolecularWeight", ""),
                "iupac_name": prop.get("IUPACName", ""),
                "inchikey": prop.get("InChIKey", ""),
                "smiles": prop.get("CanonicalSMILES", ""),
                "url": f"https://pubchem.ncbi.nlm.nih.gov/compound/{cid}",
            })

        return DataSourceResult(
            source=self.name, query=query, total_results=len(results), results=results,
        )


class PubChemSource(DataSourceBase):
    """PubChem — open chemistry database."""
    name = "pubchem"
    base_url = "https://pubchem.ncbi.nlm.nih.gov/rest/pug"
    category = "chemistry"
    phase = 2
    description = "Chemical information including structures, properties, and bioactivities."

    async def search(self, query: str, max_results: int = 20) -> DataSourceResult:
        session = await self._get_session()
        encoded = urllib.parse.quote(query)
        async with session.get(
            f"{self.base_url}/compound/name/{encoded}/description/JSON",
        ) as resp:
            data = await resp.json() if resp.status == 200 else {}

        info_list = data.get("InformationList", {}).get("Information", [])
        results = []
        for info in info_list[:max_results]:
            cid = info.get("CID", "")
            results.append({
                "cid": cid,
                "title": info.get("Title", ""),
                "description": (info.get("Description", "") or "")[:500],
                "description_source": info.get("DescriptionSourceName", ""),
                "url": f"https://pubchem.ncbi.nlm.nih.gov/compound/{cid}",
            })

        return DataSourceResult(
            source=self.name, query=query, total_results=len(results), results=results,
        )


class WikiPathwaysSource(DataSourceBase):
    """WikiPathways — community curated pathway database."""
    name = "wikipathways"
    base_url = "https://www.wikipathways.org/json"
    category = "pathway"
    phase = 2
    description = "Open science platform for biological pathways."

    async def search(self, query: str, max_results: int = 20) -> DataSourceResult:
        session = await self._get_session()
        params = {"query": query, "format": "json"}
        async with session.get(
            "https://webservice.wikipathways.org/findPathwaysByText", params=params,
        ) as resp:
            data = await resp.json() if resp.status == 200 else {}

        pathways = data.get("result", []) if isinstance(data, dict) else []
        if not isinstance(pathways, list):
            pathways = []

        results = []
        for pw in pathways[:max_results]:
            results.append({
                "id": pw.get("id", ""),
                "name": pw.get("name", ""),
                "species": pw.get("species", ""),
                "revision": pw.get("revision", ""),
                "url": f"https://www.wikipathways.org/pathways/{pw.get('id', '')}",
            })

        return DataSourceResult(
            source=self.name, query=query, total_results=len(results), results=results,
        )


class BioCycSource(DataSourceBase):
    """BioCyc — metabolic pathway database."""
    name = "biocyc"
    base_url = "https://biocyc.org/xmlquery"
    category = "pathway"
    phase = 2
    description = "Collection of pathway/genome databases."

    async def search(self, query: str, max_results: int = 20) -> DataSourceResult:
        session = await self._get_session()
        encoded = urllib.parse.quote(query)
        # BioCyc requires API key for most endpoints; use basic search
        try:
            async with session.get(
                f"{self.base_url}?query=[x:x<-Human,x^name={encoded}]&detail=full",
                headers={"Accept": "application/json"},
            ) as resp:
                if resp.status == 200:
                    text = await resp.text()
                    try:
                        data = json.loads(text)
                    except (json.JSONDecodeError, Exception):
                        data = {}
                else:
                    data = {}
        except Exception:
            data = {}

        items = data if isinstance(data, list) else data.get("results", []) if isinstance(data, dict) else []
        results = []
        for item in (items if isinstance(items, list) else [])[:max_results]:
            if isinstance(item, dict):
                results.append({
                    "id": item.get("oid", item.get("id", "")),
                    "name": item.get("name", ""),
                    "type": item.get("type", ""),
                    "organism": item.get("organism", ""),
                    "url": f"https://biocyc.org/gene?orgid=HUMAN&id={item.get('oid', item.get('id', ''))}",
                })

        return DataSourceResult(
            source=self.name, query=query, total_results=len(results), results=results,
        )


class HPOSource(DataSourceBase):
    """Human Phenotype Ontology."""
    name = "hpo"
    base_url = "https://ontology.jax.org/api/hp"
    category = "ontology"
    phase = 2
    description = "Standardized vocabulary of phenotypic abnormalities."

    async def search(self, query: str, max_results: int = 20) -> DataSourceResult:
        session = await self._get_session()
        params = {"q": query, "max": min(max_results, 20)}
        headers = {"Accept": "application/json"}
        async with session.get(
            f"{self.base_url}/search", params=params, headers=headers,
        ) as resp:
            data = await resp.json() if resp.status == 200 else {}

        terms = data.get("terms", []) if isinstance(data, dict) else []
        results = []
        for term in (terms if isinstance(terms, list) else [])[:max_results]:
            results.append({
                "id": term.get("id", ""),
                "name": term.get("name", ""),
                "definition": (term.get("definition", "") or "")[:300],
                "synonyms": term.get("synonyms", []),
                "url": f"https://hpo.jax.org/browse/term/{term.get('id', '')}",
            })

        return DataSourceResult(
            source=self.name, query=query, total_results=len(results), results=results,
        )


class DOSource(DataSourceBase):
    """Disease Ontology."""
    name = "disease_ontology"
    base_url = "https://www.disease-ontology.org"
    category = "ontology"
    phase = 2
    description = "Standardized ontology for human disease terms."

    async def search(self, query: str, max_results: int = 20) -> DataSourceResult:
        session = await self._get_session()
        # Use OLS (Ontology Lookup Service) as API for Disease Ontology
        params = {
            "q": query,
            "ontology": "doid",
            "rows": min(max_results, 20),
        }
        headers = {"Accept": "application/json"}
        async with session.get(
            "https://www.ebi.ac.uk/ols4/api/search", params=params, headers=headers,
        ) as resp:
            data = await resp.json() if resp.status == 200 else {}

        docs = data.get("response", {}).get("docs", [])
        total = data.get("response", {}).get("numFound", len(docs))
        results = []
        for doc in docs[:max_results]:
            results.append({
                "id": doc.get("obo_id", doc.get("short_form", "")),
                "label": doc.get("label", ""),
                "description": (doc.get("description", [""])[0] if doc.get("description") else "")[:300],
                "ontology": doc.get("ontology_name", ""),
                "iri": doc.get("iri", ""),
                "url": f"https://www.disease-ontology.org/?id={doc.get('obo_id', '')}",
            })

        return DataSourceResult(
            source=self.name, query=query, total_results=total, results=results,
        )


class ArrayExpressSource(DataSourceBase):
    """ArrayExpress — functional genomics data."""
    name = "arrayexpress"
    base_url = "https://www.ebi.ac.uk/biostudies/api/v1"
    category = "genomics"
    phase = 2
    description = "Functional genomics experiments including gene expression."

    async def search(self, query: str, max_results: int = 20) -> DataSourceResult:
        session = await self._get_session()
        params = {
            "query": query,
            "page": 1,
            "pageSize": min(max_results, 20),
        }
        headers = {"Accept": "application/json"}
        async with session.get(
            f"{self.base_url}/search", params=params, headers=headers,
        ) as resp:
            data = await resp.json() if resp.status == 200 else {}

        hits = data.get("hits", []) if isinstance(data, dict) else []
        total = data.get("totalHits", len(hits))
        results = []
        for hit in (hits if isinstance(hits, list) else [])[:max_results]:
            results.append({
                "accession": hit.get("accession", ""),
                "title": hit.get("title", ""),
                "author": hit.get("author", ""),
                "type": hit.get("type", ""),
                "organism": hit.get("organism", ""),
                "release_date": hit.get("release_date", ""),
                "url": f"https://www.ebi.ac.uk/biostudies/arrayexpress/studies/{hit.get('accession', '')}",
            })

        return DataSourceResult(
            source=self.name, query=query, total_results=total, results=results,
        )


# ===================================================================
# PHASE 3 STUBS — Advanced & Integrative Sources
# ===================================================================

class ICGCSource(DataSourceBase):
    """International Cancer Genome Consortium."""
    name = "icgc"
    base_url = "https://dcc.icgc.org/api/v1"
    category = "cancer"
    phase = 3
    description = "Genomic data from cancer research projects worldwide."

    async def search(self, query: str, max_results: int = 20) -> DataSourceResult:
        session = await self._get_session()
        params = {"q": query, "size": min(max_results, 5)}
        async with session.get(
            f"{self.base_url}/genes", params=params,
        ) as resp:
            data = await resp.json() if resp.status == 200 else {}

        hits = data.get("hits", []) if isinstance(data, dict) else []
        total = data.get("pagination", {}).get("total", len(hits))
        results = []
        for hit in (hits if isinstance(hits, list) else [])[:max_results]:
            results.append({
                "id": hit.get("_gene_id", hit.get("id", "")),
                "symbol": hit.get("symbol", ""),
                "name": hit.get("name", ""),
                "biotype": hit.get("biotype", ""),
                "chromosome": hit.get("chromosome", ""),
                "affected_donors": hit.get("affectedDonorCountTotal", 0),
                "url": f"https://dcc.icgc.org/genes/{hit.get('_gene_id', hit.get('id', ''))}",
            })

        return DataSourceResult(
            source=self.name, query=query, total_results=total, results=results,
        )


class TCGASource(DataSourceBase):
    """The Cancer Genome Atlas."""
    name = "tcga"
    base_url = "https://api.gdc.cancer.gov"
    category = "cancer"
    phase = 3
    description = "Molecular characterization of cancer genomes."

    async def search(self, query: str, max_results: int = 20) -> DataSourceResult:
        session = await self._get_session()
        filters_obj = {
            "op": "in",
            "content": {
                "field": "symbol",
                "value": [query],
            },
        }
        params = {
            "filters": json.dumps(filters_obj),
            "size": min(max_results, 5),
            "format": "JSON",
        }
        async with session.get(
            f"{self.base_url}/genes", params=params,
        ) as resp:
            data = await resp.json() if resp.status == 200 else {}

        hits = data.get("data", {}).get("hits", []) if isinstance(data, dict) else []
        total = data.get("data", {}).get("pagination", {}).get("total", len(hits))
        results = []
        for hit in (hits if isinstance(hits, list) else [])[:max_results]:
            results.append({
                "id": hit.get("gene_id", ""),
                "symbol": hit.get("symbol", ""),
                "name": hit.get("name", ""),
                "biotype": hit.get("biotype", ""),
                "is_cancer_gene_census": hit.get("is_cancer_gene_census", False),
                "url": f"https://portal.gdc.cancer.gov/genes/{hit.get('gene_id', '')}",
            })

        return DataSourceResult(
            source=self.name, query=query, total_results=total, results=results,
        )


class DepMapSource(DataSourceBase):
    """Cancer Dependency Map (DepMap)."""
    name = "depmap"
    base_url = "https://depmap.org/portal/api"
    category = "cancer"
    phase = 3
    description = "Cancer cell line vulnerabilities and dependencies."

    async def search(self, query: str, max_results: int = 20) -> DataSourceResult:
        session = await self._get_session()
        # Use NCBI Gene as proxy for DepMap
        params = {
            "db": "gene",
            "term": f"{query}[Gene Name] AND Homo sapiens[Organism]",
            "retmax": min(max_results, 20),
            "retmode": "json",
        }
        api_key = getattr(settings, "NCBI_API_KEY", None)
        if api_key:
            params["api_key"] = api_key

        async with session.get(
            "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi", params=params,
        ) as resp:
            data = await resp.json()

        search_result = data.get("esearchresult", {})
        id_list = search_result.get("idlist", [])
        total = int(search_result.get("count", 0))

        if not id_list:
            return DataSourceResult(source=self.name, query=query, total_results=total)

        summary_params = {"db": "gene", "id": ",".join(id_list), "retmode": "json"}
        if api_key:
            summary_params["api_key"] = api_key

        async with session.get(
            "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi", params=summary_params,
        ) as resp:
            summary_data = await resp.json()

        results = []
        for uid in id_list:
            entry = summary_data.get("result", {}).get(uid, {})
            results.append({
                "id": uid,
                "name": entry.get("name", ""),
                "description": entry.get("description", ""),
                "organism": entry.get("organism", {}).get("scientificname", ""),
                "chromosome": entry.get("chromosome", ""),
                "url": f"https://depmap.org/portal/gene/{entry.get('name', query)}",
            })

        return DataSourceResult(
            source=self.name, query=query, total_results=total, results=results,
        )


class GTExSource(DataSourceBase):
    """Genotype-Tissue Expression project."""
    name = "gtex"
    base_url = "https://gtexportal.org/api/v2"
    category = "genomics"
    phase = 3
    description = "Gene expression and regulation across human tissues."

    async def search(self, query: str, max_results: int = 20) -> DataSourceResult:
        session = await self._get_session()
        params = {"geneId": query, "page": 0, "itemsPerPage": min(max_results, 20)}
        headers = {"Accept": "application/json"}
        async with session.get(
            f"{self.base_url}/reference/gene", params=params, headers=headers,
        ) as resp:
            data = await resp.json() if resp.status == 200 else {}

        genes = data.get("data", []) if isinstance(data, dict) else []
        total = data.get("paging", {}).get("totalNumberOfItems", len(genes))
        results = []
        for gene in (genes if isinstance(genes, list) else [])[:max_results]:
            results.append({
                "gene_symbol": gene.get("geneSymbol", ""),
                "gencode_id": gene.get("gencodeId", ""),
                "entrez_id": gene.get("entrezGeneId", ""),
                "gene_type": gene.get("geneType", ""),
                "chromosome": gene.get("chromosome", ""),
                "description": gene.get("description", ""),
                "url": f"https://gtexportal.org/home/gene/{gene.get('geneSymbol', query)}",
            })

        return DataSourceResult(
            source=self.name, query=query, total_results=total, results=results,
        )


class EncodeSource(DataSourceBase):
    """Encyclopedia of DNA Elements (ENCODE)."""
    name = "encode"
    base_url = "https://www.encodeproject.org/search"
    category = "genomics"
    phase = 3
    description = "Comprehensive list of functional elements in the human genome."

    async def search(self, query: str, max_results: int = 20) -> DataSourceResult:
        session = await self._get_session()
        params = {
            "searchTerm": query,
            "type": "Experiment",
            "format": "json",
            "limit": min(max_results, 5),
        }
        headers = {"Accept": "application/json"}
        async with session.get(
            "https://www.encodeproject.org/search/", params=params, headers=headers,
        ) as resp:
            data = await resp.json() if resp.status == 200 else {}

        graph = data.get("@graph", []) if isinstance(data, dict) else []
        total = data.get("total", len(graph))
        results = []
        for item in (graph if isinstance(graph, list) else [])[:max_results]:
            results.append({
                "id": item.get("accession", item.get("@id", "")),
                "assay_title": item.get("assay_title", ""),
                "biosample_summary": item.get("biosample_summary", ""),
                "target": item.get("target", {}).get("label", "") if isinstance(item.get("target"), dict) else "",
                "status": item.get("status", ""),
                "lab": item.get("lab", {}).get("title", "") if isinstance(item.get("lab"), dict) else "",
                "url": f"https://www.encodeproject.org{item.get('@id', '')}",
            })

        return DataSourceResult(
            source=self.name, query=query, total_results=total, results=results,
        )


class GEOSource(DataSourceBase):
    """Gene Expression Omnibus."""
    name = "geo"
    base_url = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
    category = "genomics"
    phase = 3
    description = "Public functional genomics data repository."

    async def search(self, query: str, max_results: int = 20) -> DataSourceResult:
        session = await self._get_session()
        params = {
            "db": "gds",
            "term": query,
            "retmax": min(max_results, 20),
            "retmode": "json",
        }
        api_key = getattr(settings, "NCBI_API_KEY", None)
        if api_key:
            params["api_key"] = api_key

        async with session.get(f"{self.base_url}/esearch.fcgi", params=params) as resp:
            data = await resp.json()

        search_result = data.get("esearchresult", {})
        id_list = search_result.get("idlist", [])
        total = int(search_result.get("count", 0))

        if not id_list:
            return DataSourceResult(source=self.name, query=query, total_results=total)

        summary_params = {"db": "gds", "id": ",".join(id_list), "retmode": "json"}
        if api_key:
            summary_params["api_key"] = api_key

        async with session.get(f"{self.base_url}/esummary.fcgi", params=summary_params) as resp:
            summary_data = await resp.json()

        results = []
        for uid in id_list:
            entry = summary_data.get("result", {}).get(uid, {})
            results.append({
                "id": uid,
                "accession": entry.get("accession", ""),
                "title": entry.get("title", ""),
                "summary": (entry.get("summary", "") or "")[:300],
                "platform": entry.get("gpl", ""),
                "organism": entry.get("taxon", ""),
                "url": f"https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc={entry.get('accession', '')}",
            })

        return DataSourceResult(
            source=self.name, query=query, total_results=total, results=results,
        )


class MetabolightsSource(DataSourceBase):
    """MetaboLights — metabolomics experiments and metabolite data."""
    name = "metabolights"
    base_url = "https://www.ebi.ac.uk/metabolights/ws"
    category = "metabolomics"
    phase = 3
    description = "Database for metabolomics experiments and derived information."

    async def search(self, query: str, max_results: int = 20) -> DataSourceResult:
        session = await self._get_session()
        params = {"search": query}
        headers = {"Accept": "application/json"}
        try:
            async with session.get(
                f"{self.base_url}/studies", params=params, headers=headers,
            ) as resp:
                data = await resp.json() if resp.status == 200 else {}
        except (aiohttp.ContentTypeError, Exception):
            data = {}

        studies = data if isinstance(data, list) else data.get("content", data.get("studies", [])) if isinstance(data, dict) else []
        results = []
        for study in (studies if isinstance(studies, list) else [])[:max_results]:
            if isinstance(study, dict):
                results.append({
                    "accession": study.get("accession", study.get("studyIdentifier", "")),
                    "title": study.get("title", study.get("studyTitle", "")),
                    "status": study.get("status", study.get("studyStatus", "")),
                    "organism": study.get("organism", ""),
                    "url": f"https://www.ebi.ac.uk/metabolights/{study.get('accession', study.get('studyIdentifier', ''))}",
                })
            elif isinstance(study, str):
                results.append({
                    "accession": study,
                    "url": f"https://www.ebi.ac.uk/metabolights/{study}",
                })

        return DataSourceResult(
            source=self.name, query=query, total_results=len(results), results=results,
        )


class HMDBSource(DataSourceBase):
    """Human Metabolome Database."""
    name = "hmdb"
    base_url = "https://hmdb.ca/unearth/q"
    category = "metabolomics"
    phase = 3
    description = "Small molecule metabolites found in the human body."

    async def search(self, query: str, max_results: int = 20) -> DataSourceResult:
        session = await self._get_session()
        encoded = urllib.parse.quote(query)
        # HMDB doesn't have a great JSON API; use their search endpoint
        try:
            async with session.get(
                f"{self.base_url}?query={encoded}&searcher=metabolites&button=",
                headers={"Accept": "application/json"},
            ) as resp:
                if resp.status == 200:
                    try:
                        data = await resp.json()
                    except (aiohttp.ContentTypeError, Exception):
                        # HMDB returns HTML; parse minimally
                        data = {}
                else:
                    data = {}
        except Exception:
            data = {}

        items = data if isinstance(data, list) else data.get("results", []) if isinstance(data, dict) else []
        results = []
        for item in (items if isinstance(items, list) else [])[:max_results]:
            if isinstance(item, dict):
                results.append({
                    "id": item.get("accession", item.get("id", "")),
                    "name": item.get("name", ""),
                    "chemical_formula": item.get("chemical_formula", ""),
                    "monoisotopic_mass": item.get("monisotopic_mass", ""),
                    "url": f"https://hmdb.ca/metabolites/{item.get('accession', item.get('id', ''))}",
                })

        # If HTML response yielded no results, return with a search URL
        if not results:
            return DataSourceResult(
                source=self.name,
                query=query,
                total_results=0,
                results=[],
                metadata={"search_url": f"https://hmdb.ca/unearth/q?query={encoded}&searcher=metabolites"},
            )

        return DataSourceResult(
            source=self.name, query=query, total_results=len(results), results=results,
        )


class SNPediaSource(DataSourceBase):
    """SNPedia — wiki about human genetics."""
    name = "snpedia"
    base_url = "https://bots.snpedia.com/api.php"
    category = "genetics"
    phase = 3
    description = "Wiki investigating human genetics with emphasis on SNPs."

    async def search(self, query: str, max_results: int = 20) -> DataSourceResult:
        session = await self._get_session()
        # Use dbSNP via NCBI as proxy for SNPedia
        params = {
            "db": "snp",
            "term": query,
            "retmax": min(max_results, 20),
            "retmode": "json",
        }
        api_key = getattr(settings, "NCBI_API_KEY", None)
        if api_key:
            params["api_key"] = api_key

        async with session.get(
            "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi", params=params,
        ) as resp:
            data = await resp.json()

        search_result = data.get("esearchresult", {})
        id_list = search_result.get("idlist", [])
        total = int(search_result.get("count", 0))

        if not id_list:
            return DataSourceResult(source=self.name, query=query, total_results=total)

        summary_params = {"db": "snp", "id": ",".join(id_list), "retmode": "json"}
        if api_key:
            summary_params["api_key"] = api_key

        async with session.get(
            "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi", params=summary_params,
        ) as resp:
            summary_data = await resp.json()

        results = []
        for uid in id_list:
            entry = summary_data.get("result", {}).get(uid, {})
            results.append({
                "id": f"rs{uid}",
                "snp_id": uid,
                "chromosome": entry.get("chr", ""),
                "genes": entry.get("genes", []),
                "clinical_significance": entry.get("clinical_significance", ""),
                "global_maf": entry.get("global_maf", ""),
                "url": f"https://www.snpedia.com/index.php/Rs{uid}",
            })

        return DataSourceResult(
            source=self.name, query=query, total_results=total, results=results,
        )


class ProteomicsDBSource(DataSourceBase):
    """ProteomicsDB — human proteome database."""
    name = "proteomicsdb"
    base_url = "https://www.proteomicsdb.org/proteomicsdb/logic/api"
    category = "protein"
    phase = 3
    description = "Human proteome data from mass spectrometry experiments."

    async def search(self, query: str, max_results: int = 20) -> DataSourceResult:
        session = await self._get_session()
        encoded = urllib.parse.quote(query)
        try:
            async with session.get(
                f"https://www.proteomicsdb.org/logic/api/proteinSearch.xsodata/InputParams(SEARCH_STR='{encoded}')/Results?$format=json",
                headers={"Accept": "application/json"},
            ) as resp:
                data = await resp.json() if resp.status == 200 else {}
        except (aiohttp.ContentTypeError, Exception):
            data = {}

        results_data = data.get("d", {}).get("results", []) if isinstance(data, dict) else []
        results = []
        for item in (results_data if isinstance(results_data, list) else [])[:max_results]:
            results.append({
                "protein_id": item.get("PROTEIN_ID", ""),
                "protein_name": item.get("PROTEIN_NAME", ""),
                "gene_name": item.get("GENE_NAME", ""),
                "organism": item.get("ORGANISM", ""),
                "unique_peptides": item.get("UNIQUE_PEPTIDES", 0),
                "coverage": item.get("COVERAGE", ""),
                "url": f"https://www.proteomicsdb.org/proteomicsdb/#protein/proteinDetails/{item.get('PROTEIN_ID', '')}",
            })

        return DataSourceResult(
            source=self.name, query=query, total_results=len(results), results=results,
        )


class SignaLinkSource(DataSourceBase):
    """SignaLink — signaling pathway resources."""
    name = "signalink"
    base_url = "http://signalink.org/api"
    category = "pathway"
    phase = 3
    description = "Signaling pathway cross-talks, transcription factors, and miRNAs."

    async def search(self, query: str, max_results: int = 20) -> DataSourceResult:
        session = await self._get_session()
        # Use STRING as proxy for SignaLink
        params = {
            "identifiers": query,
            "species": 9606,
            "limit": min(max_results, 20),
            "caller_identity": "humanovo",
        }
        async with session.get(
            "https://string-db.org/api/json/network", params=params,
        ) as resp:
            data = await resp.json() if resp.status == 200 else []

        if not isinstance(data, list):
            data = []

        results = []
        for interaction in data[:max_results]:
            results.append({
                "protein_a": interaction.get("preferredName_A", ""),
                "protein_b": interaction.get("preferredName_B", ""),
                "score": interaction.get("score", 0.0),
                "nscore": interaction.get("nscore", 0.0),
                "escore": interaction.get("escore", 0.0),
                "dscore": interaction.get("dscore", 0.0),
                "url": f"https://string-db.org/network/{interaction.get('stringId_A', '')}",
            })

        return DataSourceResult(
            source=self.name, query=query, total_results=len(results), results=results,
        )


class DGIdbSource(DataSourceBase):
    """Drug Gene Interaction Database."""
    name = "dgidb"
    base_url = "https://dgidb.org/api/v2"
    category = "drug"
    phase = 3
    description = "Drug-gene interactions and druggable genome information."

    async def search(self, query: str, max_results: int = 20) -> DataSourceResult:
        session = await self._get_session()
        params = {"genes": query}
        headers = {"Accept": "application/json"}
        async with session.get(
            f"{self.base_url}/interactions.json", params=params, headers=headers,
        ) as resp:
            data = await resp.json() if resp.status == 200 else {}

        interactions = data.get("matchedTerms", []) if isinstance(data, dict) else []
        results = []
        for term in (interactions if isinstance(interactions, list) else [])[:max_results]:
            gene_name = term.get("geneName", "")
            for interaction in term.get("interactions", [])[:max_results]:
                results.append({
                    "gene": gene_name,
                    "drug_name": interaction.get("drugName", ""),
                    "interaction_types": interaction.get("interactionTypes", []),
                    "sources": interaction.get("sources", []),
                    "pmids": interaction.get("pmids", []),
                    "score": interaction.get("score", 0.0),
                    "url": f"https://dgidb.org/genes/{gene_name}",
                })
                if len(results) >= max_results:
                    break

        return DataSourceResult(
            source=self.name, query=query, total_results=len(results), results=results,
        )


class SIDERSource(DataSourceBase):
    """SIDER — side effect resource."""
    name = "sider"
    base_url = "http://sideeffects.embl.de/api"
    category = "drug"
    phase = 3
    description = "Information on marketed medicines and their adverse drug reactions."

    async def search(self, query: str, max_results: int = 20) -> DataSourceResult:
        session = await self._get_session()
        encoded = urllib.parse.quote(query)
        # Use PubChem as proxy for SIDER
        async with session.get(
            f"https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/{encoded}/property/IUPACName,MolecularFormula,MolecularWeight/JSON",
        ) as resp:
            data = await resp.json() if resp.status == 200 else {}

        properties = data.get("PropertyTable", {}).get("Properties", [])
        results = []
        for prop in properties[:max_results]:
            cid = prop.get("CID", "")
            results.append({
                "cid": cid,
                "iupac_name": prop.get("IUPACName", ""),
                "molecular_formula": prop.get("MolecularFormula", ""),
                "molecular_weight": prop.get("MolecularWeight", ""),
                "drug_name": query,
                "url": f"https://pubchem.ncbi.nlm.nih.gov/compound/{cid}",
            })

        return DataSourceResult(
            source=self.name, query=query, total_results=len(results), results=results,
            metadata={"proxy": "PubChem (SIDER lacks public API)"},
        )


class STITCHSource(DataSourceBase):
    """STITCH — chemical-protein interactions."""
    name = "stitch"
    base_url = "http://stitch.embl.de/api"
    category = "interaction"
    phase = 3
    description = "Known and predicted interactions between chemicals and proteins."

    async def search(self, query: str, max_results: int = 20) -> DataSourceResult:
        session = await self._get_session()
        params = {
            "identifiers": query,
            "species": 9606,
            "limit": min(max_results, 20),
            "network_type": "physical",
            "caller_identity": "humanovo",
        }
        async with session.get(
            "https://string-db.org/api/json/network", params=params,
        ) as resp:
            data = await resp.json() if resp.status == 200 else []

        if not isinstance(data, list):
            data = []

        results = []
        for interaction in data[:max_results]:
            results.append({
                "protein_a": interaction.get("preferredName_A", ""),
                "protein_b": interaction.get("preferredName_B", ""),
                "score": interaction.get("score", 0.0),
                "nscore": interaction.get("nscore", 0.0),
                "escore": interaction.get("escore", 0.0),
                "dscore": interaction.get("dscore", 0.0),
                "url": f"https://string-db.org/network/{interaction.get('stringId_A', '')}",
            })

        return DataSourceResult(
            source=self.name, query=query, total_results=len(results), results=results,
        )


# ===================================================================
# PHASE 4 STUBS — Niche, Regional & Specialized Sources
# ===================================================================

class MirBaseSource(DataSourceBase):
    """miRBase — microRNA database."""
    name = "mirbase"
    base_url = "https://mirbase.org/api"
    category = "genomics"
    phase = 4
    description = "Published miRNA sequences and annotation."

    async def search(self, query: str, max_results: int = 20) -> DataSourceResult:
        session = await self._get_session()
        encoded = urllib.parse.quote(query)
        headers = {"Accept": "application/json"}
        try:
            async with session.get(
                f"https://mirbase.org/results/?query={encoded}", headers=headers,
            ) as resp:
                if resp.status == 200:
                    try:
                        data = await resp.json()
                    except (aiohttp.ContentTypeError, Exception):
                        data = {}
                else:
                    data = {}
        except Exception:
            data = {}

        items = data if isinstance(data, list) else data.get("results", []) if isinstance(data, dict) else []
        results = []
        for item in (items if isinstance(items, list) else [])[:max_results]:
            if isinstance(item, dict):
                results.append({
                    "id": item.get("mirbase_id", item.get("id", "")),
                    "accession": item.get("mirbase_acc", item.get("accession", "")),
                    "name": item.get("name", ""),
                    "sequence": (item.get("sequence", "") or "")[:100],
                    "organism": item.get("organism", ""),
                    "url": f"https://mirbase.org/mature/{item.get('mirbase_acc', item.get('accession', ''))}",
                })

        if not results:
            return DataSourceResult(
                source=self.name, query=query, total_results=0, results=[],
                metadata={"search_url": f"https://mirbase.org/results/?query={encoded}"},
            )

        return DataSourceResult(
            source=self.name, query=query, total_results=len(results), results=results,
        )


class RFamSource(DataSourceBase):
    """Rfam — RNA families database."""
    name = "rfam"
    base_url = "https://rfam.org/search"
    category = "genomics"
    phase = 4
    description = "Collection of non-coding RNA families."

    async def search(self, query: str, max_results: int = 20) -> DataSourceResult:
        session = await self._get_session()
        encoded = urllib.parse.quote(query)
        headers = {"Accept": "application/json"}
        async with session.get(
            f"https://rfam.org/search/keyword/{encoded}",
            params={"content-type": "application/json"},
            headers=headers,
        ) as resp:
            if resp.status == 200:
                try:
                    data = await resp.json()
                except (aiohttp.ContentTypeError, Exception):
                    data = {}
            else:
                data = {}

        hits = data.get("results", []) if isinstance(data, dict) else []
        total = data.get("total", len(hits)) if isinstance(data, dict) else 0
        results = []
        for hit in (hits if isinstance(hits, list) else [])[:max_results]:
            results.append({
                "accession": hit.get("acc", hit.get("rfam_acc", "")),
                "id": hit.get("id", hit.get("rfam_id", "")),
                "description": (hit.get("description", "") or "")[:300],
                "type": hit.get("type", ""),
                "num_seed": hit.get("num_seed", 0),
                "url": f"https://rfam.org/family/{hit.get('acc', hit.get('rfam_acc', ''))}",
            })

        return DataSourceResult(
            source=self.name, query=query, total_results=total, results=results,
        )


class PFamSource(DataSourceBase):
    """Pfam (InterPro) — protein families database."""
    name = "pfam"
    base_url = "https://www.ebi.ac.uk/interpro/api"
    category = "protein"
    phase = 4
    description = "Protein families, domains, and functional sites."

    async def search(self, query: str, max_results: int = 20) -> DataSourceResult:
        session = await self._get_session()
        params = {"search": query, "page_size": min(max_results, 5)}
        headers = {"Accept": "application/json"}
        async with session.get(
            f"{self.base_url}/entry/pfam", params=params, headers=headers,
        ) as resp:
            data = await resp.json() if resp.status == 200 else {}

        entries = data.get("results", []) if isinstance(data, dict) else []
        total = data.get("count", len(entries))
        results = []
        for entry in (entries if isinstance(entries, list) else [])[:max_results]:
            metadata = entry.get("metadata", entry)
            results.append({
                "accession": metadata.get("accession", ""),
                "name": metadata.get("name", {}).get("short", metadata.get("name", "")),
                "type": metadata.get("type", ""),
                "source_database": metadata.get("source_database", ""),
                "member_databases": metadata.get("member_databases", {}),
                "go_terms": metadata.get("go_terms", []),
                "url": f"https://www.ebi.ac.uk/interpro/entry/pfam/{metadata.get('accession', '')}",
            })

        return DataSourceResult(
            source=self.name, query=query, total_results=total, results=results,
        )


class LINCsSource(DataSourceBase):
    """LINCS — Library of Integrated Network-Based Cellular Signatures."""
    name = "lincs"
    base_url = "https://maayanlab.cloud/sigcom-lincs/api"
    category = "genomics"
    phase = 4
    description = "Cellular responses to chemical, genetic, and disease perturbations."

    async def search(self, query: str, max_results: int = 20) -> DataSourceResult:
        session = await self._get_session()
        params = {"query": query}
        headers = {"Accept": "application/json"}
        try:
            async with session.get(
                f"{self.base_url}/search", params=params, headers=headers,
            ) as resp:
                data = await resp.json() if resp.status == 200 else {}
        except (aiohttp.ContentTypeError, Exception):
            data = {}

        items = data if isinstance(data, list) else data.get("results", data.get("entities", [])) if isinstance(data, dict) else []
        results = []
        for item in (items if isinstance(items, list) else [])[:max_results]:
            if isinstance(item, dict):
                results.append({
                    "id": item.get("id", ""),
                    "name": item.get("name", ""),
                    "type": item.get("type", ""),
                    "description": (item.get("description", "") or "")[:300],
                    "url": f"https://maayanlab.cloud/sigcom-lincs/#/Perturbations/{item.get('id', '')}",
                })

        return DataSourceResult(
            source=self.name, query=query, total_results=len(results), results=results,
        )


class CellosaurusSource(DataSourceBase):
    """Cellosaurus — cell line knowledge resource."""
    name = "cellosaurus"
    base_url = "https://api.cellosaurus.org"
    category = "cell_lines"
    phase = 4
    description = "Knowledge resource on cell lines used in biomedical research."

    async def search(self, query: str, max_results: int = 20) -> DataSourceResult:
        session = await self._get_session()
        encoded = urllib.parse.quote(query)
        headers = {"Accept": "application/json"}
        async with session.get(
            f"https://api.cellosaurus.org/search/cell-line?q={encoded}&rows={min(max_results, 20)}&format=json",
            headers=headers,
        ) as resp:
            if resp.status == 200:
                try:
                    data = await resp.json()
                except (aiohttp.ContentTypeError, Exception):
                    data = {}
            else:
                data = {}

        cell_lines = data.get("result", {}).get("cell-line-list", []) if isinstance(data, dict) else []
        total = data.get("result", {}).get("nb-results", len(cell_lines)) if isinstance(data, dict) else 0
        results = []
        for cl in (cell_lines if isinstance(cell_lines, list) else [])[:max_results]:
            accession = cl.get("accession", "")
            name = cl.get("name", "")
            results.append({
                "accession": accession,
                "name": name,
                "category": cl.get("category", ""),
                "sex": cl.get("sex", ""),
                "species": cl.get("species-list", [{}])[0].get("species", "") if cl.get("species-list") else "",
                "url": f"https://www.cellosaurus.org/{accession}",
            })

        return DataSourceResult(
            source=self.name, query=query, total_results=total, results=results,
        )


class ZincSource(DataSourceBase):
    """ZINC — commercially available compounds for virtual screening."""
    name = "zinc"
    base_url = "https://zinc15.docking.org/substances/search"
    category = "chemistry"
    phase = 4
    description = "Free database of commercially-available compounds for virtual screening."

    async def search(self, query: str, max_results: int = 20) -> DataSourceResult:
        session = await self._get_session()
        encoded = urllib.parse.quote(query)
        headers = {"Accept": "application/json"}
        try:
            async with session.get(
                f"https://zinc15.docking.org/substances/search/?q={encoded}&page_size={min(max_results, 5)}&output_format=json",
                headers=headers,
            ) as resp:
                if resp.status == 200:
                    try:
                        data = await resp.json()
                    except (aiohttp.ContentTypeError, Exception):
                        data = {}
                else:
                    data = {}
        except Exception:
            data = {}

        substances = data if isinstance(data, list) else data.get("substances", data.get("results", [])) if isinstance(data, dict) else []
        results = []
        for sub in (substances if isinstance(substances, list) else [])[:max_results]:
            if isinstance(sub, dict):
                zinc_id = sub.get("zinc_id", sub.get("id", ""))
                results.append({
                    "zinc_id": zinc_id,
                    "name": sub.get("name", sub.get("preferred_name", "")),
                    "smiles": (sub.get("smiles", "") or "")[:200],
                    "molecular_weight": sub.get("mw", sub.get("molecular_weight", "")),
                    "logp": sub.get("logp", ""),
                    "url": f"https://zinc15.docking.org/substances/{zinc_id}/",
                })

        return DataSourceResult(
            source=self.name, query=query, total_results=len(results), results=results,
        )


class SuperTargetSource(DataSourceBase):
    """SuperTarget — drug-target interactions."""
    name = "supertarget"
    base_url = "http://insilico.charite.de/supertarget/rest"
    category = "drug"
    phase = 4
    description = "Drug-target relations with side effects and GO annotations."

    async def search(self, query: str, max_results: int = 20) -> DataSourceResult:
        session = await self._get_session()
        encoded = urllib.parse.quote(query)
        # Use PubChem as proxy for SuperTarget
        async with session.get(
            f"https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/{encoded}/property/IUPACName,MolecularFormula,MolecularWeight,CanonicalSMILES/JSON",
        ) as resp:
            data = await resp.json() if resp.status == 200 else {}

        properties = data.get("PropertyTable", {}).get("Properties", [])
        results = []
        for prop in properties[:max_results]:
            cid = prop.get("CID", "")
            results.append({
                "cid": cid,
                "iupac_name": prop.get("IUPACName", ""),
                "molecular_formula": prop.get("MolecularFormula", ""),
                "molecular_weight": prop.get("MolecularWeight", ""),
                "smiles": prop.get("CanonicalSMILES", ""),
                "drug_name": query,
                "url": f"https://pubchem.ncbi.nlm.nih.gov/compound/{cid}",
            })

        return DataSourceResult(
            source=self.name, query=query, total_results=len(results), results=results,
            metadata={"proxy": "PubChem (SuperTarget lacks public API)"},
        )


class OrphanetSource(DataSourceBase):
    """Orphanet — portal for rare diseases."""
    name = "orphanet"
    base_url = "https://api.orphadata.com"
    category = "disease"
    phase = 4
    description = "Reference portal for information on rare diseases and orphan drugs."

    async def search(self, query: str, max_results: int = 20) -> DataSourceResult:
        session = await self._get_session()
        params = {"query": query}
        headers = {"Accept": "application/json"}
        try:
            async with session.get(
                f"{self.base_url}/rd-cross-referencing/orphacodes", params=params, headers=headers,
            ) as resp:
                data = await resp.json() if resp.status == 200 else {}
        except (aiohttp.ContentTypeError, Exception):
            data = {}

        items = data if isinstance(data, list) else data.get("results", data.get("data", [])) if isinstance(data, dict) else []
        results = []
        for item in (items if isinstance(items, list) else [])[:max_results]:
            if isinstance(item, dict):
                orpha_code = item.get("ORPHAcode", item.get("orphacode", ""))
                results.append({
                    "orpha_code": orpha_code,
                    "name": item.get("Preferred term", item.get("name", item.get("preferredTerm", ""))),
                    "definition": (item.get("Definition", item.get("definition", "")) or "")[:300],
                    "references": item.get("References", item.get("references", [])),
                    "url": f"https://www.orpha.net/en/disease/detail/{orpha_code}",
                })

        return DataSourceResult(
            source=self.name, query=query, total_results=len(results), results=results,
        )


class MalaCardsSource(DataSourceBase):
    """MalaCards — human disease database."""
    name = "malacards"
    base_url = "https://www.malacards.org"
    category = "disease"
    phase = 4
    description = "Human diseases and their annotations integrated from multiple sources."

    async def search(self, query: str, max_results: int = 20) -> DataSourceResult:
        session = await self._get_session()
        # Use NCBI Gene as proxy for MalaCards
        params = {
            "db": "gene",
            "term": f"{query}[Gene Name] AND Homo sapiens[Organism]",
            "retmax": min(max_results, 20),
            "retmode": "json",
        }
        api_key = getattr(settings, "NCBI_API_KEY", None)
        if api_key:
            params["api_key"] = api_key

        async with session.get(
            "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi", params=params,
        ) as resp:
            data = await resp.json()

        search_result = data.get("esearchresult", {})
        id_list = search_result.get("idlist", [])
        total = int(search_result.get("count", 0))

        if not id_list:
            return DataSourceResult(source=self.name, query=query, total_results=total)

        summary_params = {"db": "gene", "id": ",".join(id_list), "retmode": "json"}
        if api_key:
            summary_params["api_key"] = api_key

        async with session.get(
            "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi", params=summary_params,
        ) as resp:
            summary_data = await resp.json()

        results = []
        for uid in id_list:
            entry = summary_data.get("result", {}).get(uid, {})
            results.append({
                "id": uid,
                "name": entry.get("name", ""),
                "description": entry.get("description", ""),
                "organism": entry.get("organism", {}).get("scientificname", ""),
                "chromosome": entry.get("chromosome", ""),
                "map_location": entry.get("maplocation", ""),
                "url": f"https://www.malacards.org/card/{entry.get('name', query).lower()}",
            })

        return DataSourceResult(
            source=self.name, query=query, total_results=total, results=results,
            metadata={"proxy": "NCBI Gene (MalaCards lacks public API)"},
        )


class MINTSource(DataSourceBase):
    """MINT — Molecular Interaction Database."""
    name = "mint"
    base_url = "https://mint.bio.uniroma2.it"
    category = "interaction"
    phase = 4
    description = "Experimentally verified protein-protein interactions."

    async def search(self, query: str, max_results: int = 20) -> DataSourceResult:
        session = await self._get_session()
        # Use STRING as proxy for MINT
        params = {
            "identifiers": query,
            "species": 9606,
            "limit": min(max_results, 20),
            "caller_identity": "humanovo",
        }
        async with session.get(
            "https://string-db.org/api/json/network", params=params,
        ) as resp:
            data = await resp.json() if resp.status == 200 else []

        if not isinstance(data, list):
            data = []

        results = []
        for interaction in data[:max_results]:
            results.append({
                "protein_a": interaction.get("preferredName_A", ""),
                "protein_b": interaction.get("preferredName_B", ""),
                "score": interaction.get("score", 0.0),
                "nscore": interaction.get("nscore", 0.0),
                "escore": interaction.get("escore", 0.0),
                "dscore": interaction.get("dscore", 0.0),
                "url": f"https://string-db.org/network/{interaction.get('stringId_A', '')}",
            })

        return DataSourceResult(
            source=self.name, query=query, total_results=len(results), results=results,
            metadata={"proxy": "STRING (MINT lacks public REST API)"},
        )


class BioModelsSource(DataSourceBase):
    """BioModels — mathematical models of biological systems."""
    name = "biomodels"
    base_url = "https://www.ebi.ac.uk/biomodels/search"
    category = "systems_biology"
    phase = 4
    description = "Repository of computational models of biological processes."

    async def search(self, query: str, max_results: int = 20) -> DataSourceResult:
        session = await self._get_session()
        params = {"query": query, "numResults": min(max_results, 20), "format": "json"}
        headers = {"Accept": "application/json"}
        async with session.get(
            "https://www.ebi.ac.uk/biomodels/search", params=params, headers=headers,
        ) as resp:
            data = await resp.json() if resp.status == 200 else {}

        models = data.get("models", []) if isinstance(data, dict) else []
        total = data.get("matches", len(models))
        results = []
        for model in (models if isinstance(models, list) else [])[:max_results]:
            results.append({
                "id": model.get("id", ""),
                "name": model.get("name", ""),
                "description": (model.get("description", "") or "")[:300],
                "format": model.get("format", {}).get("name", ""),
                "publication_id": model.get("publication", {}).get("link", ""),
                "url": f"https://www.ebi.ac.uk/biomodels/{model.get('id', '')}",
            })

        return DataSourceResult(
            source=self.name, query=query, total_results=total, results=results,
        )


class CellMarkerSource(DataSourceBase):
    """CellMarker — cell marker database."""
    name = "cellmarker"
    base_url = "http://xteam.xbio.top/CellMarker/api"
    category = "cell_biology"
    phase = 4
    description = "Cell markers for various cell types from human and mouse."

    async def search(self, query: str, max_results: int = 20) -> DataSourceResult:
        session = await self._get_session()
        # Use NCBI Gene as proxy for CellMarker
        params = {
            "db": "gene",
            "term": f"{query}[Gene Name] AND Homo sapiens[Organism]",
            "retmax": min(max_results, 20),
            "retmode": "json",
        }
        api_key = getattr(settings, "NCBI_API_KEY", None)
        if api_key:
            params["api_key"] = api_key

        async with session.get(
            "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi", params=params,
        ) as resp:
            data = await resp.json()

        search_result = data.get("esearchresult", {})
        id_list = search_result.get("idlist", [])
        total = int(search_result.get("count", 0))

        if not id_list:
            return DataSourceResult(source=self.name, query=query, total_results=total)

        summary_params = {"db": "gene", "id": ",".join(id_list), "retmode": "json"}
        if api_key:
            summary_params["api_key"] = api_key

        async with session.get(
            "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi", params=summary_params,
        ) as resp:
            summary_data = await resp.json()

        results = []
        for uid in id_list:
            entry = summary_data.get("result", {}).get(uid, {})
            results.append({
                "id": uid,
                "name": entry.get("name", ""),
                "description": entry.get("description", ""),
                "organism": entry.get("organism", {}).get("scientificname", ""),
                "chromosome": entry.get("chromosome", ""),
                "url": f"https://www.ncbi.nlm.nih.gov/gene/{uid}",
            })

        return DataSourceResult(
            source=self.name, query=query, total_results=total, results=results,
            metadata={"proxy": "NCBI Gene (CellMarker lacks public API)"},
        )


# ===================================================================
# SOURCE REGISTRY
# ===================================================================

# All source classes indexed by name
ALL_SOURCE_CLASSES: dict[str, type[DataSourceBase]] = {
    # Phase 1 — Fully implemented
    "pubmed": PubMedSource,
    "clinicaltrials": ClinicalTrialsSource,
    "openfda": OpenFDASource,
    "uniprot": UniProtSource,
    "kegg": KEGGSource,
    "drugbank": DrugBankSource,
    "chembl": ChEMBLSource,
    "disgenet": DisGeNETSource,
    "string": STRINGSource,
    "reactome": ReactomeSource,
    "omim": OMIMSource,
    "pharmgkb": PharmGKBSource,
    "gene_ontology": GeneOntologySource,
    "human_protein_atlas": HumanProteinAtlasSource,
    "cosmic": COSMICSource,
    "intact": IntActSource,
    "biogrid": BioGRIDSource,
    "ensembl": EnsemblSource,
    "pdb": PDBSource,
    "mesh": MeSHSource,
    "europe_pmc": EuropePMCSource,
    # Phase 2
    "gwas_catalog": GWASCatalogSource,
    "clinvar": ClinVarSource,
    "refseq": RefSeqSource,
    "genecards": GeneCardsSource,
    "open_targets": OpenTargetsSource,
    "bindingdb": BindingDBSource,
    "ttd": TTDSource,
    "sea": SEASource,
    "chemspider": ChemSpiderSource,
    "pubchem": PubChemSource,
    "wikipathways": WikiPathwaysSource,
    "biocyc": BioCycSource,
    "hpo": HPOSource,
    "disease_ontology": DOSource,
    "arrayexpress": ArrayExpressSource,
    # Phase 3
    "icgc": ICGCSource,
    "tcga": TCGASource,
    "depmap": DepMapSource,
    "gtex": GTExSource,
    "encode": EncodeSource,
    "geo": GEOSource,
    "metabolights": MetabolightsSource,
    "hmdb": HMDBSource,
    "snpedia": SNPediaSource,
    "proteomicsdb": ProteomicsDBSource,
    "signalink": SignaLinkSource,
    "dgidb": DGIdbSource,
    "sider": SIDERSource,
    "stitch": STITCHSource,
    # Phase 4
    "mirbase": MirBaseSource,
    "rfam": RFamSource,
    "pfam": PFamSource,
    "lincs": LINCsSource,
    "cellosaurus": CellosaurusSource,
    "zinc": ZincSource,
    "supertarget": SuperTargetSource,
    "orphanet": OrphanetSource,
    "malacards": MalaCardsSource,
    "mint": MINTSource,
    "biomodels": BioModelsSource,
    "cellmarker": CellMarkerSource,
}

PHASE_1_SOURCES = [k for k, v in ALL_SOURCE_CLASSES.items() if v.phase == 1]
PHASE_2_SOURCES = [k for k, v in ALL_SOURCE_CLASSES.items() if v.phase == 2]
PHASE_3_SOURCES = [k for k, v in ALL_SOURCE_CLASSES.items() if v.phase == 3]
PHASE_4_SOURCES = [k for k, v in ALL_SOURCE_CLASSES.items() if v.phase == 4]


# ===================================================================
# ORCHESTRATOR
# ===================================================================

class DataSourceOrchestrator:
    """Coordinates queries across multiple biomedical data sources."""

    def __init__(self, source_names: Optional[list[str]] = None) -> None:
        """Initialize with optional list of source names. Defaults to Phase 1."""
        if source_names is None:
            source_names = PHASE_1_SOURCES
        self._sources: dict[str, DataSourceBase] = {}
        for name in source_names:
            cls = ALL_SOURCE_CLASSES.get(name)
            if cls:
                self._sources[name] = cls()
            else:
                logger.warning("unknown_data_source", name=name)

    async def close(self) -> None:
        """Close all HTTP sessions."""
        for source in self._sources.values():
            await source.close()

    async def query_all(
        self, query: str, max_results: int = 10, concurrency: int = 5,
    ) -> list[DataSourceResult]:
        """Query all active sources concurrently with limited concurrency."""
        semaphore = asyncio.Semaphore(concurrency)

        async def _limited(src: DataSourceBase) -> DataSourceResult:
            async with semaphore:
                return await src._safe_search(query, max_results)

        tasks = [_limited(src) for src in self._sources.values()]
        return list(await asyncio.gather(*tasks))

    async def query_category(
        self, query: str, category: str, max_results: int = 10,
    ) -> list[DataSourceResult]:
        """Query only sources matching a given category."""
        matching = {
            name: src for name, src in self._sources.items() if src.category == category
        }
        if not matching:
            logger.warning("no_sources_for_category", category=category)
            return []

        tasks = [src._safe_search(query, max_results) for src in matching.values()]
        return list(await asyncio.gather(*tasks))

    async def query_sources(
        self, query: str, source_names: list[str], max_results: int = 10,
    ) -> list[DataSourceResult]:
        """Query a specific subset of sources by name."""
        targets = {
            name: self._sources[name] for name in source_names if name in self._sources
        }
        missing = set(source_names) - set(targets.keys())
        if missing:
            logger.warning("requested_sources_not_found", missing=list(missing))

        tasks = [src._safe_search(query, max_results) for src in targets.values()]
        return list(await asyncio.gather(*tasks))

    def get_available_sources(self) -> list[dict[str, Any]]:
        """Return info dicts for all active sources."""
        return [src.info() for src in self._sources.values()]

    def get_source_stats(self) -> dict[str, Any]:
        """Summary statistics about active sources."""
        categories: dict[str, int] = {}
        phases: dict[int, int] = {}
        for src in self._sources.values():
            categories[src.category] = categories.get(src.category, 0) + 1
            phases[src.phase] = phases.get(src.phase, 0) + 1
        return {
            "total_active": len(self._sources),
            "by_category": categories,
            "by_phase": phases,
            "source_names": list(self._sources.keys()),
        }

    def add_source(self, name: str) -> bool:
        """Dynamically add a source by name."""
        if name in self._sources:
            return True
        cls = ALL_SOURCE_CLASSES.get(name)
        if cls is None:
            return False
        self._sources[name] = cls()
        return True

    def remove_source(self, name: str) -> bool:
        """Remove a source by name."""
        if name in self._sources:
            del self._sources[name]
            return True
        return False
