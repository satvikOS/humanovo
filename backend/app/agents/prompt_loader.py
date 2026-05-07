"""
PromptLoader: backend-agnostic, versioned prompt fetcher with TTL cache
and graceful degradation.

Built ahead of removing inline prompts from source control. Resolves prompts
by stable ID through a pluggable backend (mock for tests, AWS Secrets Manager
for production). Tracks issue: SPRINT-1/D2 (no-AWS prep).
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from threading import RLock
from time import monotonic

from app.core.logging import get_logger

logger = get_logger(__name__)


# Stable prompt IDs. Adding a prompt requires (1) appending here and
# (2) populating in the chosen backend. Removing a prompt requires a
# version bump on every caller that references it.
PROMPT_IDS: frozenset[str] = frozenset(
    {
        "master.discovery",
        "agent.explorer",
        "agent.reasoner",
        "agent.validator",
        "agent.synthesizer",
        "agent.critic",
        "agent.strategist",
        "agent.deep_analyst",
        "stage.seed",
        "stage.expand",
        "stage.evidence",
        "stage.counter",
        "stage.revise",
        "stage.mechanism",
        "stage.validate",
        "stage.ground",
        "stage.score",
        "stage.refine",
        "stage.translate",
        "stage.finalize",
        "template.disease_context",
    }
)


class PromptBackendError(Exception):
    """Raised when a backend cannot fulfill a request."""


class PromptBackend(ABC):
    """Pluggable backend for fetching prompt text by id+version."""

    @abstractmethod
    def get(self, prompt_id: str, version: str) -> str:
        """Return prompt text. Raise PromptBackendError if unavailable."""


class MockBackend(PromptBackend):
    """In-memory backend for tests and local dev."""

    def __init__(self, prompts: dict[tuple[str, str], str] | None = None):
        # key = (prompt_id, version), value = prompt text
        self._store: dict[tuple[str, str], str] = dict(prompts or {})

    def put(self, prompt_id: str, version: str, text: str) -> None:
        if prompt_id not in PROMPT_IDS:
            raise ValueError(f"unknown prompt_id: {prompt_id}")
        self._store[(prompt_id, version)] = text

    def get(self, prompt_id: str, version: str) -> str:
        try:
            return self._store[(prompt_id, version)]
        except KeyError as e:
            raise PromptBackendError(f"not found: {prompt_id}@{version}") from e


class SecretsManagerBackend(PromptBackend):
    """
    AWS Secrets Manager backend. Resolves to:
        secret name: <prefix>/<prompt_id>
        version stage label: the version string (e.g. "v1") or AWSCURRENT.

    Implementation lands in Sprint 1 / Day 2 AWS-gated work, once the
    sandbox account + IAM scope are provided. Until then, callers should
    use MockBackend in tests and a one-shot in-process cache in dev.
    """

    def __init__(self, region_name: str, prefix: str = "humanovo/prompts"):
        self._region = region_name
        self._prefix = prefix
        self._client = None  # boto3 client created lazily

    def get(self, prompt_id: str, version: str) -> str:
        raise NotImplementedError(
            "SecretsManagerBackend not yet wired; pending sandbox AWS access"
        )


@dataclass
class _CacheEntry:
    text: str
    expires_at: float = field(default=0.0)


class PromptLoader:
    """
    Versioned prompt fetcher with TTL cache and stale-on-error fallback.

    On backend failure, returns the last cached value (with a warning log).
    If no cache exists, the original PromptBackendError propagates so the
    caller fails loud rather than silently using an empty prompt.
    """

    def __init__(
        self,
        backend: PromptBackend,
        default_version: str = "v1",
        ttl_seconds: float = 300.0,
    ):
        self._backend = backend
        self._default_version = default_version
        self._ttl = ttl_seconds
        self._cache: dict[tuple[str, str], _CacheEntry] = {}
        self._lock = RLock()

    def get(self, prompt_id: str, version: str | None = None) -> str:
        if prompt_id not in PROMPT_IDS:
            raise ValueError(f"unknown prompt_id: {prompt_id}")
        v = version or self._default_version
        key = (prompt_id, v)
        now = monotonic()

        with self._lock:
            entry = self._cache.get(key)
            if entry and entry.expires_at > now:
                return entry.text

        try:
            text = self._backend.get(prompt_id, v)
        except PromptBackendError as e:
            with self._lock:
                stale = self._cache.get(key)
            if stale is not None:
                logger.warning(
                    "prompt backend failed; serving stale cache",
                    prompt_id=prompt_id,
                    version=v,
                    error=str(e),
                )
                return stale.text
            raise

        with self._lock:
            self._cache[key] = _CacheEntry(text=text, expires_at=now + self._ttl)
        return text

    def invalidate(self, prompt_id: str | None = None) -> None:
        """Drop cache entries for a single prompt or all if None."""
        with self._lock:
            if prompt_id is None:
                self._cache.clear()
            else:
                self._cache = {k: v for k, v in self._cache.items() if k[0] != prompt_id}
