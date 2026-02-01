"""
RAG Connector - Vector Store Integration

Connects ingestion agents to the vector store for semantic indexing.
Handles embedding generation, chunking, and index management.
"""

import asyncio
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional, Callable
from uuid import UUID, uuid4

from app.agents.ingestion.base import IngestionRecord, SourceType
from app.core.logging import get_logger

logger = get_logger(__name__)


class EmbeddingModel(str, Enum):
    """Available embedding models."""

    MINILM = "all-MiniLM-L6-v2"
    MPNET = "all-mpnet-base-v2"
    PUBMEDBERT = "microsoft/BiomedNLP-PubMedBERT-base-uncased-abstract"
    BIOBERT = "dmis-lab/biobert-base-cased-v1.1"
    SCIBERT = "allenai/scibert_scivocab_uncased"
    OPENAI_SMALL = "text-embedding-3-small"
    OPENAI_LARGE = "text-embedding-3-large"


class ChunkingStrategy(str, Enum):
    """Document chunking strategies."""

    FIXED = "fixed"
    SENTENCE = "sentence"
    PARAGRAPH = "paragraph"
    SEMANTIC = "semantic"
    RECURSIVE = "recursive"


@dataclass
class IndexingConfig:
    """Configuration for vector store indexing."""

    embedding_model: EmbeddingModel = EmbeddingModel.PUBMEDBERT
    chunking_strategy: ChunkingStrategy = ChunkingStrategy.SEMANTIC
    chunk_size: int = 512
    chunk_overlap: int = 50
    include_metadata: bool = True
    metadata_fields: List[str] = field(default_factory=lambda: [
        "source_type", "source_id", "title", "authors", "date",
        "entities", "doi", "pmid", "url"
    ])
    batch_size: int = 50
    max_retries: int = 3
    collection_name: str = "genup_documents"
    namespace: Optional[str] = None


@dataclass
class IndexingResult:
    """Result of an indexing operation."""

    success: bool
    record_id: str
    chunks_created: int
    vectors_stored: int
    metadata_stored: bool
    error: Optional[str] = None
    duration_ms: float = 0.0
    embedding_model: Optional[str] = None


@dataclass
class ChunkedDocument:
    """A chunked document ready for embedding."""

    chunk_id: str
    record_id: str
    content: str
    metadata: Dict[str, Any]
    chunk_index: int
    total_chunks: int
    start_char: int
    end_char: int


