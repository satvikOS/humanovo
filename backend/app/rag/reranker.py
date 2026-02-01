"""
Reranker Module

Re-ranks retrieved documents using cross-encoder models and
multi-factor relevance scoring for improved precision.
"""

import asyncio
from abc import ABC, abstractmethod
from dataclasses import dataclass
from enum import Enum

from pydantic import BaseModel

from app.core.config import settings
from app.core.logging import LoggerMixin, get_logger
from app.rag.retriever import RetrievedChunk

logger = get_logger(__name__)


class RerankerModel(str, Enum):
    """Supported reranker models."""

    # Cross-encoder models
    MS_MARCO = "cross-encoder/ms-marco-MiniLM-L-6-v2"
    MS_MARCO_LARGE = "cross-encoder/ms-marco-electra-base"

    # Biomedical
    BIOBERT_RERANKER = "amberoad/bert-multilingual-passage-reranking-msmarco"

    # Cohere
    COHERE_RERANK = "rerank-english-v3.0"

    # OpenAI (using GPT for reranking)
    OPENAI_RERANK = "gpt-4-turbo-preview"

    # Simple (no model)
    SIMPLE = "simple"


@dataclass
class RerankerConfig:
    """Configuration for reranker."""

    model: RerankerModel = RerankerModel.SIMPLE
    top_k: int = 10
    batch_size: int = 16

    # Scoring weights
    relevance_weight: float = 0.6
    recency_weight: float = 0.15
    source_quality_weight: float = 0.15
    entity_coverage_weight: float = 0.1

    # Thresholds
    min_score: float = 0.3
    diversity_threshold: float = 0.8


class RerankedResult(BaseModel):
    """Result after reranking."""

    chunk: RetrievedChunk
    original_rank: int
    new_rank: int
    rerank_score: float
    relevance_score: float
    recency_score: float
    source_quality_score: float
    entity_coverage_score: float


class RerankerOutput(BaseModel):
    """Output from reranking operation."""

    query: str
    results: list[RerankedResult]
    total_reranked: int
    model_used: str
    rerank_time_ms: float


class BaseReranker(ABC, LoggerMixin):
    """Abstract base class for rerankers."""

    def __init__(self, config: RerankerConfig):
        self.config = config
        self._initialized = False

    @abstractmethod
    async def initialize(self) -> None:
        """Initialize the reranker."""
        pass

    @abstractmethod
    async def compute_relevance(
        self,
        query: str,
        chunks: list[RetrievedChunk],
    ) -> list[float]:
        """Compute relevance scores for chunks."""
        pass


class CrossEncoderReranker(BaseReranker):
    """Reranker using cross-encoder models."""

    def __init__(self, config: RerankerConfig):
        super().__init__(config)
        self._model = None

    async def initialize(self) -> None:
        """Initialize cross-encoder model."""
        if self._initialized:
            return

        try:
            from sentence_transformers import CrossEncoder

            self._model = CrossEncoder(self.config.model.value)
            self._initialized = True
            self.logger.info(
                "CrossEncoder reranker initialized",
                model=self.config.model.value,
            )
        except ImportError:
            self.logger.error("sentence-transformers not installed")
            raise

    async def compute_relevance(
        self,
        query: str,
        chunks: list[RetrievedChunk],
    ) -> list[float]:
        """Compute relevance using cross-encoder."""
        if not self._initialized:
            await self.initialize()

        # Prepare pairs
        pairs = [(query, chunk.content) for chunk in chunks]

        # Score in batches
        all_scores = []
        for i in range(0, len(pairs), self.config.batch_size):
            batch = pairs[i : i + self.config.batch_size]
            scores = self._model.predict(batch)
            all_scores.extend(scores.tolist())

        # Normalize to [0, 1]
        min_score = min(all_scores) if all_scores else 0
        max_score = max(all_scores) if all_scores else 1
        score_range = max_score - min_score

        if score_range > 0:
            all_scores = [(s - min_score) / score_range for s in all_scores]
        else:
            all_scores = [0.5] * len(all_scores)

        return all_scores


