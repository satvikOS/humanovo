"""
Project document endpoints.

Persistent storage for researcher-uploaded artifacts (PDFs, datasets,
IRB approvals, protocols, lab notes, manuscripts) attached to a
project. Replaces the localStorage `project-documents` key + IndexedDB
blob shards on the frontend with a single durable Postgres-backed row.

Routes:
  POST   /project-documents              — multipart upload (file + metadata)
  GET    /project-documents              — list (project_id / doc_type filters)
  GET    /project-documents/{id}         — metadata-only detail
  GET    /project-documents/{id}/content — stream the raw file bytes
  DELETE /project-documents/{id}         — hard-delete

All routes are AUTH_REQUIRED + owner-scoped. Cross-tenant access
returns 404 (not 403) to avoid leaking row existence.

The file body lives in a `content BYTEA` column for v1. When the
production stack stands up an S3 bucket, a follow-up migration will
introduce a `storage_url` column and a backfill worker; the schema
is shaped so the transition is additive.
"""
from __future__ import annotations

from datetime import date as date_type
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import AUTH_REQUIRED, get_current_active_user
from app.core.database import get_db
from app.core.logging import get_logger
from app.models.project_document import ProjectDocument
from app.models.user import User

logger = get_logger(__name__)

router = APIRouter(
    prefix="/project-documents",
    tags=["project-documents"],
    dependencies=AUTH_REQUIRED,
)

# Per-upload size cap. Postgres TOAST handles single rows up to 1 GB,
# but accepting arbitrary uploads exposes the API to denial-of-service
# pressure from a single malicious user. 50 MB covers the vast majority
# of legitimate biomedical artifacts (PDFs of papers, single-tab CSVs,
# protocol scans) without making the upload path a DDoS surface.
MAX_UPLOAD_BYTES = 50 * 1024 * 1024

# Knowledge-base values the backend accepts. Any other value is silently
# coerced to 'private' rather than raising 422 — frontend callers built
# pre-Round-4d may submit unknown values.
ALLOWED_KNOWLEDGE_BASES = {"private", "common"}


class ProjectDocumentSummary(BaseModel):
    """Listing-row shape — omits the file content (which can be huge)."""

    id: UUID
    project_id: UUID
    title: str
    doc_type: str
    authors: Optional[str]
    document_date: Optional[date_type]
    description: Optional[str]
    tags: list[str]
    filename: str
    file_size: int
    mime_type: str
    knowledge_base: str
    created_at: str
    updated_at: str

    class Config:
        from_attributes = True


def _to_summary(row: ProjectDocument) -> ProjectDocumentSummary:
    return ProjectDocumentSummary(
        id=row.id,
        project_id=row.project_id,
        title=row.title,
        doc_type=row.doc_type,
        authors=row.authors,
        document_date=row.document_date,
        description=row.description,
        tags=list(row.tags or []),
        filename=row.filename,
        file_size=row.file_size,
        mime_type=row.mime_type,
        knowledge_base=row.knowledge_base,
        created_at=row.created_at.isoformat() if row.created_at else "",
        updated_at=row.updated_at.isoformat() if row.updated_at else "",
    )


