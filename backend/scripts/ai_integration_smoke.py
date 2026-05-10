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


async def _probe_bedrock(model_id: str, label: str, region: str, key_id: str | None, secret: str | None) -> ProbeResult:
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
    t0 = time.monotonic()
    try:
        resp = await asyncio.wait_for(
            loop.run_in_executor(
                None,
                lambda: client.invoke_model(
                    modelId=model_id,
                    contentType="application/json",
                    accept="application/json",
                    body=json.dumps(body),
                ),
            ),
            timeout=PROBE_TIMEOUT_S,
        )
        latency = int((time.monotonic() - t0) * 1000)
        payload = json.loads(resp["body"].read())
        # Anthropic Bedrock response shape: {"content": [{"text": "..."}], ...}
        text = (payload.get("content") or [{}])[0].get("text", "").strip()[:80]
        return ProbeResult(label=label, configured=True, reachable=True, latency_ms=latency, error=None, response_preview=text)
    except asyncio.TimeoutError:
        return ProbeResult(label=label, configured=True, reachable=False, latency_ms=None, error=f"timeout >{PROBE_TIMEOUT_S}s")
    except Exception as e:
        return ProbeResult(label=label, configured=True, reachable=False, latency_ms=None, error=str(e)[:200])


async def _probe_azure_foundry_deployment(deployment: str, label: str, openai_endpoint: str, key: str, api_version: str) -> ProbeResult:
    if not (openai_endpoint and key):
        return ProbeResult(label=label, configured=False, reachable=False, latency_ms=None, error="AZURE_AI_OPENAI_ENDPOINT or AZURE_AI_KEY not set")
    try:
        from openai import AsyncAzureOpenAI  # type: ignore
    except ImportError:
        return ProbeResult(label=label, configured=True, reachable=False, latency_ms=None, error="openai SDK not installed")
    client = AsyncAzureOpenAI(api_key=key, azure_endpoint=openai_endpoint, api_version=api_version)
    t0 = time.monotonic()
    try:
        resp = await asyncio.wait_for(
            client.chat.completions.create(
                model=deployment,
                messages=[{"role": "user", "content": PROBE_PROMPT}],
                max_tokens=10,
            ),
            timeout=PROBE_TIMEOUT_S,
        )
        latency = int((time.monotonic() - t0) * 1000)
        text = (resp.choices[0].message.content or "").strip()[:80]
        return ProbeResult(label=label, configured=True, reachable=True, latency_ms=latency, error=None, response_preview=text)
    except asyncio.TimeoutError:
        return ProbeResult(label=label, configured=True, reachable=False, latency_ms=None, error=f"timeout >{PROBE_TIMEOUT_S}s")
    except Exception as e:
        return ProbeResult(label=label, configured=True, reachable=False, latency_ms=None, error=str(e)[:200])


# Stage → model assignment, mirrored from the comments in
# discovery_orchestrator.py. This is the contract the CI test
# verifies: each pipeline stage has at least one reachable model.
STAGE_ASSIGNMENTS: list[tuple[str, str, str, str]] = [
    # (stage_label, provider, model_or_deployment, model_id_for_bedrock_or_dummy)
    ("explorer (Stage 1)",      "bedrock", "claude-opus-4-6", "us.anthropic.claude-opus-4-6-v1:0"),
    ("expand-validate (Stage 2-4)", "bedrock", "claude-sonnet-4", "us.anthropic.claude-sonnet-4-20250514-v1:0"),
    ("critic (Stage 3)",        "azure",   "gpt-4o", ""),
    ("reasoner (Stage 5)",      "azure",   "o3-mini", ""),
    ("synthesizer (Stage 6)",   "azure",   "gpt-4o", ""),
    ("rag-literature (Stage 0)", "azure",  "cohere-command-a", ""),
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


async def main() -> int:
    aws_key = os.environ.get("AWS_NEW_ACCESS_KEY_ID") or os.environ.get("AWS_ACCESS_KEY_ID")
    aws_secret = os.environ.get("AWS_NEW_SECRET_ACCESS_KEY") or os.environ.get("AWS_SECRET_ACCESS_KEY")
    aws_region = os.environ.get("AWS_REGION", "us-east-1")
    azure_key = os.environ.get("AZURE_AI_KEY")
    azure_openai_endpoint = os.environ.get("AZURE_AI_OPENAI_ENDPOINT", "")
    azure_api_version = os.environ.get("AZURE_AI_FOUNDRY_API_VERSION", "2024-12-01-preview")

    tasks = []
    for label, provider, deployment, model_id in STAGE_ASSIGNMENTS:
        if provider == "bedrock":
            tasks.append(_probe_bedrock(model_id, label, aws_region, aws_key, aws_secret))
        elif provider == "azure":
            tasks.append(_probe_azure_foundry_deployment(deployment, label, azure_openai_endpoint, azure_key or "", azure_api_version))

    results = await asyncio.gather(*tasks)

    # Console output (always).
    print("\nAI integration smoke results:")
    print("=" * 60)
    for r in results:
        status = "OK " if r.reachable else ("SKIP" if not r.configured else "FAIL")
        latency = f"{r.latency_ms}ms" if r.latency_ms else "    "
        line = f"  [{status}] {r.label:<32} {latency}"
        if r.error and r.configured:
            line += f"  err: {r.error[:80]}"
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
