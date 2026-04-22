"""
Static / import-time guards for the admin endpoints.

These tests don't spin up a live DB or FastAPI TestClient — they just
import the module and assert the shape of the router + response-model
schema so we catch regressions that would blow up at startup (missing
imports, typo in @router decorator, drifted response models) before CI
deploys.

Spinning up a live async session with redis + neo4j mocks is out of
scope here; the Playwright spec at frontend/e2e/settings-admin-panel
covers the functional surface.
"""
from __future__ import annotations

import pytest


def test_admin_router_exposes_expected_routes() -> None:
    from app.api.v1.endpoints.admin import router

    # Each (method, path) pair the frontend + Playwright spec relies on.
    # When this list drifts from the real router, the Admin panel / seed
    # CTAs start 404'ing — catch it at import time instead.
    routes = {(m, r.path) for r in router.routes for m in r.methods or {"GET"}}

    assert ("GET", "/health") in routes
    assert ("GET", "/kg-stats") in routes
    assert ("POST", "/seed-kg") in routes
    assert ("POST", "/seed-corpus") in routes


def test_seed_response_model_has_required_fields() -> None:
    from app.api.v1.endpoints.admin import SeedResponse

    # Pydantic v2 exposes `model_fields`; fall back to v1 `__fields__`.
    fields = getattr(SeedResponse, "model_fields", None) or SeedResponse.__fields__
    required = {
        "ok",
        "environment",
        "nodes_before",
        "nodes_after",
        "edges_before",
        "edges_after",
        "embeddings_written",
        "neo4j_nodes",
        "neo4j_edges",
        "message",
    }
    assert required.issubset(set(fields.keys())), (
        f"SeedResponse missing fields: {required - set(fields.keys())}"
    )


def test_admin_module_imports_cleanly() -> None:
    """Covers the `from scripts.seed_kg import seed` lazy-import path
    + the graph_store accessor swap we landed earlier. If either
    regresses, this import will raise."""
    import importlib

    admin = importlib.import_module("app.api.v1.endpoints.admin")
    assert hasattr(admin, "router")
    assert hasattr(admin, "admin_health")
    assert hasattr(admin, "get_kg_stats")
    assert hasattr(admin, "seed_knowledge_graph")
    assert hasattr(admin, "seed_evidence_corpus")
