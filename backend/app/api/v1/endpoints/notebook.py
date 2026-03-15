"""
Notebook API Endpoints

CRUD operations for researcher notebook pages with versioning.
"""

import logging
from datetime import datetime
from typing import Optional
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

logger = logging.getLogger(__name__)
router = APIRouter()

# ── In-memory storage (with DB fallback) ─────────────────────────

_notebook_pages: dict[str, dict] = {}
_defaults_dismissed: bool = False  # Track if user has dismissed defaults


def _ensure_defaults():
    """Create a default page if none exist and user hasn't dismissed them."""
    if not _notebook_pages and not _defaults_dismissed:
        page_id = str(uuid4())
        _notebook_pages[page_id] = {
            "id": page_id,
            "title": "Getting Started",
            "content": "# Welcome to HumaNovo Notebook\n\nThis is your research notebook. Use **Markdown** to write notes, embed evidence, and track your research.\n\n## Features\n- Rich Markdown editing with live preview\n- LaTeX math: $E = mc^2$\n- Link evidence and hypotheses\n- Version history\n- Export to PDF/Markdown\n\nStart writing below...",
            "content_type": "markdown",
            "tags": ["getting-started"],
            "version": 1,
            "versions": [],
            "created_at": datetime.utcnow().isoformat(),
            "updated_at": datetime.utcnow().isoformat(),
        }


_ensure_defaults()


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


# ── Endpoints ────────────────────────────────────────────────────

@router.get("/pages")
async def list_pages(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
):
    """List all notebook pages."""
    pages = sorted(_notebook_pages.values(), key=lambda p: p["updated_at"], reverse=True)
    total = len(pages)
    start = (page - 1) * page_size
    items = pages[start:start + page_size]
    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.get("/pages/{page_id}")
async def get_page(page_id: str):
    """Get a single notebook page."""
    if page_id not in _notebook_pages:
        raise HTTPException(status_code=404, detail="Page not found")
    return _notebook_pages[page_id]


@router.post("/pages")
async def create_page(data: NotebookPageCreate):
    """Create a new notebook page."""
    page_id = str(uuid4())
    now = datetime.utcnow().isoformat()
    page = {
        "id": page_id,
        "title": data.title,
        "content": data.content,
        "content_type": data.content_type,
        "tags": data.tags,
        "version": 1,
        "versions": [],
        "created_at": now,
        "updated_at": now,
    }
    _notebook_pages[page_id] = page
    return page


@router.patch("/pages/{page_id}")
async def update_page(page_id: str, data: NotebookPageUpdate):
    """Update a notebook page. Saves current version to history."""
    if page_id not in _notebook_pages:
        raise HTTPException(status_code=404, detail="Page not found")

    page = _notebook_pages[page_id]

    # Save current version to history before updating
    if data.content is not None and data.content != page.get("content"):
        version_entry = {
            "version": page["version"],
            "content": page["content"],
            "title": page["title"],
            "created_at": page["updated_at"],
        }
        if "versions" not in page:
            page["versions"] = []
        page["versions"].append(version_entry)
        # Keep last 50 versions
        if len(page["versions"]) > 50:
            page["versions"] = page["versions"][-50:]
        page["version"] = page["version"] + 1

    if data.title is not None:
        page["title"] = data.title
    if data.content is not None:
        page["content"] = data.content
    if data.content_type is not None:
        page["content_type"] = data.content_type
    if data.tags is not None:
        page["tags"] = data.tags

    page["updated_at"] = datetime.utcnow().isoformat()
    _notebook_pages[page_id] = page
    return page


@router.delete("/pages/{page_id}")
async def delete_page(page_id: str):
    """Delete a notebook page."""
    global _defaults_dismissed
    if page_id not in _notebook_pages:
        raise HTTPException(status_code=404, detail="Page not found")
    del _notebook_pages[page_id]
    # Mark defaults as dismissed so they don't reappear
    _defaults_dismissed = True
    return {"status": "deleted"}


@router.get("/pages/{page_id}/versions")
async def get_versions(page_id: str):
    """Get version history for a page."""
    if page_id not in _notebook_pages:
        raise HTTPException(status_code=404, detail="Page not found")
    page = _notebook_pages[page_id]
    return page.get("versions", [])


@router.post("/pages/{page_id}/versions/{version}/restore")
async def restore_version(page_id: str, version: int):
    """Restore a previous version."""
    if page_id not in _notebook_pages:
        raise HTTPException(status_code=404, detail="Page not found")

    page = _notebook_pages[page_id]
    versions = page.get("versions", [])
    target = None
    for v in versions:
        if v["version"] == version:
            target = v
            break

    if not target:
        raise HTTPException(status_code=404, detail="Version not found")

    # Save current as new version entry
    version_entry = {
        "version": page["version"],
        "content": page["content"],
        "title": page["title"],
        "created_at": page["updated_at"],
    }
    page["versions"].append(version_entry)
    page["version"] = page["version"] + 1
    page["content"] = target["content"]
    page["title"] = target["title"]
    page["updated_at"] = datetime.utcnow().isoformat()

    _notebook_pages[page_id] = page
    return page


@router.get("/pages/{page_id}/export")
async def export_page(page_id: str, format: str = Query("markdown")):
    """Export a page. Returns content in requested format."""
    if page_id not in _notebook_pages:
        raise HTTPException(status_code=404, detail="Page not found")

    page = _notebook_pages[page_id]
    content = page["content"]

    if format == "markdown":
        from fastapi.responses import Response
        return Response(
            content=content,
            media_type="text/markdown",
            headers={"Content-Disposition": f"attachment; filename={page['title']}.md"},
        )
    elif format == "html":
        # Basic markdown to HTML
        html_content = f"<html><head><title>{page['title']}</title></head><body><pre>{content}</pre></body></html>"
        from fastapi.responses import Response
        return Response(
            content=html_content,
            media_type="text/html",
            headers={"Content-Disposition": f"attachment; filename={page['title']}.html"},
        )

    return {"content": content, "format": format}
