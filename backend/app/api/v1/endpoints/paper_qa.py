"""
Paper quality-assurance endpoints — the surfaces the frontend paper
viewer calls to (a) estimate cost before a run and (b) audit a drafted
paper before export.

Routes:
    POST /api/v1/cost/predict                  — run-cost forecast
    POST /api/v1/paper/qa                      — pre-submission QA
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.core.logging import get_logger
from app.core.auth import AUTH_REQUIRED
from app.services.cost_predictor import predict_discovery_cost

logger = get_logger(__name__)

router = APIRouter(prefix="/paper", tags=["paper-qa"], dependencies=AUTH_REQUIRED)
cost_router = APIRouter(prefix="/cost", tags=["cost"])


# ---------------------------------------------------------------------------
# Cost predictor
# ---------------------------------------------------------------------------


class CostPredictRequest(BaseModel):
    num_hypotheses: int = Field(default=9, ge=1, le=50)
    num_rounds: int = Field(default=3, ge=1, le=10)
    enable_paper_gen: bool = Field(default=True)
    enable_protocol: bool = Field(default=True)
    user_id: str | None = Field(default=None)


class CostPredictResponse(BaseModel):
    estimate_usd: float
    confidence_low: float
    confidence_high: float
    breakdown_per_stage: list[dict[str, Any]]
    n_historical_samples: int
    note: str


@cost_router.post("/predict", response_model=CostPredictResponse)
async def predict_cost(payload: CostPredictRequest) -> CostPredictResponse:
    """Return a calibrated ex-ante cost estimate for a discovery run."""
    try:
        p = await predict_discovery_cost(
            num_hypotheses=payload.num_hypotheses,
            num_rounds=payload.num_rounds,
            enable_paper_gen=payload.enable_paper_gen,
            enable_protocol=payload.enable_protocol,
            user_id=payload.user_id,
        )
    except Exception as e:
        logger.exception("[cost_predict] failed")
        raise HTTPException(status_code=500, detail=str(e))
    return CostPredictResponse(**p.to_dict())


# ---------------------------------------------------------------------------
# Paper QA
# ---------------------------------------------------------------------------


class PaperStub(BaseModel):
    sections: dict[str, str] = Field(default_factory=dict)
    references: list[dict[str, Any]] = Field(default_factory=list)
    figures: list[dict[str, Any]] = Field(default_factory=list)
    tables: list[dict[str, Any]] = Field(default_factory=list)
    validation: list[dict[str, Any]] | None = None


class QARequest(BaseModel):
    paper: PaperStub
    check_links: bool = True


class QAFindingResponse(BaseModel):
    check: str
    severity: str
    section: str
    message: str
    location: str = ""
    fix_hint: str = ""


class QAResponse(BaseModel):
    findings: list[QAFindingResponse]
    stats: dict[str, int]
    is_pass: bool


@router.post("/qa", response_model=QAResponse)
async def run_paper_qa(payload: QARequest) -> QAResponse:
    """Audit a paper for reference resolution, figure/table cross-refs,
    numerical consistency, duplicate sentences, broken links, and
    structural validation findings. Returns a QAReport ready for the
    doc viewer's Issues panel."""
    from app.agents.pre_submission_qa import run_qa

    # Adapt PaperStub to the object shape run_qa expects
    class _StubPaper:
        def __init__(self, d: PaperStub):
            self.sections = d.sections
            self.references = d.references
            self.figures = d.figures
            self.tables = d.tables
            self.validation = d.validation or []

    try:
        report = await run_qa(_StubPaper(payload.paper),
                              check_links=payload.check_links)
    except Exception as e:
        logger.exception("[paper_qa] failed")
        raise HTTPException(status_code=500, detail=str(e))

    return QAResponse(
        findings=[QAFindingResponse(**f.to_dict()) for f in report.findings],
        stats=report.stats,
        is_pass=report.is_pass,
    )
