"""
Auto-Citation System per the v2 platform spec section 8.

CitationService: extract_claims, find_citations, inject_citations,
format_reference_list, verify_citation.
Citation caching in citation_cache table.
"""

import asyncio
import json
import re
import xml.etree.ElementTree as ET
from typing import Any, Literal

import httpx
from pydantic import BaseModel
from sqlalchemy import text

from app.core.config import settings
from app.core.database import async_session_factory
from app.core.logging import get_logger

logger = get_logger(__name__)


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class Citation(BaseModel):
    """A single literature citation."""
    pmid: str | None = None
    doi: str | None = None
    title: str = ""
    authors: list[str] = []
    journal: str = ""
    year: int | None = None
    abstract: str = ""
    verified: bool = False
    # Runtime index used for numbered inline references; not persisted.
    index: int = 0


class CitedFinding(BaseModel):
    summary: str
    citation_indices: list[int]
    relevance_score: float
    method_used: str | None = None
    in_lab_profile: bool | None = None


class GapItem(BaseModel):
    description: str
    evidence_status: Literal["no_evidence", "weak_evidence", "conflicting_evidence"]
    suggested_experiments: list[str]
    priority: Literal["high", "medium", "low"]
    impact: str
    feasibility_note: str | None = None


class SynthesisResult(BaseModel):
    hypothesis: str
    sub_claims: list[str]
    supporting_evidence: list[CitedFinding]
    contradicting_evidence: list[CitedFinding]
    inconclusive_evidence: list[CitedFinding]
    gaps: list[GapItem]
    overall_field_maturity: Literal["nascent", "growing", "mature", "saturated"]
    key_open_questions: list[str]
    formatted_output: str
    citations: list[Citation]
    visualization_data: dict[str, Any] = {}
    retrieval_stats: dict[str, Any] = {}
    pipeline_trace: dict[str, Any] = {}


# ---------------------------------------------------------------------------
# Biomedical heuristic helpers
# ---------------------------------------------------------------------------

# Patterns that indicate a sentence contains a scientific claim
_BIOMEDICAL_PATTERNS: list[re.Pattern[str]] = [
    re.compile(r"\b(?:gene|protein|receptor|kinase|enzyme|pathway|signaling)\b", re.I),
    re.compile(r"\b(?:mutation|variant|allele|polymorphism|expression)\b", re.I),
    re.compile(r"\b(?:inhibit|activate|upregulat|downregulat|modulat|target)\w*\b", re.I),
    re.compile(r"\b(?:patient|cohort|trial|study|meta-analysis)\b", re.I),
    re.compile(r"\b(?:p\s*[<>=]\s*0\.\d|CI\s*[:\[]|hazard ratio|odds ratio|relative risk)\b", re.I),
    re.compile(r"\b(?:mg|µg|mL|µM|nM|IC50|EC50|LD50)\b"),
    re.compile(r"\b(?:apoptosis|necrosis|autophagy|proliferation|differentiation)\b", re.I),
    re.compile(r"\b(?:FDA|EMA|Phase\s*[I1-4]+|clinical trial)\b", re.I),
    re.compile(r"\b(?:in\s+vitro|in\s+vivo|ex\s+vivo)\b", re.I),
    re.compile(r"\b(?:CRISPR|siRNA|shRNA|mRNA|miRNA|lncRNA)\b", re.I),
]

_MECHANISM_VERBS = re.compile(
    r"\b(?:causes?|leads?\s+to|results?\s+in|induces?|promotes?|suppresses?|"
    r"mediates?|regulates?|encodes?|binds?\s+to|interacts?\s+with|"
    r"correlates?\s+with|is\s+associated\s+with)\b",
    re.I,
)


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------

