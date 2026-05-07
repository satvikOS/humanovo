"""
Vector Store Module — pgvector Implementation

Manages vector embeddings for semantic search using PostgreSQL with pgvector.
Supports dual-model embeddings (Bedrock Cohere biomedical + Azure general)
and retrieval-augmented generation (RAG) workflows.

Replaces the previous ChromaDB-based implementation while preserving the
same public API surface.
"""

from typing import Any, Optional
from uuid import UUID, uuid4

from pydantic import BaseModel, Field
from sqlalchemy import (
    Column,
    DateTime,
    Index,
    String,
    Text,
    func,
    select,
    text,
    delete,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID as PGUUID
from pgvector.sqlalchemy import Vector

from app.core.database import async_session_factory, engine
from app.models.base import Base
from app.core.config import settings
from app.core.logging import LoggerMixin, get_logger

logger = get_logger(__name__)

# ---------------------------------------------------------------------------
# Global singleton
# ---------------------------------------------------------------------------
_vector_store: Optional["VectorStore"] = None

# ---------------------------------------------------------------------------
# Embedding dimension constants
# ---------------------------------------------------------------------------
BIOMEDICAL_DIM = 1024   # Bedrock Cohere Embed v3
GENERAL_DIM = 1536      # Azure text-embedding-3-large (spec: 1536d, matches grounding_cache)

# ---------------------------------------------------------------------------
# SQLAlchemy ORM model
# ---------------------------------------------------------------------------


class VectorEmbedding(Base):
    """PostgreSQL table for vector embeddings with pgvector columns."""

    __tablename__ = "vector_embeddings"

    id = Column(PGUUID(as_uuid=True), primary_key=True, default=uuid4, nullable=False)
    content = Column(Text, nullable=False)
    embedding_biomedical = Column(Vector(BIOMEDICAL_DIM), nullable=True)
    embedding_general = Column(Vector(GENERAL_DIM), nullable=True)
    metadata_ = Column("metadata", JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    source_type = Column(String(128), nullable=True, index=True)
    source_id = Column(String(256), nullable=True, index=True)
    created_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    __table_args__ = (
        Index(
            "ix_vector_embeddings_biomedical_cosine",
            embedding_biomedical,
            postgresql_using="ivfflat",
            postgresql_with={"lists": 100},
            postgresql_ops={"embedding_biomedical": "vector_cosine_ops"},
        ),
        Index(
            "ix_vector_embeddings_general_cosine",
            embedding_general,
            postgresql_using="ivfflat",
            postgresql_with={"lists": 100},
            postgresql_ops={"embedding_general": "vector_cosine_ops"},
        ),
    )

# ---------------------------------------------------------------------------
# Pydantic data-transfer models  (public API)
# ---------------------------------------------------------------------------


class EmbeddingDocument(BaseModel):
    """Document with embedding for vector storage."""

    id: str
    content: str
    embedding: list[float] | None = None
    embedding_biomedical: list[float] | None = None
    embedding_general: list[float] | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    source_type: str | None = None
    source_id: str | None = None


class SearchResult(BaseModel):
    """Search result from vector store."""

    id: str
    content: str
    score: float
    metadata: dict[str, Any] = Field(default_factory=dict)
    source_type: str | None = None
    source_id: str | None = None

# ---------------------------------------------------------------------------
# VectorStore
# ---------------------------------------------------------------------------


class VectorStore(LoggerMixin):
    """Vector store backed by PostgreSQL + pgvector.

    Stores dual embeddings per document:
      - embedding_biomedical  (1024-d, Bedrock Cohere Embed v3)
      - embedding_general     (1536-d, Azure text-embedding-3-large)

    Supports hybrid search that combines cosine similarity scores from both
    embedding spaces with configurable weights.
    """

    def __init__(self) -> None:
        self._initialized = False

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    async def initialize(self) -> None:
        """Ensure pgvector extension is enabled and the table exists."""
        if self._initialized:
            return

        self.logger.info("Initializing pgvector vector store")

        try:
            async with engine.begin() as conn:
                # Enable pgvector extension (idempotent)
                await conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
                self.logger.info("pgvector extension verified")

                # Create the table + indexes if they don't exist
                await conn.run_sync(Base.metadata.create_all)
                self.logger.info("vector_embeddings table verified")
        except Exception as e:
            self.logger.error("Failed to initialize pgvector vector store", error=str(e))
            raise

        self._initialized = True
        self.logger.info("pgvector vector store initialized")

    # ------------------------------------------------------------------
    # Single-document CRUD
    # ------------------------------------------------------------------

    async def add_document(
        self,
        content: str,
        metadata: dict[str, Any] | None = None,
        doc_id: str | None = None,
        embedding_biomedical: list[float] | None = None,
        embedding_general: list[float] | None = None,
        source_type: str | None = None,
        source_id: str | None = None,
    ) -> str:
        """Add a single document with its embeddings.

        Args:
            content: Document text content.
            metadata: Optional metadata dictionary.
            doc_id: Optional document ID (UUID string); generated if omitted.
            embedding_biomedical: 1024-d Cohere biomedical embedding.
            embedding_general: 1536-d Azure general embedding.
            source_type: Category of the source document.
            source_id: External reference identifier.

        Returns:
            The document's UUID string.
        """
        doc_uuid = UUID(doc_id) if doc_id else uuid4()
        metadata = metadata or {}

        row = VectorEmbedding(
            id=doc_uuid,
            content=content,
            embedding_biomedical=embedding_biomedical,
            embedding_general=embedding_general,
            metadata_=metadata,
            source_type=source_type,
            source_id=source_id,
        )

        async with async_session_factory() as session:
            session.add(row)
            await session.commit()

        doc_id_str = str(doc_uuid)
        self.logger.debug("Document added", doc_id=doc_id_str)
        return doc_id_str

    # ------------------------------------------------------------------
    # Batch insert
    # ------------------------------------------------------------------

    async def add_documents(
        self,
        documents: list[dict[str, Any]],
        batch_size: int = 500,
    ) -> list[str]:
        """Batch-add documents for efficiency.

        Each dict in *documents* may contain:
            content (required), metadata, id, embedding_biomedical,
            embedding_general, source_type, source_id.

        Args:
            documents: Sequence of document dicts.
            batch_size: Rows per INSERT statement.

        Returns:
            List of document UUID strings.
        """
        doc_ids: list[str] = []
        rows: list[VectorEmbedding] = []

        for doc in documents:
            doc_uuid = UUID(doc["id"]) if doc.get("id") else uuid4()
            rows.append(
                VectorEmbedding(
                    id=doc_uuid,
                    content=doc["content"],
                    embedding_biomedical=doc.get("embedding_biomedical"),
                    embedding_general=doc.get("embedding_general"),
                    metadata_=doc.get("metadata", {}),
                    source_type=doc.get("source_type"),
                    source_id=doc.get("source_id"),
                )
            )
            doc_ids.append(str(doc_uuid))

        # Insert in batches
        async with async_session_factory() as session:
            for start in range(0, len(rows), batch_size):
                batch = rows[start : start + batch_size]
                session.add_all(batch)
                await session.flush()
            await session.commit()

        self.logger.info("Documents added", count=len(doc_ids))
        return doc_ids

    # ------------------------------------------------------------------
    # Search helpers (private)
    # ------------------------------------------------------------------

    @staticmethod
    def _row_to_result(row: VectorEmbedding, score: float) -> SearchResult:
        return SearchResult(
            id=str(row.id),
            content=row.content,
            score=score,
            metadata=row.metadata_ or {},
            source_type=row.source_type,
            source_id=row.source_id,
        )

    # ------------------------------------------------------------------
    # Hybrid search
    # ------------------------------------------------------------------

    async def search(
        self,
        query: str | None = None,
        limit: int = 10,
        filters: dict[str, Any] | None = None,
        min_score: float = 0.0,
        embedding_biomedical: list[float] | None = None,
        embedding_general: list[float] | None = None,
        biomedical_weight: float = 0.6,
        general_weight: float = 0.4,
    ) -> list[SearchResult]:
        """Hybrid cosine-similarity search combining both embedding spaces.

        At least one of *embedding_biomedical* or *embedding_general* must be
        provided (pre-computed by the caller).  When only one is supplied, it
        receives the full weight.

        Args:
            query: Original query text (used only for logging).
            limit: Maximum results to return.
            filters: Optional dict of metadata / source_type / source_id filters.
            min_score: Minimum combined similarity score.
            embedding_biomedical: Pre-computed 1024-d query embedding.
            embedding_general: Pre-computed 1536-d query embedding.
            biomedical_weight: Weight for the biomedical similarity [0-1].
            general_weight: Weight for the general similarity [0-1].

        Returns:
            Sorted list of SearchResult (highest similarity first).
        """
        if embedding_biomedical is None and embedding_general is None:
            self.logger.warning("search() called without any query embeddings")
            return []

        # Normalise weights so they sum to 1
        total_weight = 0.0
        if embedding_biomedical is not None:
            total_weight += biomedical_weight
        if embedding_general is not None:
            total_weight += general_weight
        if total_weight == 0:
            total_weight = 1.0

        bio_w = (biomedical_weight / total_weight) if embedding_biomedical is not None else 0.0
        gen_w = (general_weight / total_weight) if embedding_general is not None else 0.0

        # Build the combined similarity expression.
        # pgvector <=> returns cosine *distance*; similarity = 1 - distance.
        similarity_parts: list[Any] = []
        if embedding_biomedical is not None:
            bio_dist = VectorEmbedding.embedding_biomedical.cosine_distance(embedding_biomedical)
            similarity_parts.append(bio_w * (1 - bio_dist))
        if embedding_general is not None:
            gen_dist = VectorEmbedding.embedding_general.cosine_distance(embedding_general)
            similarity_parts.append(gen_w * (1 - gen_dist))

        combined_score = similarity_parts[0]
        for part in similarity_parts[1:]:
            combined_score = combined_score + part

        stmt = (
            select(VectorEmbedding, combined_score.label("score"))
            .where(combined_score >= min_score)
            .order_by(combined_score.desc())
            .limit(limit)
        )

        # Optional filters
        stmt = self._apply_filters(stmt, filters)

        async with async_session_factory() as session:
            result = await session.execute(stmt)
            rows = result.all()

        results = [self._row_to_result(row.VectorEmbedding, float(row.score)) for row in rows]

        self.logger.debug(
            "Hybrid search completed",
            query=(query or "")[:50],
            results=len(results),
        )
        return results

    # ------------------------------------------------------------------
    # Single-model searches
    # ------------------------------------------------------------------

    async def search_biomedical(
        self,
        embedding: list[float],
        limit: int = 10,
        filters: dict[str, Any] | None = None,
        min_score: float = 0.0,
    ) -> list[SearchResult]:
        """Search using only the biomedical (Cohere 1024-d) embedding."""
        return await self._single_model_search(
            column=VectorEmbedding.embedding_biomedical,
            embedding=embedding,
            limit=limit,
            filters=filters,
            min_score=min_score,
        )

    async def search_general(
        self,
        embedding: list[float],
        limit: int = 10,
        filters: dict[str, Any] | None = None,
        min_score: float = 0.0,
    ) -> list[SearchResult]:
        """Search using only the general (Azure 1536-d) embedding."""
        return await self._single_model_search(
            column=VectorEmbedding.embedding_general,
            embedding=embedding,
            limit=limit,
            filters=filters,
            min_score=min_score,
        )

    async def _single_model_search(
        self,
        column: Any,
        embedding: list[float],
        limit: int,
        filters: dict[str, Any] | None,
        min_score: float,
    ) -> list[SearchResult]:
        cosine_dist = column.cosine_distance(embedding)
        similarity = (1 - cosine_dist).label("score")

        stmt = (
            select(VectorEmbedding, similarity)
            .where(column.isnot(None))
            .where((1 - cosine_dist) >= min_score)
            .order_by(cosine_dist.asc())
            .limit(limit)
        )

        stmt = self._apply_filters(stmt, filters)

        async with async_session_factory() as session:
            result = await session.execute(stmt)
            rows = result.all()

        return [self._row_to_result(row.VectorEmbedding, float(row.score)) for row in rows]

    # ------------------------------------------------------------------
    # Filter builder
    # ------------------------------------------------------------------

    @staticmethod
    def _apply_filters(stmt: Any, filters: dict[str, Any] | None) -> Any:
        """Apply optional filters to a SELECT statement."""
        if not filters:
            return stmt

        if "source_type" in filters:
            stmt = stmt.where(VectorEmbedding.source_type == filters["source_type"])
        if "source_id" in filters:
            stmt = stmt.where(VectorEmbedding.source_id == filters["source_id"])

        # JSONB metadata filters — simple top-level key equality
        for key, value in filters.items():
            if key in ("source_type", "source_id"):
                continue
            stmt = stmt.where(VectorEmbedding.metadata_[key].astext == str(value))

        return stmt

    # ------------------------------------------------------------------
    # Document retrieval / deletion
    # ------------------------------------------------------------------

    async def get_document(self, doc_id: str) -> EmbeddingDocument | None:
        """Get a single document by its UUID string."""
        try:
            doc_uuid = UUID(doc_id)
        except ValueError:
            return None

        async with async_session_factory() as session:
            row = await session.get(VectorEmbedding, doc_uuid)
            if row is None:
                return None

            return EmbeddingDocument(
                id=str(row.id),
                content=row.content,
                embedding_biomedical=list(row.embedding_biomedical) if row.embedding_biomedical is not None else None,
                embedding_general=list(row.embedding_general) if row.embedding_general is not None else None,
                metadata=row.metadata_ or {},
                source_type=row.source_type,
                source_id=row.source_id,
            )

    async def delete_document(self, doc_id: str) -> bool:
        """Delete a document by UUID string. Returns True if a row was deleted."""
        try:
            doc_uuid = UUID(doc_id)
        except ValueError:
            return False

        async with async_session_factory() as session:
            stmt = delete(VectorEmbedding).where(VectorEmbedding.id == doc_uuid)
            result = await session.execute(stmt)
            await session.commit()
            deleted = result.rowcount > 0

        if deleted:
            self.logger.debug("Document deleted", doc_id=doc_id)
        return deleted

    # ------------------------------------------------------------------
    # Statistics
    # ------------------------------------------------------------------

    async def get_stats(self) -> dict[str, Any]:
        """Return basic statistics about the vector store."""
        async with async_session_factory() as session:
            total = await session.scalar(select(func.count(VectorEmbedding.id)))
            bio_count = await session.scalar(
                select(func.count(VectorEmbedding.id)).where(
                    VectorEmbedding.embedding_biomedical.isnot(None)
                )
            )
            gen_count = await session.scalar(
                select(func.count(VectorEmbedding.id)).where(
                    VectorEmbedding.embedding_general.isnot(None)
                )
            )

            # Source type breakdown
            source_rows = await session.execute(
                select(
                    VectorEmbedding.source_type,
                    func.count(VectorEmbedding.id),
                ).group_by(VectorEmbedding.source_type)
            )
            by_source = {row[0] or "unknown": row[1] for row in source_rows}

        return {
            "document_count": total or 0,
            "biomedical_embeddings": bio_count or 0,
            "general_embeddings": gen_count or 0,
            "by_source_type": by_source,
            "biomedical_dimension": BIOMEDICAL_DIM,
            "general_dimension": GENERAL_DIM,
            "embedding_model_biomedical": settings.GROUNDING_EMBEDDING_PRIMARY,
            "embedding_model_general": settings.GROUNDING_EMBEDDING_SECONDARY,
            "initialized": self._initialized,
        }

    # ------------------------------------------------------------------
    # Migration helper
    # ------------------------------------------------------------------

    async def migrate_from_chromadb(
        self,
        documents: list[dict[str, Any]],
        batch_size: int = 500,
    ) -> dict[str, Any]:
        """Migrate documents exported from ChromaDB into pgvector.

        Each dict should contain at minimum:
            id, content, embedding (the old single-model embedding).
        Optionally: metadata, source_type, source_id.

        The old single-model embedding is stored as *embedding_biomedical*
        (padded / truncated to 1024-d) since the legacy model was closest in
        purpose. Callers should re-embed with the new dual models after
        migration.

        Returns:
            Migration summary dict.
        """
        migrated = 0
        skipped = 0
        errors: list[str] = []

        for start in range(0, len(documents), batch_size):
            batch = documents[start : start + batch_size]
            rows: list[VectorEmbedding] = []

            for doc in batch:
                try:
                    old_embedding = doc.get("embedding")
                    bio_embedding: list[float] | None = None

                    if old_embedding is not None:
                        # Pad or truncate to BIOMEDICAL_DIM
                        if len(old_embedding) >= BIOMEDICAL_DIM:
                            bio_embedding = old_embedding[:BIOMEDICAL_DIM]
                        else:
                            bio_embedding = old_embedding + [0.0] * (BIOMEDICAL_DIM - len(old_embedding))

                    doc_uuid = UUID(doc["id"]) if doc.get("id") else uuid4()
                    rows.append(
                        VectorEmbedding(
                            id=doc_uuid,
                            content=doc["content"],
                            embedding_biomedical=bio_embedding,
                            embedding_general=None,
                            metadata_=doc.get("metadata", {}),
                            source_type=doc.get("source_type", "chromadb_migration"),
                            source_id=doc.get("source_id"),
                        )
                    )
                    migrated += 1
                except Exception as exc:
                    skipped += 1
                    errors.append(f"Doc {doc.get('id', '?')}: {exc}")

            if rows:
                try:
                    async with async_session_factory() as session:
                        session.add_all(rows)
                        await session.commit()
                except Exception as exc:
                    self.logger.error("Batch insert failed during migration", error=str(exc))
                    errors.append(f"Batch starting at index {start}: {exc}")
                    skipped += len(rows)
                    migrated -= len(rows)

        summary = {
            "migrated": migrated,
            "skipped": skipped,
            "total": len(documents),
            "errors": errors[:50],  # cap error list
        }
        self.logger.info("ChromaDB migration completed", **summary)
        return summary


# ---------------------------------------------------------------------------
# Module-level convenience functions (public API)
# ---------------------------------------------------------------------------


async def init_vector_store() -> None:
    """Initialize the global vector store singleton."""
    global _vector_store
    _vector_store = VectorStore()
    await _vector_store.initialize()


def get_vector_store() -> VectorStore:
    """Return the global vector store instance.

    Raises:
        RuntimeError: If ``init_vector_store`` has not been called.
    """
    if _vector_store is None:
        raise RuntimeError("Vector store not initialized. Call init_vector_store() first.")
    return _vector_store


async def search_vectors(
    query: str,
    limit: int = 10,
    filters: dict[str, Any] | None = None,
    embedding_biomedical: list[float] | None = None,
    embedding_general: list[float] | None = None,
) -> list[SearchResult]:
    """Search the vector store using pre-computed query embeddings."""
    store = get_vector_store()
    return await store.search(
        query=query,
        limit=limit,
        filters=filters,
        embedding_biomedical=embedding_biomedical,
        embedding_general=embedding_general,
    )


async def find_similar(
    embedding_id: str,
    limit: int = 10,
) -> list[SearchResult]:
    """Find documents similar to an existing document (by ID).

    Uses whichever embeddings are available on the source document,
    preferring a hybrid search when both are present.
    """
    store = get_vector_store()
    doc = await store.get_document(embedding_id)

    if doc is None:
        return []

    bio = doc.embedding_biomedical
    gen = doc.embedding_general

    if bio is None and gen is None:
        return []

    return await store.search(
        query=None,
        limit=limit,
        embedding_biomedical=bio,
        embedding_general=gen,
    )
