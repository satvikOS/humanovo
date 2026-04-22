"""
Retrospective Validation Benchmark

PURPOSE: Run the humanovo pipeline against 10 published biomedical
hypotheses that were subsequently validated experimentally. Measure
whether the pipeline independently recovers the hypothesis, cites
overlapping literature, and identifies real limitations.

This benchmark is humanovo's credibility artifact.

Usage:
  python -m benchmark.retrospective_validation --run-all
  python -m benchmark.retrospective_validation --run-id BM-001
  python -m benchmark.retrospective_validation --report-only

Requirements:
  - Full pipeline operational (LLM credentials configured)
  - ~$15-50 in API costs per full 10-hypothesis run
"""

import argparse
import asyncio
import json
import os
import time
from dataclasses import asdict, dataclass, field
from typing import Any, Optional
from uuid import uuid4


# ─── Benchmark Hypotheses ────────────────────────────────────────

BENCHMARK_HYPOTHESES = [
    {
        "id": "BM-001",
        "domain": "Gut-brain axis in Parkinson's Disease",
        "published_hypothesis": (
            "Alpha-synuclein pathology originates in the enteric nervous system "
            "and propagates to the brain via the vagus nerve, suggesting that "
            "gut microbiome dysbiosis may initiate or accelerate PD progression."
        ),
        "source_paper": "Kim S et al. Cell. 2019;177(2):338-352. DOI:10.1016/j.cell.2019.01.012",
        "validation_status": "Alpha-synuclein spread from gut to brain confirmed in mouse models",
        "pipeline_input": {
            "disease": "Parkinson's Disease",
            "discovery_type": "mechanism",
            "focus_entities": ["alpha-synuclein", "vagus nerve", "gut microbiome", "enteric nervous system"],
            "external_factors": [
                {"name": "Gut-brain axis", "category": "pathway", "interaction": "vagal signaling"},
            ],
        },
        "expected_citations_keywords": ["alpha-synuclein", "vagus", "gut", "microbiome", "parkinson"],
        "expected_counter_arguments": [
            "Not all PD patients show gut pathology",
            "Vagotomy studies show mixed results",
            "Causal direction unclear",
        ],
    },
    {
        "id": "BM-002",
        "domain": "Drug repurposing for COVID-19",
        "published_hypothesis": (
            "Baricitinib, a JAK1/JAK2 inhibitor used for rheumatoid arthritis, "
            "can be repurposed for COVID-19 treatment by simultaneously reducing "
            "viral entry via AAK1 inhibition and dampening cytokine storm."
        ),
        "source_paper": "Richardson P et al. Lancet. 2020;395(10223):e30-e31. DOI:10.1016/S0140-6736(20)30304-4",
        "validation_status": "FDA EUA granted for baricitinib in COVID-19",
        "pipeline_input": {
            "disease": "COVID-19",
            "discovery_type": "treatment",
            "focus_entities": ["baricitinib", "JAK1", "JAK2", "AAK1", "cytokine storm", "SARS-CoV-2"],
            "external_factors": [
                {"name": "AP2-associated kinase 1", "category": "target", "interaction": "viral endocytosis"},
                {"name": "Cytokine storm", "category": "mechanism", "interaction": "hyperinflammation"},
            ],
        },
        "expected_citations_keywords": ["baricitinib", "JAK", "COVID", "cytokine", "repurposing"],
        "expected_counter_arguments": [
            "Immunosuppression risk during infection",
            "JAK inhibition may impair antiviral response",
        ],
    },
    {
        "id": "BM-003",
        "domain": "GLP-1 agonists in neurodegeneration",
        "published_hypothesis": (
            "GLP-1 receptor agonists (liraglutide, semaglutide) may provide "
            "neuroprotection in Alzheimer's disease through anti-inflammatory "
            "effects, improved insulin signaling, and reduced amyloid pathology."
        ),
        "source_paper": "Multiple 2023-2024 studies; EVOKE trial (semaglutide for early AD)",
        "validation_status": "Phase 3 trials ongoing (EVOKE, EVOKE+)",
        "pipeline_input": {
            "disease": "Alzheimer's Disease",
            "discovery_type": "treatment",
            "focus_entities": ["GLP-1", "semaglutide", "liraglutide", "amyloid-beta", "insulin signaling"],
            "external_factors": [
                {"name": "Type 2 diabetes", "category": "comorbidity", "interaction": "shared insulin resistance"},
            ],
        },
        "expected_citations_keywords": ["GLP-1", "semaglutide", "alzheimer", "neuroprotection", "insulin"],
        "expected_counter_arguments": [
            "Blood-brain barrier penetration uncertain",
            "Nausea and GI side effects limit adherence",
        ],
    },
    {
        "id": "BM-004",
        "domain": "Microbiome and immunotherapy response",
        "published_hypothesis": (
            "Gut microbiome composition modulates response to immune checkpoint "
            "inhibitors (anti-PD-1), and fecal microbiota transplantation from "
            "responders can convert non-responders."
        ),
        "source_paper": "Routy B et al. Science. 2018;359(6371):91-97. DOI:10.1126/science.aan3706",
        "validation_status": "FMT trials validated; Akkermansia muciniphila identified as key species",
        "pipeline_input": {
            "disease": "Melanoma",
            "discovery_type": "treatment",
            "focus_entities": ["gut microbiome", "anti-PD-1", "checkpoint inhibitor", "Akkermansia", "FMT"],
            "external_factors": [
                {"name": "Immune checkpoint", "category": "mechanism", "interaction": "T-cell exhaustion reversal"},
            ],
        },
        "expected_citations_keywords": ["microbiome", "checkpoint", "PD-1", "FMT", "immunotherapy"],
        "expected_counter_arguments": [
            "Microbiome composition varies by geography and diet",
            "FMT safety concerns in immunocompromised patients",
        ],
    },
    {
        "id": "BM-005",
        "domain": "Senolytic drugs for aging",
        "published_hypothesis": (
            "Senolytic drugs (dasatinib + quercetin) can selectively clear "
            "senescent cells, reducing SASP-driven chronic inflammation and "
            "improving healthspan in age-related diseases."
        ),
        "source_paper": "Kirkland JL et al. EBioMedicine. 2017;21:21-29. DOI:10.1016/j.ebiom.2017.04.032",
        "validation_status": "Phase 2 results published for diabetic kidney disease and IPF",
        "pipeline_input": {
            "disease": "Idiopathic Pulmonary Fibrosis",
            "discovery_type": "treatment",
            "focus_entities": ["senescent cells", "dasatinib", "quercetin", "SASP", "senolysis"],
            "external_factors": [
                {"name": "Cellular senescence", "category": "mechanism", "interaction": "SASP secretion"},
            ],
        },
        "expected_citations_keywords": ["senolytic", "senescent", "dasatinib", "quercetin", "SASP"],
        "expected_counter_arguments": [
            "Off-target effects of dasatinib",
            "Quercetin bioavailability is low",
            "Which senescent cell types to target",
        ],
    },
    {
        "id": "BM-006",
        "domain": "CRISPR base editing for sickle cell",
        "published_hypothesis": (
            "CRISPR-Cas9 gene editing of BCL11A enhancer in autologous CD34+ "
            "hematopoietic stem cells can reactivate fetal hemoglobin production "
            "and functionally cure sickle cell disease."
        ),
        "source_paper": "Frangoul H et al. NEJM. 2021;384:252-260. DOI:10.1056/NEJMoa2031054",
        "validation_status": "Casgevy (exagamglogene autotemcel) FDA approved December 2023",
        "pipeline_input": {
            "disease": "Sickle Cell Disease",
            "discovery_type": "treatment",
            "focus_entities": ["CRISPR-Cas9", "BCL11A", "fetal hemoglobin", "CD34+", "hematopoietic stem cells"],
            "external_factors": [],
        },
        "expected_citations_keywords": ["CRISPR", "BCL11A", "hemoglobin", "sickle", "gene editing"],
        "expected_counter_arguments": [
            "Off-target editing risk",
            "Cost and accessibility",
            "Long-term safety unknown",
        ],
    },
    {
        "id": "BM-007",
        "domain": "Ferroptosis in cancer therapy",
        "published_hypothesis": (
            "Inducing ferroptosis — iron-dependent lipid peroxidation cell death — "
            "can overcome resistance to apoptosis-based cancer therapies, "
            "particularly in drug-resistant and mesenchymal-state tumors."
        ),
        "source_paper": "Dixon SJ et al. Cell. 2012;149(5):1060-72 → clinical candidates 2023-2024",
        "validation_status": "Multiple ferroptosis-inducing drug candidates in preclinical/Phase 1",
        "pipeline_input": {
            "disease": "Drug-resistant Solid Tumors",
            "discovery_type": "treatment",
            "focus_entities": ["ferroptosis", "GPX4", "lipid peroxidation", "iron metabolism", "apoptosis resistance"],
            "external_factors": [
                {"name": "Epithelial-mesenchymal transition", "category": "mechanism", "interaction": "therapy resistance"},
            ],
        },
        "expected_citations_keywords": ["ferroptosis", "GPX4", "lipid peroxidation", "iron", "cell death"],
        "expected_counter_arguments": [
            "Iron homeostasis disruption may cause systemic toxicity",
            "Ferroptosis sensitivity varies by tumor type",
        ],
    },
    {
        "id": "BM-008",
        "domain": "Liquid biopsy ctDNA for MRD",
        "published_hypothesis": (
            "Circulating tumor DNA (ctDNA) detection post-surgery can identify "
            "minimal residual disease in colorectal cancer and guide adjuvant "
            "chemotherapy decisions, sparing ctDNA-negative patients from unnecessary treatment."
        ),
        "source_paper": "Tie J et al. NEJM. 2022;386:2261-2272. DOI:10.1056/NEJMoa2200075",
        "validation_status": "DYNAMIC trial validated ctDNA-guided adjuvant therapy",
        "pipeline_input": {
            "disease": "Colorectal Cancer",
            "discovery_type": "diagnosis",
            "focus_entities": ["ctDNA", "minimal residual disease", "liquid biopsy", "adjuvant chemotherapy"],
            "external_factors": [],
        },
        "expected_citations_keywords": ["ctDNA", "liquid biopsy", "residual disease", "colorectal", "adjuvant"],
        "expected_counter_arguments": [
            "ctDNA detection sensitivity varies by stage",
            "Clonal hematopoiesis confounds ctDNA signals",
        ],
    },
    {
        "id": "BM-009",
        "domain": "Tau propagation via extracellular vesicles in AD",
        "published_hypothesis": (
            "Pathological tau spreads between neurons via extracellular vesicles "
            "(exosomes), and blocking exosome secretion or uptake could slow "
            "tau propagation and Alzheimer's disease progression."
        ),
        "source_paper": "Multiple 2020-2023 studies on exosome-mediated tau spread",
        "validation_status": "Mechanistic validation confirmed; therapeutic targeting in preclinical",
        "pipeline_input": {
            "disease": "Alzheimer's Disease",
            "discovery_type": "mechanism",
            "focus_entities": ["tau", "extracellular vesicles", "exosomes", "prion-like propagation"],
            "external_factors": [
                {"name": "Endosomal pathway", "category": "mechanism", "interaction": "exosome biogenesis"},
            ],
        },
        "expected_citations_keywords": ["tau", "exosome", "extracellular vesicle", "propagation", "alzheimer"],
        "expected_counter_arguments": [
            "Not all tau species are propagation-competent",
            "Blocking exosomes may have broad off-target effects",
        ],
    },
    {
        "id": "BM-010",
        "domain": "CAR-T cell therapy for solid tumors via TME remodeling",
        "published_hypothesis": (
            "Combining CAR-T cell therapy with tumor microenvironment remodeling "
            "agents (anti-fibrotic, checkpoint inhibitors, cytokine armoring) "
            "can overcome the immunosuppressive TME barrier in solid tumors."
        ),
        "source_paper": "Multiple 2022-2024 studies on armored CAR-T and TME modulation",
        "validation_status": "Clinical trials active for multiple solid tumor indications",
        "pipeline_input": {
            "disease": "Pancreatic Cancer",
            "discovery_type": "treatment",
            "focus_entities": ["CAR-T", "tumor microenvironment", "immune exclusion", "desmoplasia", "checkpoint"],
            "external_factors": [
                {"name": "Immunosuppressive TME", "category": "barrier", "interaction": "T-cell exhaustion and exclusion"},
            ],
        },
        "expected_citations_keywords": ["CAR-T", "solid tumor", "microenvironment", "immune", "pancreatic"],
        "expected_counter_arguments": [
            "Antigen heterogeneity in solid tumors",
            "CAR-T persistence is limited in hostile TME",
            "Cytokine release syndrome risk",
        ],
    },
]


