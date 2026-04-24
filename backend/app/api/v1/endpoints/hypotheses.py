"""
Hypotheses API Endpoints

Manage AI-generated hypotheses in GenUp with SQLAlchemy persistence.
"""

from datetime import datetime
from enum import Enum
from uuid import UUID, uuid4

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.logging import get_logger
from app.models.hypothesis import (
    EvidenceReference as EvidenceReferenceModel,
    EvidenceType as EvidenceTypeModel,
    Hypothesis,
    HypothesisStatus as HypothesisStatusModel,
)

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


class EvidenceReferenceSchema(BaseModel):
    """Reference to supporting/contradicting evidence."""

    evidence_id: UUID
    evidence_type: EvidenceType
    relevance_score: float = Field(..., ge=0, le=1)
    snippet: str | None = None


class HypothesisCreate(BaseModel):
    """Schema for creating a hypothesis."""

    project_id: UUID
    statement: str = Field(..., min_length=10, max_length=2000)
    mechanism: str | None = Field(None, description="Proposed mechanism")
    tags: list[str] = Field(default_factory=list)


class HypothesisGenerate(BaseModel):
    """Schema for AI-generated hypothesis request."""

    project_id: UUID
    query: str = Field(..., min_length=5, max_length=1000, description="Research question or topic")
    focus_entities: list[str] = Field(default_factory=list, description="Entities to focus on")
    max_hypotheses: int = Field(default=5, ge=1, le=20)


class HypothesisUpdate(BaseModel):
    """Schema for updating a hypothesis."""

    statement: str | None = Field(None, min_length=10, max_length=2000)
    mechanism: str | None = None
    rationale: str | None = None
    status: HypothesisStatus | None = None
    tags: list[str] | None = None
    user_notes: str | None = None


class SimulationResultSchema(BaseModel):
    """Simulation results attached to a hypothesis."""

    simulation_id: UUID
    outcome_probability: float
    confidence_interval: tuple[float, float]
    iterations: int
    summary: str


class TranslationalPhaseSchema(BaseModel):
    """Schema for a single translational phase."""

    phase: str
    phase_name: str
    formal_name: str = ""
    description: str = ""
    objectives: list[str] = []
    key_activities: list[str] = []
    milestones: list[str] = []
    deliverables: list[str] = []
    evidence_requirements: list[str] = []
    data_sources: list[str] = []
    regulatory_considerations: list[str] = []
    regulatory_milestones: list[str] = []
    key_stakeholders: list[str] = []
    collaborators: list[str] = []
    success_criteria: list[str] = []
    go_no_go_gates: list[str] = []
    phase_risks: list[str] = []
    mitigation_strategies: list[str] = []
    estimated_duration: str = ""
    resource_requirements: list[str] = []
    estimated_cost_range: str = ""
    prerequisites: list[str] = []
    blockers: list[str] = []


class TranslationalRoadmapSchema(BaseModel):
    """Schema for the complete T0-T5 translational roadmap."""

    current_phase: str = "T0"
    phases: list[TranslationalPhaseSchema] = []
    overall_feasibility_score: float = 0.5
    estimated_total_timeline: str = ""
    critical_path_summary: str = ""
    key_decision_points: list[str] = []
    cross_phase_risks: list[str] = []
    regulatory_pathway_summary: str = ""
    commercialization_potential: str = ""


class HypothesisResponse(BaseModel):
    """Schema for hypothesis response."""

    id: UUID
    project_id: UUID
    statement: str
    mechanism: str | None
    rationale: str | None
    status: HypothesisStatus
    confidence_score: float
    novelty_score: float
    evidence_refs: list[EvidenceReferenceSchema]
    contradiction_count: int
    supporting_count: int
    simulation_results: SimulationResultSchema | None
    translational_roadmap: TranslationalRoadmapSchema | None = None
    tags: list[str]
    user_notes: str | None
    version: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class HypothesisListResponse(BaseModel):
    """Schema for paginated hypothesis list."""

    items: list[HypothesisResponse]
    total: int
    page: int
    page_size: int


class GenerationTaskResponse(BaseModel):
    """Response for hypothesis generation task."""

    task_id: UUID
    status: str
    message: str


# In-memory storage for generation tasks (can be moved to Redis later)
_generation_tasks: dict = {}


