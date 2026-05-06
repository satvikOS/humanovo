"""
Citations API — full Mendeley-equivalent reference manager.

Endpoint families:

  /citations                      CRUD + search + bulk
  /citation-folders               CRUD + tree
  /citations/{id}/highlights      CRUD (PDF annotations)
  /citations/import               BibTeX / RIS / CSL-JSON / EndNote → library
  /citations/export               library → BibTeX / RIS / CSL-JSON

All endpoints are async on top of the shared AsyncSession. The
Citation schema stays stable for round-tripping: fields the parser
can't map land in `csl_json` so export restores them.
"""
from __future__ import annotations

import json
from datetime import datetime
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field
from sqlalchemy import and_, desc, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.logging import get_logger
from app.core.auth import AUTH_REQUIRED, get_current_active_user
from app.core.ownership import assert_owns_project
from app.models.citation import Citation, CitationFolder, CitationHighlight
from app.models.user import User
from app.citations_io import (
    parse_bibtex,
    parse_endnote,
    parse_csl_json,
    parse_ris,
    serialize_bibtex,
    serialize_csl_json,
    serialize_ris,
)

logger = get_logger(__name__)
router = APIRouter(tags=["citations"], dependencies=AUTH_REQUIRED)
# ─── Schemas ─────────────────────────────────────────────────────


class CitationBase(BaseModel):
    type: str = "journal"
    title: str
    authors: list[str] = Field(default_factory=list)
    year: int | None = None
    abstract: str | None = None
    journal: str | None = None
    volume: str | None = None
    issue: str | None = None
    pages: str | None = None
    publisher: str | None = None
    doi: str | None = None
    pmid: str | None = None
    pmcid: str | None = None
    arxiv_id: str | None = None
    isbn: str | None = None
    url: str | None = None
    tags: list[str] = Field(default_factory=list)
    folders: list[str] = Field(default_factory=list)
    starred: bool = False
    read: bool = False
    notes: str | None = None
    cite_key: str | None = None
    pdf_url: str | None = None
    pdf_file_id: str | None = None
    csl_json: dict[str, Any] = Field(default_factory=dict)
    project_id: UUID | None = None


class CitationCreate(CitationBase):
    pass


class CitationUpdate(BaseModel):
    # All optional — partial update.
    type: str | None = None
    title: str | None = None
    authors: list[str] | None = None
    year: int | None = None
    abstract: str | None = None
    journal: str | None = None
    volume: str | None = None
    issue: str | None = None
    pages: str | None = None
    publisher: str | None = None
    doi: str | None = None
    pmid: str | None = None
    pmcid: str | None = None
    arxiv_id: str | None = None
    isbn: str | None = None
    url: str | None = None
    tags: list[str] | None = None
    folders: list[str] | None = None
    starred: bool | None = None
    read: bool | None = None
    notes: str | None = None
    cite_key: str | None = None
    pdf_url: str | None = None
    pdf_file_id: str | None = None
    csl_json: dict[str, Any] | None = None
    project_id: UUID | None = None


class CitationOut(CitationBase):
    id: UUID
    created_at: str
    updated_at: str


class FolderBase(BaseModel):
    name: str
    parent_id: UUID | None = None
    color: str | None = None
    icon: str | None = None
    order_index: int = 0
    project_id: UUID | None = None


class FolderCreate(FolderBase):
    pass


class FolderUpdate(BaseModel):
    name: str | None = None
    parent_id: UUID | None = None
    color: str | None = None
    icon: str | None = None
    order_index: int | None = None


class FolderOut(FolderBase):
    id: UUID
    created_at: str
    updated_at: str


class HighlightBase(BaseModel):
    citation_id: UUID
    page: int
    rect: dict[str, float] = Field(default_factory=dict)
    text: str | None = None
    color: str = "#C4956A"
    note: str | None = None


class HighlightCreate(HighlightBase):
    pass


class HighlightUpdate(BaseModel):
    page: int | None = None
    rect: dict[str, float] | None = None
    text: str | None = None
    color: str | None = None
    note: str | None = None


class HighlightOut(HighlightBase):
    id: UUID
    created_at: str
    updated_at: str


class ImportBody(BaseModel):
    format: str  # "bibtex" | "ris" | "csl" | "endnote"
    text: str
    project_id: UUID | None = None


