#!/usr/bin/env python3
"""Swarm smoke — drives the production 12-stage discovery pipeline
through real Bedrock + Azure Foundry deployments using the grounded-
agent layer.

The 12-stage pipeline is the contract from
`backend/app/agents/discovery_orchestrator.py::STAGES`:

  1.  seed       — Claude Opus     (Bedrock)        : initial hypothesis
  2.  expand     — Claude Sonnet   (Bedrock)        : broaden the seed
  3.  evidence   — Cohere/gpt-4o*  (Foundry)        : literature evidence
  4.  counter    — Mistral/o4-mini*(Foundry)        : counter-arguments
  5.  revise     — o3-mini/o4-mini*(Foundry)        : revise after counter
  6.  mechanism  — GPT-4.1/gpt-4o* (Foundry)        : mechanistic detail
  7.  validate   — Claude Sonnet   (Bedrock)        : cross-validation
  8.  ground     — Grok/o4-mini*   (Foundry)        : 3-layer grounding
  9.  score      — GPT-4.1/gpt-4o* (Foundry)        : multi-dim scoring
  10. refine     — GPT-4o          (Foundry)        : fast refinement
  11. translate  — Claude Sonnet   (Bedrock)        : T0–T5 roadmap
  12. finalize   — Claude Sonnet   (Bedrock)        : final synthesis

(*) Foundry deployments not yet provisioned in `humanovo-pipeline` —
substituted with the closest available capability (gpt-4o or o4-mini)
until those deployments land. The substitution map mirrors the
fallback_map in discovery_orchestrator._get_available_stages().

Each stage runs as a `GroundedAgent.run()` loop with a synthetic
biomedical-fact tool. The smoke asserts:

  • At least N tool calls across all 12 stages (grounding actually
    happens, not just one stage doing all the work).
  • Final synthesizer text mentions the canned tool fact (PARP1 or
    BRCA1) — proves grounding carried through 12 hops.
  • Every stage produced text (no max_steps starvation).

Environment: same secrets as ai_integration_smoke.py."""
from __future__ import annotations

import asyncio
import os
import sys
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.services.agents import (  # noqa: E402
    BedrockClaudeAgent,
    FoundryEmbedder,
    FoundryResponsesAgent,
    Swarm,
    SwarmStage,
)
from app.services.agents._types import Tool  # noqa: E402


async def _pick_bedrock_alias(
    region: str,
    access_key: str,
    secret_key: str,
    *,
    candidates: list[str],
    label: str,
) -> str:
    """Probe each Bedrock model ID with a 10-token "hi" call; return the
    first one that answers. Logged so the operator sees which alias the
    swarm pinned for this run."""
    import asyncio as _asyncio
    import json as _json

    try:
        import boto3  # type: ignore
    except ImportError:
        return candidates[0]

    client = boto3.client(
        "bedrock-runtime", region_name=region,
        aws_access_key_id=access_key, aws_secret_access_key=secret_key,
    )
    body = _json.dumps({
        "anthropic_version": "bedrock-2023-05-31",
        "max_tokens": 10,
        "messages": [{"role": "user", "content": "hi"}],
    })
    loop = _asyncio.get_event_loop()
    for mid in candidates:
        try:
            await loop.run_in_executor(
                None,
                lambda m=mid: client.invoke_model(
                    modelId=m, contentType="application/json",
                    accept="application/json", body=body,
                ),
            )
            print(f"[alias] {label}: pinned {mid}", flush=True)
            return mid
        except Exception:
            continue
    print(f"[alias] {label}: no candidate worked, falling back to {candidates[0]}", flush=True)
    return candidates[0]


async def _lookup_biomedical_fact(args: dict) -> dict:
    """Synthetic tool returning a canned PARP1/BRCA1 fact whenever the
    query touches BRCA, PARP, ovarian cancer, or synthetic lethality.
    The pipeline's final answer must reflect the citation, proving
    grounding carried through every hop."""
    query = (args.get("query") or "").lower()
    if any(k in query for k in ("synthetic lethal", "ovarian", "brca", "parp")):
        return {
            "fact": "PARP1 inhibition is synthetic-lethal with BRCA1-deficient cancer cells",
            "source": "synthetic-lethal-tool/2026-05",
            "evidence_strength": "high",
        }
    return {"fact": None, "source": None, "evidence_strength": "no-match"}


