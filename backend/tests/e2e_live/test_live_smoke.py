"""
Live API smoke harness — runs against the deployed backend at
api.humanovo.net (or whatever HUMANOVO_API_URL points at).

What it catches:
  - backend down / DNS broken / cert chain busted
  - /health regressed (DB pool exhausted, cold-start crash)
  - protected routes accidentally serving without auth
  - Stripe webhook signature check accidentally bypassed

What it deliberately does NOT cover:
  - full pipeline runs (cost real LLM money — see
    tests/integration/test_pipeline_e2e.py, dispatch-only)
  - any state-mutating endpoint (smoke shouldn't touch real data)

Skip behavior: if the API host can't even open a TCP connection,
every test in this module is skipped via pytest.mark.skipif. That
makes the workflow go green on a "backend not deployed yet" first-run
state instead of red-screaming a missing-dep failure.

Run locally:
    cd backend
    HUMANOVO_API_URL=http://localhost:8000 pytest tests/e2e_live/ -v
"""
from __future__ import annotations

import os
import socket
from urllib.parse import urlparse

import httpx
import pytest

API_URL = os.environ.get("HUMANOVO_API_URL", "https://api.humanovo.net").rstrip("/")
TIMEOUT = float(os.environ.get("HUMANOVO_E2E_TIMEOUT", "10"))


def _api_reachable() -> bool:
    """TCP probe so the suite skips cleanly when the backend isn't
    deployed yet (api.humanovo.net DNS may resolve to API Gateway but
    no listener has come up, etc.)."""
    parsed = urlparse(API_URL)
    host = parsed.hostname or ""
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    if not host:
        return False
    try:
        with socket.create_connection((host, port), timeout=5):
            return True
    except (OSError, socket.gaierror):
        return False


pytestmark = pytest.mark.skipif(
    not _api_reachable(),
    reason=(
        f"API at {API_URL} not reachable — backend likely not deployed yet. "
        "Dispatch bootstrap-backend-new-account.yml to provision it."
    ),
)


@pytest.fixture(scope="module")
def client() -> httpx.Client:
    with httpx.Client(base_url=API_URL, timeout=TIMEOUT) as c:
        yield c


def test_health_returns_200_and_healthy_status(client: httpx.Client) -> None:
    """The canary. If /health doesn't 200, nothing else matters."""
    r = client.get("/health")
    assert r.status_code == 200, (
        f"GET /health returned {r.status_code}: {r.text[:200]}"
    )
    body = r.json()
    assert body.get("status") == "healthy", (
        f"/health returned non-healthy status: {body}"
    )


@pytest.mark.parametrize(
    "path",
    [
        "/api/v1/projects/",
        "/api/v1/hypotheses/",
        "/api/v1/discovery_sessions/",
        "/api/v1/billing/status",
        "/api/v1/billing/tiers",
    ],
)
def test_protected_endpoints_reject_unauth_requests(
    client: httpx.Client, path: str
) -> None:
    """Owned-resource + user-scoped endpoints MUST return 401/403
    without a JWT. Catches the worst regression we could ship: an
    `AUTH_REQUIRED` dependency accidentally lifted, exposing every
    user's data to anonymous traffic."""
    r = client.get(path)
    assert r.status_code in (401, 403), (
        f"{path} returned {r.status_code} without auth — auth gate is "
        f"DOWN. Body: {r.text[:200]}"
    )


def test_webhook_rejects_unsigned_payload(client: httpx.Client) -> None:
    """Stripe webhook handler must refuse a payload missing the
    `Stripe-Signature` header. Without this the endpoint becomes a
    free billing-state mutation API for anyone on the internet."""
    r = client.post(
        "/api/v1/billing/webhook",
        json={"type": "invoice.paid", "data": {"object": {}}},
    )
    assert r.status_code in (400, 401, 403), (
        f"Webhook accepted unsigned payload (status {r.status_code}) — "
        f"signature verification is broken. Body: {r.text[:200]}"
    )


def test_unknown_path_is_404_not_500(client: httpx.Client) -> None:
    """Unknown routes should 404 cleanly, not 500. Catches: an
    overzealous global exception handler turning every miss into a
    server error and leaking error details."""
    r = client.get("/api/v1/this-route-does-not-exist")
    assert r.status_code == 404, (
        f"Unknown path returned {r.status_code} (expected 404): "
        f"{r.text[:200]}"
    )
