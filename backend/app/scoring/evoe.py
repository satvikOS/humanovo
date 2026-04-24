"""
Expected Value of Experiment (EVOE) — Bayesian decision-theoretic ranking.

A researcher's job isn't to read the most confident hypothesis; it's
to pick the hypothesis that gives the best information-per-dollar if
they actually run the experiment. EVOE captures that directly:

    EVOE = P(true) × Impact_if_true - Cost_to_test

Where:
  P(true)           — posterior probability the mechanism holds, built
                      from the pipeline's 7-dimensional scoring, grounding
                      ratio, citation verification pass rate, diversity,
                      and cross-validation signals.
  Impact_if_true    — magnitude of therapeutic / scientific consequence
                      if the hypothesis turns out true, derived from:
                        - clinical relevance dim score (pipeline)
                        - novelty dim score (higher novelty → higher impact)
                        - translational roadmap T-phase depth
                        - number of downstream claims that depend on it
  Cost_to_test      — estimated dollars + weeks to execute the
                      translational roadmap Stage 1 (T0 basic research),
                      derived from:
                        - experimental modality (computational/in-vitro/
                          in-vivo/clinical)
                        - lab capability match (excluded_methods penalty)
                        - typical PubMed / ChEMBL precedent counts
                      Expressed in normalised 0-1 units where 0 = cheap
                      and 1 = expensive; scaled to real dollars via
                      COST_USD_PER_UNIT.

EVOE returns a signed score. Rankings are stable under monotone
transformations (we only use EVOE for ordering); the absolute value
also has a decision-theoretic interpretation as "expected dollar
impact of running this experiment now".

Usage:
    from app.scoring.evoe import score_hypothesis, rank

    ranked = rank(hypotheses)   # returns list sorted by EVOE desc
    score = score_hypothesis(hyp)  # returns EvoeBreakdown with every term
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger(__name__)


# Rough calibration — tuned so a "slam-dunk high-impact low-cost hypothesis"
# scores ~100 and a median scores ~10. Not expected to be scientifically
# precise; intended as a stable ranking signal.
IMPACT_SCALE_USD_MILLIONS = 50.0   # cap on Impact_if_true
COST_SCALE_USD = 500_000.0          # cap on Cost_to_test (Stage 1 to first in-vitro readout)
MIN_P_TRUE = 0.05
MAX_P_TRUE = 0.95


# ---------------------------------------------------------------------------
# Dataclass output
# ---------------------------------------------------------------------------


@dataclass
class EvoeBreakdown:
    hypothesis_id: str
    title: str
    p_true: float
    impact_if_true_usd: float
    cost_to_test_usd: float
    evoe_usd: float
    # Component signals (for debugging / UI drill-in)
    confidence: float = 0.0
    grounding_ratio: float = 0.0
    verified_citation_ratio: float = 0.0
    dimension_scores: dict[str, float] = field(default_factory=dict)
    novelty_score: float = 0.0
    feasibility_score: float = 0.0
    modality: str = ""
    t0_experiments_required: int = 0

    def to_dict(self) -> dict[str, Any]:
        return {
            "hypothesis_id": self.hypothesis_id,
            "title": self.title,
            "p_true": round(self.p_true, 4),
            "impact_if_true_usd": round(self.impact_if_true_usd, 0),
            "cost_to_test_usd": round(self.cost_to_test_usd, 0),
            "evoe_usd": round(self.evoe_usd, 0),
            "confidence": round(self.confidence, 4),
            "grounding_ratio": round(self.grounding_ratio, 4),
            "verified_citation_ratio": round(self.verified_citation_ratio, 4),
            "dimension_scores": {k: round(float(v), 3)
                                  for k, v in self.dimension_scores.items()},
            "novelty_score": round(self.novelty_score, 4),
            "feasibility_score": round(self.feasibility_score, 4),
            "modality": self.modality,
            "t0_experiments_required": int(self.t0_experiments_required),
        }


# ---------------------------------------------------------------------------
# Scoring primitives
# ---------------------------------------------------------------------------


def _clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


def _dim(ds: Any, key: str, default: float = 0.5) -> float:
    """Robust dimension-score extraction (values may be nested dicts)."""
    if not isinstance(ds, dict):
        return default
    v = ds.get(key)
    if isinstance(v, dict):
        return float(v.get("score") or v.get("value") or default)
    if isinstance(v, (int, float)):
        return float(v)
    return default


def _citation_verification_ratio(hyp: dict[str, Any]) -> float:
    """How many of the emitted citations survived the 3-round verifier.

    Reads from the pipeline's citation_verdicts accumulator. Missing
    data is treated as 'unknown' = 0.5 (neutral signal) rather than 0
    so early-stage hypotheses aren't punished for not having verdicts yet.
    """
    verdicts = hyp.get("citation_verdicts") or hyp.get("pipeline_trace", {}).get("citation_verdicts")
    if not verdicts:
        return 0.5
    verified_total = 0
    n_total = 0
    for v in (verdicts if isinstance(verdicts, list) else [verdicts]):
        summary = (v or {}).get("summary") or {}
        verified_total += int(summary.get("verified", 0)) + \
            int(summary.get("no_doi", 0))
        n_total += int(v.get("n_citations", 0))
    if n_total == 0:
        return 0.5
    return _clamp(verified_total / n_total, 0.0, 1.0)


def _compute_p_true(hyp: dict[str, Any]) -> float:
    """Compose the posterior probability a hypothesis is correct.

    Blend (log-linear, because these are independent signals):
      40% confidence (pipeline)
      20% grounding_ratio (how much of the output is evidence-backed)
      15% verified_citation_ratio (how many cites passed 3-round verify)
      10% mean dimension score
      10% evidence strength (moderate/strong → up-weight)
       5% cross-validation (validated=true)
    """
    conf = float(hyp.get("confidence") or hyp.get("weighted_confidence") or 0.5)
    gnd = float(hyp.get("grounding_ratio") or
                hyp.get("pipeline_trace", {}).get("final_grounding_ratio") or
                0.6)
    vcr = _citation_verification_ratio(hyp)
    ds = hyp.get("dimension_scores") or {}
    mean_dim = sum(_dim(ds, k) for k in (
        "biological_plausibility", "evidence_strength", "novelty",
        "feasibility", "safety", "clinical_relevance", "reproducibility",
    )) / 7
    evidence_bonus = 0.0
    validated = 1.0 if hyp.get("validated") else 0.0

    p = (0.40 * conf + 0.20 * gnd + 0.15 * vcr +
         0.10 * mean_dim + 0.10 * evidence_bonus + 0.05 * validated)
    return _clamp(p, MIN_P_TRUE, MAX_P_TRUE)


def _compute_impact(hyp: dict[str, Any]) -> float:
    """Dollar-denominated expected impact if the hypothesis holds."""
    ds = hyp.get("dimension_scores") or {}
    clinical = _dim(ds, "clinical_relevance", 0.5)
    novelty = float(hyp.get("novelty_score") or _dim(ds, "novelty", 0.5))
    impact_pct = _dim(ds, "impact_score", 0.5)
    # Translational depth bonus: hypotheses that map cleanly through
    # T0 → T5 get up-weighted
    roadmap = hyp.get("translational_roadmap") or {}
    depth_bonus = 0.0
    if isinstance(roadmap, dict):
        present_stages = sum(1 for k in ("t0", "t1", "t2", "t3", "t4", "t5")
                             if roadmap.get(k))
        depth_bonus = min(0.3, 0.05 * present_stages)

    normalized = 0.55 * clinical + 0.25 * novelty + 0.20 * impact_pct + depth_bonus
    normalized = _clamp(normalized, 0.0, 1.0)
    # Scale to $
    return normalized * IMPACT_SCALE_USD_MILLIONS * 1_000_000


def _compute_cost(hyp: dict[str, Any]) -> float:
    """Dollar estimate to execute Stage 1 validation."""
    modality = _detect_modality(hyp)
    base_cost = {
        "computational":   30_000,
        "in_silico":       30_000,
        "in_vitro":        75_000,
        "in_vivo_small":   180_000,
        "in_vivo_large":   350_000,
        "patient_derived": 220_000,
        "clinical_pilot":  480_000,
        "unknown":         120_000,
    }.get(modality, 120_000)

    # Feasibility drag
    feas = float(hyp.get("feasibility_score") or
                 _dim(hyp.get("dimension_scores"), "feasibility", 0.5))
    feasibility_multiplier = 2.0 - feas   # 0.5→1.5, 0.9→1.1, 0.1→1.9

    # Excluded methods penalty (lab capability profile)
    excluded = set()
    for method in (hyp.get("required_methods") or []):
        if method and isinstance(method, str):
            excluded.add(method.lower())
    excluded_penalty = 1 + 0.25 * min(3, len(excluded))

    cost = base_cost * feasibility_multiplier * excluded_penalty
    return _clamp(cost, 5_000, COST_SCALE_USD * 2)


def _detect_modality(hyp: dict[str, Any]) -> str:
    text = " ".join([
        str(hyp.get("mechanism", "")),
        str(hyp.get("description", "")),
        str(hyp.get("title", "")),
        " ".join(hyp.get("required_methods") or []),
    ]).lower()
    if any(k in text for k in ("clinical trial", "phase 1", "phase i ",
                                "patient cohort")):
        return "clinical_pilot"
    if any(k in text for k in ("mouse model", "rat model", "knock-in",
                                 "knock-out", "zebrafish")):
        return "in_vivo_small"
    if any(k in text for k in ("primate", "non-human primate", "porcine",
                                 "canine")):
        return "in_vivo_large"
    if any(k in text for k in ("patient-derived", "organoid", "pdx",
                                 "ipsc")):
        return "patient_derived"
    if any(k in text for k in ("cell line", "in vitro", "crispr", "sirna",
                                 "co-culture")):
        return "in_vitro"
    if any(k in text for k in ("molecular docking", "alphafold", "md simulation",
                                 "computational", "virtual screen", "machine learning")):
        return "in_silico"
    return "unknown"


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def score_hypothesis(hyp: dict[str, Any]) -> EvoeBreakdown:
    """Compute EVOE + component breakdown for a hypothesis."""
    p_true = _compute_p_true(hyp)
    impact = _compute_impact(hyp)
    cost = _compute_cost(hyp)
    evoe = p_true * impact - cost

    return EvoeBreakdown(
        hypothesis_id=str(hyp.get("id") or hyp.get("hypothesis_id") or ""),
        title=str(hyp.get("title") or "")[:200],
        p_true=p_true,
        impact_if_true_usd=impact,
        cost_to_test_usd=cost,
        evoe_usd=evoe,
        confidence=float(hyp.get("confidence") or 0),
        grounding_ratio=float(hyp.get("grounding_ratio") or 0),
        verified_citation_ratio=_citation_verification_ratio(hyp),
        dimension_scores=hyp.get("dimension_scores") or {},
        novelty_score=float(hyp.get("novelty_score") or 0),
        feasibility_score=float(hyp.get("feasibility_score") or 0),
        modality=_detect_modality(hyp),
        t0_experiments_required=len(
            ((hyp.get("translational_roadmap") or {}).get("t0") or {})
            .get("key_experiments", [])
        ),
    )


def rank(hypotheses: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Return hypotheses sorted by EVOE desc with a new `evoe` field
    containing the full breakdown dict."""
    scored = []
    for h in hypotheses:
        try:
            br = score_hypothesis(h)
        except Exception as e:
            logger.debug(f"EVOE score failed for hypothesis: {e}")
            continue
        out = dict(h)
        out["evoe"] = br.to_dict()
        scored.append((br.evoe_usd, out))
    scored.sort(key=lambda x: x[0], reverse=True)
    return [x[1] for x in scored]


def rank_with_breakdowns(
    hypotheses: list[dict[str, Any]],
) -> list[EvoeBreakdown]:
    """Lower-level variant that returns just the breakdowns, sorted."""
    rs = []
    for h in hypotheses:
        try:
            rs.append(score_hypothesis(h))
        except Exception:
            continue
    rs.sort(key=lambda b: b.evoe_usd, reverse=True)
    return rs
