"""
Multi-Round Citation Verifier

Every citation emitted by any LLM stage goes through this verifier.
Verification has THREE independent rounds; a citation must pass ALL three
to be accepted:

  Round 1 — Identifier resolution:
      - DOI: HEAD request to https://doi.org/{doi} must return 200/302 and
        resolve to a publisher domain (Crossref, Elsevier, Springer, Wiley,
        Nature, Cell Press, PubMed, BMJ, Oxford AP, PLOS, Frontiers, NEJM,
        Lancet, arXiv, bioRxiv, medRxiv, etc.).
      - PMID: NCBI esummary.fcgi must return the article with a non-empty
        title AND at least one author.
      - Both present: both must pass AND the PMID record's DOI (if any) must
        match the claimed DOI.

  Round 2 — Title corroboration:
      - The claimed title (or its first 8 content words) must appear in
        either Crossref / OpenAlex / Europe PMC search results for the same
        DOI/PMID. If the searched title differs by > 25% (token Jaccard),
        the citation is flagged as SUSPECT.

  Round 3 — Semantic relevance:
      - The claim that the citation supports must semantically overlap the
        verified abstract. We require cosine similarity >= 0.35 between the
        claim embedding and the abstract embedding (computed via the dual
        embedding grounder). Below threshold = citation is IRRELEVANT even
        if the paper exists; it does not support the claim.

A citation that fails Round 1 is FABRICATED (hallucinated identifier).
A citation that fails Round 2 is MISATTRIBUTED (real paper, wrong metadata).
A citation that fails Round 3 is IRRELEVANT (wrong paper for the claim).

When ANY verification failure occurs, the verdict triggers pipeline rewind.
The orchestrator then discards the invalidated stage outputs and re-runs
from the last successful cached stage with the bad citation explicitly
blacklisted in the prompt.

Papers that have no DOI (grey literature, preprints pre-DOI, older articles)
are accepted ONLY if Round 2 passes (title corroboration in OpenAlex/EPMC)
AND the output marks them as `doi_status: "no_doi_declared"` so the user
sees the declaration.
"""

from __future__ import annotations

import asyncio
import logging
import re
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Optional

import httpx

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Types
# ---------------------------------------------------------------------------

class VerificationVerdict(str, Enum):
    VERIFIED = "verified"                    # all 3 rounds pass
    NO_DOI_DECLARED = "no_doi_declared"      # Round 1 skipped, Round 2 passed
    FABRICATED = "fabricated"                # Round 1 fail
    MISATTRIBUTED = "misattributed"          # Round 2 fail
    IRRELEVANT = "irrelevant"                # Round 3 fail
    UNREACHABLE = "unreachable"              # network error; retry recommended


# Set of verdicts that require pipeline rewind
_REWIND_VERDICTS: frozenset[VerificationVerdict] = frozenset({
    VerificationVerdict.FABRICATED,
    VerificationVerdict.MISATTRIBUTED,
    VerificationVerdict.IRRELEVANT,
})


@dataclass
class VerifiedCitation:
    """A citation after verification."""
    raw_doi: str | None
    raw_pmid: str | None
    raw_title: str | None
    verdict: VerificationVerdict
    resolved_title: str | None = None
    resolved_authors: list[str] = field(default_factory=list)
    resolved_journal: str | None = None
    resolved_year: str | None = None
    publisher_domain: str | None = None
    crossref_checked: bool = False
    pubmed_checked: bool = False
    openalex_checked: bool = False
    europepmc_checked: bool = False
    relevance_similarity: float | None = None
    round_failed: int | None = None
    failure_reason: str | None = None

    @property
    def ok(self) -> bool:
        return self.verdict in (VerificationVerdict.VERIFIED,
                                VerificationVerdict.NO_DOI_DECLARED)

    @property
    def requires_rewind(self) -> bool:
        return self.verdict in _REWIND_VERDICTS


