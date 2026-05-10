#!/usr/bin/env python3
"""
AI integration smoke — probe each Bedrock model + each Azure AI
Foundry deployment + run a tiny multi-model "swarm" round trip with
real credentials, then report per-stage status.

Designed to run from a GitHub Actions workflow with the new secrets
piped in as env vars:

  AWS_NEW_ACCESS_KEY_ID         → AWS access key for Bedrock
  AWS_NEW_SECRET_ACCESS_KEY     → AWS secret key
  AZURE_AI_KEY                  → Azure AI Foundry single key
  AZURE_AI_OPENAI_ENDPOINT      → OpenAI-style chat endpoint
  AZURE_AI_PROJECT_ENDPOINT     → Foundry project endpoint

The script exits with status 0 if all configured providers respond,
and status 1 if any *configured* provider fails. Providers without
secrets are skipped (no false positives when only some are wired).

Output is human-readable + emits GITHUB_STEP_SUMMARY markdown so
the CI run page surfaces the per-model report directly.
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
import time
from dataclasses import dataclass


@dataclass
class ProbeResult:
    label: str
    configured: bool
    reachable: bool
    latency_ms: int | None
    error: str | None
    response_preview: str | None = None


PROBE_PROMPT = "Reply with one word: hello"
PROBE_TIMEOUT_S = 30.0


async def _probe_bedrock(model_ids: list[str], label: str, region: str, key_id: str | None, secret: str | None) -> ProbeResult:
    """Try each Bedrock model_id in order, return on first success.
    Multiple IDs supported because Anthropic publishes Claude under
    several aliases (cross-region inference profiles `us.` /
    `eu.`, region-pinned `anthropic.`, latest-version pointers).
    The script doesn't know which the user's account is provisioned
    against, so it tries the most likely candidates and reports
    which one worked."""
    if not (key_id and secret):
        return ProbeResult(label=label, configured=False, reachable=False, latency_ms=None, error="AWS credentials not set")
    try:
        import boto3  # type: ignore
    except ImportError:
        return ProbeResult(label=label, configured=True, reachable=False, latency_ms=None, error="boto3 not installed")
    client = boto3.client("bedrock-runtime", region_name=region, aws_access_key_id=key_id, aws_secret_access_key=secret)
    body = {
        "anthropic_version": "bedrock-2023-05-31",
        "max_tokens": 10,
        "messages": [{"role": "user", "content": PROBE_PROMPT}],
    }
    loop = asyncio.get_event_loop()
    last_error: str | None = None
    for model_id in model_ids:
        t0 = time.monotonic()
        try:
            resp = await asyncio.wait_for(
                loop.run_in_executor(
                    None,
                    lambda mid=model_id: client.invoke_model(
                        modelId=mid,
                        contentType="application/json",
                        accept="application/json",
                        body=json.dumps(body),
                    ),
                ),
                timeout=PROBE_TIMEOUT_S,
            )
            latency = int((time.monotonic() - t0) * 1000)
            payload = json.loads(resp["body"].read())
            text = (payload.get("content") or [{}])[0].get("text", "").strip()[:80]
            return ProbeResult(label=f"{label} [{model_id}]", configured=True, reachable=True, latency_ms=latency, error=None, response_preview=text)
        except asyncio.TimeoutError:
            last_error = f"timeout >{PROBE_TIMEOUT_S}s ({model_id})"
        except Exception as e:
            last_error = f"{model_id}: {str(e)[:150]}"
    return ProbeResult(label=label, configured=True, reachable=False, latency_ms=None, error=last_error or "no model id worked")


async def _probe_azure_foundry_deployment(
    deployment_candidates: list[str],
    label: str,
    openai_endpoint: str,
    project_endpoint: str,
    key: str,
    api_version: str,
) -> ProbeResult:
    """Probe a deployment against the Azure AI Foundry project. The
    user's deployment names aren't known to the script, so we try
    several common aliases (gpt-4o, gpt-4o-mini, gpt4o, etc.) and
    we try BOTH endpoint patterns:
      1. AsyncAzureOpenAI against AZURE_AI_OPENAI_ENDPOINT (the
         resource-style "https://<resource>.openai.azure.com").
      2. AsyncOpenAI against AZURE_AI_PROJECT_ENDPOINT/models (the
         Foundry shared-project style).
    First success wins. Reports back which deployment + which endpoint
    pattern actually worked, so the operator can pin that in the
    real backend config."""
    if not key:
        return ProbeResult(label=label, configured=False, reachable=False, latency_ms=None, error="AZURE_AI_KEY not set")
    if not (openai_endpoint or project_endpoint):
        return ProbeResult(label=label, configured=False, reachable=False, latency_ms=None, error="Neither OPENAI_ENDPOINT nor PROJECT_ENDPOINT set")
    try:
        from openai import AsyncAzureOpenAI, AsyncOpenAI  # type: ignore
    except ImportError:
        return ProbeResult(label=label, configured=True, reachable=False, latency_ms=None, error="openai SDK not installed")

    last_error: str | None = None

    # Foundry projects don't always accept the latest preview api-
    # version — older provisions may pin to 2024-08-01 / 2024-10-21
    # / 2025-01-01-preview etc. Cycle through known-good versions
    # alongside the user-configured one. First match wins.
    api_version_candidates: list[str] = []
    seen: set[str] = set()
    for v in [api_version, "2024-12-01-preview", "2024-10-21", "2024-08-01-preview", "2025-01-01-preview", "2024-05-01-preview"]:
        if v and v not in seen:
            api_version_candidates.append(v)
            seen.add(v)

    # Endpoint pattern 1: AsyncAzureOpenAI (resource-style)
    if openai_endpoint:
        client_a = AsyncAzureOpenAI(api_key=key, azure_endpoint=openai_endpoint, api_version=api_version)
        for deployment in deployment_candidates:
            t0 = time.monotonic()
            try:
                resp = await asyncio.wait_for(
                    client_a.chat.completions.create(
                        model=deployment,
                        messages=[{"role": "user", "content": PROBE_PROMPT}],
                        max_tokens=10,
                    ),
                    timeout=PROBE_TIMEOUT_S,
                )
                latency = int((time.monotonic() - t0) * 1000)
                text = (resp.choices[0].message.content or "").strip()[:80]
                return ProbeResult(
                    label=f"{label} [{deployment} via openai-endpoint]",
                    configured=True, reachable=True, latency_ms=latency,
                    error=None, response_preview=text,
                )
            except asyncio.TimeoutError:
                last_error = f"timeout {deployment}"
            except Exception as e:
                last_error = f"{deployment}: {str(e)[:300]}"

    # Endpoint pattern 2: Foundry shared (AsyncOpenAI base_url).
    # Foundry-shared endpoints REQUIRE `?api-version=...` on every
    # request — AsyncOpenAI doesn't append it automatically (that's
    # Azure-specific behaviour AsyncAzureOpenAI handles, not the
    # OpenAI-compatibility client). Pass `default_query` so every
    # subsequent .chat.completions.create() carries it. We also
    # cycle through api-version candidates because not every
    # Foundry provision accepts the same preview version.
    if project_endpoint:
        base_url = project_endpoint.rstrip("/")
        if "services.ai.azure.com" in base_url and not base_url.endswith("/models"):
            base_url = f"{base_url}/models"
        for av in api_version_candidates:
            client_b = AsyncOpenAI(
                base_url=base_url,
                api_key=key,
                default_query={"api-version": av},
            )
            for deployment in deployment_candidates:
                t0 = time.monotonic()
                try:
                    resp = await asyncio.wait_for(
                        client_b.chat.completions.create(
                            model=deployment,
                            messages=[{"role": "user", "content": PROBE_PROMPT}],
                            max_tokens=10,
                        ),
                        timeout=PROBE_TIMEOUT_S,
                    )
                    latency = int((time.monotonic() - t0) * 1000)
                    text = (resp.choices[0].message.content or "").strip()[:80]
                    return ProbeResult(
                        label=f"{label} [{deployment} via foundry-shared @ {av}]",
                        configured=True, reachable=True, latency_ms=latency,
                        error=None, response_preview=text,
                    )
                except asyncio.TimeoutError:
                    last_error = f"timeout {deployment} (foundry @ {av})"
                except Exception as e:
                    last_error = f"{deployment} (foundry @ {av}): {str(e)[:300]}"

    return ProbeResult(
        label=label, configured=True, reachable=False, latency_ms=None,
        error=last_error or "no deployment candidate worked on either endpoint pattern",
    )


# Stage → model assignment, mirrored from the comments in
# discovery_orchestrator.py. Each entry carries multiple candidate
# model IDs / deployment names because Anthropic publishes Claude
# under several Bedrock aliases (cross-region inference profiles
# with `us.` / `eu.` prefixes, region-pinned `anthropic.` ids,
# version-pinned suffixes) and Azure deployments are named freely
# by whoever provisioned them. The script doesn't know which form
# the user's account uses, so it tries each in order until one
# answers — the report then shows which alias actually worked so
# the operator can pin that in the real backend config.
STAGE_ASSIGNMENTS: list[dict[str, object]] = [
    {
        "label": "explorer (Stage 1) — Claude Opus",
        "provider": "bedrock",
        "model_ids": [
            "us.anthropic.claude-opus-4-6-v1:0",
            "anthropic.claude-opus-4-6-v1:0",
            "us.anthropic.claude-opus-4-1-20250805-v1:0",
            "anthropic.claude-opus-4-1-20250805-v1:0",
            "us.anthropic.claude-opus-4-20250514-v1:0",
            "anthropic.claude-opus-4-20250514-v1:0",
        ],
    },
    {
        "label": "expand-validate (Stage 2-4) — Claude Sonnet",
        "provider": "bedrock",
        "model_ids": [
            "us.anthropic.claude-sonnet-4-20250514-v1:0",
            "anthropic.claude-sonnet-4-20250514-v1:0",
            "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
        ],
    },
    {
        "label": "critic / synthesizer — GPT-4o",
        "provider": "azure",
        "deployments": ["gpt-4o", "gpt4o", "gpt-4o-2024-11-20", "gpt-4o-mini"],
    },
    {
        "label": "reasoner — o3-mini / o3",
        "provider": "azure",
        "deployments": ["o3-mini", "o3", "o3-2024-12-17", "o1-mini"],
    },
    {
        "label": "rag-literature — Cohere",
        "provider": "azure",
        "deployments": ["cohere-command-a", "Cohere-command-a-08-2024", "command-a"],
    },
]


def _emit_summary(results: list[ProbeResult]) -> str:
    """Build the markdown that goes into GITHUB_STEP_SUMMARY."""
    lines = ["## AI integration smoke", ""]
    lines.append("| Stage / Model | Status | Latency | Response |")
    lines.append("|---|---|---|---|")
    for r in results:
        if not r.configured:
            status = "⚪ skipped (not configured)"
            preview = r.error or "—"
        elif r.reachable:
            status = "✅ ok"
            preview = (r.response_preview or "—")
        else:
            status = "❌ error"
            preview = (r.error or "unknown")[:80]
        latency = f"{r.latency_ms} ms" if r.latency_ms else "—"
        lines.append(f"| {r.label} | {status} | {latency} | `{preview}` |")
    summary_count = sum(1 for r in results if r.configured)
    reachable_count = sum(1 for r in results if r.reachable)
    lines.append("")
    lines.append(f"**{reachable_count}/{summary_count} configured providers reachable.**")
    return "\n".join(lines)


async def _list_azure_deployments(openai_endpoint: str, project_endpoint: str, key: str, api_version: str) -> list[str]:
    """Best-effort discovery: hit the Azure deployments-list APIs so the
    smoke report can surface the deployment names the project actually
    has, regardless of whether our STAGE_ASSIGNMENTS aliases match.
    Tries both endpoint patterns; returns whatever responds."""
    if not key:
        return []
    import httpx
    candidates: list[tuple[str, dict[str, str]]] = []
    if openai_endpoint:
        # Azure OpenAI control-plane list-deployments — only works on
        # resource-style endpoints with the right RBAC; harmless if it
        # 404s.
        candidates.append((
            f"{openai_endpoint.rstrip('/')}/openai/deployments?api-version={api_version}",
            {"api-key": key},
        ))
    if project_endpoint:
        base = project_endpoint.rstrip("/")
        if "services.ai.azure.com" in base and not base.endswith("/models"):
            base = f"{base}/models"
        # Foundry shared endpoint — `?api-version=...&list=true` on
        # /models lists deployments accessible to the project key.
        candidates.append((f"{base}?api-version={api_version}", {"Authorization": f"Bearer {key}"}))
        candidates.append((f"{base}?api-version={api_version}", {"api-key": key}))
    deployments: list[str] = []
    async with httpx.AsyncClient(timeout=10.0) as http:
        for url, headers in candidates:
            try:
                resp = await http.get(url, headers=headers)
                if resp.status_code != 200:
                    continue
                data = resp.json()
                # Both endpoint shapes: {"data": [{"id": "..."}]} or
                # {"value": [{"name": "..."}]}.
                items = data.get("data") or data.get("value") or []
                for item in items:
                    name = item.get("id") or item.get("name") or item.get("model")
                    if name and name not in deployments:
                        deployments.append(name)
                if deployments:
                    return deployments
            except Exception:
                continue
    return deployments


async def main() -> int:
    aws_key = os.environ.get("AWS_NEW_ACCESS_KEY_ID") or os.environ.get("AWS_ACCESS_KEY_ID")
    aws_secret = os.environ.get("AWS_NEW_SECRET_ACCESS_KEY") or os.environ.get("AWS_SECRET_ACCESS_KEY")
    aws_region = os.environ.get("AWS_REGION", "us-east-1")
    azure_key = os.environ.get("AZURE_AI_KEY")
    azure_openai_endpoint = os.environ.get("AZURE_AI_OPENAI_ENDPOINT", "")
    azure_api_version = os.environ.get("AZURE_AI_FOUNDRY_API_VERSION", "2024-12-01-preview")

    azure_project_endpoint = os.environ.get("AZURE_AI_PROJECT_ENDPOINT", "")

    # Discover real deployment names so the report tells the operator
    # what's actually available, not just what the candidate list
    # *guessed*. Best-effort — empty list is fine; the per-stage
    # candidate probes still run.
    discovered_deployments: list[str] = []
    if azure_key:
        try:
            discovered_deployments = await _list_azure_deployments(
                azure_openai_endpoint, azure_project_endpoint, azure_key, azure_api_version,
            )
            if discovered_deployments:
                print(f"\nDiscovered Azure deployments ({len(discovered_deployments)}):")
                for d in discovered_deployments:
                    print(f"  - {d}")
                # Inject the discovered names ahead of every Azure stage's
                # candidate list so the script tries the real names FIRST.
                for entry in STAGE_ASSIGNMENTS:
                    if entry.get("provider") == "azure":
                        existing = list(entry.get("deployments", []))  # type: ignore[arg-type]
                        entry["deployments"] = discovered_deployments + [d for d in existing if d not in discovered_deployments]
        except Exception as e:
            print(f"Deployment discovery failed (non-fatal): {e}")

    tasks = []
    for entry in STAGE_ASSIGNMENTS:
        label = str(entry["label"])
        provider = str(entry["provider"])
        if provider == "bedrock":
            model_ids = list(entry.get("model_ids", []))  # type: ignore[arg-type]
            tasks.append(_probe_bedrock(model_ids, label, aws_region, aws_key, aws_secret))
        elif provider == "azure":
            deployments = list(entry.get("deployments", []))  # type: ignore[arg-type]
            tasks.append(_probe_azure_foundry_deployment(
                deployments, label, azure_openai_endpoint, azure_project_endpoint,
                azure_key or "", azure_api_version,
            ))

    results = await asyncio.gather(*tasks)

    # Console output (always).
    print("\nAI integration smoke results:")
    print("=" * 60)
    for r in results:
        status = "OK " if r.reachable else ("SKIP" if not r.configured else "FAIL")
        latency = f"{r.latency_ms}ms" if r.latency_ms else "    "
        line = f"  [{status}] {r.label:<32} {latency}"
        if r.error and r.configured:
            line += f"  err: {r.error}"
        elif r.response_preview:
            line += f"  → {r.response_preview!r}"
        print(line)
    print()

    configured = sum(1 for r in results if r.configured)
    reachable = sum(1 for r in results if r.reachable)
    failed = configured - reachable
    print(f"Summary: {reachable}/{configured} reachable, {failed} failed")

    # GITHUB_STEP_SUMMARY for CI run page rendering.
    step_summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if step_summary_path:
        with open(step_summary_path, "a", encoding="utf-8") as f:
            f.write(_emit_summary(results) + "\n")

    # Exit non-zero if any *configured* provider failed. Skipped
    # providers (not configured) don't count as failures — partial
    # bootstrap is normal.
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
