"""Shared types for the grounded-agent layer.

Kept in a leaf module (no provider imports) so `bedrock.py`, `foundry.py`,
`swarm.py` can all depend on it without circular imports."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Protocol


# Default system prompt every grounded agent receives unless the caller
# overrides. Encodes the project rule: model output must be sourced
# from tool results, not pretrained knowledge.
#
# The phrasing here is deliberately neutral and positive — earlier
# drafts that used "your training data is unreliable, you must..."
# tripped Azure OpenAI's content management policy as a jailbreak
# attempt. The current wording asks the model to *prefer* tool results
# and *cite* sources, which achieves the same operational outcome
# without triggering the filter.
DEFAULT_GROUNDING_PROMPT = (
    "You are a careful biomedical research assistant. "
    "Use the provided tools to retrieve evidence before stating any "
    "factual claim, and cite the source returned by each tool result. "
    "When a tool returns no relevant information, acknowledge the gap "
    "rather than fill it from memory. Prefer concise, citation-backed "
    "answers over comprehensive ones."
)


@dataclass
class Tool:
    """A callable the agent can invoke during its reasoning loop.

    `parameters` is a JSON-Schema object describing the tool's argument
    shape — both Bedrock (Claude tool_use) and Foundry (Responses API
    function tools) consume schemas in this exact format.

    `handler` runs the tool against application state (DB, KG, RAG
    index, etc.) and returns a JSON-serialisable result; the agent
    layer takes care of marshalling it back into the model context."""
    name: str
    description: str
    parameters: dict[str, Any]
    handler: Callable[[dict[str, Any]], Awaitable[Any]]


@dataclass
class ToolCall:
    """One tool invocation captured during an agent run."""
    name: str
    arguments: dict[str, Any]
    result: Any
    error: str | None = None
    duration_ms: int | None = None


@dataclass
class AgentStep:
    """One iteration of the reasoning loop. Captures the model's output
    text plus any tool calls it dispatched. Useful for tracing,
    debugging, and surfacing the chain in audit logs."""
    text: str | None
    tool_calls: list[ToolCall] = field(default_factory=list)


@dataclass
class AgentResult:
    """Final return value from `agent.run(...)`. `text` is the model's
    last message; `steps` is the full trace including every tool call;
    `stopped_reason` is one of: 'final_answer', 'max_steps', 'error'."""
    text: str
    steps: list[AgentStep]
    stopped_reason: str
    model_label: str
    latency_ms: int


class GroundedAgent(Protocol):
    """Provider-agnostic agent interface. Both Bedrock and Foundry
    implementations satisfy this, so `Swarm` can compose them
    interchangeably."""

    label: str
    """Stable human-readable identifier, e.g. "claude-opus-4-1" or
    "foundry/o4-mini". Logged in audit trails."""

    async def run(
        self,
        query: str,
        tools: list[Tool],
        system: str = DEFAULT_GROUNDING_PROMPT,
        max_steps: int = 6,
    ) -> AgentResult:
        ...