class ImportResponse(BaseModel):
    imported: int
    skipped_duplicates: int
    citations: list[CitationOut]


class ExportBody(BaseModel):
    format: str  # "bibtex" | "ris" | "csl"
    ids: list[UUID] | None = None   # None → export everything
    project_id: UUID | None = None


# ─── Serializers ─────────────────────────────────────────────────


def _to_out(c: Citation) -> CitationOut:
    return CitationOut(
        id=c.id,
        type=c.type,
        title=c.title,
        authors=list(c.authors or []),
        year=c.year,
        abstract=c.abstract,
        journal=c.journal,
        volume=c.volume,
        issue=c.issue,
        pages=c.pages,
        publisher=c.publisher,
        doi=c.doi,
        pmid=c.pmid,
        pmcid=c.pmcid,
        arxiv_id=c.arxiv_id,
        isbn=c.isbn,
        url=c.url,
        tags=list(c.tags or []),
        folders=list(c.folders or []),
        starred=c.starred,
        read=c.read,
        notes=c.notes,
        cite_key=c.cite_key,
        pdf_url=c.pdf_url,
        pdf_file_id=c.pdf_file_id,
        csl_json=c.csl_json or {},
        project_id=c.project_id,
        created_at=c.created_at.isoformat(),
        updated_at=c.updated_at.isoformat(),
    )


def _row_to_dict(c: Citation) -> dict[str, Any]:
    return _to_out(c).model_dump()


def _folder_to_out(f: CitationFolder) -> FolderOut:
    return FolderOut(
        id=f.id,
        name=f.name,
        parent_id=f.parent_id,
        color=f.color,
        icon=f.icon,
        order_index=f.order_index,
        project_id=f.project_id,
        created_at=f.created_at.isoformat(),
        updated_at=f.updated_at.isoformat(),
    )


def _highlight_to_out(h: CitationHighlight) -> HighlightOut:
    return HighlightOut(
        id=h.id,
        citation_id=h.citation_id,
        page=h.page,
        rect=h.rect or {},
        text=h.text,
        color=h.color,
        note=h.note,
        created_at=h.created_at.isoformat(),
        updated_at=h.updated_at.isoformat(),
    )


# ─── Citations CRUD ──────────────────────────────────────────────


async def _owned_citation_or_404(
    db: AsyncSession, citation_id: UUID, current_user: User,
) -> Citation:
    """Look up a citation and confirm `current_user` owns it."""
    result = await db.execute(
        select(Citation).where(
            Citation.id == citation_id,
            Citation.owner_id == current_user.id,
        )
    )
    c = result.scalar_one_or_none()
    if c is None:
        raise HTTPException(status_code=404, detail="Citation not found")
    return c