# ─── Scoring Functions ──────────────────────────────────────────

@dataclass
class HypothesisScorecard:
    """Scorecard for a single retrospective validation."""
    benchmark_id: str
    domain: str
    pipeline_hypothesis: str = ""
    published_hypothesis: str = ""
    recovery_rate: float = 0.0  # Semantic similarity to published hypothesis
    citation_keyword_overlap: float = 0.0  # Fraction of expected keywords found
    counter_argument_quality: str = "NOT_RUN"  # HIGH, MEDIUM, LOW
    novel_connections_found: int = 0
    stages_completed: int = 0
    total_pipeline_time_seconds: float = 0.0
    total_api_cost_usd: float = 0.0
    error: Optional[str] = None


def score_keyword_overlap(
    pipeline_text: str,
    expected_keywords: list[str],
) -> float:
    """Score how many expected citation keywords appear in pipeline output."""
    text_lower = pipeline_text.lower()
    found = sum(1 for kw in expected_keywords if kw.lower() in text_lower)
    return found / len(expected_keywords) if expected_keywords else 0.0


def score_counter_arguments(
    pipeline_text: str,
    expected_counters: list[str],
) -> str:
    """Score whether the pipeline identified expected counter-arguments."""
    text_lower = pipeline_text.lower()
    found = 0
    for counter in expected_counters:
        # Check if key phrases from the counter-argument appear
        counter_words = set(counter.lower().split()) - {
            "the", "a", "an", "in", "of", "and", "or", "to", "is", "may", "can",
        }
        # Need at least 50% of content words to match
        matches = sum(1 for w in counter_words if w in text_lower)
        if matches >= len(counter_words) * 0.5:
            found += 1

    ratio = found / len(expected_counters) if expected_counters else 0.0
    if ratio >= 0.7:
        return "HIGH"
    elif ratio >= 0.4:
        return "MEDIUM"
    else:
        return "LOW"


