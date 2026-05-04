"""
Outbound HTTP allowlist — SSRF defense for the integration layer.

The discovery pipeline + ingestion layer fetch from a curated set of
biomedical APIs. **Every** other outbound URL is blocked. This protects
against three classes of bug:

1. **SSRF via user input** — a hypothesis stage accidentally lets a
   user-supplied URL flow into an outbound fetch (e.g. a paper viewer
   that fetches the citation's URL); the allowlist makes that a
   server-side error instead of a request to the AWS metadata service.
2. **Configuration drift** — a future contributor adds a new
   integration without registering its domain here; the new code fails
   loudly in dev rather than silently leaking traffic in prod.
3. **Compromised dependency** — a transitive httpx-using package
   (e.g. a Pydantic plugin) that suddenly tries to "phone home" gets
   blocked.

Scope (v1):
  - Wraps every `httpx.AsyncClient` instance created via
    `make_httpx_client(...)`. The integration base class
    (backend/app/integrations/base.py) is the primary caller.
  - Does NOT wrap boto3 (Bedrock), the openai SDK (Azure OpenAI), or
    the aiohttp clients in agents/ingestion/* — those have their own
    transport configs and limited scope. They're tracked as Sprint 2
    follow-up.

Bypass:
  - Tests can set `HUMANOVO_HTTP_ALLOWLIST_DISABLE=1` to disable the
    check — but production deploys MUST NOT set this.
"""

from __future__ import annotations

import os
from urllib.parse import urlparse

import httpx

from app.core.logging import get_logger

logger = get_logger(__name__)


class SSRFBlockedError(Exception):
    """Raised when an outbound HTTP request targets a non-allowlisted host."""

    def __init__(self, host: str, url: str):
        super().__init__(
            f"outbound URL blocked by SSRF allowlist: host={host!r} url={url!r}"
        )
        self.host = host
        self.url = url


# Allowlisted upstream hosts. Each entry is a fully-qualified hostname,
# case-insensitive. Subdomains do NOT match implicitly — every distinct
# subdomain we use must be listed explicitly. Cross-reference with
# docs/planning/INTEGRATION_INVENTORY.md and SOURCES_ROADMAP.md when
# adding entries.
ALLOWED_DOMAINS: frozenset[str] = frozenset(
    {
        # ---- Tier 1: every-discovery essential (9 wired core clients) ----
        "rest.uniprot.org",            # UniProt
        "www.ebi.ac.uk",               # ChEMBL + EuropePMC + OLS (shared host)
        "rest.ensembl.org",            # Ensembl
        "api.platform.opentargets.org",  # OpenTargets GraphQL
        "reactome.org",                # Reactome
        "api.openalex.org",            # OpenAlex
        "alphafold.ebi.ac.uk",         # AlphaFold structure predictions
        "www.proteinatlas.org",        # Human Protein Atlas
        # ---- Tier 2: ingestion agents (5 — Brave dropped for v1) ----
        "eutils.ncbi.nlm.nih.gov",     # PubMed + NCBI E-utilities
        "clinicaltrials.gov",
        "api.patentsview.org",         # USPTO PatentsView
        "api.biorxiv.org",             # bioRxiv preprints
        "api.crossref.org",            # DOI resolution
    }
)


def is_url_allowed(url: str) -> bool:
    """Return True if the URL's host is in the allowlist (case-insensitive).

    Treats relative URLs and URLs without a host as NOT allowed — every
    outbound request must specify a fully-qualified host.
    """
    if os.environ.get("HUMANOVO_HTTP_ALLOWLIST_DISABLE") == "1":
        return True
    parsed = urlparse(str(url))
    if not parsed.netloc:
        return False
    # Strip any user:pass@ prefix and :port suffix.
    host = parsed.netloc.split("@")[-1].split(":")[0].lower()
    return host in ALLOWED_DOMAINS


async def _block_disallowed_request(request: httpx.Request) -> None:
    """httpx event hook that raises if the request is not allowlisted."""
    if not is_url_allowed(str(request.url)):
        host = request.url.host or "<no-host>"
        logger.error(
            "SSRF allowlist blocked outbound request",
            host=host,
            url=str(request.url),
            method=request.method,
        )
        raise SSRFBlockedError(host=host, url=str(request.url))


def make_httpx_client(**kwargs) -> httpx.AsyncClient:
    """Construct an httpx.AsyncClient with the SSRF allowlist installed.

    Any `event_hooks` passed by the caller are preserved; the allowlist
    hook is appended to the `request` chain so caller-supplied hooks
    still observe the request first (e.g. for logging).
    """
    hooks = dict(kwargs.pop("event_hooks", {}) or {})
    request_hooks = list(hooks.get("request", []))
    request_hooks.append(_block_disallowed_request)
    response_hooks = list(hooks.get("response", []))
    return httpx.AsyncClient(
        event_hooks={"request": request_hooks, "response": response_hooks},
        **kwargs,
    )
