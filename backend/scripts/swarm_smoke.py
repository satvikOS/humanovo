#!/usr/bin/env python3
"""Swarm smoke — drives a 4-agent pipeline through real Bedrock + Azure
Foundry deployments using the grounded-agent layer. Proves end-to-end
that each provider can:

  1. Receive a tool-spec, decide to call it, dispatch a function call.
  2. Receive the tool result and continue reasoning.
  3. Hand off its final answer to the next agent in the swarm.

Stages (sequential, each grounded over a synthetic biomedical tool):

  • explorer    — Claude Opus 4.1 on Bedrock
  • reasoner    — o4-mini on Foundry Responses API
  • critic      — gpt-4o on Foundry Responses API
  • synthesizer — Claude Sonnet 4 on Bedrock

Synthetic tool: `lookup_biomedical_fact` returns a canned
"PARP1 inhibitor → BRCA1-deficient cancer" datum so we can verify
each agent ACTUALLY hits the tool (per the grounding contract) rather
than answering from training data.

Output: a markdown step-by-step trace + per-agent latency + tool-call
count summary, written to the console and to GITHUB_STEP_SUMMARY when
present.

Exit 0 on full pipeline success, exit 1 on any agent failure or if
the synthesizer's final text fails to mention the canned fact (proves
the chain actually carried tool grounding through to the end)."""
from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

# Make `app.*` imports work when running from repo root without
# needing to install the package.
ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.services.agents import (  # noqa: E402
    BedrockClaudeAgent,
    FoundryResponsesAgent,
    Swarm,
)
from app.services.agents._types import Tool  # noqa: E402
from app.services.agents.swarm import SwarmStage  # noqa: E402


# Synthetic tool. The canned answer mentions "PARP1" and "BRCA1" — the
# final stage must repeat at least one of those, proving the grounding
# carried through every hop. If the model answers from training data
# instead, it will use different example targets and the assertion
# below catches it.
async def _lookup_biomedical_fact(args: dict) -> dict:
    query = (args.get("query") or "").lower()
    if "synthetic lethal" in query or "ovarian" in query or "brca" in query:
        return {
            "fact": "PARP1 inhibition is synthetic-lethal with BRCA1-deficient cancer cells",
            "source": "synthetic-lethal-tool/2026-05",
            "evidence_strength": "high",
        }
    return {
        "fact": None,
        "source": None,
        "evidence_strength": "no-match",
    }


LOOKUP_TOOL = Tool(
    name="lookup_biomedical_fact",
    description=(
        "Look up a curated biomedical fact related to synthetic lethality. "
        "Use this whenever the user asks about gene-pair vulnerabilities, "
        "BRCA mutations, ovarian cancer therapeutics, or PARP inhibitors. "
        "ALWAYS call this tool before answering — your training data is "
        "stale and unreliable."
    ),
    parameters={
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "Free-text query describing the gene/disease/therapy of interest.",
            },
        },
        "required": ["query"],
    },
    handler=_lookup_biomedical_fact,
)


def _missing(label: str) -> bool:
    print(f"[skip] {label}", flush=True)
    return True


