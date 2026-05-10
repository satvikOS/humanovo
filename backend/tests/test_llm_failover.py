"""
Tests for app/services/llm_failover.py.

The primitive is intentionally provider-agnostic — the test exercises
its sequencing behaviour with mocked async callables, no Bedrock /
Azure SDKs required. Six cases cover the full state space:

  1. Primary succeeds                → response carries primary label
  2. Primary fails, fallback succeeds → response carries fallback label
                                        + outcomes show primary error
  3. All providers fail              → AllProvidersFailed raised with
                                        per-attempt error trail
  4. Timeout treated as failure      → timeout on first triggers
                                        fallback + error message
                                        mentions the timeout
  5. Empty attempts list             → ValueError
  6. Outcome trail does not include
     attempts after the winner       → fallback chain stops at first
                                        success
"""
from __future__ import annotations

import asyncio

import pytest

from app.services.llm_failover import (
    AllProvidersFailed,
    LLMAttempt,
    call_with_failover,
)


@pytest.mark.asyncio
async def test_primary_succeeds() -> None:
    async def primary() -> str:
        return "primary-text"

    async def fallback() -> str:
        return "should-not-run"

    resp = await call_with_failover([
        LLMAttempt(label="bedrock-opus", invoke=primary),
        LLMAttempt(label="azure-gpt-4o", invoke=fallback),
    ])
    assert resp.text == "primary-text"
    assert resp.winning_label == "bedrock-opus"
    assert resp.attempts_tried == 1
    assert len(resp.outcomes) == 1
    assert resp.outcomes[0].succeeded


@pytest.mark.asyncio
async def test_failover_to_secondary() -> None:
    async def primary() -> str:
        raise RuntimeError("ServiceUnavailable: 503 from Bedrock")

    async def fallback() -> str:
        return "fallback-text"

    resp = await call_with_failover([
        LLMAttempt(label="bedrock-opus", invoke=primary),
        LLMAttempt(label="azure-gpt-4o", invoke=fallback),
    ])
    assert resp.text == "fallback-text"
    assert resp.winning_label == "azure-gpt-4o"
    assert resp.attempts_tried == 2
    # Outcome trail includes the failed primary so the caller can
    # persist the full attempt history for analytics.
    assert len(resp.outcomes) == 2
    assert resp.outcomes[0].succeeded is False
    assert "503" in (resp.outcomes[0].error or "")
    assert resp.outcomes[1].succeeded is True


@pytest.mark.asyncio
async def test_all_providers_fail() -> None:
    async def primary() -> str:
        raise RuntimeError("Bedrock 401")

    async def fallback() -> str:
        raise RuntimeError("Azure 429")

    with pytest.raises(AllProvidersFailed) as exc:
        await call_with_failover([
            LLMAttempt(label="bedrock-opus", invoke=primary),
            LLMAttempt(label="azure-gpt-4o", invoke=fallback),
        ])
    # Exception carries the full outcome trail so the caller can
    # surface every provider's error, not just the last one.
    assert len(exc.value.outcomes) == 2
    assert "Bedrock 401" in str(exc.value)
    assert "Azure 429" in str(exc.value)


@pytest.mark.asyncio
async def test_timeout_triggers_failover() -> None:
    async def primary_hangs() -> str:
        await asyncio.sleep(2.0)  # exceeds the 0.05 s timeout below
        return "never-returned"

    async def fallback() -> str:
        return "fast-fallback"

    resp = await call_with_failover([
        LLMAttempt(label="slow-primary", invoke=primary_hangs, timeout_s=0.05),
        LLMAttempt(label="fast-fallback", invoke=fallback, timeout_s=1.0),
    ])
    assert resp.winning_label == "fast-fallback"
    assert resp.outcomes[0].succeeded is False
    assert "timeout" in (resp.outcomes[0].error or "").lower()


@pytest.mark.asyncio
async def test_empty_attempts_raises() -> None:
    with pytest.raises(ValueError):
        await call_with_failover([])


@pytest.mark.asyncio
async def test_attempts_after_winner_not_run() -> None:
    """A third attempt past the winning fallback should never be invoked.
    Asserts via a sentinel — if the third callable ever runs, the
    sentinel flips and the assertion fails."""
    third_was_called = {"flag": False}

    async def primary() -> str:
        raise RuntimeError("first failed")

    async def winner() -> str:
        return "winner"

    async def third() -> str:
        third_was_called["flag"] = True
        return "should-not-run"

    resp = await call_with_failover([
        LLMAttempt(label="primary", invoke=primary),
        LLMAttempt(label="winner", invoke=winner),
        LLMAttempt(label="third", invoke=third),
    ])
    assert resp.winning_label == "winner"
    assert resp.attempts_tried == 2
    assert len(resp.outcomes) == 2  # primary + winner only
    assert third_was_called["flag"] is False
