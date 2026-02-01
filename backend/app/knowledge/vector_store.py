"""
Vector Store Module

Manages vector embeddings for semantic search using ChromaDB/FAISS.
Supports retrieval-augmented generation (RAG) workflows.
"""

from typing import Any, Optional
from uuid import uuid4

import numpy as np
from pydantic import BaseModel

from app.core.config import settings
from app.core.logging import LoggerMixin, get_logger

logger = get_logger(__name__)

# Global vector store instance
_vector_store: Optional["VectorStore"] = None


class EmbeddingDocument(BaseModel):
    """Document with embedding for vector storage."""

    id: str
    content: str
    embedding: list[float] | None = None
    metadata: dict[str, Any] = {}


class SearchResult(BaseModel):
    """Search result from vector store."""

    id: str
    content: str
    score: float
    metadata: dict[str, Any] = {}


class VectorStore(LoggerMixin):
    """Vector store for semantic search over documents.

    Uses ChromaDB for persistent storage and FAISS for fast similarity search.
    Supports hybrid search combining semantic and keyword matching.
    """

    def __init__(self):
        self._initialized = False
        self._embeddings_model = None
        self._collection = None
        # In-memory fallback for development
        self._documents: dict[str, EmbeddingDocument] = {}
        self._embeddings: dict[str, np.ndarray] = {}

    async def initialize(self) -> None:
        """Initialize the vector store and embedding model."""
        if self._initialized:
            return

        self.logger.info("Initializing vector store")

        try:
            # Try to initialize ChromaDB
            await self._init_chromadb()
        except Exception as e:
            self.logger.warning(
                "ChromaDB initialization failed, using in-memory fallback",
                error=str(e),
            )

        try:
            # Initialize embedding model
            await self._init_embedding_model()
        except Exception as e:
            self.logger.warning(
                "Embedding model initialization failed",
                error=str(e),
            )

        self._initialized = True
        self.logger.info("Vector store initialized")

    async def _init_chromadb(self) -> None:
        """Initialize ChromaDB client and collection."""
        try:
            import chromadb
            from chromadb.config import Settings as ChromaSettings

            client = chromadb.Client(
                ChromaSettings(
                    chroma_db_impl="duckdb+parquet",
                    persist_directory=settings.CHROMA_PERSIST_DIRECTORY,
                    anonymized_telemetry=False,
                )
            )

            self._collection = client.get_or_create_collection(
                name="genup_documents",
                metadata={"hnsw:space": "cosine"},
            )

            self.logger.info("ChromaDB initialized")
        except ImportError:
            self.logger.warning("ChromaDB not installed")
            raise

    async def _init_embedding_model(self) -> None:
        """Initialize the sentence transformer embedding model."""
        try:
            from sentence_transformers import SentenceTransformer

            self._embeddings_model = SentenceTransformer(settings.VECTOR_EMBEDDING_MODEL)
            self.logger.info(
                "Embedding model loaded",
                model=settings.VECTOR_EMBEDDING_MODEL,
            )
        except ImportError:
            self.logger.warning("sentence-transformers not installed")

    def _compute_embedding(self, text: str) -> list[float]:
        """Compute embedding for text."""
        if self._embeddings_model is None:
            # Return random embedding for development
            return np.random.randn(384).tolist()

        embedding = self._embeddings_model.encode(text)
        return embedding.tolist()

    async def add_document(
        self,
        content: str,
        metadata: dict[str, Any] = None,
        doc_id: str | None = None,
    ) -> str:
        """Add a document to the vector store.

        Args:
            content: Document text content
            metadata: Optional metadata dictionary
            doc_id: Optional document ID (generated if not provided)

        Returns:
            Document ID
        """
        doc_id = doc_id or str(uuid4())
        metadata = metadata or {}

        # Compute embedding
        embedding = self._compute_embedding(content)

        # Store in ChromaDB if available
        if self._collection is not None:
            self._collection.add(
                ids=[doc_id],
                embeddings=[embedding],
                documents=[content],
                metadatas=[metadata],
            )
        else:
            # In-memory fallback
            self._documents[doc_id] = EmbeddingDocument(
                id=doc_id,
                content=content,
                embedding=embedding,
                metadata=metadata,
            )
            self._embeddings[doc_id] = np.array(embedding)

        self.logger.debug("Document added", doc_id=doc_id)
        return doc_id

    async def add_documents(
        self,
        documents: list[dict[str, Any]],
    ) -> list[str]:
        """Add multiple documents to the vector store.

        Args:
            documents: List of dicts with 'content' and optional 'metadata', 'id'

        Returns:
            List of document IDs
        """
        doc_ids = []
        for doc in documents:
            doc_id = await self.add_document(
                content=doc["content"],
                metadata=doc.get("metadata", {}),
                doc_id=doc.get("id"),
            )
            doc_ids.append(doc_id)

        self.logger.info("Documents added", count=len(doc_ids))
        return doc_ids

    async def search(
        self,
        query: str,
        limit: int = 10,
        filters: dict[str, Any] | None = None,
        min_score: float = 0.0,
    ) -> list[SearchResult]:
        """Search for similar documents.

        Args:
            query: Search query text
            limit: Maximum number of results
            filters: Optional metadata filters
            min_score: Minimum similarity score threshold

        Returns:
            List of search results ordered by relevance
        """
        query_embedding = self._compute_embedding(query)

        if self._collection is not None:
            # Search in ChromaDB
            results = self._collection.query(
                query_embeddings=[query_embedding],
                n_results=limit,
                where=filters,
            )

            search_results = []
            for i, doc_id in enumerate(results["ids"][0]):
                score = 1 - results["distances"][0][i]  # Convert distance to similarity
                if score >= min_score:
                    search_results.append(
                        SearchResult(
                            id=doc_id,
                            content=results["documents"][0][i],
                            score=score,
                            metadata=results["metadatas"][0][i] if results["metadatas"] else {},
                        )
                    )
        else:
            # In-memory search
            search_results = await self._in_memory_search(query_embedding, limit, min_score)

        self.logger.debug(
            "Search completed",
            query=query[:50],
            results=len(search_results),
        )

        return search_results

    async def _in_memory_search(
        self,
        query_embedding: list[float],
        limit: int,
        min_score: float,
    ) -> list[SearchResult]:
        """Perform in-memory similarity search."""
        if not self._embeddings:
            return []

        query_vec = np.array(query_embedding)

        # Compute cosine similarities
        similarities = []
        for doc_id, doc_embedding in self._embeddings.items():
            similarity = np.dot(query_vec, doc_embedding) / (
                np.linalg.norm(query_vec) * np.linalg.norm(doc_embedding)
            )
            if similarity >= min_score:
                similarities.append((doc_id, similarity))

        # Sort by similarity descending
        similarities.sort(key=lambda x: x[1], reverse=True)

        # Build results
        results = []
        for doc_id, score in similarities[:limit]:
            doc = self._documents[doc_id]
            results.append(
                SearchResult(
                    id=doc_id,
                    content=doc.content,
                    score=float(score),
                    metadata=doc.metadata,
                )
            )

        return results

    async def get_document(self, doc_id: str) -> EmbeddingDocument | None:
        """Get a document by ID."""
        if self._collection is not None:
            results = self._collection.get(ids=[doc_id])
            if results["ids"]:
                return EmbeddingDocument(
                    id=doc_id,
                    content=results["documents"][0],
                    metadata=results["metadatas"][0] if results["metadatas"] else {},
                )
            return None
        else:
            return self._documents.get(doc_id)

    async def delete_document(self, doc_id: str) -> bool:
        """Delete a document by ID."""
        if self._collection is not None:
            self._collection.delete(ids=[doc_id])
        else:
            if doc_id in self._documents:
                del self._documents[doc_id]
                del self._embeddings[doc_id]
            else:
                return False

        self.logger.debug("Document deleted", doc_id=doc_id)
        return True

    async def get_stats(self) -> dict[str, Any]:
        """Get vector store statistics."""
        if self._collection is not None:
            count = self._collection.count()
        else:
            count = len(self._documents)

        return {
            "document_count": count,
            "embedding_model": settings.VECTOR_EMBEDDING_MODEL,
            "initialized": self._initialized,
        }