def hypothesis_to_response(h: Hypothesis) -> HypothesisResponse:
    """Convert a Hypothesis model to a HypothesisResponse."""
    evidence_refs = []
    for ref in h.evidence_refs:
        evidence_refs.append(
            EvidenceReferenceSchema(
                evidence_id=ref.evidence_id,
                evidence_type=EvidenceType(ref.evidence_type.value),
                relevance_score=ref.relevance_score,
                snippet=ref.snippet,
            )
        )

    simulation_results = None
    if h.simulation_results:
        simulation_results = SimulationResultSchema(
            simulation_id=UUID(h.simulation_results["simulation_id"]),
            outcome_probability=h.simulation_results["outcome_probability"],
            confidence_interval=tuple(h.simulation_results["confidence_interval"]),
            iterations=h.simulation_results["iterations"],
            summary=h.simulation_results["summary"],
        )

    # Parse translational roadmap from JSONB
    translational_roadmap = None
    if h.translational_roadmap and isinstance(h.translational_roadmap, dict):
        try:
            translational_roadmap = TranslationalRoadmapSchema(**h.translational_roadmap)
        except Exception:
            pass

    return HypothesisResponse(
        id=h.id,
        project_id=h.project_id,
        statement=h.statement,
        mechanism=h.mechanism,
        rationale=h.rationale,
        status=HypothesisStatus(h.status.value),
        confidence_score=h.confidence_score if h.confidence_score is not None and h.confidence_score == h.confidence_score else 0.0,
        novelty_score=h.novelty_score if h.novelty_score is not None and h.novelty_score == h.novelty_score else 0.0,
        evidence_refs=evidence_refs,
        contradiction_count=h.contradiction_count,
        supporting_count=h.supporting_count,
        simulation_results=simulation_results,
        translational_roadmap=translational_roadmap,
        tags=h.tags or [],
        user_notes=h.user_notes,
        version=h.version,
        created_at=h.created_at,
        updated_at=h.updated_at,
    )


