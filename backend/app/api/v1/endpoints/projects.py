"""
Projects API Endpoints

Manage research projects in humanovo.
All data persisted to PostgreSQL via Project model.
"""

from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.logging import get_logger
from app.core.auth import AUTH_REQUIRED, get_current_active_user
from app.core.ownership import assert_owns_project, filter_by_owned_project
from app.models.user import User

logger = get_logger(__name__)
router = APIRouter(dependencies=AUTH_REQUIRED)


def _get_project_model():
    from app.models.project import Project, ProjectStatus
    return Project, ProjectStatus


# Schemas
class ProjectCreate(BaseModel):
    """Schema for creating a new project."""

    name: str = Field(..., min_length=1, max_length=255)
    description: str | None = Field(None, max_length=2000)
    disease_focus: str | None = Field(None, description="Primary disease/condition focus")
    research_question: str | None = Field(None, description="Main research question")
    tags: list[str] = Field(default_factory=list)


class ProjectUpdate(BaseModel):
    """Schema for updating a project."""

    name: str | None = Field(None, min_length=1, max_length=255)
    description: str | None = Field(None, max_length=2000)
    disease_focus: str | None = None
    research_question: str | None = None
    tags: list[str] | None = None
    status: str | None = None


class ProjectResponse(BaseModel):
    """Schema for project response."""

    id: UUID
    name: str
    description: str | None = None
    disease_focus: str | None = None
    research_question: str | None = None
    tags: list[str] = []
    status: str = "active"
    hypothesis_count: int = 0
    evidence_count: int = 0
    simulation_count: int = 0
    hypotheses: list[dict] | None = None
    created_at: datetime = datetime.now(timezone.utc)
    updated_at: datetime = datetime.now(timezone.utc)

    model_config = {"from_attributes": True}


class ProjectListResponse(BaseModel):
    """Schema for paginated project list."""

    items: list[ProjectResponse]
    total: int
    page: int
    page_size: int
    total_pages: int


def project_to_response(project) -> ProjectResponse:
    """Convert Project ORM model to response schema."""
    _, ProjectStatus = _get_project_model()
    status_val = project.status
    if ProjectStatus and isinstance(project.status, ProjectStatus):
        status_val = project.status.value
    return ProjectResponse(
        id=project.id,
        name=project.name,
        description=project.description,
        disease_focus=project.disease_focus,
        research_question=project.research_question,
        tags=project.tags or [],
        status=status_val,
        hypothesis_count=project.hypothesis_count or 0,
        evidence_count=project.evidence_count or 0,
        simulation_count=project.simulation_count or 0,
        created_at=project.created_at,
        updated_at=project.updated_at,
    )