class RAGConnector:
    """
    Connects ingestion agents to the RAG vector store.

    Responsibilities:
    - Document chunking using various strategies
    - Embedding generation with configurable models
    - Vector store indexing with metadata
    - Batch processing and error handling
    - Index management (create, update, delete)
    """

    def __init__(
        self,
        config: Optional[IndexingConfig] = None,
    ):
        """
        Initialize the RAG connector.

        Args:
            config: Indexing configuration
        """
        self.config = config or IndexingConfig()

        # Lazy-loaded components
        self._chunker = None
        self._embedder = None
        self._vector_store = None

        # Callbacks
        self._on_indexed: List[Callable[[IndexingResult], None]] = []

        # Statistics
        self._stats = {
            "total_indexed": 0,
            "total_chunks": 0,
            "total_errors": 0,
            "last_indexed_at": None,
        }

        self.logger = logger

    async def _get_chunker(self):
        """Lazy-load the document chunker."""
        if self._chunker is None:
            from app.rag.chunker import DocumentChunker, ChunkingConfig

            chunker_config = ChunkingConfig(
                strategy=self.config.chunking_strategy.value,
                chunk_size=self.config.chunk_size,
                overlap=self.config.chunk_overlap,
            )
            self._chunker = DocumentChunker(config=chunker_config)

        return self._chunker

    async def _get_embedder(self):
        """Lazy-load the embedding pipeline."""
        if self._embedder is None:
            from app.rag.embeddings import EmbeddingPipeline, EmbeddingConfig

            embed_config = EmbeddingConfig(
                model_name=self.config.embedding_model.value,
                batch_size=self.config.batch_size,
            )
            self._embedder = EmbeddingPipeline(config=embed_config)

        return self._embedder

    async def _get_vector_store(self):
        """Lazy-load the vector store."""
        if self._vector_store is None:
            from app.knowledge.vector_store import VectorStore

            self._vector_store = VectorStore(
                collection_name=self.config.collection_name,
            )

        return self._vector_store

    def add_callback(
        self,
        callback: Callable[[IndexingResult], None],
    ) -> None:
        """Add a callback for indexing events."""
        self._on_indexed.append(callback)

    def _notify_callbacks(self, result: IndexingResult) -> None:
        """Notify all callbacks of indexing result."""
        for callback in self._on_indexed:
            try:
                callback(result)
            except Exception as e:
                self.logger.error("Callback error", error=str(e))

    async def index_record(
        self,
        record: IngestionRecord,
        config: Optional[IndexingConfig] = None,
    ) -> IndexingResult:
        """
        Index a single ingestion record.

        Args:
            record: The ingestion record to index
            config: Optional override configuration

        Returns:
            Indexing result
        """
        cfg = config or self.config
        start_time = datetime.utcnow()

        try:
            # Get components
            chunker = await self._get_chunker()
            embedder = await self._get_embedder()
            vector_store = await self._get_vector_store()

            # Extract content
            content = self._extract_content(record)
            if not content:
                return IndexingResult(
                    success=False,
                    record_id=record.source_id,
                    chunks_created=0,
                    vectors_stored=0,
                    metadata_stored=False,
                    error="No content to index",
                )

            # Chunk the document
            chunks = await chunker.chunk(
                text=content,
                metadata=self._build_metadata(record),
            )

            if not chunks:
                return IndexingResult(
                    success=False,
                    record_id=record.source_id,
                    chunks_created=0,
                    vectors_stored=0,
                    metadata_stored=False,
                    error="Chunking produced no chunks",
                )

            # Create chunked documents
            chunked_docs = [
                ChunkedDocument(
                    chunk_id=f"{record.source_id}_chunk_{i}",
                    record_id=record.source_id,
                    content=chunk.text,
                    metadata={
                        **chunk.metadata,
                        "chunk_index": i,
                        "total_chunks": len(chunks),
                    },
                    chunk_index=i,
                    total_chunks=len(chunks),
                    start_char=chunk.start_offset,
                    end_char=chunk.end_offset,
                )
                for i, chunk in enumerate(chunks)
            ]

            # Generate embeddings
            texts = [doc.content for doc in chunked_docs]
            embeddings = await embedder.embed_batch(texts)

            # Store in vector store
            ids = [doc.chunk_id for doc in chunked_docs]
            metadatas = [doc.metadata for doc in chunked_docs]

            await vector_store.add_documents(
                ids=ids,
                embeddings=embeddings,
                documents=texts,
                metadatas=metadatas,
            )

            # Calculate duration
            duration_ms = (datetime.utcnow() - start_time).total_seconds() * 1000

            # Update stats
            self._stats["total_indexed"] += 1
            self._stats["total_chunks"] += len(chunks)
            self._stats["last_indexed_at"] = datetime.utcnow()

            result = IndexingResult(
                success=True,
                record_id=record.source_id,
                chunks_created=len(chunks),
                vectors_stored=len(embeddings),
                metadata_stored=cfg.include_metadata,
                duration_ms=duration_ms,
                embedding_model=cfg.embedding_model.value,
            )

            self.logger.info(
                "Record indexed",
                record_id=record.source_id,
                chunks=len(chunks),
                duration_ms=round(duration_ms, 2),
            )

            self._notify_callbacks(result)
            return result

        except Exception as e:
            self._stats["total_errors"] += 1
            duration_ms = (datetime.utcnow() - start_time).total_seconds() * 1000

            result = IndexingResult(
                success=False,
                record_id=record.source_id,
                chunks_created=0,
                vectors_stored=0,
                metadata_stored=False,
                error=str(e),
                duration_ms=duration_ms,
            )

            self.logger.error(
                "Indexing failed",
                record_id=record.source_id,
                error=str(e),
            )

            self._notify_callbacks(result)
            return result

    async def index_batch(
        self,
        records: List[IngestionRecord],
        config: Optional[IndexingConfig] = None,
        progress_callback: Optional[Callable[[int, int], None]] = None,
    ) -> List[IndexingResult]:
        """
        Index a batch of records.

        Args:
            records: List of records to index
            config: Optional override configuration
            progress_callback: Optional progress callback (current, total)

        Returns:
            List of indexing results
        """
        results = []
        total = len(records)

        for i, record in enumerate(records):
            result = await self.index_record(record, config)
            results.append(result)

            if progress_callback:
                progress_callback(i + 1, total)

        return results

    async def index_batch_parallel(
        self,
        records: List[IngestionRecord],
        config: Optional[IndexingConfig] = None,
        max_concurrent: int = 5,
    ) -> List[IndexingResult]:
        """
        Index a batch of records in parallel.

        Args:
            records: List of records to index
            config: Optional override configuration
            max_concurrent: Maximum concurrent indexing operations

        Returns:
            List of indexing results
        """
        semaphore = asyncio.Semaphore(max_concurrent)

        async def index_with_semaphore(record: IngestionRecord) -> IndexingResult:
            async with semaphore:
                return await self.index_record(record, config)

        tasks = [index_with_semaphore(record) for record in records]
        return await asyncio.gather(*tasks)

    def _extract_content(self, record: IngestionRecord) -> str:
        """Extract indexable content from a record."""
        parts = []

        # Title
        if record.title:
            parts.append(f"Title: {record.title}")

        # Abstract
        if record.abstract:
            parts.append(f"Abstract: {record.abstract}")

        # Full text
        if record.full_text:
            parts.append(f"Content: {record.full_text}")

        # Metadata fields
        if record.authors:
            parts.append(f"Authors: {', '.join(record.authors)}")

        if record.keywords:
            parts.append(f"Keywords: {', '.join(record.keywords)}")

        return "\n\n".join(parts)

    def _build_metadata(self, record: IngestionRecord) -> Dict[str, Any]:
        """Build metadata dictionary for indexing."""
        metadata = {
            "source_type": record.source_type.value,
            "source_id": record.source_id,
            "title": record.title or "",
            "date": record.publication_date.isoformat() if record.publication_date else "",
            "url": record.url or "",
            "indexed_at": datetime.utcnow().isoformat(),
        }

        # Optional fields
        if record.authors:
            metadata["authors"] = record.authors[:10]  # Limit for storage

        if record.doi:
            metadata["doi"] = record.doi

        if record.pmid:
            metadata["pmid"] = record.pmid

        if record.entities:
            # Store first 50 entities
            metadata["entities"] = [
                {"text": e.text, "type": e.entity_type}
                for e in record.entities[:50]
            ]

        if record.keywords:
            metadata["keywords"] = record.keywords[:20]

        return metadata

    async def delete_record(self, record_id: str) -> bool:
        """
        Delete a record and its chunks from the vector store.

        Args:
            record_id: ID of the record to delete

        Returns:
            True if deleted successfully
        """
        try:
            vector_store = await self._get_vector_store()

            # Delete all chunks for this record
            await vector_store.delete_by_metadata(
                filter_dict={"source_id": record_id}
            )

            self.logger.info("Record deleted from vector store", record_id=record_id)
            return True

        except Exception as e:
            self.logger.error(
                "Failed to delete record",
                record_id=record_id,
                error=str(e),
            )
            return False

    async def update_record(
        self,
        record: IngestionRecord,
        config: Optional[IndexingConfig] = None,
    ) -> IndexingResult:
        """
        Update a record in the vector store.

        Deletes existing chunks and re-indexes.

        Args:
            record: Updated record
            config: Optional override configuration

        Returns:
            Indexing result
        """
        # Delete existing
        await self.delete_record(record.source_id)

        # Re-index
        return await self.index_record(record, config)

    async def search(
        self,
        query: str,
        top_k: int = 10,
        filters: Optional[Dict[str, Any]] = None,
    ) -> List[Dict[str, Any]]:
        """
        Search the vector store.

        Args:
            query: Search query
            top_k: Number of results to return
            filters: Optional metadata filters

        Returns:
            List of search results
        """
        embedder = await self._get_embedder()
        vector_store = await self._get_vector_store()

        # Generate query embedding
        query_embedding = await embedder.embed(query)

        # Search
        results = await vector_store.search(
            query_embedding=query_embedding,
            top_k=top_k,
            filter_dict=filters,
        )

        return results

    def get_stats(self) -> Dict[str, Any]:
        """Get indexing statistics."""
        return {
            **self._stats,
            "last_indexed_at": self._stats["last_indexed_at"].isoformat()
            if self._stats["last_indexed_at"] else None,
        }

    async def health_check(self) -> Dict[str, Any]:
        """Check connector health."""
        health = {
            "status": "healthy",
            "components": {},
        }

        try:
            vector_store = await self._get_vector_store()
            await vector_store.health_check()
            health["components"]["vector_store"] = "healthy"
        except Exception as e:
            health["status"] = "degraded"
            health["components"]["vector_store"] = f"unhealthy: {str(e)}"

        try:
            embedder = await self._get_embedder()
            await embedder.health_check()
            health["components"]["embedder"] = "healthy"
        except Exception as e:
            health["status"] = "degraded"
            health["components"]["embedder"] = f"unhealthy: {str(e)}"

        return health


# Global connector instance
_rag_connector: Optional[RAGConnector] = None


def get_rag_connector(config: Optional[IndexingConfig] = None) -> RAGConnector:
    """Get the global RAG connector instance."""
    global _rag_connector
    if _rag_connector is None:
        _rag_connector = RAGConnector(config=config)
    return _rag_connector


async def index_ingestion_records(
    records: List[IngestionRecord],
    parallel: bool = True,
    max_concurrent: int = 5,
) -> List[IndexingResult]:
    """
    Convenience function to index ingestion records.

    Args:
        records: Records to index
        parallel: Whether to process in parallel
        max_concurrent: Maximum concurrent operations

    Returns:
        List of indexing results
    """
    connector = get_rag_connector()

    if parallel:
        return await connector.index_batch_parallel(
            records,
            max_concurrent=max_concurrent,
        )
    else:
        return await connector.index_batch(records)
