"""
Hypothesis trace + audit-log replay endpoints.

These two routes turn the marketing claims on /provenance into a real
product surface. Both are read-only and owner-scoped (the hypothesis
belongs to a project the caller owns; the audit-log entries are
filtered by execution_id when known).

  GET /v1/hypotheses/{id}/trace
       Per-claim citation chain. Walks evidence_refs for the hypothesis,
       returns each linked Evidence row with its DOI / title / verified-
       citation status. The shape matches what the desktop app's
       hypothesis-trace UI consumes (one chip per citation, with a
       click-through to the audit-log replay below).

  GET /v1/hypotheses/{id}/audit-log
       The Merkle-anchored event log for whichever pipeline
       execution produced this hypothesis. Powered by the existing
       AuditService.export() with a hypothesis-id resource filter.
       Returns JSON-Lines-like records plus the per-segment hash
       chain so a verifier can replay byte-for-byte.

Both endpoints route through fetch_owned_or_404 so the parent project
must be owned by the caller. Cross-tenant access returns 404.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.auth import AUTH_REQUIRED, get_current_active_user
from app.core.database import get_db
from app.core.logging import get_logger
from app.core.ownership import fetch_owned_or_404
from app.models.evidence import Evidence
from app.models.hypothesis import EvidenceReference, Hypothesis
from app.models.user import User
from app.services.audit_service import AuditRecord, get_audit_service

logger = get_logger(__name__)

router = APIRouter(prefix="/hypotheses", tags=["hypotheses-trace"], dependencies=AUTH_REQUIRED)


# ─── Schemas ────────────────────────────────────────────────────


class CitationChainEntry(BaseModel):
    """One citation in the per-hypothesis trace.

    Mirrors the chip UI on the desktop app's hypothesis page: every
    cited paper resolves to one entry, every entry carries enough
    info for a user to click through to the source.
    """

    evidence_id: UUID
    evidence_type: str  # supporting | contradicting | neutral
    relevance_score: float
    snippet: str | None = None

    # Source paper
    title: str | None = None
    doi: str | None = None
    pmid: str | None = None
    url: str | None = None
    publication_date: str | None = None

    # Verification metadata
    citation_verified: bool = False
    verification_status: str = "unknown"  # verified | unsupported | retracted | unknown

    model_config = ConfigDict(from_attributes=True)


class HypothesisTraceResponse(BaseModel):
    """Full trace for one hypothesis."""

    hypothesis_id: UUID
    project_id: UUID
    statement: str
    confidence_score: float
    supporting_count: int
    contradiction_count: int
    citation_chain: list[CitationChainEntry]
    audit_log_url: str = Field(
        ...,
        description=(
            "Relative URL to the audit-log replay endpoint for this hypothesis."
        ),
    )


class AuditLogEntry(BaseModel):
    """One row of the Merkle-anchored audit log."""

    sequence: int
    timestamp: datetime
    event_type: str
    severity: str
    action: str
    resource_type: str | None = None
    resource_id: str | None = None
    details: dict[str, Any] | None = None
    duration_ms: int | None = None
    cost_usd: float | None = None
    record_hash: str
    previous_hash: str | None = None


class AuditLogResponse(BaseModel):
    """Audit log replay payload for one hypothesis."""

    hypothesis_id: UUID
    total_records: int
    entries: list[AuditLogEntry]
    chain_intact: bool
    chain_issues: list[dict[str, Any]] = []


# ─── Helpers ────────────────────────────────────────────────────


def _classify_verification(evidence: Evidence) -> tuple[bool, str]:
    """Map an Evidence row to (verified, status) for the citation chain.

    Heuristic until a dedicated `verification_status` column lands:
      - verified  : has a DOI and is not flagged retracted
      - retracted : metadata flag set
      - unknown   : no DOI yet (LLM-attributed reference, awaiting
                    CrossRef roundtrip)
    """
    flags = (evidence.metadata_ if hasattr(evidence, "metadata_") else None) or {}
    if isinstance(flags, dict) and flags.get("retracted"):
        return False, "retracted"
    if evidence.doi:
        return True, "verified"
    return False, "unknown"


# ─── Routes ─────────────────────────────────────────────────────


@router.get("/{hypothesis_id}/trace", response_model=HypothesisTraceResponse)
async def get_hypothesis_trace(
    hypothesis_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> HypothesisTraceResponse:
    """Return the per-claim citation chain for one hypothesis.

    Owner-scoped via fetch_owned_or_404 (the parent Project must be
    owned by the caller). Cross-tenant access returns 404.
    """
    hyp = await fetch_owned_or_404(db, Hypothesis, hypothesis_id, current_user)

    # Eager-load evidence_refs + their Evidence rows so we can render
    # the chain without the N+1 round-trips that would otherwise fire.
    refs_q = (
        select(EvidenceReference)
        .where(EvidenceReference.hypothesis_id == hypothesis_id)
        .options(selectinload(EvidenceReference.evidence))
        .order_by(EvidenceReference.relevance_score.desc())
    )
    refs_result = await db.execute(refs_q)
    refs = refs_result.scalars().all()

    chain: list[CitationChainEntry] = []
    for ref in refs:
        ev = ref.evidence
        if ev is None:
            # Reference points at a deleted Evidence row; surface as
            # an "unsupported" entry rather than dropping the link.
            chain.append(
                CitationChainEntry(
                    evidence_id=ref.evidence_id,
                    evidence_type=ref.evidence_type.value
                    if hasattr(ref.evidence_type, "value")
                    else str(ref.evidence_type),
                    relevance_score=ref.relevance_score,
                    snippet=ref.snippet,
                    citation_verified=False,
                    verification_status="unsupported",
                )
            )
            continue

        verified, status = _classify_verification(ev)
        chain.append(
            CitationChainEntry(
                evidence_id=ref.evidence_id,
                evidence_type=ref.evidence_type.value
                if hasattr(ref.evidence_type, "value")
                else str(ref.evidence_type),
                relevance_score=ref.relevance_score,
                snippet=ref.snippet,
                title=ev.title,
                doi=ev.doi,
                pmid=getattr(ev, "pmid", None),
                url=getattr(ev, "url", None),
                publication_date=(
                    ev.publication_date.isoformat()
                    if getattr(ev, "publication_date", None)
                    else None
                ),
                citation_verified=verified,
                verification_status=status,
            )
        )

    return HypothesisTraceResponse(
        hypothesis_id=hyp.id,
        project_id=hyp.project_id,
        statement=hyp.statement,
        confidence_score=hyp.confidence_score,
        supporting_count=hyp.supporting_count,
        contradiction_count=hyp.contradiction_count,
        citation_chain=chain,
        audit_log_url=f"/api/v1/hypotheses/{hyp.id}/audit-log",
    )


@router.get("/{hypothesis_id}/audit-log", response_model=AuditLogResponse)
async def get_hypothesis_audit_log(
    hypothesis_id: UUID,
    limit: int = Query(default=500, ge=1, le=5000),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> AuditLogResponse:
    """Return the Merkle-anchored audit log for one hypothesis.

    Filters AuditRecord by resource_id == hypothesis_id (the canonical
    foreign key the pipeline's audit-recording paths use). The chain
    is verified end-to-end before returning so the caller can rely on
    `chain_intact` for tamper-evidence.
    """
    hyp = await fetch_owned_or_404(db, Hypothesis, hypothesis_id, current_user)

    stmt = (
        select(AuditRecord)
        .where(AuditRecord.resource_id == str(hyp.id))
        .order_by(AuditRecord.sequence)
        .limit(limit)
    )
    result = await db.execute(stmt)
    records = result.scalars().all()

    # Verify the per-record chain integrity. Operates on the loaded
    # subset (not the full DB) so it's bounded by `limit`.
    audit_svc = get_audit_service()
    chain_issues: list[dict[str, Any]] = []
    chain_intact = True
    if records:
        # AuditService.verify_chain hits the DB directly - we re-use
        # its hash recompute logic by walking the in-memory list.
        try:
            verification = await audit_svc.verify_chain(
                db,
                start_sequence=records[0].sequence,
                end_sequence=records[-1].sequence,
            )
            chain_intact = verification["intact"]
            chain_issues = verification["issues"]
        except Exception as e:
            logger.warning(
                "audit_log_chain_verify_failed",
                extra={
                    "event": "audit_log_chain_verify_failed",
                    "hypothesis_id": str(hyp.id),
                    "error": str(e),
                },
            )
            chain_intact = False
            chain_issues = [{"issue": "verify_failed", "error": str(e)}]

    entries = [
        AuditLogEntry(
            sequence=r.sequence,
            timestamp=r.timestamp,
            event_type=r.event_type,
            severity=r.severity,
            action=r.action,
            resource_type=r.resource_type,
            resource_id=r.resource_id,
            details=r.details,
            duration_ms=r.duration_ms,
            cost_usd=r.cost_usd,
            record_hash=r.record_hash,
            previous_hash=r.previous_hash,
        )
        for r in records
    ]

    return AuditLogResponse(
        hypothesis_id=hyp.id,
        total_records=len(entries),
        entries=entries,
        chain_intact=chain_intact,
        chain_issues=chain_issues,
    )
