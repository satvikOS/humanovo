"""
Embedding Pipeline Module

Multi-model embedding pipeline supporting various embedding models
for biomedical text processing with caching and batch processing.
"""

import hashlib
from abc import ABC, abstractmethod
from dataclasses import dataclass
from enum import Enum
from typing import Any, Optional

import numpy as np
from pydantic import BaseModel

from app.core.config import settings
from app.core.logging import LoggerMixin, get_logger

logger = get_logger(__name__)

# Global embedding pipeline instance
_embedding_pipeline: Optional["EmbeddingPipeline"] = None


class EmbeddingModel(str, Enum):
    """Supported embedding models."""

    # General purpose
    MINILM = "all-MiniLM-L6-v2"
    MPNET = "all-mpnet-base-v2"

    # Biomedical specialized
    PUBMEDBERT = "microsoft/BiomedNLP-PubMedBERT-base-uncased-abstract"
    BIOBERT = "dmis-lab/biobert-base-cased-v1.2"
    SCIBERT = "allenai/scibert_scivocab_uncased"

    # OpenAI
    OPENAI_SMALL = "text-embedding-3-small"
    OPENAI_LARGE = "text-embedding-3-large"

    # Cohere
    COHERE_ENGLISH = "embed-english-v3.0"
    COHERE_MULTILINGUAL = "embed-multilingual-v3.0"


@dataclass
class EmbeddingConfig:
    """Configuration for embedding model."""

    model: EmbeddingModel = EmbeddingModel.MINILM
    dimension: int = 384
    batch_size: int = 32
    max_length: int = 512
    normalize: bool = True
    cache_embeddings: bool = True

    # Model-specific settings
    device: str = "cpu"
    use_gpu: bool = False

    @classmethod
    def for_model(cls, model: EmbeddingModel) -> "EmbeddingConfig":
        """Get default config for a model."""
        dimensions = {
            EmbeddingModel.MINILM: 384,
            EmbeddingModel.MPNET: 768,
            EmbeddingModel.PUBMEDBERT: 768,
            EmbeddingModel.BIOBERT: 768,
            EmbeddingModel.SCIBERT: 768,
            EmbeddingModel.OPENAI_SMALL: 1536,
            EmbeddingModel.OPENAI_LARGE: 3072,
            EmbeddingModel.COHERE_ENGLISH: 1024,
            EmbeddingModel.COHERE_MULTILINGUAL: 1024,
        }
        return cls(model=model, dimension=dimensions.get(model, 768))


class EmbeddingResult(BaseModel):
    """Result of embedding operation."""

    text: str
    embedding: list[float]
    model: str
    dimension: int
    metadata: dict[str, Any] = {}


class BaseEmbedder(ABC, LoggerMixin):
    """Abstract base class for embedders."""

    def __init__(self, config: EmbeddingConfig):
        self.config = config
        self._initialized = False

    @abstractmethod
    async def initialize(self) -> None:
        """Initialize the embedding model."""
        pass

    @abstractmethod
    async def embed(self, text: str) -> list[float]:
        """Embed a single text."""
        pass

    @abstractmethod
    async def embed_batch(self, texts: list[str]) -> list[list[float]]:
        """Embed a batch of texts."""
        pass

    @property
    @abstractmethod
    def dimension(self) -> int:
        """Get embedding dimension."""
        pass


class SentenceTransformerEmbedder(BaseEmbedder):
    """Embedder using sentence-transformers library."""

    def __init__(self, config: EmbeddingConfig):
        super().__init__(config)
        self._model = None

    async def initialize(self) -> None:
        """Initialize the sentence transformer model."""
        if self._initialized:
            return

        try:
            from sentence_transformers import SentenceTransformer

            self._model = SentenceTransformer(
                self.config.model.value,
                device=self.config.device,
            )
            self._initialized = True
            self.logger.info(
                "SentenceTransformer initialized",
                model=self.config.model.value,
            )
        except ImportError:
            self.logger.error("sentence-transformers not installed")
            raise

    async def embed(self, text: str) -> list[float]:
        """Embed a single text."""
        if not self._initialized:
            await self.initialize()

        embedding = self._model.encode(
            text,
            normalize_embeddings=self.config.normalize,
            show_progress_bar=False,
        )
        return embedding.tolist()

    async def embed_batch(self, texts: list[str]) -> list[list[float]]:
        """Embed a batch of texts."""
        if not self._initialized:
            await self.initialize()

        embeddings = self._model.encode(
            texts,
            batch_size=self.config.batch_size,
            normalize_embeddings=self.config.normalize,
            show_progress_bar=False,
        )
        return embeddings.tolist()

    @property
    def dimension(self) -> int:
        """Get embedding dimension."""
        return self.config.dimension


