"""
RAG Service Module

Unified RAG (Retrieval-Augmented Generation) service that orchestrates
embedding, retrieval, reranking, and context preparation for LLM queries.
Connected to multiple ingestion agents for continuous data acquisition.
"""

from dataclasses import dataclass
from datetime import UTC, datetime
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel

from app.core.logging import LoggerMixin, get_logger
from app.rag.chunker import (
    ChunkingConfig,
    DocumentChunker,
)
from app.rag.embeddings import (
    EmbeddingModel,
    EmbeddingPipeline,
)
from app.rag.reranker import (
    Reranker,
    RerankerConfig,
    RerankerModel,
    RerankerOutput,
)
from app.rag.retriever import (
    HybridRetriever,
    RetrievalConfig,
    RetrievalResult,
    RetrievalStrategy,
    RetrievedChunk,
    SourceType,
)

logger = get_logger(__name__)

# Global RAG service instance
_rag_service: Optional["RAGService"] = None


class RAGMode(str, Enum):
    """RAG operation mode."""

    FAST = "fast"  # Quick retrieval, minimal reranking
    BALANCED = "balanced"  # Balance between speed and quality
    QUALITY = "quality"  # Maximum quality, slower


@dataclass
class RAGConfig:
    """Configuration for the RAG service."""

    # Mode
    mode: RAGMode = RAGMode.BALANCED

    # Embedding settings
    embedding_model: EmbeddingModel = EmbeddingModel.MINILM
    biomedical_model: EmbeddingModel = EmbeddingModel.PUBMEDBERT

    # Retrieval settings
    retrieval_strategy: RetrievalStrategy = RetrievalStrategy.HYBRID
    top_k: int = 10
    min_relevance: float = 0.5

    # Reranking settings
    reranker_model: RerankerModel = RerankerModel.SIMPLE
    enable_reranking: bool = True

    # Chunking settings
    chunk_size: int = 512
    chunk_overlap: int = 50

    # Context settings
    max_context_tokens: int = 4000
    include_metadata: bool = True

    @classmethod
    def for_mode(cls, mode: RAGMode) -> "RAGConfig":
        """Get config optimized for a specific mode."""
        if mode == RAGMode.FAST:
            return cls(
                mode=mode,
                retrieval_strategy=RetrievalStrategy.VECTOR_ONLY,
                top_k=5,
                enable_reranking=False,
            )
        elif mode == RAGMode.QUALITY:
            return cls(
                mode=mode,
                retrieval_strategy=RetrievalStrategy.HYBRID,
                top_k=20,
                enable_reranking=True,
                reranker_model=RerankerModel.MS_MARCO,
            )
        else:  # BALANCED
            return cls(mode=mode)


class IndexedDocument(BaseModel):
    """A document indexed in the RAG system."""

    id: str
    title: str | None = None
    content: str
    source: SourceType
    metadata: dict[str, Any] = {}

    # Indexing info
    indexed_at: datetime
    chunk_count: int = 0
    embedding_model: str = ""


class RAGContext(BaseModel):
    """Context prepared for LLM."""

    query: str
    context_text: str
    chunks: list[RetrievedChunk]
    total_tokens: int

    # Source attribution
    sources: list[dict[str, Any]] = []

    # Statistics
    retrieval_time_ms: float = 0.0
    rerank_time_ms: float = 0.0


class RAGQueryResult(BaseModel):
    """Result of a RAG query."""

    query: str
    context: RAGContext
    retrieval_result: RetrievalResult
    rerank_result: RerankerOutput | None = None

    # Timing
    total_time_ms: float = 0.0


