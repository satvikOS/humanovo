"""Bedrock Claude agent — tool-calling loop over Anthropic's Bedrock
runtime API. Wraps Claude Opus / Sonnet so they participate in the
grounded-agent contract: every factual claim must come from a tool
result, never raw recall."""
from __future__ import annotations

import asyncio
import json
import time
from typing import Any

from app.services.agents._types import (
    AgentResult,
    AgentStep,
    DEFAULT_GROUNDING_PROMPT,
    Tool,
    ToolCall,
)


class BedrockClaudeAgent:
    """Implements `GroundedAgent` against AWS Bedrock's Claude
    `invoke_model` API with tool_use blocks.

    Bedrock's Anthropic models don't have a streaming agent runtime —
    we drive the loop manually: send messages → if response contains
    tool_use blocks, dispatch them and append tool_result messages →
    repeat until a turn returns no tool_use, or max_steps hits."""

    label: str

    def __init__(
        self,
        *,
        model_id: str,
        region: str,
        access_key_id: str,
        secret_access_key: str,
        max_tokens: int = 1024,
        label: str | None = None,
    ) -> None:
        self.model_id = model_id
        self.region = region
        self._access_key = access_key_id
        self._secret_key = secret_access_key
        self.max_tokens = max_tokens
        self.label = label or f"bedrock/{model_id}"

    async def run(
        self,
        query: str,
        tools: list[Tool],
        system: str = DEFAULT_GROUNDING_PROMPT,
        max_steps: int = 6,
    ) -> AgentResult:
        try:
            import boto3  # type: ignore
        except ImportError as e:
            raise RuntimeError("boto3 not installed — required for BedrockClaudeAgent") from e

        client = boto3.client(
            "bedrock-runtime",
            region_name=self.region,
            aws_access_key_id=self._access_key,
            aws_secret_access_key=self._secret_key,
        )

        # Anthropic's Bedrock tool schema is straightforward — name,
        # description, input_schema (JSONSchema). Build once.
        tool_specs = [
            {"name": t.name, "description": t.description, "input_schema": t.parameters}
            for t in tools
        ]
        tools_by_name = {t.name: t for t in tools}

        messages: list[dict[str, Any]] = [
            {"role": "user", "content": [{"type": "text", "text": query}]}
        ]
        steps: list[AgentStep] = []
        loop = asyncio.get_event_loop()
        t0 = time.monotonic()
        stopped = "max_steps"
        final_text = ""

        for _ in range(max_steps):
            body: dict[str, Any] = {
                "anthropic_version": "bedrock-2023-05-31",
                "max_tokens": self.max_tokens,
                "system": system,
                "messages": messages,
            }
            if tool_specs:
                body["tools"] = tool_specs

            resp = await loop.run_in_executor(
                None,
                lambda: client.invoke_model(
                    modelId=self.model_id,
                    contentType="application/json",
                    accept="application/json",
                    body=json.dumps(body),
                ),
            )
            payload = json.loads(resp["body"].read())
            content = payload.get("content") or []

            step_text_parts: list[str] = []
            tool_uses: list[dict[str, Any]] = []
            for block in content:
                btype = block.get("type")
                if btype == "text":
                    step_text_parts.append(block.get("text", ""))
                elif btype == "tool_use":
                    tool_uses.append(block)

            step_text = "".join(step_text_parts).strip() or None

            if not tool_uses:
                # No tool calls — this is the final turn.
                steps.append(AgentStep(text=step_text, tool_calls=[]))
                final_text = step_text or ""
                stopped = "final_answer"
                break

            # Append the assistant turn (with tool_use blocks) verbatim,
            # then dispatch each tool and append a user turn with the
            # results. Anthropic's loop expects these to interleave.
            messages.append({"role": "assistant", "content": content})

            tool_calls_logged: list[ToolCall] = []
            tool_result_blocks: list[dict[str, Any]] = []
            for use in tool_uses:
                name = use.get("name", "")
                tool_use_id = use.get("id", "")
                args = use.get("input") or {}
                tool = tools_by_name.get(name)
                t_call = time.monotonic()
                if tool is None:
                    err = f"unknown tool: {name}"
                    tool_calls_logged.append(ToolCall(name=name, arguments=args, result=None, error=err))
                    tool_result_blocks.append({
                        "type": "tool_result",
                        "tool_use_id": tool_use_id,
                        "is_error": True,
                        "content": err,
                    })
                    continue
                try:
                    result = await tool.handler(args)
                    duration_ms = int((time.monotonic() - t_call) * 1000)
                    tool_calls_logged.append(ToolCall(
                        name=name, arguments=args, result=result,
                        error=None, duration_ms=duration_ms,
                    ))
                    tool_result_blocks.append({
                        "type": "tool_result",
                        "tool_use_id": tool_use_id,
                        "content": json.dumps(result, default=str),
                    })
                except Exception as e:
                    err = f"{type(e).__name__}: {e}"
                    tool_calls_logged.append(ToolCall(name=name, arguments=args, result=None, error=err))
                    tool_result_blocks.append({
                        "type": "tool_result",
                        "tool_use_id": tool_use_id,
                        "is_error": True,
                        "content": err,
                    })

            steps.append(AgentStep(text=step_text, tool_calls=tool_calls_logged))
            messages.append({"role": "user", "content": tool_result_blocks})

        # max_steps recovery — see foundry.py for rationale. Downstream
        # stages need *some* text from this stage even if it didn't
        # produce a final answer in the allotted steps.
        if not final_text and stopped == "max_steps":
            for step in reversed(steps):
                if step.text and step.text.strip():
                    final_text = step.text
                    break

        latency_ms = int((time.monotonic() - t0) * 1000)
        return AgentResult(
            text=final_text,
            steps=steps,
            stopped_reason=stopped,
            model_label=self.label,
            latency_ms=latency_ms,
        )
