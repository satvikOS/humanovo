"""Foundry Responses-API agent — tool-calling loop over Azure AI
Foundry's `/openai/v1/responses` surface.

The Responses API differs from chat-completions in three ways that
matter to us:

  1. The endpoint is `/openai/v1/responses` (not `/chat/completions`),
     reached via `client.responses.create(...)` in the OpenAI Python
     SDK ≥ 1.50.
  2. Tools are defined as JSON-Schema function definitions; tool calls
     come back in `response.output` as items with `type='function_call'`,
     and tool results are sent back as `function_call_output` items.
  3. The v1 surface rejects the api-version query parameter — we omit
     `default_query` here. AsyncOpenAI is configured with the v1
     base_url and the Foundry single-key.

Per `feedback_grounded_agents`, this agent is the only way Foundry
deployments are invoked from application code — never raw Responses
calls without tool grounding."""
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


def _ensure_v1_path(url: str) -> str:
    """Normalize a Foundry endpoint URL to end in `/openai/v1`.
    Operator-supplied secrets sometimes already include `/openai/v1/`
    — duplicate suffixes break the SDK, so detect and dedupe."""
    u = url.rstrip("/")
    if u.endswith("/openai/v1"):
        return u
    if u.endswith("/openai"):
        return f"{u}/v1"
    return f"{u}/openai/v1"


class FoundryResponsesAgent:
    """Implements `GroundedAgent` against Azure AI Foundry's Responses
    API. Models like gpt-4o, o4-mini, o3 — anything Foundry lists with
    a Target URI ending in `/openai/v1/responses` — are reachable via
    this agent.

    Key contract: every call goes through a tool-using loop. The
    grounding prompt + tool schemas force the model to retrieve before
    answering."""

    label: str

    def __init__(
        self,
        *,
        deployment: str,
        base_url: str,
        api_key: str,
        max_output_tokens: int = 1024,
        label: str | None = None,
    ) -> None:
        self.deployment = deployment
        self.base_url = _ensure_v1_path(base_url)
        self._api_key = api_key
        self.max_output_tokens = max_output_tokens
        self.label = label or f"foundry/{deployment}"

    async def run(
        self,
        query: str,
        tools: list[Tool],
        system: str = DEFAULT_GROUNDING_PROMPT,
        max_steps: int = 6,
    ) -> AgentResult:
        try:
            from openai import AsyncOpenAI  # type: ignore
        except ImportError as e:
            raise RuntimeError("openai SDK not installed") from e

        client = AsyncOpenAI(base_url=self.base_url, api_key=self._api_key)

        # Responses API tool schema: type='function', name, description,
        # parameters (JSONSchema). Same shape Foundry advertises in its
        # docs.
        tool_specs = [
            {
                "type": "function",
                "name": t.name,
                "description": t.description,
                "parameters": t.parameters,
            }
            for t in tools
        ]
        tools_by_name = {t.name: t for t in tools}

        # Responses API tracks conversation through `previous_response_id`
        # for stateful threading, but to keep tool-result handling
        # explicit we pass the full `input` array on each turn — the
        # model sees the same context either way and we own the
        # reconciliation logic.
        input_items: list[dict[str, Any]] = [
            {"role": "user", "content": [{"type": "input_text", "text": query}]},
        ]

        steps: list[AgentStep] = []
        t0 = time.monotonic()
        stopped = "max_steps"
        final_text = ""

        for _ in range(max_steps):
            kwargs: dict[str, Any] = {
                "model": self.deployment,
                "input": input_items,
                "instructions": system,
                "max_output_tokens": self.max_output_tokens,
            }
            if tool_specs:
                kwargs["tools"] = tool_specs

            resp = await client.responses.create(**kwargs)

            # Extract text + function calls from the response.output
            # item array. Each item has a `type`; we care about
            # `message` (the assistant's text turn) and `function_call`
            # (a tool invocation request).
            step_text_parts: list[str] = []
            function_calls: list[dict[str, Any]] = []
            output_items = list(getattr(resp, "output", []) or [])
            for item in output_items:
                itype = getattr(item, "type", None)
                if itype == "message":
                    for c in getattr(item, "content", []) or []:
                        text_val = getattr(c, "text", None)
                        if text_val:
                            step_text_parts.append(text_val)
                elif itype == "function_call":
                    function_calls.append({
                        "call_id": getattr(item, "call_id", "") or getattr(item, "id", ""),
                        "name": getattr(item, "name", ""),
                        "arguments": getattr(item, "arguments", "{}") or "{}",
                    })

            step_text = ("".join(step_text_parts) or "").strip() or None

            if not function_calls:
                steps.append(AgentStep(text=step_text, tool_calls=[]))
                final_text = step_text or getattr(resp, "output_text", "") or ""
                stopped = "final_answer"
                break

            # The Responses API expects the assistant's function_call
            # items to be echoed back in `input`, followed by matching
            # `function_call_output` items carrying the tool results.
            # Append the function_call items (preserve order).
            for item in output_items:
                if getattr(item, "type", None) == "function_call":
                    input_items.append({
                        "type": "function_call",
                        "call_id": getattr(item, "call_id", "") or getattr(item, "id", ""),
                        "name": getattr(item, "name", ""),
                        "arguments": getattr(item, "arguments", "{}") or "{}",
                    })

            tool_calls_logged: list[ToolCall] = []
            for call in function_calls:
                name = call["name"]
                try:
                    args = json.loads(call["arguments"]) if call["arguments"] else {}
                except json.JSONDecodeError:
                    args = {}
                tool = tools_by_name.get(name)
                t_call = time.monotonic()
                if tool is None:
                    err = f"unknown tool: {name}"
                    tool_calls_logged.append(ToolCall(name=name, arguments=args, result=None, error=err))
                    input_items.append({
                        "type": "function_call_output",
                        "call_id": call["call_id"],
                        "output": json.dumps({"error": err}),
                    })
                    continue
                try:
                    result = await tool.handler(args)
                    duration_ms = int((time.monotonic() - t_call) * 1000)
                    tool_calls_logged.append(ToolCall(
                        name=name, arguments=args, result=result,
                        error=None, duration_ms=duration_ms,
                    ))
                    input_items.append({
                        "type": "function_call_output",
                        "call_id": call["call_id"],
                        "output": json.dumps(result, default=str),
                    })
                except Exception as e:
                    err = f"{type(e).__name__}: {e}"
                    tool_calls_logged.append(ToolCall(name=name, arguments=args, result=None, error=err))
                    input_items.append({
                        "type": "function_call_output",
                        "call_id": call["call_id"],
                        "output": json.dumps({"error": err}),
                    })

            steps.append(AgentStep(text=step_text, tool_calls=tool_calls_logged))

        # If we exited via max_steps without a final-answer turn,
        # downstream stages would receive empty `text` and the swarm
        # would degrade. Recover the last non-empty step text so the
        # next agent has *something* to reason about — better partial
        # context than no context. The stopped_reason still flags
        # max_steps for the audit trail.
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
