"""Multi-agent swarm orchestrator.

Coordinates a sequence of `GroundedAgent`s where each agent's output
becomes the next agent's input, optionally with shared tool access.
Models the typical Humanovo discovery pipeline shape:

    explorer  → reasoner → critic → synthesizer
    (Claude    (o4-mini   (gpt-4o   (Claude
     Opus)      Foundry)   Foundry)  Sonnet)

Each stage runs its own grounded-agent loop with the project's tool
set, then hands its final answer to the next stage as the new query.
The swarm captures every step from every agent so the audit trail
shows the full multi-agent reasoning chain.

Per `feedback_grounded_agents`, every stage uses the same tool set —
no stage is allowed to "trust" the previous stage's output as ground
truth without independent retrieval if it makes a new factual claim."""
from __future__ import annotations

import time
from dataclasses import dataclass, field

from app.services.agents._types import (
    AgentResult,
    DEFAULT_GROUNDING_PROMPT,
    GroundedAgent,
    Tool,
)


@dataclass
class SwarmStage:
    """One step in a swarm pipeline."""
    name: str
    agent: GroundedAgent
    instruction: str
    """Stage-specific instruction prepended to the previous stage's output.
    e.g. "Critique the following claim list for unsupported assertions:"."""
    max_steps: int = 6
    system: str = DEFAULT_GROUNDING_PROMPT


@dataclass
class SwarmStageResult:
    name: str
    model_label: str
    text: str
    latency_ms: int
    step_count: int
    tool_call_count: int


@dataclass
class SwarmResult:
    """Aggregate result from `Swarm.run(...)`."""
    stages: list[SwarmStageResult]
    final_text: str
    total_latency_ms: int
    full_traces: list[AgentResult] = field(default_factory=list)
    """Full per-agent traces (each AgentResult contains the step list).
    Surfaced for audit logging — UI may only show the summary."""


class Swarm:
    """Sequential multi-agent orchestrator. Each stage's agent receives
    the previous stage's `text` (prefixed with the stage's instruction)
    as its query, with the same tool set."""

    def __init__(self, stages: list[SwarmStage]) -> None:
        if not stages:
            raise ValueError("Swarm requires at least one stage")
        self.stages = stages

    async def run(
        self,
        query: str,
        tools: list[Tool],
    ) -> SwarmResult:
        t0 = time.monotonic()
        running_input = query
        traces: list[AgentResult] = []
        summaries: list[SwarmStageResult] = []

        for stage in self.stages:
            stage_query = f"{stage.instruction}\n\n{running_input}".strip()
            result = await stage.agent.run(
                stage_query,
                tools=tools,
                system=stage.system,
                max_steps=stage.max_steps,
            )
            traces.append(result)
            summaries.append(SwarmStageResult(
                name=stage.name,
                model_label=result.model_label,
                text=result.text,
                latency_ms=result.latency_ms,
                step_count=len(result.steps),
                tool_call_count=sum(len(s.tool_calls) for s in result.steps),
            ))
            # Pass this stage's final answer into the next stage. If a
            # stage produced empty text (e.g. it errored or hit max_steps
            # without a final answer), the next stage receives the
            # original query — better than feeding garbage downstream.
            if result.text.strip():
                running_input = result.text

        total_latency_ms = int((time.monotonic() - t0) * 1000)
        return SwarmResult(
            stages=summaries,
            final_text=summaries[-1].text if summaries else "",
            total_latency_ms=total_latency_ms,
            full_traces=traces,
        )