@router.post("", response_model=ProjectDocumentSummary, status_code=201)
async def upload_project_document(
    project_id: UUID = Form(...),
    title: str = Form(..., min_length=1, max_length=512),
    doc_type: str = Form("Other", max_length=64),
    authors: Optional[str] = Form(None, max_length=1024),
    document_date: Optional[date_type] = Form(None),
    description: Optional[str] = Form(None),
    tags: Optional[str] = Form(None, description="Comma-separated tag list."),
    knowledge_base: str = Form("private", max_length=16),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> ProjectDocumentSummary:
    """Upload a file with metadata. Stored as multipart/form-data so
    binary blobs round-trip cleanly without base64 inflation."""
    # Stream-read the upload, enforcing the size cap. UploadFile.read()
    # without an arg loads the whole file into memory; for arbitrary
    # uploads we'd chunk, but at MAX_UPLOAD_BYTES = 50 MB the in-memory
    # cost is acceptable for v1.
    raw = await file.read()
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail=(
                f"File exceeds the {MAX_UPLOAD_BYTES // (1024 * 1024)} MB "
                "per-upload cap."
            ),
        )

    parsed_tags: list[str] = []
    if tags:
        parsed_tags = [t.strip() for t in tags.split(",") if t.strip()]

    safe_kb = knowledge_base if knowledge_base in ALLOWED_KNOWLEDGE_BASES else "private"

    row = ProjectDocument(
        owner_id=current_user.id,
        project_id=project_id,
        title=title,
        doc_type=doc_type,
        authors=authors,
        document_date=document_date,
        description=description,
        tags=parsed_tags,
        filename=file.filename or "untitled",
        file_size=len(raw),
        mime_type=file.content_type or "application/octet-stream",
        content=raw,
        knowledge_base=safe_kb,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    logger.info(
        "project_document.uploaded",
        document_id=str(row.id),
        project_id=str(project_id),
        owner_id=str(current_user.id),
        size_bytes=len(raw),
        mime_type=row.mime_type,
        doc_type=row.doc_type,
    )
    return _to_summary(row)


@router.get("", response_model=list[ProjectDocumentSummary])
async def list_project_documents(
    project_id: Optional[UUID] = Query(None),
    doc_type: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> list[ProjectDocumentSummary]:
    """List project documents owned by the current user, newest-first.
    Body content is intentionally omitted; pull it via GET
    /project-documents/{id}/content when the user opens the viewer."""
    stmt = (
        select(ProjectDocument)
        .where(ProjectDocument.owner_id == current_user.id)
        .order_by(ProjectDocument.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    if project_id is not None:
        stmt = stmt.where(ProjectDocument.project_id == project_id)
    if doc_type is not None:
        stmt = stmt.where(ProjectDocument.doc_type == doc_type)
    rows = (await db.execute(stmt)).scalars().all()
    return [_to_summary(row) for row in rows]


@router.get("/{document_id}", response_model=ProjectDocumentSummary)
async def get_project_document(
    document_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> ProjectDocumentSummary:
    """Metadata-only fetch. Use /content for the raw bytes."""
    row = (
        await db.execute(
            select(ProjectDocument).where(
                ProjectDocument.id == document_id,
                ProjectDocument.owner_id == current_user.id,
            )
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Document not found.")
    return _to_summary(row)


@router.get("/{document_id}/content")
async def get_project_document_content(
    document_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> Response:
    """Stream the raw file bytes back to the client with the original
    Content-Type + a Content-Disposition that suggests the original
    filename for save-as flows."""
    row = (
        await db.execute(
            select(ProjectDocument).where(
                ProjectDocument.id == document_id,
                ProjectDocument.owner_id == current_user.id,
            )
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Document not found.")
    if row.content is None:
        # Defensive: a row without bytes shouldn't exist, but if some
        # backfill path inserted metadata-only we fail loud rather than
        # serving an empty file.
        raise HTTPException(
            status_code=410,
            detail="Document content has not been uploaded.",
        )
    return Response(
        content=bytes(row.content),
        media_type=row.mime_type,
        headers={
            "Content-Disposition": f'attachment; filename="{row.filename}"',
            "Content-Length": str(row.file_size),
        },
    )


@router.delete("/{document_id}", status_code=204)
async def delete_project_document(
    document_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> None:
    row = (
        await db.execute(
            select(ProjectDocument).where(
                ProjectDocument.id == document_id,
                ProjectDocument.owner_id == current_user.id,
            )
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Document not found.")
    await db.delete(row)
    await db.commit()
    logger.info(
        "project_document.deleted",
        document_id=str(document_id),
        owner_id=str(current_user.id),
    )
