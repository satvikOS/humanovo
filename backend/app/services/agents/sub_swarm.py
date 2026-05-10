"""Sub-agent swarm — N parallel sub-agents per stage, then aggregate.

Per user direction (2026-05-10): every stage in the 12-stage discovery
pipeline runs as a swarm of N sub-agents (default 300 in production)
that each tackle the same query with a different perspective/persona,
then a final aggregator distills their outputs into one canonical
answer for the next stage.

Why the swarm?
  • Bias diversification — single-model output can carry that model's
    blind spots; 300 parallel attempts surface where the "median"
    sits, and disagreement between sub-agents flags genuinely
    contested claims.
  • Robustness — a single sub-agent's empty / off-topic / refused
    output doesn't kill the stage; the aggregator can still distill
    from the surviving 290+.
  • Audit trail — every sub-agent run is captured in the
    `SubAgentRun` log, so the audit log can show *what variations
    of the question were considered* and which the aggregator
    weighted heaviest.

What we DON'T do here:
  • Cross-model routing (sub-agent-1 = Claude, sub-agent-2 = GPT-4o,
    etc.) — the substitution map in `swarm_smoke.py` handles cross-
    model assignment at the STAGE level. Sub-agents within a stage
    share the base model; the variation is persona/prompt-level.
  • Tournament / multi-round voting — out of scope for v1; the v2
    upgrade path is to layer a `TournamentAggregator` over this
    primitive.

Implements `GroundedAgent` so it slots into `SwarmStage` exactly
where a single agent went before."""
from __future__ import annotations

import asyncio
import os
import time
from dataclasses import dataclass, field

from app.services.agents._types import (
    AgentResult,
    AgentStep,
    DEFAULT_GROUNDING_PROMPT,
    GroundedAgent,
    Tool,
)
from app.services.agents.pricing import TokenUsage


# Pool of persona suffixes appended to each sub-agent's system prompt.
# These bias the sub-agent toward a different reasoning lens. 50
# distinct lenses → at N=300 each persona is sampled ~6 times with
# different downstream stochasticity in the model itself; at N=50
# each persona runs once. Keep additions short (under 100 chars) so
# they don't dominate the system prompt.
DEFAULT_PERSONAS: list[str] = [
    "Approach this as a careful empiricist who insists on citations for every claim.",
    "Approach this as a skeptical reviewer probing the weakest assumption.",
    "Approach this as a domain expert in human molecular genetics.",
    "Approach this as a clinical researcher focused on patient-relevant endpoints.",
    "Approach this as a translational scientist mapping bench-to-bedside steps.",
    "Approach this as a regulatory reviewer assessing what evidence FDA would require.",
    "Approach this as a patient advocate weighing benefit-risk tradeoffs.",
    "Approach this as a contrarian looking for the strongest counter-argument.",
    "Approach this as a meta-analyst weighting multiple evidence streams.",
    "Approach this as a mechanism-of-action specialist tracing molecular pathways.",
    "Approach this as a pharmacologist focused on dose, exposure, and toxicity.",
    "Approach this as a structural biologist starting from protein interfaces.",
    "Approach this as a pathway biologist tracing upstream and downstream effects.",
    "Approach this as a population geneticist weighing variant frequencies.",
    "Approach this as an epidemiologist asking about real-world incidence.",
    "Approach this as a biostatistician scrutinising effect sizes and CIs.",
    "Approach this as a tumour-immunology specialist.",
    "Approach this as a DNA-damage-response specialist.",
    "Approach this as a metabolism specialist.",
    "Approach this as a chromatin / epigenetics specialist.",
    "Approach this as a gene-therapy specialist asking about delivery.",
    "Approach this as a CRISPR/gene-editing specialist.",
    "Approach this as a small-molecule medicinal chemist.",
    "Approach this as a biologic / antibody engineer.",
    "Approach this as a cell-therapy specialist.",
    "Approach this as a peptide therapeutics specialist.",
    "Approach this as an RNA therapeutics specialist (siRNA / ASO / mRNA).",
    "Approach this as a microbiome specialist.",
    "Approach this as a developmental biologist.",
    "Approach this as a stem-cell biologist.",
    "Approach this as a neuroscience specialist if any neural angle exists.",
    "Approach this as a cardiology specialist if any cardiovascular angle exists.",
    "Approach this as an immuno-oncology specialist.",
    "Approach this as a rare-disease specialist asking about applicability to rare cohorts.",
    "Approach this as a paediatric researcher considering paediatric extrapolation.",
    "Approach this as a geriatric researcher considering ageing biology.",
    "Approach this as a sex-differences researcher checking for X-Y chromosome effects.",
    "Approach this as an ancestry-aware researcher asking about generalisability.",
    "Approach this as a microenvironment specialist (stroma, vasculature, ECM).",
    "Approach this as a bioinformatics specialist asking what dataset would prove it.",
    "Approach this as a single-cell biologist asking about cellular heterogeneity.",
    "Approach this as a proteomics specialist asking about post-translational state.",
    "Approach this as a metabolomics specialist asking about metabolite signatures.",
    "Approach this as an imaging biomarker specialist.",
    "Approach this as a liquid-biopsy specialist (cfDNA, CTCs, exosomes).",
    "Approach this as a digital-pathology specialist.",
    "Approach this as a real-world evidence specialist (registries, EHR).",
    "Approach this as a health-economics specialist (QALYs, cost-effectiveness).",
    "Approach this as a manufacturing / CMC specialist asking about scalability.",
    "Approach this as a clinical-trial-design specialist (endpoints, statistics, FDA).",
]


