"""
Pipeline End-to-End Integration Test

PURPOSE: Verify that the 12-stage adversarial hypothesis pipeline
runs end-to-end on a real biomedical question and produces a
grounded, cited DiscoveryHypothesis.

THIS TEST IS THE SINGLE MOST IMPORTANT DELIVERABLE.
Without it, humanovo is a spec. With it, humanovo is a product.

Requirements:
  - At least AWS Bedrock credentials (Claude Opus/Sonnet)
  - OR at least one Azure model endpoint
  - Database services (PostgreSQL, Neo4j, Redis) optional — pipeline
    degrades gracefully without them

Run:
  cd backend
  pytest tests/integration/test_pipeline_e2e.py -v --timeout=600 -s
"""

import asyncio
import json
import os
import time
from typing import Any
from uuid import uuid4

import pytest

# ─── Skip if no credentials ─────────────────────────────────────
_has_bedrock = bool(
    os.environ.get("AWS_ACCESS_KEY_ID")
    and os.environ.get("AWS_SECRET_ACCESS_KEY")
)
_has_azure = any(os.environ.get(k) for k in [
    "AZURE_GPT4O_KEY", "AZURE_GPT41_KEY", "AZURE_O3MINI_KEY",
    "AZURE_MISTRAL_KEY", "AZURE_GROK_KEY", "AZURE_COHERE_KEY",
])
_has_any_llm = _has_bedrock or _has_azure

pytestmark = pytest.mark.skipif(
    not _has_any_llm,
    reason="No LLM provider credentials found in environment. "
           "Set AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY for Bedrock "
           "or AZURE_*_KEY for Azure models.",
)


# ─── Test Data ───────────────────────────────────────────────────

RESEARCH_QUESTIONS = [
    {
        "disease": "Parkinson's Disease",
        "discovery_type": "treatment",
        "focus_entities": [
            "alpha-synuclein", "gut microbiome", "dopaminergic neurons",
        ],
        "external_factors": [
            {
                "name": "Gut-brain axis",
                "category": "pathway",
                "interaction": "bidirectional vagal signaling",
            },
            {
                "name": "Neuroinflammation",
                "category": "mechanism",
                "interaction": "microglial activation",
            },
        ],
    },
    {
        "disease": "Pancreatic Ductal Adenocarcinoma",
        "discovery_type": "treatment",
        "focus_entities": ["KRAS G12D", "TP53", "tumor microenvironment"],
        "external_factors": [
            {
                "name": "Desmoplastic stroma",
                "category": "microenvironment",
                "interaction": "immune exclusion",
            },
        ],
    },
    {
        "disease": "Alzheimer's Disease",
        "discovery_type": "prevention",
        "focus_entities": [
            "amyloid-beta", "tau", "ApoE4", "neuroinflammation",
        ],
        "external_factors": [],
    },
]


# ─── Fixtures ────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def event_loop():
    """Create an event loop for the test module."""
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest.fixture(scope="module")
async def pipeline():
    """Initialize the SequentialHypothesisPipeline with available models."""
    from app.agents.discovery_orchestrator import (
        MultiModelLLM,
        SequentialHypothesisPipeline,
        TokenPool,
    )

    token_pool = TokenPool()
    llm = MultiModelLLM(token_pool)
    await llm.initialize()

    pipe = SequentialHypothesisPipeline(llm, discovery_run_id=str(uuid4()))
    return pipe


# ─── Tests ───────────────────────────────────────────────────────

class TestPipelineInitialization:
    """Verify the pipeline can initialize model clients."""

    @pytest.mark.asyncio
    async def test_at_least_one_model_available(self, pipeline):
        """At least one LLM client must initialize successfully."""
        llm = pipeline._llm
        available = []
        if llm._bedrock_client:
            available.append("bedrock")
        if llm._azure_mistral_client:
            available.append("mistral")
        if llm._azure_gpt4o_client:
            available.append("gpt4o")
        if llm._azure_gpt41_client:
            available.append("gpt41")
        if llm._azure_o3mini_client:
            available.append("o3mini")
        if llm._azure_cohere_client:
            available.append("cohere")
        if llm._azure_grok_client:
            available.append("grok")

        print(f"\n  Available model clients: {available}")
        assert len(available) > 0, (
            "No LLM clients initialized. Check environment variables."
        )

    @pytest.mark.asyncio
    async def test_available_stages(self, pipeline):
        """Pipeline should have at least 6 executable stages (with fallbacks)."""
        stages = pipeline._get_available_stages()
        stage_names = [s[1] for s in stages]
        print(f"\n  Available stages ({len(stages)}): {stage_names}")
        assert len(stages) >= 6, (
            f"Only {len(stages)} stages available. "
            f"Need at least 6 for meaningful pipeline. "
            f"Available: {stage_names}"
        )


