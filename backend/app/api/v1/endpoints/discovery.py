"""
Discovery API Endpoints

API endpoints for the disease discovery service.
"""

from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.core.logging import get_logger
from app.services.disease_discovery_service import (
    DiscoveryResult,
    DiscoveryType,
    DiseaseDiscoveryService,
    LLMProvider,
    TranslationalRoadmap,
)

logger = get_logger(__name__)

router = APIRouter(prefix="/discovery", tags=["discovery"])


class DiscoveryRequest(BaseModel):
    """Request model for disease discovery."""
    disease: str
    discovery_type: DiscoveryType = DiscoveryType.TREATMENT
    focus_entities: list[str] = []
    max_results: int = 5
    llm_provider: Optional[str] = None  # openai, anthropic, bedrock, together, groq


class DiscoveryResponse(BaseModel):
    """Response model for discovery results."""
    disease: str
    discovery_type: str
    discoveries: list[DiscoveryResult]
    total_count: int
    llm_provider: str
    model_used: str


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

    This endpoint uses advanced LLM reasoning combined with:
    - Knowledge graph analysis (genes, proteins, drugs, pathways)
    - Research literature retrieval (PubMed, clinical trials, patents)
    - Real-time healthcare data (web search)

    Returns ranked discoveries with confidence scores.
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
            llm_provider=discoveries[0].llm_provider if discoveries else "",
            model_used=discoveries[0].model_used if discoveries else "",
        )

    except Exception as e:
        logger.error("Discovery failed", disease=request.disease, error=str(e))
        raise HTTPException(status_code=500, detail=f"Discovery failed: {str(e)}")


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

    except Exception as e:
        logger.error("Quick discovery failed", disease=disease, error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


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

    except Exception as e:
        logger.error("Explanation failed", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


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

    except Exception as e:
        logger.error("Comparison failed", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/providers")
async def list_providers():
    """List available LLM providers for discovery."""
    return {
        "providers": [
            {
                "id": "azure_ai",
                "name": "Azure AI Foundry",
                "description": "Mistral-Large-3 (critic)",
                "default": True,
            },
            {
                "id": "bedrock",
                "name": "AWS Bedrock",
                "description": "Claude Opus 4.6 (explorer + synthesizer)",
            },
            {
                "id": "azure",
                "name": "Azure OpenAI",
                "description": "o3-deep-research, o1 (legacy, requires org access)",
            },
        ],
        "recommended": "azure_ai",
    }


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


@router.get("/health")
async def discovery_health():
    """Check health of the discovery service."""
    try:
        from app.core.config import settings
        service = await get_service()

        # Build model list — show mixed provider models
        models_active = []
        providers = []
        if settings.aws_access_key_value and settings.aws_secret_key_value:
            models_active.append(f"{settings.BEDROCK_MODEL_CLAUDE_OPUS} (explorer+synthesizer)")
            providers.append("bedrock")
        if settings.azure_mistral_key_value and settings.AZURE_MISTRAL_ENDPOINT:
            models_active.append(f"{settings.AZURE_MISTRAL_MODEL} (critic)")
            providers.append("azure-mistral")
        llm_info = {
            "providers": providers,
            "models": models_active,
        } if models_active else {"provider": service._llm.model_name}

        return {
            "status": "healthy",
            "llm": llm_info,
            "graph_store": "connected" if service._graph_store else "not connected",
            "rag_service": "connected" if service._rag_service else "not connected",
        }
    except Exception as e:
        return {
            "status": "unhealthy",
            "error": str(e),
        }
