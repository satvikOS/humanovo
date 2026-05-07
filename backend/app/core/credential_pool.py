"""
CredentialPool: per-provider multi-key broker with failover, rate-limit
accounting, and pluggable backends.

Design doc: docs/planning/CREDENTIAL_POOL_DESIGN.md

This module ships the in-process broker + mock backend. The Secrets
Manager backend lands once the AWS bootstrap completes; until then,
callers in tests use MockCredentialBackend, and dev environments fall
back to single-key mode via the legacy `settings.*_KEY` reads.
"""

from __future__ import annotations

import time
from abc import ABC, abstractmethod
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from threading import RLock

from app.core.logging import get_logger

logger = get_logger(__name__)


class PoolExhausted(Exception):
    """All keys in a pool are unhealthy (revoked, on cooldown, or absent)."""

    def __init__(self, pool_name: str):
        super().__init__(f"credential pool exhausted: {pool_name}")
        self.pool_name = pool_name


class UnknownPool(KeyError):
    """Asked for a pool that wasn't registered."""


@dataclass
class KeySpec:
    """Configuration for a single key in a pool."""

    key_id: str
    api_key: str
    status: str = "active"                # active | draining | revoked
    rpm_limit: int = 1_000
    tpm_limit: int = 1_000_000
    expires_at: float | None = None    # epoch seconds; None = never


@dataclass
class _KeyState:
    """Live runtime state for a key inside the pool."""

    spec: KeySpec
    rpm_used: int = 0
    rpm_window_start: float = field(default_factory=time.time)
    cooldown_until: float = 0.0
    last_failure_code: str | None = None
    last_failure_at: float = 0.0


@dataclass
class Credential:
    """Hand-out object for a single upstream call.

    Lifetime is the `async with pool.acquire(...)` block. Don't hold
    references beyond that — the pool may revoke or rotate the
    underlying key while you're holding it.
    """

    api_key: str
    key_id: str
    pool_name: str


class CredentialBackend(ABC):
    """Pluggable storage for the per-pool key list."""

    @abstractmethod
    def list_keys(self, pool_name: str) -> list[KeySpec]:
        """Return the current key roster for `pool_name`."""

    @abstractmethod
    def emergency_revoke(self, pool_name: str, key_id: str) -> None:
        """Force a key to status=revoked. Pool re-reads on next acquire."""


class MockCredentialBackend(CredentialBackend):
    """In-memory backend for tests + local dev.

    Tests construct one with an explicit key roster. Local dev uses an
    empty MockCredentialBackend + sets a single key via `seed()` so the
    legacy single-key call sites keep working.
    """

    def __init__(self, pools: dict[str, list[KeySpec]] | None = None):
        self._pools: dict[str, list[KeySpec]] = {k: list(v) for k, v in (pools or {}).items()}

    def seed(self, pool_name: str, key_id: str, api_key: str, **kwargs) -> None:
        spec = KeySpec(key_id=key_id, api_key=api_key, **kwargs)
        self._pools.setdefault(pool_name, []).append(spec)

    def list_keys(self, pool_name: str) -> list[KeySpec]:
        if pool_name not in self._pools:
            raise UnknownPool(pool_name)
        # Return a copy so callers can't mutate our store.
        return [
            KeySpec(
                key_id=k.key_id,
                api_key=k.api_key,
                status=k.status,
                rpm_limit=k.rpm_limit,
                tpm_limit=k.tpm_limit,
                expires_at=k.expires_at,
            )
            for k in self._pools[pool_name]
        ]

    def emergency_revoke(self, pool_name: str, key_id: str) -> None:
        for k in self._pools.get(pool_name, []):
            if k.key_id == key_id:
                k.status = "revoked"
                return