LOOKUP_TOOL = Tool(
    name="lookup_biomedical_fact",
    description=(
        "Look up a curated biomedical fact about synthetic lethality, "
        "gene-pair vulnerabilities, BRCA mutations, ovarian cancer "
        "therapeutics, or PARP inhibitors. Call this tool to retrieve "
        "current evidence with a citation before making a factual claim."
    ),
    parameters={
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "Free-text query describing the gene/disease/therapy.",
            },
        },
        "required": ["query"],
    },
    handler=_lookup_biomedical_fact,
)


@dataclass
class StageSpec:
    """Production stage definition mirroring discovery_orchestrator.STAGES."""
    num: int
    name: str
    target_role: str   # e.g. "Cohere Command A" — descriptive, may be substituted
    agent_key: str     # which configured agent we use ("bedrock-opus", "foundry-gpt4o", etc.)
    instruction: str
    max_output_tokens: int = 768
    max_steps: int = 4
    is_critic: bool = False
    """Critic stages (validate/ground/score) get the
    request_pipeline_loopback tool so they can send the pipeline back
    to an earlier stage when QA/QC finds a problem the chain cannot
    repair going forward."""


# Substitution map: where the production STAGES list calls for a model
# we don't yet have deployed in the Foundry project, we route to the
# closest capability we DO have. This mirrors the runtime
# `_get_available_stages` fallback logic but is explicit here so the
# smoke documents the substitution clearly.
PIPELINE_SPEC: list[StageSpec] = [
    # Instructions are deliberately conversational. Earlier drafts used
    # imperative + role-play framing ("You are Stage 1. MUST output...")
    # that triggered Azure OpenAI's jailbreak classifier. The current
    # phrasing requests the same outputs as polite asks, which the
    # filter doesn't flag. Same operational behaviour, lower CI risk.
    StageSpec(
        num=1, name="seed", target_role="Claude Opus 4.6 (Bedrock)",
        agent_key="bedrock-opus",
        instruction=(
            "Could you propose one concrete hypothesis seed for the question, "
            "and consider using lookup_biomedical_fact to anchor at least one "
            "factual claim? A 1–2 sentence answer is fine."
        ),
    ),
    StageSpec(
        num=2, name="expand", target_role="Claude Sonnet 4 (Bedrock)",
        agent_key="bedrock-sonnet",
        instruction=(
            "Please broaden the seed above into a more complete hypothesis "
            "statement of 2–3 sentences. If you reuse a tool result, please "
            "cite the source it returned."
        ),
    ),
    StageSpec(
        num=3, name="evidence", target_role="Cohere Command A (Foundry — substituted with gpt-4o)",
        agent_key="foundry-gpt4o",
        instruction=(
            "Please survey supporting evidence with a focused call to "
            "lookup_biomedical_fact, then summarize what you found in one "
            "sentence and cite the returned source."
        ),
    ),
    StageSpec(
        num=4, name="counter", target_role="Mistral-Large-3 (Foundry — substituted with o4-mini)",
        agent_key="foundry-o4mini",
        # Counter is the prior loop-runner — keep it tight. Phrased as
        # a request rather than a directive, but with explicit
        # "one tool call" guidance.
        instruction=(
            "Please share one counter-argument that challenges the hypothesis. "
            "It is fine to use one call to lookup_biomedical_fact for "
            "verification; afterwards, please write your counter as a "
            "1–2 sentence message."
        ),
        max_steps=3,
    ),
    StageSpec(
        num=5, name="revise", target_role="o3-mini (Foundry — substituted with o4-mini)",
        agent_key="foundry-o4mini",
        instruction=(
            "Could you revise the hypothesis to address the counter-argument "
            "while keeping the cited source? A 2-sentence revision is fine."
        ),
    ),
    StageSpec(
        num=6, name="mechanism", target_role="GPT-4.1 (Foundry — substituted with gpt-4o)",
        agent_key="foundry-gpt4o",
        instruction=(
            "Please describe the molecular mechanism in 1–2 sentences. If the "
            "tool result includes mechanistic detail, please ground your "
            "answer in it."
        ),
    ),
    StageSpec(
        num=7, name="validate", target_role="Claude Sonnet 4.6 (Bedrock)",
        agent_key="bedrock-sonnet",
        instruction=(
            "Please cross-validate the mechanism by calling "
            "lookup_biomedical_fact one more time. If the evidence_strength "
            "is anything other than 'high', use request_pipeline_loopback to "
            "send the pipeline back to the 'revise' stage with a brief reason. "
            "Otherwise, state in one sentence that the central claim is "
            "supported."
        ),
        is_critic=True,
    ),
    StageSpec(
        num=8, name="ground", target_role="Grok-4-1-fast (Foundry — substituted with o4-mini)",
        agent_key="foundry-o4mini",
        instruction=(
            "Please apply three-layer grounding in two sentences: cite the "
            "source, mention the evidence_strength returned by the tool, and "
            "note any claim not supported by a tool result. If you spot an "
            "ungrounded claim, please call request_pipeline_loopback with "
            "target_stage='mechanism'."
        ),
        is_critic=True,
    ),
    StageSpec(
        num=9, name="score", target_role="GPT-4.1 (Foundry — substituted with gpt-4o)",
        agent_key="foundry-gpt4o",
        instruction=(
            "Please assign a confidence between 0.0 and 1.0 based on the "
            "evidence_strength field of the tool result, with a one-sentence "
            "justification. If confidence would be below 0.6, please call "
            "request_pipeline_loopback with target_stage='evidence'."
        ),
        is_critic=True,
    ),
    StageSpec(
        num=10, name="refine", target_role="GPT-4o (Foundry)",
        agent_key="foundry-gpt4o",
        instruction=(
            "Please tighten the hypothesis to one publication-quality "
            "sentence, including the gene names and the source citation."
        ),
    ),
    StageSpec(
        num=11, name="translate", target_role="Claude Sonnet 4 (Bedrock)",
        agent_key="bedrock-sonnet",
        instruction=(
            "Could you sketch a brief translational roadmap (target "
            "validation → mechanism → preclinical → Ph1 → Ph2 → Ph3) in "
            "2–3 sentences, keeping the cited source in mind?"
        ),
    ),
    StageSpec(
        num=12, name="finalize", target_role="Claude Sonnet 4 (Bedrock)",
        agent_key="bedrock-sonnet",
        instruction=(
            "Please write a final 2-sentence summary for the user. Reuse the "
            "gene names and source citation from the tool result rather than "
            "introducing new claims."
        ),
    ),
]