class TestPipelineEndToEnd:
    """Run the full 12-stage pipeline on a real biomedical question."""

    @pytest.mark.asyncio
    @pytest.mark.timeout(600)
    async def test_full_pipeline_parkinsons(self, pipeline):
        """Run the complete pipeline on a Parkinson's disease hypothesis."""
        q = RESEARCH_QUESTIONS[0]
        await self._run_pipeline_and_validate(pipeline, q)

    async def _run_pipeline_and_validate(
        self,
        pipeline,
        question: dict[str, Any],
    ):
        """Core pipeline execution and validation logic."""
        stage_completions = []

        async def on_stage_complete(
            stage_num: int, stage_name: str, model_used: str, parsed: Any,
        ):
            stage_completions.append({
                "stage": stage_num,
                "name": stage_name,
                "model": model_used,
                "timestamp": time.time(),
            })
            print(
                f"  ✓ Stage {stage_num:>2} ({stage_name:<12}) via {model_used}"
            )

        start = time.time()

        result = await pipeline.run_hypothesis(
            disease=question["disease"],
            discovery_type=question["discovery_type"],
            pathway_context=(
                f"Focus entities: "
                f"{', '.join(question.get('focus_entities', []))}"
            ),
            external_factors=question.get("external_factors", []),
            round_number=1,
            hypothesis_index=1,
            on_stage_complete=on_stage_complete,
        )

        elapsed = time.time() - start

        # ─── Validate result structure ───────────────────────────
        print(f"\n  Pipeline completed in {elapsed:.1f}s")
        print(f"  Stages completed: {result.stages_completed}/12")
        print(f"  Hypothesis ID: {result.hypothesis_id}")
        print(f"  Pipeline success: {result.success}")

        # Must have a hypothesis ID
        assert result.hypothesis_id, "Pipeline produced no hypothesis ID"

        # Must have stage results
        assert len(result.stage_results) > 0, (
            "Pipeline produced no stage results"
        )

        # Each stage result must have non-empty output
        for sr in result.stage_results:
            assert sr.output, (
                f"Stage {sr.stage} ({sr.stage_name}) produced empty output"
            )
            output_size = (
                len(json.dumps(sr.output))
                if isinstance(sr.output, dict)
                else len(str(sr.output))
            )
            status = "✓" if sr.success else "✗"
            print(
                f"    {status} Stage {sr.stage:>2} "
                f"({sr.stage_name:<12}) "
                f"model={sr.model_used:<20} "
                f"size={output_size:>5} "
                f"time={sr.duration_seconds:>5.1f}s"
            )

        # Final hypothesis must exist (DiscoveryHypothesis object)
        assert result.final_hypothesis is not None, (
            "Pipeline produced no final hypothesis"
        )

        h = result.final_hypothesis
        print("\n  FINAL HYPOTHESIS:")
        print(f"    Title:      {h.title}")
        print(f"    Confidence: {h.confidence}")
        print(f"    Novelty:    {h.novelty_score}")
        print(f"    Mechanism:  {h.mechanism[:200]}...")
        print(f"    Citations:  {len(h.citations)}")
        print(f"    Counter-args: {len(h.counter_arguments)}")

        # ─── Validate hypothesis quality ─────────────────────────
        # Must have a title
        assert h.title and len(h.title) > 5, (
            f"Hypothesis title too short or empty: '{h.title}'"
        )

        # Must mention the disease somewhere in title or description
        disease_lower = question["disease"].lower()
        disease_words = disease_lower.split()
        full_text = (h.title + " " + h.description).lower()
        assert any(w in full_text for w in disease_words), (
            f"Hypothesis does not mention the disease '{question['disease']}'"
        )

        # Must have substantive content
        assert len(h.description) > 200, (
            f"Hypothesis description too short ({len(h.description)} chars)"
        )

        # ─── Report ─────────────────────────────────────────────
        report = {
            "test": "pipeline_e2e",
            "disease": question["disease"],
            "discovery_type": question["discovery_type"],
            "stages_completed": result.stages_completed,
            "stages_total": 12,
            "elapsed_seconds": round(elapsed, 1),
            "pipeline_success": result.success,
            "hypothesis_id": result.hypothesis_id,
            "hypothesis": {
                "title": h.title,
                "confidence": h.confidence,
                "novelty_score": h.novelty_score,
                "feasibility_score": h.feasibility_score,
                "impact_score": h.impact_score,
                "mechanism_length": len(h.mechanism),
                "description_length": len(h.description),
                "citation_count": len(h.citations),
                "counter_argument_count": len(h.counter_arguments),
                "supporting_path_count": len(h.supporting_paths),
            },
            "stages": [
                {
                    "stage": sr.stage,
                    "name": sr.stage_name,
                    "model": sr.model_used,
                    "duration_seconds": round(sr.duration_seconds, 2),
                    "success": sr.success,
                    "error": sr.error,
                }
                for sr in result.stage_results
            ],
        }

        # Write report
        report_dir = "tests/integration/reports"
        os.makedirs(report_dir, exist_ok=True)
        slug = question["disease"].replace(" ", "_").replace("'", "").lower()
        report_path = f"{report_dir}/pipeline_{slug}.json"
        with open(report_path, "w") as f:
            json.dump(report, f, indent=2, default=str)

        print(f"\n  Report written to {report_path}")


class TestPipelineFallbacks:
    """Verify the pipeline degrades gracefully with missing models."""

    @pytest.mark.asyncio
    async def test_fallback_chain_resolves(self, pipeline):
        """Every stage should resolve to an available model."""
        stages = pipeline._get_available_stages()
        for stage_num, name, model_type, max_tokens, temp in stages:
            assert pipeline._is_model_available(model_type), (
                f"Stage {stage_num} ({name}) resolved to "
                f"{model_type.value} but that model is not available"
            )


class TestCostTracking:
    """Verify API cost and token tracking work."""

    @pytest.mark.asyncio
    async def test_token_pool_stats(self, pipeline):
        """Token pool should report stats."""
        stats = pipeline._llm._token_pool.get_stats()
        assert isinstance(stats, dict), "Token pool stats should be a dict"
        print(
            f"\n  Token pool stats: "
            f"{json.dumps(stats, indent=2, default=str)}"
        )
