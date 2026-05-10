"""
Live-integration tests against AWS Bedrock + Azure AI Foundry.

These run only when the relevant credentials are present in the env
(`AWS_NEW_ACCESS_KEY_ID` / `AWS_NEW_SECRET_ACCESS_KEY` for Bedrock,
`AZURE_AI_KEY` / `AZURE_AI_OPENAI_ENDPOINT` for Azure). When creds
are missing the tests `skip` rather than fail — partial bootstrap
(developer machine without Azure creds, or CI without Bedrock
permissions) is supposed to be fine.

The tests exercise the same surface the CI smoke covers, but at
the pytest level so a developer running `pytest` locally (with
secrets piped in via .env or shell exports) gets the same
coverage signal CI does.

Markers:
  - `@pytest.mark.live` — opt in via `pytest -m live`. Default
    `pytest` invocation skips them (deselect_unmarked default).
"""
from __future__ import annotations

import os

import pytest

from app.services.llm_failover import LLMAttempt, call_with_failover

pytestmark = pytest.mark.live


def _bedrock_available() -> bool:
    return bool(
        os.environ.get("AWS_NEW_ACCESS_KEY_ID")
        or os.environ.get("AWS_ACCESS_KEY_ID")
    ) and bool(
        os.environ.get("AWS_NEW_SECRET_ACCESS_KEY")
        or os.environ.get("AWS_SECRET_ACCESS_KEY")
    )


def _azure_available() -> bool:
    return bool(os.environ.get("AZURE_AI_KEY")) and bool(os.environ.get("AZURE_AI_OPENAI_ENDPOINT"))


@pytest.mark.skipif(not _bedrock_available(), reason="AWS credentials not in env")
@pytest.mark.asyncio
async def test_bedrock_claude_opus_responds() -> None:
    """One round-trip through Claude Opus 4.6 on Bedrock — proves
    the AWS_NEW_* secrets actually authorize InvokeModel calls."""
    import boto3
    import json
    import asyncio

    client = boto3.client(
        "bedrock-runtime",
        region_name=os.environ.get("AWS_REGION", "us-east-1"),
        aws_access_key_id=os.environ.get("AWS_NEW_ACCESS_KEY_ID") or os.environ.get("AWS_ACCESS_KEY_ID"),
        aws_secret_access_key=os.environ.get("AWS_NEW_SECRET_ACCESS_KEY") or os.environ.get("AWS_SECRET_ACCESS_KEY"),
    )
    body = {
        "anthropic_version": "bedrock-2023-05-31",
        "max_tokens": 10,
        "messages": [{"role": "user", "content": "Reply: hi"}],
    }
    loop = asyncio.get_event_loop()
    resp = await loop.run_in_executor(
        None,
        lambda: client.invoke_model(
            modelId="us.anthropic.claude-opus-4-6-v1:0",
            contentType="application/json",
            accept="application/json",
            body=json.dumps(body),
        ),
    )
    payload = json.loads(resp["body"].read())
    text = (payload.get("content") or [{}])[0].get("text", "").strip()
    assert text, "Claude Opus returned empty response"


@pytest.mark.skipif(not _azure_available(), reason="Azure AI credentials not in env")
@pytest.mark.asyncio
async def test_azure_gpt4o_responds() -> None:
    """One round-trip through gpt-4o via the Azure AI Foundry
    OpenAI-style endpoint."""
    from openai import AsyncAzureOpenAI

    client = AsyncAzureOpenAI(
        api_key=os.environ["AZURE_AI_KEY"],
        azure_endpoint=os.environ["AZURE_AI_OPENAI_ENDPOINT"],
        api_version=os.environ.get("AZURE_AI_FOUNDRY_API_VERSION", "2024-12-01-preview"),
    )
    resp = await client.chat.completions.create(
        model="gpt-4o",
        messages=[{"role": "user", "content": "Reply: hi"}],
        max_tokens=10,
    )
    text = (resp.choices[0].message.content or "").strip()
    assert text, "GPT-4o returned empty response"


@pytest.mark.skipif(
    not (_bedrock_available() or _azure_available()),
    reason="Neither AWS nor Azure credentials in env",
)
@pytest.mark.asyncio
async def test_failover_with_real_providers() -> None:
    """End-to-end exercise of the failover primitive against real
    providers — first attempt deliberately fails (bogus model id)
    so the failover path runs and a real working model answers."""
    import boto3
    import json
    import asyncio
    from openai import AsyncAzureOpenAI

    async def bogus_bedrock() -> str:
        # Deliberately invalid model id — Bedrock will 4xx.
        client = boto3.client(
            "bedrock-runtime",
            region_name=os.environ.get("AWS_REGION", "us-east-1"),
            aws_access_key_id=os.environ.get("AWS_NEW_ACCESS_KEY_ID") or os.environ.get("AWS_ACCESS_KEY_ID"),
            aws_secret_access_key=os.environ.get("AWS_NEW_SECRET_ACCESS_KEY") or os.environ.get("AWS_SECRET_ACCESS_KEY"),
        )
        loop = asyncio.get_event_loop()
        resp = await loop.run_in_executor(
            None,
            lambda: client.invoke_model(
                modelId="anthropic.bogus-model-that-does-not-exist-v1:0",
                contentType="application/json",
                accept="application/json",
                body=json.dumps({
                    "anthropic_version": "bedrock-2023-05-31",
                    "max_tokens": 10,
                    "messages": [{"role": "user", "content": "hi"}],
                }),
            ),
        )
        return str(resp)

    async def real_azure() -> str:
        client = AsyncAzureOpenAI(
            api_key=os.environ["AZURE_AI_KEY"],
            azure_endpoint=os.environ["AZURE_AI_OPENAI_ENDPOINT"],
            api_version=os.environ.get("AZURE_AI_FOUNDRY_API_VERSION", "2024-12-01-preview"),
        )
        resp = await client.chat.completions.create(
            model="gpt-4o",
            messages=[{"role": "user", "content": "Reply: hi"}],
            max_tokens=10,
        )
        return resp.choices[0].message.content or ""

    if not _azure_available():
        pytest.skip("Azure creds required for the fallback target")

    response = await call_with_failover([
        LLMAttempt(label="bogus-bedrock", invoke=bogus_bedrock, timeout_s=15),
        LLMAttempt(label="real-azure-gpt-4o", invoke=real_azure, timeout_s=30),
    ])
    assert response.winning_label == "real-azure-gpt-4o"
    assert response.attempts_tried == 2
    # The bogus-bedrock attempt should have an error captured in the
    # outcome trail — proves the failover primitive carried the
    # diagnostic across the boundary.
    assert response.outcomes[0].succeeded is False
    assert response.outcomes[0].error
