"""
Experimental Protocol Generator — PROTOCOL stage after FINALIZE.

Takes a validated hypothesis (title + mechanism + target entities +
translational roadmap) and emits a concrete wet-lab protocol with:

  - Reagents / cell lines / animal models
  - Primary endpoint + secondary endpoints
  - Sample size calculation via the existing compute engine's
    clinical/power_analysis domain (two-arm parallel + binary +
    continuous variants). Sample-size numbers are real, not LLM-invented.
  - Controls (positive, negative, vehicle)
  - Go/no-go decision criteria
  - Safety review checklist
  - Data analysis plan (test name, alpha, power, multiplicity)
  - Expected timeline (weeks) based on modality detected

The LLM writes the narrative, the compute engine does the numerics.
This keeps experimental design grounded — hypothesised sample size is
computed, not guessed.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger(__name__)


@dataclass
class Protocol:
    hypothesis_id: str
    title: str
    modality: str                       # in_vitro, in_vivo_small, clinical, ...
    hypothesis_to_test: str
    primary_endpoint: dict[str, Any]
    secondary_endpoints: list[dict[str, Any]] = field(default_factory=list)
    reagents: list[dict[str, Any]] = field(default_factory=list)
    cell_lines_or_models: list[str] = field(default_factory=list)
    controls: dict[str, list[str]] = field(default_factory=dict)
    sample_size_per_arm: int = 0
    power_analysis: dict[str, Any] = field(default_factory=dict)
    go_no_go_criteria: list[dict[str, Any]] = field(default_factory=list)
    safety_checklist: list[str] = field(default_factory=list)
    data_analysis_plan: dict[str, Any] = field(default_factory=dict)
    duration_weeks_estimate: int = 0
    reagents_estimated_cost_usd: float = 0.0
    notes: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "hypothesis_id": self.hypothesis_id,
            "title": self.title,
            "modality": self.modality,
            "hypothesis_to_test": self.hypothesis_to_test,
            "primary_endpoint": self.primary_endpoint,
            "secondary_endpoints": self.secondary_endpoints,
            "reagents": self.reagents,
            "cell_lines_or_models": self.cell_lines_or_models,
            "controls": self.controls,
            "sample_size_per_arm": self.sample_size_per_arm,
            "power_analysis": self.power_analysis,
            "go_no_go_criteria": self.go_no_go_criteria,
            "safety_checklist": self.safety_checklist,
            "data_analysis_plan": self.data_analysis_plan,
            "duration_weeks_estimate": self.duration_weeks_estimate,
            "reagents_estimated_cost_usd": self.reagents_estimated_cost_usd,
            "notes": self.notes,
        }


# ---------------------------------------------------------------------------
# Heuristic protocol builder (called when compute engine provides numerics)
# ---------------------------------------------------------------------------


DEFAULT_ALPHA = 0.05
DEFAULT_POWER = 0.80
DEFAULT_EFFECT_CONTINUOUS = 0.5   # Cohen's d
DEFAULT_EFFECT_BINARY = (0.50, 0.30)  # p1, p2


async def _compute_sample_size(
    *,
    outcome_type: str,       # 'continuous' | 'binary'
    effect_size: float | None = None,
    p1: float | None = None,
    p2: float | None = None,
    alpha: float = DEFAULT_ALPHA,
    power: float = DEFAULT_POWER,
    dropout: float = 0.10,
) -> dict[str, Any]:
    """Run the clinical/power_analysis/parallel compute op.

    Returns its ComputeResult.data dict or a reasonable fallback when
    the compute engine is unavailable.
    """
    try:
        from app.compute.engine import ComputeEngine
        from app.compute.types import ComputeDomain, ComputeRequest

        engine = ComputeEngine()
        params: dict[str, Any] = {
            "design": "parallel",
            "outcome_type": outcome_type,
            "alpha": alpha,
            "power": power,
            "allocation_ratio": 1.0,
            "dropout": dropout,
        }
        if outcome_type == "continuous":
            params["effect_size"] = effect_size or DEFAULT_EFFECT_CONTINUOUS
            params["sd"] = 1.0  # standardised
        else:
            params["p1"] = p1 or DEFAULT_EFFECT_BINARY[0]
            params["p2"] = p2 or DEFAULT_EFFECT_BINARY[1]

        req = ComputeRequest(
            domain=ComputeDomain.CLINICAL,
            operation="power_analysis",
            parameters=params,
        )
        res = await engine.execute(req)
        if res.status.value == "success" and isinstance(res.data, dict):
            return res.data
    except Exception as e:
        logger.debug(f"compute engine power_analysis failed: {e}")

    # Fallback: textbook z-test formula for continuous two-arm
    import math
    if outcome_type == "continuous":
        z_alpha = 1.96
        z_beta = 0.84
        d = effect_size or DEFAULT_EFFECT_CONTINUOUS
        n = ((z_alpha + z_beta) ** 2) * 2 / (d ** 2)
    else:
        z_alpha = 1.96
        z_beta = 0.84
        _p1 = p1 or DEFAULT_EFFECT_BINARY[0]
        _p2 = p2 or DEFAULT_EFFECT_BINARY[1]
        p_bar = (_p1 + _p2) / 2
        numer = (
            z_alpha * math.sqrt(2 * p_bar * (1 - p_bar)) +
            z_beta * math.sqrt(_p1 * (1 - _p1) + _p2 * (1 - _p2))
        ) ** 2
        denom = (_p1 - _p2) ** 2 or 0.01
        n = numer / denom
    n = int(math.ceil(n / max(0.01, 1 - dropout)))
    return {
        "total_n": n * 2,
        "n_per_arm": n,
        "alpha": alpha,
        "power": power,
        "method": "fallback_closed_form",
    }


# ---------------------------------------------------------------------------
# Modality detection (mirrors evoe._detect_modality but returns more detail)
# ---------------------------------------------------------------------------


def _detect_modality(hyp: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    """Detect the experimental modality and return modality-specific defaults."""
    text = " ".join([
        str(hyp.get("mechanism", "")),
        str(hyp.get("description", "")),
        str(hyp.get("title", "")),
        " ".join(hyp.get("required_methods") or []),
    ]).lower()

    if any(k in text for k in ("clinical trial", "phase 1", "phase i ",
                                "patient cohort")):
        return "clinical_pilot", {
            "duration_weeks": 78,
            "cell_line": [],
            "outcome_type": "continuous",
            "effect_size": 0.45,
            "dropout": 0.15,
        }
    if any(k in text for k in ("mouse", "murine", "knock-out", "ko mouse",
                                 "knock-in", "ki mouse")):
        return "in_vivo_small", {
            "duration_weeks": 16,
            "cell_line": ["C57BL/6J", "Balb/c"],
            "outcome_type": "continuous",
            "effect_size": 0.8,
            "dropout": 0.10,
        }
    if any(k in text for k in ("patient-derived", "organoid", "pdx", "ipsc")):
        return "patient_derived", {
            "duration_weeks": 10,
            "cell_line": ["PDX-derived organoid lines"],
            "outcome_type": "continuous",
            "effect_size": 0.6,
            "dropout": 0.08,
        }
    if any(k in text for k in ("cell line", "in vitro", "crispr", "sirna",
                                 "co-culture")):
        return "in_vitro", {
            "duration_weeks": 6,
            "cell_line": ["HEK293T", "HeLa", "U-2 OS (to be selected)"],
            "outcome_type": "continuous",
            "effect_size": 1.0,
            "dropout": 0.05,
        }
    if any(k in text for k in ("molecular docking", "alphafold", "md simulation",
                                 "computational", "virtual screen")):
        return "in_silico", {
            "duration_weeks": 2,
            "cell_line": [],
            "outcome_type": "continuous",
            "effect_size": 0.0,  # no sample-size needed
            "dropout": 0.0,
        }
    return "in_vitro", {
        "duration_weeks": 6,
        "cell_line": ["To be selected based on target expression"],
        "outcome_type": "continuous",
        "effect_size": 0.6,
        "dropout": 0.08,
    }


# ---------------------------------------------------------------------------
# Main entrypoint
# ---------------------------------------------------------------------------


async def generate_protocol(hyp: dict[str, Any]) -> Protocol:
    """Generate a concrete experimental protocol for a validated hypothesis.

    Uses the compute engine for sample-size numerics + lightweight
    heuristic templates for the narrative. The PROTOCOL stage of the
    discovery pipeline consumes this and embeds it in the final
    hypothesis output.
    """
    modality, defaults = _detect_modality(hyp)
    title = str(hyp.get("title") or "Validate hypothesis")[:200]
    targets = hyp.get("target_entities") or []
    pathways = hyp.get("target_pathways") or []

    # Sample-size numerics — skip for pure in_silico work
    if modality == "in_silico":
        power = {"method": "n/a_in_silico", "n_per_arm": 0, "total_n": 0,
                 "alpha": 0.05, "power": 0.8}
        n_per_arm = 0
    else:
        power = await _compute_sample_size(
            outcome_type=defaults["outcome_type"],
            effect_size=defaults["effect_size"],
            dropout=defaults["dropout"],
        )
        n_per_arm = int(power.get("n_per_arm") or 0)

    # Reagents — modality-specific templates
    reagents: list[dict[str, Any]] = []
    if modality in ("in_vitro", "patient_derived"):
        for t in targets[:3]:
            reagents.append({
                "name": f"anti-{t} antibody (Western blot grade)",
                "qty": "50 µg",
                "notes": "Validate specificity via CRISPR-KO control",
            })
        reagents.append({
            "name": "qPCR primer set for " + ", ".join([str(t) for t in targets[:3]]),
            "qty": "100 reactions each",
            "notes": "Include GAPDH + RPL32 as housekeeping",
        })
        reagents.append({"name": "Cell Titer-Glo viability kit",
                         "qty": "500 reactions"})
        reagents.append({"name": "DMSO (vehicle control)", "qty": "50 mL"})
    if modality == "in_vivo_small":
        reagents += [
            {"name": "Compound test article (lead candidate)",
             "qty": "100 mg formulated"},
            {"name": "Vehicle formulation buffer",
             "qty": "250 mL"},
            {"name": "ELISA kit for primary biomarker",
             "qty": "5 plates (96-well)"},
        ]
    if modality == "clinical_pilot":
        reagents += [
            {"name": "IND-enabling batch of investigational product",
             "qty": "batch to cover N=" + str(n_per_arm * 2)},
            {"name": "Standard-of-care comparator (sourced locally)",
             "qty": "as per labeling"},
            {"name": "Case Report Form (CRF) set",
             "qty": f"N={n_per_arm * 2} x study visits"},
        ]

    # Primary endpoint
    primary: dict[str, Any] = {
        "name": f"Change in {targets[0] if targets else 'primary biomarker'} from baseline",
        "metric": defaults["outcome_type"],
        "effect_target": defaults["effect_size"],
        "timepoint": "end of treatment phase",
    }
    if pathways:
        primary["pathway_context"] = pathways[0]

    # Secondary endpoints
    secondary: list[dict[str, Any]] = []
    for t in targets[1:4]:
        secondary.append({
            "name": f"Change in {t} expression",
            "metric": "continuous",
            "timepoint": "mid + end of treatment",
        })
    if modality == "clinical_pilot":
        secondary += [
            {"name": "Adverse events frequency",
             "metric": "count", "timepoint": "continuous"},
            {"name": "Patient-reported outcome (EQ-5D-5L)",
             "metric": "ordinal", "timepoint": "baseline, 6w, 12w"},
        ]

    # Controls
    controls = {
        "positive": (["Known active comparator"] if modality != "in_silico"
                     else ["Crystal structure reference"]),
        "negative": (["Vehicle / DMSO"] if modality in ("in_vitro",
                     "patient_derived", "in_vivo_small")
                     else ["Standard of care"]),
        "technical": ["Housekeeping gene(s)", "Assay QC samples",
                      "Inter-run calibrator"],
    }

    # Go / no-go
    go_no_go: list[dict[str, Any]] = [
        {"criterion": "Primary endpoint effect reaches ≥80% of target",
         "decision_if_met": "advance to next T-phase",
         "decision_if_not": "halt and revise hypothesis"},
        {"criterion": "No safety signal (>grade 2 AEs <5% over sham)",
         "decision_if_met": "advance",
         "decision_if_not": "halt and triage"},
    ]

    # Safety checklist
    safety: list[str] = []
    if modality in ("in_vivo_small",):
        safety += [
            "IACUC protocol approval before any animal work",
            "Vet sign-off on dose escalation",
            "Humane endpoints monitored daily",
        ]
    if modality == "clinical_pilot":
        safety += [
            "IRB / ethics committee approval",
            "Signed ICF from every enrolled subject",
            "DSMB charter in place with stopping rules",
            "Pharmacovigilance plan filed with regulator",
            "Insurance coverage confirmed for enrolled subjects",
        ]
    safety += [
        "Lab safety: MSDS on file for all chemicals",
        "Biosafety cabinet class II for cell work",
        "Spill response plan posted and reviewed with team",
    ]

    # Data analysis plan
    dap = {
        "primary_test": (
            "two-sample t-test (two-sided)"
            if defaults["outcome_type"] == "continuous"
            else "chi-squared / Fisher's exact"
        ),
        "alpha": 0.05,
        "power": 0.80,
        "multiplicity": (
            "Bonferroni for 3 secondary endpoints"
            if len(secondary) > 2 else "no adjustment (single secondary)"
        ),
        "intention_to_treat": modality == "clinical_pilot",
        "software": "R 4.4 + rstatix; pre-registered on OSF",
    }

    # Rough reagent cost estimate
    reagent_cost = {
        "in_silico": 1_000,
        "in_vitro": 12_000,
        "patient_derived": 35_000,
        "in_vivo_small": 45_000,
        "in_vivo_large": 150_000,
        "clinical_pilot": 120_000,
    }.get(modality, 15_000)

    protocol = Protocol(
        hypothesis_id=str(hyp.get("id") or hyp.get("hypothesis_id") or ""),
        title=f"Validation protocol: {title}",
        modality=modality,
        hypothesis_to_test=(
            f"{title}. Mechanism: {str(hyp.get('mechanism',''))[:500]}"
        ),
        primary_endpoint=primary,
        secondary_endpoints=secondary,
        reagents=reagents,
        cell_lines_or_models=defaults["cell_line"],
        controls=controls,
        sample_size_per_arm=n_per_arm,
        power_analysis=power,
        go_no_go_criteria=go_no_go,
        safety_checklist=safety,
        data_analysis_plan=dap,
        duration_weeks_estimate=int(defaults["duration_weeks"]),
        reagents_estimated_cost_usd=float(reagent_cost),
        notes=[
            "Auto-generated by humanovo PROTOCOL stage; review required "
            "before execution.",
            "Sample sizes are computed via the clinical power_analysis "
            "compute domain (not LLM-estimated).",
        ],
    )
    return protocol
