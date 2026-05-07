"""
Discovery API Endpoints

API endpoints for the disease discovery service.
"""

from typing import Optional

from fastapi import APIRouter, Query
from pydantic import BaseModel

from app.core.errors import ErrorCode, safe_error
from app.core.logging import get_logger
from app.core.auth import AUTH_REQUIRED
from app.services.disease_discovery_service import (
    DiscoveryResult,
    DiscoveryType,
    DiseaseDiscoveryService,
    LLMProvider,
)

logger = get_logger(__name__)

router = APIRouter(prefix="/discovery", tags=["discovery"], dependencies=AUTH_REQUIRED)


class DiscoveryRequest(BaseModel):
    """Request model for disease discovery."""
    disease: str
    discovery_type: DiscoveryType = DiscoveryType.TREATMENT
    focus_entities: list[str] = []
    max_results: int = 5
    # NOTE: provider/model selection is intentionally server-side only.
    # The client does not pick a model; the orchestrator routes to the
    # right model per stage. Keeping the field as a no-op for backwards
    # compatibility with older clients but it is ignored.
    llm_provider: Optional[str] = None


class DiscoveryResponse(BaseModel):
    """Response model for discovery results.

    The internal `llm_provider` and `model_used` fields were removed in
    Sprint 1 to prevent leakage of the underlying pipeline architecture.
    Callers should not depend on knowing which provider produced a
    discovery — that's an implementation detail.
    """
    disease: str
    discovery_type: str
    discoveries: list[DiscoveryResult]
    total_count: int


class ExplanationRequest(BaseModel):
    """Request for discovery explanation."""
    discovery: DiscoveryResult
    detail_level: str = "comprehensive"  # brief, moderate, comprehensive


class ComparisonRequest(BaseModel):
    """Request to compare discoveries."""
    discoveries: list[DiscoveryResult]


# Service instance (lazy initialization)
_service: Optional[DiseaseDiscoveryService] = None


async def get_service(provider: str = None) -> DiseaseDiscoveryService:
    """Get or create discovery service."""
    global _service

    llm_provider = LLMProvider(provider) if provider else None

    if _service is None or (provider and llm_provider):
        _service = DiseaseDiscoveryService(llm_provider)
        await _service.initialize()

    return _service


@router.post("/analyze", response_model=DiscoveryResponse)
async def discover_disease_treatments(request: DiscoveryRequest):
    """
    Discover potential treatments, strategies, or prevention approaches for a disease.

    Combines knowledge-graph analysis (genes, proteins, drugs, pathways) with
    open biomedical literature retrieval (PubMed, EuropePMC, OpenAlex,
    clinical trials, preprints, patents) and returns ranked discoveries with
    confidence scores.
    """
    try:
        service = await get_service(request.llm_provider)

        discoveries = await service.discover(
            disease=request.disease,
            discovery_type=request.discovery_type,
            focus_entities=request.focus_entities if request.focus_entities else None,
            max_results=request.max_results,
        )

        return DiscoveryResponse(
            disease=request.disease,
            discovery_type=request.discovery_type.value,
            discoveries=discoveries,
            total_count=len(discoveries),
        )

    except Exception as exc:
        raise safe_error(
            exc,
            code=ErrorCode.PIPELINE_FAILED,
            log_context={"disease": request.disease, "discovery_type": str(request.discovery_type)},
        )


@router.get("/quick/{disease}")
async def quick_discovery(
    disease: str,
    discovery_type: DiscoveryType = Query(default=DiscoveryType.TREATMENT),
    max_results: int = Query(default=3, ge=1, le=10),
):
    """
    Quick discovery endpoint for simple queries.

    Returns top discoveries for a disease without additional configuration.
    """
    try:
        service = await get_service()

        discoveries = await service.discover(
            disease=disease,
            discovery_type=discovery_type,
            max_results=max_results,
        )

        return {
            "disease": disease,
            "discovery_type": discovery_type.value,
            "discoveries": [
                {
                    "title": d.title,
                    "description": d.description,
                    "confidence": d.confidence_score,
                    "evidence_strength": d.evidence_strength.value,
                    "mechanism": d.mechanism_of_action,
                    "next_steps": d.next_steps[:3],
                }
                for d in discoveries
            ],
        }

    except Exception as exc:
        raise safe_error(
            exc,
            code=ErrorCode.PIPELINE_FAILED,
            log_context={"disease": disease, "discovery_type": str(discovery_type)},
        )


@router.post("/explain")
async def explain_discovery(request: ExplanationRequest):
    """
    Get a detailed explanation of a discovery.

    Provides comprehensive scientific explanation including:
    - Significance of the discovery
    - Biological rationale
    - Current research state
    - Challenges and limitations
    - Recommended next steps
    """
    try:
        service = await get_service()

        explanation = await service.explain_discovery(
            discovery=request.discovery,
            detail_level=request.detail_level,
        )

        return {
            "discovery_id": request.discovery.id,
            "discovery_title": request.discovery.title,
            "explanation": explanation,
            "detail_level": request.detail_level,
        }

    except Exception as exc:
        raise safe_error(exc, code=ErrorCode.PIPELINE_FAILED)


@router.post("/compare")
async def compare_discoveries(request: ComparisonRequest):
    """
    Compare multiple discoveries and get recommendations.

    Returns:
    - Ranking by overall promise
    - Key differentiators
    - Combination potential
    - Resource requirements
    - Timeline estimates
    - Final recommendation
    """
    try:
        service = await get_service()

        comparison = await service.compare_discoveries(request.discoveries)

        return {
            "discoveries_compared": len(request.discoveries),
            "analysis": comparison,
        }

    except Exception as exc:
        raise safe_error(exc, code=ErrorCode.PIPELINE_FAILED)


# `/providers` was removed in Sprint 1: the v1 surface does NOT let
# clients pick a provider, and listing the vendor/model lineup was a
# direct IP leak (it advertised the multi-vendor architecture verbatim).
# Provider selection is server-side only; the orchestrator routes per
# stage based on internal config.


@router.get("/discovery-types")
async def list_discovery_types():
    """List available discovery types."""
    return {
        "types": [
            {
                "id": "treatment",
                "name": "Treatment Discovery",
                "description": "Find potential therapeutic strategies for the disease",
                "default": True,
            },
            {
                "id": "prevention",
                "name": "Prevention Strategy",
                "description": "Identify ways to prevent disease onset",
            },
            {
                "id": "biomarker",
                "name": "Biomarker Discovery",
                "description": "Identify biomarkers for early detection and monitoring",
            },
            {
                "id": "drug_repurposing",
                "name": "Drug Repurposing",
                "description": "Find existing drugs that could treat this disease",
            },
            {
                "id": "combination_therapy",
                "name": "Combination Therapy",
                "description": "Identify synergistic drug combinations",
            },
        ],
    }


# `/discovery/health` removed in Sprint 1: it leaked exact model IDs
# (BEDROCK_MODEL_CLAUDE_OPUS, AZURE_MISTRAL_MODEL) plus agent role names
# ("explorer+synthesizer", "critic") and `str(exc)` on failure. Use the
# top-level `/health` endpoint for liveness; for orchestrator diagnostics
# use the admin-only health check (Sprint 1 / D4).
