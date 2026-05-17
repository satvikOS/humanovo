"""
RAG Query API Endpoints

RESTful API for RAG (Retrieval-Augmented Generation) queries,
hybrid search, and context retrieval.
"""

from datetime import UTC, datetime
from enum import StrEnum
from typing import Any
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import AUTH_REQUIRED
from app.core.database import get_db
from app.core.logging import get_logger

logger = get_logger(__name__)
router = APIRouter(dependencies=AUTH_REQUIRED)


class RetrievalMode(StrEnum):
    """Retrieval mode for RAG queries."""

    VECTOR = "vector"  # Semantic similarity only
    KEYWORD = "keyword"  # Keyword/BM25 only
    GRAPH = "graph"  # Knowledge graph traversal only
    HYBRID = "hybrid"  # Combination of vector + keyword
    HYBRID_GRAPH = "hybrid_graph"  # All three combined


class RerankerType(StrEnum):
    """Type of reranker to use."""

    NONE = "none"
    CROSS_ENCODER = "cross_encoder"
    COHERE = "cohere"
    LLM = "llm"


class SourceFilter(BaseModel):
    """Filters for source documents."""

    source_types: list[str] | None = Field(
        default=None,
        description="Filter by source type (pubmed, clinical_trials, etc.)",
    )
    date_from: datetime | None = None
    date_to: datetime | None = None
    authors: list[str] | None = None
    keywords: list[str] | None = None
    min_confidence: float | None = Field(default=None, ge=0, le=1)


class RAGQueryRequest(BaseModel):
    """Request for a RAG query."""

    query: str = Field(..., min_length=3, max_length=2000)
    mode: RetrievalMode = Field(default=RetrievalMode.HYBRID)
    top_k: int = Field(default=10, ge=1, le=100)
    reranker: RerankerType = Field(default=RerankerType.CROSS_ENCODER)
    filters: SourceFilter | None = None
    include_entities: bool = Field(default=True)
    include_relations: bool = Field(default=False)
    include_context: bool = Field(default=True)
    context_window: int = Field(default=3, ge=1, le=10)
    deduplicate: bool = Field(default=True)


class RetrievedChunk(BaseModel):
    """A retrieved document chunk."""

    chunk_id: str
    record_id: str
    content: str
    relevance_score: float
    source_type: str
    title: str | None
    url: str | None
    date: datetime | None
    chunk_index: int
    total_chunks: int
    metadata: dict[str, Any] = Field(default_factory=dict)


class RetrievedEntity(BaseModel):
    """An entity found in retrieved content."""

    entity_id: str
    text: str
    entity_type: str
    confidence: float
    occurrences: int
    source_records: list[str]


class RetrievedRelation(BaseModel):
    """A relation found in retrieved content."""

    source_entity: str
    target_entity: str
    relation_type: str
    confidence: float
    evidence_count: int


class RAGQueryResponse(BaseModel):
    """Response for a RAG query."""

    query_id: UUID
    query: str
    mode: RetrievalMode
    chunks: list[RetrievedChunk]
    entities: list[RetrievedEntity] | None = None
    relations: list[RetrievedRelation] | None = None
    total_results: int
    processing_time_ms: float
    reranker_used: str | None


class ContextRequest(BaseModel):
    """Request for LLM context preparation."""

    query: str = Field(..., min_length=3, max_length=2000)
    max_tokens: int = Field(default=4000, ge=500, le=16000)
    mode: RetrievalMode = Field(default=RetrievalMode.HYBRID)
    include_citations: bool = True
    format: str = Field(default="markdown", pattern="^(markdown|plain|structured)$")


class ContextResponse(BaseModel):
    """Response with prepared LLM context."""

    context: str
    sources: list[dict[str, Any]]
    token_count: int
    truncated: bool
    query: str


class SimilarDocumentsRequest(BaseModel):
    """Request for finding similar documents."""

    document_id: str = Field(..., description="ID of the source document")
    top_k: int = Field(default=5, ge=1, le=50)
    source_types: list[str] | None = None
    exclude_same_source: bool = True


class SimilarDocumentsResponse(BaseModel):
    """Response with similar documents."""

    source_document_id: str
    similar_documents: list[dict[str, Any]]


class GraphContextRequest(BaseModel):
    """Request for graph-based context."""

    entity_ids: list[str] = Field(..., min_length=1, max_length=10)
    depth: int = Field(default=2, ge=1, le=5)
    include_properties: bool = True
    relation_types: list[str] | None = None


class GraphContextResponse(BaseModel):
    """Response with graph context."""

    entities: list[dict[str, Any]]
    relations: list[dict[str, Any]]
    paths: list[list[str]]
    total_entities: int
    total_relations: int


