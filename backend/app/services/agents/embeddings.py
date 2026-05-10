"""Foundry embeddings client — wraps `text-embedding-3-large` and
`text-embedding-3-small` deployments behind a uniform async interface.

The pgvector layer in the discovery pipeline depends on a stable
`embed_texts(texts, model='large'|'small') -> list[list[float]]`
contract. This module is the single chokepoint that owns Azure-side
auth + endpoint normalization + dim assertions.

Why both deployments?
  • `large` (3072 dims) — primary RAG vectorizer. Used at ingest time
    over the full source corpus and at query time for top-k retrieval.
    Higher quality justifies the per-token cost on the production path.
  • `small` (1536 dims) — incremental sync paths and lightweight
    similarity probes (e.g. dedup checks during scrape). Cheaper and
    fast enough for high-throughput backfill.

Both deployments share the same Foundry v1 surface; routing happens
via the deployment-name parameter."""
from __future__ import annotations

import asyncio
from typing import Iterable, Literal


def _ensure_v1_path(url: str) -> str:
    u = url.rstrip("/")
    if u.endswith("/openai/v1"):
        return u
    if u.endswith("/openai"):
        return f"{u}/v1"
    return f"{u}/openai/v1"


# Hard-coded dim expectations. Used to assert the deployment is live
# at the right dimension before the caller writes to pgvector — a
# silent dim mismatch would corrupt the index without surfacing an
# error until similarity search returned garbage.
EXPECTED_DIMS: dict[str, int] = {
    "text-embedding-3-large": 3072,
    "text-embedding-3-small": 1536,
}


class FoundryEmbedder:
    """Async embeddings client against the Foundry v1 surface.

    Usage:
        embedder = FoundryEmbedder(
            base_url=settings.AZURE_AI_FOUNDRY_PROJECT_ENDPOINT,
            api_key=settings.azure_ai_foundry_key_value,
            large_deployment=settings.AZURE_FOUNDRY_DEPLOYMENT_EMBED_LARGE,
            small_deployment=settings.AZURE_FOUNDRY_DEPLOYMENT_EMBED_SMALL,
        )
        vecs = await embedder.embed_texts(["hello", "world"], model="large")
    """

    def __init__(
        self,
        *,
        base_url: str,
        api_key: str,
        large_deployment: str = "text-embedding-3-large",
        small_deployment: str = "text-embedding-3-small",
    ) -> None:
        if not base_url:
            raise ValueError("FoundryEmbedder requires base_url")
        if not api_key:
            raise ValueError("FoundryEmbedder requires api_key")
        self.base_url = _ensure_v1_path(base_url)
        self._api_key = api_key
        self.large_deployment = large_deployment
        self.small_deployment = small_deployment

    def _deployment_for(self, model: Literal["large", "small"]) -> str:
        return self.large_deployment if model == "large" else self.small_deployment

    async def embed_texts(
        self,
        texts: Iterable[str],
        *,
        model: Literal["large", "small"] = "large",
    ) -> list[list[float]]:
        """Embed a batch of strings, returning a list of float vectors
        in the same order. Raises if any vector's dimension doesn't
        match the expected value for the deployment — protects the
        downstream pgvector index from silent corruption."""
        try:
            from openai import AsyncOpenAI  # type: ignore
        except ImportError as e:
            raise RuntimeError("openai SDK not installed") from e

        deployment = self._deployment_for(model)
        client = AsyncOpenAI(base_url=self.base_url, api_key=self._api_key)
        text_list = [t for t in texts]
        if not text_list:
            return []
        resp = await client.embeddings.create(model=deployment, input=text_list)

        expected = EXPECTED_DIMS.get(deployment)
        vectors: list[list[float]] = []
        for item in resp.data:
            vec = list(item.embedding)
            if expected is not None and len(vec) != expected:
                raise ValueError(
                    f"Embedding dim mismatch for {deployment}: got {len(vec)}, expected {expected}"
                )
            vectors.append(vec)
        return vectors

    async def embed_one(
        self,
        text: str,
        *,
        model: Literal["large", "small"] = "large",
    ) -> list[float]:
        """Convenience: embed a single string."""
        vecs = await self.embed_texts([text], model=model)
        return vecs[0] if vecs else []
