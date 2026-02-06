"""
Projects API Endpoints

Manage research projects/sessions in GenUp.
Uses SQLAlchemy ORM for database persistence.
"""

from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.logging import get_logger
from app.models.project import Project, ProjectStatus

logger = get_logger(__name__)
router = APIRouter()


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
    description: str | None
    disease_focus: str | None
    research_question: str | None
    tags: list[str]
    status: str
    hypothesis_count: int
    evidence_count: int
    simulation_count: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class ProjectListResponse(BaseModel):
    """Schema for paginated project list."""

    items: list[ProjectResponse]
    total: int
    page: int
    page_size: int
    total_pages: int


def project_to_response(project: Project) -> ProjectResponse:
    """Convert Project model to response schema."""
    return ProjectResponse(
        id=project.id,
        name=project.name,
        description=project.description,
        disease_focus=project.disease_focus,
        research_question=project.research_question,
        tags=project.tags or [],
        status=project.status.value if isinstance(project.status, ProjectStatus) else project.status,
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
) -> ProjectResponse:
    """Create a new research project."""
    logger.info("Creating new project", name=project.name)

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

    logger.info("Project created", project_id=str(db_project.id))
    return project_to_response(db_project)


@router.get("", response_model=ProjectListResponse)
async def list_projects(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: str | None = None,
    status: str | None = None,
    db: AsyncSession = Depends(get_db),
) -> ProjectListResponse:
    """List all projects with pagination."""
    # Build query
    query = select(Project)

    # Filter by search term
    if search:
        search_filter = f"%{search}%"
        query = query.where(
            (Project.name.ilike(search_filter)) |
            (Project.description.ilike(search_filter)) |
            (Project.disease_focus.ilike(search_filter))
        )

    # Filter by status
    if status:
        try:
            status_enum = ProjectStatus(status)
            query = query.where(Project.status == status_enum)
        except ValueError:
            pass

    # Count total
    count_query = select(func.count()).select_from(query.subquery())
    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0

    # Sort and paginate
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
) -> ProjectResponse:
    """Get a specific project by ID."""
    result = await db.execute(select(Project).where(Project.id == project_id))
    project = result.scalar_one_or_none()

    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    return project_to_response(project)


@router.patch("/{project_id}", response_model=ProjectResponse)
async def update_project(
    project_id: UUID,
    project_update: ProjectUpdate,
    db: AsyncSession = Depends(get_db),
) -> ProjectResponse:
    """Update a project."""
    result = await db.execute(select(Project).where(Project.id == project_id))
    project = result.scalar_one_or_none()

    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    update_data = project_update.model_dump(exclude_unset=True)

    # Handle status enum
    if "status" in update_data and update_data["status"]:
        try:
            update_data["status"] = ProjectStatus(update_data["status"])
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid status: {update_data['status']}")

    # Update fields
    for key, value in update_data.items():
        setattr(project, key, value)

    await db.commit()
    await db.refresh(project)

    logger.info("Project updated", project_id=str(project_id))
    return project_to_response(project)


@router.delete("/{project_id}", status_code=204)
async def delete_project(
    project_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> None:
    """Delete a project."""
    result = await db.execute(select(Project).where(Project.id == project_id))
    project = result.scalar_one_or_none()

    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    await db.delete(project)
    await db.commit()

    logger.info("Project deleted", project_id=str(project_id))


@router.get("/{project_id}/stats")
async def get_project_stats(
    project_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Get statistics for a project."""
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