@router.get("/citations", response_model=list[CitationOut])
async def list_citations(
    q: str | None = Query(None, description="Search across title/authors/abstract/doi"),
    starred_only: bool = False,
    unread_only: bool = False,
    tag: str | None = None,
    folder: str | None = None,
    year: int | None = None,
    author: str | None = None,
    project_id: UUID | None = None,
    limit: int = Query(200, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> list[CitationOut]:
    stmt = (
        select(Citation)
        .where(Citation.owner_id == current_user.id)
        .order_by(desc(Citation.starred), desc(Citation.updated_at))
        .limit(limit)
        .offset(offset)
    )
    if project_id is not None:
        stmt = stmt.where(Citation.project_id == project_id)
    if starred_only:
        stmt = stmt.where(Citation.starred.is_(True))
    if unread_only:
        stmt = stmt.where(Citation.read.is_(False))
    if tag:
        stmt = stmt.where(Citation.tags.contains([tag]))
    if folder:
        # JSONB array contains test — folders stored as list[uuid-str].
        stmt = stmt.where(Citation.folders.contains([folder]))
    if year is not None:
        stmt = stmt.where(Citation.year == year)
    if author:
        stmt = stmt.where(Citation.authors.any(author))
    if q:
        like = f"%{q}%"
        stmt = stmt.where(or_(
            Citation.title.ilike(like),
            Citation.abstract.ilike(like),
            Citation.doi.ilike(like),
            Citation.authors.any(q),
            Citation.notes.ilike(like),
        ))
    result = await db.execute(stmt)
    return [_to_out(c) for c in result.scalars().all()]


@router.post("/citations", response_model=CitationOut, status_code=201)
async def create_citation(
    body: CitationCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> CitationOut:
    data = body.model_dump(exclude_unset=False)
    if data.get("project_id") is not None:
        await assert_owns_project(db, data["project_id"], current_user)
    # Dedupe per-user on DOI — avoids library bloat from repeated
    # imports. Two different users with the same DOI keep separate
    # rows.
    if data.get("doi"):
        existing = await db.execute(
            select(Citation).where(
                Citation.doi == data["doi"],
                Citation.owner_id == current_user.id,
            )
        )
        found = existing.scalar_one_or_none()
        if found is not None:
            return _to_out(found)
    c = Citation(owner_id=current_user.id, **data)
    db.add(c)
    await db.commit()
    await db.refresh(c)
    return _to_out(c)


@router.get("/citations/{citation_id}", response_model=CitationOut)
async def get_citation(
    citation_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> CitationOut:
    c = await _owned_citation_or_404(db, citation_id, current_user)
    return _to_out(c)


@router.patch("/citations/{citation_id}", response_model=CitationOut)
async def update_citation(
    citation_id: UUID,
    body: CitationUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> CitationOut:
    c = await _owned_citation_or_404(db, citation_id, current_user)
    data = body.model_dump(exclude_unset=True)
    if "project_id" in data and data["project_id"] is not None:
        await assert_owns_project(db, data["project_id"], current_user)
    for k, v in data.items():
        setattr(c, k, v)
    await db.commit()
    await db.refresh(c)
    return _to_out(c)


@router.delete("/citations/{citation_id}", status_code=204)
async def delete_citation(
    citation_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> None:
    c = await _owned_citation_or_404(db, citation_id, current_user)
    # Cascade highlights manually (no FK so we clean up here).
    await db.execute(
        CitationHighlight.__table__.delete().where(CitationHighlight.citation_id == citation_id)
    )
    await db.delete(c)
    await db.commit()


class BulkDeleteBody(BaseModel):
    ids: list[UUID]


@router.post("/citations/bulk-delete", status_code=200)
async def bulk_delete_citations(
    body: BulkDeleteBody,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> dict[str, int]:
    """Bulk-delete citations the caller owns. IDs the caller doesn't
    own are silently skipped — no leak about which IDs exist."""
    if not body.ids:
        return {"deleted_count": 0}
    # Limit the IN-list to rows the caller actually owns.
    owned_rows = await db.execute(
        select(Citation.id).where(
            Citation.id.in_(body.ids),
            Citation.owner_id == current_user.id,
        )
    )
    owned_ids = [row[0] for row in owned_rows.all()]
    if not owned_ids:
        return {"deleted_count": 0}
    await db.execute(
        CitationHighlight.__table__.delete().where(CitationHighlight.citation_id.in_(owned_ids))
    )
    res = await db.execute(Citation.__table__.delete().where(Citation.id.in_(owned_ids)))
    await db.commit()
    return {"deleted_count": res.rowcount or 0}


# ─── Folders ─────────────────────────────────────────────────────


async def _owned_folder_or_404(
    db: AsyncSession, folder_id: UUID, current_user: User,
) -> CitationFolder:
    result = await db.execute(
        select(CitationFolder).where(
            CitationFolder.id == folder_id,
            CitationFolder.owner_id == current_user.id,
        )
    )
    f = result.scalar_one_or_none()
    if f is None:
        raise HTTPException(status_code=404, detail="Folder not found")
    return f


@router.get("/citation-folders", response_model=list[FolderOut])
async def list_folders(
    project_id: UUID | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> list[FolderOut]:
    stmt = (
        select(CitationFolder)
        .where(CitationFolder.owner_id == current_user.id)
        .order_by(CitationFolder.order_index, CitationFolder.name)
    )
    if project_id is not None:
        stmt = stmt.where(CitationFolder.project_id == project_id)
    result = await db.execute(stmt)
    return [_folder_to_out(f) for f in result.scalars().all()]


@router.post("/citation-folders", response_model=FolderOut, status_code=201)
async def create_folder(
    body: FolderCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> FolderOut:
    data = body.model_dump()
    if data.get("project_id") is not None:
        await assert_owns_project(db, data["project_id"], current_user)
    if data.get("parent_id") is not None:
        # Verify the parent folder belongs to the caller too.
        await _owned_folder_or_404(db, data["parent_id"], current_user)
    f = CitationFolder(owner_id=current_user.id, **data)
    db.add(f)
    await db.commit()
    await db.refresh(f)
    return _folder_to_out(f)


@router.patch("/citation-folders/{folder_id}", response_model=FolderOut)
async def update_folder(
    folder_id: UUID,
    body: FolderUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> FolderOut:
    f = await _owned_folder_or_404(db, folder_id, current_user)
    data = body.model_dump(exclude_unset=True)
    if "parent_id" in data and data["parent_id"] is not None:
        await _owned_folder_or_404(db, data["parent_id"], current_user)
    for k, v in data.items():
        setattr(f, k, v)
    await db.commit()
    await db.refresh(f)
    return _folder_to_out(f)


@router.delete("/citation-folders/{folder_id}", status_code=204)
async def delete_folder(
    folder_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> None:
    f = await _owned_folder_or_404(db, folder_id, current_user)
    # Reparent any children (within the same owner's tree) to this
    # folder's parent — preserves tree rather than orphaning.
    await db.execute(
        CitationFolder.__table__.update()
        .where(
            CitationFolder.parent_id == folder_id,
            CitationFolder.owner_id == current_user.id,
        )
        .values(parent_id=f.parent_id)
    )
    # Remove the folder from every owned citation's folders array.
    rows = await db.execute(
        select(Citation).where(
            Citation.folders.contains([str(folder_id)]),
            Citation.owner_id == current_user.id,
        )
    )
    for c in rows.scalars().all():
        c.folders = [fid for fid in (c.folders or []) if fid != str(folder_id)]
    await db.delete(f)
    await db.commit()


# ─── Highlights ─────────────────────────────────────────────────


async def _owned_highlight_or_404(
    db: AsyncSession, highlight_id: UUID, current_user: User,
) -> CitationHighlight:
    """Look up a highlight whose parent Citation belongs to the caller."""
    result = await db.execute(
        select(CitationHighlight)
        .join(Citation, Citation.id == CitationHighlight.citation_id)
        .where(
            CitationHighlight.id == highlight_id,
            Citation.owner_id == current_user.id,
        )
    )
    h = result.scalar_one_or_none()
    if h is None:
        raise HTTPException(status_code=404, detail="Highlight not found")
    return h


@router.get("/citations/{citation_id}/highlights", response_model=list[HighlightOut])
async def list_highlights(
    citation_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> list[HighlightOut]:
    # Verify ownership of the parent citation first.
    await _owned_citation_or_404(db, citation_id, current_user)
    stmt = (
        select(CitationHighlight)
        .where(CitationHighlight.citation_id == citation_id)
        .order_by(CitationHighlight.page, CitationHighlight.created_at)
    )
    result = await db.execute(stmt)
    return [_highlight_to_out(h) for h in result.scalars().all()]


@router.post("/citations/{citation_id}/highlights", response_model=HighlightOut, status_code=201)
async def create_highlight(
    citation_id: UUID,
    body: HighlightCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> HighlightOut:
    if body.citation_id != citation_id:
        raise HTTPException(status_code=400, detail="citation_id in body and path must match")
    await _owned_citation_or_404(db, citation_id, current_user)
    h = CitationHighlight(**body.model_dump())
    db.add(h)
    await db.commit()
    await db.refresh(h)
    return _highlight_to_out(h)


@router.patch("/citation-highlights/{highlight_id}", response_model=HighlightOut)
async def update_highlight(
    highlight_id: UUID,
    body: HighlightUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> HighlightOut:
    h = await _owned_highlight_or_404(db, highlight_id, current_user)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(h, k, v)
    await db.commit()
    await db.refresh(h)
    return _highlight_to_out(h)


@router.delete("/citation-highlights/{highlight_id}", status_code=204)
async def delete_highlight(
    highlight_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> None:
    h = await _owned_highlight_or_404(db, highlight_id, current_user)
    await db.delete(h)
    await db.commit()


# ─── Import / Export ────────────────────────────────────────────


@router.post("/citations/import", response_model=ImportResponse)
async def import_citations(
    body: ImportBody,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> ImportResponse:
    """Import a batch of citations into the caller's library from
    BibTeX / RIS / CSL-JSON / EndNote text. Per-user DOI dedupe:
    entries whose DOI already exists in this caller's library are
    skipped, but other users' libraries don't collide."""
    if body.project_id is not None:
        await assert_owns_project(db, body.project_id, current_user)

    fmt = body.format.lower()
    try:
        if fmt == "bibtex":
            parsed = parse_bibtex(body.text)
        elif fmt == "ris":
            parsed = parse_ris(body.text)
        elif fmt == "csl":
            data = json.loads(body.text)
            if isinstance(data, dict): data = [data]
            parsed = parse_csl_json(data)
        elif fmt == "endnote":
            parsed = parse_endnote(body.text)
        else:
            raise HTTPException(status_code=400, detail=f"Unsupported format: {fmt}")
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001 — surface parser errors to client
        raise HTTPException(status_code=400, detail=f"Parse failed: {e}")

    if not parsed:
        return ImportResponse(imported=0, skipped_duplicates=0, citations=[])

    # Existing DOIs in THIS caller's library only — per-user dedupe.
    existing_dois = set()
    dois = [p.get("doi") for p in parsed if p.get("doi")]
    if dois:
        result = await db.execute(
            select(Citation.doi).where(
                Citation.doi.in_(dois),
                Citation.owner_id == current_user.id,
            )
        )
        existing_dois = {row[0] for row in result.all() if row[0]}

    imported: list[Citation] = []
    skipped = 0
    for p in parsed:
        if p.get("doi") and p["doi"] in existing_dois:
            skipped += 1
            continue
        p.setdefault("tags", [])
        p.setdefault("folders", [])
        p.setdefault("starred", False)
        p.setdefault("read", False)
        p.setdefault("csl_json", {})
        p.setdefault("type", "journal")
        p.setdefault("authors", [])
        if body.project_id:
            p["project_id"] = body.project_id
        # Drop unknown keys (parser may have emitted BibTeX-specific fields).
        allowed = {c.name for c in Citation.__table__.columns}
        clean = {k: v for k, v in p.items() if k in allowed}
        if not clean.get("title"):
            clean["title"] = "(untitled)"
        c = Citation(owner_id=current_user.id, **clean)
        db.add(c)
        imported.append(c)
    await db.commit()
    for c in imported:
        await db.refresh(c)
    return ImportResponse(
        imported=len(imported),
        skipped_duplicates=skipped,
        citations=[_to_out(c) for c in imported],
    )


@router.post("/citations/export")
async def export_citations(
    body: ExportBody,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Export the caller's citations (or a selection) as BibTeX / RIS
    / CSL-JSON. Cross-tenant IDs in body.ids are silently ignored."""
    stmt = select(Citation).where(Citation.owner_id == current_user.id)
    if body.project_id is not None:
        stmt = stmt.where(Citation.project_id == body.project_id)
    if body.ids:
        stmt = stmt.where(Citation.id.in_(body.ids))
    result = await db.execute(stmt)
    rows = result.scalars().all()
    payload = [_row_to_dict(c) for c in rows]
    fmt = body.format.lower()
    if fmt == "bibtex":
        return PlainTextResponse(content=serialize_bibtex(payload), media_type="text/x-bibtex")
    if fmt == "ris":
        return PlainTextResponse(content=serialize_ris(payload), media_type="application/x-research-info-systems")
    if fmt == "csl":
        return {"items": serialize_csl_json(payload), "count": len(payload)}
    raise HTTPException(status_code=400, detail=f"Unsupported export format: {fmt}")


@router.post("/citations/import-file", response_model=ImportResponse)
async def import_citations_file(
    file: UploadFile = File(...),
    format: str = Form(...),
    project_id: UUID | None = Form(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> ImportResponse:
    """Multipart variant of /citations/import — same parser, just accepts a file."""
    data = await file.read()
    try:
        text = data.decode("utf-8", errors="replace")
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"Could not decode file: {e}")
    return await import_citations(
        ImportBody(format=format, text=text, project_id=project_id), db, current_user,
    )