class CitationService:
    """Handles all citation operations across both discovery and synthesis pipelines."""

    _ESEARCH_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi"
    _EFETCH_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi"

    def __init__(self) -> None:
        self._http_client: httpx.AsyncClient | None = None

    # -- HTTP client lifecycle ------------------------------------------------

    async def _get_client(self) -> httpx.AsyncClient:
        if self._http_client is None or self._http_client.is_closed:
            self._http_client = httpx.AsyncClient(timeout=30.0, follow_redirects=True)
        return self._http_client

    async def close(self) -> None:
        if self._http_client and not self._http_client.is_closed:
            await self._http_client.aclose()
            self._http_client = None

    # -- 1. extract_claims ----------------------------------------------------

    async def extract_claims(self, text_body: str) -> list[str]:
        """Split narrative text into individual scientific claims.

        Uses sentence splitting combined with heuristics that look for
        biomedical terminology, mechanism descriptions, and data references.
        """
        # Split into sentences (handles abbreviations like "et al.", "i.e.", "e.g.")
        # We use a regex that splits on period/question/exclamation followed by
        # whitespace and an uppercase letter, while trying to avoid false splits.
        raw_sentences = re.split(
            r'(?<=[.!?])\s+(?=[A-Z])',
            text_body.strip(),
        )

        claims: list[str] = []
        for sent in raw_sentences:
            sent = sent.strip()

            # Skip very short sentences, headings, bullet points
            if len(sent) < 30:
                continue
            if sent.startswith(("[", "#", "-", "*", "•")):
                continue

            # Check biomedical relevance
            if self._is_scientific_claim(sent):
                claims.append(sent)

        return claims

    @staticmethod
    def _is_scientific_claim(sentence: str) -> bool:
        """Heuristic: does this sentence look like a scientific claim?"""
        # Must match at least one biomedical pattern
        bio_match = any(pat.search(sentence) for pat in _BIOMEDICAL_PATTERNS)
        # Or contain a mechanism verb
        mech_match = bool(_MECHANISM_VERBS.search(sentence))
        # Or contain a numeric data reference (e.g. "p < 0.05", "42%", "3.7-fold")
        data_match = bool(re.search(r"\d+\.?\d*\s*[-–]?\s*(?:fold|%|mg|µ)", sentence))
        return bio_match or mech_match or data_match

    # -- 2. find_citations ----------------------------------------------------

    async def find_citations(
        self,
        claims: list[str],
        disease: str,
    ) -> dict[str, list[Citation]]:
        """For each claim, search PubMed for matching papers.

        Returns a dict mapping each claim string to its list of Citation objects.
        Checks the citation_cache first and caches new results.
        """
        sem = asyncio.Semaphore(5)  # rate-limit PubMed calls

        async def _search_one(claim: str) -> tuple[str, list[Citation]]:
            async with sem:
                return claim, await self._pubmed_search_for_claim(claim, disease)

        tasks = [_search_one(c) for c in claims]
        pairs = await asyncio.gather(*tasks)
        return dict(pairs)

    async def _pubmed_search_for_claim(
        self,
        claim: str,
        disease: str,
    ) -> list[Citation]:
        """Search PubMed E-Utilities for papers supporting a single claim."""
        client = await self._get_client()
        query = self._build_search_query(claim, disease)

        params: dict[str, Any] = {
            "db": "pubmed",
            "term": query,
            "retmode": "json",
            "retmax": 5,
            "sort": "relevance",
        }
        if settings.PUBMED_EMAIL:
            params["email"] = settings.PUBMED_EMAIL
        if settings.PUBMED_API_KEY:
            api_key = settings.PUBMED_API_KEY
            if hasattr(api_key, "get_secret_value"):
                api_key = api_key.get_secret_value()
            if api_key:
                params["api_key"] = api_key

        try:
            # -- esearch --
            resp = await client.get(self._ESEARCH_URL, params=params)
            resp.raise_for_status()
            data = resp.json()
            id_list = data.get("esearchresult", {}).get("idlist", [])
            if not id_list:
                return []

            # Check cache first
            cached, uncached_ids = await self._get_cached_batch(id_list)

            # Fetch uncached from PubMed
            fetched: list[Citation] = []
            if uncached_ids:
                fetched = await self._efetch_articles(client, uncached_ids)
                # Cache them
                for cit in fetched:
                    await self.cache_citation(cit)

            all_citations = cached + fetched
            return all_citations

        except Exception as exc:
            logger.warning("PubMed search failed", claim=claim[:80], error=str(exc))
            return []

    async def _efetch_articles(
        self,
        client: httpx.AsyncClient,
        pmids: list[str],
    ) -> list[Citation]:
        """Fetch article metadata from PubMed efetch (XML)."""
        fetch_params: dict[str, Any] = {
            "db": "pubmed",
            "id": ",".join(pmids),
            "retmode": "xml",
        }
        if settings.PUBMED_EMAIL:
            fetch_params["email"] = settings.PUBMED_EMAIL
        if settings.PUBMED_API_KEY:
            api_key = settings.PUBMED_API_KEY
            if hasattr(api_key, "get_secret_value"):
                api_key = api_key.get_secret_value()
            if api_key:
                fetch_params["api_key"] = api_key

        resp = await client.get(self._EFETCH_URL, params=fetch_params)
        resp.raise_for_status()

        citations: list[Citation] = []
        root = ET.fromstring(resp.text)

        for article_el in root.iter("PubmedArticle"):
            cit = self._parse_pubmed_article(article_el)
            if cit:
                citations.append(cit)

        return citations

    @staticmethod
    def _parse_pubmed_article(article_el: ET.Element) -> Citation | None:
        """Parse a single <PubmedArticle> XML element into a Citation."""
        pmid_el = article_el.find(".//PMID")
        title_el = article_el.find(".//ArticleTitle")
        journal_el = article_el.find(".//Journal/Title")
        year_el = (
            article_el.find(".//PubDate/Year")
            or article_el.find(".//PubDate/MedlineDate")
        )
        abstract_el = article_el.find(".//Abstract/AbstractText")

        pmid = pmid_el.text.strip() if pmid_el is not None and pmid_el.text else None
        if not pmid:
            return None

        title = title_el.text.strip() if title_el is not None and title_el.text else ""
        journal = journal_el.text.strip() if journal_el is not None and journal_el.text else ""

        year: int | None = None
        if year_el is not None and year_el.text:
            year_text = year_el.text.strip()
            # MedlineDate can be like "2023 Jan-Feb"; extract first 4-digit year
            match = re.search(r"(\d{4})", year_text)
            if match:
                year = int(match.group(1))

        abstract = ""
        if abstract_el is not None and abstract_el.text:
            abstract = abstract_el.text.strip()

        # Authors
        authors: list[str] = []
        for author_el in article_el.findall(".//Author"):
            last = author_el.findtext("LastName") or ""
            initials = author_el.findtext("Initials") or ""
            if last:
                authors.append(f"{last} {initials}".strip())

        # DOI
        doi: str | None = None
        for aid in article_el.findall(".//ArticleId"):
            if aid.get("IdType") == "doi" and aid.text:
                doi = aid.text.strip()
                break

        return Citation(
            pmid=pmid,
            doi=doi,
            title=title,
            authors=authors,
            journal=journal,
            year=year,
            abstract=abstract,
            verified=False,
        )

    @staticmethod
    def _build_search_query(claim: str, disease: str) -> str:
        """Build a PubMed search query from a claim and disease context."""
        stop = {
            "the", "a", "an", "is", "are", "was", "were", "be", "been",
            "being", "have", "has", "had", "do", "does", "did", "will",
            "would", "shall", "should", "may", "might", "must", "can",
            "could", "of", "in", "to", "for", "with", "on", "at", "from",
            "by", "about", "as", "into", "through", "during", "before",
            "after", "above", "below", "between", "out", "off", "over",
            "under", "again", "further", "then", "once", "that", "this",
            "these", "those", "it", "its", "and", "but", "or", "nor",
            "not", "no", "so", "than", "too", "very", "just", "also",
            "both", "each", "more", "most", "other", "some", "such",
            "only", "own", "same", "here", "there", "when", "where",
            "while", "which", "who", "whom", "what", "how", "all", "any",
            "few", "many", "much", "several", "they", "them", "their",
            "we", "our", "he", "she", "his", "her",
        }
        tokens = re.findall(r"[A-Za-z0-9-]+", claim)
        key = [t for t in tokens if t.lower() not in stop and len(t) > 2][:8]
        inner = " AND ".join(key)
        if disease:
            return f"({disease}) AND ({inner})"
        return inner

    # -- 3. inject_citations --------------------------------------------------

    async def inject_citations(
        self,
        text_body: str,
        citations: dict[str, list[Citation]],
    ) -> str:
        """Insert [N] references into the text after each matching claim.

        Assigns a global running index to each unique citation (by PMID or DOI)
        and inserts markers like ``[1][2]`` after the claim sentence.
        """
        # Build a global citation index: deduplicate by PMID then DOI
        global_index: dict[str, int] = {}  # key -> index
        counter = 1

        def _cit_key(c: Citation) -> str:
            return c.pmid or c.doi or c.title

        # First pass: assign indices
        for claim, cits in citations.items():
            for c in cits:
                k = _cit_key(c)
                if k and k not in global_index:
                    global_index[k] = counter
                    c.index = counter
                    counter += 1
                elif k:
                    c.index = global_index[k]

        # Second pass: inject markers into text
        result = text_body
        # Sort claims longest-first to avoid substring replacement issues
        sorted_claims = sorted(citations.keys(), key=len, reverse=True)

        for claim in sorted_claims:
            cits = citations[claim]
            if not cits:
                continue
            # Deduplicate indices for this claim
            seen_idx: set[int] = set()
            markers: list[str] = []
            for c in cits[:3]:  # max 3 inline refs per claim
                if c.index not in seen_idx:
                    seen_idx.add(c.index)
                    markers.append(f"[{c.index}]")
            marker_str = "".join(markers)

            # Find the claim in the result text and append markers
            if claim in result:
                # Insert markers before the sentence-ending period
                if claim.endswith("."):
                    annotated = claim[:-1] + marker_str + "."
                else:
                    annotated = claim + marker_str
                result = result.replace(claim, annotated, 1)

        return result

    # -- 4. format_reference_list ---------------------------------------------

    async def format_reference_list(
        self,
        citations: list[Citation],
        style: str = "numbered",
    ) -> str:
        """Format a reference list in numbered, APA, or Vancouver style."""
        lines: list[str] = []

        # Deduplicate and sort by index
        seen: set[str] = set()
        unique: list[Citation] = []
        for c in citations:
            k = c.pmid or c.doi or c.title
            if k not in seen:
                seen.add(k)
                unique.append(c)

        for c in sorted(unique, key=lambda x: x.index):
            authors_str = self._format_authors(c.authors)

            if style == "numbered":
                line = f"[{c.index}] {authors_str}. {c.title}. {c.journal}. {c.year or 'n.d.'}."
                if c.doi:
                    line += f" DOI: {c.doi}"
                if c.pmid:
                    line += f" PMID: {c.pmid}"

            elif style == "apa":
                year_str = f"({c.year})" if c.year else "(n.d.)"
                line = f"{authors_str} {year_str}. {c.title}. *{c.journal}*."
                if c.doi:
                    line += f" https://doi.org/{c.doi}"

            else:  # vancouver
                line = f"{c.index}. {authors_str}. {c.title}. {c.journal}. {c.year or 'n.d.'}."
                if c.pmid:
                    line += f" PMID: {c.pmid}."
                if c.doi:
                    line += f" doi:{c.doi}"

            lines.append(line)

        return "\n".join(lines)

    @staticmethod
    def _format_authors(authors: list[str], max_display: int = 3) -> str:
        if not authors:
            return "Unknown"
        displayed = authors[:max_display]
        result = ", ".join(displayed)
        if len(authors) > max_display:
            result += " et al."
        return result

    # -- 5. verify_citation ---------------------------------------------------

    async def verify_citation(self, citation: Citation) -> bool:
        """Verify a citation exists via PubMed lookup + DOI check.

        Returns True if verified, and sets citation.verified as a side effect.
        """
        client = await self._get_client()
        verified = False

        # Try PMID verification
        if citation.pmid:
            try:
                params: dict[str, Any] = {
                    "db": "pubmed",
                    "id": citation.pmid,
                    "retmode": "json",
                }
                if settings.PUBMED_EMAIL:
                    params["email"] = settings.PUBMED_EMAIL

                resp = await client.get(
                    "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi",
                    params=params,
                )
                if resp.status_code == 200:
                    data = resp.json()
                    result = data.get("result", {})
                    if citation.pmid in result:
                        verified = True
            except Exception as exc:
                logger.warning("PMID verification failed", pmid=citation.pmid, error=str(exc))

        # Try DOI verification
        if not verified and citation.doi:
            try:
                resp = await client.head(
                    f"https://doi.org/{citation.doi}",
                    follow_redirects=True,
                    timeout=5.0,
                )
                if resp.status_code == 200:
                    verified = True
            except Exception as exc:
                logger.warning("DOI verification failed", doi=citation.doi, error=str(exc))

        citation.verified = verified
        return verified

    async def verify_all(self, citations: list[Citation], max_concurrent: int = 10) -> list[Citation]:
        """Verify all citations concurrently with rate limiting."""
        sem = asyncio.Semaphore(max_concurrent)

        async def _verify_one(c: Citation) -> Citation:
            async with sem:
                await self.verify_citation(c)
                return c

        return list(await asyncio.gather(*(_verify_one(c) for c in citations)))

    # -- 6. cache_citation ----------------------------------------------------

    async def cache_citation(self, citation: Citation) -> None:
        """Store a citation in the citation_cache table.

        Uses UPSERT (INSERT ... ON CONFLICT) to avoid duplicates.
        """
        try:
            async with async_session_factory() as session:
                await session.execute(
                    text("""
                        INSERT INTO citation_cache (
                            id, doi, pmid, title, authors, journal,
                            year, verified, verified_at, metadata, created_at
                        ) VALUES (
                            gen_random_uuid(),
                            :doi, :pmid, :title, :authors::jsonb, :journal,
                            :year, :verified,
                            CASE WHEN :verified THEN NOW() ELSE NULL END,
                            :metadata::jsonb,
                            NOW()
                        )
                        ON CONFLICT (pmid) DO UPDATE SET
                            title = EXCLUDED.title,
                            authors = EXCLUDED.authors,
                            journal = EXCLUDED.journal,
                            year = EXCLUDED.year,
                            doi = COALESCE(EXCLUDED.doi, citation_cache.doi),
                            verified = EXCLUDED.verified,
                            verified_at = CASE WHEN EXCLUDED.verified THEN NOW() ELSE citation_cache.verified_at END
                        WHERE EXCLUDED.pmid IS NOT NULL
                    """),
                    {
                        "doi": citation.doi,
                        "pmid": citation.pmid,
                        "title": citation.title,
                        "authors": json.dumps(citation.authors),
                        "journal": citation.journal,
                        "year": citation.year,
                        "verified": citation.verified,
                        "metadata": json.dumps({
                            "abstract": citation.abstract[:2000] if citation.abstract else "",
                        }),
                    },
                )
                await session.commit()
        except Exception as exc:
            # Log but don't fail the caller -- caching is best-effort
            logger.warning("Failed to cache citation", pmid=citation.pmid, doi=citation.doi, error=str(exc))

    # -- 7. get_cached_citation -----------------------------------------------

    async def get_cached_citation(self, pmid: str) -> Citation | None:
        """Retrieve a citation from the citation_cache table by PMID."""
        try:
            async with async_session_factory() as session:
                result = await session.execute(
                    text("""
                        SELECT pmid, doi, title, authors, journal, year, verified, metadata
                        FROM citation_cache
                        WHERE pmid = :pmid
                        LIMIT 1
                    """),
                    {"pmid": pmid},
                )
                row = result.first()
                if row is None:
                    return None

                authors_raw = row.authors
                if isinstance(authors_raw, str):
                    authors_raw = json.loads(authors_raw)

                meta = row.metadata or {}
                if isinstance(meta, str):
                    meta = json.loads(meta)

                return Citation(
                    pmid=row.pmid,
                    doi=row.doi,
                    title=row.title,
                    authors=authors_raw if isinstance(authors_raw, list) else [],
                    journal=row.journal or "",
                    year=row.year,
                    abstract=meta.get("abstract", ""),
                    verified=row.verified or False,
                )
        except Exception as exc:
            logger.warning("Cache lookup failed", pmid=pmid, error=str(exc))
            return None

    async def _get_cached_batch(self, pmids: list[str]) -> tuple[list[Citation], list[str]]:
        """Check cache for a batch of PMIDs. Returns (cached, uncached_ids)."""
        cached: list[Citation] = []
        uncached: list[str] = []

        try:
            async with async_session_factory() as session:
                result = await session.execute(
                    text("""
                        SELECT pmid, doi, title, authors, journal, year, verified, metadata
                        FROM citation_cache
                        WHERE pmid = ANY(:pmids)
                    """),
                    {"pmids": pmids},
                )
                found_pmids: set[str] = set()
                for row in result:
                    authors_raw = row.authors
                    if isinstance(authors_raw, str):
                        authors_raw = json.loads(authors_raw)
                    meta = row.metadata or {}
                    if isinstance(meta, str):
                        meta = json.loads(meta)
                    cached.append(Citation(
                        pmid=row.pmid,
                        doi=row.doi,
                        title=row.title,
                        authors=authors_raw if isinstance(authors_raw, list) else [],
                        journal=row.journal or "",
                        year=row.year,
                        abstract=meta.get("abstract", ""),
                        verified=row.verified or False,
                    ))
                    if row.pmid:
                        found_pmids.add(row.pmid)

                uncached = [p for p in pmids if p not in found_pmids]
        except Exception as exc:
            logger.warning("Batch cache lookup failed", error=str(exc))
            uncached = pmids

        return cached, uncached

    # -- helpers ---------------------------------------------------------------

    async def deduplicate(self, citations: list[Citation]) -> list[Citation]:
        """Remove duplicates by DOI or PMID."""
        seen_dois: set[str] = set()
        seen_pmids: set[str] = set()
        unique: list[Citation] = []
        for c in citations:
            if c.doi and c.doi in seen_dois:
                continue
            if c.pmid and c.pmid in seen_pmids:
                continue
            if c.doi:
                seen_dois.add(c.doi)
            if c.pmid:
                seen_pmids.add(c.pmid)
            unique.append(c)
        return unique


# ---------------------------------------------------------------------------
# Module-level singleton getter
# ---------------------------------------------------------------------------

_citation_service: CitationService | None = None


def get_citation_service() -> CitationService:
    global _citation_service
    if _citation_service is None:
        _citation_service = CitationService()
    return _citation_service