@router.post("", response_model=HypothesisResponse, status_code=201)
async def create_hypothesis(
    hypothesis: HypothesisCreate,
    db: AsyncSession = Depends(get_db),
) -> HypothesisResponse:
    """Create a new hypothesis manually."""
    logger.info("Creating new hypothesis", project_id=str(hypothesis.project_id))

    db_hypothesis = Hypothesis(
        id=uuid4(),
        project_id=hypothesis.project_id,
        statement=hypothesis.statement,
        mechanism=hypothesis.mechanism,
        status=HypothesisStatusModel.DRAFT,
        confidence_score=0.0,
        novelty_score=0.0,
        supporting_count=0,
        contradiction_count=0,
        tags=hypothesis.tags,
        version=1,
        generated_by="user",
    )

    db.add(db_hypothesis)
    await db.commit()
    await db.refresh(db_hypothesis)

    logger.info("Hypothesis created", hypothesis_id=str(db_hypothesis.id))
    return hypothesis_to_response(db_hypothesis)


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
    from app.core.database import async_session_factory

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

        # Store generated hypotheses in database
        async with async_session_factory() as db:
            for h in hypotheses:
                # Extract translational roadmap if available
                translational_roadmap_data = None
                raw_roadmap = getattr(h, "translational_roadmap", None)
                if raw_roadmap:
                    if hasattr(raw_roadmap, "model_dump"):
                        translational_roadmap_data = raw_roadmap.model_dump()
                    elif isinstance(raw_roadmap, dict):
                        translational_roadmap_data = raw_roadmap

                db_hypothesis = Hypothesis(
                    id=h.id if hasattr(h, "id") else uuid4(),
                    project_id=request.project_id,
                    statement=h.statement if hasattr(h, "statement") else str(h),
                    mechanism=getattr(h, "mechanism", None),
                    rationale=getattr(h, "rationale", None),
                    status=HypothesisStatusModel.ACTIVE,
                    confidence_score=getattr(h, "confidence_score", None) or getattr(h, "confidence", 0.5),
                    novelty_score=getattr(h, "novelty_score", 0.5),
                    supporting_count=0,
                    contradiction_count=0,
                    tags=getattr(h, "tags", []),
                    version=1,
                    generated_by="ai",
                    generation_context={
                        "query": request.query,
                        "focus_entities": request.focus_entities,
                    },
                    translational_roadmap=translational_roadmap_data,
                )
                db.add(db_hypothesis)
                _generation_tasks[task_id]["hypotheses_generated"] += 1

            await db.commit()

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
    project_id: UUID | None = None,
    status: HypothesisStatus | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    sort_by: str = Query("updated_at", pattern="^(updated_at|confidence_score|novelty_score)$"),
    db: AsyncSession = Depends(get_db),
) -> HypothesisListResponse:
    """List hypotheses with filtering and pagination."""
    # Build base query
    query = select(Hypothesis).options(selectinload(Hypothesis.evidence_refs))

    # Apply filters
    if project_id:
        query = query.where(Hypothesis.project_id == project_id)
    if status:
        query = query.where(Hypothesis.status == HypothesisStatusModel(status.value))

    # Get total count
    count_query = select(func.count()).select_from(Hypothesis)
    if project_id:
        count_query = count_query.where(Hypothesis.project_id == project_id)
    if status:
        count_query = count_query.where(Hypothesis.status == HypothesisStatusModel(status.value))

    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0

    # Apply sorting
    sort_column = getattr(Hypothesis, sort_by)
    query = query.order_by(desc(sort_column))

    # Apply pagination
    offset = (page - 1) * page_size
    query = query.offset(offset).limit(page_size)

    # Execute query
    result = await db.execute(query)
    hypotheses = result.scalars().all()

    return HypothesisListResponse(
        items=[hypothesis_to_response(h) for h in hypotheses],
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
    query = (
        select(Hypothesis)
        .options(selectinload(Hypothesis.evidence_refs))
        .where(Hypothesis.id == hypothesis_id)
    )
    result = await db.execute(query)
    hypothesis = result.scalar_one_or_none()

    if not hypothesis:
        raise HTTPException(status_code=404, detail="Hypothesis not found")

    return hypothesis_to_response(hypothesis)


@router.patch("/{hypothesis_id}", response_model=HypothesisResponse)
async def update_hypothesis(
    hypothesis_id: UUID,
    update: HypothesisUpdate,
    db: AsyncSession = Depends(get_db),
) -> HypothesisResponse:
    """Update a hypothesis."""
    query = (
        select(Hypothesis)
        .options(selectinload(Hypothesis.evidence_refs))
        .where(Hypothesis.id == hypothesis_id)
    )
    result = await db.execute(query)
    hypothesis = result.scalar_one_or_none()

    if not hypothesis:
        raise HTTPException(status_code=404, detail="Hypothesis not found")

    update_data = update.model_dump(exclude_unset=True)

    # Apply updates
    if "statement" in update_data:
        hypothesis.statement = update_data["statement"]
    if "mechanism" in update_data:
        hypothesis.mechanism = update_data["mechanism"]
    if "rationale" in update_data:
        hypothesis.rationale = update_data["rationale"]
    if "status" in update_data:
        hypothesis.status = HypothesisStatusModel(update_data["status"].value)
    if "tags" in update_data:
        hypothesis.tags = update_data["tags"]
    if "user_notes" in update_data:
        hypothesis.user_notes = update_data["user_notes"]

    # Increment version
    hypothesis.version = (hypothesis.version or 0) + 1

    await db.commit()
    await db.refresh(hypothesis)

    logger.info("Hypothesis updated", hypothesis_id=str(hypothesis_id), version=hypothesis.version)
    return hypothesis_to_response(hypothesis)


@router.delete("/{hypothesis_id}", status_code=204)
async def delete_hypothesis(
    hypothesis_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> None:
    """Delete a hypothesis."""
    query = select(Hypothesis).where(Hypothesis.id == hypothesis_id)
    result = await db.execute(query)
    hypothesis = result.scalar_one_or_none()

    if not hypothesis:
        raise HTTPException(status_code=404, detail="Hypothesis not found")

    await db.delete(hypothesis)
    await db.commit()
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
    query = (
        select(Hypothesis)
        .options(selectinload(Hypothesis.evidence_refs))
        .where(Hypothesis.id == hypothesis_id)
    )
    result = await db.execute(query)
    hypothesis = result.scalar_one_or_none()

    if not hypothesis:
        raise HTTPException(status_code=404, detail="Hypothesis not found")

    # Queue verification task
    background_tasks.add_task(_verify_hypothesis_task, hypothesis_id)

    logger.info("Hypothesis verification queued", hypothesis_id=str(hypothesis_id))
    return hypothesis_to_response(hypothesis)


async def _verify_hypothesis_task(hypothesis_id: UUID) -> None:
    """Background task for hypothesis verification."""
    from app.agents.verification_agent import VerificationAgent

    agent = VerificationAgent()
    await agent.verify(hypothesis_id)


@router.post("/{hypothesis_id}/add-evidence", response_model=HypothesisResponse)
async def add_evidence_reference(
    hypothesis_id: UUID,
    evidence_ref: EvidenceReferenceSchema,
    db: AsyncSession = Depends(get_db),
) -> HypothesisResponse:
    """Add an evidence reference to a hypothesis."""
    query = (
        select(Hypothesis)
        .options(selectinload(Hypothesis.evidence_refs))
        .where(Hypothesis.id == hypothesis_id)
    )
    result = await db.execute(query)
    hypothesis = result.scalar_one_or_none()

    if not hypothesis:
        raise HTTPException(status_code=404, detail="Hypothesis not found")

    # Create evidence reference
    ref = EvidenceReferenceModel(
        id=uuid4(),
        hypothesis_id=hypothesis_id,
        evidence_id=evidence_ref.evidence_id,
        evidence_type=EvidenceTypeModel(evidence_ref.evidence_type.value),
        relevance_score=evidence_ref.relevance_score,
        snippet=evidence_ref.snippet,
    )

    db.add(ref)

    # Update counts
    if evidence_ref.evidence_type == EvidenceType.SUPPORTING:
        hypothesis.supporting_count += 1
    elif evidence_ref.evidence_type == EvidenceType.CONTRADICTING:
        hypothesis.contradiction_count += 1

    await db.commit()
    await db.refresh(hypothesis)

    logger.info(
        "Evidence reference added",
        hypothesis_id=str(hypothesis_id),
        evidence_id=str(evidence_ref.evidence_id),
    )
    return hypothesis_to_response(hypothesis)
