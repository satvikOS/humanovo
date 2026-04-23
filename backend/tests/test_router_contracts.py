"""
Router-contract guards for the v1 API.

The frontend in services/api.ts + services/knowledge.ts calls specific
(method, path) pairs. When those drift on the backend — a rename, a
prefix change, a forgotten include_router — the UI silently 404's.

These tests introspect the aggregate v1 router shape and assert every
path the frontend depends on is mounted, plus there are no duplicate
(method, path) registrations (which make handler resolution dependent
on include order — a footgun).

No TestClient, no DB, no service clients — pure router-shape
introspection so the suite stays hermetic on CI runners without
postgres / redis / neo4j.
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


def test_v1_router_mounts_core_frontend_routes() -> None:
    routes = _collect_routes()
    required: set[tuple[str, str]] = {
        # Admin — dashboard service-health pill + settings admin tab.
        ("GET", "/admin/health"),
        ("GET", "/admin/kg-stats"),
        ("POST", "/admin/seed-kg"),
        ("POST", "/admin/seed-corpus"),
        # Projects — core resource.
        ("GET", "/projects"),
        ("POST", "/projects"),
        ("GET", "/projects/{project_id}"),
        ("DELETE", "/projects/{project_id}"),
        # Project hypotheses (lives in jamison_api.py — richer payload).
        ("GET", "/projects/{project_id}/hypotheses"),
        # Hypotheses.
        ("GET", "/hypotheses"),
        ("GET", "/hypotheses/{hypothesis_id}"),
        # Evidence.
        ("GET", "/evidence"),
        # Activities (Timeline / Dashboard Recent Activity).
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
        # Biobank — frontend calls /biobank (root) as canonical listing.
        ("GET", "/biobank"),
        ("GET", "/biobank/samples"),
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
        # Knowledge graph — entity-centric API surface consumed by
        # services/knowledge.ts.
        ("GET", "/knowledge-graph/entities"),
        # Notebook (Dashboard widget + Notebook page).
        ("GET", "/notebook/pages"),
    }
    missing = required - routes
    assert not missing, (
        "Frontend-used routes missing from v1 router — the UI will 404 "
        f"silently. Missing: {sorted(missing)}"
    )


def test_v1_router_has_no_duplicate_registrations() -> None:
    """Two include_router() calls landing on the same (method, path) mean
    which handler wins depends on include order — footgun. Catch
    accidental duplicates.
    """
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
    assert not dupes, f"Duplicate (method, path) registrations: {dupes}"
