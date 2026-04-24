"""
3-Layer Grounding System per Project Jamison v2 Spec Section 7.

Layer 1: RAG via pgvector (cosine >= 0.7 threshold, dual embedding)
Layer 2: Citation verification (PubMed E-Utilities + DOI HEAD requests)
Layer 3: Cross-source corroboration (cluster claims, count unique DOIs)
"""

import asyncio
import re
import xml.etree.ElementTree as ET
from collections import defaultdict
from datetime import datetime
from typing import Any
from uuid import uuid4

import httpx
from pydantic import BaseModel, Field
from sqlalchemy import text

from app.core.config import settings
from app.core.database import async_session_factory
from app.core.logging import get_logger

logger = get_logger(__name__)


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class RAGMatch(BaseModel):
    """A single vector-similarity match from the grounding_cache table."""
    chunk_id: str
    content: str
    source: str
    source_id: str | None = None
    similarity_biomedical: float | None = None
    similarity_general: float | None = None
    combined_similarity: float = 0.0
    metadata: dict[str, Any] = {}


class CitationVerification(BaseModel):
    """Layer-2 result for one claim: PubMed + DOI verification."""
    claim: str
    pmids_found: list[str] = []
    dois_found: list[str] = []
    doi_valid: dict[str, bool] = {}          # doi -> HEAD-check result
    pubmed_titles: dict[str, str] = {}       # pmid -> article title
    verified: bool = False


class CorroborationResult(BaseModel):
    """Layer-3 cross-source corroboration for a claim cluster."""
    claim: str
    unique_sources: list[str] = []
    unique_dois: list[str] = []
    corroboration_count: int = 0
    corroborated: bool = False


class GroundingResult(BaseModel):
    """Aggregated grounding output for a set of claims."""
    claim: str
    grounded: bool = False
    confidence: float = 0.0
    layer1_rag_match: float | None = None     # best cosine similarity
    layer1_matches: list[RAGMatch] = []
    layer2_citation_verified: bool | None = None
    layer2_detail: CitationVerification | None = None
    layer3_corroboration_count: int = 0
    layer3_detail: CorroborationResult | None = None
    sources: list[dict[str, Any]] = []
    verdict: str = "ungrounded"               # grounded | weakly_grounded | ungrounded

    model_config = {"arbitrary_types_allowed": True}


class GroundingBatchResult(BaseModel):
    """Top-level result returned by ``ground_claims``."""
    disease: str
    claims: list[str]
    results: list[GroundingResult]
    grounding_ratio: float = 0.0
    timestamp: str = Field(default_factory=lambda: datetime.utcnow().isoformat())


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------

