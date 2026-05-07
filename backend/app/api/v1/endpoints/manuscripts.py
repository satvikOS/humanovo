"""
Publication / Manuscript Manager API Endpoints

Manuscript CRUD, co-author management, journal formatting, submission tracking.
"""

import logging
from datetime import UTC, datetime
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints._bulk import attach_bulk_archive, attach_bulk_delete
from app.core.auth import AUTH_REQUIRED
from app.core.database import get_db
from app.models.platform_entities import Manuscript

logger = logging.getLogger(__name__)
router = APIRouter(dependencies=AUTH_REQUIRED)
JOURNAL_TEMPLATES = {
    "Nature Medicine": {"max_words": 5000, "abstract_max": 150, "format": "nature", "reference_style": "numbered"},
    "NEJM": {"max_words": 2500, "abstract_max": 250, "format": "nejm", "reference_style": "numbered"},
    "The Lancet": {"max_words": 4500, "abstract_max": 300, "format": "lancet", "reference_style": "numbered"},
    "JAMA": {"max_words": 3000, "abstract_max": 350, "format": "jama", "reference_style": "numbered"},
    "Science": {"max_words": 4500, "abstract_max": 125, "format": "science", "reference_style": "numbered"},
    "PLOS ONE": {"max_words": 0, "abstract_max": 300, "format": "plos", "reference_style": "vancouver"},
    "BMJ": {"max_words": 4000, "abstract_max": 250, "format": "bmj", "reference_style": "vancouver"},
    "Cell": {"max_words": 7000, "abstract_max": 150, "format": "cell", "reference_style": "numbered"},
}


class ManuscriptCreate(BaseModel):
    title: str
    journal_target: str = ""
    keywords: list[str] = []


class ManuscriptUpdate(BaseModel):
    title: str | None = None
    status: str | None = None
    journal_target: str | None = None
    sections: dict | None = None
    keywords: list[str] | None = None


class AuthorCreate(BaseModel):
    name: str
    affiliation: str = ""
    email: str = ""
    role: str = "Co-Author"


class SubmissionCreate(BaseModel):
    journal: str
    notes: str = ""


@router.get("", include_in_schema=False)
@router.get("/")
async def list_manuscripts(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Manuscript).order_by(Manuscript.updated_at.desc()))
    items = result.scalars().all()
    return {"items": [m.to_dict() for m in items], "total": len(items)}


@router.post("", include_in_schema=False)
@router.post("/")
async def create_manuscript(data: ManuscriptCreate, db: AsyncSession = Depends(get_db)):
    ms = Manuscript(
        title=data.title,
        status="draft",
        journal_target=data.journal_target,
        sections={"abstract": "", "introduction": "", "methods": "", "results": "", "discussion": "", "references": ""},
        authors=[],
        keywords=data.keywords,
        submission_history=[],
        word_count=0,
    )
    db.add(ms)
    await db.flush()
    return ms.to_dict()


@router.get("/templates/journals")
async def list_journal_templates():
    return {"journals": JOURNAL_TEMPLATES}


@router.get("/{manuscript_id}")
async def get_manuscript(manuscript_id: UUID, db: AsyncSession = Depends(get_db)):
    ms = await db.get(Manuscript, manuscript_id)
    if not ms:
        raise HTTPException(status_code=404, detail="Manuscript not found")
    return ms.to_dict()


@router.patch("/{manuscript_id}")
async def update_manuscript(manuscript_id: UUID, data: ManuscriptUpdate, db: AsyncSession = Depends(get_db)):
    ms = await db.get(Manuscript, manuscript_id)
    if not ms:
        raise HTTPException(status_code=404, detail="Manuscript not found")
    if data.title is not None:
        ms.title = data.title
    if data.status is not None:
        ms.status = data.status
    if data.journal_target is not None:
        ms.journal_target = data.journal_target
    if data.keywords is not None:
        ms.keywords = data.keywords
    if data.sections is not None:
        current_sections = dict(ms.sections or {})
        current_sections.update(data.sections)
        ms.sections = current_sections
        ms.word_count = sum(len(s.split()) for s in current_sections.values())
    await db.flush()
    return ms.to_dict()