class OpenAIEmbedder(BaseEmbedder):
    """Embedder using OpenAI API."""

    def __init__(self, config: EmbeddingConfig):
        super().__init__(config)
        self._client = None

    async def initialize(self) -> None:
        """Initialize the OpenAI client."""
        if self._initialized:
            return

        try:
            from openai import AsyncOpenAI

            self._client = AsyncOpenAI(api_key=settings.openai_api_key_value)
            self._initialized = True
            self.logger.info(
                "OpenAI embedder initialized",
                model=self.config.model.value,
            )
        except ImportError:
            self.logger.error("openai package not installed")
            raise

    async def embed(self, text: str) -> list[float]:
        """Embed a single text using OpenAI."""
        if not self._initialized:
            await self.initialize()

        response = await self._client.embeddings.create(
            input=text,
            model=self.config.model.value,
        )
        return response.data[0].embedding

    async def embed_batch(self, texts: list[str]) -> list[list[float]]:
        """Embed a batch of texts using OpenAI."""
        if not self._initialized:
            await self.initialize()

        # OpenAI supports batching natively
        response = await self._client.embeddings.create(
            input=texts,
            model=self.config.model.value,
        )

        # Sort by index to maintain order
        embeddings = sorted(response.data, key=lambda x: x.index)
        return [e.embedding for e in embeddings]

    @property
    def dimension(self) -> int:
        """Get embedding dimension."""
        return self.config.dimension


class EmbeddingCache:
    """Simple in-memory cache for embeddings."""

    def __init__(self, max_size: int = 10000):
        self._cache: dict[str, list[float]] = {}
        self._max_size = max_size
        self._access_order: list[str] = []

    def _get_key(self, text: str, model: str) -> str:
        """Generate cache key."""
        content = f"{model}:{text}"
        return hashlib.md5(content.encode()).hexdigest()

    def get(self, text: str, model: str) -> list[float] | None:
        """Get cached embedding."""
        key = self._get_key(text, model)
        if key in self._cache:
            # Update access order (LRU)
            self._access_order.remove(key)
            self._access_order.append(key)
            return self._cache[key]
        return None

    def set(self, text: str, model: str, embedding: list[float]) -> None:
        """Cache an embedding."""
        key = self._get_key(text, model)

        # Evict oldest if at capacity
        while len(self._cache) >= self._max_size and self._access_order:
            oldest = self._access_order.pop(0)
            self._cache.pop(oldest, None)

        self._cache[key] = embedding
        self._access_order.append(key)

    def clear(self) -> None:
        """Clear the cache."""
        self._cache.clear()
        self._access_order.clear()

    @property
    def size(self) -> int:
        """Get cache size."""
        return len(self._cache)