@dataclass
class SubAgentRun:
    """One sub-agent's output captured for the audit trail."""
    index: int
    persona: str
    model_label: str
    text: str
    usage: TokenUsage
    cost_cents: float
    stopped_reason: str
    tool_call_count: int
    error: str | None = None


@dataclass
class SubSwarmResult:
    """Audit-detail layer attached to each sub-swarm run. The
    AgentResult returned by `.run()` is the aggregated single answer;
    this carries the per-sub-agent traces so the audit log can show
    every perspective considered."""
    sub_runs: list[SubAgentRun]
    aggregator_text: str
    aggregator_cost_cents: float
    successful_runs: int
    failed_runs: int


def _resolve_n_subagents(default: int = 300) -> int:
    """Honour the HUMANOVO_SUBAGENTS env override so CI can run with
    a small N (cost-bounded) while production stays at 300.
    Resolution order:
      1. HUMANOVO_SUBAGENTS env (operator override per run)
      2. settings.SUB_AGENTS_PER_STAGE (production default, 300)
      3. The hardcoded `default` argument."""
    val = os.environ.get("HUMANOVO_SUBAGENTS", "").strip()
    if val:
        try:
            return max(1, int(val))
        except ValueError:
            pass
    # Settings lookup is best-effort — sub_swarm is imported by the
    # CI smoke without a full backend bootstrap, so settings may
    # not be importable in every context. Fall through to default
    # if it's not.
    try:
        from app.core.config import settings  # type: ignore
        return max(1, int(getattr(settings, "SUB_AGENTS_PER_STAGE", default)))
    except Exception:
        return default