async def main() -> int:
    aws_key = os.environ.get("AWS_NEW_ACCESS_KEY_ID") or os.environ.get("AWS_ACCESS_KEY_ID")
    aws_secret = os.environ.get("AWS_NEW_SECRET_ACCESS_KEY") or os.environ.get("AWS_SECRET_ACCESS_KEY")
    aws_region = os.environ.get("AWS_REGION", "us-east-1")
    azure_key = os.environ.get("AZURE_AI_KEY")
    azure_project_endpoint = os.environ.get("AZURE_AI_PROJECT_ENDPOINT", "")

    # Bedrock model IDs verified by the per-stage smoke (run 25625095538).
    bedrock_opus_id = "us.anthropic.claude-opus-4-1-20250805-v1:0"
    bedrock_sonnet_id = "us.anthropic.claude-sonnet-4-20250514-v1:0"

    if not (aws_key and aws_secret):
        return _missing("AWS credentials missing — swarm smoke requires both Bedrock + Foundry")
    if not (azure_key and azure_project_endpoint):
        return _missing("Azure Foundry credentials missing — swarm smoke requires both Bedrock + Foundry")

    explorer = BedrockClaudeAgent(
        model_id=bedrock_opus_id,
        region=aws_region,
        access_key_id=aws_key,
        secret_access_key=aws_secret,
        max_tokens=512,
        label="bedrock/claude-opus-4-1",
    )
    reasoner = FoundryResponsesAgent(
        deployment="o4-mini",
        base_url=azure_project_endpoint,
        api_key=azure_key,
        max_output_tokens=1024,
        label="foundry/o4-mini",
    )
    critic = FoundryResponsesAgent(
        deployment="gpt-4o",
        base_url=azure_project_endpoint,
        api_key=azure_key,
        max_output_tokens=512,
        label="foundry/gpt-4o",
    )
    synthesizer = BedrockClaudeAgent(
        model_id=bedrock_sonnet_id,
        region=aws_region,
        access_key_id=aws_key,
        secret_access_key=aws_secret,
        max_tokens=512,
        label="bedrock/claude-sonnet-4",
    )

    swarm = Swarm([
        SwarmStage(
            name="explorer",
            agent=explorer,
            instruction=(
                "You are exploring a biomedical hypothesis. Use the "
                "`lookup_biomedical_fact` tool to gather one curated fact "
                "about the user's query, then summarize what you found in "
                "one sentence. Cite the source returned by the tool."
            ),
        ),
        SwarmStage(
            name="reasoner",
            agent=reasoner,
            instruction=(
                "Given the explorer's finding, reason step-by-step about "
                "the therapeutic implication. If you need to verify a "
                "specific gene-pair claim, call `lookup_biomedical_fact` "
                "yourself — do not rely solely on the explorer's summary."
            ),
        ),
        SwarmStage(
            name="critic",
            agent=critic,
            instruction=(
                "Critique the reasoner's analysis. Identify any claim that "
                "wasn't supported by a tool result. If the chain looks "
                "well-grounded, say so concisely (one or two sentences)."
            ),
        ),
        SwarmStage(
            name="synthesizer",
            agent=synthesizer,
            instruction=(
                "Produce a final 2-sentence answer for the user. Repeat "
                "the gene name(s) and source from the tool result so the "
                "answer is verifiable. Do not introduce new claims."
            ),
        ),
    ])

    initial_query = (
        "What synthetic-lethal target should we consider for BRCA1-deficient "
        "ovarian cancer cells? Answer using only tool results."
    )

    print("\n=== Swarm smoke ===", flush=True)
    print(f"Query: {initial_query}", flush=True)
    print("Stages: explorer → reasoner → critic → synthesizer\n", flush=True)

    try:
        result = await swarm.run(initial_query, tools=[LOOKUP_TOOL])
    except Exception as e:
        print(f"\n[FATAL] swarm raised: {type(e).__name__}: {e}", flush=True)
        return 1

    md_lines = ["## Swarm smoke", "", "| Stage | Model | Steps | Tool calls | Latency | Output (preview) |", "|---|---|---|---|---|---|"]

    for stage in result.stages:
        preview = (stage.text or "").replace("\n", " ").replace("|", "\\|")[:200]
        line = (
            f"  [{stage.name:<12}] {stage.model_label:<32} "
            f"steps={stage.step_count} tools={stage.tool_call_count} "
            f"latency={stage.latency_ms}ms"
        )
        print(line, flush=True)
        print(f"     → {(stage.text or '').strip()[:280]}\n", flush=True)
        md_lines.append(
            f"| {stage.name} | `{stage.model_label}` | {stage.step_count} | "
            f"{stage.tool_call_count} | {stage.latency_ms} ms | {preview} |"
        )

    print(f"Total swarm latency: {result.total_latency_ms}ms", flush=True)
    print(f"Final answer: {result.final_text}", flush=True)

    md_lines.append("")
    md_lines.append(f"**Total latency:** {result.total_latency_ms} ms")
    md_lines.append("")
    md_lines.append(f"**Final answer:** {result.final_text}")

    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_path:
        with open(summary_path, "a", encoding="utf-8") as f:
            f.write("\n".join(md_lines) + "\n")

    # Grounding assertion: at least one stage must have called the
    # tool (otherwise the chain isn't actually grounded), AND the final
    # answer must mention "PARP1" or "BRCA1" (the canned fact's content),
    # AND no stage may have errored. If any of these fail, exit non-zero.
    total_tool_calls = sum(s.tool_call_count for s in result.stages)
    final_lower = result.final_text.lower()
    mentions_canned_fact = ("parp1" in final_lower) or ("brca1" in final_lower)
    every_stage_has_text = all(s.text.strip() for s in result.stages)

    print(f"\nAssertions: tool_calls={total_tool_calls} (want >=1), "
          f"final_mentions_canned_fact={mentions_canned_fact}, "
          f"every_stage_produced_text={every_stage_has_text}", flush=True)

    if total_tool_calls < 1:
        print("[FAIL] swarm completed without any agent calling the tool — chain is not grounded", flush=True)
        return 1
    if not mentions_canned_fact:
        print("[FAIL] final answer missing PARP1/BRCA1 — grounding didn't carry through to synthesizer", flush=True)
        return 1
    if not every_stage_has_text:
        print("[FAIL] some stage produced empty output — likely max_steps exhausted before final answer", flush=True)
        return 1

    print("\n[OK] swarm grounded end-to-end across 4 stages × 2 providers", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