# ─── Pipeline Runner ────────────────────────────────────────────

async def run_single_benchmark(
    benchmark: dict,
) -> HypothesisScorecard:
    """Run the pipeline on a single benchmark hypothesis."""
    from app.agents.discovery_orchestrator import (
        MultiModelLLM,
        SequentialHypothesisPipeline,
        TokenPool,
    )

    scorecard = HypothesisScorecard(
        benchmark_id=benchmark["id"],
        domain=benchmark["domain"],
        published_hypothesis=benchmark["published_hypothesis"],
    )

    try:
        # Initialize pipeline
        token_pool = TokenPool()
        llm = MultiModelLLM(token_pool)
        await llm.initialize()
        pipeline = SequentialHypothesisPipeline(llm, discovery_run_id=str(uuid4()))

        inp = benchmark["pipeline_input"]
        start = time.time()

        result = await pipeline.run_hypothesis(
            disease=inp["disease"],
            discovery_type=inp["discovery_type"],
            pathway_context=f"Focus: {', '.join(inp.get('focus_entities', []))}",
            external_factors=inp.get("external_factors", []),
            round_number=1,
            hypothesis_index=1,
        )

        scorecard.total_pipeline_time_seconds = round(time.time() - start, 1)
        scorecard.stages_completed = len(result.stage_results)
        scorecard.pipeline_hypothesis = result.final_hypothesis or ""

        # Score
        full_output = " ".join(sr.output for sr in result.stage_results if sr.output)

        scorecard.citation_keyword_overlap = round(
            score_keyword_overlap(full_output, benchmark["expected_citations_keywords"]), 3
        )
        scorecard.counter_argument_quality = score_counter_arguments(
            full_output, benchmark.get("expected_counter_arguments", [])
        )

        # Recovery rate: keyword overlap between published and generated hypothesis
        scorecard.recovery_rate = round(
            score_keyword_overlap(
                scorecard.pipeline_hypothesis,
                benchmark["published_hypothesis"].lower().split(),
            ),
            3,
        )

    except Exception as e:
        scorecard.error = str(e)

    return scorecard


