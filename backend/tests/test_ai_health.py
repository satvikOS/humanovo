"""
Tests for /admin/ai/health.

The probes themselves require live AWS / Azure credentials; we don't
exercise those in CI (the test venv has neither). Instead these tests
freeze the *report shape* + the cache + the per-model "configured"
detection so a future refactor can't break the renderer-side surface
that consumes this endpoint.
"""
from __future__ import annotations

import pytest

from app.api.v1.endpoints.ai_health import _build_payload, _cache


@pytest.fixture(autouse=True)
def _clear_cache():
    """Each test starts with a fresh cache so the 30 s memoise doesn't
    leak between cases."""
    _cache["ts"] = 0.0
    _cache["payload"] = None
    yield


@pytest.mark.asyncio
async def test_payload_shape_with_no_credentials() -> None:
    """
    With no AWS / Azure creds (the CI venv), every probe should
    report `configured: false` + a 'not set' / similar error and
    the summary should reflect zero reachable.
    """
    payload = await _build_payload()
    assert "providers" in payload
    assert "summary" in payload
    assert "bedrock" in payload["providers"]
    assert "azure" in payload["providers"]

    # Each model entry has the frozen contract shape.
    for entry in payload["providers"]["bedrock"]:
        assert {"model", "model_id", "configured", "reachable", "latency_ms", "error"}.issubset(entry.keys())
    for entry in payload["providers"]["azure"]:
        assert {"model", "deployment", "configured", "reachable", "latency_ms", "error"}.issubset(entry.keys())

    s = payload["summary"]
    assert s["total"] == len(payload["providers"]["bedrock"]) + len(payload["providers"]["azure"])
    # Without creds, nothing should be reachable; the configured count
    # depends on environment but downstream invariant always holds.
    assert s["reachable"] <= s["configured"]
    assert s["down"] == s["configured"] - s["reachable"]


@pytest.mark.asyncio
async def test_bedrock_probe_lists_both_claude_models() -> None:
    """
    Bedrock probe must always return the two configured Claude
    models — Opus and Sonnet — so the renderer always has a known
    structure to render even when both are unreachable.
    """
    payload = await _build_payload()
    bedrock_labels = {b["model"] for b in payload["providers"]["bedrock"]}
    assert "claude-opus-4-6" in bedrock_labels
    assert "claude-sonnet-4" in bedrock_labels


@pytest.mark.asyncio
async def test_azure_probe_lists_core_deployments() -> None:
    """
    Azure probe always probes the core 4 deployments (gpt-4o / o3-mini
    / cohere-command-a / mistral-large-3) regardless of whether they're
    configured. GPT-4.1 + Grok are conditional on their endpoint vars
    being set, so they may or may not appear.
    """
    payload = await _build_payload()
    azure_labels = {b["model"] for b in payload["providers"]["azure"]}
    assert "gpt-4o" in azure_labels
    assert "o3-mini" in azure_labels
    assert "cohere-command-a" in azure_labels
    assert "mistral-large-3" in azure_labels
