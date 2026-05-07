"""
Evidence API Endpoints

Manage evidence items (papers, trials, data) in humanovo with SQLAlchemy persistence.
"""

from datetime import datetime
from enum import Enum
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, HttpUrl
from sqlalchemy import desc, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.logging import get_logger
from app.core.auth import AUTH_REQUIRED, get_current_active_user
from app.core.ownership import (
    assert_owns_project,
    fetch_owned_or_global_or_404,
    filter_by_owned_or_global_project,
)
from app.models.evidence import Evidence, EvidenceSource as EvidenceSourceModel
from app.models.user import User

logger = get_logger(__name__)
router = APIRouter(dependencies=AUTH_REQUIRED)


class EvidenceSource(str, Enum):
    """Source type of evidence."""

    PUBMED = "pubmed"
    CLINICAL_TRIAL = "clinical_trial"
    PREPRINT = "preprint"
    OMICS = "omics"
    DRUG_DATABASE = "drug_database"
    PATHWAY_DATABASE = "pathway_database"
    WEB_SEARCH = "web_search"
    USER_UPLOAD = "user_upload"
    PATENT = "patent"


class EvidenceCreate(BaseModel):
    """Schema for creating evidence manually."""

    project_id: UUID | None = None
    title: str = Field(..., min_length=5, max_length=500)
    source_type: EvidenceSource
    source_id: str | None = Field(None, description="External ID (e.g., PMID, NCT number)")
    source_url: HttpUrl | None = None
    abstract: str | None = None
    full_text: str | None = None
    authors: list[str] = Field(default_factory=list)
    publication_date: datetime | None = None
    entities: list[str] = Field(default_factory=list, description="Extracted entities")
    tags: list[str] = Field(default_factory=list)


class EvidenceSearchRequest(BaseModel):
    """Schema for searching evidence."""

    query: str = Field(..., min_length=2, max_length=500)
    source_types: list[EvidenceSource] = Field(default_factory=list)
    date_from: datetime | None = None
    date_to: datetime | None = None
    entities: list[str] = Field(default_factory=list)
    semantic_search: bool = Field(default=True, description="Use vector similarity search")
    limit: int = Field(default=20, ge=1, le=100)


class EvidenceResponse(BaseModel):
    """Schema for evidence response."""

    id: UUID
    project_id: UUID | None
    title: str
    source_type: EvidenceSource
    source_id: str | None
    source_url: str | None
    abstract: str | None
    snippet: str | None
    authors: list[str]
    publication_date: datetime | None
    entities: list[str]
    tags: list[str]
    relevance_score: float | None
    embedding_id: str | None
    # Review status — seeded rows are 'verified' so the UI badge shows
    # green instead of the pending fallback.
    status: str | None = None
    # Publication metadata the UI likes to surface in the row.
    journal: str | None = None
    doi: str | None = None
    citation_count: int | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class EvidenceListResponse(BaseModel):
    """Schema for paginated evidence list."""

    items: list[EvidenceResponse]
    total: int
    page: int
    page_size: int


class EvidenceSearchResponse(BaseModel):
    """Schema for evidence search results."""

    items: list[EvidenceResponse]
    total: int
    query: str
    search_type: str


def evidence_to_response(e: Evidence) -> EvidenceResponse:
    """Convert an Evidence model to an EvidenceResponse."""
    return EvidenceResponse(
        id=e.id,
        project_id=e.project_id,
        title=e.title,
        source_type=EvidenceSource(e.source_type.value),
        source_id=e.source_id,
        source_url=e.source_url,
        abstract=e.abstract,
        snippet=e.snippet or (e.abstract[:300] if e.abstract else None),
        authors=e.authors or [],
        publication_date=e.publication_date,
        entities=e.entities or [],
        tags=e.tags or [],
        relevance_score=e.relevance_score,
        embedding_id=e.embedding_id,
        status=getattr(e, "status", None),
        journal=getattr(e, "journal", None),
        doi=getattr(e, "doi", None),
        citation_count=getattr(e, "citation_count", None),
        created_at=e.created_at,
        updated_at=e.updated_at,
    )


