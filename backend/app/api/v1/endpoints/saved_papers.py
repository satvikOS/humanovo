"""
Saved research-paper endpoints.

Replaces the localStorage `research-papers` key on the frontend with
durable Postgres-backed storage. Every paper carries a UUID and is
strictly owner-scoped — listing endpoints filter on `current_user.id`
and detail/delete endpoints 404 when the paper belongs to someone
else (rather than 403, to avoid confirming the row's existence).

The companion model (`app.models.saved_research_paper.SavedResearchPaper`)
documents the schema choice rationale in detail; in short: this is the
generated artifact, not an editorial manuscript, so it gets its own
narrow table instead of overloading `manuscripts`.
"""
from __future__ import annotations

from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import AUTH_REQUIRED, get_current_active_user
from app.core.database import get_db
from app.core.logging import get_logger
from app.models.saved_research_paper import SavedResearchPaper
from app.models.user import User

logger = get_logger(__name__)

router = APIRouter(
    prefix="/saved-papers",
    tags=["saved-papers"],
    dependencies=AUTH_REQUIRED,
)


# ─── Pydantic schemas ───────────────────────────────────────────────


class SavedPaperCreate(BaseModel):
    """Body for POST /saved-papers."""

    hypothesis_id: UUID
    project_id: Optional[UUID] = None
    hypothesis_title: str = Field(..., min_length=1, max_length=1024)
    disease: Optional[str] = Field(None, max_length=255)
    filename: str = Field(..., min_length=1, max_length=255)
    paper_html: str = Field(..., min_length=1)


class SavedPaperSummary(BaseModel):
    """Listing-row shape — omits the (potentially large) paper_html
    body. Detail endpoint returns the full row when requested."""

    id: UUID
    hypothesis_id: UUID
    project_id: Optional[UUID]
    hypothesis_title: str
    disease: Optional[str]
    filename: str
    created_at: str
    updated_at: str

    class Config:
        from_attributes = True


class SavedPaperDetail(SavedPaperSummary):
    """Detail-row shape — includes the rendered HTML body."""

    paper_html: str


# ─── Helpers ────────────────────────────────────────────────────────


def _to_summary(row: SavedResearchPaper) -> SavedPaperSummary:
    return SavedPaperSummary(
        id=row.id,
        hypothesis_id=row.hypothesis_id,
        project_id=row.project_id,
        hypothesis_title=row.hypothesis_title,
        disease=row.disease,
        filename=row.filename,
        created_at=row.created_at.isoformat() if row.created_at else "",
        updated_at=row.updated_at.isoformat() if row.updated_at else "",
    )


def _to_detail(row: SavedResearchPaper) -> SavedPaperDetail:
    return SavedPaperDetail(
        id=row.id,
        hypothesis_id=row.hypothesis_id,
        project_id=row.project_id,
        hypothesis_title=row.hypothesis_title,
        disease=row.disease,
        filename=row.filename,
        paper_html=row.paper_html,
        created_at=row.created_at.isoformat() if row.created_at else "",
        updated_at=row.updated_at.isoformat() if row.updated_at else "",
    )


# ─── Routes ────────────────────────────────────────────────────────


@router.post("", response_model=SavedPaperDetail, status_code=201)
async def create_saved_paper(
    body: SavedPaperCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> SavedPaperDetail:
    """Persist a generated paper. Called by the frontend immediately
    after `document_pipeline` finishes rendering the HTML."""
    row = SavedResearchPaper(
        owner_id=current_user.id,
        hypothesis_id=body.hypothesis_id,
        project_id=body.project_id,
        hypothesis_title=body.hypothesis_title,
        disease=body.disease,
        filename=body.filename,
        paper_html=body.paper_html,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    logger.info(
        "saved_paper.created",
        paper_id=str(row.id),
        hypothesis_id=str(row.hypothesis_id),
        project_id=str(row.project_id) if row.project_id else None,
        owner_id=str(current_user.id),
        size_bytes=len(body.paper_html),
    )
    return _to_detail(row)


@router.get("", response_model=list[SavedPaperSummary])
async def list_saved_papers(
    project_id: Optional[UUID] = Query(None, description="Filter to a project."),
    hypothesis_id: Optional[UUID] = Query(None, description="Filter to a hypothesis."),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> list[SavedPaperSummary]:
    """List the current user's saved papers, newest-first.

    The body (`paper_html`) is intentionally omitted from list rows to
    keep the response small. Use GET /saved-papers/{id} to fetch the
    rendered HTML for viewing/downloading.
    """
    stmt = (
        select(SavedResearchPaper)
        .where(SavedResearchPaper.owner_id == current_user.id)
        .order_by(SavedResearchPaper.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    if project_id is not None:
        stmt = stmt.where(SavedResearchPaper.project_id == project_id)
    if hypothesis_id is not None:
        stmt = stmt.where(SavedResearchPaper.hypothesis_id == hypothesis_id)

    rows = (await db.execute(stmt)).scalars().all()
    return [_to_summary(row) for row in rows]


@router.get("/{paper_id}", response_model=SavedPaperDetail)
async def get_saved_paper(
    paper_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> SavedPaperDetail:
    """Fetch a single saved paper including the rendered HTML body.

    Returns 404 (not 403) when the paper belongs to a different user
    so we don't leak existence of a row across tenants.
    """
    row = (
        await db.execute(
            select(SavedResearchPaper).where(
                SavedResearchPaper.id == paper_id,
                SavedResearchPaper.owner_id == current_user.id,
            )
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Saved paper not found.")
    return _to_detail(row)


@router.delete("/{paper_id}", status_code=204)
async def delete_saved_paper(
    paper_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> None:
    """Hard-delete a saved paper. 404 on cross-tenant access."""
    row = (
        await db.execute(
            select(SavedResearchPaper).where(
                SavedResearchPaper.id == paper_id,
                SavedResearchPaper.owner_id == current_user.id,
            )
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Saved paper not found.")
    await db.delete(row)
    await db.commit()
    logger.info(
        "saved_paper.deleted",
        paper_id=str(paper_id),
        owner_id=str(current_user.id),
    )