@router.post("", response_model=ProjectResponse, status_code=201)
async def create_project(
    project: ProjectCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> ProjectResponse:
    """Create a new research project owned by the caller."""
    logger.info("Creating new project", name=project.name, owner_id=str(current_user.id))
    Project, ProjectStatus = _get_project_model()

    db_project = Project(
        name=project.name,
        description=project.description,
        disease_focus=project.disease_focus,
        research_question=project.research_question,
        tags=project.tags,
        status=ProjectStatus.ACTIVE,
        owner_id=current_user.id,
    )
    db.add(db_project)
    await db.flush()
    await db.refresh(db_project)
    logger.info("Project created", project_id=str(db_project.id))
    return project_to_response(db_project)


@router.get("", response_model=ProjectListResponse)
async def list_projects(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: str | None = None,
    status: str | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> ProjectListResponse:
    """List the caller's projects with pagination."""
    Project, ProjectStatus = _get_project_model()

    query = select(Project).where(Project.owner_id == current_user.id)
    if search:
        search_filter = f"%{search}%"
        query = query.where(
            (Project.name.ilike(search_filter)) |
            (Project.description.ilike(search_filter)) |
            (Project.disease_focus.ilike(search_filter))
        )
    if status and ProjectStatus:
        try:
            status_enum = ProjectStatus(status)
            query = query.where(Project.status == status_enum)
        except ValueError:
            logger.debug("Invalid project status filter ignored", status=status)

    count_query = select(func.count()).select_from(query.subquery())
    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0

    query = query.order_by(Project.updated_at.desc())
    query = query.offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(query)
    projects = result.scalars().all()
    total_pages = (total + page_size - 1) // page_size

    return ProjectListResponse(
        items=[project_to_response(p) for p in projects],
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
    )


@router.get("/{project_id}", response_model=ProjectResponse)
async def get_project(
    project_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> ProjectResponse:
    """Get one of the caller's projects by ID, including its hypotheses.

    Returns 404 (not 403) on a non-owned project so callers can't probe
    for the existence of someone else's IDs.
    """
    Project, ProjectStatus = _get_project_model()

    result = await db.execute(
        select(Project).where(
            Project.id == project_id,
            Project.owner_id == current_user.id,
        )
    )
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # Fetch hypotheses linked to this project. The Project ownership
    # join is redundant given the explicit project ownership check
    # above, but kept as defense-in-depth so the query stays safe if
    # the upstream check is ever refactored.
    hypotheses_list = None
    try:
        from app.models.hypothesis import Hypothesis
        hyp_query = filter_by_owned_project(
            select(Hypothesis).where(Hypothesis.project_id == project_id),
            Hypothesis,
            current_user,
        )
        hyp_result = await db.execute(hyp_query)
        db_hypotheses = hyp_result.scalars().all()
        if db_hypotheses:
            hypotheses_list = []
            for h in db_hypotheses:
                hyp_dict = {
                    "id": str(h.id),
                    "title": h.statement,
                    "description": h.rationale or "",
                    "mechanism": h.mechanism or "",
                    "confidence": h.confidence_score or 0.0,
                    "model_used": (h.generation_context or {}).get("model_used", "unknown"),
                    "validated": h.status.value == "validated" if hasattr(h.status, "value") else False,
                    "external_factors": (h.generation_context or {}).get("external_factors", []),
                    "created_at": h.created_at.isoformat() if h.created_at else None,
                }
                hypotheses_list.append(hyp_dict)
    except Exception as e:
        logger.warning("Failed to fetch hypotheses for project", error=str(e))

    resp = project_to_response(project)
    if hypotheses_list is not None:
        resp.hypotheses = hypotheses_list
        resp.hypothesis_count = len(hypotheses_list)
    return resp


@router.patch("/{project_id}", response_model=ProjectResponse)
async def update_project(
    project_id: UUID,
    project_update: ProjectUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> ProjectResponse:
    """Update one of the caller's projects."""
    Project, ProjectStatus = _get_project_model()

    result = await db.execute(
        select(Project).where(
            Project.id == project_id,
            Project.owner_id == current_user.id,
        )
    )
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    update_data = project_update.model_dump(exclude_unset=True)
    if "status" in update_data and update_data["status"] and ProjectStatus:
        try:
            update_data["status"] = ProjectStatus(update_data["status"])
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid status: {update_data['status']}")

    for key, value in update_data.items():
        setattr(project, key, value)

    await db.flush()
    await db.refresh(project)
    return project_to_response(project)


@router.delete("/{project_id}", status_code=204)
async def delete_project(
    project_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> None:
    """Delete one of the caller's projects."""
    Project, _ = _get_project_model()

    result = await db.execute(
        select(Project).where(
            Project.id == project_id,
            Project.owner_id == current_user.id,
        )
    )
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    await db.delete(project)
    await db.flush()


# ── Bulk operations ──────────────────────────────────────────────
# These let the UI hit one round-trip for multi-select actions instead
# of N sequential DELETE/PATCH calls. Safe-by-default: unknown IDs are
# skipped rather than 404'ing the whole batch.


class BulkIds(BaseModel):
    """Body for bulk operations. Accepts up to 200 project IDs per call."""
    ids: list[UUID] = Field(..., min_length=1, max_length=200)


@router.post("/bulk-delete")
async def bulk_delete_projects(
    body: BulkIds,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> dict:
    """Delete multiple of the caller's projects in one round-trip.

    Idempotent. IDs the caller doesn't own are silently skipped (same
    response shape as IDs that don't exist) — no leak about whether
    the ID belongs to someone else.
    """
    Project, _ = _get_project_model()
    result = await db.execute(
        select(Project).where(
            Project.id.in_(body.ids),
            Project.owner_id == current_user.id,
        )
    )
    projects = result.scalars().all()
    found_ids = [str(p.id) for p in projects]
    for p in projects:
        await db.delete(p)
    await db.flush()
    return {"deleted": found_ids, "requested": len(body.ids), "deleted_count": len(found_ids)}


@router.post("/bulk-archive")
async def bulk_archive_projects(
    body: BulkIds,
    restore: bool = Query(False, description="If true, restore archived projects back to 'active'"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> dict:
    """Archive (or restore) multiple of the caller's projects.

    Defaults to archiving. Pass `?restore=true` to flip archived
    projects back to active. IDs the caller doesn't own are silently
    skipped.
    """
    Project, ProjectStatus = _get_project_model()
    if not ProjectStatus:
        raise HTTPException(status_code=500, detail="ProjectStatus enum unavailable")

    result = await db.execute(
        select(Project).where(
            Project.id.in_(body.ids),
            Project.owner_id == current_user.id,
        )
    )
    projects = result.scalars().all()
    target = ProjectStatus.ACTIVE if restore else ProjectStatus.ARCHIVED
    updated_ids: list[str] = []
    for p in projects:
        p.status = target
        updated_ids.append(str(p.id))
    await db.flush()
    return {
        "updated": updated_ids,
        "requested": len(body.ids),
        "updated_count": len(updated_ids),
        "status": target.value if hasattr(target, "value") else str(target),
    }


@router.get("/{project_id}/stats")
async def get_project_stats(
    project_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> dict:
    """Get statistics for one of the caller's projects."""
    Project, ProjectStatus = _get_project_model()

    result = await db.execute(
        select(Project).where(
            Project.id == project_id,
            Project.owner_id == current_user.id,
        )
    )
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return {
        "project_id": str(project.id),
        "hypothesis_count": project.hypothesis_count or 0,
        "evidence_count": project.evidence_count or 0,
        "simulation_count": project.simulation_count or 0,
        "status": project.status.value if isinstance(project.status, ProjectStatus) else project.status,
        "created_at": project.created_at.isoformat(),
        "updated_at": project.updated_at.isoformat(),
    }


# ── Lab Profile & Discovery Config (Project Jamison v2) ──────────────


class LabProfile(BaseModel):
    """Lab capability profile for feasibility filtering."""
    equipment: list[str] = Field(default_factory=list, description="Lab equipment list")
    modalities: list[str] = Field(default_factory=list, description="Available research modalities (from methods taxonomy)")
    techniques: list[str] = Field(default_factory=list, description="Research techniques")
    excluded_methods: list[str] = Field(default_factory=list, description="Methods the lab cannot perform")
    filter_mode: str = Field(default="permissive", description="'strict' (exclude low-feasibility) or 'permissive' (flag but keep)")


class DiscoveryConfig(BaseModel):
    """Project-level discovery pipeline configuration."""
    default_discovery_type: str = Field(default="treatment_discovery", description="Default discovery type")
    default_num_rounds: int = Field(default=3, ge=1, le=4, description="Default number of rounds")
    default_output_format: str = Field(default="narrative", description="Default output format")
    default_verbosity: str = Field(default="standard", description="Default verbosity level")
    default_citation_style: str = Field(default="numbered", description="Default citation style")
    external_factors: list[str] = Field(default_factory=list, description="Default external factors")


@router.patch("/{project_id}/lab-profile")
async def update_lab_profile(
    project_id: UUID,
    profile: LabProfile,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Update the lab capability profile for one of the caller's projects."""
    Project, _ = _get_project_model()
    from sqlalchemy import update
    result = await db.execute(
        update(Project)
        .where(
            Project.id == project_id,
            Project.owner_id == current_user.id,
        )
        .values(lab_profile=profile.model_dump())
        .returning(Project.id)
    )
    updated = result.scalar_one_or_none()
    if not updated:
        raise HTTPException(status_code=404, detail="Project not found")
    await db.flush()
    return {"status": "ok", "lab_profile": profile.model_dump()}


@router.get("/{project_id}/lab-profile")
async def get_lab_profile(
    project_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Get the lab capability profile for one of the caller's projects."""
    Project, _ = _get_project_model()
    result = await db.execute(
        select(Project).where(
            Project.id == project_id,
            Project.owner_id == current_user.id,
        )
    )
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return {"lab_profile": getattr(project, "lab_profile", None) or {}}


@router.patch("/{project_id}/discovery-config")
async def update_discovery_config(
    project_id: UUID,
    config: DiscoveryConfig,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Update the default discovery configuration for one of the
    caller's projects."""
    Project, _ = _get_project_model()
    from sqlalchemy import update
    result = await db.execute(
        update(Project)
        .where(
            Project.id == project_id,
            Project.owner_id == current_user.id,
        )
        .values(discovery_config=config.model_dump())
        .returning(Project.id)
    )
    updated = result.scalar_one_or_none()
    if not updated:
        raise HTTPException(status_code=404, detail="Project not found")
    await db.flush()
    return {"status": "ok", "discovery_config": config.model_dump()}


@router.get("/{project_id}/discovery-config")
async def get_discovery_config(
    project_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Get the discovery configuration for one of the caller's projects."""
    Project, _ = _get_project_model()
    result = await db.execute(
        select(Project.discovery_config).where(
            Project.id == project_id,
            Project.owner_id == current_user.id,
        )
    )
    row = result.scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return {"discovery_config": row or {}}


# ─── Project-scoped knowledge-graph projection ───────────────────
# The frontend ProjectKnowledgeGraph page expects per-project subgraphs.
# These delegate to the global knowledge_graph endpoints filtered to the
# entities mentioned in the project's hypotheses + evidence.

@router.get("/{project_id}/knowledge-graph")
async def get_project_knowledge_graph(
    project_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Return nodes + edges for the project-scoped knowledge subgraph.

    Initial implementation returns an empty graph until per-project
    entity tagging is wired up — this prevents 404s in the frontend
    and lets the page render the empty-state UX rather than crash.
    """
    await assert_owns_project(db, project_id, current_user)
    return {
        "nodes": [],
        "edges": [],
        "project_id": str(project_id),
        "stats": {"node_count": 0, "edge_count": 0},
    }


@router.get("/{project_id}/knowledge-graph/neighbors/{node_id}")
async def get_project_knowledge_graph_neighbors(
    project_id: UUID,
    node_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """N-hop neighborhood of a single node within the project subgraph."""
    await assert_owns_project(db, project_id, current_user)
    return {
        "node_id": node_id,
        "project_id": str(project_id),
        "neighbors": [],
        "edges": [],
    }
