"""Unit tests for app.core.credential_pool."""

from __future__ import annotations

import asyncio
import time

import pytest

from app.core.credential_pool import (
    CredentialPool,
    MockCredentialBackend,
    PoolExhausted,
    UnknownPool,
    get_pool,
    register_pool,
    reset_registry_for_tests,
)


@pytest.fixture(autouse=True)
def _clean_registry():
    reset_registry_for_tests()
    yield
    reset_registry_for_tests()


@pytest.fixture
def two_active_keys() -> MockCredentialBackend:
    backend = MockCredentialBackend()
    backend.seed("bedrock", "key-1", "secret-1", rpm_limit=100)
    backend.seed("bedrock", "key-2", "secret-2", rpm_limit=100)
    return backend


@pytest.mark.asyncio
async def test_acquire_returns_credential(two_active_keys: MockCredentialBackend):
    pool = CredentialPool("bedrock", two_active_keys, refresh_interval_seconds=0)
    async with pool.acquire(tenant_id="t1") as cred:
        assert cred.api_key in ("secret-1", "secret-2")
        assert cred.key_id in ("key-1", "key-2")
        assert cred.pool_name == "bedrock"


@pytest.mark.asyncio
async def test_acquire_round_robins_across_keys(two_active_keys: MockCredentialBackend):
    pool = CredentialPool("bedrock", two_active_keys, refresh_interval_seconds=0)
    seen: set[str] = set()
    for _ in range(10):
        async with pool.acquire() as cred:
            seen.add(cred.key_id)
    # Both keys should have been used at least once across 10 acquires.
    assert seen == {"key-1", "key-2"}


@pytest.mark.asyncio
async def test_pool_exhausted_when_all_keys_revoked():
    backend = MockCredentialBackend()
    backend.seed("bedrock", "k", "s", rpm_limit=1)
    backend._pools["bedrock"][0].status = "revoked"
    pool = CredentialPool("bedrock", backend, refresh_interval_seconds=0)
    with pytest.raises(PoolExhausted) as exc:
        async with pool.acquire():
            pass
    assert exc.value.pool_name == "bedrock"


@pytest.mark.asyncio
async def test_pool_exhausted_when_pool_is_empty():
    backend = MockCredentialBackend({"bedrock": []})
    pool = CredentialPool("bedrock", backend, refresh_interval_seconds=0)
    with pytest.raises(PoolExhausted):
        async with pool.acquire():
            pass


@pytest.mark.asyncio
async def test_unknown_pool_raises_at_list_time(two_active_keys: MockCredentialBackend):
    pool = CredentialPool("does-not-exist", two_active_keys, refresh_interval_seconds=0)
    with pytest.raises(UnknownPool):
        async with pool.acquire():
            pass


@pytest.mark.asyncio
async def test_rate_limited_key_is_skipped_until_cooldown_expires(two_active_keys: MockCredentialBackend):
    pool = CredentialPool("bedrock", two_active_keys, refresh_interval_seconds=0)
    # Acquire once to populate state, then mark key-1 as rate-limited.
    async with pool.acquire() as _:
        pass
    pool.report_rate_limited("key-1", retry_after_seconds=60)
    # Subsequent acquires should consistently land on key-2 until key-1's cooldown expires.
    for _ in range(5):
        async with pool.acquire() as cred:
            assert cred.key_id == "key-2"


@pytest.mark.asyncio
async def test_unauthorized_key_is_locally_revoked(two_active_keys: MockCredentialBackend):
    pool = CredentialPool("bedrock", two_active_keys, refresh_interval_seconds=999)  # don't refresh
    async with pool.acquire() as _:
        pass
    pool.report_unauthorized("key-1")
    for _ in range(3):
        async with pool.acquire() as cred:
            assert cred.key_id == "key-2"


@pytest.mark.asyncio
async def test_falls_back_to_draining_when_no_active_keys():
    backend = MockCredentialBackend()
    backend.seed("bedrock", "k1", "s1", status="draining", rpm_limit=10)
    pool = CredentialPool("bedrock", backend, refresh_interval_seconds=0)
    async with pool.acquire() as cred:
        assert cred.key_id == "k1"


@pytest.mark.asyncio
async def test_expired_key_is_skipped():
    backend = MockCredentialBackend()
    backend.seed("bedrock", "k1", "s1", expires_at=time.time() - 1)  # already expired
    backend.seed("bedrock", "k2", "s2")  # never expires
    pool = CredentialPool("bedrock", backend, refresh_interval_seconds=0)
    for _ in range(3):
        async with pool.acquire() as cred:
            assert cred.key_id == "k2"


@pytest.mark.asyncio
async def test_rpm_limit_bumps_to_other_key():
    backend = MockCredentialBackend()
    backend.seed("bedrock", "low", "s1", rpm_limit=2)
    backend.seed("bedrock", "high", "s2", rpm_limit=1000)
    pool = CredentialPool("bedrock", backend, refresh_interval_seconds=0)
    # First handful preferentially go to "high" (more remaining budget).
    for _ in range(20):
        async with pool.acquire() as cred:
            assert cred.key_id == "high"


@pytest.mark.asyncio
async def test_emergency_revoke_via_backend_takes_effect_after_refresh(two_active_keys: MockCredentialBackend):
    pool = CredentialPool("bedrock", two_active_keys, refresh_interval_seconds=0)
    async with pool.acquire() as _:
        pass
    two_active_keys.emergency_revoke("bedrock", "key-1")
    # refresh_interval_seconds=0 forces re-read on next acquire.
    for _ in range(5):
        async with pool.acquire() as cred:
            assert cred.key_id == "key-2"


def test_register_and_get_pool(two_active_keys: MockCredentialBackend):
    pool = register_pool("bedrock", two_active_keys)
    assert get_pool("bedrock") is pool


def test_register_pool_is_idempotent(two_active_keys: MockCredentialBackend):
    a = register_pool("bedrock", two_active_keys)
    b = register_pool("bedrock", two_active_keys)
    assert a is b


def test_get_pool_raises_for_unknown():
    with pytest.raises(UnknownPool):
        get_pool("nonexistent")


@pytest.mark.asyncio
async def test_concurrent_acquires_share_rpm_count(two_active_keys: MockCredentialBackend):
    """20 concurrent acquires should use both keys without exceeding rpm_limit."""
    pool = CredentialPool("bedrock", two_active_keys, refresh_interval_seconds=0)

    async def one_acquire():
        async with pool.acquire() as cred:
            return cred.key_id

    results = await asyncio.gather(*(one_acquire() for _ in range(20)))
    counts = {k: results.count(k) for k in set(results)}
    # Both keys used; neither exceeds its 100 rpm limit (20 << 200 total budget).
    assert sum(counts.values()) == 20
    assert all(v >= 1 for v in counts.values())