class EmbeddingPipeline(LoggerMixin):
    """
    Multi-model embedding pipeline with caching and batch processing.

    Supports multiple embedding models and can switch between them
    based on the use case (general vs biomedical text).
    """

    def __init__(
        self,
        default_model: EmbeddingModel = EmbeddingModel.MINILM,
        cache_enabled: bool = True,
        cache_size: int = 10000,
    ):
        self._default_model = default_model
        self._embedders: dict[EmbeddingModel, BaseEmbedder] = {}
        self._cache = EmbeddingCache(cache_size) if cache_enabled else None
        self._initialized = False

    async def initialize(
        self,
        models: list[EmbeddingModel] | None = None,
    ) -> None:
        """Initialize the embedding pipeline with specified models."""
        if self._initialized:
            return

        models = models or [self._default_model]

        for model in models:
            try:
                embedder = self._create_embedder(model)
                await embedder.initialize()
                self._embedders[model] = embedder
                self.logger.info("Embedder initialized", model=model.value)
            except Exception as e:
                self.logger.warning(
                    "Failed to initialize embedder",
                    model=model.value,
                    error=str(e),
                )

        if not self._embedders:
            # Create fallback random embedder
            self.logger.warning("No embedders initialized, using fallback")

        self._initialized = True
        self.logger.info(
            "Embedding pipeline initialized",
            models=[m.value for m in self._embedders.keys()],
        )

    def _create_embedder(self, model: EmbeddingModel) -> BaseEmbedder:
        """Create an embedder for the specified model."""
        config = EmbeddingConfig.for_model(model)

        if model in [EmbeddingModel.OPENAI_SMALL, EmbeddingModel.OPENAI_LARGE]:
            return OpenAIEmbedder(config)
        else:
            return SentenceTransformerEmbedder(config)

    def _get_embedder(
        self,
        model: EmbeddingModel | None = None,
    ) -> BaseEmbedder | None:
        """Get embedder for specified or default model."""
        model = model or self._default_model
        return self._embedders.get(model)

    async def embed(
        self,
        text: str,
        model: EmbeddingModel | None = None,
        use_cache: bool = True,
    ) -> EmbeddingResult:
        """
        Embed a single text.

        Args:
            text: Text to embed
            model: Optional model override
            use_cache: Whether to use caching

        Returns:
            EmbeddingResult with embedding vector
        """
        model = model or self._default_model

        # Check cache
        if use_cache and self._cache:
            cached = self._cache.get(text, model.value)
            if cached is not None:
                return EmbeddingResult(
                    text=text,
                    embedding=cached,
                    model=model.value,
                    dimension=len(cached),
                    metadata={"cached": True},
                )

        # Get embedder
        embedder = self._get_embedder(model)
        if embedder is None:
            # Fallback to random embedding
            embedding = np.random.randn(384).tolist()
            return EmbeddingResult(
                text=text,
                embedding=embedding,
                model="fallback",
                dimension=384,
                metadata={"fallback": True},
            )

        # Compute embedding
        embedding = await embedder.embed(text)

        # Cache result
        if use_cache and self._cache:
            self._cache.set(text, model.value, embedding)

        return EmbeddingResult(
            text=text,
            embedding=embedding,
            model=model.value,
            dimension=embedder.dimension,
        )

    async def embed_batch(
        self,
        texts: list[str],
        model: EmbeddingModel | None = None,
        use_cache: bool = True,
    ) -> list[EmbeddingResult]:
        """
        Embed a batch of texts efficiently.

        Args:
            texts: List of texts to embed
            model: Optional model override
            use_cache: Whether to use caching

        Returns:
            List of EmbeddingResult objects
        """
        model = model or self._default_model
        results: list[EmbeddingResult] = [None] * len(texts)
        texts_to_embed: list[tuple[int, str]] = []

        # Check cache for each text
        for i, text in enumerate(texts):
            if use_cache and self._cache:
                cached = self._cache.get(text, model.value)
                if cached is not None:
                    results[i] = EmbeddingResult(
                        text=text,
                        embedding=cached,
                        model=model.value,
                        dimension=len(cached),
                        metadata={"cached": True},
                    )
                    continue
            texts_to_embed.append((i, text))

        # Embed uncached texts
        if texts_to_embed:
            embedder = self._get_embedder(model)
            if embedder:
                uncached_texts = [t for _, t in texts_to_embed]
                embeddings = await embedder.embed_batch(uncached_texts)

                for (i, text), embedding in zip(texts_to_embed, embeddings):
                    results[i] = EmbeddingResult(
                        text=text,
                        embedding=embedding,
                        model=model.value,
                        dimension=embedder.dimension,
                    )

                    # Cache result
                    if use_cache and self._cache:
                        self._cache.set(text, model.value, embedding)
            else:
                # Fallback
                for i, text in texts_to_embed:
                    embedding = np.random.randn(384).tolist()
                    results[i] = EmbeddingResult(
                        text=text,
                        embedding=embedding,
                        model="fallback",
                        dimension=384,
                        metadata={"fallback": True},
                    )

        return results

    async def embed_for_retrieval(
        self,
        query: str,
        model: EmbeddingModel | None = None,
    ) -> list[float]:
        """
        Embed a query for retrieval (returns just the vector).

        Args:
            query: Query text
            model: Optional model override

        Returns:
            Embedding vector as list of floats
        """
        result = await self.embed(query, model=model)
        return result.embedding

    def get_dimension(self, model: EmbeddingModel | None = None) -> int:
        """Get embedding dimension for a model."""
        model = model or self._default_model
        embedder = self._get_embedder(model)
        if embedder:
            return embedder.dimension
        return 384  # Default fallback dimension

    @property
    def available_models(self) -> list[str]:
        """Get list of initialized models."""
        return [m.value for m in self._embedders.keys()]

    @property
    def cache_stats(self) -> dict[str, Any]:
        """Get cache statistics."""
        if self._cache:
            return {
                "enabled": True,
                "size": self._cache.size,
            }
        return {"enabled": False, "size": 0}

    def clear_cache(self) -> None:
        """Clear the embedding cache."""
        if self._cache:
            self._cache.clear()


async def init_embedding_pipeline(
    models: list[EmbeddingModel] | None = None,
) -> None:
    """Initialize the global embedding pipeline."""
    global _embedding_pipeline
    _embedding_pipeline = EmbeddingPipeline()
    await _embedding_pipeline.initialize(models)


def get_embedding_pipeline() -> EmbeddingPipeline:
    """Get the global embedding pipeline instance."""
    if _embedding_pipeline is None:
        raise RuntimeError("Embedding pipeline not initialized")
    return _embedding_pipeline
