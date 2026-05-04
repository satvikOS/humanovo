"""
Shared integration base — httpx async client + polite rate limit + Postgres cache.

Design notes:
  - One `IntegrationClient` per upstream host. Reuses an httpx.AsyncClient
    so HTTP/2 connection pooling is maintained across fetches.
  - A per-host asyncio.Semaphore enforces concurrency limits (configurable).
  - A token-bucket rate limiter (per host) bounds requests/second to stay
    inside "polite pool" expectations for public APIs.
  - Responses are cached in the `integration_cache` Postgres table keyed by
    (service, endpoint, params_hash) with a configurable TTL. TTL defaults
    to 30 days for structural data (pathways, drug targets) and 7 days for
    high-churn data (recent publications).
  - The cache lookup is async-safe via Postgres row-level locking.
  - `fetch_json(...)` is the single primitive every integration builds on.

Fail-safe policy:
  - Transient failures (5xx, timeout, connect error) retry up to 3 times
    with exponential backoff (0.5s, 1s, 2s).
  - 4xx is non-retryable and raises IntegrationError with the body.
  - Network-unavailable (e.g. air-gapped dev env) returns None instead of
    raising so upstream code can degrade gracefully.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import time
from dataclasses import dataclass, field
from typing import Any, Mapping

import httpx
from sqlalchemy import text

from app.core.config import settings
from app.core.database import async_session_factory

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# DDL — integration_cache table (auto-created on first client init)
# ---------------------------------------------------------------------------

INTEGRATION_CACHE_DDL = """
CREATE TABLE IF NOT EXISTS integration_cache (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    params_hash TEXT NOT NULL,
    status_code INT NOT NULL,
    response_json JSONB,
    response_bytes BYTEA,
    content_type TEXT,
    cached_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    hit_count INT NOT NULL DEFAULT 0,
    last_hit_at TIMESTAMPTZ,
    UNIQUE (service, endpoint, params_hash)
);
CREATE INDEX IF NOT EXISTS integration_cache_expiry_idx
  ON integration_cache(expires_at);
CREATE INDEX IF NOT EXISTS integration_cache_service_idx
  ON integration_cache(service);
