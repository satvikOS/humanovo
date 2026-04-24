"""
Tests for the multi-round citation verifier (offline, no network calls).

We hit the classification logic directly — network methods are tested
through integration tests where we can stand up a mock HTTPX server.
"""

import pytest

from app.agents.verification.citation_verifier import (
    VerificationVerdict,
    VerifiedCitation,
    _cosine,
    _title_similarity,
)
from app.agents.verification.rewind_coordinator import (
    RewindCoordinator,
    StageCheckpoint,
)


def test_verified_citation_ok_property():
    vc = VerifiedCitation(
        raw_doi="10.1038/s41586-020-2012-7",
        raw_pmid="31978945",
        raw_title="Some paper",
        verdict=VerificationVerdict.VERIFIED,
    )
    assert vc.ok
    assert not vc.requires_rewind


def test_fabricated_citation_requires_rewind():
    vc = VerifiedCitation(
        raw_doi="10.9999/fake", raw_pmid=None, raw_title="Fake",
        verdict=VerificationVerdict.FABRICATED,
    )
    assert not vc.ok
    assert vc.requires_rewind


def test_no_doi_declared_is_ok():
    vc = VerifiedCitation(
        raw_doi=None, raw_pmid="31978945", raw_title="Paper",
        verdict=VerificationVerdict.NO_DOI_DECLARED,
    )
    assert vc.ok


def test_misattributed_requires_rewind():
    vc = VerifiedCitation(
        raw_doi="10.1/x", raw_pmid=None, raw_title="X",
        verdict=VerificationVerdict.MISATTRIBUTED,
    )
    assert vc.requires_rewind


def test_title_similarity_identical():
    sim = _title_similarity(
        "Analysis of tumor microenvironment in hepatocellular carcinoma",
        "Analysis of tumor microenvironment in hepatocellular carcinoma",
    )
    assert sim == 1.0


def test_title_similarity_close_titles_pass_threshold():
    # Word-level Jaccard is conservative on plural/tense variants. We only
    # require that semantically-similar titles score meaningfully above
    # unrelated ones, not that they cross an absolute >0.5 threshold.
    a = "Tumor microenvironment in hepatocellular carcinoma progression"
    b = "Tumor microenvironment progression in hepatocellular carcinoma"
    assert _title_similarity(a, b) > 0.75


def test_title_similarity_disjoint_titles():
    sim = _title_similarity(
        "CRISPR gene editing in liver disease",
        "Microbiome regulation of cardiac function",
    )
    assert sim < 0.25


def test_cosine_identical_vectors():
    v = [1.0, 2.0, 3.0, 4.0]
    assert abs(_cosine(v, v) - 1.0) < 1e-9


def test_cosine_empty_returns_zero():
    assert _cosine([], [1, 2, 3]) == 0
    assert _cosine([1, 2, 3], []) == 0


def test_cosine_orthogonal():
    a = [1.0, 0.0]
    b = [0.0, 1.0]
    assert abs(_cosine(a, b)) < 1e-9


# --------------------------------------------------------------------
# RewindCoordinator
# --------------------------------------------------------------------


def test_rewind_coordinator_initial_state():
    rc = RewindCoordinator(hypothesis_id="h1")
    assert not rc.rewinds_exhausted
    assert rc.latest_checkpoint_before(1) is None


def test_checkpoint_and_rewind():
    rc = RewindCoordinator(hypothesis_id="h2", max_rewinds=2)
    for i in (1, 2, 3):
        rc.checkpoint(StageCheckpoint(
            stage_number=i,
            stage_name=f"s{i}",
            model_used="claude-sonnet",
            accumulated_context={f"k{i}": f"v{i}"},
        ))
    ckpt = rc.latest_checkpoint_before(3)
    assert ckpt is not None
    assert ckpt.stage_number == 2


def test_rewind_budget_exhaustion():
    rc = RewindCoordinator(hypothesis_id="h3", max_rewinds=1)
    rc.checkpoint(StageCheckpoint(
        stage_number=1, stage_name="seed", model_used="m",
        accumulated_context={},
    ))

    bad = VerifiedCitation(
        raw_doi="10.x/fake", raw_pmid=None, raw_title="Fake",
        verdict=VerificationVerdict.FABRICATED,
        failure_reason="test fabricated",
    )
    ev = rc.plan_rewind(
        stage_that_emitted=2, stage_name="evidence",
        failed_citation=bad, invalidated_claim="Some claim",
    )
    assert ev is not None
    # Second attempt must return None because max_rewinds=1
    ev2 = rc.plan_rewind(
        stage_that_emitted=2, stage_name="evidence",
        failed_citation=bad, invalidated_claim="Another claim",
    )
    assert rc.rewinds_exhausted
    assert ev2 is None


def test_blacklist_clause_includes_identifiers():
    rc = RewindCoordinator(hypothesis_id="h4")
    rc.checkpoint(StageCheckpoint(
        stage_number=1, stage_name="seed", model_used="m",
        accumulated_context={},
    ))
    bad = VerifiedCitation(
        raw_doi="10.9999/fake-doi", raw_pmid="99999999",
        raw_title="Totally Fabricated Paper",
        verdict=VerificationVerdict.FABRICATED,
    )
    rc.plan_rewind(
        stage_that_emitted=2, stage_name="evidence",
        failed_citation=bad, invalidated_claim="invented claim",
    )
    clause = rc.blacklist_clause()
    assert "BLACKLISTED" in clause
    assert "10.9999/fake-doi" in clause
    assert "99999999" in clause


def test_related_claims_heuristic():
    # The heuristic looks for >=4 shared key nouns (len>3, non-stopword).
    invalidated = (
        "nivolumab inhibits programmed PDCD1 receptor melanoma metastasis"
    )
    candidates = [
        # Shares 5+ nouns: nivolumab, inhibits, programmed, PDCD1, melanoma
        "nivolumab inhibits programmed PDCD1 expression melanoma progression",
        # Shares <4 nouns: only 'melanoma' and maybe 'inhibits'
        "trametinib inhibits MEK pathway progression",
        # Unrelated entirely
        "microbiome modulates cardiac inflammation systemic",
    ]
    related = RewindCoordinator._find_related_claims(invalidated, candidates)
    assert any("PDCD1" in c for c in related)
    assert not any("microbiome" in c for c in related)
