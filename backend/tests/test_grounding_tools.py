"""Unit tests for `app/services/agents/grounding_tools.py`.

Focus: tool-builder schema + handler dispatch. No live PubMed or
pgvector — `GroundingService` is mocked so the test runs everywhere
the rest of the agent-layer suite runs."""
from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from app.services.agents.grounding_tools import (
    build_evidence_lookup_tool,
    build_pubmed_search_tool,
)


def test_evidence_lookup_tool_schema():
    """Schema must declare `query` required + `limit` optional. The
    agent-layer's tool-spec generator depends on this exact shape."""
    tool = build_evidence_lookup_tool(disease="ovarian cancer")
    assert tool.name == "lookup_evidence"
    assert "query" in tool.parameters["properties"]
    assert tool.parameters["required"] == ["query"]
    assert "limit" in tool.parameters["properties"]


@pytest.mark.asyncio
async def test_evidence_lookup_returns_top_k_sorted_by_similarity():
    """The handler must downcast RAGMatch objects to plain dicts and
    sort highest-similarity first."""
    fake_matches = [
        SimpleNamespace(
            content="paper A " * 30, source="PubMed", source_id="PMID:11111",
            combined_similarity=0.62,
        ),
        SimpleNamespace(
            content="paper B", source="ClinicalTrials.gov", source_id="NCT22222",
            combined_similarity=0.91,
        ),
        SimpleNamespace(
            content="paper C", source="UniProt", source_id="UP:33333",
            combined_similarity=0.74,
        ),
    ]
    fake_grounder = AsyncMock()
    fake_grounder._layer1_rag_lookup = AsyncMock(return_value=fake_matches)

    with patch(
        "app.services.grounding_service.get_grounding_service",
        return_value=fake_grounder,
    ), patch(
        "app.services.agents.grounding_tools._make_embedding_fn",
        new=AsyncMock(return_value=None),
    ):
        tool = build_evidence_lookup_tool(disease="X", top_k=2)
        out = await tool.handler({"query": "PARP1 BRCA1 synthetic lethality"})

    assert out["count"] == 2
    # Highest similarity first.
    assert out["results"][0]["source_id"] == "NCT22222"
    assert out["results"][0]["similarity"] == 0.91
    assert out["results"][1]["source_id"] == "UP:33333"
    # Content trimmed to 500 chars.
    assert len(out["results"][0]["content"]) <= 500


@pytest.mark.asyncio
async def test_evidence_lookup_empty_query_returns_no_match_marker():
    tool = build_evidence_lookup_tool(disease="X")
    out = await tool.handler({"query": "   "})
    assert out["results"] == []
    assert "no-match" in out["note"]


@pytest.mark.asyncio
async def test_evidence_lookup_no_results_returns_no_match_marker():
    """When the grounder returns 0 matches the handler must emit a
    no-match note rather than fabricating; the agent's prompt then
    instructs it to acknowledge the gap."""
    fake_grounder = AsyncMock()
    fake_grounder._layer1_rag_lookup = AsyncMock(return_value=[])

    with patch(
        "app.services.grounding_service.get_grounding_service",
        return_value=fake_grounder,
    ), patch(
        "app.services.agents.grounding_tools._make_embedding_fn",
        new=AsyncMock(return_value=None),
    ):
        tool = build_evidence_lookup_tool(disease="rare-disease")
        out = await tool.handler({"query": "totally novel claim with no evidence"})

    assert out["results"] == []
    assert "no-match" in out["note"]


@pytest.mark.asyncio
async def test_evidence_lookup_grounder_failure_returns_error_note():
    """Handler must catch GroundingService exceptions and surface a
    note rather than propagating — agents receive structured errors,
    not stack traces."""
    fake_grounder = AsyncMock()
    fake_grounder._layer1_rag_lookup = AsyncMock(side_effect=RuntimeError("DB down"))

    with patch(
        "app.services.grounding_service.get_grounding_service",
        return_value=fake_grounder,
    ), patch(
        "app.services.agents.grounding_tools._make_embedding_fn",
        new=AsyncMock(return_value=None),
    ):
        tool = build_evidence_lookup_tool(disease="X")
        out = await tool.handler({"query": "anything"})

    assert out["results"] == []
    assert "rag-error" in out["note"]


def test_pubmed_search_tool_schema():
    tool = build_pubmed_search_tool()
    assert tool.name == "pubmed_search"
    assert tool.parameters["required"] == ["query"]


@pytest.mark.asyncio
async def test_pubmed_search_returns_pmid_url_pairs():
    fake_verification = SimpleNamespace(
        matching_pmids=["12345", "67890", "11111"],
        verified=True,
    )
    fake_grounder = AsyncMock()
    fake_grounder._layer2_citation_verify = AsyncMock(return_value=fake_verification)

    with patch(
        "app.services.grounding_service.get_grounding_service",
        return_value=fake_grounder,
    ):
        tool = build_pubmed_search_tool()
        out = await tool.handler({"query": "BRCA1 PARP1", "max_results": 2})

    assert out["count"] == 2
    assert out["verified"] is True
    assert out["results"][0]["pmid"] == "12345"
    assert "pubmed.ncbi.nlm.nih.gov/12345" in out["results"][0]["url"]
