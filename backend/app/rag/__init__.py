"""
GenUp RAG (Retrieval-Augmented Generation) Module

Unified RAG service combining vector search, knowledge graph traversal,
and keyword matching for comprehensive biomedical information retrieval.
Connected to multiple ingestion agents for continuous data acquisition.
"""

from app.rag.chunker import ChunkingStrategy, DocumentChunker
from app.rag.embeddings import EmbeddingPipeline, get_embedding_pipeline
from app.rag.reranker import Reranker, RerankerConfig
from app.rag.retriever import HybridRetriever, RetrievalStrategy
from app.rag.service import RAGService, get_rag_service, init_rag_service

__all__ = [
    # Core service
    "RAGService",
    "get_rag_service",
    "init_rag_service",
    # Embeddings
    "EmbeddingPipeline",
    "get_embedding_pipeline",
    # Retrieval
    "HybridRetriever",
    "RetrievalStrategy",
    # Reranking
    "Reranker",
    "RerankerConfig",
    # Chunking
    "DocumentChunker",
    "ChunkingStrategy",
]