@router.post("/query", response_model=RAGQueryResponse)
async def rag_query(
    request: RAGQueryRequest,
    db: AsyncSession = Depends(get_db),
) -> RAGQueryResponse:
    """
    Execute a RAG query with hybrid retrieval and reranking.

    Returns relevant document chunks with optional entity/relation extraction.
    """
    logger.info(
        "RAG query received",
        query=request.query[:50],
        mode=request.mode.value,
        top_k=request.top_k,
    )

    start_time = datetime.now(UTC)
    query_id = uuid4()

    try:
        from app.rag.retriever import RetrievalConfig
        from app.rag.service import RAGService

        # Build retrieval config
        config = RetrievalConfig(
            strategy=request.mode.value,
            top_k=request.top_k,
            reranker=request.reranker.value if request.reranker != RerankerType.NONE else None,
            deduplicate=request.deduplicate,
        )

        # Add filters
        if request.filters:
            config.source_types = request.filters.source_types
            config.date_from = request.filters.date_from
            config.date_to = request.filters.date_to
            config.min_confidence = request.filters.min_confidence

        # Execute query
        rag_service = RAGService()
        results = await rag_service.retrieve(
            query=request.query,
            config=config,
        )

        # Format chunks
        chunks = [
            RetrievedChunk(
                chunk_id=r.chunk_id,
                record_id=r.record_id,
                content=r.content,
                relevance_score=r.score,
                source_type=r.metadata.get("source_type", "unknown"),
                title=r.metadata.get("title"),
                url=r.metadata.get("url"),
                date=datetime.fromisoformat(r.metadata["date"]) if r.metadata.get("date") else None,
                chunk_index=r.metadata.get("chunk_index", 0),
                total_chunks=r.metadata.get("total_chunks", 1),
                metadata=r.metadata,
            )
            for r in results.chunks
        ]

        # Extract entities if requested
        entities = None
        if request.include_entities and results.entities:
            entities = [
                RetrievedEntity(
                    entity_id=e.entity_id,
                    text=e.text,
                    entity_type=e.entity_type,
                    confidence=e.confidence,
                    occurrences=e.occurrences,
                    source_records=e.source_records,
                )
                for e in results.entities
            ]

        # Extract relations if requested
        relations = None
        if request.include_relations and results.relations:
            relations = [
                RetrievedRelation(
                    source_entity=r.source_entity,
                    target_entity=r.target_entity,
                    relation_type=r.relation_type,
                    confidence=r.confidence,
                    evidence_count=r.evidence_count,
                )
                for r in results.relations
            ]

        processing_time = (datetime.now(UTC) - start_time).total_seconds() * 1000

        logger.info(
            "RAG query completed",
            query_id=str(query_id),
            results_count=len(chunks),
            processing_time_ms=round(processing_time, 2),
        )

        return RAGQueryResponse(
            query_id=query_id,
            query=request.query,
            mode=request.mode,
            chunks=chunks,
            entities=entities,
            relations=relations,
            total_results=len(chunks),
            processing_time_ms=processing_time,
            reranker_used=request.reranker.value if request.reranker != RerankerType.NONE else None,
        )

    except Exception as e:
        logger.error("RAG query failed", error=str(e))
        raise HTTPException(status_code=500, detail=f"Query failed: {str(e)}")


@router.post("/context", response_model=ContextResponse)
async def get_llm_context(
    request: ContextRequest,
    db: AsyncSession = Depends(get_db),
) -> ContextResponse:
    """
    Prepare context for LLM queries with citations.

    Returns formatted context suitable for passing to an LLM.
    """
    logger.info("Context request received", query=request.query[:50])

    try:
        from app.rag.service import RAGService

        rag_service = RAGService()
        context_result = await rag_service.prepare_context(
            query=request.query,
            max_tokens=request.max_tokens,
            mode=request.mode.value,
            include_citations=request.include_citations,
            format=request.format,
        )

        return ContextResponse(
            context=context_result.context,
            sources=context_result.sources,
            token_count=context_result.token_count,
            truncated=context_result.truncated,
            query=request.query,
        )

    except Exception as e:
        logger.error("Context preparation failed", error=str(e))
        raise HTTPException(status_code=500, detail=f"Context preparation failed: {str(e)}")


@router.post("/similar", response_model=SimilarDocumentsResponse)
async def find_similar_documents(
    request: SimilarDocumentsRequest,
    db: AsyncSession = Depends(get_db),
) -> SimilarDocumentsResponse:
    """
    Find documents similar to a given document.

    Uses vector similarity to find related content.
    """
    logger.info("Similar documents request", document_id=request.document_id)

    try:
        from app.rag.service import RAGService

        rag_service = RAGService()
        similar = await rag_service.find_similar(
            document_id=request.document_id,
            top_k=request.top_k,
            source_types=request.source_types,
            exclude_same_source=request.exclude_same_source,
        )

        return SimilarDocumentsResponse(
            source_document_id=request.document_id,
            similar_documents=[
                {
                    "document_id": doc.record_id,
                    "title": doc.title,
                    "similarity_score": doc.score,
                    "source_type": doc.source_type,
                    "url": doc.url,
                }
                for doc in similar
            ],
        )

    except Exception as e:
        logger.error("Similar documents search failed", error=str(e))
        raise HTTPException(status_code=500, detail=f"Search failed: {str(e)}")


