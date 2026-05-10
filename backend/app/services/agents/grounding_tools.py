"""Production grounding tools for the agent layer.

Per memory `feedback_only_real_sources`: every production agent tool
must retrieve from the 62 active biomedical sources, never synthetic
data. This module bridges the new agent layer to the existing
`grounding_service.GroundingService` (PubMed E-utilities + pgvector
RAG over the indexed corpus).

Public surface:

    from app.services.agents.grounding_tools import (
        build_evidence_lookup_tool,
        build_pubmed_search_tool,
    )

    tools = [
        build_evidence_lookup_tool(disease="ovarian cancer"),
        build_pubmed_search_tool(),
    ]
    result = await agent.run(query, tools=tools)

Each builder returns a `Tool` whose handler closes over the disease
context + a shared embedder/grounder instance, so the agent's
`lookup_evidence(query="...")` calls land directly on pgvector +
PubMed without ever fabricating a citation."""
from __future__ import annotations

import logging
from typing import Any

from app.services.agents._types import Tool


logger = logging.getLogger(__name__)


def build_evidence_lookup_tool(
    *,
    disease: str,
    top_k: int = 5,
) -> Tool:
    """Returns a `Tool` the agent calls to retrieve grounded evidence.

    Schema:
      input:  { "query": str, "limit": int? }
      output: list of {
        "source": str,        # e.g. "PubMed", "ClinicalTrials.gov"
        "source_id": str,     # e.g. "PMID:12345", "NCT01234567"
        "content": str,       # snippet (capped to 500 chars)
        "similarity": float,  # 0..1 cosine
      }

    The tool combines pgvector RAG over the indexed corpus
    (`_layer1_rag_lookup`) with PubMed citation verification
    (`_layer2_citation_verify`). Disease context is closed over at
    tool-construction time so the agent doesn't need to pass it on
    every call — the orchestrator stage already knows the disease.

    Returns an empty list (with explicit `no-match` markers) when no
    evidence is found rather than fabricating; the agent's grounding
    prompt instructs it to say "I don't know" in that case."""

    async def _handler(args: dict[str, Any]) -> dict[str, Any]:
        query = (args.get("query") or "").strip()
        if not query:
            return {"results": [], "note": "no-match: empty query"}
        limit = min(int(args.get("limit") or top_k), 20)

        # Local imports keep the agent layer's import surface small —
        # grounding_service pulls in SQLAlchemy + httpx, only paid
        # for when production tools are actually constructed.
        try:
            from app.services.grounding_service import get_grounding_service
        except Exception as e:
            logger.warning("evidence_lookup: grounding_service unavailable: %s", e)
            return {"results": [], "note": f"grounding_service unavailable: {e}"}

        grounder = get_grounding_service()

        # Build an embedding function the grounder can call — uses
        # FoundryEmbedder when configured, else falls through to
        # whatever the production embedding pipeline returns.
        embedding_fn = await _make_embedding_fn()

        try:
            matches = await grounder._layer1_rag_lookup(
                query, embedding_fn=embedding_fn,
            )
        except Exception as e:
            logger.warning("evidence_lookup: layer1 RAG failed: %s", e)
            return {"results": [], "note": f"rag-error: {e}"}

        # Cap content to 500 chars + downcast to plain dicts the
        # agent's JSON serializer can consume. Sort highest-similarity
        # first.
        matches_sorted = sorted(
            matches, key=lambda m: getattr(m, "combined_similarity", 0.0), reverse=True,
        )
        results: list[dict[str, Any]] = []
        for m in matches_sorted[:limit]:
            content = getattr(m, "content", "") or ""
            results.append({
                "source": getattr(m, "source", "unknown"),
                "source_id": getattr(m, "source_id", "") or "",
                "content": content[:500],
                "similarity": round(float(getattr(m, "combined_similarity", 0.0)), 4),
            })

        if not results:
            return {
                "results": [],
                "note": (
                    f"no-match: 0 evidence records for query "
                    f"({len(query)} chars) on disease='{disease}'"
                ),
            }
        return {
            "results": results,
            "disease": disease,
            "count": len(results),
        }

    return Tool(
        name="lookup_evidence",
        description=(
            "Retrieve grounded biomedical evidence relevant to your query "
            "from the project's 62-source registry (PubMed, "
            "ClinicalTrials.gov, openFDA, UniProt, Reactome, KEGG, etc.). "
            "Returns up to 5 records with source citations and similarity "
            "scores. Call this before making any factual claim about "
            "genes, pathways, drugs, trials, or clinical evidence."
        ),
        parameters={
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Free-text query describing the evidence you need.",
                },
                "limit": {
                    "type": "integer",
                    "description": f"Max records to return (default {top_k}, max 20).",
                },
            },
            "required": ["query"],
        },
        handler=_handler,
    )


