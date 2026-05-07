"""
Hybrid Retriever Module

Combines vector search, knowledge graph traversal, and keyword matching
for comprehensive biomedical information retrieval.
"""

import asyncio
import re
from abc import ABC, abstractmethod
from dataclasses import dataclass
from enum import StrEnum
from typing import Any

from pydantic import BaseModel

from app.core.logging import LoggerMixin, get_logger

logger = get_logger(__name__)


class RetrievalStrategy(StrEnum):
    """Retrieval strategy options."""

    VECTOR_ONLY = "vector_only"
    GRAPH_ONLY = "graph_only"
    KEYWORD_ONLY = "keyword_only"
    HYBRID = "hybrid"
    HYBRID_WEIGHTED = "hybrid_weighted"


class SourceType(StrEnum):
    """Source type for retrieved content."""

    PUBMED = "pubmed"
    CLINICAL_TRIAL = "clinical_trial"
    PATENT = "patent"
    PREPRINT = "preprint"
    CUSTOM = "custom"
    GRAPH = "graph"


@dataclass
class RetrievalConfig:
    """Configuration for retrieval."""

    strategy: RetrievalStrategy = RetrievalStrategy.HYBRID
    top_k: int = 10
    min_score: float = 0.5

    # Vector search settings
    vector_weight: float = 0.5
    vector_limit: int = 20

    # Graph search settings
    graph_weight: float = 0.3
    graph_depth: int = 2
    graph_limit: int = 20

    # Keyword search settings
    keyword_weight: float = 0.2
    keyword_limit: int = 20

    # Filters
    source_types: list[SourceType] | None = None
    date_from: str | None = None
    date_to: str | None = None
    entity_types: list[str] | None = None


class RetrievedChunk(BaseModel):
    """A chunk of retrieved content."""

    id: str
    content: str
    score: float
    source: SourceType
    metadata: dict[str, Any] = {}

    # Retrieval provenance
    retrieval_method: str = "unknown"
    vector_score: float | None = None
    graph_score: float | None = None
    keyword_score: float | None = None

    # Entity mentions
    entities: list[str] = []
    relations: list[str] = []


class RetrievalResult(BaseModel):
    """Result of a retrieval operation."""

    query: str
    strategy: RetrievalStrategy
    chunks: list[RetrievedChunk]
    total_found: int

    # Search statistics
    vector_results: int = 0
    graph_results: int = 0
    keyword_results: int = 0

    # Timing
    search_time_ms: float = 0.0


class BaseRetriever(ABC, LoggerMixin):
    """Abstract base class for retrievers."""

    @abstractmethod
    async def retrieve(
        self,
        query: str,
        config: RetrievalConfig,
    ) -> list[RetrievedChunk]:
        """Retrieve relevant chunks for a query."""
        pass


class VectorRetriever(BaseRetriever):
    """Retriever using vector similarity search."""

    def __init__(self, vector_store=None, embedding_pipeline=None):
        self._vector_store = vector_store
        self._embedding_pipeline = embedding_pipeline

    async def retrieve(
        self,
        query: str,
        config: RetrievalConfig,
    ) -> list[RetrievedChunk]:
        """Retrieve using vector similarity."""
        if not self._vector_store or not self._embedding_pipeline:
            self.logger.warning("Vector retriever not fully initialized")
            return []

        try:
            # Get query embedding
            embedding = await self._embedding_pipeline.embed_for_retrieval(query)

            # Build filters from config
            filters = self._build_filters(config)

            # Search vector store
            from app.knowledge.vector_store import get_vector_store

            store = get_vector_store()
            results = await store.search(
                query=query,
                limit=config.vector_limit,
                filters=filters,
                min_score=config.min_score,
            )

            # Convert to RetrievedChunk
            chunks = []
            for result in results:
                chunk = RetrievedChunk(
                    id=result.id,
                    content=result.content,
                    score=result.score,
                    source=self._infer_source(result.metadata),
                    metadata=result.metadata,
                    retrieval_method="vector",
                    vector_score=result.score,
                )
                chunks.append(chunk)

            return chunks

        except Exception as e:
            self.logger.error("Vector retrieval failed", error=str(e))
            return []

    def _build_filters(self, config: RetrievalConfig) -> dict[str, Any] | None:
        """Build metadata filters from config."""
        filters = {}

        if config.source_types:
            filters["source"] = {"$in": [s.value for s in config.source_types]}

        if config.date_from:
            filters["date"] = {"$gte": config.date_from}

        if config.date_to:
            if "date" in filters:
                filters["date"]["$lte"] = config.date_to
            else:
                filters["date"] = {"$lte": config.date_to}

        return filters if filters else None

    def _infer_source(self, metadata: dict[str, Any]) -> SourceType:
        """Infer source type from metadata."""
        source = metadata.get("source", "custom")
        try:
            return SourceType(source)
        except ValueError:
            return SourceType.CUSTOM


