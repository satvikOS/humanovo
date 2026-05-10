"""
AI provider health probe.

Endpoint: GET /admin/ai/health

Probes every configured Bedrock model + Azure OpenAI / Foundry
deployment with a minimal "ping" call (1-token max output, 5 s
timeout) and reports per-model status:

  {
    "providers": {
      "bedrock": [
        { "model": "claude-opus-4-6", "configured": true,
          "reachable": true, "latency_ms": 412 },
        ...
      ],
      "azure": [
        { "model": "gpt-4o", "configured": true,
          "reachable": false, "latency_ms": null,
          "error": "401 Unauthorized" },
        ...
      ]
    },
    "summary": { "configured": 8, "reachable": 7, "down": 1 }
  }

Why: with Bedrock + Azure both wired, a misconfigured key or a
decommissioned model surfaces only when a user kicks off a
discovery run — minutes of wait before the failure shows up. The
health probe lets operators verify their secrets-bootstrap landed
correctly + spot-check provider availability before users hit it.

Caching: results memoised for 30 s so the dashboard polling this
endpoint doesn't hammer the LLMs (each probe costs ~$0.0001 but
they add up at 1 Hz across 8 models).

Auth: admin-only. The probes themselves carry tiny cost; gating
to admin avoids users running them as a DoS vector.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any

from fastapi import APIRouter, Depends

from app.core.auth import ADMIN_REQUIRED
from app.core.config import settings
from app.core.rate_limit import rate_limit

logger = logging.getLogger(__name__)
router = APIRouter(dependencies=[*ADMIN_REQUIRED, Depends(rate_limit("admin"))])


# Cache: { ts: float, payload: dict } — single entry, 30 s TTL.
_cache: dict[str, Any] = {"ts": 0.0, "payload": None}
_CACHE_TTL_S = 30.0


PROBE_TIMEOUT_S = 5.0
PROBE_MAX_TOKENS = 1
# Single space prompt — most permissive content possible (no policy
# filters trigger), and the model's response is a single token.
PROBE_PROMPT = "hi"


async def _probe_bedrock(model_id: str, label: str) -> dict[str, Any]:
    """Probe one Bedrock model. Returns the per-model record."""
    out: dict[str, Any] = {"model": label, "model_id": model_id, "configured": False, "reachable": False, "latency_ms": None, "error": None}
    if not (settings.aws_access_key_value and settings.aws_secret_key_value):
        out["error"] = "AWS credentials not set"
        return out
    out["configured"] = True
    try:
        import boto3
        client = boto3.client(
            "bedrock-runtime",
            region_name=settings.AWS_REGION,
            aws_access_key_id=settings.aws_access_key_value,
            aws_secret_access_key=settings.aws_secret_key_value,
        )
        body = {
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": PROBE_MAX_TOKENS,
            "messages": [{"role": "user", "content": PROBE_PROMPT}],
        }
        loop = asyncio.get_event_loop()
        t0 = time.monotonic()
        await asyncio.wait_for(
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
        out["latency_ms"] = int((time.monotonic() - t0) * 1000)
        out["reachable"] = True
    except asyncio.TimeoutError:
        out["error"] = f"timeout after {PROBE_TIMEOUT_S}s"
    except Exception as e:
        # Don't leak access-key fragments — boto3 sometimes echoes them in errors.
        msg = str(e)
        out["error"] = msg[:200] if msg else type(e).__name__
    return out


async def _probe_azure(
    label: str,
    endpoint: str,
    api_key: str | None,
    deployment: str,
    api_version: str,
    *,
    foundry_shared: bool = False,
) -> dict[str, Any]:
    """
    Probe one Azure deployment. `foundry_shared` flag uses the
    AsyncOpenAI base_url path (Foundry shared endpoint) instead of
    AsyncAzureOpenAI's deployment-routed path.
    """
    out: dict[str, Any] = {"model": label, "deployment": deployment, "configured": False, "reachable": False, "latency_ms": None, "error": None}
    if not (api_key and endpoint):
        out["error"] = "endpoint or key not set"
        return out
    out["configured"] = True
    try:
        if foundry_shared:
            from openai import AsyncOpenAI
            base_url = endpoint.rstrip("/")
            if "services.ai.azure.com" in base_url and not base_url.endswith("/models"):
                base_url = f"{base_url}/models"
            client = AsyncOpenAI(base_url=base_url, api_key=api_key)
        else:
            from openai import AsyncAzureOpenAI
            client = AsyncAzureOpenAI(
                api_key=api_key,
                azure_endpoint=endpoint,
                api_version=api_version,
            )
        t0 = time.monotonic()
        await asyncio.wait_for(
            client.chat.completions.create(
                model=deployment,
                messages=[{"role": "user", "content": PROBE_PROMPT}],
                max_tokens=PROBE_MAX_TOKENS,
            ),
            timeout=PROBE_TIMEOUT_S,
        )
        out["latency_ms"] = int((time.monotonic() - t0) * 1000)
        out["reachable"] = True
    except asyncio.TimeoutError:
        out["error"] = f"timeout after {PROBE_TIMEOUT_S}s"
    except Exception as e:
        msg = str(e)
        out["error"] = msg[:200] if msg else type(e).__name__
    return out


async def _build_payload() -> dict[str, Any]:
    """Run every probe concurrently, assemble the report."""
    bedrock_models = [
        (settings.BEDROCK_MODEL_CLAUDE_OPUS, "claude-opus-4-6"),
        (settings.BEDROCK_MODEL_CLAUDE_SONNET, "claude-sonnet-4"),
    ]
    azure_models = [
        # (label, endpoint, key, deployment, api_version, foundry_shared)
        ("gpt-4o",     settings.AZURE_GPT4O_ENDPOINT,    settings.azure_gpt4o_key_value,    settings.AZURE_GPT4O_DEPLOYMENT,    settings.AZURE_GPT4O_API_VERSION,    False),
        ("o3-mini",    settings.AZURE_O3MINI_ENDPOINT,   settings.azure_o3mini_key_value,   settings.AZURE_O3MINI_DEPLOYMENT,   settings.AZURE_O3MINI_API_VERSION,   False),
        ("cohere-command-a", settings.AZURE_COHERE_ENDPOINT, settings.azure_cohere_key_value, settings.AZURE_COHERE_DEPLOYMENT, settings.AZURE_COHERE_API_VERSION, False),
        ("mistral-large-3", settings.AZURE_MISTRAL_ENDPOINT, settings.azure_mistral_key_value, settings.AZURE_MISTRAL_MODEL, "", True),
    ]
    # GPT-4.1 / Grok endpoints exist on settings but only some
    # deployments have these populated; probe them too if configured.
    gpt41_endpoint = getattr(settings, "AZURE_GPT41_ENDPOINT", "")
    gpt41_key = getattr(settings, "azure_gpt41_key_value", None)
    if gpt41_endpoint and gpt41_key:
        azure_models.append((
            "gpt-4.1",
            gpt41_endpoint,
            gpt41_key,
            getattr(settings, "AZURE_GPT41_DEPLOYMENT", "gpt-4.1"),
            getattr(settings, "AZURE_GPT41_API_VERSION", "2024-11-20"),
            False,
        ))
    grok_endpoint = getattr(settings, "AZURE_GROK_ENDPOINT", "")
    grok_key = getattr(settings, "azure_grok_key_value", None)
    if grok_endpoint and grok_key:
        azure_models.append((
            "grok-4-1-fast",
            grok_endpoint,
            grok_key,
            getattr(settings, "AZURE_GROK_DEPLOYMENT", "grok-4-1-fast-reasoning"),
            "",
            True,
        ))

    bedrock_results, azure_results = await asyncio.gather(
        asyncio.gather(*[_probe_bedrock(mid, lbl) for mid, lbl in bedrock_models]),
        asyncio.gather(*[_probe_azure(*args) for args in azure_models]),
    )

    all_results = list(bedrock_results) + list(azure_results)
    summary = {
        "configured": sum(1 for r in all_results if r["configured"]),
        "reachable": sum(1 for r in all_results if r["reachable"]),
        "down": sum(1 for r in all_results if r["configured"] and not r["reachable"]),
        "total": len(all_results),
    }
    return {
        "providers": {
            "bedrock": list(bedrock_results),
            "azure": list(azure_results),
        },
        "summary": summary,
    }


@router.get("/admin/ai/health")
async def ai_health(force_refresh: bool = False) -> dict[str, Any]:
    """
    Probe every configured AI provider/model. Cached 30 s — pass
    `?force_refresh=true` to bypass the cache (useful right after
    rotating a secret).
    """
    now = time.monotonic()
    if (
        not force_refresh
        and _cache["payload"] is not None
        and (now - _cache["ts"]) < _CACHE_TTL_S
    ):
        return {**_cache["payload"], "cached": True, "cache_age_s": int(now - _cache["ts"])}

    payload = await _build_payload()
    _cache["ts"] = now
    _cache["payload"] = payload
    return {**payload, "cached": False, "cache_age_s": 0}