class LLMReranker(BaseReranker):
    """Reranker using LLM for relevance judgment."""

    def __init__(self, config: RerankerConfig):
        super().__init__(config)
        self._client = None

    async def initialize(self) -> None:
        """Initialize LLM client."""
        if self._initialized:
            return

        try:
            from openai import AsyncOpenAI

            self._client = AsyncOpenAI(api_key=settings.openai_api_key_value)
            self._initialized = True
            self.logger.info("LLM reranker initialized")
        except ImportError:
            self.logger.error("openai package not installed")
            raise

    async def compute_relevance(
        self,
        query: str,
        chunks: list[RetrievedChunk],
    ) -> list[float]:
        """Compute relevance using LLM."""
        if not self._initialized:
            await self.initialize()

        scores = []

        # Score chunks in parallel (limited concurrency)
        semaphore = asyncio.Semaphore(5)

        async def score_chunk(chunk: RetrievedChunk) -> float:
            async with semaphore:
                return await self._score_single(query, chunk)

        tasks = [score_chunk(chunk) for chunk in chunks]
        scores = await asyncio.gather(*tasks)

        return list(scores)

    async def _score_single(
        self,
        query: str,
        chunk: RetrievedChunk,
    ) -> float:
        """Score a single chunk using LLM."""
        prompt = f"""Rate the relevance of the following passage to the query on a scale of 0-10.
Only respond with a single number.

Query: {query}

Passage: {chunk.content[:1000]}

Relevance score (0-10):"""

        try:
            response = await self._client.chat.completions.create(
                model=self.config.model.value,
                messages=[{"role": "user", "content": prompt}],
                max_tokens=5,
                temperature=0,
            )

            score_text = response.choices[0].message.content.strip()
            score = float(score_text) / 10.0
            return max(0.0, min(1.0, score))

        except Exception as e:
            self.logger.warning("LLM scoring failed", error=str(e))
            return 0.5


class SimpleReranker(BaseReranker):
    """Simple rule-based reranker without ML models."""

    async def initialize(self) -> None:
        """No initialization needed."""
        self._initialized = True

    async def compute_relevance(
        self,
        query: str,
        chunks: list[RetrievedChunk],
    ) -> list[float]:
        """Compute relevance using simple heuristics."""
        query_terms = set(query.lower().split())
        scores = []

        for chunk in chunks:
            content_lower = chunk.content.lower()

            # Term overlap score
            content_terms = set(content_lower.split())
            overlap = len(query_terms & content_terms)
            term_score = overlap / max(len(query_terms), 1)

            # Exact phrase match bonus
            phrase_score = 0.2 if query.lower() in content_lower else 0.0

            # Length penalty (prefer medium length)
            length = len(chunk.content)
            if 100 < length < 2000:
                length_score = 0.1
            else:
                length_score = 0.0

            total = min(1.0, term_score * 0.6 + phrase_score + length_score + chunk.score * 0.2)
            scores.append(total)

        return scores