class GraphRetriever(BaseRetriever):
    """Retriever using knowledge graph traversal."""

    def __init__(self, graph_store=None):
        self._graph_store = graph_store

    async def retrieve(
        self,
        query: str,
        config: RetrievalConfig,
    ) -> list[RetrievedChunk]:
        """Retrieve using graph traversal."""
        try:
            from app.knowledge.graph_store import get_graph_store

            store = get_graph_store()

            # Extract entities from query for graph lookup
            entities = await self._extract_query_entities(query)

            if not entities:
                return []

            chunks = []

            # For each entity, get neighborhood
            for entity_name in entities[:5]:  # Limit entity lookups
                # Search for entity
                found_entities = await store.search_entities(
                    query=entity_name,
                    entity_types=config.entity_types,
                    limit=3,
                )

                for entity in found_entities:
                    # Get neighborhood
                    neighborhood = await store.get_neighborhood(
                        entity_id=entity.id,
                        depth=config.graph_depth,
                        limit=config.graph_limit,
                    )

                    if neighborhood:
                        # Create chunk from entity and relations
                        content = self._format_entity_content(entity, neighborhood)
                        score = self._compute_graph_score(entity, neighborhood, query)

                        chunk = RetrievedChunk(
                            id=f"graph_{entity.id}",
                            content=content,
                            score=score,
                            source=SourceType.GRAPH,
                            metadata={
                                "entity_id": entity.id,
                                "entity_type": entity.entity_type,
                                "neighbor_count": len(neighborhood.entities),
                                "relation_count": len(neighborhood.relations),
                            },
                            retrieval_method="graph",
                            graph_score=score,
                            entities=[e.name for e in neighborhood.entities[:10]],
                            relations=[r.relation_type for r in neighborhood.relations[:10]],
                        )
                        chunks.append(chunk)

            # Sort by score and limit
            chunks.sort(key=lambda x: x.score, reverse=True)
            return chunks[: config.graph_limit]

        except Exception as e:
            self.logger.error("Graph retrieval failed", error=str(e))
            return []

    async def _extract_query_entities(self, query: str) -> list[str]:
        """Extract potential entity names from query."""
        # Simple extraction - split by common delimiters and filter
        words = re.split(r"[,\s]+", query)

        # Filter for potential entity names (capitalized or longer words)
        entities = []
        for word in words:
            word = word.strip("?.,!;:")
            if len(word) > 2:
                entities.append(word)

        return entities

    def _format_entity_content(self, entity, neighborhood) -> str:
        """Format entity and neighborhood as text content."""
        lines = [
            f"Entity: {entity.name} ({entity.entity_type})",
            f"Description: {entity.description or 'N/A'}",
            "",
            "Related entities:",
        ]

        for rel_entity in neighborhood.entities[:10]:
            if rel_entity.id != entity.id:
                lines.append(f"  - {rel_entity.name} ({rel_entity.entity_type})")

        if neighborhood.relations:
            lines.append("")
            lines.append("Relationships:")
            for rel in neighborhood.relations[:10]:
                lines.append(f"  - {rel.source_name} --[{rel.relation_type}]--> {rel.target_name}")

        return "\n".join(lines)

    def _compute_graph_score(self, entity, neighborhood, query: str) -> float:
        """Compute relevance score for graph result."""
        score = 0.5  # Base score

        # Boost if entity name matches query
        query_lower = query.lower()
        if entity.name.lower() in query_lower:
            score += 0.3
        elif any(alias.lower() in query_lower for alias in entity.aliases):
            score += 0.2

        # Boost for more connections
        connection_boost = min(0.2, len(neighborhood.relations) * 0.02)
        score += connection_boost

        return min(1.0, score)


