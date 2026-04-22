"""Citation verification API.

Wraps the benchmark.citation_accuracy round-trip verification logic
into a per-citation endpoint so the frontend CitationManager can
validate a DOI/PMID one at a time and show the verdict inline.

Honest failure modes:
  * No outbound network (typical in a sandbox): CrossRef + NCBI calls
    return "network_unreachable" instead of throwing a 500.
  * Truly fabricated citation (DOI doesn't resolve): returns
    is_fabricated=True with a clear message.

When the real pipeline runs, `benchmark.citation_accuracy.run_benchmark`
is the batch path; this endpoint is the interactive single-citation
path used from the UI.
"""

import json as _json

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field


router = APIRouter()


class CitationVerifyRequest(BaseModel):
    doi: str | None = Field(default=None, max_length=200)
    pmid: str | None = Field(default=None, max_length=40)
    claim_text: str | None = Field(
        default=None,
        max_length=2000,
        description="Optional — the sentence the citation is meant to support. "
        "When provided, future versions will compute cosine similarity between "
        "the claim and the resolved abstract.",
    )


class CitationVerifyResponse(BaseModel):
    exists: bool
    source: str  # "crossref" | "ncbi" | "none"
    doi: str | None = None
    pmid: str | None = None
    title: str | None = None
    authors: list[str] = []
    year: str | None = None
    is_fabricated: bool
    network_ok: bool
    message: str


async def _verify_doi_strict(client: httpx.AsyncClient, doi: str) -> CitationVerifyResponse:
    """CrossRef DOI round-trip. Distinguishes NETWORK / NOT_FOUND / VERIFIED."""
    try:
        resp = await client.get(
            f"https://api.crossref.org/works/{doi}",
            headers={"User-Agent": "humanovo-benchmark/1.0 (mailto:benchmark@humanovo.com)"},
            timeout=15.0,
        )
    except (httpx.RequestError, httpx.TimeoutException) as e:
        return CitationVerifyResponse(
            exists=False, source="none", doi=doi,
            is_fabricated=False, network_ok=False,
            message=f"Network unreachable — could not verify DOI: {e.__class__.__name__}",
        )
    if resp.status_code == 404:
        return CitationVerifyResponse(
            exists=False, source="crossref", doi=doi,
            is_fabricated=True, network_ok=True,
            message="DOI did not resolve on CrossRef — likely fabricated.",
        )
    if resp.status_code != 200:
        return CitationVerifyResponse(
            exists=False, source="none", doi=doi,
            is_fabricated=False, network_ok=False,
            message=f"CrossRef returned HTTP {resp.status_code} — cannot verify (sandbox proxy or upstream outage).",
        )
    try:
        data = resp.json()["message"]
    except (_json.JSONDecodeError, KeyError, ValueError):
        # Not real JSON — likely a sandbox proxy intercept. Classify
        # as network_error so the UI doesn't mis-flag real DOIs as fake.
        return CitationVerifyResponse(
            exists=False, source="none", doi=doi,
            is_fabricated=False, network_ok=False,
            message="CrossRef response was not JSON — network/proxy unreachable.",
        )
    title = (data.get("title") or [""])[0]
    authors = [f"{a.get('given', '')} {a.get('family', '')}".strip()
               for a in data.get("author", []) if a.get("family")]
    year = str(data.get("published-print", data.get("published-online", {}))
               .get("date-parts", [[None]])[0][0] or "")
    return CitationVerifyResponse(
        exists=True, source="crossref", doi=doi,
        title=title, authors=authors, year=year,
        is_fabricated=False, network_ok=True,
        message=f"Verified via CrossRef: {title}",
    )


async def _verify_pmid_strict(client: httpx.AsyncClient, pmid: str) -> CitationVerifyResponse:
    """NCBI E-utilities PMID round-trip with NETWORK / NOT_FOUND / VERIFIED split."""
    try:
        resp = await client.get(
            "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi",
            params={"db": "pubmed", "id": pmid, "retmode": "json"},
            timeout=15.0,
        )
    except (httpx.RequestError, httpx.TimeoutException) as e:
        return CitationVerifyResponse(
            exists=False, source="none", pmid=pmid,
            is_fabricated=False, network_ok=False,
            message=f"Network unreachable — could not verify PMID: {e.__class__.__name__}",
        )
    if resp.status_code != 200:
        return CitationVerifyResponse(
            exists=False, source="none", pmid=pmid,
            is_fabricated=False, network_ok=False,
            message=f"NCBI returned HTTP {resp.status_code} — cannot verify.",
        )
    try:
        data = resp.json()
    except (_json.JSONDecodeError, ValueError):
        return CitationVerifyResponse(
            exists=False, source="none", pmid=pmid,
            is_fabricated=False, network_ok=False,
            message="NCBI response was not JSON — network/proxy unreachable.",
        )
    result = (data.get("result") or {}).get(pmid, {})
    if not result or "error" in result:
        return CitationVerifyResponse(
            exists=False, source="ncbi", pmid=pmid,
            is_fabricated=True, network_ok=True,
            message="PMID did not resolve on NCBI E-utilities — likely fabricated.",
        )
    title = result.get("title", "")
    authors = [a.get("name", "") for a in result.get("authors", [])]
    year = result.get("pubdate", "")[:4]
    doi = ""
    for aid in result.get("articleids", []):
        if aid.get("idtype") == "doi":
            doi = aid.get("value", "")
            break
    return CitationVerifyResponse(
        exists=True, source="ncbi", pmid=pmid, doi=doi,
        title=title, authors=authors, year=year,
        is_fabricated=False, network_ok=True,
        message=f"Verified via NCBI: {title}",
    )


@router.post("/verify", response_model=CitationVerifyResponse)
async def verify_citation(request: CitationVerifyRequest) -> CitationVerifyResponse:
    """Resolve DOI/PMID against CrossRef + NCBI and return the verdict.

    Distinguishes three terminal states:
      * `exists=True` — verified (title/authors returned)
      * `network_ok=True, is_fabricated=True` — DB returned 404 / empty
      * `network_ok=False` — transport/proxy/parse error; verdict unknown
    """
    if not request.doi and not request.pmid:
        raise HTTPException(
            status_code=422,
            detail="Either `doi` or `pmid` must be provided.",
        )
    async with httpx.AsyncClient() as client:
        if request.doi:
            return await _verify_doi_strict(client, request.doi)
        return await _verify_pmid_strict(client, request.pmid or "")
