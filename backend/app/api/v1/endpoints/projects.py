"""
Projects API Endpoints

Manage research projects in humanovo.
Uses SQLAlchemy ORM with in-memory fallback when DB is unavailable.
"""

from datetime import datetime
from typing import Optional
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.logging import get_logger

logger = get_logger(__name__)
router = APIRouter()

# In-memory fallback when database is unavailable
_memory_projects: dict[str, dict] = {}
_db_available: Optional[bool] = None


async def _check_db_available() -> bool:
    """Check if database is reachable."""
    global _db_available
    if _db_available is not None:
        return _db_available
    try:
        async for session in get_db():
            from sqlalchemy import text
            await session.execute(text("SELECT 1"))
            _db_available = True
            return True
    except Exception:
        _db_available = False
        logger.warning("Database unavailable, using in-memory project store")
        return False


def _get_project_model():
    try:
        from app.models.project import Project, ProjectStatus
        return Project, ProjectStatus
    except Exception:
        return None, None


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
    hypotheses: list[dict] | None = None  # Included when available (from discovery save)
    created_at: datetime = datetime.utcnow()
    updated_at: datetime = datetime.utcnow()

    class Config:
        from_attributes = True


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
async def create_project(project: ProjectCreate) -> ProjectResponse:
    """Create a new research project."""
    logger.info("Creating new project", name=project.name)

    db_ok = await _check_db_available()
    Project, ProjectStatus = _get_project_model()

    if db_ok and Project:
        async for db in get_db():
            db_project = Project(
                name=project.name,
                description=project.description,
                disease_focus=project.disease_focus,
                research_question=project.research_question,
                tags=project.tags,
                status=ProjectStatus.ACTIVE,
            )
            db.add(db_project)
            await db.commit()
            await db.refresh(db_project)
            logger.info("Project created in DB", project_id=str(db_project.id))
            return project_to_response(db_project)

    # In-memory fallback
    now = datetime.utcnow()
    project_id = str(uuid4())
    mem_project = {
        "id": project_id,
        "name": project.name,
        "description": project.description,
        "disease_focus": project.disease_focus,
        "research_question": project.research_question,
        "tags": project.tags or [],
        "status": "active",
        "hypothesis_count": 0,
        "evidence_count": 0,
        "simulation_count": 0,
        "created_at": now,
        "updated_at": now,
    }
    _memory_projects[project_id] = mem_project
    logger.info("Project created in memory", project_id=project_id)

    return ProjectResponse(
        id=UUID(project_id),
        name=mem_project["name"],
        description=mem_project["description"],
        disease_focus=mem_project["disease_focus"],
        research_question=mem_project["research_question"],
        tags=mem_project["tags"],
        status=mem_project["status"],
        hypothesis_count=0,
        evidence_count=0,
        simulation_count=0,
        created_at=now,
        updated_at=now,
    )


@router.get("", response_model=ProjectListResponse)
async def list_projects(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: str | None = None,
    status: str | None = None,
) -> ProjectListResponse:
    """List all projects with pagination."""
    db_ok = await _check_db_available()
    Project, ProjectStatus = _get_project_model()

    if db_ok and Project:
        async for db in get_db():
            query = select(Project)
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

    # In-memory fallback
    all_projects = list(_memory_projects.values())
    if search:
        sl = search.lower()
        all_projects = [p for p in all_projects if sl in p["name"].lower() or sl in (p.get("description") or "").lower()]
    if status:
        all_projects = [p for p in all_projects if p["status"] == status]
    all_projects.sort(key=lambda p: p["updated_at"], reverse=True)
    total = len(all_projects)
    start = (page - 1) * page_size
    paged = all_projects[start:start + page_size]
    total_pages = (total + page_size - 1) // page_size

    return ProjectListResponse(
        items=[
            ProjectResponse(
                id=UUID(p["id"]),
                name=p["name"],
                description=p.get("description"),
                disease_focus=p.get("disease_focus"),
                research_question=p.get("research_question"),
                tags=p.get("tags", []),
                status=p["status"],
                hypothesis_count=p.get("hypothesis_count", 0),
                evidence_count=p.get("evidence_count", 0),
                simulation_count=p.get("simulation_count", 0),
                created_at=p["created_at"],
                updated_at=p["updated_at"],
            )
            for p in paged
        ],
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
    )


@router.get("/{project_id}", response_model=ProjectResponse)
async def get_project(project_id: UUID) -> ProjectResponse:
    """Get a specific project by ID, including its hypotheses."""
    db_ok = await _check_db_available()
    Project, ProjectStatus = _get_project_model()

    if db_ok and Project:
        async for db in get_db():
            result = await db.execute(select(Project).where(Project.id == project_id))
            project = result.scalar_one_or_none()
            if not project:
                raise HTTPException(status_code=404, detail="Project not found")

            # Fetch hypotheses linked to this project
            hypotheses_list = None
            try:
                from app.models.hypothesis import Hypothesis
                hyp_result = await db.execute(
                    select(Hypothesis).where(Hypothesis.project_id == project_id)
                )
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

    # In-memory fallback
    pid = str(project_id)
    if pid not in _memory_projects:
        raise HTTPException(status_code=404, detail="Project not found")
    p = _memory_projects[pid]
    return ProjectResponse(
        id=UUID(p["id"]), name=p["name"], description=p.get("description"),
        disease_focus=p.get("disease_focus"), research_question=p.get("research_question"),
        tags=p.get("tags", []), status=p["status"], hypothesis_count=p.get("hypothesis_count", 0),
        evidence_count=p.get("evidence_count", 0), simulation_count=p.get("simulation_count", 0),
        hypotheses=p.get("hypotheses"),
        created_at=p["created_at"], updated_at=p["updated_at"],
    )