class KeywordRetriever(BaseRetriever):
    """Retriever using keyword/BM25 search."""

    def __init__(self, index=None):
        self._index = index
        self._documents: dict[str, dict[str, Any]] = {}

    async def retrieve(
        self,
        query: str,
        config: RetrievalConfig,
    ) -> list[RetrievedChunk]:
        """Retrieve using keyword matching."""
        try:
            # Tokenize query
            query_terms = self._tokenize(query)

            if not query_terms:
                return []

            # Simple BM25-style scoring
            scored_docs: list[tuple[str, float, dict]] = []

            for doc_id, doc in self._documents.items():
                score = self._compute_bm25_score(
                    query_terms,
                    doc.get("content", ""),
                    doc.get("term_freqs", {}),
                )
                if score > 0:
                    scored_docs.append((doc_id, score, doc))

            # Sort and limit
            scored_docs.sort(key=lambda x: x[1], reverse=True)
            scored_docs = scored_docs[: config.keyword_limit]

            # Convert to chunks
            chunks = []
            for doc_id, score, doc in scored_docs:
                if score >= config.min_score:
                    chunk = RetrievedChunk(
                        id=doc_id,
                        content=doc.get("content", ""),
                        score=score,
                        source=self._infer_source(doc.get("metadata", {})),
                        metadata=doc.get("metadata", {}),
                        retrieval_method="keyword",
                        keyword_score=score,
                    )
                    chunks.append(chunk)

            return chunks

        except Exception as e:
            self.logger.error("Keyword retrieval failed", error=str(e))
            return []

    def _tokenize(self, text: str) -> list[str]:
        """Tokenize text into terms."""
        # Simple tokenization
        text = text.lower()
        tokens = re.findall(r"\b\w+\b", text)

        # Remove stopwords
        stopwords = {
            "the",
            "a",
            "an",
            "and",
            "or",
            "but",
            "in",
            "on",
            "at",
            "to",
            "for",
            "of",
            "with",
            "by",
            "from",
            "is",
            "are",
            "was",
            "were",
            "be",
            "been",
            "being",
            "have",
            "has",
            "had",
            "do",
            "does",
            "did",
            "will",
            "would",
            "could",
            "should",
            "may",
            "might",
            "must",
            "this",
            "that",
            "these",
            "those",
            "what",
            "which",
            "who",
            "whom",
        }

        return [t for t in tokens if t not in stopwords and len(t) > 2]

    def _compute_bm25_score(
        self,
        query_terms: list[str],
        content: str,
        term_freqs: dict[str, int],
    ) -> float:
        """Compute BM25-style relevance score."""
        k1 = 1.5
        b = 0.75
        avg_doc_len = 500  # Estimated average

        doc_len = len(content.split())
        score = 0.0

        content_lower = content.lower()

        for term in query_terms:
            tf = term_freqs.get(term, content_lower.count(term))

            if tf > 0:
                # Simplified BM25 formula
                idf = 1.0  # Would need corpus stats for proper IDF
                tf_component = (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (doc_len / avg_doc_len)))
                score += idf * tf_component

        # Normalize
        if score > 0:
            score = min(1.0, score / (len(query_terms) * 2))

        return score

    def _infer_source(self, metadata: dict[str, Any]) -> SourceType:
        """Infer source type from metadata."""
        source = metadata.get("source", "custom")
        try:
            return SourceType(source)
        except ValueError:
            return SourceType.CUSTOM

    def add_document(
        self,
        doc_id: str,
        content: str,
        metadata: dict[str, Any] = None,
    ) -> None:
        """Add a document to the keyword index."""
        terms = self._tokenize(content)
        term_freqs = {}
        for term in terms:
            term_freqs[term] = term_freqs.get(term, 0) + 1

        self._documents[doc_id] = {
            "content": content,
            "metadata": metadata or {},
            "term_freqs": term_freqs,
        }