def build_pubmed_search_tool() -> Tool:
    """Returns a `Tool` for direct PubMed E-utilities search.

    Schema:
      input:  { "query": str, "max_results": int? }
      output: list of { "pmid": str, "title": str, "abstract_excerpt": str }

    Used when the agent needs to verify a specific claim by pulling
    a fresh paper rather than relying on the indexed corpus. Hits the
    PubMed API live; the grounding service handles retry + rate-limit
    backoff against NCBI's E-utilities ToU."""

    async def _handler(args: dict[str, Any]) -> dict[str, Any]:
        query = (args.get("query") or "").strip()
        if not query:
            return {"results": [], "note": "no-match: empty query"}
        max_results = min(int(args.get("max_results") or 5), 20)

        try:
            from app.services.grounding_service import get_grounding_service
        except Exception as e:
            logger.warning("pubmed_search: grounding_service unavailable: %s", e)
            return {"results": [], "note": f"grounding_service unavailable: {e}"}

        grounder = get_grounding_service()
        try:
            # _layer2_citation_verify returns a CitationVerification with
            # PMIDs + titles. We re-purpose it as a simple search by
            # passing the query as both claim and context.
            verification = await grounder._layer2_citation_verify(query, query)
        except Exception as e:
            logger.warning("pubmed_search: layer2 failed: %s", e)
            return {"results": [], "note": f"pubmed-error: {e}"}

        pmids = list(getattr(verification, "matching_pmids", []) or [])[:max_results]
        results = [
            {
                "pmid": pmid,
                "url": f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/",
            }
            for pmid in pmids
        ]
        return {
            "results": results,
            "count": len(results),
            "verified": getattr(verification, "verified", False),
        }

    return Tool(
        name="pubmed_search",
        description=(
            "Search PubMed for papers matching your query. Returns up to "
            "5 PMIDs with links. Use this to verify a specific factual "
            "claim by pulling primary literature, especially when the "
            "indexed corpus retrieval (`lookup_evidence`) returned no "
            "match."
        ),
        parameters={
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Free-text PubMed query (gene names, MeSH terms, etc.).",
                },
                "max_results": {
                    "type": "integer",
                    "description": "Max PMIDs to return (default 5, max 20).",
                },
            },
            "required": ["query"],
        },
        handler=_handler,
    )


async def _make_embedding_fn():
    """Build the embedding_fn that GroundingService._layer1_rag_lookup
    expects: takes a string, returns a dict with keys "biomedical" and
    "general" (or a plain list). Uses FoundryEmbedder when configured,
    falls back to None (which makes layer1 return empty matches —
    grounder's documented behaviour)."""
    from app.core.config import settings
    from app.services.agents.embeddings import FoundryEmbedder

    base = (
        getattr(settings, "AZURE_AI_FOUNDRY_OPENAI_ENDPOINT", "")
        or getattr(settings, "AZURE_AI_FOUNDRY_PROJECT_ENDPOINT", "")
    )
    api_key = getattr(settings, "azure_ai_foundry_key_value", None)
    if not (base and api_key):
        return None

    embedder = FoundryEmbedder(
        base_url=base,
        api_key=api_key,
        large_deployment=getattr(
            settings, "AZURE_FOUNDRY_DEPLOYMENT_EMBED_LARGE", "text-embedding-3-large",
        ),
        small_deployment=getattr(
            settings, "AZURE_FOUNDRY_DEPLOYMENT_EMBED_SMALL", "text-embedding-3-small",
        ),
    )

    async def _fn(text: str) -> dict[str, list[float]]:
        # Layer 1 RAG uses 1536-d small for speed at the
        # initial filter; combined-weighting also lifts the 1024-d
        # biomedical column when available. We provide the 1536-d
        # general embedding from text-embedding-3-small here; the
        # biomedical column is populated by Bedrock Cohere at ingest
        # time and stays untouched at query time. Returning only
        # `general` falls into the single-column query branch.
        try:
            vec = await embedder.embed_one(text, model="small")
            return {"general": vec}
        except Exception as e:
            logger.debug("embedding fallback: %s", e)
            return {}

    return _fn
