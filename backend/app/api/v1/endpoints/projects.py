"""
Projects API Endpoints

Manage research projects/sessions in GenUp.
"""

from datetime import datetime
from typing import List, Optional
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.logging import get_logger

logger = get_logger(__name__)
router = APIRouter()


# Schemas
class ProjectCreate(BaseModel):
    """Schema for creating a new project."""

    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = Field(None, max_length=2000)
    disease_focus: Optional[str] = Field(None, description="Primary disease/condition focus")
    research_question: Optional[str] = Field(None, description="Main research question")
    tags: List[str] = Field(default_factory=list)


class ProjectUpdate(BaseModel):
    """Schema for updating a project."""

    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = Field(None, max_length=2000)
    disease_focus: Optional[str] = None
    research_question: Optional[str] = None
    tags: Optional[List[str]] = None


class ProjectResponse(BaseModel):
    """Schema for project response."""

    id: UUID
    name: str
    description: Optional[str]
    disease_focus: Optional[str]
    research_question: Optional[str]
    tags: List[str]
    hypothesis_count: int
    evidence_count: int
    created_at: datetime
    updated_at: datetime


class ProjectListResponse(BaseModel):
    """Schema for paginated project list."""

    items: List[ProjectResponse]
    total: int
    page: int
    page_size: int
    total_pages: int


# In-memory storage for development (replace with DB in production)
_projects: dict = {}


@router.post("", response_model=ProjectResponse, status_code=201)
async def create_project(
    project: ProjectCreate,
    db: AsyncSession = Depends(get_db),
) -> ProjectResponse:
    """Create a new research project."""
    logger.info("Creating new project", name=project.name)

    project_id = uuid4()
    now = datetime.utcnow()

    project_data = ProjectResponse(
        id=project_id,
        name=project.name,
        description=project.description,
        disease_focus=project.disease_focus,
        research_question=project.research_question,
        tags=project.tags,
        hypothesis_count=0,
        evidence_count=0,
        created_at=now,
        updated_at=now,
    )

    _projects[project_id] = project_data
    logger.info("Project created", project_id=str(project_id))

    return project_data


@router.get("", response_model=ProjectListResponse)
async def list_projects(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
) -> ProjectListResponse:
    """List all projects with pagination."""
    items = list(_projects.values())

    # Filter by search term
    if search:
        search_lower = search.lower()
        items = [
            p for p in items
            if search_lower in p.name.lower()
            or (p.description and search_lower in p.description.lower())
        ]

    # Sort by updated_at descending
    items.sort(key=lambda x: x.updated_at, reverse=True)

    total = len(items)
    total_pages = (total + page_size - 1) // page_size
    start = (page - 1) * page_size
    end = start + page_size

    return ProjectListResponse(
        items=items[start:end],
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
    if project_id not in _projects:
        raise HTTPException(status_code=404, detail="Project not found")

    return _projects[project_id]


@router.patch("/{project_id}", response_model=ProjectResponse)
async def update_project(
    project_id: UUID,
    project_update: ProjectUpdate,
    db: AsyncSession = Depends(get_db),
) -> ProjectResponse:
    """Update a project."""
    if project_id not in _projects:
        raise HTTPException(status_code=404, detail="Project not found")

    project = _projects[project_id]
    update_data = project_update.model_dump(exclude_unset=True)

    # Create updated project
    updated_project = ProjectResponse(
        id=project.id,
        name=update_data.get("name", project.name),
        description=update_data.get("description", project.description),
        disease_focus=update_data.get("disease_focus", project.disease_focus),
        research_question=update_data.get("research_question", project.research_question),
        tags=update_data.get("tags", project.tags),
        hypothesis_count=project.hypothesis_count,
        evidence_count=project.evidence_count,
        created_at=project.created_at,
        updated_at=datetime.utcnow(),
    )

    _projects[project_id] = updated_project
    logger.info("Project updated", project_id=str(project_id))

    return updated_project


@router.delete("/{project_id}", status_code=204)
async def delete_project(
    project_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> None:
    """Delete a project."""
    if project_id not in _projects:
        raise HTTPException(status_code=404, detail="Project not found")

    del _projects[project_id]
    logger.info("Project deleted", project_id=str(project_id))