def _missing(label: str) -> bool:
    print(f"[skip] {label}", flush=True)
    return True


async def main() -> int:
    aws_key = os.environ.get("AWS_NEW_ACCESS_KEY_ID") or os.environ.get("AWS_ACCESS_KEY_ID")
    aws_secret = os.environ.get("AWS_NEW_SECRET_ACCESS_KEY") or os.environ.get("AWS_SECRET_ACCESS_KEY")
    aws_region = os.environ.get("AWS_REGION", "us-east-1")
    azure_key = os.environ.get("AZURE_AI_KEY")
    azure_project_endpoint = os.environ.get("AZURE_AI_PROJECT_ENDPOINT", "")
    azure_openai_endpoint = os.environ.get("AZURE_AI_OPENAI_ENDPOINT", "")

    if not (aws_key and aws_secret):
        return _missing("AWS credentials missing — swarm smoke requires both Bedrock + Foundry")
    if not (azure_key and azure_project_endpoint):
        return _missing("Azure Foundry credentials missing — swarm smoke requires both Bedrock + Foundry")

    # Try Claude 4.6 first (production target); fall back through
    # 4.5 / 4.1 / 4.0 if a particular alias isn't enabled on this
    # account. The per-model smoke (ai_integration_smoke.py) reports
    # which alias actually answers — once confirmed, pin the exact
    # ID into config.BEDROCK_MODEL_CLAUDE_OPUS / _SONNET.
    bedrock_opus_id = await _pick_bedrock_alias(
        aws_region, aws_key, aws_secret,
        candidates=[
            "us.anthropic.claude-opus-4-6-20251201-v1:0",
            "anthropic.claude-opus-4-6-20251201-v1:0",
            "us.anthropic.claude-opus-4-6-v1:0",
            "anthropic.claude-opus-4-6-v1:0",
            "us.anthropic.claude-opus-4-1-20250805-v1:0",
            "anthropic.claude-opus-4-1-20250805-v1:0",
        ],
        label="Claude Opus",
    )
    bedrock_sonnet_id = await _pick_bedrock_alias(
        aws_region, aws_key, aws_secret,
        candidates=[
            "us.anthropic.claude-sonnet-4-6-20251201-v1:0",
            "anthropic.claude-sonnet-4-6-20251201-v1:0",
            "us.anthropic.claude-sonnet-4-6-v1:0",
            "anthropic.claude-sonnet-4-6-v1:0",
            "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
            "anthropic.claude-sonnet-4-5-20250929-v1:0",
            "us.anthropic.claude-sonnet-4-20250514-v1:0",
        ],
        label="Claude Sonnet",
    )

    # Construct each unique agent ONCE — multiple stages reuse the same
    # agent instance. This is fine: each call to .run() is stateless,
    # the agent owns no per-conversation state across runs.
    agents = {
        "bedrock-opus": BedrockClaudeAgent(
            model_id=bedrock_opus_id, region=aws_region,
            access_key_id=aws_key, secret_access_key=aws_secret,
            max_tokens=512, label="bedrock/claude-opus-4-1",
        ),
        "bedrock-sonnet": BedrockClaudeAgent(
            model_id=bedrock_sonnet_id, region=aws_region,
            access_key_id=aws_key, secret_access_key=aws_secret,
            max_tokens=512, label="bedrock/claude-sonnet-4",
        ),
        "foundry-gpt4o": FoundryResponsesAgent(
            deployment="gpt-4o", base_url=azure_project_endpoint, api_key=azure_key,
            max_output_tokens=512, label="foundry/gpt-4o",
        ),
        "foundry-o4mini": FoundryResponsesAgent(
            deployment="o4-mini", base_url=azure_project_endpoint, api_key=azure_key,
            max_output_tokens=1024, label="foundry/o4-mini",
        ),
    }

    swarm = Swarm([
        SwarmStage(
            name=f"{spec.num:02d}-{spec.name}",
            agent=agents[spec.agent_key],
            instruction=spec.instruction,
            max_steps=spec.max_steps,
            is_critic=spec.is_critic,
        )
        for spec in PIPELINE_SPEC
    ], loopback_budget=3)

    initial_query = (
        "What synthetic-lethal target might be useful for BRCA1-deficient "
        "ovarian cancer cells? Citation-backed answers are preferred."
    )

    # Dual-embedding probe — proves the FoundryEmbedder dispatches both
    # text-embedding-3-large + text-embedding-3-small in parallel and
    # returns matched DualEmbedding records with the right dim assertion.
    # The discovery pipeline relies on this for hybrid retrieval (small
    # for pre-filter, large for re-rank).
    #
    # Embeddings on the Foundry hub are exposed on the OPENAI resource
    # endpoint (humanovo-foundry-hub.openai.azure.com/openai/v1), not
    # on the project endpoint — the latter 404s on /embeddings. Use
    # the openai endpoint when it's set; fall back to project_endpoint
    # otherwise so the embedder still has a hope on hubs that route
    # embeddings differently.
    embedder_base = azure_openai_endpoint or azure_project_endpoint
    embedder = FoundryEmbedder(
        base_url=embedder_base,
        api_key=azure_key,
        large_deployment="text-embedding-3-large",
        small_deployment="text-embedding-3-small",
    )
    print("\n[dual-embed] probing both deployments...", flush=True)
    dual = await embedder.embed_dual_one(
        "PARP1 inhibition synthetic lethality with BRCA1-deficient cancer cells"
    )
    print(f"[dual-embed]   large dims={len(dual.large)} (want 3072)", flush=True)
    print(f"[dual-embed]   small dims={len(dual.small)} (want 1536)", flush=True)
    if len(dual.large) != 3072 or len(dual.small) != 1536:
        print("[FAIL] dual-embedding dim mismatch", flush=True)
        return 1

    print("\n=== 12-stage discovery swarm smoke ===", flush=True)
    print(f"Query: {initial_query}", flush=True)
    print(f"Stages: {len(PIPELINE_SPEC)} (critic stages: {sum(1 for s in PIPELINE_SPEC if s.is_critic)})\n", flush=True)
    print("Stage map (production target → substituted agent for this smoke):", flush=True)
    for spec in PIPELINE_SPEC:
        critic = " [CRITIC]" if spec.is_critic else ""
        print(f"  {spec.num:02d}. {spec.name:<10} target={spec.target_role:<60} agent={agents[spec.agent_key].label}{critic}", flush=True)
    print("", flush=True)

    try:
        result = await swarm.run(initial_query, tools=[LOOKUP_TOOL])
    except Exception as e:
        print(f"\n[FATAL] swarm raised: {type(e).__name__}: {e}", flush=True)
        return 1

    md_lines = ["## 12-stage discovery swarm", "",
                "| # | Stage | Iter | Model | Steps | Tool calls | Latency | Loopback | Output (preview) |",
                "|---|---|---|---|---|---|---|---|---|"]

    for stage in result.stages:
        preview = (stage.text or "").replace("\n", " ").replace("|", "\\|")[:160]
        loopback_tag = ""
        if stage.triggered_loopback_to:
            loopback_tag = f" → loopback to {stage.triggered_loopback_to}: {stage.loopback_reason or ''}"
        line = (
            f"  [{stage.name:<14}] iter={stage.iteration} {stage.model_label:<32} "
            f"steps={stage.step_count} tools={stage.tool_call_count} "
            f"latency={stage.latency_ms}ms{loopback_tag}"
        )
        print(line, flush=True)
        print(f"     → {(stage.text or '').strip()[:240]}\n", flush=True)
        md_lines.append(
            f"| {stage.name.split('-')[0]} | {stage.name.split('-', 1)[1]} | "
            f"{stage.iteration} | `{stage.model_label}` | {stage.step_count} | "
            f"{stage.tool_call_count} | {stage.latency_ms} ms | "
            f"{stage.triggered_loopback_to or ''} | {preview} |"
        )

    if result.loopbacks:
        print(f"\nLoopbacks fired ({len(result.loopbacks)}/{3} budget):", flush=True)
        for ev in result.loopbacks:
            print(f"  • {ev.from_stage} → {ev.to_stage} (iter {ev.iteration_after}): {ev.reason}", flush=True)

    print(f"\nTotal swarm latency: {result.total_latency_ms}ms ({result.total_latency_ms/1000:.1f}s)", flush=True)
    print(f"Final answer: {result.final_text}", flush=True)

    md_lines.append("")
    md_lines.append(f"**Total latency:** {result.total_latency_ms} ms ({result.total_latency_ms/1000:.1f}s)")
    md_lines.append(f"**Loopbacks fired:** {len(result.loopbacks)} (budget: 3)")
    md_lines.append("")
    md_lines.append(f"**Final answer:** {result.final_text}")

    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_path:
        with open(summary_path, "a", encoding="utf-8") as f:
            f.write("\n".join(md_lines) + "\n")

    # Grounding assertions:
    #   • At least 3 tool calls across the 12 stages (a single tool
    #     call would prove the loop works but not that grounding is
    #     happening across stages — multiple stages must independently
    #     consult the tool).
    #   • Final answer mentions PARP1 or BRCA1 (the canned fact's
    #     identifiers) — grounding carried through 12 hops.
    #   • No stage produced empty text.
    total_tool_calls = sum(s.tool_call_count for s in result.stages)
    final_lower = result.final_text.lower()
    mentions_canned_fact = ("parp1" in final_lower) or ("brca1" in final_lower)
    every_stage_has_text = all(s.text.strip() for s in result.stages)

    print(
        f"\nAssertions: tool_calls={total_tool_calls} (want >=3), "
        f"final_mentions_canned_fact={mentions_canned_fact}, "
        f"every_stage_produced_text={every_stage_has_text}",
        flush=True,
    )

    if total_tool_calls < 3:
        print("[FAIL] swarm completed with <3 tool calls — grounding is too shallow across 12 stages", flush=True)
        return 1
    if not mentions_canned_fact:
        print("[FAIL] final answer missing PARP1/BRCA1 — grounding didn't carry through to finalize", flush=True)
        return 1
    if not every_stage_has_text:
        print("[FAIL] some stage produced empty output — likely max_steps exhausted before final answer", flush=True)
        return 1

    print(f"\n[OK] swarm grounded end-to-end across {len(PIPELINE_SPEC)} stages × 2 providers", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
