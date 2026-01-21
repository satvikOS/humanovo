"""
Hypotheses API Endpoints

Manage AI-generated hypotheses in GenUp.
"""

from datetime import datetime
from enum import Enum
from typing import List, Optional
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.logging import get_logger

logger = get_logger(__name__)
router = APIRouter()


class HypothesisStatus(str, Enum):
    """Status of a hypothesis."""

    DRAFT = "draft"
    GENERATING = "generating"
    ACTIVE = "active"
    VALIDATED = "validated"
    REJECTED = "rejected"
    ARCHIVED = "archived"


class EvidenceType(str, Enum):
    """Type of evidence."""

    SUPPORTING = "supporting"
    CONTRADICTING = "contradicting"
    NEUTRAL = "neutral"


class EvidenceReference(BaseModel):
    """Reference to supporting/contradicting evidence."""

    evidence_id: UUID
    evidence_type: EvidenceType
    relevance_score: float = Field(..., ge=0, le=1)
    snippet: Optional[str] = None


class HypothesisCreate(BaseModel):
    """Schema for creating a hypothesis."""

    project_id: UUID
    statement: str = Field(..., min_length=10, max_length=2000)
    mechanism: Optional[str] = Field(None, description="Proposed mechanism")
    tags: List[str] = Field(default_factory=list)


class HypothesisGenerate(BaseModel):
    """Schema for AI-generated hypothesis request."""

    project_id: UUID
    query: str = Field(..., min_length=5, max_length=1000, description="Research question or topic")
    focus_entities: List[str] = Field(default_factory=list, description="Entities to focus on")
    max_hypotheses: int = Field(default=5, ge=1, le=20)


class HypothesisUpdate(BaseModel):
    """Schema for updating a hypothesis."""

    statement: Optional[str] = Field(None, min_length=10, max_length=2000)
    mechanism: Optional[str] = None
    rationale: Optional[str] = None
    status: Optional[HypothesisStatus] = None
    tags: Optional[List[str]] = None
    user_notes: Optional[str] = None


class SimulationResult(BaseModel):
    """Simulation results attached to a hypothesis."""

    simulation_id: UUID
    outcome_probability: float
    confidence_interval: tuple[float, float]
    iterations: int
    summary: str


class HypothesisResponse(BaseModel):
    """Schema for hypothesis response."""

    id: UUID
    project_id: UUID
    statement: str
    mechanism: Optional[str]
    rationale: Optional[str]
    status: HypothesisStatus
    confidence_score: float
    novelty_score: float
    evidence_refs: List[EvidenceReference]
    contradiction_count: int
    supporting_count: int
    simulation_results: Optional[SimulationResult]
    tags: List[str]
    user_notes: Optional[str]
    version: int
    created_at: datetime
    updated_at: datetime


class HypothesisListResponse(BaseModel):
    """Schema for paginated hypothesis list."""

    items: List[HypothesisResponse]
    total: int
    page: int
    page_size: int


class GenerationTaskResponse(BaseModel):
    """Response for hypothesis generation task."""

    task_id: UUID
    status: str
    message: str


# In-memory storage for development
_hypotheses: dict = {}
_generation_tasks: dict = {}


@router.post("", response_model=HypothesisResponse, status_code=201)
async def create_hypothesis(
    hypothesis: HypothesisCreate,
    db: AsyncSession = Depends(get_db),
) -> HypothesisResponse:
    """Create a new hypothesis manually."""
    logger.info("Creating new hypothesis", project_id=str(hypothesis.project_id))

    hypothesis_id = uuid4()
    now = datetime.utcnow()

    hypothesis_data = HypothesisResponse(
        id=hypothesis_id,
        project_id=hypothesis.project_id,
        statement=hypothesis.statement,
        mechanism=hypothesis.mechanism,
        rationale=None,
        status=HypothesisStatus.DRAFT,
        confidence_score=0.0,
        novelty_score=0.0,
        evidence_refs=[],
        contradiction_count=0,
        supporting_count=0,
        simulation_results=None,
        tags=hypothesis.tags,
        user_notes=None,
        version=1,
        created_at=now,
        updated_at=now,
    )

    _hypotheses[hypothesis_id] = hypothesis_data
    logger.info("Hypothesis created", hypothesis_id=str(hypothesis_id))

    return hypothesis_data


@router.post("/generate", response_model=GenerationTaskResponse, status_code=202)
async def generate_hypotheses(
    request: HypothesisGenerate,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
) -> GenerationTaskResponse:
    """Generate hypotheses using AI agents.

    This endpoint triggers an asynchronous hypothesis generation task
    using the multi-agent system. Progress can be tracked via WebSocket.
    """
    logger.info(
        "Starting hypothesis generation",
        project_id=str(request.project_id),
        query=request.query,
    )

    task_id = uuid4()

    # Store task status
    _generation_tasks[task_id] = {
        "status": "queued",
        "project_id": request.project_id,
        "query": request.query,
        "hypotheses_generated": 0,
        "max_hypotheses": request.max_hypotheses,
    }

    # Queue background task
    background_tasks.add_task(
        _run_hypothesis_generation,
        task_id,
        request,
    )

    return GenerationTaskResponse(
        task_id=task_id,
        status="queued",
        message=f"Hypothesis generation started. Track progress via WebSocket /ws/tasks/{task_id}",
    )