@router.delete("/{manuscript_id}")
async def delete_manuscript(manuscript_id: UUID, db: AsyncSession = Depends(get_db)):
    ms = await db.get(Manuscript, manuscript_id)
    if not ms:
        raise HTTPException(status_code=404, detail="Manuscript not found")
    await db.delete(ms)
    await db.flush()
    return {"status": "deleted"}


@router.get("/{manuscript_id}/authors")
async def list_authors(manuscript_id: UUID, db: AsyncSession = Depends(get_db)):
    ms = await db.get(Manuscript, manuscript_id)
    if not ms:
        raise HTTPException(status_code=404, detail="Manuscript not found")
    return {"authors": ms.authors or []}


@router.post("/{manuscript_id}/authors")
async def add_author(manuscript_id: UUID, data: AuthorCreate, db: AsyncSession = Depends(get_db)):
    ms = await db.get(Manuscript, manuscript_id)
    if not ms:
        raise HTTPException(status_code=404, detail="Manuscript not found")
    current_authors = list(ms.authors or [])
    author = {
        "id": str(uuid4()),
        "name": data.name,
        "affiliation": data.affiliation,
        "email": data.email,
        "role": data.role,
        "order": len(current_authors) + 1,
    }
    current_authors.append(author)
    ms.authors = current_authors
    await db.flush()
    return author


@router.delete("/{manuscript_id}/authors/{author_id}")
async def remove_author(manuscript_id: UUID, author_id: UUID, db: AsyncSession = Depends(get_db)):
    ms = await db.get(Manuscript, manuscript_id)
    if not ms:
        raise HTTPException(status_code=404, detail="Manuscript not found")
    filtered = [a for a in (ms.authors or []) if a["id"] != author_id]
    for i, a in enumerate(filtered):
        a["order"] = i + 1
    ms.authors = filtered
    await db.flush()
    return {"status": "removed"}


@router.get("/{manuscript_id}/export")
async def export_manuscript(manuscript_id: UUID, format: str = Query("markdown"), db: AsyncSession = Depends(get_db)):
    ms = await db.get(Manuscript, manuscript_id)
    if not ms:
        raise HTTPException(status_code=404, detail="Manuscript not found")

    authors = ms.authors or []
    sections = ms.sections or {}
    keywords = ms.keywords or []
    authors_str = ", ".join(f"{a['name']} ({a['affiliation']})" for a in authors)

    if format == "markdown":
        content = f"# {ms.title}\n\n**Authors:** {authors_str}\n\n**Keywords:** {', '.join(keywords)}\n\n"
        for section_name in ["abstract", "introduction", "methods", "results", "discussion", "references"]:
            text = sections.get(section_name, "")
            if text:
                content += f"\n## {section_name.title()}\n\n{text}\n\n"
        return Response(content=content, media_type="text/markdown",
                       headers={"Content-Disposition": f"attachment; filename={ms.title[:50]}.md"})

    return {"content": sections, "title": ms.title, "authors": authors_str}


@router.post("/{manuscript_id}/submit")
async def submit_manuscript(manuscript_id: UUID, data: SubmissionCreate, db: AsyncSession = Depends(get_db)):
    ms = await db.get(Manuscript, manuscript_id)
    if not ms:
        raise HTTPException(status_code=404, detail="Manuscript not found")
    submission = {
        "id": str(uuid4()),
        "journal": data.journal,
        "notes": data.notes,
        "status": "submitted",
        "submitted_at": datetime.now(UTC).isoformat(),
    }
    current_history = list(ms.submission_history or [])
    current_history.append(submission)
    ms.submission_history = current_history
    ms.status = "submitted"
    await db.flush()
    return submission


# Bulk operations
attach_bulk_delete(router, Manuscript)
attach_bulk_archive(router, Manuscript)
