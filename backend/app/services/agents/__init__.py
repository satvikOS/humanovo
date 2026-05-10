"""Grounded-agent layer over Foundry + Bedrock.

Per `feedback_grounded_agents` (2026-05-10): every Foundry/Bedrock model
in Humanovo is invoked as a *tool-calling agent reasoning over project-
supplied data*, never as a raw chat-with-trained-knowledge call. The
agents in this package exist to enforce that contract:

  • Each agent class owns a `run(query, tools, system, max_steps)` loop
    that ALWAYS allows tool invocation and ends only when the model
    emits a final answer (or hits max_steps).
  • Tool calls are routed through `Tool.handler` callables — this is
    where retrieval, citation lookup, KG queries, computation actually
    happen. Tool outputs are JSON-serialised back into the model's
    context as the next turn.
  • `system` defaults to a grounding directive: "Use only information
    returned by tools. If a tool returns nothing, say you don't know
    rather than guess."

The package is provider-agnostic at the call site — `swarm.py`
collaborates between Bedrock-backed and Foundry-backed agents
interchangeably as long as both implement the `GroundedAgent` protocol.

Public surface:

    from app.services.agents import (
        Tool,                # tool definition (name, description, schema, handler)
        AgentResult,         # final result + traced step log
        GroundedAgent,       # Protocol every concrete agent implements
        BedrockClaudeAgent,  # Claude Opus / Sonnet on AWS Bedrock
        FoundryResponsesAgent,  # gpt-4o / o4-mini on Azure Foundry Responses API
        FoundryEmbedder,     # text-embedding-3-large / -small on Foundry
        Swarm,               # multi-agent orchestrator
        DEFAULT_GROUNDING_PROMPT,
    )
"""
from __future__ import annotations

from app.services.agents._types import (
    AgentResult,
    AgentStep,
    DEFAULT_GROUNDING_PROMPT,
    GroundedAgent,
    Tool,
    ToolCall,
)
from app.services.agents.bedrock import BedrockClaudeAgent
from app.services.agents.embeddings import DualEmbedding, FoundryEmbedder
from app.services.agents.foundry import FoundryResponsesAgent
from app.services.agents.swarm import (
    LoopbackEvent,
    Swarm,
    SwarmResult,
    SwarmStage,
    SwarmStageResult,
)

__all__ = [
    "AgentResult",
    "AgentStep",
    "BedrockClaudeAgent",
    "DEFAULT_GROUNDING_PROMPT",
    "DualEmbedding",
    "FoundryEmbedder",
    "FoundryResponsesAgent",
    "GroundedAgent",
    "LoopbackEvent",
    "Swarm",
    "SwarmResult",
    "SwarmStage",
    "SwarmStageResult",
    "Tool",
    "ToolCall",
]
