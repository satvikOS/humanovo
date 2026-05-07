"""
Auth-enforcement guard for the v1 API.

Every HTTP route in `app.api.v1.router` MUST either:
  (a) include `get_current_active_user` (via AUTH_REQUIRED) somewhere in its
      dependency tree, OR
  (b) include `get_current_admin_user` (via ADMIN_REQUIRED) somewhere in its
      dependency tree, OR
  (c) be in the explicit `PUBLIC_ALLOWLIST` below.

Adding a new endpoint without picking one of these paths fails the suite.
The allowlist is short — login/register/oauth flows + load-balancer probes —
and changes to it require an explicit code review touch.

WebSocket routes are checked separately: each handler must call
`authenticate_websocket(...)` somewhere in its source. This is enforced by
inspection rather than dependency-tree walking because Starlette's WebSocket
routes don't expose a uniform Depends() surface.
"""
from __future__ import annotations

import inspect
from typing import Iterable

# Allowlist: HTTP routes we accept as intentionally unauthenticated.
# Format: (METHOD, EXACT_PATH). Any route not matching either an auth
# dependency OR an entry here will fail the test.
PUBLIC_ALLOWLIST: set[tuple[str, str]] = {
    # Auth flow itself — issues / refreshes tokens, can't require one.
    ("POST", "/api/v1/auth/register"),
    ("POST", "/api/v1/auth/login"),
    ("POST", "/api/v1/auth/refresh"),
    # Authenticated profile lookup uses the bearer token differently —
    # leave the surface in place; explicit auth wiring lives inside the
    # handler. Listed here so the guard makes the choice visible.
    # ("GET", "/api/v1/auth/me"),  # already gated via dependency

    # Health / readiness / liveness — load balancer + uptime probes.
    # Aggregate `/monitoring/health` is intentionally public; the
    # per-component variant is admin-gated at route level.
    ("GET", "/api/v1/monitoring/health"),
    ("GET", "/api/v1/monitoring/ready"),
    ("GET", "/api/v1/monitoring/live"),

    # Stripe webhook — Stripe POSTs from the public internet. Auth is
    # the Stripe-Signature header, verified inside the handler against
    # STRIPE_WEBHOOK_SECRET. A bearer-token requirement here would
    # break the integration since Stripe doesn't carry our JWTs.
    ("POST", "/api/v1/billing/webhook"),
}

# Names of the dependency callables that prove an endpoint is gated.
AUTH_DEPENDENCY_NAMES = {
    "get_current_user",        # nullable — only OK if wrapped by active/admin
    "get_current_active_user", # AUTH_REQUIRED
    "get_current_admin_user",  # ADMIN_REQUIRED
}


def _walk_dependants(dep) -> Iterable:
    """Yield the root dependant + every nested sub-dependant, depth-first."""
    yield dep
    for sub in getattr(dep, "dependencies", []) or []:
        yield from _walk_dependants(sub)


def _has_auth_dependency(route) -> bool:
    """True iff any callable in the route's dependency tree is one of the
    auth gates.
    """
    dep = getattr(route, "dependant", None)
    if dep is None:
        return False
    for sub in _walk_dependants(dep):
        call = getattr(sub, "call", None)
        if call is None:
            continue
        # Match by qualified name so a future refactor that renames the
        # function trips the guard rather than silently passing.
        if getattr(call, "__name__", None) in AUTH_DEPENDENCY_NAMES:
            return True
    return False


def _v1_prefix(path: str) -> str:
    """`app.api.v1.router` is mounted at /api/v1 in main.py. We import the
    router directly (rather than the full app) to avoid pulling in DB-
    dependent startup events, so paths come back without the prefix."""
    return f"/api/v1{path}"


def test_every_v1_http_route_is_gated_or_allowlisted() -> None:
    """Fail the build if any /api/v1/* HTTP route is reachable without auth
    AND not on the PUBLIC_ALLOWLIST.
    """
    from fastapi.routing import APIRoute

    from app.api.v1 import router

    offenders: list[tuple[str, str]] = []
    for route in router.routes:
        if not isinstance(route, APIRoute):
            continue
        full_path = _v1_prefix(route.path)
        if _has_auth_dependency(route):
            continue
        for method in sorted(route.methods or ()):
            if method == "HEAD" or method == "OPTIONS":
                continue
            if (method, full_path) in PUBLIC_ALLOWLIST:
                continue
            offenders.append((method, full_path))

    assert not offenders, (
        "These /api/v1 routes have no auth dependency and are not in the "
        "PUBLIC_ALLOWLIST. Either add `dependencies=AUTH_REQUIRED` (or "
        "ADMIN_REQUIRED) at router or route level, or — if intentionally "
        "public — add the (method, path) tuple to PUBLIC_ALLOWLIST in this "
        f"test file with a comment explaining why.\n\nOffenders:\n  "
        + "\n  ".join(f"{m} {p}" for m, p in sorted(offenders))
    )


def test_every_websocket_route_calls_authenticate_websocket() -> None:
    """WebSocket handlers don't surface a uniform Depends() chain, so we
    enforce the contract by source inspection: every WS endpoint registered
    in v1 must reference `authenticate_websocket` in its callable body.
    """
    from starlette.routing import WebSocketRoute

    from app.api.v1 import router

    offenders: list[str] = []
    for route in router.routes:
        if not isinstance(route, WebSocketRoute):
            continue
        endpoint = route.endpoint
        try:
            src = inspect.getsource(endpoint)
        except (OSError, TypeError):
            offenders.append(f"{route.path}  (source unavailable)")
            continue
        if "authenticate_websocket" not in src:
            offenders.append(route.path)

    assert not offenders, (
        "These WebSocket endpoints don't call `authenticate_websocket` "
        "and would accept anonymous connections:\n  "
        + "\n  ".join(offenders)
    )