async def _run_hypothesis_generation(task_id: UUID, request: HypothesisGenerate) -> None:
    """Background task for hypothesis generation."""
    logger.info("Running hypothesis generation", task_id=str(task_id))

    _generation_tasks[task_id]["status"] = "running"

    try:
        # Import and run the hypothesis generation agent
        from app.agents.hypothesis_agent import HypothesisGenerationAgent

        agent = HypothesisGenerationAgent()
        hypotheses = await agent.generate(
            query=request.query,
            project_id=request.project_id,
            focus_entities=request.focus_entities,
            max_hypotheses=request.max_hypotheses,
        )

        # Store generated hypotheses
        for h in hypotheses:
            _hypotheses[h.id] = h
            _generation_tasks[task_id]["hypotheses_generated"] += 1

        _generation_tasks[task_id]["status"] = "completed"
        logger.info(
            "Hypothesis generation completed",
            task_id=str(task_id),
            count=len(hypotheses),
        )

    except Exception as e:
        logger.error("Hypothesis generation failed", task_id=str(task_id), error=str(e))
        _generation_tasks[task_id]["status"] = "failed"
        _generation_tasks[task_id]["error"] = str(e)


@router.get("/generation/{task_id}")
async def get_generation_status(task_id: UUID) -> dict:
    """Get status of a hypothesis generation task."""
    if task_id not in _generation_tasks:
        raise HTTPException(status_code=404, detail="Generation task not found")

    return _generation_tasks[task_id]


@router.get("", response_model=HypothesisListResponse)
async def list_hypotheses(
    project_id: Optional[UUID] = None,
    status: Optional[HypothesisStatus] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    sort_by: str = Query("updated_at", pattern="^(updated_at|confidence_score|novelty_score)$"),
    db: AsyncSession = Depends(get_db),
) -> HypothesisListResponse:
    """List hypotheses with filtering and pagination."""
    items = list(_hypotheses.values())

    # Filter by project
    if project_id:
        items = [h for h in items if h.project_id == project_id]

    # Filter by status
    if status:
        items = [h for h in items if h.status == status]

    # Sort
    reverse = True
    items.sort(key=lambda x: getattr(x, sort_by), reverse=reverse)

    # Paginate
    total = len(items)
    start = (page - 1) * page_size
    end = start + page_size

    return HypothesisListResponse(
        items=items[start:end],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/{hypothesis_id}", response_model=HypothesisResponse)
async def get_hypothesis(
    hypothesis_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> HypothesisResponse:
    """Get a specific hypothesis by ID."""
    if hypothesis_id not in _hypotheses:
        raise HTTPException(status_code=404, detail="Hypothesis not found")

    return _hypotheses[hypothesis_id]


@router.patch("/{hypothesis_id}", response_model=HypothesisResponse)
async def update_hypothesis(
    hypothesis_id: UUID,
    update: HypothesisUpdate,
    db: AsyncSession = Depends(get_db),
) -> HypothesisResponse:
    """Update a hypothesis."""
    if hypothesis_id not in _hypotheses:
        raise HTTPException(status_code=404, detail="Hypothesis not found")

    hypothesis = _hypotheses[hypothesis_id]
    update_data = update.model_dump(exclude_unset=True)

    # Create updated version
    updated = HypothesisResponse(
        id=hypothesis.id,
        project_id=hypothesis.project_id,
        statement=update_data.get("statement", hypothesis.statement),
        mechanism=update_data.get("mechanism", hypothesis.mechanism),
        rationale=update_data.get("rationale", hypothesis.rationale),
        status=update_data.get("status", hypothesis.status),
        confidence_score=hypothesis.confidence_score,
        novelty_score=hypothesis.novelty_score,
        evidence_refs=hypothesis.evidence_refs,
        contradiction_count=hypothesis.contradiction_count,
        supporting_count=hypothesis.supporting_count,
        simulation_results=hypothesis.simulation_results,
        tags=update_data.get("tags", hypothesis.tags),
        user_notes=update_data.get("user_notes", hypothesis.user_notes),
        version=hypothesis.version + 1,
        created_at=hypothesis.created_at,
        updated_at=datetime.utcnow(),
    )

    _hypotheses[hypothesis_id] = updated
    logger.info("Hypothesis updated", hypothesis_id=str(hypothesis_id), version=updated.version)

    return updated


@router.delete("/{hypothesis_id}", status_code=204)
async def delete_hypothesis(
    hypothesis_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> None:
    """Delete a hypothesis."""
    if hypothesis_id not in _hypotheses:
        raise HTTPException(status_code=404, detail="Hypothesis not found")

    del _hypotheses[hypothesis_id]
    logger.info("Hypothesis deleted", hypothesis_id=str(hypothesis_id))


@router.post("/{hypothesis_id}/verify", response_model=HypothesisResponse)
async def verify_hypothesis(
    hypothesis_id: UUID,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
) -> HypothesisResponse:
    """Trigger verification of a hypothesis against knowledge graph.

    This updates the hypothesis with supporting/contradicting evidence
    and recalculates confidence scores.
    """
    if hypothesis_id not in _hypotheses:
        raise HTTPException(status_code=404, detail="Hypothesis not found")

    hypothesis = _hypotheses[hypothesis_id]

    # Queue verification task
    background_tasks.add_task(_verify_hypothesis_task, hypothesis_id)

    logger.info("Hypothesis verification queued", hypothesis_id=str(hypothesis_id))
    return hypothesis


async def _verify_hypothesis_task(hypothesis_id: UUID) -> None:
    """Background task for hypothesis verification."""
    from app.agents.verification_agent import VerificationAgent

    agent = VerificationAgent()
    await agent.verify(hypothesis_id)
