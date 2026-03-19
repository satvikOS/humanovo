"""
Citation Service — Auto-citation, verification, and formatting.

Handles all citation operations across both discovery and synthesis pipelines.
"""

import asyncio
import hashlib
import json
import re
from datetime import datetime
from typing import Literal
from uuid import uuid4

import httpx
from pydantic import BaseModel

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)


class Citation(BaseModel):
    index: int
    title: str
    authors: list[str]
    journal: str
    year: int
    doi: str | None = None
    pmid: str | None = None
    verified: bool = False


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
    visualization_data: dict
    retrieval_stats: dict
    pipeline_trace: dict


class CitationService:
    """Handles all citation operations across both pipelines."""

    def __init__(self):
        self._http_client: httpx.AsyncClient | None = None

    async def _get_client(self) -> httpx.AsyncClient:
        if self._http_client is None:
            self._http_client = httpx.AsyncClient(timeout=30.0, follow_redirects=True)
        return self._http_client

    async def extract_claims(self, text: str) -> list[str]:
        """Split narrative text into individual factual claims using sentence splitting."""
        # Split on sentence boundaries, filter out short/non-factual sentences
        sentences = re.split(r'(?<=[.!?])\s+', text)
        claims = []
        for s in sentences:
            s = s.strip()
            if len(s) > 30 and not s.startswith(('[', '#', '-', '*')):
                claims.append(s)
        return claims

    async def find_citations(self, claims: list[str], retrieved_papers: list[dict]) -> dict[str, list[Citation]]:
        """For each claim, find the best matching papers from the retrieved set."""
        claim_citation_map = {}
        for claim in claims:
            claim_lower = claim.lower()
            matches = []
            for i, paper in enumerate(retrieved_papers):
                title = paper.get("title", "").lower()
                abstract = paper.get("abstract", paper.get("content", "")).lower()
                # Simple keyword overlap scoring
                claim_words = set(claim_lower.split())
                paper_words = set(title.split()) | set(abstract.split())
                overlap = len(claim_words & paper_words) / max(len(claim_words), 1)
                if overlap > 0.15:
                    matches.append(Citation(
                        index=i + 1,
                        title=paper.get("title", "Unknown"),
                        authors=paper.get("authors", []),
                        journal=paper.get("journal", ""),
                        year=paper.get("year", 0),
                        doi=paper.get("doi"),
                        pmid=paper.get("pmid"),
                        verified=False,
                    ))
            claim_citation_map[claim] = matches[:5]
        return claim_citation_map

    async def inject_citations(self, text: str, claim_citation_map: dict[str, list[Citation]]) -> str:
        """Insert inline [1][2][3] markers into the narrative text."""
        result = text
        for claim, citations in claim_citation_map.items():
            if citations:
                markers = "".join(f"[{c.index}]" for c in citations[:3])
                # Add markers at end of the matching sentence
                if claim in result:
                    result = result.replace(claim, claim.rstrip('.') + markers + ".", 1)
        return result

    async def format_reference_list(self, citations: list[Citation], style: str = "numbered") -> str:
        """Format the reference list."""
        lines = []
        for c in citations:
            authors_str = ", ".join(c.authors[:3])
            if len(c.authors) > 3:
                authors_str += " et al."
            if style == "numbered":
                line = f"[{c.index}] {authors_str}. {c.title}. {c.journal}. {c.year}."
                if c.doi:
                    line += f" DOI: {c.doi}"
                if c.pmid:
                    line += f" PMID: {c.pmid}"
            elif style == "apa":
                line = f"{authors_str} ({c.year}). {c.title}. {c.journal}."
                if c.doi:
                    line += f" https://doi.org/{c.doi}"
            else:  # vancouver
                line = f"{c.index}. {authors_str}. {c.title}. {c.journal}. {c.year}."
            lines.append(line)
        return "\n".join(lines)

    async def verify_citation(self, citation: Citation) -> Citation:
        """Verify via PubMed E-Utilities (PMID) or DOI.org HEAD request."""
        client = await self._get_client()

        # Try PMID verification first
        if citation.pmid:
            try:
                resp = await client.get(
                    "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi",
                    params={"db": "pubmed", "id": citation.pmid, "retmode": "json"},
                )
                if resp.status_code == 200:
                    data = resp.json()
                    result = data.get("result", {})
                    if citation.pmid in result:
                        citation.verified = True
                        return citation
            except Exception as e:
                logger.warning(f"PMID verification failed for {citation.pmid}: {e}")

        # Try DOI verification
        if citation.doi:
            try:
                resp = await client.head(f"https://doi.org/{citation.doi}")
                if resp.status_code in (200, 301, 302, 303):
                    citation.verified = True
                    return citation
            except Exception as e:
                logger.warning(f"DOI verification failed for {citation.doi}: {e}")

        return citation

    async def verify_all(self, citations: list[Citation], max_concurrent: int = 10) -> list[Citation]:
        """Verify all citations concurrently with rate limiting."""
        sem = asyncio.Semaphore(max_concurrent)

        async def verify_one(c: Citation) -> Citation:
            async with sem:
                return await self.verify_citation(c)

        return await asyncio.gather(*(verify_one(c) for c in citations))

    async def deduplicate(self, citations: list[Citation]) -> list[Citation]:
        """Remove duplicates by DOI or PMID."""
        seen_dois = set()
        seen_pmids = set()
        unique = []
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

    async def close(self):
        if self._http_client:
            await self._http_client.aclose()
            self._http_client = None