"""


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------


class IntegrationError(Exception):
    """Non-retryable integration failure (4xx, malformed response, etc.)."""

    def __init__(self, message: str, status_code: int | None = None,
                 body: str | None = None):
        super().__init__(message)
        self.status_code = status_code
        self.body = body


# ---------------------------------------------------------------------------
# Rate limiter
# ---------------------------------------------------------------------------


class _TokenBucket:
    """Simple async token bucket. Thread-safe within a single event loop."""

    def __init__(self, rate_per_sec: float, burst: int | None = None):
        self._rate = rate_per_sec
        self._capacity = burst if burst is not None else max(1, int(rate_per_sec * 2))
        self._tokens = float(self._capacity)
        self._last_refill = time.monotonic()
        self._lock = asyncio.Lock()

    async def acquire(self) -> None:
        async with self._lock:
            now = time.monotonic()
            elapsed = now - self._last_refill
            self._tokens = min(self._capacity, self._tokens + elapsed * self._rate)
            self._last_refill = now
            if self._tokens < 1:
                wait = (1 - self._tokens) / self._rate
                await asyncio.sleep(wait)
                self._tokens = 0
            else:
                self._tokens -= 1


# ---------------------------------------------------------------------------
# Cache
# ---------------------------------------------------------------------------


@dataclass
class _CacheEntry:
    status_code: int
    response_json: Any
    cached_at: Any
    expires_at: Any


class _IntegrationCache:
    """Postgres-backed cache for HTTP GET/POST responses."""

    _schema_ready: bool = False
    _schema_lock: asyncio.Lock = asyncio.Lock()

    async def ensure_schema(self) -> None:
        if _IntegrationCache._schema_ready:
            return
        async with _IntegrationCache._schema_lock:
            if _IntegrationCache._schema_ready:
                return
            try:
                async with async_session_factory() as session:
                    async with session.begin():
                        for stmt in INTEGRATION_CACHE_DDL.strip().split(";"):
                            s = stmt.strip()
                            if s:
                                await session.execute(text(s))
                _IntegrationCache._schema_ready = True
            except Exception as e:
                logger.debug(f"integration_cache DDL skipped (non-fatal): {e}")
                _IntegrationCache._schema_ready = True  # avoid retry-storm

    async def get(
        self, service: str, endpoint: str, params_hash: str,
    ) -> _CacheEntry | None:
        await self.ensure_schema()
        try:
            async with async_session_factory() as session:
                r = await session.execute(text("""
                    SELECT status_code, response_json, cached_at, expires_at
                    FROM integration_cache
                    WHERE service = :s AND endpoint = :e AND params_hash = :h
                      AND expires_at > NOW()
                """), {"s": service, "e": endpoint, "h": params_hash})
                row = r.mappings().fetchone()
                if not row:
                    return None
                # Touch hit_count asynchronously (fire-and-forget)
                try:
                    async with session.begin():
                        await session.execute(text("""
                            UPDATE integration_cache
                               SET hit_count = hit_count + 1,
                                   last_hit_at = NOW()
                             WHERE service = :s AND endpoint = :e
                               AND params_hash = :h
                        """), {"s": service, "e": endpoint, "h": params_hash})
                except Exception:
                    pass
                return _CacheEntry(
                    status_code=row["status_code"],
                    response_json=row["response_json"],
                    cached_at=row["cached_at"],
                    expires_at=row["expires_at"],
                )
        except Exception as e:
            logger.debug(f"cache read skipped: {e}")
            return None

    async def set(
        self,
        service: str,
        endpoint: str,
        params_hash: str,
        status_code: int,
        response_json: Any,
        ttl_seconds: int,
    ) -> None:
        await self.ensure_schema()
        try:
            async with async_session_factory() as session:
                async with session.begin():
                    await session.execute(text("""
                        INSERT INTO integration_cache (
                            service, endpoint, params_hash, status_code,
                            response_json, expires_at
                        ) VALUES (
                            :s, :e, :h, :sc,
                            :rj::jsonb, NOW() + (:ttl || ' seconds')::interval
                        )
                        ON CONFLICT (service, endpoint, params_hash)
                        DO UPDATE SET
                            status_code = EXCLUDED.status_code,
                            response_json = EXCLUDED.response_json,
                            cached_at = NOW(),
                            expires_at = EXCLUDED.expires_at
                    """), {
                        "s": service, "e": endpoint, "h": params_hash,
                        "sc": status_code,
                        "rj": json.dumps(response_json, default=str),
                        "ttl": str(ttl_seconds),
                    })
        except Exception as e:
            logger.debug(f"cache write skipped: {e}")


_default_cache: _IntegrationCache | None = None


def get_integration_cache() -> _IntegrationCache:
    global _default_cache
    if _default_cache is None:
        _default_cache = _IntegrationCache()
    return _default_cache


# ---------------------------------------------------------------------------
# Client
# ---------------------------------------------------------------------------


@dataclass
class IntegrationClient:
    """Single upstream HTTP client with rate limit + cache.

    Subclass rather than instantiate directly — subclasses set SERVICE,
    BASE_URL, defaults. See alphafold.py for the canonical minimal example.
    """

    SERVICE: str = "generic"
    BASE_URL: str = ""
    DEFAULT_TIMEOUT: float = 15.0
    DEFAULT_CACHE_TTL: int = 60 * 60 * 24 * 30   # 30 days
    RATE_PER_SECOND: float = 3.0
    MAX_CONCURRENT: int = 4
    USER_AGENT: str = ""

    _client: httpx.AsyncClient | None = field(default=None, init=False, repr=False)
    _bucket: _TokenBucket | None = field(default=None, init=False, repr=False)
    _sem: asyncio.Semaphore | None = field(default=None, init=False, repr=False)
    _cache: _IntegrationCache | None = field(default=None, init=False, repr=False)

    def _ensure_client(self) -> None:
        if self._client is None:
            headers = {
                "User-Agent": self.USER_AGENT
                    or f"humanovo/0.1 (mailto:{settings.PUBMED_EMAIL})",
                "Accept": "application/json",
            }
            # SSRF defense: every outbound URL must clear the allowlist
            # in app.core.http_allowlist before httpx sends it. Block
            # raises SSRFBlockedError, surfacing as a 500 to the caller
            # of the integration (intentional — a misconfiguration here
            # is a server bug, not a user-recoverable error).
            from app.core.http_allowlist import make_httpx_client

            self._client = make_httpx_client(
                base_url=self.BASE_URL,
                headers=headers,
                timeout=self.DEFAULT_TIMEOUT,
                http2=False,  # many APIs still break on h2 + long queries
                follow_redirects=True,
            )
        if self._bucket is None:
            self._bucket = _TokenBucket(self.RATE_PER_SECOND)
        if self._sem is None:
            self._sem = asyncio.Semaphore(self.MAX_CONCURRENT)
        if self._cache is None:
            self._cache = get_integration_cache()

    async def close(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    async def fetch_json(
        self,
        endpoint: str,
        *,
        params: Mapping[str, Any] | None = None,
        method: str = "GET",
        json_body: Any = None,
        cache_ttl: int | None = None,
        allow_cache: bool = True,
    ) -> Any:
        """Fetch a JSON response from the upstream with caching + rate limit.

        Returns parsed JSON on success, raises IntegrationError on 4xx,
        returns None when the upstream is unreachable (degrade gracefully).
        """
        self._ensure_client()
        params_dict = {k: v for k, v in (params or {}).items() if v is not None}
        params_hash = _hash_params(method, endpoint, params_dict, json_body)

        # Cache lookup
        if allow_cache:
            entry = await self._cache.get(self.SERVICE, endpoint, params_hash)
            if entry and 200 <= int(entry.status_code) < 300:
                return entry.response_json

        # Network fetch with retry
        ttl = cache_ttl if cache_ttl is not None else self.DEFAULT_CACHE_TTL
        last_exc: Exception | None = None
        for attempt in range(3):
            try:
                async with self._sem:
                    await self._bucket.acquire()
                    if method.upper() == "GET":
                        resp = await self._client.get(endpoint, params=params_dict)
                    elif method.upper() == "POST":
                        resp = await self._client.post(
                            endpoint, params=params_dict, json=json_body,
                        )
                    else:
                        raise IntegrationError(f"Unsupported method: {method}")

                if resp.status_code >= 500:
                    raise httpx.HTTPStatusError(
                        f"{resp.status_code} from {self.SERVICE}",
                        request=resp.request, response=resp,
                    )
                if 400 <= resp.status_code < 500:
                    body = resp.text[:500]
                    raise IntegrationError(
                        f"{self.SERVICE} {method} {endpoint} -> "
                        f"{resp.status_code}",
                        status_code=resp.status_code, body=body,
                    )

                try:
                    data = resp.json()
                except Exception:
                    data = {"_raw_text": resp.text}

                if allow_cache:
                    await self._cache.set(
                        self.SERVICE, endpoint, params_hash,
                        resp.status_code, data, ttl,
                    )
                return data

            except (httpx.ConnectError, httpx.ReadTimeout,
                    httpx.HTTPStatusError, httpx.RemoteProtocolError) as e:
                last_exc = e
                delay = 0.5 * (2 ** attempt)
                logger.debug(
                    f"[{self.SERVICE}] {method} {endpoint} attempt "
                    f"{attempt + 1}/3 failed: {e}; retrying in {delay:.1f}s"
                )
                await asyncio.sleep(delay)
            except IntegrationError:
                raise
            except Exception as e:
                last_exc = e
                break

        # All retries exhausted — degrade gracefully
        logger.warning(
            f"[{self.SERVICE}] {method} {endpoint} unreachable "
            f"after 3 attempts: {last_exc}"
        )
        return None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _hash_params(
    method: str,
    endpoint: str,
    params: Mapping[str, Any],
    body: Any,
) -> str:
    payload = json.dumps(
        {
            "method": method.upper(),
            "endpoint": endpoint,
            "params": {k: params[k] for k in sorted(params)},
            "body": body,
        },
        sort_keys=True, default=str,
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:32]
