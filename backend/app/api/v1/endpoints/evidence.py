"""
Evidence API Endpoints

Manage evidence items (papers, trials, data) in GenUp.
"""

from datetime import datetime
from enum import Enum
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, HttpUrl
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.logging import get_logger

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


class EvidenceCreate(BaseModel):
    """Schema for creating evidence manually."""

    project_id: UUID
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


# In-memory storage
_evidence: dict = {}


@router.post("", response_model=EvidenceResponse, status_code=201)
async def create_evidence(
    evidence: EvidenceCreate,
    db: AsyncSession = Depends(get_db),
) -> EvidenceResponse:
    """Create a new evidence item manually."""
    logger.info("Creating new evidence", title=evidence.title[:50])

    evidence_id = uuid4()
    now = datetime.utcnow()

    evidence_data = EvidenceResponse(
        id=evidence_id,
        project_id=evidence.project_id,
        title=evidence.title,
        source_type=evidence.source_type,
        source_id=evidence.source_id,
        source_url=str(evidence.source_url) if evidence.source_url else None,
        abstract=evidence.abstract,
        snippet=evidence.abstract[:300] if evidence.abstract else None,
        authors=evidence.authors,
        publication_date=evidence.publication_date,
        entities=evidence.entities,
        tags=evidence.tags,
        relevance_score=None,
        embedding_id=None,
        created_at=now,
        updated_at=now,
    )

    _evidence[evidence_id] = evidence_data
    logger.info("Evidence created", evidence_id=str(evidence_id))

    return evidence_data


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
        from app.knowledge.vector_store import search_vectors

        results = await search_vectors(
            query=request.query,
            limit=request.limit,
            filters={
                "source_types": [s.value for s in request.source_types]
                if request.source_types
                else None,
                "entities": request.entities if request.entities else None,
            },
        )
        search_type = "semantic"
    else:
        # Keyword search in stored evidence
        query_lower = request.query.lower()
        results = [
            e
            for e in _evidence.values()
            if query_lower in e.title.lower() or (e.abstract and query_lower in e.abstract.lower())
        ]
        results = results[: request.limit]
        search_type = "keyword"

    return EvidenceSearchResponse(
        items=results,
        total=len(results),
        query=request.query,
        search_type=search_type,
    )


@router.get("", response_model=EvidenceListResponse)
async def list_evidence(
    project_id: UUID | None = None,
    source_type: EvidenceSource | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
) -> EvidenceListResponse:
    """List evidence items with filtering and pagination."""
    items = list(_evidence.values())

    # Filter by project
    if project_id:
        items = [e for e in items if e.project_id == project_id]

    # Filter by source type
    if source_type:
        items = [e for e in items if e.source_type == source_type]

    # Sort by date
    items.sort(key=lambda x: x.updated_at, reverse=True)

    # Paginate
    total = len(items)
    start = (page - 1) * page_size
    end = start + page_size

    return EvidenceListResponse(
        items=items[start:end],
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
    if evidence_id not in _evidence:
        raise HTTPException(status_code=404, detail="Evidence not found")

    return _evidence[evidence_id]


@router.delete("/{evidence_id}", status_code=204)
async def delete_evidence(
    evidence_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> None:
    """Delete an evidence item."""
    if evidence_id not in _evidence:
        raise HTTPException(status_code=404, detail="Evidence not found")

    del _evidence[evidence_id]
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
    if evidence_id not in _evidence:
        raise HTTPException(status_code=404, detail="Evidence not found")

    evidence = _evidence[evidence_id]

    # Use vector store to find similar
    from app.knowledge.vector_store import find_similar

    related = await find_similar(
        embedding_id=evidence.embedding_id,
        limit=limit + 1,  # Include extra to filter out self
    )

    # Filter out the source evidence
    related = [r for r in related if r.id != evidence_id][:limit]

    return related
