"""
Notebook API Endpoints

CRUD operations for researcher notebook pages with versioning.
All data persisted to PostgreSQL via NotebookPage model.

Tenant-scoped: every R/U/D query filters by `owner_id` so a signed-in
caller only sees their own pages. CREATE writes the caller's user.id
into owner_id. Cross-user access is invisible — non-owned pages
return 404, never 403, so callers can't probe for foreign IDs.
"""

import logging
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.auth import AUTH_REQUIRED, get_current_active_user
from app.models.user import User

logger = logging.getLogger(__name__)
router = APIRouter(dependencies=AUTH_REQUIRED)
# ── Schemas ──────────────────────────────────────────────────────

class NotebookPageCreate(BaseModel):
    title: str = "Untitled Page"
    content: str = ""
    content_type: str = "markdown"
    tags: list[str] = []


class NotebookPageUpdate(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    content_type: Optional[str] = None
    tags: Optional[list[str]] = None


def _get_model():
    from app.models.notebook import NotebookPage
    return NotebookPage


async def _owned_page_or_404(
    db: AsyncSession, page_id: str, current_user: User,
):
    """Look up a notebook page and confirm `current_user` owns it.
    Returns the row on success; 404s otherwise."""
    NotebookPage = _get_model()
    try:
        uid = UUID(page_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Page not found")
    result = await db.execute(
        select(NotebookPage).where(
            NotebookPage.id == uid,
            NotebookPage.owner_id == current_user.id,
        )
    )
    page = result.scalar_one_or_none()
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")
    return page


# ── Endpoints ────────────────────────────────────────────────────

@router.get("/pages")
async def list_pages(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """List the caller's notebook pages, newest first."""
    NotebookPage = _get_model()
    result = await db.execute(
        select(NotebookPage)
        .where(NotebookPage.owner_id == current_user.id)
        .order_by(NotebookPage.updated_at.desc())
    )
    all_pages = result.scalars().all()
    total = len(all_pages)
    start = (page - 1) * page_size
    items = all_pages[start:start + page_size]
    return {
        "items": [p.to_dict() for p in items],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.get("/pages/{page_id}")
async def get_page(
    page_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Get one of the caller's notebook pages."""
    page = await _owned_page_or_404(db, page_id, current_user)
    return page.to_dict()


@router.post("/pages")
async def create_page(
    data: NotebookPageCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Create a new notebook page owned by the caller."""
    NotebookPage = _get_model()
    page = NotebookPage(
        owner_id=current_user.id,
        title=data.title,
        content=data.content,
        content_type=data.content_type,
        tags=data.tags,
        version=1,
        versions=[],
    )
    db.add(page)
    await db.flush()
    return page.to_dict()


@router.patch("/pages/{page_id}")
async def update_page(
    page_id: str,
    data: NotebookPageUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Update one of the caller's notebook pages. Saves current version
    to history before mutating content."""
    page = await _owned_page_or_404(db, page_id, current_user)

    # Save current version to history before updating content.
    if data.content is not None and data.content != page.content:
        versions = list(page.versions or [])
        versions.append({
            "version": page.version,
            "content": page.content,
            "title": page.title,
            "created_at": page.updated_at.isoformat() if page.updated_at else datetime.now(timezone.utc).isoformat(),
        })
        if len(versions) > 50:
            versions = versions[-50:]
        page.versions = versions
        page.version = (page.version or 1) + 1

    if data.title is not None:
        page.title = data.title
    if data.content is not None:
        page.content = data.content
    if data.content_type is not None:
        page.content_type = data.content_type
    if data.tags is not None:
        page.tags = data.tags

    await db.flush()
    return page.to_dict()


@router.delete("/pages/{page_id}")
async def delete_page(
    page_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Delete one of the caller's notebook pages."""
    page = await _owned_page_or_404(db, page_id, current_user)
    await db.delete(page)
    await db.flush()
    return {"status": "deleted"}


@router.get("/pages/{page_id}/versions")
async def get_versions(
    page_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Get version history for one of the caller's pages."""
    page = await _owned_page_or_404(db, page_id, current_user)
    return page.versions or []


@router.post("/pages/{page_id}/versions/{version}/restore")
async def restore_version(
    page_id: str,
    version: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Restore a previous version of one of the caller's pages."""
    page = await _owned_page_or_404(db, page_id, current_user)

    versions = list(page.versions or [])
    target = None
    for v in versions:
        if v.get("version") == version:
            target = v
            break

    if not target:
        raise HTTPException(status_code=404, detail="Version not found")

    # Save current as new version entry.
    versions.append({
        "version": page.version,
        "content": page.content,
        "title": page.title,
        "created_at": page.updated_at.isoformat() if page.updated_at else datetime.now(timezone.utc).isoformat(),
    })
    page.versions = versions
    page.version = (page.version or 1) + 1
    page.content = target["content"]
    page.title = target["title"]

    await db.flush()
    return page.to_dict()


@router.get("/pages/{page_id}/export")
async def export_page(
    page_id: str,
    format: str = Query("markdown"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Export one of the caller's pages in the requested format."""
    page = await _owned_page_or_404(db, page_id, current_user)
    content = page.content or ""

    if format == "markdown":
        return Response(
            content=content,
            media_type="text/markdown",
            headers={"Content-Disposition": f"attachment; filename={page.title}.md"},
        )
    elif format == "html":
        html_content = f"<html><head><title>{page.title}</title></head><body><pre>{content}</pre></body></html>"
        return Response(
            content=html_content,
            media_type="text/html",
            headers={"Content-Disposition": f"attachment; filename={page.title}.html"},
        )

    return {"content": content, "format": format}