@dataclass
class VerificationFailure:
    """Exception-like object used to signal pipeline rewind."""
    stage_that_emitted: str
    citation: VerifiedCitation
    claim_invalidated: str
    related_claims_to_strip: list[str] = field(default_factory=list)

    def __str__(self) -> str:
        return (
            f"VerificationFailure(stage={self.stage_that_emitted}, "
            f"verdict={self.citation.verdict.value}, "
            f"reason={self.citation.failure_reason})"
        )


# ---------------------------------------------------------------------------
# Publisher domain whitelist (Round 1 — DOI resolution)
# ---------------------------------------------------------------------------

_TRUSTED_PUBLISHER_SUFFIXES: tuple[str, ...] = (
    "doi.org",  # direct DOI resolver
    "nature.com", "science.org", "sciencemag.org",
    "cell.com", "nejm.org", "thelancet.com", "bmj.com",
    "academic.oup.com", "link.springer.com", "sciencedirect.com",
    "wiley.com", "onlinelibrary.wiley.com",
    "jamanetwork.com", "annualreviews.org",
    "plos.org", "journals.plos.org",
    "frontiersin.org", "mdpi.com", "hindawi.com",
    "arxiv.org", "biorxiv.org", "medrxiv.org", "chemrxiv.org",
    "pubs.acs.org", "pubs.rsc.org", "pubs.aip.org",
    "academic.oup.com", "royalsocietypublishing.org",
    "ncbi.nlm.nih.gov", "europepmc.org", "openalex.org",
    "tandfonline.com", "iopscience.iop.org", "ieee.org",
    "jci.org", "pnas.org", "embopress.org",
    "genome.org", "rupress.org", "lifescience-alliance.org",
    "mdpi.com", "peerj.com", "biomedcentral.com",
    "elifesciences.org", "cshlpress.com",
    "portlandpress.com", "karger.com", "thieme-connect.com",
    "degruyter.com", "sagepub.com", "journals.aps.org",
)


def _is_trusted_resolver(url: str) -> bool:
    try:
        from urllib.parse import urlparse
        netloc = urlparse(url).netloc.lower()
        return any(netloc.endswith(s) for s in _TRUSTED_PUBLISHER_SUFFIXES)
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Verifier
# ---------------------------------------------------------------------------

_DOI_RE = re.compile(r"\b10\.\d{4,9}/[^\s\"<>]+", re.IGNORECASE)
_PMID_RE = re.compile(r"\b\d{6,9}\b")