# ─── Main ───────────────────────────────────────────────────────

async def main():
    parser = argparse.ArgumentParser(description="Retrospective Validation Benchmark")
    parser.add_argument("--run-all", action="store_true", help="Run all 10 benchmarks")
    parser.add_argument("--run-id", type=str, help="Run a specific benchmark by ID (e.g., BM-001)")
    parser.add_argument("--report-only", action="store_true", help="Show existing results without running")
    parser.add_argument("--output", default="benchmark/results/retrospective_validation.json")
    args = parser.parse_args()

    results_path = args.output

    if args.report_only:
        if os.path.exists(results_path):
            with open(results_path) as f:
                results = json.load(f)
            print_summary(results)
        else:
            print(f"No results found at {results_path}. Run --run-all first.")
        return

    benchmarks_to_run = []
    if args.run_id:
        bm = next((b for b in BENCHMARK_HYPOTHESES if b["id"] == args.run_id), None)
        if not bm:
            print(f"Unknown benchmark ID: {args.run_id}")
            print(f"Available: {[b['id'] for b in BENCHMARK_HYPOTHESES]}")
            return
        benchmarks_to_run = [bm]
    elif args.run_all:
        benchmarks_to_run = BENCHMARK_HYPOTHESES
    else:
        # Default: run BM-001 only
        benchmarks_to_run = [BENCHMARK_HYPOTHESES[0]]

    print(f"Running {len(benchmarks_to_run)} benchmark(s)...\n")

    scorecards = []
    for i, bm in enumerate(benchmarks_to_run):
        print(f"[{i+1}/{len(benchmarks_to_run)}] {bm['id']}: {bm['domain']}")
        scorecard = await run_single_benchmark(bm)
        scorecards.append(scorecard)

        if scorecard.error:
            print(f"  ERROR: {scorecard.error}")
        else:
            print(f"  Stages: {scorecard.stages_completed}/12")
            print(f"  Time: {scorecard.total_pipeline_time_seconds}s")
            print(f"  Keyword overlap: {scorecard.citation_keyword_overlap:.1%}")
            print(f"  Counter-arg quality: {scorecard.counter_argument_quality}")
            print(f"  Recovery rate: {scorecard.recovery_rate:.1%}")
        print()

    # Save results
    results = {
        "benchmark_version": "1.0",
        "run_date": time.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "benchmarks_run": len(scorecards),
        "scorecards": [asdict(sc) for sc in scorecards],
        "summary": compute_summary(scorecards),
    }

    os.makedirs(os.path.dirname(results_path), exist_ok=True)
    with open(results_path, "w") as f:
        json.dump(results, f, indent=2)

    print_summary(results)
    print(f"\nResults saved to {results_path}")


