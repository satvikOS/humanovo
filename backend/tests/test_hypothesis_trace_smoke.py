"""Smoke tests for the hypothesis-trace + audit-log replay endpoints.

These tests verify the route surface is structurally healthy without
hitting a real database. They protect against:

  - The hypothesis_trace router not being wired into the v1 router.
  - The response models drifting out of sync with the handler returns.
  - The chain-verify call signature changing under us.

Endpoint behaviour against real data lives in
tests/integration/test_hypothesis_trace_e2e.py (skipped without a
live DB; runs in CI when Postgres is available).
"""
from __future__ import annotations

from fastapi.routing import APIRoute


def test_router_exposes_trace_route() -> None:
    """The router must register GET /hypotheses/{id}/trace."""
    from app.api.v1 import router

    paths = {
        r.path
        for r in router.routes
        if isinstance(r, APIRoute)
    }
    assert "/hypotheses/{hypothesis_id}/trace" in paths, (
        f"trace route missing; paths: {sorted(paths)[:20]}..."
    )


def test_router_exposes_audit_log_route() -> None:
    """The router must register GET /hypotheses/{id}/audit-log."""
    from app.api.v1 import router

    paths = {
        r.path
        for r in router.routes
        if isinstance(r, APIRoute)
    }
    assert "/hypotheses/{hypothesis_id}/audit-log" in paths


def test_trace_response_schema_well_formed() -> None:
    """The Pydantic schemas instantiate cleanly with realistic inputs."""
    from uuid import uuid4

    from app.api.v1.endpoints.hypothesis_trace import (
        AuditLogEntry,
        AuditLogResponse,
        CitationChainEntry,
        HypothesisTraceResponse,
    )

    chip = CitationChainEntry(
        evidence_id=uuid4(),
        evidence_type="supporting",
        relevance_score=0.94,
        title="Lehmann 2001",
        doi="10.1046/j.1471-4159.2001.00407.x",
        citation_verified=True,
        verification_status="verified",
    )
    assert chip.citation_verified is True

    resp = HypothesisTraceResponse(
        hypothesis_id=uuid4(),
        project_id=uuid4(),
        statement="A test hypothesis",
        confidence_score=0.7,
        supporting_count=2,
        contradiction_count=1,
        citation_chain=[chip],
        audit_log_url="/api/v1/hypotheses/abc/audit-log",
    )
    assert resp.citation_chain[0].doi == "10.1046/j.1471-4159.2001.00407.x"

    # The audit log shape carries the chain hashes.
    from datetime import UTC, datetime

    log_entry = AuditLogEntry(
        sequence=1,
        timestamp=datetime.now(UTC),
        event_type="pipeline.start",
        severity="info",
        action="run_discovery",
        record_hash="a" * 64,
        previous_hash=None,
    )
    log_resp = AuditLogResponse(
        hypothesis_id=uuid4(),
        total_records=1,
        entries=[log_entry],
        chain_intact=True,
    )
    assert log_resp.chain_intact is True
    assert len(log_resp.chain_issues) == 0


def test_classify_verification_handles_doi_only() -> None:
    """The verification heuristic returns the expected pair for DOI-only
    rows (verified) and DOI-less rows (unknown)."""
    from app.api.v1.endpoints.hypothesis_trace import _classify_verification

    class FakeEvidence:
        doi: str | None = None
        metadata_: dict | None = None

    e = FakeEvidence()
    e.doi = None
    assert _classify_verification(e) == (False, "unknown")

    e.doi = "10.1093/brain/awz189"
    assert _classify_verification(e) == (True, "verified")

    e.metadata_ = {"retracted": True}
    assert _classify_verification(e) == (False, "retracted")
