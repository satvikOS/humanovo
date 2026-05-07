"""
Diversity Enforcer — Ensures Each Hypothesis Explores a Distinct Direction

Operates in two modes:

  A) PROACTIVE (run during SEED stage):
     Before the seed is committed, compute its mechanism axes and similarity
     to previously accepted hypotheses in the same discovery run. If any of
     the following conditions holds, REJECT the seed and request regeneration:
       - cosine similarity in either embedding space >= SIMILARITY_THRESHOLD
         (default 0.82) with any prior accepted seed;
       - target pathway overlap >= PATHWAY_OVERLAP_MAX (default 0.6);
       - intervention modality is identical across 2+ prior hypotheses
         (unless the discovery_type explicitly allows modality clustering,
         e.g. "combination_therapy").

  B) REACTIVE (run after FINALIZE stage):
     Score the final hypothesis set for overall diversity. Produce a
     `DiversityReport` attached to the discovery run for auditability and
     for use by the diversity-aware scorer.

Axes we track:

  * pathway_axis      — target biological pathway(s)
  * entity_axis       — target genes / proteins / molecules
  * modality_axis     — therapeutic modality (small molecule / biologic /
                        gene therapy / cell therapy / device / lifestyle / …)
  * mechanism_axis    — mechanism category (inhibition / activation /
                        degradation / sequestration / pathway rerouting / …)
  * organ_axis        — organ / tissue system
  * paradigm_axis     — scientific paradigm (direct target / upstream /
                        downstream / systemic / microbiome / metabolic / …)

If all prior hypotheses share at least 3 axes with the candidate, the
candidate is rejected even if the cosine similarity is below threshold.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from enum import Enum
from typing import Any

logger = logging.getLogger(__name__)

# Similarity thresholds
SIMILARITY_THRESHOLD = 0.82
PATHWAY_OVERLAP_MAX = 0.60
MIN_AXIS_DIFFERENCES = 2  # out of 6 axes


class MechanismAxis(str, Enum):
    PATHWAY = "pathway_axis"
    ENTITY = "entity_axis"
    MODALITY = "modality_axis"
    MECHANISM = "mechanism_axis"
    ORGAN = "organ_axis"
    PARADIGM = "paradigm_axis"


# ---------------------------------------------------------------------------
# Axis extraction vocabulary
# ---------------------------------------------------------------------------

_MODALITY_KEYWORDS = {
    "small_molecule": ["inhibitor", "agonist", "antagonist", "small molecule",
                       "ligand", "kinase inhibitor", "enzyme inhibitor",
                       "drug", "compound"],
    "biologic": ["antibody", "mab", "monoclonal", "bispecific", "adc",
                 "antibody-drug conjugate", "protein", "enzyme replacement",
                 "peptide"],
    "gene_therapy": ["aav", "gene therapy", "gene editing", "crispr", "base editing",
                     "prime editing", "asos", "antisense oligonucleotide",
                     "sirna", "mrna therapy", "lnp"],
    "cell_therapy": ["car-t", "car t", "tcr-t", "tils", "stem cell",
                     "regenerative", "ipsc", "organoid"],
    "device": ["device", "stent", "pacemaker", "implant", "sensor", "wearable"],
    "lifestyle": ["diet", "exercise", "lifestyle", "behavioral", "sleep",
                  "microbiome diet"],
    "vaccine": ["vaccine", "immunization"],
    "radiation": ["radiation", "radiotherapy", "proton", "radionuclide"],
    "rna_therapy": ["mrna", "siRNA", "miRNA", "aso", "antisense"],
    "microbiome": ["microbiome", "fmt", "probiotic", "prebiotic"],
    "combination": ["combination", "synergistic", "cocktail"],
}

_MECHANISM_KEYWORDS = {
    "inhibition": ["inhibit", "block", "suppress", "antagonize", "downregulate"],
    "activation": ["activate", "agonize", "stimulate", "upregulate", "induce"],
    "degradation": ["protac", "degrader", "degradation", "ubiquitin",
                    "molecular glue"],
    "sequestration": ["sequester", "decoy", "trap"],
    "rerouting": ["reroute", "shunt", "bypass", "alternative pathway"],
    "replacement": ["replace", "restore", "supplement"],
    "epigenetic": ["methylation", "acetylation", "chromatin",
                   "histone modification", "epigenetic"],
    "immune_modulation": ["checkpoint", "immune response", "t-cell", "nk cell",
                          "cytokine"],
    "delivery": ["targeted delivery", "prodrug", "nanoparticle", "lipid nanoparticle"],
}

_ORGAN_KEYWORDS = {
    "brain": ["brain", "neuron", "glia", "cerebral", "cortical", "hippocamp",
              "cognitive", "blood-brain barrier"],
    "heart": ["cardiac", "heart", "myocardi", "cardiovascular", "coronary"],
    "liver": ["liver", "hepato", "hepatic"],
    "kidney": ["kidney", "renal", "glomerul"],
    "lung": ["lung", "pulmonary", "bronchi", "alveolar"],
    "gut": ["gut", "intestin", "colon", "microbiome", "gastro"],
    "skin": ["skin", "dermal", "epidermis"],
    "blood": ["hematopoietic", "blood", "platelet", "erythrocyte"],
    "pancreas": ["pancreas", "islet", "beta cell"],
    "muscle": ["muscle", "myocyte", "skeletal muscle"],
    "bone": ["bone", "osteo", "osteocyte"],
    "immune": ["lymph node", "thymus", "spleen", "immune system"],
    "reproductive": ["ovary", "uterus", "testis", "prostate", "reproductive"],
}

_PARADIGM_KEYWORDS = {
    "direct_target": ["direct inhibition", "target", "binding site"],
    "upstream": ["upstream regulator", "transcription factor", "master regulator"],
    "downstream": ["downstream effector", "pathway output"],
    "systemic": ["systemic", "whole-body", "multi-organ"],
    "metabolic": ["metabolic", "metabolism", "metabolite"],
    "microbiome": ["microbiome", "gut microbiota", "commensal"],
    "inflammation": ["inflammation", "inflammatory", "cytokine storm"],
    "senescence": ["senescence", "senolytic", "aging"],
    "circadian": ["circadian", "chronobiology"],
    "mechanical": ["mechanotransduction", "biomechanical", "stiffness"],
    "structural": ["protein structure", "allosteric", "conformational"],
}


def _extract_axis(text: str, vocab: dict[str, list[str]]) -> set[str]:
    text_lower = text.lower()
    axes = set()
    for axis, keywords in vocab.items():
        for kw in keywords:
            if kw in text_lower:
                axes.add(axis)
                break
    return axes


@dataclass
class MechanismFingerprint:
    """Structured axis-extraction from a hypothesis."""
    hypothesis_id: str
    modality: set[str] = field(default_factory=set)
    mechanism: set[str] = field(default_factory=set)
    organ: set[str] = field(default_factory=set)
    paradigm: set[str] = field(default_factory=set)
    pathways: set[str] = field(default_factory=set)
    entities: set[str] = field(default_factory=set)
    seed_embedding_large: list[float] = field(default_factory=list)
    seed_embedding_small: list[float] = field(default_factory=list)


@dataclass
class DiversityReport:
    candidate_hypothesis_id: str
    accepted: bool
    max_cosine_large: float = 0.0
    max_cosine_small: float = 0.0
    most_similar_to: str | None = None
    pathway_overlap: float = 0.0
    shared_axes_with_closest: list[str] = field(default_factory=list)
    rejection_reason: str | None = None
    overlap_matrix: dict[str, float] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "candidate_hypothesis_id": self.candidate_hypothesis_id,
            "accepted": self.accepted,
            "max_cosine_large": round(self.max_cosine_large, 4),
            "max_cosine_small": round(self.max_cosine_small, 4),
            "most_similar_to": self.most_similar_to,
            "pathway_overlap": round(self.pathway_overlap, 4),
            "shared_axes_with_closest": self.shared_axes_with_closest,
            "rejection_reason": self.rejection_reason,
            "overlap_matrix": {k: round(v, 4) for k, v in self.overlap_matrix.items()},
        }


# ---------------------------------------------------------------------------
# Diversity Enforcer
# ---------------------------------------------------------------------------


class DiversityEnforcer:
    """Per-discovery-run diversity tracker. One instance per run.

    Usage:
        enf = DiversityEnforcer(discovery_run_id=...)
        report = await enf.check_seed(
            hypothesis_id=hid, title=..., mechanism=..., pathways=[...],
            entities=[...], embedding_large=[...], embedding_small=[...],
        )
        if not report.accepted:
            # Regenerate seed with report.rejection_reason as anti-prompt
            ...
    """

    def __init__(
        self,
        discovery_run_id: str,
        similarity_threshold: float = SIMILARITY_THRESHOLD,
        pathway_overlap_max: float = PATHWAY_OVERLAP_MAX,
    ):
        self.discovery_run_id = discovery_run_id
        self._sim = similarity_threshold
        self._path_max = pathway_overlap_max
        self._accepted: list[MechanismFingerprint] = []

    # ------------------------------------------------------------------
    # Core check
    # ------------------------------------------------------------------

    def check_seed(
        self,
        *,
        hypothesis_id: str,
        title: str,
        description: str,
        mechanism: str,
        pathways: list[str] | None = None,
        entities: list[str] | None = None,
        embedding_large: list[float] | None = None,
        embedding_small: list[float] | None = None,
        discovery_type: str = "treatment",
    ) -> DiversityReport:
        """Check a candidate seed against all previously accepted seeds.

        Returns a DiversityReport. `accepted=True` means commit the seed;
        `accepted=False` means regenerate with the rejection_reason as
        explicit anti-prompt content.
        """
        fingerprint = self._fingerprint(
            hypothesis_id=hypothesis_id,
            title=title,
            description=description,
            mechanism=mechanism,
            pathways=pathways or [],
            entities=entities or [],
            embedding_large=embedding_large or [],
            embedding_small=embedding_small or [],
        )

        report = DiversityReport(candidate_hypothesis_id=hypothesis_id, accepted=True)

        if not self._accepted:
            # First hypothesis always accepted
            self._accepted.append(fingerprint)
            return report

        # Compare against all prior
        worst_cos_l = 0.0
        worst_cos_s = 0.0
        worst_path = 0.0
        worst_shared_axes: list[str] = []
        worst_match_id: str | None = None

        modality_usage = {m: 0 for m in set().union(*[f.modality for f in self._accepted])}
        for f in self._accepted:
            cos_l = _cosine(fingerprint.seed_embedding_large, f.seed_embedding_large)
            cos_s = _cosine(fingerprint.seed_embedding_small, f.seed_embedding_small)
            path = _jaccard(fingerprint.pathways, f.pathways)
            shared = self._shared_axes(fingerprint, f)
            report.overlap_matrix[f.hypothesis_id] = max(cos_l, cos_s)
            if max(cos_l, cos_s) > max(worst_cos_l, worst_cos_s) or worst_match_id is None:
                worst_cos_l = cos_l
                worst_cos_s = cos_s
                worst_path = path
                worst_shared_axes = shared
                worst_match_id = f.hypothesis_id
            for m in f.modality:
                modality_usage[m] = modality_usage.get(m, 0) + 1

        report.max_cosine_large = worst_cos_l
        report.max_cosine_small = worst_cos_s
        report.pathway_overlap = worst_path
        report.shared_axes_with_closest = worst_shared_axes
        report.most_similar_to = worst_match_id

        # Rejection rules
        if worst_cos_l >= self._sim or worst_cos_s >= self._sim:
            report.accepted = False
            report.rejection_reason = (
                f"Candidate too similar (cos_large={worst_cos_l:.2f}, "
                f"cos_small={worst_cos_s:.2f}) to hypothesis {worst_match_id}. "
                f"Each hypothesis must explore a DIFFERENT direction, approach, "
                f"or idea; sharing only common biomedical philosophy is allowed."
            )
            return report

        if worst_path >= self._path_max:
            report.accepted = False
            report.rejection_reason = (
                f"Candidate targets overlapping pathways "
                f"({worst_path:.0%} overlap) with hypothesis {worst_match_id}. "
                f"Choose a different pathway layer (upstream / downstream / "
                f"parallel) or a different paradigm (direct / systemic / "
                f"microbiome / metabolic / senescence)."
            )
            return report

        # Too many shared axes
        if 6 - len(worst_shared_axes) < MIN_AXIS_DIFFERENCES:
            report.accepted = False
            report.rejection_reason = (
                f"Candidate shares {len(worst_shared_axes)}/6 mechanism axes "
                f"({', '.join(worst_shared_axes)}) with hypothesis {worst_match_id}. "
                f"Vary at least {MIN_AXIS_DIFFERENCES} axis choices: "
                f"modality, mechanism, organ, paradigm, pathway class, or entity."
            )
            return report

        # Modality over-clustering: if >=3 prior share the same modality and
        # the candidate uses that modality too, reject (except combination_therapy
        # discovery type where clustering by design is permitted).
        if discovery_type != "combination_therapy":
            for m in fingerprint.modality:
                if modality_usage.get(m, 0) >= 3:
                    report.accepted = False
                    report.rejection_reason = (
                        f"Modality '{m}' already used by 3+ prior hypotheses. "
                        f"Try a different modality: biologic, gene therapy, "
                        f"cell therapy, lifestyle, microbiome, vaccine, or device."
                    )
                    return report

        self._accepted.append(fingerprint)
        return report

    # ------------------------------------------------------------------
    # Axis extraction helper
    # ------------------------------------------------------------------

    def _fingerprint(
        self,
        *,
        hypothesis_id: str,
        title: str,
        description: str,
        mechanism: str,
        pathways: list[str],
        entities: list[str],
        embedding_large: list[float],
        embedding_small: list[float],
    ) -> MechanismFingerprint:
        corpus = f"{title}\n{description}\n{mechanism}"
        return MechanismFingerprint(
            hypothesis_id=hypothesis_id,
            modality=_extract_axis(corpus, _MODALITY_KEYWORDS),
            mechanism=_extract_axis(corpus, _MECHANISM_KEYWORDS),
            organ=_extract_axis(corpus, _ORGAN_KEYWORDS),
            paradigm=_extract_axis(corpus, _PARADIGM_KEYWORDS),
            pathways={p.lower().strip() for p in pathways if p},
            entities={e.lower().strip() for e in entities if e},
            seed_embedding_large=embedding_large,
            seed_embedding_small=embedding_small,
        )

    @staticmethod
    def _shared_axes(a: MechanismFingerprint, b: MechanismFingerprint) -> list[str]:
        shared = []
        if a.modality & b.modality:
            shared.append(MechanismAxis.MODALITY.value)
        if a.mechanism & b.mechanism:
            shared.append(MechanismAxis.MECHANISM.value)
        if a.organ & b.organ:
            shared.append(MechanismAxis.ORGAN.value)
        if a.paradigm & b.paradigm:
            shared.append(MechanismAxis.PARADIGM.value)
        if a.pathways & b.pathways:
            shared.append(MechanismAxis.PATHWAY.value)
        if a.entities & b.entities:
            shared.append(MechanismAxis.ENTITY.value)
        return shared

    # ------------------------------------------------------------------
    # Public diversity scoring for final report
    # ------------------------------------------------------------------

    def final_diversity_score(self) -> dict[str, Any]:
        if len(self._accepted) < 2:
            return {"diversity_score": 1.0, "n_hypotheses": len(self._accepted)}
        pair_distances: list[float] = []
        axis_coverage = {ax.value: set() for ax in MechanismAxis}
        for i, a in enumerate(self._accepted):
            axis_coverage[MechanismAxis.MODALITY.value].update(a.modality)
            axis_coverage[MechanismAxis.MECHANISM.value].update(a.mechanism)
            axis_coverage[MechanismAxis.ORGAN.value].update(a.organ)
            axis_coverage[MechanismAxis.PARADIGM.value].update(a.paradigm)
            axis_coverage[MechanismAxis.PATHWAY.value].update(a.pathways)
            axis_coverage[MechanismAxis.ENTITY.value].update(a.entities)
            for j in range(i + 1, len(self._accepted)):
                b = self._accepted[j]
                cos = max(
                    _cosine(a.seed_embedding_large, b.seed_embedding_large),
                    _cosine(a.seed_embedding_small, b.seed_embedding_small),
                )
                pair_distances.append(1 - cos)
        avg_distance = sum(pair_distances) / max(1, len(pair_distances))
        return {
            "diversity_score": round(avg_distance, 4),
            "n_hypotheses": len(self._accepted),
            "unique_modalities": len(axis_coverage[MechanismAxis.MODALITY.value]),
            "unique_mechanisms": len(axis_coverage[MechanismAxis.MECHANISM.value]),
            "unique_organs": len(axis_coverage[MechanismAxis.ORGAN.value]),
            "unique_paradigms": len(axis_coverage[MechanismAxis.PARADIGM.value]),
            "unique_pathways": len(axis_coverage[MechanismAxis.PATHWAY.value]),
            "unique_entities": len(axis_coverage[MechanismAxis.ENTITY.value]),
        }


# ---------------------------------------------------------------------------
# Utilities
# ---------------------------------------------------------------------------


def _cosine(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = sum(x * x for x in a) ** 0.5
    nb = sum(y * y for y in b) ** 0.5
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


def _jaccard(a: set[str], b: set[str]) -> float:
    if not a and not b:
        return 0.0
    return len(a & b) / max(1, len(a | b))


# ---------------------------------------------------------------------------
# Per-run registry (so orchestrator can look up the enforcer by run id)
# ---------------------------------------------------------------------------

_registry: dict[str, DiversityEnforcer] = {}


def get_diversity_enforcer(discovery_run_id: str) -> DiversityEnforcer:
    if discovery_run_id not in _registry:
        _registry[discovery_run_id] = DiversityEnforcer(discovery_run_id=discovery_run_id)
    return _registry[discovery_run_id]


def reset_diversity_enforcer(discovery_run_id: str) -> None:
    _registry.pop(discovery_run_id, None)
