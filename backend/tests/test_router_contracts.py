"""
Router-contract guards for the v1 API.

The frontend in services/api.ts + services/knowledge.ts calls specific
(method, path) pairs. When those drift on the backend — a rename, a
prefix change, a forgotten include_router — the UI silently 404's.
This file guards against that by asserting the aggregate v1 router
exposes every path the frontend depends on.

No TestClient, no DB — pure router-shape introspection. Stays hermetic
on CI without postgres/redis/neo4j.
"""
from __future__ import annotations


def _collect_routes() -> set[tuple[str, str]]:
    from fastapi.routing import APIRoute

    from app.api.v1 import router

    seen: set[tuple[str, str]] = set()
    for r in router.routes:
        if not isinstance(r, APIRoute):
            continue
        for method in r.methods or ():
            seen.add((method, r.path))
    return seen


def test_v1_router_mounts_core_resources() -> None:
    """Every (method, path) pair the frontend calls must be mounted.
    When a regression drops one of these the UI 404s silently — catch
    it here instead.
    """
    routes = _collect_routes()
    required: set[tuple[str, str]] = {
        # Admin — dashboard + settings pill depend on these.
        ("GET", "/admin/health"),
        ("GET", "/admin/kg-stats"),
        ("POST", "/admin/seed-kg"),
        ("POST", "/admin/seed-corpus"),
        # Projects — core resource for every workspace page.
        ("GET", "/projects"),
        ("POST", "/projects"),
        ("GET", "/projects/{project_id}"),
        ("DELETE", "/projects/{project_id}"),
        # Hypotheses.
        ("GET", "/hypotheses"),
        ("GET", "/hypotheses/{hypothesis_id}"),
        # Evidence.
        ("GET", "/evidence"),
        # Activities (Timeline / Dashboard).
        ("GET", "/activities"),
        # Collaboration tab surfaces.
        ("GET", "/collaboration/team"),
        ("GET", "/collaboration/comments"),
        ("GET", "/collaboration/shares"),
        ("GET", "/collaboration/notifications"),
        ("GET", "/collaboration/audit-log"),
        # Clinical trials.
        ("GET", "/clinical-trials"),
        ("POST", "/clinical-trials"),
        # ML Models.
        ("GET", "/ml-models"),
        # Biobank.
        ("GET", "/biobank"),
        # Regulatory.
        ("GET", "/regulatory/irb-submissions"),
        ("GET", "/regulatory/agreements"),
        ("GET", "/regulatory/consent-forms"),
        ("GET", "/regulatory/checklists"),
        # Manuscripts.
        ("GET", "/manuscripts"),
        # Ingestion.
        ("GET", "/ingestion/jobs"),
        ("GET", "/ingestion/queue/stats"),
        # Knowledge graph — entity-centric API surface.
        ("GET", "/knowledge-graph/entities"),
    }
    missing = required - routes
    assert not missing, (
        "Frontend-used routes missing from v1 router — this will 404 in "
        f"the UI. Missing: {sorted(missing)}"
    )


def test_v1_router_has_no_duplicate_paths() -> None:
    """Two `include_router(prefix=…)` calls hitting the same path mean
    which handler wins depends on include order — footgun. Catch
    accidental duplicates."""
    from fastapi.routing import APIRoute

    from app.api.v1 import router

    seen: dict[tuple[str, str], int] = {}
    for r in router.routes:
        if not isinstance(r, APIRoute):
            continue
        for method in r.methods or ():
            key = (method, r.path)
            seen[key] = seen.get(key, 0) + 1

    dupes = {k: v for k, v in seen.items() if v > 1}
    assert not dupes, (
        f"Duplicate (method, path) registrations detected: {dupes}"
    )