class SubAgentSwarm:
    """Implements `GroundedAgent` as a fan-out of N sub-agents.

    Each sub-agent runs the SAME base agent (model + temperature) with
    a DIFFERENT persona suffix appended to the system prompt. The
    aggregator agent then reads all sub-outputs and produces the one
    answer the next stage receives.

    Concurrency is bounded by `max_concurrent` to respect provider
    RPM limits — Foundry o4-mini caps at 500 RPM, gpt-4o at 1350 RPM,
    Bedrock varies by account. Default 16 keeps headroom for the
    other concurrent stages in a multi-hypothesis run.

    Costs: sums every sub-agent's cost + the aggregator's cost. The
    returned AgentResult.cost_cents is the all-in number for this
    stage's swarm execution."""

    label: str

    def __init__(
        self,
        base_agent: GroundedAgent,
        *,
        aggregator: GroundedAgent,
        n_subagents: int | None = None,
        max_concurrent: int = 16,
        personas: list[str] | None = None,
        label: str | None = None,
    ) -> None:
        self.base_agent = base_agent
        self.aggregator = aggregator
        self.n_subagents = n_subagents if n_subagents is not None else _resolve_n_subagents()
        self.max_concurrent = max_concurrent
        self.personas = personas or DEFAULT_PERSONAS
        self.label = label or f"swarm[{base_agent.label}×{self.n_subagents}]"
        # Side-channel for the latest run's per-sub-agent detail.
        # Populated by .run(); a caller (e.g. swarm_smoke or the audit
        # logger) can read it after the call to extract the full
        # trace. Not in AgentResult because the protocol stays narrow.
        self.last_detail: SubSwarmResult | None = None

    async def run(
        self,
        query: str,
        tools: list[Tool],
        system: str = DEFAULT_GROUNDING_PROMPT,
        max_steps: int = 6,
    ) -> AgentResult:
        t0 = time.monotonic()
        sem = asyncio.Semaphore(self.max_concurrent)
        n = self.n_subagents

        async def _run_one(idx: int) -> SubAgentRun:
            persona = self.personas[idx % len(self.personas)]
            sub_system = f"{system}\n\n{persona}"
            async with sem:
                try:
                    r = await self.base_agent.run(
                        query, tools=tools, system=sub_system, max_steps=max_steps,
                    )
                    return SubAgentRun(
                        index=idx,
                        persona=persona,
                        model_label=r.model_label,
                        text=r.text,
                        usage=r.usage,
                        cost_cents=r.cost_cents,
                        stopped_reason=r.stopped_reason,
                        tool_call_count=sum(len(s.tool_calls) for s in r.steps),
                    )
                except Exception as e:
                    return SubAgentRun(
                        index=idx,
                        persona=persona,
                        model_label=self.base_agent.label,
                        text="",
                        usage=TokenUsage(),
                        cost_cents=0.0,
                        stopped_reason="error",
                        tool_call_count=0,
                        error=f"{type(e).__name__}: {str(e)[:200]}",
                    )

        sub_runs: list[SubAgentRun] = await asyncio.gather(*[_run_one(i) for i in range(n)])
        successes = [r for r in sub_runs if r.error is None and r.text.strip()]
        failures = [r for r in sub_runs if r.error is not None or not r.text.strip()]

        # Aggregator step — pass every successful sub-agent output to
        # the aggregator agent and have it synthesise the canonical
        # answer. We deliberately strip persona labels from the
        # aggregator's input — it should weigh outputs on substance,
        # not on the lens that produced them.
        if successes:
            aggregator_input = (
                f"You are aggregating {len(successes)} sub-agent outputs for "
                f"the same question. Distill them into a single canonical "
                f"answer that preserves the citations they share, flags any "
                f"meaningful disagreement, and uses the most-supported claim "
                f"when the outputs converge. Original question:\n\n{query}\n\n"
                f"Sub-agent outputs:\n\n"
                + "\n\n---\n\n".join(
                    f"[Sub-agent {r.index + 1}] {r.text.strip()[:600]}"
                    for r in successes[:80]  # cap input size — 80 reps × 600 chars ≈ 48K
                )
            )
            agg_result = await self.aggregator.run(
                aggregator_input,
                tools=tools,
                system=system,
                max_steps=3,
            )
            agg_text = agg_result.text
            agg_cost = agg_result.cost_cents
            agg_usage = agg_result.usage
            agg_steps = agg_result.steps
            agg_stopped = agg_result.stopped_reason
        else:
            # No successful sub-agent — surface the error trail so the
            # caller can see what went wrong rather than getting empty.
            err_summary = "; ".join(
                (r.error or "(empty output)") for r in failures[:5]
            )
            agg_text = f"(swarm produced no successful sub-agent outputs — first errors: {err_summary})"
            agg_cost = 0.0
            agg_usage = TokenUsage()
            agg_steps = []
            agg_stopped = "swarm_all_failed"

        total_usage = TokenUsage()
        total_cost = 0.0
        for r in sub_runs:
            total_usage = total_usage.add(r.usage)
            total_cost += r.cost_cents
        total_usage = total_usage.add(agg_usage)
        total_cost += agg_cost

        self.last_detail = SubSwarmResult(
            sub_runs=sub_runs,
            aggregator_text=agg_text,
            aggregator_cost_cents=agg_cost,
            successful_runs=len(successes),
            failed_runs=len(failures),
        )

        latency_ms = int((time.monotonic() - t0) * 1000)
        return AgentResult(
            text=agg_text,
            steps=agg_steps,
            stopped_reason=f"swarm({len(successes)}/{n}_ok)",
            model_label=self.label,
            latency_ms=latency_ms,
            usage=total_usage,
            cost_cents=total_cost,
        )