@router.post("", response_model=EvidenceResponse, status_code=201)
async def create_evidence(
    evidence: EvidenceCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> EvidenceResponse:
    """Create a new evidence item, optionally attached to one of the
    caller's projects. Evidence with no project_id is global-corpus
    (will tighten once `created_by` lands on the model)."""
    if evidence.project_id is not None:
        await assert_owns_project(db, evidence.project_id, current_user)
    logger.info("Creating new evidence", title=evidence.title[:50])

    db_evidence = Evidence(
        id=uuid4(),
        project_id=evidence.project_id,
        title=evidence.title,
        source_type=EvidenceSourceModel(evidence.source_type.value),
        source_id=evidence.source_id,
        source_url=str(evidence.source_url) if evidence.source_url else None,
        abstract=evidence.abstract,
        full_text=evidence.full_text,
        snippet=evidence.abstract[:300] if evidence.abstract else None,
        authors=evidence.authors,
        publication_date=evidence.publication_date,
        entities=evidence.entities,
        tags=evidence.tags,
        ingested_by="user",
    )

    db.add(db_evidence)
    await db.commit()
    await db.refresh(db_evidence)

    logger.info("Evidence created", evidence_id=str(db_evidence.id))
    return evidence_to_response(db_evidence)


@router.post("/search", response_model=EvidenceSearchResponse)
async def search_evidence(
    request: EvidenceSearchRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> EvidenceSearchResponse:
    """Search the caller-visible evidence corpus (their project-attached
    rows + globally-scoped rows) via semantic or keyword search."""
    logger.info(
        "Searching evidence",
        query=request.query,
        semantic=request.semantic_search,
    )

    if request.semantic_search:
        # Use vector store for semantic search
        try:
            from app.knowledge.vector_store import search_vectors

            vector_results = await search_vectors(
                query=request.query,
                limit=request.limit,
                filters={
                    "source_types": [s.value for s in request.source_types]
                    if request.source_types
                    else None,
                    "entities": request.entities if request.entities else None,
                },
            )

            # Fetch evidence from database using IDs from vector search.
            # Tenant filter strips out IDs the caller can't see (other
            # users' project-attached rows leak into the global vector
            # store today; explicit join enforces the boundary).
            if vector_results:
                evidence_ids = [r.id for r in vector_results]
                query = filter_by_owned_or_global_project(
                    select(Evidence).where(Evidence.id.in_(evidence_ids)),
                    Evidence,
                    current_user,
                )
                result = await db.execute(query)
                evidence_items = result.scalars().all()
                items = [evidence_to_response(e) for e in evidence_items]
            else:
                items = []

            search_type = "semantic"
        except Exception as e:
            logger.warning(f"Semantic search failed, falling back to keyword: {e}")
            items, search_type = await _keyword_search(db, request, current_user)
    else:
        items, search_type = await _keyword_search(db, request, current_user)

    return EvidenceSearchResponse(
        items=items,
        total=len(items),
        query=request.query,
        search_type=search_type,
    )


async def _keyword_search(
    db: AsyncSession,
    request: EvidenceSearchRequest,
    current_user: User,
) -> tuple[list[EvidenceResponse], str]:
    """Keyword search restricted to the caller-visible corpus."""
    query_lower = f"%{request.query.lower()}%"

    query = filter_by_owned_or_global_project(
        select(Evidence).where(
            or_(
                Evidence.title.ilike(query_lower),
                Evidence.abstract.ilike(query_lower),
            )
        ),
        Evidence,
        current_user,
    )

    # Apply source type filter
    if request.source_types:
        source_values = [EvidenceSourceModel(s.value) for s in request.source_types]
        query = query.where(Evidence.source_type.in_(source_values))

    # Apply date filters
    if request.date_from:
        query = query.where(Evidence.publication_date >= request.date_from)
    if request.date_to:
        query = query.where(Evidence.publication_date <= request.date_to)

    query = query.limit(request.limit)

    result = await db.execute(query)
    evidence_items = result.scalars().all()

    return [evidence_to_response(e) for e in evidence_items], "keyword"


@router.get("", response_model=EvidenceListResponse)
async def list_evidence(
    project_id: UUID | None = None,
    source_type: EvidenceSource | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> EvidenceListResponse:
    """List evidence items: rows attached to one of the caller's
    projects, plus global-corpus rows (project_id IS NULL)."""
    query = filter_by_owned_or_global_project(
        select(Evidence), Evidence, current_user
    )
    count_query = filter_by_owned_or_global_project(
        select(func.count(Evidence.id)), Evidence, current_user
    )

    if project_id:
        query = query.where(Evidence.project_id == project_id)
        count_query = count_query.where(Evidence.project_id == project_id)
    if source_type:
        query = query.where(Evidence.source_type == EvidenceSourceModel(source_type.value))
        count_query = count_query.where(
            Evidence.source_type == EvidenceSourceModel(source_type.value)
        )

    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0

    query = query.order_by(desc(Evidence.updated_at))
    offset = (page - 1) * page_size
    query = query.offset(offset).limit(page_size)

    result = await db.execute(query)
    evidence_items = result.scalars().all()

    return EvidenceListResponse(
        items=[evidence_to_response(e) for e in evidence_items],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/{evidence_id}", response_model=EvidenceResponse)
async def get_evidence(
    evidence_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> EvidenceResponse:
    """Get an evidence item if it belongs to one of the caller's
    projects or is in the global corpus."""
    evidence = await fetch_owned_or_global_or_404(db, Evidence, evidence_id, current_user)
    return evidence_to_response(evidence)


class EvidenceUpdate(BaseModel):
    """Schema for updating evidence."""

    title: str | None = None
    abstract: str | None = None
    tags: list[str] | None = None
    entities: list[str] | None = None
    status: str | None = None
    source_url: str | None = None
    user_notes: str | None = None


@router.patch("/{evidence_id}", response_model=EvidenceResponse)
async def update_evidence(
    evidence_id: UUID,
    update: EvidenceUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> EvidenceResponse:
    """Update an evidence item the caller owns. Cannot mutate global
    evidence (rows with project_id NULL) — returns 404."""
    evidence = await fetch_owned_or_global_or_404(db, Evidence, evidence_id, current_user)
    if evidence.project_id is None:
        # Global rows are read-only until `created_by` ships.
        raise HTTPException(status_code=404, detail="Evidence not found")

    update_data = update.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        if field == "abstract" and value is not None:
            evidence.abstract = value
            evidence.snippet = value[:300] if value else None
        elif hasattr(evidence, field):
            setattr(evidence, field, value)

    await db.commit()
    await db.refresh(evidence)

    logger.info("Evidence updated", evidence_id=str(evidence_id))
    return evidence_to_response(evidence)


@router.delete("/{evidence_id}", status_code=204)
async def delete_evidence(
    evidence_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> None:
    """Delete an evidence item the caller owns. Global rows
    (project_id NULL) are immutable to non-admins — returns 404."""
    evidence = await fetch_owned_or_global_or_404(db, Evidence, evidence_id, current_user)
    if evidence.project_id is None:
        raise HTTPException(status_code=404, detail="Evidence not found")
    await db.delete(evidence)
    await db.commit()
    logger.info("Evidence deleted", evidence_id=str(evidence_id))


@router.get("/{evidence_id}/related", response_model=list[EvidenceResponse])
async def get_related_evidence(
    evidence_id: UUID,
    limit: int = Query(10, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> list[EvidenceResponse]:
    """Find evidence related to one of the caller-visible items.

    Uses vector similarity. Both the seed item and the related results
    are scoped to the caller's accessible corpus (their projects +
    global rows).
    """
    evidence = await fetch_owned_or_global_or_404(
        db, Evidence, evidence_id, current_user
    )

    if not evidence.embedding_id:
        if evidence.entities:
            related_query = filter_by_owned_or_global_project(
                select(Evidence)
                .where(Evidence.id != evidence_id)
                .where(Evidence.entities.overlap(evidence.entities))
                .limit(limit),
                Evidence,
                current_user,
            )
            related_result = await db.execute(related_query)
            related = related_result.scalars().all()
            return [evidence_to_response(e) for e in related]
        return []

    try:
        from app.knowledge.vector_store import find_similar

        similar_ids = await find_similar(
            embedding_id=evidence.embedding_id,
            limit=limit + 1,
        )

        similar_ids = [sid for sid in similar_ids if sid != evidence_id][:limit]

        if similar_ids:
            related_query = filter_by_owned_or_global_project(
                select(Evidence).where(Evidence.id.in_(similar_ids)),
                Evidence,
                current_user,
            )
            related_result = await db.execute(related_query)
            related = related_result.scalars().all()
            return [evidence_to_response(e) for e in related]
    except Exception as e:
        logger.warning(f"Vector similarity search failed: {e}")

    return []


@router.post("/bulk", response_model=list[EvidenceResponse], status_code=201)
async def bulk_create_evidence(
    items: list[EvidenceCreate],
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> list[EvidenceResponse]:
    """Bulk-create evidence items. project_id (when set) must reference
    one of the caller's projects."""
    # Validate project ownership for any non-global items up front so
    # we don't insert half a batch then fail.
    seen_projects: set[UUID] = set()
    for item in items:
        if item.project_id is not None and item.project_id not in seen_projects:
            await assert_owns_project(db, item.project_id, current_user)
            seen_projects.add(item.project_id)
    logger.info(f"Bulk creating {len(items)} evidence items")

    created = []
    for item in items:
        db_evidence = Evidence(
            id=uuid4(),
            project_id=item.project_id,
            title=item.title,
            source_type=EvidenceSourceModel(item.source_type.value),
            source_id=item.source_id,
            source_url=str(item.source_url) if item.source_url else None,
            abstract=item.abstract,
            full_text=item.full_text,
            snippet=item.abstract[:300] if item.abstract else None,
            authors=item.authors,
            publication_date=item.publication_date,
            entities=item.entities,
            tags=item.tags,
            ingested_by="bulk_upload",
        )
        db.add(db_evidence)
        created.append(db_evidence)

    await db.commit()

    # Refresh all items
    for e in created:
        await db.refresh(e)

    logger.info(f"Bulk created {len(created)} evidence items")
    return [evidence_to_response(e) for e in created]
