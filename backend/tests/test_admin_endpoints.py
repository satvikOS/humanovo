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


def test_admin_router_exposes_expected_routes() -> None:
    from fastapi.routing import APIRoute

    from app.api.v1.endpoints.admin import router

    # Only count actual APIRoute entries — guards against WebSocketRoute
    # or Mount entries showing up later and throwing AttributeError
    # when we touch `.methods`.
    routes: set[tuple[str, str]] = set()
    for r in router.routes:
        if not isinstance(r, APIRoute):
            continue
        for method in r.methods or ():
            routes.add((method, r.path))

    # Each (method, path) pair the frontend + Playwright spec relies on.
    # When this list drifts from the real router, the Admin panel / seed
    # CTAs start 404'ing — catch it at import time instead.
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


def test_admin_module_exports_endpoint_callables() -> None:
    """The four endpoint function names are referenced by frontend
    typed wrappers (api.getAdminHealth, api.getKgStats, api.seedKg,
    api.seedCorpus). If these rename, the frontend silently 404s."""
    from app.api.v1.endpoints import admin

    assert hasattr(admin, "router")
    assert callable(getattr(admin, "admin_health", None))
    assert callable(getattr(admin, "get_kg_stats", None))
    assert callable(getattr(admin, "seed_knowledge_graph", None))
    assert callable(getattr(admin, "seed_evidence_corpus", None))
