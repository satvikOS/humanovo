"""
Humanovo Verification Layer

Multi-round cross-checking for every citation, claim, and relation emitted
by an agent stage. The contract:

  - If a citation's DOI/PMID does not resolve in at least 2 independent
    sources, the parent claim is INVALIDATED.
  - If a claim is invalidated, the pipeline REWINDS to the last successful
    cached stage and re-runs from there with the invalidated claim explicitly
    excluded from the candidate set.
  - Papers without a DOI are declared as such in the result ("no-DOI source")
    — we NEVER invent one.
  - Users rely on humanovo for 100% accurate citations; this is non-negotiable.
"""

from app.agents.verification.citation_verifier import (
    CitationVerifier,
    VerifiedCitation,
    VerificationVerdict,
    VerificationFailure,
    get_citation_verifier,
)
from app.agents.verification.rewind_coordinator import (
    RewindCoordinator,
    RewindEvent,
    StageCheckpoint,
)

__all__ = [
    "CitationVerifier",
    "VerifiedCitation",
    "VerificationVerdict",
    "VerificationFailure",
    "get_citation_verifier",
    "RewindCoordinator",
    "RewindEvent",
    "StageCheckpoint",
]