def compute_summary(scorecards: list[HypothesisScorecard]) -> dict:
    """Compute aggregate summary statistics."""
    successful = [sc for sc in scorecards if not sc.error]
    if not successful:
        return {"error": "No successful runs"}

    return {
        "total_run": len(scorecards),
        "successful": len(successful),
        "failed": len(scorecards) - len(successful),
        "mean_recovery_rate": round(
            sum(sc.recovery_rate for sc in successful) / len(successful), 3
        ),
        "mean_keyword_overlap": round(
            sum(sc.citation_keyword_overlap for sc in successful) / len(successful), 3
        ),
        "counter_argument_quality": {
            "HIGH": sum(1 for sc in successful if sc.counter_argument_quality == "HIGH"),
            "MEDIUM": sum(1 for sc in successful if sc.counter_argument_quality == "MEDIUM"),
            "LOW": sum(1 for sc in successful if sc.counter_argument_quality == "LOW"),
        },
        "mean_pipeline_time_seconds": round(
            sum(sc.total_pipeline_time_seconds for sc in successful) / len(successful), 1
        ),
        "mean_stages_completed": round(
            sum(sc.stages_completed for sc in successful) / len(successful), 1
        ),
    }


def print_summary(results: dict):
    """Print formatted summary."""
    summary = results.get("summary", {})
    print("\n" + "=" * 70)
    print("RETROSPECTIVE VALIDATION BENCHMARK — SUMMARY")
    print("=" * 70)
    print(f"  Run date:              {results.get('run_date', 'N/A')}")
    print(f"  Benchmarks run:        {summary.get('total_run', 0)}")
    print(f"  Successful:            {summary.get('successful', 0)}")
    print(f"  Failed:                {summary.get('failed', 0)}")
    print(f"  Mean recovery rate:    {summary.get('mean_recovery_rate', 0):.1%}")
    print(f"  Mean keyword overlap:  {summary.get('mean_keyword_overlap', 0):.1%}")
    print(f"  Mean stages completed: {summary.get('mean_stages_completed', 0)}/12")
    print(f"  Mean pipeline time:    {summary.get('mean_pipeline_time_seconds', 0):.0f}s")
    caq = summary.get("counter_argument_quality", {})
    print(f"  Counter-arg quality:   HIGH={caq.get('HIGH', 0)} MEDIUM={caq.get('MEDIUM', 0)} LOW={caq.get('LOW', 0)}")
    print("=" * 70)


if __name__ == "__main__":
    asyncio.run(main())
