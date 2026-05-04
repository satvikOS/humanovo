"""Unit tests for app.agents.prompt_loader."""

from __future__ import annotations

import pytest

from app.agents.prompt_loader import (
    PROMPT_IDS,
    MockBackend,
    PromptBackendError,
    PromptLoader,
)


def test_unknown_prompt_id_rejected():
    loader = PromptLoader(MockBackend())
    with pytest.raises(ValueError):
        loader.get("nonexistent.prompt")


def test_mock_backend_round_trip():
    backend = MockBackend()
    backend.put("stage.seed", "v1", "seed text")
    loader = PromptLoader(backend, default_version="v1")
    assert loader.get("stage.seed") == "seed text"


def test_mock_backend_rejects_unknown_id_on_put():
    backend = MockBackend()
    with pytest.raises(ValueError):
        backend.put("not.a.real.prompt", "v1", "x")


def test_default_version_override():
    backend = MockBackend()
    backend.put("stage.seed", "v1", "v1 text")
    backend.put("stage.seed", "v2", "v2 text")
    loader = PromptLoader(backend, default_version="v1")
    assert loader.get("stage.seed") == "v1 text"
    assert loader.get("stage.seed", "v2") == "v2 text"


def test_ttl_cache_serves_stale_on_backend_failure():
    backend = MockBackend()
    backend.put("stage.seed", "v1", "good")
    # ttl_seconds=0 means every read after the first refetches from backend
    loader = PromptLoader(backend, default_version="v1", ttl_seconds=0)
    assert loader.get("stage.seed") == "good"

    # remove from backend; next get should fall back to stale cache
    backend._store.clear()
    assert loader.get("stage.seed") == "good"


def test_no_stale_cache_raises():
    backend = MockBackend()  # empty
    loader = PromptLoader(backend)
    with pytest.raises(PromptBackendError):
        loader.get("stage.seed")


def test_invalidate_specific_prompt():
    backend = MockBackend()
    backend.put("stage.seed", "v1", "old")
    loader = PromptLoader(backend, default_version="v1", ttl_seconds=300)
    assert loader.get("stage.seed") == "old"

    backend.put("stage.seed", "v1", "new")
    assert loader.get("stage.seed") == "old"  # served from cache

    loader.invalidate("stage.seed")
    assert loader.get("stage.seed") == "new"


def test_invalidate_all():
    backend = MockBackend()
    backend.put("stage.seed", "v1", "x")
    backend.put("stage.expand", "v1", "y")
    loader = PromptLoader(backend, default_version="v1", ttl_seconds=300)
    loader.get("stage.seed")
    loader.get("stage.expand")
    loader.invalidate()
    # cache should be empty
    assert loader._cache == {}


def test_prompt_ids_contains_all_12_stages():
    expected_stages = {
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
    }
    assert expected_stages.issubset(PROMPT_IDS)


def test_prompt_ids_is_immutable():
    """frozenset prevents accidental mutation by importers."""
    assert isinstance(PROMPT_IDS, frozenset)


def test_secrets_manager_backend_not_implemented():
    """SecretsManagerBackend is a stub until AWS access lands; calling it should fail loud."""
    from app.agents.prompt_loader import SecretsManagerBackend

    backend = SecretsManagerBackend(region_name="us-east-1")
    with pytest.raises(NotImplementedError):
        backend.get("stage.seed", "v1")