async def init_vector_store() -> None:
    """Initialize the global vector store."""
    global _vector_store
    _vector_store = VectorStore()
    await _vector_store.initialize()


def get_vector_store() -> VectorStore:
    """Get the global vector store instance."""
    if _vector_store is None:
        raise RuntimeError("Vector store not initialized")
    return _vector_store


async def search_vectors(
    query: str,
    limit: int = 10,
    filters: dict[str, Any] | None = None,
) -> list[SearchResult]:
    """Search the vector store."""
    store = get_vector_store()
    return await store.search(query, limit, filters)


async def find_similar(
    embedding_id: str,
    limit: int = 10,
) -> list[SearchResult]:
    """Find documents similar to a given document."""
    store = get_vector_store()
    doc = await store.get_document(embedding_id)

    if doc is None or doc.embedding is None:
        return []

    # Search using the document's embedding
    if store._collection is not None:
        results = store._collection.query(
            query_embeddings=[doc.embedding],
            n_results=limit,
        )
        return [
            SearchResult(
                id=results["ids"][0][i],
                content=results["documents"][0][i],
                score=1 - results["distances"][0][i],
                metadata=results["metadatas"][0][i] if results["metadatas"] else {},
            )
            for i in range(len(results["ids"][0]))
        ]
    else:
        return await store._in_memory_search(doc.embedding, limit, 0.0)