class HybridRetriever(LoggerMixin):
    """
    Hybrid retriever combining vector, graph, and keyword search.

    Uses configurable weights to combine results from different
    retrieval methods for comprehensive coverage.
    """

    def __init__(
        self,
        vector_store=None,
        graph_store=None,
        embedding_pipeline=None,
    ):
        self._vector_retriever = VectorRetriever(vector_store, embedding_pipeline)
        self._graph_retriever = GraphRetriever(graph_store)
        self._keyword_retriever = KeywordRetriever()
        self._initialized = False

    async def initialize(self) -> None:
        """Initialize the hybrid retriever."""
        if self._initialized:
            return

        self.logger.info("Initializing hybrid retriever")
        self._initialized = True

    async def retrieve(
        self,
        query: str,
        config: RetrievalConfig | None = None,
    ) -> RetrievalResult:
        """
        Retrieve relevant content using hybrid search.

        Args:
            query: Search query
            config: Retrieval configuration

        Returns:
            RetrievalResult with ranked chunks
        """
        import time

        start_time = time.time()
        config = config or RetrievalConfig()

        # Execute retrieval based on strategy
        if config.strategy == RetrievalStrategy.VECTOR_ONLY:
            vector_chunks = await self._vector_retriever.retrieve(query, config)
            all_chunks = vector_chunks
            vector_count = len(vector_chunks)
            graph_count = 0
            keyword_count = 0

        elif config.strategy == RetrievalStrategy.GRAPH_ONLY:
            graph_chunks = await self._graph_retriever.retrieve(query, config)
            all_chunks = graph_chunks
            vector_count = 0
            graph_count = len(graph_chunks)
            keyword_count = 0

        elif config.strategy == RetrievalStrategy.KEYWORD_ONLY:
            keyword_chunks = await self._keyword_retriever.retrieve(query, config)
            all_chunks = keyword_chunks
            vector_count = 0
            graph_count = 0
            keyword_count = len(keyword_chunks)

        else:
            # Hybrid search - run all retrievers in parallel
            vector_task = self._vector_retriever.retrieve(query, config)
            graph_task = self._graph_retriever.retrieve(query, config)
            keyword_task = self._keyword_retriever.retrieve(query, config)

            vector_chunks, graph_chunks, keyword_chunks = await asyncio.gather(
                vector_task,
                graph_task,
                keyword_task,
                return_exceptions=True,
            )

            # Handle exceptions
            if isinstance(vector_chunks, Exception):
                self.logger.error("Vector retrieval error", error=str(vector_chunks))
                vector_chunks = []
            if isinstance(graph_chunks, Exception):
                self.logger.error("Graph retrieval error", error=str(graph_chunks))
                graph_chunks = []
            if isinstance(keyword_chunks, Exception):
                self.logger.error("Keyword retrieval error", error=str(keyword_chunks))
                keyword_chunks = []

            vector_count = len(vector_chunks)
            graph_count = len(graph_chunks)
            keyword_count = len(keyword_chunks)

            # Merge and deduplicate
            all_chunks = self._merge_results(
                vector_chunks,
                graph_chunks,
                keyword_chunks,
                config,
            )

        # Apply final ranking and limit
        all_chunks = self._rank_results(all_chunks, config)
        final_chunks = all_chunks[: config.top_k]

        search_time = (time.time() - start_time) * 1000

        return RetrievalResult(
            query=query,
            strategy=config.strategy,
            chunks=final_chunks,
            total_found=len(all_chunks),
            vector_results=vector_count,
            graph_results=graph_count,
            keyword_results=keyword_count,
            search_time_ms=search_time,
        )

    def _merge_results(
        self,
        vector_chunks: list[RetrievedChunk],
        graph_chunks: list[RetrievedChunk],
        keyword_chunks: list[RetrievedChunk],
        config: RetrievalConfig,
    ) -> list[RetrievedChunk]:
        """Merge results from different retrievers."""
        # Use dict to deduplicate by content hash
        merged: dict[str, RetrievedChunk] = {}

        # Process vector results
        for chunk in vector_chunks:
            key = self._content_key(chunk)
            if key not in merged:
                chunk.score = chunk.score * config.vector_weight
                merged[key] = chunk
            else:
                # Combine scores
                merged[key].vector_score = chunk.vector_score
                merged[key].score += chunk.score * config.vector_weight

        # Process graph results
        for chunk in graph_chunks:
            key = self._content_key(chunk)
            if key not in merged:
                chunk.score = chunk.score * config.graph_weight
                merged[key] = chunk
            else:
                merged[key].graph_score = chunk.graph_score
                merged[key].score += chunk.score * config.graph_weight
                # Merge entities
                merged[key].entities = list(set(merged[key].entities + chunk.entities))

        # Process keyword results
        for chunk in keyword_chunks:
            key = self._content_key(chunk)
            if key not in merged:
                chunk.score = chunk.score * config.keyword_weight
                merged[key] = chunk
            else:
                merged[key].keyword_score = chunk.keyword_score
                merged[key].score += chunk.score * config.keyword_weight

        return list(merged.values())

    def _content_key(self, chunk: RetrievedChunk) -> str:
        """Generate a key for deduplication."""
        # Use first 100 chars of content as key
        return chunk.content[:100].lower().strip()

    def _rank_results(
        self,
        chunks: list[RetrievedChunk],
        config: RetrievalConfig,
    ) -> list[RetrievedChunk]:
        """Rank merged results by final score."""
        # Apply boosting for multi-source hits
        for chunk in chunks:
            sources_hit = sum(
                [
                    1 if chunk.vector_score else 0,
                    1 if chunk.graph_score else 0,
                    1 if chunk.keyword_score else 0,
                ]
            )
            if sources_hit > 1:
                chunk.score *= 1 + 0.1 * sources_hit

        # Sort by score
        chunks.sort(key=lambda x: x.score, reverse=True)

        # Filter by minimum score
        chunks = [c for c in chunks if c.score >= config.min_score]

        return chunks

    def add_to_keyword_index(
        self,
        doc_id: str,
        content: str,
        metadata: dict[str, Any] = None,
    ) -> None:
        """Add a document to the keyword index."""
        self._keyword_retriever.add_document(doc_id, content, metadata)


# Factory function for creating configured retriever
def create_retriever(
    strategy: RetrievalStrategy = RetrievalStrategy.HYBRID,
) -> HybridRetriever:
    """Create a configured hybrid retriever."""
    return HybridRetriever()
