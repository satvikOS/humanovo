"""Unit tests for app.core.http_allowlist."""

from __future__ import annotations

import os

import httpx
import pytest

from app.core.http_allowlist import (
    ALLOWED_DOMAINS,
    SSRFBlockedError,
    is_url_allowed,
    make_httpx_client,
)


@pytest.fixture(autouse=True)
def _clear_bypass_env(monkeypatch):
    monkeypatch.delenv("HUMANOVO_HTTP_ALLOWLIST_DISABLE", raising=False)


def test_allowlist_contains_all_v1_wired_domains():
    """Hard-asserts the v1 invariant from INTEGRATION_INVENTORY.md."""
    expected = {
        "rest.uniprot.org",
        "www.ebi.ac.uk",
        "rest.ensembl.org",
        "api.platform.opentargets.org",
        "reactome.org",
        "api.openalex.org",
        "alphafold.ebi.ac.uk",
        "www.proteinatlas.org",
        "eutils.ncbi.nlm.nih.gov",
        "clinicaltrials.gov",
        "api.patentsview.org",
        "api.biorxiv.org",
        "api.crossref.org",
    }
    assert expected.issubset(ALLOWED_DOMAINS)


def test_allowlist_does_not_include_brave_or_google():
    """Brave + Google web-search backends were dropped for v1."""
    assert "api.search.brave.com" not in ALLOWED_DOMAINS
    assert "www.googleapis.com" not in ALLOWED_DOMAINS


def test_allowed_url_passes():
    assert is_url_allowed("https://rest.uniprot.org/uniprotkb/P04637.json") is True


def test_disallowed_url_blocked():
    assert is_url_allowed("https://evil.example/payload") is False


def test_aws_metadata_url_blocked():
    """Classic SSRF target — AWS instance metadata at link-local 169.254.169.254."""
    assert is_url_allowed("http://169.254.169.254/latest/meta-data/") is False


def test_localhost_blocked():
    """Internal services should not be reachable via the integration client."""
    assert is_url_allowed("http://localhost:5432/") is False
    assert is_url_allowed("http://127.0.0.1:6379/") is False


def test_user_pass_prefix_stripped():
    """`https://attacker@allowed.example/...` should evaluate the host, not the userinfo."""
    assert is_url_allowed("https://attacker@evil.example/path") is False
    assert is_url_allowed("https://creds:pw@rest.uniprot.org/path") is True


def test_port_in_authority_does_not_break_match():
    assert is_url_allowed("https://rest.uniprot.org:443/path") is True


def test_case_insensitive_host_match():
    assert is_url_allowed("https://REST.UniProt.ORG/path") is True


def test_relative_url_blocked():
    """Relative URLs have no host and must not be allowed."""
    assert is_url_allowed("/api/v1/projects") is False
    assert is_url_allowed("projects") is False


def test_subdomain_does_not_match_implicitly():
    """`evil.rest.uniprot.org` should NOT inherit `rest.uniprot.org`."""
    assert is_url_allowed("https://evil.rest.uniprot.org/x") is False


def test_bypass_env_var_disables_check(monkeypatch):
    monkeypatch.setenv("HUMANOVO_HTTP_ALLOWLIST_DISABLE", "1")
    assert is_url_allowed("http://169.254.169.254/secrets") is True


def test_bypass_env_var_set_to_other_value_does_not_disable(monkeypatch):
    monkeypatch.setenv("HUMANOVO_HTTP_ALLOWLIST_DISABLE", "0")
    assert is_url_allowed("http://169.254.169.254/secrets") is False


@pytest.mark.asyncio
async def test_httpx_client_blocks_disallowed_url():
    """End-to-end: a request to a non-allowlisted host raises before any network I/O."""
    async with make_httpx_client(timeout=1.0) as client:
        with pytest.raises(SSRFBlockedError) as exc:
            await client.get("https://evil.example/")
        assert exc.value.host == "evil.example"


@pytest.mark.asyncio
async def test_httpx_client_blocks_aws_metadata():
    async with make_httpx_client(timeout=1.0) as client:
        with pytest.raises(SSRFBlockedError):
            await client.get("http://169.254.169.254/latest/meta-data/iam/security-credentials/")


@pytest.mark.asyncio
async def test_httpx_client_preserves_caller_event_hooks():
    """Callers can install their own request hooks; the allowlist hook
    runs after them so logging-style hooks still observe the request."""
    seen: list[str] = []

    async def my_hook(request: httpx.Request) -> None:
        seen.append(str(request.url))

    async with make_httpx_client(timeout=1.0, event_hooks={"request": [my_hook]}) as client:
        with pytest.raises(SSRFBlockedError):
            await client.get("https://evil.example/")

    assert seen == ["https://evil.example/"], "caller hook should observe before allowlist blocks"


@pytest.mark.asyncio
async def test_httpx_client_allows_allowlisted_url_through_to_transport(monkeypatch):
    """The allowlist hook lets allowlisted URLs proceed to httpx's transport.
    We don't want to actually hit the network in unit tests, so we use a
    mock transport that returns 200 without going to the wire."""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"ok": True})

    transport = httpx.MockTransport(handler)
    # We must set up the transport directly because make_httpx_client only
    # forwards constructor kwargs.
    async with make_httpx_client(transport=transport, timeout=1.0) as client:
        resp = await client.get("https://rest.uniprot.org/uniprotkb/P04637.json")
        assert resp.status_code == 200
        assert resp.json() == {"ok": True}
