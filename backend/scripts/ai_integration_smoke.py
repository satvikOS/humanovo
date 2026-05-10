#!/usr/bin/env python3
"""
AI integration smoke — probe each Bedrock model + each Azure AI
Foundry Responses-API deployment, then report per-stage status.

Designed to run from a GitHub Actions workflow with the secrets
piped in as env vars:

  AWS_NEW_ACCESS_KEY_ID         → AWS access key for Bedrock
  AWS_NEW_SECRET_ACCESS_KEY     → AWS secret key
  AZURE_AI_KEY                  → Azure AI Foundry single key
  AZURE_AI_OPENAI_ENDPOINT      → OpenAI-style endpoint (host or with /openai/v1)
  AZURE_AI_PROJECT_ENDPOINT     → Foundry project endpoint
                                  (e.g. https://<hub>.services.ai.azure.com
                                  /api/projects/<proj>)

Bedrock side: Claude Opus + Sonnet via boto3 invoke_model.

Azure side: Foundry deployments expose the new `/openai/v1/responses`
surface, NOT chat-completions. We call `AsyncOpenAI(base_url=<base>/
openai/v1).responses.create(model=<deployment>, input=<prompt>,
max_output_tokens=N)`. The v1 surface rejects the api-version query
parameter, so it's omitted. Per `feedback_grounded_agents`, these
deployments are smoke-tested for reachability only — application
code wraps them as tool-calling agents reasoning over our retrieved
data, never invoked as raw chat-with-trained-knowledge.

FLUX.2-pro (image gen) is intentionally NOT probed here — different
endpoint shape (no chat/responses path).

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
    """Probe a deployment against the Azure AI Foundry project.

    The Foundry project deployments expose the new `/openai/v1`
    "Responses API" surface (not chat-completions). Target URI from
    the portal looks like:
      https://<hub>.services.ai.azure.com/api/projects/<proj>/openai/v1/responses

    Call shape (OpenAI Python SDK ≥1.50):
      client = AsyncOpenAI(base_url=<base>/openai/v1, api_key=<key>)
      resp = await client.responses.create(
          model=<deployment>,
          input=<prompt>,
          max_output_tokens=10,
      )
      text = resp.output_text

    We also keep a chat-completions fallback for any deployment that
    might still be wired to the legacy endpoint, but Foundry's new
    deployment shape is Responses-API-only. First success wins; the
    label tags which surface answered so the operator can pin it."""
    if not key:
        return ProbeResult(label=label, configured=False, reachable=False, latency_ms=None, error="AZURE_AI_KEY not set")
    if not (openai_endpoint or project_endpoint):
        return ProbeResult(label=label, configured=False, reachable=False, latency_ms=None, error="Neither OPENAI_ENDPOINT nor PROJECT_ENDPOINT set")
    try:
        from openai import AsyncAzureOpenAI, AsyncOpenAI  # type: ignore
    except ImportError:
        return ProbeResult(label=label, configured=True, reachable=False, latency_ms=None, error="openai SDK not installed")

    # Track errors per path separately so the final report tells the
    # operator what each Azure surface actually said. Previously a
    # single `last_error` was overwritten every iteration, so the
    # error from the openai-endpoint path was always hidden by the
    # last project-endpoint error, even when the openai path was
    # the more diagnostic of the two.
    openai_endpoint_err: str | None = None
    foundry_v1_err: str | None = None
    foundry_models_err: str | None = None

    # Endpoints supplied by Azure Foundry's "v1 surface" arrive with
    # path suffixes already baked in (e.g.
    # `https://<resource>.openai.azure.com/openai/v1/` or
    # `https://<hub>.services.ai.azure.com/api/projects/<name>`).
    # Each client below expects a different prefix shape, so we
    # normalize:
    #   • AsyncAzureOpenAI takes JUST the resource host — it appends
    #     `/openai/deployments/<deployment>/chat/completions` itself.
    #   • AsyncOpenAI on the v1 surface takes the FULL base ending in
    #     `/openai/v1` and appends `/chat/completions`.
    #   • AsyncOpenAI on /models takes `<base>/models` and appends
    #     `/chat/completions?api-version=...`.
    def _strip_openai_path(url: str) -> str:
        u = url.rstrip("/")
        for suffix in ("/openai/v1", "/openai"):
            if u.endswith(suffix):
                u = u[: -len(suffix)]
        return u

    def _ensure_v1_path(url: str) -> str:
        u = url.rstrip("/")
        if u.endswith("/openai/v1"):
            return u
        if u.endswith("/openai"):
            return f"{u}/v1"
        return f"{u}/openai/v1"

    def _ensure_models_path(url: str) -> str:
        u = url.rstrip("/")
        for suffix in ("/openai/v1", "/openai"):
            if u.endswith(suffix):
                u = u[: -len(suffix)]
        if u.endswith("/models"):
            return u
        return f"{u}/models"

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

    # Endpoint pattern 1: AsyncAzureOpenAI (resource-style,
    # https://<resource>.openai.azure.com). Cycle api-versions here
    # — same Azure Foundry projects refuse certain preview versions.
    # The SDK appends `/openai/deployments/<deployment>/chat/...`
    # itself, so strip any baked-in `/openai/v1` suffix the operator
    # may have included on the secret.
    openai_resource_host = _strip_openai_path(openai_endpoint) if openai_endpoint else ""
    if openai_resource_host:
        for av in api_version_candidates:
            client_a = AsyncAzureOpenAI(api_key=key, azure_endpoint=openai_resource_host, api_version=av)
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
                        label=f"{label} [{deployment} via openai-endpoint @ {av}]",
                        configured=True, reachable=True, latency_ms=latency,
                        error=None, response_preview=text,
                    )
                except asyncio.TimeoutError:
                    openai_endpoint_err = f"timeout {deployment} @ {av}"
                except Exception as e:
                    openai_endpoint_err = f"{deployment} @ {av}: {str(e)[:200]}"

    # Endpoint pattern 2a: Foundry "v1 surface" Responses API —
    # `<endpoint>/openai/v1` and call `client.responses.create(...)`.
    # This is the NEW deployment shape Azure Foundry creates for
    # gpt-4o / o4-mini / o3 / etc — Target URI in the portal ends
    # with `/openai/v1/responses`. The v1 surface REJECTS the
    # api-version query parameter, so we omit default_query. Try the
    # project endpoint AND the openai endpoint as v1 surfaces.
    v1_bases: list[str] = []
    if project_endpoint:
        v1_bases.append(_ensure_v1_path(project_endpoint))
    if openai_endpoint:
        candidate = _ensure_v1_path(openai_endpoint)
        if candidate not in v1_bases:
            v1_bases.append(candidate)
    for base_v1 in v1_bases:
        client_v1 = AsyncOpenAI(base_url=base_v1, api_key=key)
        for deployment in deployment_candidates:
            t0 = time.monotonic()
            try:
                # Responses API. Some Foundry deployments (o-series)
                # don't accept max_output_tokens=tiny — they need a
                # generous floor for reasoning tokens. 256 is enough
                # for "Reply: hello" with reasoning headroom.
                resp = await asyncio.wait_for(
                    client_v1.responses.create(
                        model=deployment,
                        input=PROBE_PROMPT,
                        max_output_tokens=256,
                    ),
                    timeout=PROBE_TIMEOUT_S,
                )
                latency = int((time.monotonic() - t0) * 1000)
                # Newer SDKs expose .output_text; fall back to walking
                # the output array if not present (older SDKs).
                text = getattr(resp, "output_text", None)
                if not text and hasattr(resp, "output") and resp.output:
                    chunks: list[str] = []
                    for item in resp.output:
                        for c in getattr(item, "content", []) or []:
                            t = getattr(c, "text", None)
                            if t:
                                chunks.append(t)
                    text = "".join(chunks)
                text = (text or "").strip()[:80]
                tag = "foundry-v1" if "services.ai.azure.com" in base_v1 else "openai-v1"
                return ProbeResult(
                    label=f"{label} [{deployment} via {tag}/responses]",
                    configured=True, reachable=True, latency_ms=latency,
                    error=None, response_preview=text,
                )
            except asyncio.TimeoutError:
                foundry_v1_err = f"timeout {deployment} (responses)"
            except Exception as e:
                # If this deployment's surface is chat-completions
                # rather than responses, fall back to chat — error
                # message will mention "responses" or 404 the path.
                err_str = str(e)
                if "responses" in err_str.lower() or "404" in err_str or "not found" in err_str.lower():
                    try:
                        resp = await asyncio.wait_for(
                            client_v1.chat.completions.create(
                                model=deployment,
                                messages=[{"role": "user", "content": PROBE_PROMPT}],
                                max_tokens=10,
                            ),
                            timeout=PROBE_TIMEOUT_S,
                        )
                        latency = int((time.monotonic() - t0) * 1000)
                        text = (resp.choices[0].message.content or "").strip()[:80]
                        tag = "foundry-v1" if "services.ai.azure.com" in base_v1 else "openai-v1"
                        return ProbeResult(
                            label=f"{label} [{deployment} via {tag}/chat]",
                            configured=True, reachable=True, latency_ms=latency,
                            error=None, response_preview=text,
                        )
                    except Exception as e2:
                        foundry_v1_err = f"{deployment}: responses={err_str[:90]} | chat={str(e2)[:90]}"
                else:
                    foundry_v1_err = f"{deployment}: {err_str[:200]}"

    # Endpoint pattern 2b: Foundry /models path — Azure AI inference
    # API. OpenAI SDK is request-shape-compatible enough for chat
    # completions if api-version is supplied as a query param.
    # Normalize the path so we don't end up with /openai/v1/models on
    # an endpoint that already had /openai/v1 baked in.
    if project_endpoint:
        base_models = _ensure_models_path(project_endpoint)
        for av in api_version_candidates:
            client_m = AsyncOpenAI(
                base_url=base_models,
                api_key=key,
                default_query={"api-version": av},
            )
            for deployment in deployment_candidates:
                t0 = time.monotonic()
                try:
                    resp = await asyncio.wait_for(
                        client_m.chat.completions.create(
                            model=deployment,
                            messages=[{"role": "user", "content": PROBE_PROMPT}],
                            max_tokens=10,
                        ),
                        timeout=PROBE_TIMEOUT_S,
                    )
                    latency = int((time.monotonic() - t0) * 1000)
                    text = (resp.choices[0].message.content or "").strip()[:80]
                    return ProbeResult(
                        label=f"{label} [{deployment} via foundry-models @ {av}]",
                        configured=True, reachable=True, latency_ms=latency,
                        error=None, response_preview=text,
                    )
                except asyncio.TimeoutError:
                    foundry_models_err = f"timeout {deployment} @ {av}"
                except Exception as e:
                    foundry_models_err = f"{deployment} @ {av}: {str(e)[:200]}"

    # All three paths failed. Surface the last error from each path
    # so the operator sees whether (a) the openai-endpoint path is
    # blocked by RBAC, (b) /openai/v1 doesn't exist on this hub, or
    # (c) /models rejects the deployment — different fixes.
    parts = []
    if openai_endpoint_err: parts.append(f"openai-endpoint: {openai_endpoint_err}")
    if foundry_v1_err: parts.append(f"foundry-v1: {foundry_v1_err}")
    if foundry_models_err: parts.append(f"foundry-models: {foundry_models_err}")
    return ProbeResult(
        label=label, configured=True, reachable=False, latency_ms=None,
        error=" | ".join(parts) or "no deployment candidate worked on any endpoint pattern",
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
        "label": "critic / synthesizer — GPT-4o (Responses API)",
        "provider": "azure",
        # Operator-confirmed deployment from humanovo-pipeline Foundry
        # project (Target URI: .../api/projects/humanovo-pipeline/openai/v1/responses).
        "deployments": ["gpt-4o"],
    },
    {
        "label": "reasoner — o4-mini (Responses API)",
        "provider": "azure",
        # Operator-confirmed deployment, model_version 2025-04-16.
        # o4-mini is an o-series reasoning model; needs max_output_tokens
        # headroom for reasoning chain.
        "deployments": ["o4-mini"],
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
            # Don't truncate per-path error trail — the GH summary table
            # is the operator's primary diagnostic; truncation here
            # hides exactly the message they need (e.g. which path
            # said "deployment not found" vs "API version not
            # supported"). Markdown table cells handle long content
            # by wrapping; backtick-quoted long text renders fine.
            preview = (r.error or "unknown")
        latency = f"{r.latency_ms} ms" if r.latency_ms else "—"
        lines.append(f"| {r.label} | {status} | {latency} | `{preview}` |")
    summary_count = sum(1 for r in results if r.configured)
    reachable_count = sum(1 for r in results if r.reachable)
    lines.append("")
    lines.append(f"**{reachable_count}/{summary_count} configured providers reachable.**")
    return "\n".join(lines)


async def _list_azure_deployments(openai_endpoint: str, project_endpoint: str, key: str, api_version: str) -> list[str]:
    """Best-effort discovery: hit every plausible Azure deployments-list
    URL so the smoke report can surface the deployment names the
    project actually has, regardless of whether our STAGE_ASSIGNMENTS
    aliases match. Print the per-URL HTTP status + body excerpt so
    the operator can see exactly why each candidate returned nothing
    (404 / 403 / wrong-shape) — this used to be silent, leaving us
    blind on misconfigured projects."""
    if not key:
        return []
    import httpx

    # All the URLs Azure exposes for "list models / deployments" across
    # the resource-style + Foundry-hub variants. Some of these are
    # data-plane (use api-key), some control-plane (use Authorization
    # bearer). Try both auth headers per URL — the wrong header just
    # 401s, no harm.
    #
    # Endpoints supplied by the Foundry "v1 surface" arrive with paths
    # like `/openai/v1/` already baked in, so we strip those before
    # building list-deployment URLs to avoid `/openai/v1/openai/v1/...`.
    def _strip_path(url: str) -> str:
        u = url.rstrip("/")
        for suffix in ("/openai/v1", "/openai"):
            if u.endswith(suffix):
                u = u[: -len(suffix)]
        return u
    urls: list[str] = []
    if openai_endpoint:
        base = _strip_path(openai_endpoint)
        urls.append(f"{base}/openai/deployments?api-version={api_version}")
        urls.append(f"{base}/openai/v1/models")
    if project_endpoint:
        base = _strip_path(project_endpoint)
        urls.append(f"{base}/openai/v1/models")
        urls.append(f"{base}/models?api-version=2024-05-01-preview")
        urls.append(f"{base}/models?api-version={api_version}")

    deployments: list[str] = []
    print("\nDeployment discovery probes:")
    async with httpx.AsyncClient(timeout=10.0) as http:
        for url in urls:
            for header_name in ("api-key", "Authorization"):
                headers = {header_name: key} if header_name == "api-key" else {header_name: f"Bearer {key}"}
                # Don't print the key in the URL — strip the host since
                # GHA already redacts it but defence in depth.
                short_url = url.split("//", 1)[-1].split("?", 1)[0][:80]
                try:
                    resp = await http.get(url, headers=headers)
                    body_excerpt = (resp.text or "")[:160].replace("\n", " ")
                    print(f"  GET {short_url} (auth={header_name}) → {resp.status_code}: {body_excerpt}")
                    if resp.status_code == 200:
                        try:
                            data = resp.json()
                        except Exception:
                            continue
                        items = data.get("data") or data.get("value") or []
                        for item in items:
                            if not isinstance(item, dict):
                                continue
                            name = item.get("id") or item.get("name") or item.get("model")
                            if name and name not in deployments:
                                deployments.append(name)
                        if deployments:
                            return deployments
                except Exception as e:
                    print(f"  GET {short_url} (auth={header_name}) → ERR: {str(e)[:120]}")
    return deployments


async def main() -> int:
    aws_key = os.environ.get("AWS_NEW_ACCESS_KEY_ID") or os.environ.get("AWS_ACCESS_KEY_ID")
    aws_secret = os.environ.get("AWS_NEW_SECRET_ACCESS_KEY") or os.environ.get("AWS_SECRET_ACCESS_KEY")
    aws_region = os.environ.get("AWS_REGION", "us-east-1")
    azure_key = os.environ.get("AZURE_AI_KEY")
    azure_openai_endpoint = os.environ.get("AZURE_AI_OPENAI_ENDPOINT", "")
    azure_api_version = os.environ.get("AZURE_AI_FOUNDRY_API_VERSION", "2024-12-01-preview")

    azure_project_endpoint = os.environ.get("AZURE_AI_PROJECT_ENDPOINT", "")

    # Surface the endpoint configuration up front — if one of these is
    # empty the operator needs to know before they read the per-stage
    # FAILs and assume both endpoint patterns were tried. Print only
    # the host portion so logs don't leak the full URL into the
    # GHA log buffer (it's already redacted as `***` since it came
    # from a secret, but defence in depth).
    def _host(u: str) -> str:
        if not u: return "(unset)"
        try:
            return u.split("//", 1)[1].split("/", 1)[0]
        except Exception:
            return "(parse-fail)"
    print(f"\nEndpoints in env:")
    print(f"  AZURE_AI_OPENAI_ENDPOINT  = {_host(azure_openai_endpoint)}")
    print(f"  AZURE_AI_PROJECT_ENDPOINT = {_host(azure_project_endpoint)}")
    print(f"  AZURE_AI_KEY              = {'set' if azure_key else 'unset'}")
    print(f"  AWS_REGION                = {aws_region}")
    print(f"  AWS_NEW_ACCESS_KEY_ID     = {'set' if aws_key else 'unset'}")

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
