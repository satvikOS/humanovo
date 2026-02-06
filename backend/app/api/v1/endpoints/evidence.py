"""
Evidence API Endpoints

Manage evidence items (papers, trials, data) in GenUp with SQLAlchemy persistence.
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
from app.models.evidence import Evidence, EvidenceSource as EvidenceSourceModel

logger = get_logger(__name__)
router = APIRouter()


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
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


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
        created_at=e.created_at,
        updated_at=e.updated_at,
    )


@router.post("", response_model=EvidenceResponse, status_code=201)
async def create_evidence(
    evidence: EvidenceCreate,
    db: AsyncSession = Depends(get_db),
) -> EvidenceResponse:
    """Create a new evidence item manually."""
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
) -> EvidenceSearchResponse:
    """Search for evidence using semantic or keyword search."""
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

            # Fetch evidence from database using IDs from vector search
            if vector_results:
                evidence_ids = [r.id for r in vector_results]
                query = select(Evidence).where(Evidence.id.in_(evidence_ids))
                result = await db.execute(query)
                evidence_items = result.scalars().all()
                items = [evidence_to_response(e) for e in evidence_items]
            else:
                items = []

            search_type = "semantic"
        except Exception as e:
            logger.warning(f"Semantic search failed, falling back to keyword: {e}")
            # Fall back to keyword search
            items, search_type = await _keyword_search(db, request)
    else:
        items, search_type = await _keyword_search(db, request)

    return EvidenceSearchResponse(
        items=items,
        total=len(items),
        query=request.query,
        search_type=search_type,
    )


async def _keyword_search(
    db: AsyncSession, request: EvidenceSearchRequest
) -> tuple[list[EvidenceResponse], str]:
    """Perform keyword search in database."""
    query_lower = f"%{request.query.lower()}%"

    query = select(Evidence).where(
        or_(
            Evidence.title.ilike(query_lower),
            Evidence.abstract.ilike(query_lower),
        )
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
) -> EvidenceListResponse:
    """List evidence items with filtering and pagination."""
    # Build base query
    query = select(Evidence)

    # Apply filters
    if project_id:
        query = query.where(Evidence.project_id == project_id)
    if source_type:
        query = query.where(Evidence.source_type == EvidenceSourceModel(source_type.value))

    # Get total count
    count_query = select(func.count()).select_from(Evidence)
    if project_id:
        count_query = count_query.where(Evidence.project_id == project_id)
    if source_type:
        count_query = count_query.where(Evidence.source_type == EvidenceSourceModel(source_type.value))

    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0

    # Sort by date
    query = query.order_by(desc(Evidence.updated_at))

    # Paginate
    offset = (page - 1) * page_size
    query = query.offset(offset).limit(page_size)

    # Execute
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
) -> EvidenceResponse:
    """Get a specific evidence item by ID."""
    query = select(Evidence).where(Evidence.id == evidence_id)
    result = await db.execute(query)
    evidence = result.scalar_one_or_none()

    if not evidence:
        raise HTTPException(status_code=404, detail="Evidence not found")

    return evidence_to_response(evidence)


@router.patch("/{evidence_id}", response_model=EvidenceResponse)
async def update_evidence(
    evidence_id: UUID,
    title: str | None = None,
    abstract: str | None = None,
    tags: list[str] | None = None,
    entities: list[str] | None = None,
    db: AsyncSession = Depends(get_db),
) -> EvidenceResponse:
    """Update an evidence item."""
    query = select(Evidence).where(Evidence.id == evidence_id)
    result = await db.execute(query)
    evidence = result.scalar_one_or_none()

    if not evidence:
        raise HTTPException(status_code=404, detail="Evidence not found")

    if title is not None:
        evidence.title = title
    if abstract is not None:
        evidence.abstract = abstract
        evidence.snippet = abstract[:300] if abstract else None
    if tags is not None:
        evidence.tags = tags
    if entities is not None:
        evidence.entities = entities

    await db.commit()
    await db.refresh(evidence)

    logger.info("Evidence updated", evidence_id=str(evidence_id))
    return evidence_to_response(evidence)


@router.delete("/{evidence_id}", status_code=204)
async def delete_evidence(
    evidence_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> None:
    """Delete an evidence item."""
    query = select(Evidence).where(Evidence.id == evidence_id)
    result = await db.execute(query)
    evidence = result.scalar_one_or_none()

    if not evidence:
        raise HTTPException(status_code=404, detail="Evidence not found")

    await db.delete(evidence)
    await db.commit()
    logger.info("Evidence deleted", evidence_id=str(evidence_id))


@router.get("/{evidence_id}/related", response_model=list[EvidenceResponse])
async def get_related_evidence(
    evidence_id: UUID,
    limit: int = Query(10, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
) -> list[EvidenceResponse]:
    """Get evidence items related to a specific evidence item.

    Uses vector similarity to find semantically related evidence.
    """
    query = select(Evidence).where(Evidence.id == evidence_id)
    result = await db.execute(query)
    evidence = result.scalar_one_or_none()

    if not evidence:
        raise HTTPException(status_code=404, detail="Evidence not found")

    # If no embedding, return evidence with similar entities
    if not evidence.embedding_id:
        if evidence.entities:
            # Find evidence with overlapping entities
            related_query = (
                select(Evidence)
                .where(Evidence.id != evidence_id)
                .where(Evidence.entities.overlap(evidence.entities))
                .limit(limit)
            )
            related_result = await db.execute(related_query)
            related = related_result.scalars().all()
            return [evidence_to_response(e) for e in related]
        return []

    # Use vector store to find similar
    try:
        from app.knowledge.vector_store import find_similar

        similar_ids = await find_similar(
            embedding_id=evidence.embedding_id,
            limit=limit + 1,  # Include extra to filter out self
        )

        # Filter out self and fetch from database
        similar_ids = [sid for sid in similar_ids if sid != evidence_id][:limit]

        if similar_ids:
            related_query = select(Evidence).where(Evidence.id.in_(similar_ids))
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
) -> list[EvidenceResponse]:
    """Bulk create evidence items."""
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