class CredentialPool:
    """Single-pool broker. One instance per (worker, pool_name) tuple.

    Refreshes its view of keys from the backend every `refresh_interval`
    seconds — this is how the pool picks up rotations and emergency
    revokes without restart.
    """

    def __init__(
        self,
        pool_name: str,
        backend: CredentialBackend,
        *,
        refresh_interval_seconds: float = 60.0,
        rpm_window_seconds: float = 60.0,
    ):
        self._pool_name = pool_name
        self._backend = backend
        self._refresh_interval = refresh_interval_seconds
        self._rpm_window = rpm_window_seconds
        self._lock = RLock()
        self._states: dict[str, _KeyState] = {}
        self._last_refresh: float = 0.0

    def _refresh_if_stale(self) -> None:
        now = time.time()
        if now - self._last_refresh < self._refresh_interval and self._states:
            return
        with self._lock:
            specs = self._backend.list_keys(self._pool_name)
            seen: set[str] = set()
            for spec in specs:
                seen.add(spec.key_id)
                existing = self._states.get(spec.key_id)
                if existing is None:
                    self._states[spec.key_id] = _KeyState(spec=spec)
                else:
                    # Preserve runtime counters across refresh; just
                    # update the spec (status/limits/expiry may have
                    # changed because of rotation).
                    existing.spec = spec
            for known in list(self._states.keys()):
                if known not in seen:
                    del self._states[known]
            self._last_refresh = now

    def _pick_candidate(self) -> _KeyState | None:
        now = time.time()
        with self._lock:
            # Reset rpm window where it's expired.
            for s in self._states.values():
                if now - s.rpm_window_start >= self._rpm_window:
                    s.rpm_window_start = now
                    s.rpm_used = 0

            def healthy(s: _KeyState) -> bool:
                if s.spec.status not in ("active", "draining"):
                    return False
                if s.cooldown_until > now:
                    return False
                if s.spec.expires_at is not None and s.spec.expires_at < now:
                    return False
                if s.rpm_used >= int(s.spec.rpm_limit * 0.95):
                    return False
                return True

            active = [s for s in self._states.values() if s.spec.status == "active" and healthy(s)]
            if active:
                return max(active, key=lambda s: s.spec.rpm_limit - s.rpm_used)

            # Active pool exhausted — fall back to draining keys.
            draining = [s for s in self._states.values() if s.spec.status == "draining" and healthy(s)]
            if draining:
                return max(draining, key=lambda s: s.spec.rpm_limit - s.rpm_used)

            return None

    @asynccontextmanager
    async def acquire(self, tenant_id: str | None = None) -> AsyncIterator[Credential]:
        """Hand out a credential for the duration of an upstream call.

        Usage::

            async with pool.acquire(tenant_id) as cred:
                resp = await call_upstream(cred.api_key, ...)
                if resp.status_code == 429:
                    pool.report_rate_limited(cred.key_id, retry_after=30)
                    raise SomeRetryError()
        """
        self._refresh_if_stale()
        chosen = self._pick_candidate()
        if chosen is None:
            raise PoolExhausted(self._pool_name)

        with self._lock:
            chosen.rpm_used += 1
        logger.debug(
            "credential acquired",
            pool=self._pool_name,
            key_id=chosen.spec.key_id,
            tenant_id=tenant_id,
        )
        try:
            yield Credential(
                api_key=chosen.spec.api_key,
                key_id=chosen.spec.key_id,
                pool_name=self._pool_name,
            )
        finally:
            # rpm_used stays incremented for the window — that's the
            # whole point of the counter. We don't decrement on success.
            pass

    def report_rate_limited(self, key_id: str, retry_after_seconds: float = 30.0) -> None:
        """Mark a key as cooled-down following an upstream 429."""
        with self._lock:
            s = self._states.get(key_id)
            if s is None:
                return
            s.cooldown_until = time.time() + retry_after_seconds
            s.last_failure_code = "rate_limited"
            s.last_failure_at = time.time()
        logger.warning(
            "credential rate-limited",
            pool=self._pool_name,
            key_id=key_id,
            retry_after_seconds=retry_after_seconds,
        )

    def report_unauthorized(self, key_id: str) -> None:
        """Mark a key as locally-revoked following an upstream 401.

        We don't mutate the backend (the rotation Lambda owns that);
        we just stop using this key in this worker until next refresh,
        at which point either (a) it's truly revoked at the source and
        won't come back, or (b) the 401 was transient and it'll be
        active again.
        """
        with self._lock:
            s = self._states.get(key_id)
            if s is None:
                return
            s.spec.status = "revoked"
            s.last_failure_code = "unauthorized"
            s.last_failure_at = time.time()
        logger.error("credential unauthorized; locally revoking", pool=self._pool_name, key_id=key_id)

    def report_upstream_unavailable(self, key_id: str) -> None:
        """Mark a key as cooled-down following an upstream 5xx."""
        with self._lock:
            s = self._states.get(key_id)
            if s is None:
                return
            s.cooldown_until = time.time() + 30
            s.last_failure_code = "upstream_unavailable"
            s.last_failure_at = time.time()


# Module-level registry. Workers initialize once per process via
# `register_pool(name, backend, ...)` and call sites read via
# `get_pool(name)`. Pool refresh is opportunistic on `acquire`; no
# background thread.

_REGISTRY: dict[str, CredentialPool] = {}
_REGISTRY_LOCK = RLock()


def register_pool(
    pool_name: str,
    backend: CredentialBackend,
    *,
    refresh_interval_seconds: float = 60.0,
    rpm_window_seconds: float = 60.0,
) -> CredentialPool:
    """Register a pool. Idempotent — re-registering returns the existing instance."""
    with _REGISTRY_LOCK:
        if pool_name in _REGISTRY:
            return _REGISTRY[pool_name]
        pool = CredentialPool(
            pool_name=pool_name,
            backend=backend,
            refresh_interval_seconds=refresh_interval_seconds,
            rpm_window_seconds=rpm_window_seconds,
        )
        _REGISTRY[pool_name] = pool
        return pool


def get_pool(pool_name: str) -> CredentialPool:
    """Look up a previously-registered pool. Raises UnknownPool if missing."""
    with _REGISTRY_LOCK:
        if pool_name not in _REGISTRY:
            raise UnknownPool(pool_name)
        return _REGISTRY[pool_name]


def reset_registry_for_tests() -> None:
    """Test-only: clear the module-level pool registry between tests."""
    with _REGISTRY_LOCK:
        _REGISTRY.clear()
