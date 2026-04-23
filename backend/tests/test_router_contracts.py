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
    """Parse frontend sources and extract every backend path the UI hits.

    Two call shapes:
    1. apiClient.{method}('/path')   in services/api.ts + knowledge.ts
       (baseURL is /api/v1, so '/path' resolves to /api/v1/path).
    2. fetch(`${API_BASE}/api/v1/path`, { method: 'PUT' })
       Raw fetches in utils/persistence.ts bypass apiClient but still
       depend on the backend's /api/v1 surface — include them.

    Paths are normalized to {X} placeholders so they line up with the
    backend router's parameter shape regardless of parameter name.
    """
    repo_root = Path(__file__).resolve().parents[2]
    frontend_src = repo_root / "frontend" / "src"

    # Only match calls whose literal path starts with '/'. Calls that
    # start with a template variable (e.g. apiClient.get(`${base}/samples`))
    # reference a base URL that can't be statically resolved here — skip
    # those rather than treat them as gaps.
    api_client_pattern = re.compile(
        r"apiClient\.(get|post|patch|put|delete)\(['\"`](/[^'\"`?]+)"
    )
    # fetch(`${...}/api/v1/<path>`, { ..., method: 'PUT' })  — method optional.
    raw_fetch_pattern = re.compile(
        r"fetch\(\s*`[^`]*?/api/v1(/[^`?]+)`"
        r"(?:\s*,\s*\{[^}]*?method\s*:\s*['\"]([A-Z]+)['\"])?",
        re.DOTALL,
    )
    template_var = re.compile(r"\$\{[^}]+\}")

    calls: set[tuple[str, str]] = set()
    for src in frontend_src.rglob("*.ts*"):
        text = src.read_text()
        for method, path in api_client_pattern.findall(text):
            calls.add((method.upper(), template_var.sub("{X}", path)))
        for path, method in raw_fetch_pattern.findall(text):
            calls.add(
                ((method or "GET").upper(), template_var.sub("{X}", path))
            )
    return calls


def _segments_match(fe: str, be: str) -> bool:
    """Treat frontend {X} placeholders as wildcards that match any
    single backend segment, whether literal ('/ttl-cleanup') or
    parameterized ('/{job_id}'). Lengths must be equal.
    """
    fe_parts = fe.split("/")
    be_parts = be.split("/")
    if len(fe_parts) != len(be_parts):
        return False
    for f, b in zip(fe_parts, be_parts):
        if f == "{X}":
            continue
        if f != b:
            return False
    return True


def test_v1_router_mounts_every_frontend_call() -> None:
    """Every (method, path) the frontend calls MUST resolve to a mounted
    FastAPI route. When this drifts the UI 404's silently.

    This is the full coverage guard — parses services/api.ts +
    services/knowledge.ts + any raw fetch() to /api/v1/... at test time,
    so adding a new frontend call without a matching backend handler
    fails this test immediately.
    """
    mounted = _collect_mounted()
    calls = _collect_frontend_calls()
    assert calls, "Could not parse any apiClient calls — frontend sources missing?"

    # Group mounted routes by method so the wildcard check is O(n) per call.
    by_method: dict[str, list[str]] = {}
    for m, p in mounted:
        by_method.setdefault(m, []).append(p)

    missing: list[tuple[str, str]] = []
    for method, path in calls:
        candidates = by_method.get(method, [])
        if not any(_segments_match(path, c) for c in candidates):
            missing.append((method, path))

    assert not missing, (
        "Frontend calls these routes but backend does not mount them "
        f"(UI will 404): {sorted(missing)}"
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
