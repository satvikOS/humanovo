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

import re
from pathlib import Path


# Frontend placeholder names (${id}) don't match backend param names
# ({project_id}), so we normalize both sides to {X} before comparison.
_PLACEHOLDER = re.compile(r"\{[^}]+\}")


def _generic(path: str) -> str:
    return _PLACEHOLDER.sub("{X}", path)


def _collect_mounted() -> set[tuple[str, str]]:
    from fastapi.routing import APIRoute

    from app.api.v1 import router

    mounted: set[tuple[str, str]] = set()
    for r in router.routes:
        if not isinstance(r, APIRoute):
            continue
        for method in r.methods or ():
            mounted.add((method, _generic(r.path)))
    return mounted


def _collect_frontend_calls() -> set[tuple[str, str]]:
    """Parse services/api.ts + services/knowledge.ts and extract every
    apiClient.{method}('/path') call the frontend makes. Paths are
    normalized to {X} placeholders so they line up with the backend
    router's parameter shape.
    """
    repo_root = Path(__file__).resolve().parents[2]
    sources = [
        repo_root / "frontend" / "src" / "services" / "api.ts",
        repo_root / "frontend" / "src" / "services" / "knowledge.ts",
    ]
    call_pattern = re.compile(
        r"apiClient\.(get|post|patch|put|delete)\(['\"`]([^'\"`?]+)"
    )
    template_var = re.compile(r"\$\{[^}]+\}")

    calls: set[tuple[str, str]] = set()
    for src in sources:
        if not src.exists():
            continue
        text = src.read_text()
        for method, path in call_pattern.findall(text):
            calls.add((method.upper(), template_var.sub("{X}", path)))
    return calls


def test_v1_router_mounts_every_frontend_call() -> None:
    """Every (method, path) the frontend calls MUST resolve to a mounted
    FastAPI route. When this drifts the UI 404's silently.

    This is the full coverage guard — parses services/api.ts +
    services/knowledge.ts at test time so adding a new frontend call
    without a matching backend handler fails this test immediately.
    """
    mounted = _collect_mounted()
    calls = _collect_frontend_calls()
    assert calls, "Could not parse any apiClient calls — frontend sources missing?"

    missing = sorted(c for c in calls if c not in mounted)
    assert not missing, (
        "Frontend calls these routes but backend does not mount them "
        f"(UI will 404): {missing}"
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