class GroundingService:
    """3-layer grounding system for anti-hallucination."""

    SIMILARITY_THRESHOLD: float = settings.GROUNDING_SIMILARITY_THRESHOLD
    BIOMEDICAL_WEIGHT: float = settings.PGVECTOR_SEARCH_WEIGHT_BIOMEDICAL
    GENERAL_WEIGHT: float = settings.PGVECTOR_SEARCH_WEIGHT_GENERAL
    RAG_TOP_K: int = settings.GROUNDING_RAG_TOP_K

    # PubMed E-Utilities base URLs
    _ESEARCH_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi"
    _EFETCH_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi"

    def __init__(self) -> None:
        self._http: httpx.AsyncClient | None = None

    # -- HTTP client lifecycle ------------------------------------------------

    async def _client(self) -> httpx.AsyncClient:
        if self._http is None or self._http.is_closed:
            self._http = httpx.AsyncClient(timeout=15.0, follow_redirects=True)
        return self._http

    async def close(self) -> None:
        if self._http and not self._http.is_closed:
            await self._http.aclose()
            self._http = None

    # -- Main entry point -----------------------------------------------------

    async def ground_claims(
        self,
        claims: list[str],
        disease: str,
        embedding_fn=None,
    ) -> GroundingBatchResult:
        """Run all 3 grounding layers and return an aggregated result."""

        # Run Layer 1 + Layer 2 concurrently per claim
        layer1_tasks = [self._layer1_rag_lookup(c, embedding_fn) for c in claims]
        layer2_tasks = [self._layer2_citation_verify(c, disease) for c in claims]

        l1_results, l2_results = await asyncio.gather(
            asyncio.gather(*layer1_tasks),
            asyncio.gather(*layer2_tasks),
        )

        # Layer 3 needs outputs from L1 + L2
        l3_results = await self._layer3_cross_source(
            claims,
            list(l1_results),
            list(l2_results),
        )

        # Assemble per-claim grounding results
        results: list[GroundingResult] = []
        for idx, claim in enumerate(claims):
            rag_matches = l1_results[idx]
            best_sim = max((m.combined_similarity for m in rag_matches), default=0.0)
            citation_v = l2_results[idx]
            corr = l3_results[idx]

            gr = GroundingResult(
                claim=claim,
                layer1_rag_match=best_sim if rag_matches else None,
                layer1_matches=rag_matches,
                layer2_citation_verified=citation_v.verified,
                layer2_detail=citation_v,
                layer3_corroboration_count=corr.corroboration_count,
                layer3_detail=corr,
            )

            # --- verdict logic ---
            if best_sim >= 0.7:
                gr.grounded = True
                gr.confidence = min(1.0, best_sim)
                gr.verdict = "grounded"
            elif citation_v.verified and corr.corroborated:
                gr.grounded = True
                gr.confidence = 0.85
                gr.verdict = "grounded"
            elif citation_v.verified:
                gr.grounded = True
                gr.confidence = 0.75
                gr.verdict = "grounded"
            elif corr.corroborated:
                gr.grounded = True
                gr.confidence = 0.70
                gr.verdict = "grounded"
            elif best_sim >= 0.5:
                gr.confidence = best_sim
                gr.verdict = "weakly_grounded"
            elif corr.corroboration_count == 1:
                gr.confidence = 0.40
                gr.verdict = "weakly_grounded"
            else:
                gr.confidence = 0.10
                gr.verdict = "ungrounded"

            # Collect source references for downstream consumers
            for m in rag_matches:
                gr.sources.append({
                    "type": "rag",
                    "source": m.source,
                    "source_id": m.source_id,
                    "similarity": m.combined_similarity,
                })
            for doi in citation_v.dois_found:
                gr.sources.append({"type": "doi", "doi": doi, "valid": citation_v.doi_valid.get(doi, False)})
            for pmid in citation_v.pmids_found:
                gr.sources.append({"type": "pubmed", "pmid": pmid})

            results.append(gr)

        ratio = self.compute_grounding_ratio_from_results(results)

        return GroundingBatchResult(
            disease=disease,
            claims=claims,
            results=results,
            grounding_ratio=ratio,
        )

    # -- Layer 1: RAG via pgvector --------------------------------------------

    async def _layer1_rag_lookup(
        self,
        claim: str,
        embedding_fn=None,
    ) -> list[RAGMatch]:
        """Query grounding_cache for semantically similar evidence.

        Uses dual embedding columns (1024d biomedical + 1536d general) and
        combines with weighted scoring.  Falls back to a single-column query
        when only one embedding is available.
        """
        if embedding_fn is None:
            return []

        try:
            embeddings = await embedding_fn(claim)
            # embedding_fn should return a dict with keys "biomedical" and/or "general"
            # or a plain list (treated as biomedical)
            if isinstance(embeddings, list):
                embeddings = {"biomedical": embeddings}
            if not isinstance(embeddings, dict):
                return []

            bio_emb = embeddings.get("biomedical")
            gen_emb = embeddings.get("general")

            matches: list[RAGMatch] = []

            async with async_session_factory() as session:
                if bio_emb and gen_emb:
                    # Dual-embedding weighted query
                    sql = text("""
                        SELECT
                            id::text,
                            content,
                            source,
                            source_id,
                            metadata,
                            1 - (embedding_cohere <=> :bio_emb::vector) AS sim_bio,
                            1 - (embedding_openai <=> :gen_emb::vector) AS sim_gen,
                            (
                                :w_bio * (1 - (embedding_cohere <=> :bio_emb::vector))
                                + :w_gen * (1 - (embedding_openai <=> :gen_emb::vector))
                            ) AS combined
                        FROM grounding_cache
                        WHERE embedding_cohere IS NOT NULL
                          AND embedding_openai IS NOT NULL
                        ORDER BY combined DESC
                        LIMIT :top_k
                    """)
                    rows = await session.execute(sql, {
                        "bio_emb": str(bio_emb),
                        "gen_emb": str(gen_emb),
                        "w_bio": self.BIOMEDICAL_WEIGHT,
                        "w_gen": self.GENERAL_WEIGHT,
                        "top_k": self.RAG_TOP_K,
                    })
                elif bio_emb:
                    sql = text("""
                        SELECT
                            id::text,
                            content,
                            source,
                            source_id,
                            metadata,
                            1 - (embedding_cohere <=> :emb::vector) AS sim_bio,
                            NULL AS sim_gen,
                            1 - (embedding_cohere <=> :emb::vector) AS combined
                        FROM grounding_cache
                        WHERE embedding_cohere IS NOT NULL
                        ORDER BY embedding_cohere <=> :emb::vector
                        LIMIT :top_k
                    """)
                    rows = await session.execute(sql, {
                        "emb": str(bio_emb),
                        "top_k": self.RAG_TOP_K,
                    })
                elif gen_emb:
                    sql = text("""
                        SELECT
                            id::text,
                            content,
                            source,
                            source_id,
                            metadata,
                            NULL AS sim_bio,
                            1 - (embedding_openai <=> :emb::vector) AS sim_gen,
                            1 - (embedding_openai <=> :emb::vector) AS combined
                        FROM grounding_cache
                        WHERE embedding_openai IS NOT NULL
                        ORDER BY embedding_openai <=> :emb::vector
                        LIMIT :top_k
                    """)
                    rows = await session.execute(sql, {
                        "emb": str(gen_emb),
                        "top_k": self.RAG_TOP_K,
                    })
                else:
                    return []

                for row in rows:
                    combined = float(row.combined) if row.combined is not None else 0.0
                    if combined < self.SIMILARITY_THRESHOLD:
                        continue
                    matches.append(RAGMatch(
                        chunk_id=row[0],
                        content=row.content,
                        source=row.source,
                        source_id=row.source_id,
                        similarity_biomedical=float(row.sim_bio) if row.sim_bio is not None else None,
                        similarity_general=float(row.sim_gen) if row.sim_gen is not None else None,
                        combined_similarity=combined,
                        metadata=row.metadata or {},
                    ))

            return matches

        except Exception as exc:
            logger.warning("Layer-1 RAG lookup failed", claim=claim[:80], error=str(exc))
            return []

    # -- Layer 2: Citation verification (PubMed + DOI) -------------------------

    async def _layer2_citation_verify(
        self,
        claim: str,
        disease: str,
    ) -> CitationVerification:
        """Search PubMed for the claim, verify DOIs with HEAD requests."""
        result = CitationVerification(claim=claim)
        client = await self._client()

        # Build a targeted PubMed search query
        # Take key noun phrases from the claim and AND them with the disease
        search_terms = self._build_pubmed_query(claim, disease)

        try:
            # -- esearch: get PMIDs --
            params: dict[str, Any] = {
                "db": "pubmed",
                "term": search_terms,
                "retmode": "json",
                "retmax": 5,
            }
            if settings.PUBMED_EMAIL:
                params["email"] = settings.PUBMED_EMAIL
            if settings.PUBMED_API_KEY:
                api_key = settings.PUBMED_API_KEY
                if hasattr(api_key, "get_secret_value"):
                    api_key = api_key.get_secret_value()
                if api_key:
                    params["api_key"] = api_key

            resp = await client.get(self._ESEARCH_URL, params=params)
            resp.raise_for_status()
            data = resp.json()

            id_list = data.get("esearchresult", {}).get("idlist", [])
            if not id_list:
                return result

            result.pmids_found = id_list

            # -- efetch: get article metadata (XML) --
            fetch_params: dict[str, Any] = {
                "db": "pubmed",
                "id": ",".join(id_list),
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

            fetch_resp = await client.get(self._EFETCH_URL, params=fetch_params)
            fetch_resp.raise_for_status()

            # Parse XML for titles and DOIs
            root = ET.fromstring(fetch_resp.text)
            for article in root.iter("PubmedArticle"):
                pmid_el = article.find(".//PMID")
                title_el = article.find(".//ArticleTitle")
                pmid_str = pmid_el.text if pmid_el is not None and pmid_el.text else ""
                title_str = title_el.text if title_el is not None and title_el.text else ""
                if pmid_str:
                    result.pubmed_titles[pmid_str] = title_str

                # Extract DOI from ArticleIdList
                for aid in article.findall(".//ArticleId"):
                    if aid.get("IdType") == "doi" and aid.text:
                        doi = aid.text.strip()
                        if doi not in result.dois_found:
                            result.dois_found.append(doi)

            # -- DOI HEAD verification --
            doi_tasks = [self._verify_doi(client, doi) for doi in result.dois_found]
            if doi_tasks:
                doi_results = await asyncio.gather(*doi_tasks, return_exceptions=True)
                for doi, valid in zip(result.dois_found, doi_results):
                    if isinstance(valid, bool):
                        result.doi_valid[doi] = valid
                    else:
                        result.doi_valid[doi] = False

            # Mark verified if at least one PMID returned results
            result.verified = len(result.pmids_found) > 0

        except Exception as exc:
            logger.warning("Layer-2 citation verification failed", claim=claim[:80], error=str(exc))

        return result

    @staticmethod
    async def _verify_doi(client: httpx.AsyncClient, doi: str) -> bool:
        """HEAD request to doi.org to confirm a DOI resolves."""
        try:
            resp = await client.head(
                f"https://doi.org/{doi}",
                follow_redirects=True,
                timeout=5.0,
            )
            return resp.status_code == 200
        except Exception:
            return False

    @staticmethod
    def _build_pubmed_query(claim: str, disease: str) -> str:
        """Heuristically extract key terms from a claim for PubMed search."""
        # Remove common filler words and keep biomedical-relevant tokens
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
        key_terms = [t for t in tokens if t.lower() not in stop and len(t) > 2]
        # Keep at most 8 terms to avoid overly narrow queries
        key_terms = key_terms[:8]
        query_parts = " AND ".join(f'"{t}"' if "-" in t else t for t in key_terms)
        if disease:
            query_parts = f"({disease}) AND ({query_parts})"
        return query_parts

    # -- Layer 3: Cross-source corroboration -----------------------------------

    async def _layer3_cross_source(
        self,
        claims: list[str],
        rag_results: list[list[RAGMatch]],
        citation_results: list[CitationVerification],
    ) -> list[CorroborationResult]:
        """Cluster claims, count unique DOIs & sources, mark corroborated."""
        results: list[CorroborationResult] = []

        for idx, claim in enumerate(claims):
            cr = CorroborationResult(claim=claim)

            seen_sources: set[str] = set()
            seen_dois: set[str] = set()

            # Sources from Layer-1 RAG matches
            for match in rag_results[idx]:
                src_key = f"{match.source}:{match.source_id or match.chunk_id}"
                if src_key not in seen_sources:
                    seen_sources.add(src_key)
                    cr.unique_sources.append(src_key)

            # Sources from Layer-2 citation search
            cv = citation_results[idx]
            for doi in cv.dois_found:
                if doi not in seen_dois:
                    seen_dois.add(doi)
                    cr.unique_dois.append(doi)
            for pmid in cv.pmids_found:
                src_key = f"pubmed:{pmid}"
                if src_key not in seen_sources:
                    seen_sources.add(src_key)
                    cr.unique_sources.append(src_key)

            # Cross-source corroboration: count *independent* sources
            # An independent source is either a unique DOI or a distinct RAG
            # source that did not originate from PubMed.
            rag_non_pubmed = {
                s for s in cr.unique_sources
                if not s.startswith("pubmed:")
            }
            # Total independent evidence = unique DOIs + non-PubMed RAG sources
            cr.corroboration_count = len(seen_dois) + len(rag_non_pubmed)
            cr.corroborated = cr.corroboration_count >= 2

            results.append(cr)

        return results

    # -- Utility ---------------------------------------------------------------

    @staticmethod
    def compute_grounding_ratio(result: GroundingBatchResult) -> float:
        """Fraction of claims that are grounded (verdict == 'grounded')."""
        if not result.results:
            return 0.0
        grounded = sum(1 for r in result.results if r.grounded)
        return grounded / len(result.results)

    @staticmethod
    def compute_grounding_ratio_from_results(results: list[GroundingResult]) -> float:
        """Compute ratio directly from a list of GroundingResult."""
        if not results:
            return 0.0
        grounded = sum(1 for r in results if r.grounded)
        return grounded / len(results)

    async def cleanup_expired(self, ttl_days: int = 30) -> int:
        """Delete expired grounding cache entries."""
        try:
            async with async_session_factory() as session:
                result = await session.execute(
                    text("""
                        DELETE FROM grounding_cache
                        WHERE updated_at < NOW() - INTERVAL :ttl
                        RETURNING id
                    """),
                    {"ttl": f"{ttl_days} days"},
                )
                deleted = result.rowcount or 0
                await session.commit()
                logger.info("Grounding cache TTL cleanup", deleted=deleted)
                return deleted
        except Exception as exc:
            logger.error("TTL cleanup failed", error=str(exc))
            return 0


# ---------------------------------------------------------------------------
# Module-level singleton getter
# ---------------------------------------------------------------------------

_grounding_service: GroundingService | None = None


def get_grounding_service() -> GroundingService:
    global _grounding_service
    if _grounding_service is None:
        _grounding_service = GroundingService()
    return _grounding_service