class RAGService(LoggerMixin):
    """
    Unified RAG service for biomedical knowledge retrieval.

    Orchestrates the full RAG pipeline:
    1. Query embedding
    2. Hybrid retrieval (vector + graph + keyword)
    3. Reranking and relevance scoring
    4. Context preparation for LLM

    Designed to work with multiple ingestion agents for
    continuous data acquisition and indexing.
    """

    def __init__(self, config: RAGConfig | None = None):
        self.config = config or RAGConfig()
        self._embedding_pipeline: EmbeddingPipeline | None = None
        self._retriever: HybridRetriever | None = None
        self._reranker: Reranker | None = None
        self._chunker: DocumentChunker | None = None
        self._initialized = False

        # Index tracking
        self._indexed_documents: dict[str, IndexedDocument] = {}
        self._index_stats = {
            "total_documents": 0,
            "total_chunks": 0,
            "last_update": None,
        }

    async def initialize(self) -> None:
        """Initialize all RAG components."""
        if self._initialized:
            return

        self.logger.info("Initializing RAG service", mode=self.config.mode.value)

        # Initialize embedding pipeline
        try:
            models_to_load = [self.config.embedding_model]
            if self.config.biomedical_model != self.config.embedding_model:
                models_to_load.append(self.config.biomedical_model)

            self._embedding_pipeline = EmbeddingPipeline()
            await self._embedding_pipeline.initialize(models_to_load)
        except Exception as e:
            self.logger.warning("Embedding pipeline initialization failed", error=str(e))
            self._embedding_pipeline = EmbeddingPipeline()

        # Initialize retriever
        try:
            from app.knowledge.graph_store import get_graph_store
            from app.knowledge.vector_store import get_vector_store

            vector_store = None
            graph_store = None

            try:
                vector_store = get_vector_store()
            except RuntimeError:
                pass

            try:
                graph_store = get_graph_store()
            except RuntimeError:
                pass

            self._retriever = HybridRetriever(
                vector_store=vector_store,
                graph_store=graph_store,
                embedding_pipeline=self._embedding_pipeline,
            )
            await self._retriever.initialize()
        except Exception as e:
            self.logger.warning("Retriever initialization failed", error=str(e))
            self._retriever = HybridRetriever()

        # Initialize reranker
        if self.config.enable_reranking:
            try:
                reranker_config = RerankerConfig(
                    model=self.config.reranker_model,
                    top_k=self.config.top_k,
                    min_score=self.config.min_relevance,
                )
                self._reranker = Reranker(reranker_config)
                await self._reranker.initialize()
            except Exception as e:
                self.logger.warning("Reranker initialization failed", error=str(e))
                self._reranker = None

        # Initialize chunker
        chunking_config = ChunkingConfig(
            chunk_size=self.config.chunk_size,
            chunk_overlap=self.config.chunk_overlap,
        )
        self._chunker = DocumentChunker(
            config=chunking_config,
            embedding_pipeline=self._embedding_pipeline,
        )

        self._initialized = True
        self.logger.info("RAG service initialized")

    async def query(
        self,
        query: str,
        config_override: RAGConfig | None = None,
    ) -> RAGQueryResult:
        """
        Execute a RAG query.

        Args:
            query: User query string
            config_override: Optional config override for this query

        Returns:
            RAGQueryResult with context and sources
        """
        import time

        start_time = time.time()

        if not self._initialized:
            await self.initialize()

        config = config_override or self.config

        # Build retrieval config
        retrieval_config = RetrievalConfig(
            strategy=config.retrieval_strategy,
            top_k=config.top_k * 2 if config.enable_reranking else config.top_k,
            min_score=config.min_relevance * 0.5,  # Lower threshold for initial retrieval
        )

        # Execute retrieval
        retrieval_result = await self._retriever.retrieve(query, retrieval_config)

        # Rerank if enabled
        rerank_result = None
        final_chunks = retrieval_result.chunks

        if config.enable_reranking and self._reranker and retrieval_result.chunks:
            # Extract entities from query for entity coverage scoring
            query_entities = self._extract_entities(query)

            rerank_result = await self._reranker.rerank(
                query=query,
                chunks=retrieval_result.chunks,
                query_entities=query_entities,
            )

            # Use reranked chunks
            final_chunks = [r.chunk for r in rerank_result.results]

        # Prepare context
        context = self._prepare_context(
            query=query,
            chunks=final_chunks[: config.top_k],
            max_tokens=config.max_context_tokens,
            include_metadata=config.include_metadata,
        )

        total_time = (time.time() - start_time) * 1000

        return RAGQueryResult(
            query=query,
            context=context,
            retrieval_result=retrieval_result,
            rerank_result=rerank_result,
            total_time_ms=total_time,
        )

    async def index_document(
        self,
        content: str,
        document_id: str,
        title: str | None = None,
        source: SourceType = SourceType.CUSTOM,
        metadata: dict[str, Any] = None,
    ) -> IndexedDocument:
        """
        Index a document for RAG retrieval.

        Args:
            content: Document text content
            document_id: Unique document identifier
            title: Optional document title
            source: Source type
            metadata: Additional metadata

        Returns:
            IndexedDocument with indexing info
        """
        if not self._initialized:
            await self.initialize()

        metadata = metadata or {}
        metadata["source"] = source.value

        # Chunk the document
        chunking_result = self._chunker.chunk_document(
            text=content,
            document_id=document_id,
            title=title,
            metadata=metadata,
        )

        # Index chunks in vector store
        try:
            from app.knowledge.vector_store import get_vector_store

            vector_store = get_vector_store()

            for chunk in chunking_result.chunks:
                chunk_metadata = {
                    **metadata,
                    "document_id": document_id,
                    "chunk_index": chunk.index,
                    "document_title": title,
                }

                await vector_store.add_document(
                    content=chunk.content,
                    metadata=chunk_metadata,
                    doc_id=chunk.id,
                )

        except RuntimeError:
            self.logger.warning("Vector store not available, using keyword index only")

        # Add to keyword index
        if self._retriever:
            self._retriever.add_to_keyword_index(
                doc_id=document_id,
                content=content,
                metadata=metadata,
            )

        # Track indexed document
        indexed_doc = IndexedDocument(
            id=document_id,
            title=title,
            content=content[:500] + "..." if len(content) > 500 else content,
            source=source,
            metadata=metadata,
            indexed_at=datetime.now(UTC),
            chunk_count=len(chunking_result.chunks),
            embedding_model=self.config.embedding_model.value,
        )

        self._indexed_documents[document_id] = indexed_doc
        self._index_stats["total_documents"] += 1
        self._index_stats["total_chunks"] += len(chunking_result.chunks)
        self._index_stats["last_update"] = datetime.now(UTC)

        self.logger.info(
            "Document indexed",
            document_id=document_id,
            chunks=len(chunking_result.chunks),
        )

        return indexed_doc

    async def index_batch(
        self,
        documents: list[dict[str, Any]],
    ) -> list[IndexedDocument]:
        """
        Index multiple documents.

        Args:
            documents: List of dicts with 'content', 'id', and optional 'title', 'source', 'metadata'

        Returns:
            List of IndexedDocument objects
        """
        results = []
        for doc in documents:
            try:
                indexed = await self.index_document(
                    content=doc["content"],
                    document_id=doc["id"],
                    title=doc.get("title"),
                    source=SourceType(doc.get("source", "custom")),
                    metadata=doc.get("metadata"),
                )
                results.append(indexed)
            except Exception as e:
                self.logger.error(
                    "Failed to index document",
                    document_id=doc.get("id"),
                    error=str(e),
                )
        return results

    async def delete_document(self, document_id: str) -> bool:
        """
        Delete a document from the index.

        Args:
            document_id: Document ID to delete

        Returns:
            True if deleted successfully
        """
        if document_id not in self._indexed_documents:
            return False

        try:
            from app.knowledge.vector_store import get_vector_store

            vector_store = get_vector_store()

            # Delete all chunks
            doc = self._indexed_documents[document_id]
            for i in range(doc.chunk_count):
                chunk_id = f"{document_id}_chunk_{i}"
                await vector_store.delete_document(chunk_id)

        except RuntimeError:
            pass

        # Remove from tracking
        del self._indexed_documents[document_id]
        self._index_stats["total_documents"] -= 1

        self.logger.info("Document deleted", document_id=document_id)
        return True

    def _extract_entities(self, query: str) -> list[str]:
        """Extract potential entities from query."""
        import re

        # Simple extraction - words that might be entities
        words = re.split(r"[,\s]+", query)
        entities = []

        for word in words:
            word = word.strip("?.,!;:")
            # Keep capitalized words or longer words
            if len(word) > 3 and (word[0].isupper() or len(word) > 5):
                entities.append(word)

        return entities

    def _prepare_context(
        self,
        query: str,
        chunks: list[RetrievedChunk],
        max_tokens: int,
        include_metadata: bool,
    ) -> RAGContext:
        """Prepare context for LLM from retrieved chunks."""
        context_parts = []
        sources = []
        total_tokens = 0

        for i, chunk in enumerate(chunks):
            # Estimate tokens (rough: ~4 chars per token)
            chunk_tokens = len(chunk.content) // 4

            if total_tokens + chunk_tokens > max_tokens:
                break

            # Format chunk
            if include_metadata:
                source_info = f"[Source: {chunk.source.value}"
                if chunk.metadata.get("document_title"):
                    source_info += f" - {chunk.metadata['document_title']}"
                source_info += "]"
                context_parts.append(f"{source_info}\n{chunk.content}")
            else:
                context_parts.append(chunk.content)

            # Track source
            sources.append(
                {
                    "id": chunk.id,
                    "source": chunk.source.value,
                    "title": chunk.metadata.get("document_title"),
                    "score": chunk.score,
                }
            )

            total_tokens += chunk_tokens

        context_text = "\n\n---\n\n".join(context_parts)

        return RAGContext(
            query=query,
            context_text=context_text,
            chunks=chunks[: len(context_parts)],
            total_tokens=total_tokens,
            sources=sources,
        )

    def get_stats(self) -> dict[str, Any]:
        """Get RAG service statistics."""
        stats = {
            "initialized": self._initialized,
            "mode": self.config.mode.value,
            "index": self._index_stats.copy(),
            "embedding": {
                "models": self._embedding_pipeline.available_models
                if self._embedding_pipeline
                else [],
                "cache": self._embedding_pipeline.cache_stats if self._embedding_pipeline else {},
            },
            "retrieval": {
                "strategy": self.config.retrieval_strategy.value,
            },
            "reranking": {
                "enabled": self.config.enable_reranking,
                "model": self.config.reranker_model.value if self.config.enable_reranking else None,
            },
        }
        return stats

    async def health_check(self) -> dict[str, Any]:
        """Check health of RAG components."""
        health = {
            "status": "healthy",
            "components": {},
        }

        # Check embedding pipeline
        if self._embedding_pipeline:
            try:
                result = await self._embedding_pipeline.embed("test")
                health["components"]["embeddings"] = {
                    "status": "healthy",
                    "dimension": result.dimension,
                }
            except Exception as e:
                health["components"]["embeddings"] = {
                    "status": "unhealthy",
                    "error": str(e),
                }
                health["status"] = "degraded"

        # Check retriever
        if self._retriever:
            health["components"]["retriever"] = {"status": "healthy"}

        # Check reranker
        if self._reranker:
            health["components"]["reranker"] = {"status": "healthy"}

        return health


async def init_rag_service(config: RAGConfig | None = None) -> None:
    """Initialize the global RAG service."""
    global _rag_service
    _rag_service = RAGService(config)
    await _rag_service.initialize()


def get_rag_service() -> RAGService:
    """Get the global RAG service instance."""
    if _rag_service is None:
        raise RuntimeError("RAG service not initialized")
    return _rag_service


async def query_rag(
    query: str,
    mode: RAGMode = RAGMode.BALANCED,
) -> RAGQueryResult:
    """Convenience function to query the RAG service."""
    service = get_rag_service()
    config = RAGConfig.for_mode(mode)
    return await service.query(query, config)