@router.patch("/{project_id}", response_model=ProjectResponse)
async def update_project(project_id: UUID, project_update: ProjectUpdate) -> ProjectResponse:
    """Update a project."""
    db_ok = await _check_db_available()
    Project, ProjectStatus = _get_project_model()

    if db_ok and Project:
        async for db in get_db():
            result = await db.execute(select(Project).where(Project.id == project_id))
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
            await db.commit()
            await db.refresh(project)
            return project_to_response(project)

    # In-memory fallback
    pid = str(project_id)
    if pid not in _memory_projects:
        raise HTTPException(status_code=404, detail="Project not found")
    update_data = project_update.model_dump(exclude_unset=True)
    _memory_projects[pid].update(update_data)
    _memory_projects[pid]["updated_at"] = datetime.utcnow()
    p = _memory_projects[pid]
    return ProjectResponse(
        id=UUID(p["id"]), name=p["name"], description=p.get("description"),
        disease_focus=p.get("disease_focus"), research_question=p.get("research_question"),
        tags=p.get("tags", []), status=p["status"], hypothesis_count=p.get("hypothesis_count", 0),
        evidence_count=p.get("evidence_count", 0), simulation_count=p.get("simulation_count", 0),
        created_at=p["created_at"], updated_at=p["updated_at"],
    )


@router.delete("/{project_id}", status_code=204)
async def delete_project(project_id: UUID) -> None:
    """Delete a project."""
    db_ok = await _check_db_available()
    Project, _ = _get_project_model()

    if db_ok and Project:
        async for db in get_db():
            result = await db.execute(select(Project).where(Project.id == project_id))
            project = result.scalar_one_or_none()
            if not project:
                raise HTTPException(status_code=404, detail="Project not found")
            await db.delete(project)
            await db.commit()
            return

    pid = str(project_id)
    if pid not in _memory_projects:
        raise HTTPException(status_code=404, detail="Project not found")
    del _memory_projects[pid]


@router.get("/{project_id}/stats")
async def get_project_stats(project_id: UUID) -> dict:
    """Get statistics for a project."""
    db_ok = await _check_db_available()
    Project, ProjectStatus = _get_project_model()

    if db_ok and Project:
        async for db in get_db():
            result = await db.execute(select(Project).where(Project.id == project_id))
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

    pid = str(project_id)
    if pid not in _memory_projects:
        raise HTTPException(status_code=404, detail="Project not found")
    p = _memory_projects[pid]
    return {
        "project_id": p["id"],
        "hypothesis_count": p.get("hypothesis_count", 0),
        "evidence_count": p.get("evidence_count", 0),
        "simulation_count": p.get("simulation_count", 0),
        "status": p["status"],
        "created_at": p["created_at"].isoformat(),
        "updated_at": p["updated_at"].isoformat(),
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
async def update_lab_profile(project_id: UUID, profile: LabProfile):
    """Update the lab capability profile for a project. Used for feasibility filtering in the discovery pipeline."""
    Project, ProjectStatus = _get_project_model()
    if await _check_db_available() and Project:
        async for db in get_db():
            from sqlalchemy import update
            result = await db.execute(
                update(Project)
                .where(Project.id == project_id)
                .values(lab_profile=profile.model_dump())
                .returning(Project.id)
            )
            updated = result.scalar_one_or_none()
            if not updated:
                raise HTTPException(status_code=404, detail="Project not found")
            await db.commit()
            return {"status": "ok", "lab_profile": profile.model_dump()}

    pid = str(project_id)
    if pid not in _memory_projects:
        raise HTTPException(status_code=404, detail="Project not found")
    _memory_projects[pid]["lab_profile"] = profile.model_dump()
    return {"status": "ok", "lab_profile": profile.model_dump()}


@router.get("/{project_id}/lab-profile")
async def get_lab_profile(project_id: UUID):
    """Get the lab capability profile for a project."""
    Project, ProjectStatus = _get_project_model()
    if await _check_db_available() and Project:
        async for db in get_db():
            result = await db.execute(select(Project).where(Project.id == project_id))
            project = result.scalar_one_or_none()
            if not project:
                raise HTTPException(status_code=404, detail="Project not found")
            return {"lab_profile": getattr(project, "lab_profile", None) or {}}

    pid = str(project_id)
    if pid not in _memory_projects:
        raise HTTPException(status_code=404, detail="Project not found")
    return {"lab_profile": _memory_projects[pid].get("lab_profile", {})}


@router.patch("/{project_id}/discovery-config")
async def update_discovery_config(project_id: UUID, config: DiscoveryConfig):
    """Update the default discovery configuration for a project."""
    Project, ProjectStatus = _get_project_model()
    if await _check_db_available() and Project:
        async for db in get_db():
            from sqlalchemy import update
            result = await db.execute(
                update(Project)
                .where(Project.id == project_id)
                .values(discovery_config=config.model_dump())
                .returning(Project.id)
            )
            updated = result.scalar_one_or_none()
            if not updated:
                raise HTTPException(status_code=404, detail="Project not found")
            await db.commit()
            return {"status": "ok", "discovery_config": config.model_dump()}

    pid = str(project_id)
    if pid not in _memory_projects:
        raise HTTPException(status_code=404, detail="Project not found")
    _memory_projects[pid]["discovery_config"] = config.model_dump()
    return {"status": "ok", "discovery_config": config.model_dump()}