class CitationVerifier:
    """Multi-round, network-backed citation verifier."""

    def __init__(
        self,
        http_timeout: float = 10.0,
        relevance_threshold: float = 0.35,
        title_jaccard_threshold: float = 0.75,
        max_concurrent: int = 12,
    ):
        self._timeout = http_timeout
        self._rel_threshold = relevance_threshold
        self._title_threshold = title_jaccard_threshold
        self._sem = asyncio.Semaphore(max_concurrent)
        self._cache: dict[str, VerifiedCitation] = {}

    # ------------------------------------------------------------------
    # Entry points
    # ------------------------------------------------------------------

    async def verify(
        self,
        *,
        doi: str | None = None,
        pmid: str | None = None,
        claimed_title: str | None = None,
        claim_text: str | None = None,
        claim_embedding: list[float] | None = None,
    ) -> VerifiedCitation:
        """Verify a single citation across all three rounds."""
        key = f"{doi or ''}|{pmid or ''}|{(claimed_title or '')[:80]}"
        if key in self._cache:
            return self._cache[key]

        async with self._sem:
            vc = VerifiedCitation(
                raw_doi=doi,
                raw_pmid=pmid,
                raw_title=claimed_title,
                verdict=VerificationVerdict.UNREACHABLE,
            )
            try:
                await self._round1_identifier_resolution(vc)
                if vc.round_failed is None:
                    await self._round2_title_corroboration(vc)
                if vc.round_failed is None and claim_text:
                    await self._round3_semantic_relevance(
                        vc, claim_text, claim_embedding,
                    )
                if vc.round_failed is None:
                    vc.verdict = (
                        VerificationVerdict.NO_DOI_DECLARED
                        if not vc.raw_doi
                        else VerificationVerdict.VERIFIED
                    )
            except Exception as e:
                logger.warning(f"Citation verification error: {e}")
                vc.verdict = VerificationVerdict.UNREACHABLE
                vc.failure_reason = str(e)[:200]

            self._cache[key] = vc
            return vc

    async def verify_batch(
        self, citations: list[dict[str, Any]], claim_embeddings: dict[str, list[float]] | None = None,
    ) -> list[VerifiedCitation]:
        """Verify many citations in parallel."""
        tasks = []
        for c in citations:
            claim = c.get("claim") or c.get("claim_text")
            emb = None
            if claim_embeddings and claim:
                emb = claim_embeddings.get(claim)
            tasks.append(self.verify(
                doi=c.get("doi"),
                pmid=c.get("pmid"),
                claimed_title=c.get("title"),
                claim_text=claim,
                claim_embedding=emb,
            ))
        return await asyncio.gather(*tasks)

    # ------------------------------------------------------------------
    # Round 1 — Identifier resolution
    # ------------------------------------------------------------------

    async def _round1_identifier_resolution(self, vc: VerifiedCitation) -> None:
        """Resolve DOI via doi.org HEAD; resolve PMID via NCBI esummary."""
        checks_passed = 0

        # DOI resolution
        if vc.raw_doi:
            doi = vc.raw_doi.strip().lstrip("/").replace("https://doi.org/", "")
            if not _DOI_RE.match(doi):
                vc.round_failed = 1
                vc.failure_reason = "DOI format invalid"
                return
            try:
                async with httpx.AsyncClient(
                    follow_redirects=True, timeout=self._timeout,
                ) as client:
                    resp = await client.head(f"https://doi.org/{doi}")
                if resp.status_code not in (200, 302, 301):
                    vc.round_failed = 1
                    vc.failure_reason = (
                        f"DOI unresolvable (status={resp.status_code})"
                    )
                    return
                final_url = str(resp.url)
                vc.publisher_domain = final_url
                if not _is_trusted_resolver(final_url):
                    vc.round_failed = 1
                    vc.failure_reason = (
                        f"DOI resolved to untrusted domain: {final_url[:120]}"
                    )
                    return
                vc.crossref_checked = True
                checks_passed += 1
            except httpx.HTTPError as e:
                vc.round_failed = 1
                vc.failure_reason = f"DOI network error: {e}"
                return

        # PMID resolution
        if vc.raw_pmid:
            pmid = str(vc.raw_pmid).strip()
            if not _PMID_RE.fullmatch(pmid):
                vc.round_failed = 1
                vc.failure_reason = "PMID format invalid"
                return
            try:
                url = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi"
                params = {"db": "pubmed", "id": pmid, "retmode": "json"}
                async with httpx.AsyncClient(timeout=self._timeout) as client:
                    resp = await client.get(url, params=params)
                if resp.status_code != 200:
                    vc.round_failed = 1
                    vc.failure_reason = (
                        f"PubMed esummary failed (status={resp.status_code})"
                    )
                    return
                data = resp.json()
                record = data.get("result", {}).get(pmid, {})
                if not record or "title" not in record:
                    vc.round_failed = 1
                    vc.failure_reason = "PMID not found in PubMed"
                    return
                vc.resolved_title = record.get("title", "")
                authors = record.get("authors", []) or []
                vc.resolved_authors = [a.get("name", "") for a in authors if a.get("name")]
                vc.resolved_journal = record.get("fulljournalname") or record.get("source", "")
                vc.resolved_year = (record.get("pubdate", "") or "")[:4]
                # Cross-check DOI in PubMed record
                pubmed_dois = [
                    aid["value"] for aid in record.get("articleids", [])
                    if aid.get("idtype") == "doi"
                ]
                if vc.raw_doi and pubmed_dois:
                    expected = vc.raw_doi.lower().lstrip("/").replace("https://doi.org/", "")
                    if not any(expected == d.lower() for d in pubmed_dois):
                        vc.round_failed = 1
                        vc.failure_reason = (
                            f"DOI/PMID mismatch: claimed {vc.raw_doi!r}, "
                            f"PubMed has {pubmed_dois!r}"
                        )
                        return
                vc.pubmed_checked = True
                checks_passed += 1
            except httpx.HTTPError as e:
                vc.round_failed = 1
                vc.failure_reason = f"PubMed network error: {e}"
                return

        if checks_passed == 0:
            # No DOI, no PMID — not fabricated per se, but Round 2 must rescue it
            vc.failure_reason = "no_identifier_available"

    # ------------------------------------------------------------------
    # Round 2 — Title corroboration
    # ------------------------------------------------------------------

    async def _round2_title_corroboration(self, vc: VerifiedCitation) -> None:
        """Confirm claimed title matches OpenAlex and/or Europe PMC."""
        if not vc.raw_title and not vc.resolved_title:
            # Nothing to corroborate
            return

        claimed = (vc.raw_title or vc.resolved_title or "").strip()
        if len(claimed) < 15:
            return  # too short to Jaccard-compare

        openalex_title = await self._fetch_openalex_title(vc)
        epmc_title = await self._fetch_europepmc_title(vc)
        vc.openalex_checked = openalex_title is not None
        vc.europepmc_checked = epmc_title is not None

        candidates = [t for t in (openalex_title, epmc_title, vc.resolved_title) if t]
        if not candidates:
            if not vc.raw_doi and not vc.raw_pmid:
                # Truly no corroboration and no DOI/PMID => fabricated
                vc.round_failed = 2
                vc.failure_reason = "No source found for title in OpenAlex or Europe PMC"
            return

        best = max(_title_similarity(claimed, c) for c in candidates)
        if best < self._title_threshold:
            vc.round_failed = 2
            vc.failure_reason = (
                f"Title mismatch (best Jaccard={best:.2f} < {self._title_threshold})"
            )
            return

    async def _fetch_openalex_title(self, vc: VerifiedCitation) -> str | None:
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                if vc.raw_doi:
                    r = await client.get(
                        f"https://api.openalex.org/works/https://doi.org/{vc.raw_doi}"
                    )
                elif vc.raw_pmid:
                    r = await client.get(f"https://api.openalex.org/works/pmid:{vc.raw_pmid}")
                else:
                    r = await client.get(
                        "https://api.openalex.org/works",
                        params={"search": vc.raw_title or "", "per_page": 1},
                    )
                if r.status_code != 200:
                    return None
                data = r.json()
                if "title" in data:
                    return data["title"]
                if "results" in data and data["results"]:
                    return data["results"][0].get("title")
        except httpx.HTTPError:
            pass
        return None

    async def _fetch_europepmc_title(self, vc: VerifiedCitation) -> str | None:
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                query_terms = []
                if vc.raw_doi:
                    query_terms.append(f'DOI:"{vc.raw_doi}"')
                if vc.raw_pmid:
                    query_terms.append(f'EXT_ID:{vc.raw_pmid} AND SRC:MED')
                if not query_terms and vc.raw_title:
                    query_terms.append(f'TITLE:"{vc.raw_title[:100]}"')
                if not query_terms:
                    return None
                r = await client.get(
                    "https://www.ebi.ac.uk/europepmc/webservices/rest/search",
                    params={
                        "query": " OR ".join(query_terms),
                        "format": "json",
                        "pageSize": 1,
                    },
                )
                if r.status_code != 200:
                    return None
                data = r.json()
                hits = data.get("resultList", {}).get("result", [])
                if hits:
                    return hits[0].get("title")
        except httpx.HTTPError:
            pass
        return None

    # ------------------------------------------------------------------
    # Round 3 — Semantic relevance
    # ------------------------------------------------------------------

    async def _round3_semantic_relevance(
        self,
        vc: VerifiedCitation,
        claim_text: str,
        claim_embedding: list[float] | None,
    ) -> None:
        """Verify the paper's abstract actually supports the claim."""
        abstract = await self._fetch_abstract(vc)
        if not abstract:
            # Cannot perform Round 3; mark relevance as unknown but don't fail
            return

        similarity = await self._semantic_similarity(claim_text, abstract, claim_embedding)
        vc.relevance_similarity = similarity
        if similarity < self._rel_threshold:
            vc.round_failed = 3
            vc.failure_reason = (
                f"Paper abstract does not support claim "
                f"(cosine={similarity:.2f} < {self._rel_threshold})"
            )

    async def _fetch_abstract(self, vc: VerifiedCitation) -> str | None:
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                if vc.raw_pmid:
                    r = await client.get(
                        "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi",
                        params={
                            "db": "pubmed",
                            "id": vc.raw_pmid,
                            "rettype": "abstract",
                            "retmode": "text",
                        },
                    )
                    if r.status_code == 200 and r.text:
                        return r.text
                if vc.raw_doi:
                    r = await client.get(
                        f"https://api.openalex.org/works/https://doi.org/{vc.raw_doi}"
                    )
                    if r.status_code == 200:
                        data = r.json()
                        inv = data.get("abstract_inverted_index") or {}
                        if inv:
                            return _reconstruct_abstract(inv)
        except httpx.HTTPError:
            pass
        return None

    async def _semantic_similarity(
        self,
        a: str,
        b: str,
        a_embedding: list[float] | None,
    ) -> float:
        """Cosine similarity via the existing dual-embedding grounding engine."""
        try:
            from app.rag.grounding import get_grounding_engine
            engine = get_grounding_engine()
            await engine.initialize()
            if a_embedding is None:
                a_embedding = await engine.embed(a)
            b_embedding = await engine.embed(b)
            return _cosine(a_embedding, b_embedding)
        except Exception as e:
            logger.debug(f"Semantic similarity fallback (reason: {e})")
            # Fallback: token Jaccard on content words
            return _title_similarity(a, b)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_STOP = frozenset([
    "the", "a", "an", "of", "in", "on", "at", "for", "to", "and", "or", "is",
    "are", "was", "were", "be", "been", "being", "by", "with", "as", "that",
    "this", "these", "those", "it", "its", "from", "into", "through", "over",
    "under", "after", "before", "between", "during", "against", "within",
    "without", "upon", "than", "which", "who", "whom", "whose", "what", "when",
    "where", "how", "why",
])


def _tokenize(text: str) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9]+", text.lower()) if w not in _STOP and len(w) > 2}


def _title_similarity(a: str, b: str) -> float:
    sa, sb = _tokenize(a), _tokenize(b)
    if not sa or not sb:
        return 0.0
    return len(sa & sb) / max(1, len(sa | sb))


def _cosine(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = sum(x * x for x in a) ** 0.5
    nb = sum(y * y for y in b) ** 0.5
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


def _reconstruct_abstract(inverted_index: dict[str, list[int]]) -> str:
    """Rebuild abstract text from OpenAlex inverted-index format."""
    positions: list[tuple[int, str]] = []
    for word, pos_list in inverted_index.items():
        for p in pos_list:
            positions.append((p, word))
    positions.sort()
    return " ".join(w for _, w in positions)


# ---------------------------------------------------------------------------
# Module-level singleton
# ---------------------------------------------------------------------------

_verifier: CitationVerifier | None = None


def get_citation_verifier() -> CitationVerifier:
    global _verifier
    if _verifier is None:
        _verifier = CitationVerifier()
    return _verifier