class Reranker(LoggerMixin):
    """
    Multi-factor reranker for retrieved documents.

    Combines model-based relevance scoring with additional
    factors like recency, source quality, and entity coverage.
    """

    def __init__(self, config: RerankerConfig | None = None):
        self.config = config or RerankerConfig()
        self._base_reranker: BaseReranker | None = None
        self._initialized = False

    async def initialize(self) -> None:
        """Initialize the reranker."""
        if self._initialized:
            return

        # Create base reranker based on model
        if self.config.model == RerankerModel.SIMPLE:
            self._base_reranker = SimpleReranker(self.config)
        elif self.config.model in [RerankerModel.MS_MARCO, RerankerModel.MS_MARCO_LARGE]:
            self._base_reranker = CrossEncoderReranker(self.config)
        elif self.config.model == RerankerModel.OPENAI_RERANK:
            self._base_reranker = LLMReranker(self.config)
        else:
            self._base_reranker = SimpleReranker(self.config)

        try:
            await self._base_reranker.initialize()
        except Exception as e:
            self.logger.warning(
                "Base reranker initialization failed, using simple",
                error=str(e),
            )
            self._base_reranker = SimpleReranker(self.config)
            await self._base_reranker.initialize()

        self._initialized = True
        self.logger.info("Reranker initialized", model=self.config.model.value)

    async def rerank(
        self,
        query: str,
        chunks: list[RetrievedChunk],
        query_entities: list[str] | None = None,
    ) -> RerankerOutput:
        """
        Rerank retrieved chunks using multi-factor scoring.

        Args:
            query: Original query
            chunks: Retrieved chunks to rerank
            query_entities: Optional list of entities from query

        Returns:
            RerankerOutput with reranked results
        """
        import time

        start_time = time.time()

        if not self._initialized:
            await self.initialize()

        if not chunks:
            return RerankerOutput(
                query=query,
                results=[],
                total_reranked=0,
                model_used=self.config.model.value,
                rerank_time_ms=0.0,
            )

        # Compute base relevance scores
        relevance_scores = await self._base_reranker.compute_relevance(query, chunks)

        # Compute additional factor scores
        recency_scores = self._compute_recency_scores(chunks)
        source_scores = self._compute_source_quality_scores(chunks)
        entity_scores = self._compute_entity_coverage_scores(chunks, query_entities or [])

        # Combine scores
        results: list[RerankedResult] = []
        for i, chunk in enumerate(chunks):
            relevance = relevance_scores[i]
            recency = recency_scores[i]
            source_quality = source_scores[i]
            entity_coverage = entity_scores[i]

            # Weighted combination
            final_score = (
                relevance * self.config.relevance_weight
                + recency * self.config.recency_weight
                + source_quality * self.config.source_quality_weight
                + entity_coverage * self.config.entity_coverage_weight
            )

            results.append(
                RerankedResult(
                    chunk=chunk,
                    original_rank=i + 1,
                    new_rank=0,  # Will be set after sorting
                    rerank_score=final_score,
                    relevance_score=relevance,
                    recency_score=recency,
                    source_quality_score=source_quality,
                    entity_coverage_score=entity_coverage,
                )
            )

        # Sort by final score
        results.sort(key=lambda x: x.rerank_score, reverse=True)

        # Apply diversity filter
        results = self._apply_diversity_filter(results)

        # Assign new ranks and filter by threshold
        final_results = []
        for i, result in enumerate(results):
            if result.rerank_score >= self.config.min_score:
                result.new_rank = i + 1
                final_results.append(result)

            if len(final_results) >= self.config.top_k:
                break

        rerank_time = (time.time() - start_time) * 1000

        return RerankerOutput(
            query=query,
            results=final_results,
            total_reranked=len(chunks),
            model_used=self.config.model.value,
            rerank_time_ms=rerank_time,
        )

    def _compute_recency_scores(
        self,
        chunks: list[RetrievedChunk],
    ) -> list[float]:
        """Compute recency scores based on publication date."""
        from datetime import datetime

        scores = []
        current_year = datetime.now().year

        for chunk in chunks:
            date_str = chunk.metadata.get("date") or chunk.metadata.get("publication_date")

            if date_str:
                try:
                    # Parse year from date
                    if isinstance(date_str, str):
                        year = int(date_str[:4])
                    else:
                        year = date_str.year

                    # Score based on age (newer = higher)
                    age = current_year - year
                    score = max(0.0, 1.0 - (age * 0.1))  # -0.1 per year
                except (ValueError, AttributeError):
                    score = 0.5
            else:
                score = 0.5  # Default for unknown date

            scores.append(score)

        return scores

    def _compute_source_quality_scores(
        self,
        chunks: list[RetrievedChunk],
    ) -> list[float]:
        """Compute source quality scores."""
        source_quality = {
            "pubmed": 0.9,
            "clinical_trial": 0.85,
            "patent": 0.7,
            "preprint": 0.6,
            "graph": 0.8,
            "custom": 0.5,
        }

        scores = []
        for chunk in chunks:
            source = chunk.source.value if hasattr(chunk.source, "value") else str(chunk.source)
            score = source_quality.get(source, 0.5)

            # Boost for citations
            citations = chunk.metadata.get("citation_count", 0)
            if citations > 100:
                score = min(1.0, score + 0.1)
            elif citations > 10:
                score = min(1.0, score + 0.05)

            scores.append(score)

        return scores

    def _compute_entity_coverage_scores(
        self,
        chunks: list[RetrievedChunk],
        query_entities: list[str],
    ) -> list[float]:
        """Compute entity coverage scores."""
        if not query_entities:
            return [0.5] * len(chunks)

        query_entities_lower = set(e.lower() for e in query_entities)
        scores = []

        for chunk in chunks:
            # Check entities in chunk
            chunk_entities = set(e.lower() for e in chunk.entities)
            content_lower = chunk.content.lower()

            # Direct entity match
            matches = len(query_entities_lower & chunk_entities)

            # Content mention
            mentions = sum(1 for e in query_entities_lower if e in content_lower)

            # Combined score
            score = (matches + mentions * 0.5) / max(len(query_entities), 1)
            scores.append(min(1.0, score))

        return scores

    def _apply_diversity_filter(
        self,
        results: list[RerankedResult],
    ) -> list[RerankedResult]:
        """Filter results for diversity (reduce redundancy)."""
        if not results:
            return results

        filtered = [results[0]]

        for result in results[1:]:
            # Check similarity with already selected results
            is_diverse = True
            for selected in filtered:
                similarity = self._compute_content_similarity(
                    result.chunk.content,
                    selected.chunk.content,
                )
                if similarity > self.config.diversity_threshold:
                    is_diverse = False
                    break

            if is_diverse:
                filtered.append(result)

        return filtered

    def _compute_content_similarity(
        self,
        content1: str,
        content2: str,
    ) -> float:
        """Compute simple content similarity (Jaccard)."""
        words1 = set(content1.lower().split())
        words2 = set(content2.lower().split())

        if not words1 or not words2:
            return 0.0

        intersection = len(words1 & words2)
        union = len(words1 | words2)

        return intersection / union if union > 0 else 0.0


# Global reranker instance
_reranker: Reranker | None = None


async def init_reranker(config: RerankerConfig | None = None) -> None:
    """Initialize the global reranker."""
    global _reranker
    _reranker = Reranker(config)
    await _reranker.initialize()


def get_reranker() -> Reranker:
    """Get the global reranker instance."""
    if _reranker is None:
        raise RuntimeError("Reranker not initialized")
    return _reranker