@router.post("/graph-context", response_model=GraphContextResponse)
async def get_graph_context(
    request: GraphContextRequest,
    db: AsyncSession = Depends(get_db),
) -> GraphContextResponse:
    """
    Get knowledge graph context around entities.

    Returns entities, relations, and paths from the knowledge graph.
    """
    logger.info("Graph context request", entities=request.entity_ids)

    try:
        from app.knowledge.graph_store import GraphStore

        graph_store = GraphStore()

        # Get neighborhood for each entity
        all_entities = []
        all_relations = []
        paths = []

        for entity_id in request.entity_ids:
            neighborhood = await graph_store.get_neighborhood(
                entity_id=entity_id,
                depth=request.depth,
                relation_types=request.relation_types,
                include_properties=request.include_properties,
            )

            all_entities.extend(neighborhood.entities)
            all_relations.extend(neighborhood.relations)

            if neighborhood.paths:
                paths.extend(neighborhood.paths)

        # Deduplicate
        seen_entities = set()
        unique_entities = []
        for e in all_entities:
            if e["id"] not in seen_entities:
                seen_entities.add(e["id"])
                unique_entities.append(e)

        seen_relations = set()
        unique_relations = []
        for r in all_relations:
            rel_key = (r["source"], r["target"], r["type"])
            if rel_key not in seen_relations:
                seen_relations.add(rel_key)
                unique_relations.append(r)

        return GraphContextResponse(
            entities=unique_entities,
            relations=unique_relations,
            paths=paths,
            total_entities=len(unique_entities),
            total_relations=len(unique_relations),
        )

    except Exception as e:
        logger.error("Graph context failed", error=str(e))
        raise HTTPException(status_code=500, detail=f"Graph query failed: {str(e)}")


@router.get("/stats")
async def get_rag_stats(
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Get RAG system statistics."""
    try:
        from app.integration.graph_connector import get_graph_connector
        from app.integration.rag_connector import get_rag_connector
        from app.rag.service import RAGService

        rag_service = RAGService()
        rag_connector = get_rag_connector()
        graph_connector = get_graph_connector()

        return {
            # RAGService.get_stats() is synchronous — awaiting its dict
            # result raised "object dict can't be used in 'await'".
            "rag_service": rag_service.get_stats(),
            "vector_indexing": rag_connector.get_stats(),
            "graph_updates": graph_connector.get_stats(),
        }

    except Exception as e:
        logger.error("Stats retrieval failed", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/health")
async def rag_health_check() -> dict[str, Any]:
    """Check RAG system health."""
    health = {
        "status": "healthy",
        "components": {},
        "timestamp": datetime.now(UTC).isoformat(),
    }

    try:
        from app.integration.rag_connector import get_rag_connector

        rag_health = await get_rag_connector().health_check()
        health["components"]["rag_connector"] = rag_health
        if rag_health["status"] != "healthy":
            health["status"] = "degraded"
    except Exception as e:
        health["status"] = "degraded"
        health["components"]["rag_connector"] = {"status": "unhealthy", "error": str(e)}

    try:
        from app.integration.graph_connector import get_graph_connector

        graph_health = await get_graph_connector().health_check()
        health["components"]["graph_connector"] = graph_health
        if graph_health["status"] != "healthy":
            health["status"] = "degraded"
    except Exception as e:
        health["status"] = "degraded"
        health["components"]["graph_connector"] = {"status": "unhealthy", "error": str(e)}

    return health


@router.delete("/cache")
async def clear_rag_cache(
    cache_type: str = Query(default="all", pattern="^(all|embeddings|entities|results)$"),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Clear RAG caches."""
    logger.info("Cache clear requested", cache_type=cache_type)

    try:
        cleared = {}

        if cache_type in ["all", "embeddings"]:
            from app.rag.embeddings import EmbeddingPipeline

            embedder = EmbeddingPipeline()
            embedder.clear_cache()
            cleared["embeddings"] = True

        if cache_type in ["all", "entities"]:
            from app.integration.graph_connector import get_graph_connector

            get_graph_connector().clear_cache()
            cleared["entities"] = True

        if cache_type in ["all", "results"]:
            from app.rag.service import RAGService

            rag_service = RAGService()
            await rag_service.clear_cache()
            cleared["results"] = True

        return {
            "status": "success",
            "cleared": cleared,
        }

    except Exception as e:
        logger.error("Cache clear failed", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))
