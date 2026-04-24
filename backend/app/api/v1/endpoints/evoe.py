"""
EVOE ranking endpoint.

POST /api/v1/evoe/rank
    Body: { hypotheses: [ {id, title, confidence, ...}, ... ] }
    Returns: { ranked: [ {...hypothesis, evoe: {...}}, ... ] }

GET /api/v1/evoe/hypothesis/{hypothesis_id}
    Returns EvoeBreakdown for a single hypothesis, pulled from the DB
    (model: Hypothesis + any cached pipeline_trace on the row).
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Path
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.logging import get_logger
from app.models.hypothesis import Hypothesis
from app.scoring.evoe import rank, score_hypothesis

logger = get_logger(__name__)

router = APIRouter(prefix="/evoe", tags=["evoe"])


class RankRequest(BaseModel):
    hypotheses: list[dict[str, Any]] = Field(..., min_length=1)


class RankResponse(BaseModel):
    ranked: list[dict[str, Any]]


class EvoeBreakdownResponse(BaseModel):
    hypothesis_id: str
    title: str
    p_true: float
    impact_if_true_usd: float
    cost_to_test_usd: float
    evoe_usd: float
    confidence: float
    grounding_ratio: float
    verified_citation_ratio: float
    dimension_scores: dict[str, float]
    novelty_score: float
    feasibility_score: float
    modality: str
    t0_experiments_required: int


@router.post("/rank", response_model=RankResponse)
async def rank_hypotheses(payload: RankRequest) -> RankResponse:
    """Rank a list of hypotheses by EVOE (Expected Value of Experiment).

    Each ranked hypothesis is returned with its full input dict plus a
    new `evoe` field containing the breakdown (p_true, impact_usd,
    cost_usd, evoe_usd, component signals).
    """
    if not payload.hypotheses:
        raise HTTPException(status_code=400, detail="No hypotheses to rank")
    try:
        ranked = rank(payload.hypotheses)
    except Exception as e:
        logger.exception("EVOE rank failed")
        raise HTTPException(status_code=500, detail=f"rank failed: {e}")
    return RankResponse(ranked=ranked)


@router.get("/hypothesis/{hypothesis_id}", response_model=EvoeBreakdownResponse)
async def evoe_for_hypothesis(
    hypothesis_id: str = Path(..., min_length=1),
    db: AsyncSession = Depends(get_db),
) -> EvoeBreakdownResponse:
    """Return the EVOE breakdown for a stored hypothesis."""
    try:
        row = await db.execute(
            select(Hypothesis).where(Hypothesis.id == hypothesis_id)
        )
        h = row.scalar_one_or_none()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"DB lookup failed: {e}")

    if h is None:
        raise HTTPException(status_code=404, detail="Hypothesis not found")

    hyp_dict = {
        "id": str(h.id),
        "title": getattr(h, "title", None) or getattr(h, "statement", ""),
        "description": getattr(h, "description", ""),
        "mechanism": getattr(h, "mechanism", ""),
        "confidence": float(getattr(h, "confidence", 0) or 0),
        "dimension_scores": getattr(h, "dimension_scores", {}) or {},
        "feasibility_score": float(getattr(h, "feasibility_score", 0) or 0),
        "novelty_score": float(getattr(h, "novelty_score", 0) or 0),
        "validated": bool(getattr(h, "validated", False)),
        "translational_roadmap": getattr(h, "translational_roadmap", {}) or {},
        "required_methods": getattr(h, "required_methods", []) or [],
        "grounding_ratio": float(getattr(h, "grounding_ratio", 0) or 0),
        "pipeline_trace": getattr(h, "pipeline_trace", {}) or {},
    }
    br = score_hypothesis(hyp_dict)
    return EvoeBreakdownResponse(**br.to_dict())
