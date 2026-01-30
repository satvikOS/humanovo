"""
Entity Disambiguation System

Resolves ambiguous entity mentions using:
- Context-based disambiguation
- Type constraints
- Co-occurrence patterns
- Semantic similarity
- Knowledge graph evidence
"""

import logging
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Any, Tuple
from enum import Enum
import re

logger = logging.getLogger(__name__)


class DisambiguationMethod(str, Enum):
    """Methods used for disambiguation."""
    CONTEXT = "context"
    TYPE_CONSTRAINT = "type_constraint"
    COOCCURRENCE = "cooccurrence"
    SEMANTIC_SIMILARITY = "semantic_similarity"
    GRAPH_EVIDENCE = "graph_evidence"
    POPULARITY = "popularity"
    DOMAIN_SPECIFIC = "domain_specific"


@dataclass
class DisambiguationCandidate:
    """A candidate entity for disambiguation."""
    entity_id: str
    entity_name: str
    entity_type: str
    score: float = 0.0
    evidence: List[str] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "entity_id": self.entity_id,
            "entity_name": self.entity_name,
            "entity_type": self.entity_type,
            "score": self.score,
            "evidence": self.evidence,
            "metadata": self.metadata
        }


@dataclass
class DisambiguationResult:
    """Result of entity disambiguation."""
    mention: str
    candidates: List[DisambiguationCandidate] = field(default_factory=list)
    selected: Optional[DisambiguationCandidate] = None
    confidence: float = 0.0
    method_used: Optional[DisambiguationMethod] = None
    ambiguous: bool = True
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "mention": self.mention,
            "candidates": [c.to_dict() for c in self.candidates],
            "selected": self.selected.to_dict() if self.selected else None,
            "confidence": self.confidence,
            "method_used": self.method_used.value if self.method_used else None,
            "ambiguous": self.ambiguous,
            "metadata": self.metadata
        }


class Disambiguator:
    """
    Disambiguates ambiguous entity mentions.

    Uses multiple signals:
    - Local context (surrounding words)
    - Entity type constraints
    - Co-occurring entities
    - Semantic similarity
    - Knowledge graph relationships
    """

    # Known ambiguous terms with their possible meanings
    AMBIGUOUS_TERMS = {
        "her2": [
            DisambiguationCandidate(
                entity_id="HGNC:3430",
                entity_name="ERBB2",
                entity_type="gene",
                metadata={"description": "erb-b2 receptor tyrosine kinase 2"}
            ),
            DisambiguationCandidate(
                entity_id="MESH:D018931",
                entity_name="HER2 Receptor",
                entity_type="protein",
                metadata={"description": "HER2 protein receptor"}
            ),
            DisambiguationCandidate(
                entity_id="biomarker:HER2",
                entity_name="HER2 Status",
                entity_type="biomarker",
                metadata={"description": "HER2 expression status"}
            ),
        ],
        "egfr": [
            DisambiguationCandidate(
                entity_id="HGNC:3236",
                entity_name="EGFR",
                entity_type="gene",
                metadata={"description": "epidermal growth factor receptor gene"}
            ),
            DisambiguationCandidate(
                entity_id="UNIPROT:P00533",
                entity_name="EGFR Protein",
                entity_type="protein",
                metadata={"description": "EGFR protein"}
            ),
        ],
        "pd-1": [
            DisambiguationCandidate(
                entity_id="HGNC:8760",
                entity_name="PDCD1",
                entity_type="gene",
                metadata={"description": "programmed cell death 1 gene"}
            ),
            DisambiguationCandidate(
                entity_id="UNIPROT:Q15116",
                entity_name="PD-1 Protein",
                entity_type="protein",
                metadata={"description": "PD-1 immune checkpoint protein"}
            ),
        ],
        "pd-l1": [
            DisambiguationCandidate(
                entity_id="HGNC:17635",
                entity_name="CD274",
                entity_type="gene",
                metadata={"description": "CD274 gene encoding PD-L1"}
            ),
            DisambiguationCandidate(
                entity_id="biomarker:PDL1",
                entity_name="PD-L1 Expression",
                entity_type="biomarker",
                metadata={"description": "PD-L1 expression biomarker"}
            ),
        ],
        "brca": [
            DisambiguationCandidate(
                entity_id="HGNC:1100",
                entity_name="BRCA1",
                entity_type="gene",
                metadata={"description": "BRCA1 DNA repair associated"}
            ),
            DisambiguationCandidate(
                entity_id="HGNC:1101",
                entity_name="BRCA2",
                entity_type="gene",
                metadata={"description": "BRCA2 DNA repair associated"}
            ),
        ],
        "er": [
            DisambiguationCandidate(
                entity_id="HGNC:3467",
                entity_name="ESR1",
                entity_type="gene",
                metadata={"description": "estrogen receptor 1 gene"}
            ),
            DisambiguationCandidate(
                entity_id="biomarker:ER",
                entity_name="Estrogen Receptor Status",
                entity_type="biomarker",
                metadata={"description": "ER expression status"}
            ),
            DisambiguationCandidate(
                entity_id="GO:0005783",
                entity_name="Endoplasmic Reticulum",
                entity_type="cellular_component",
                metadata={"description": "endoplasmic reticulum organelle"}
            ),
        ],
        "pr": [
            DisambiguationCandidate(
                entity_id="HGNC:8910",
                entity_name="PGR",
                entity_type="gene",
                metadata={"description": "progesterone receptor gene"}
            ),
            DisambiguationCandidate(
                entity_id="biomarker:PR",
                entity_name="Progesterone Receptor Status",
                entity_type="biomarker",
                metadata={"description": "PR expression status"}
            ),
            DisambiguationCandidate(
                entity_id="clinical:PR",
                entity_name="Partial Response",
                entity_type="clinical_outcome",
                metadata={"description": "partial response to treatment"}
            ),
        ],
        "met": [
            DisambiguationCandidate(
                entity_id="HGNC:7029",
                entity_name="MET",
                entity_type="gene",
                metadata={"description": "MET proto-oncogene"}
            ),
            DisambiguationCandidate(
                entity_id="CHEBI:16044",
                entity_name="Methionine",
                entity_type="amino_acid",
                metadata={"description": "amino acid methionine (Met)"}
            ),
        ],
    }

    # Context keywords for disambiguation
    CONTEXT_KEYWORDS = {
        "gene": [
            "gene", "mutation", "expression", "amplification", "deletion",
            "variant", "polymorphism", "allele", "genotype", "sequencing",
            "transcript", "mRNA", "promoter", "exon", "intron"
        ],
        "protein": [
            "protein", "receptor", "kinase", "enzyme", "phosphorylation",
            "binding", "activation", "inhibition", "structure", "domain",
            "antibody", "immunoblot", "western blot"
        ],
        "drug": [
            "drug", "treatment", "therapy", "dose", "dosage", "mg",
            "administered", "efficacy", "response", "resistance",
            "approved", "clinical trial", "phase"
        ],
        "disease": [
            "disease", "cancer", "tumor", "carcinoma", "patient",
            "diagnosis", "prognosis", "survival", "metastatic",
            "stage", "grade"
        ],
        "biomarker": [
            "biomarker", "marker", "expression", "status", "positive",
            "negative", "level", "IHC", "FISH", "test", "assay",
            "predictive", "prognostic", "diagnostic"
        ],
        "pathway": [
            "pathway", "signaling", "cascade", "activation", "downstream",
            "upstream", "network", "regulation"
        ],
        "clinical_outcome": [
            "response", "outcome", "survival", "remission", "progression",
            "RECIST", "criteria"
        ],
    }

    # Domain-specific disambiguation rules
    DOMAIN_RULES = {
        # In oncology context, prefer gene/biomarker interpretations
        "oncology": {
            "prefer_types": ["gene", "biomarker", "drug"],
            "context_boost": 0.2
        },
        # In pharmacology context, prefer drug interpretations
        "pharmacology": {
            "prefer_types": ["drug", "protein"],
            "context_boost": 0.2
        },
        # In molecular biology, prefer gene/protein
        "molecular_biology": {
            "prefer_types": ["gene", "protein", "pathway"],
            "context_boost": 0.2
        },
    }

    def __init__(
        self,
        context_window: int = 100,
        confidence_threshold: float = 0.6,
        use_popularity: bool = True,
        domain: Optional[str] = None
    ):
        """
        Initialize the disambiguator.

        Args:
            context_window: Characters around mention to consider
            confidence_threshold: Minimum confidence for selection
            use_popularity: Use popularity-based ranking
            domain: Domain context for disambiguation
        """
        self.context_window = context_window
        self.confidence_threshold = confidence_threshold
        self.use_popularity = use_popularity
        self.domain = domain

        logger.info(f"Disambiguator initialized, domain: {domain}")

    def disambiguate(
        self,
        mention: str,
        context: str,
        candidates: Optional[List[DisambiguationCandidate]] = None,
        type_hint: Optional[str] = None
    ) -> DisambiguationResult:
        """
        Disambiguate an entity mention.

        Args:
            mention: The ambiguous mention
            context: Surrounding text context
            candidates: Optional list of candidates
            type_hint: Optional type constraint

        Returns:
            DisambiguationResult
        """
        result = DisambiguationResult(mention=mention)

        # Get candidates
        if candidates:
            result.candidates = candidates
        else:
            result.candidates = self._get_candidates(mention)

        if not result.candidates:
            result.ambiguous = False
            return result

        if len(result.candidates) == 1:
            result.selected = result.candidates[0]
            result.confidence = 0.9
            result.ambiguous = False
            result.method_used = DisambiguationMethod.TYPE_CONSTRAINT
            return result

        # Score candidates
        scored_candidates = self._score_candidates(
            result.candidates, context, type_hint
        )

        # Sort by score
        scored_candidates.sort(key=lambda x: x.score, reverse=True)
        result.candidates = scored_candidates

        # Select best if confident
        if scored_candidates and scored_candidates[0].score >= self.confidence_threshold:
            result.selected = scored_candidates[0]
            result.confidence = scored_candidates[0].score

            # Determine method used
            if type_hint and scored_candidates[0].entity_type == type_hint:
                result.method_used = DisambiguationMethod.TYPE_CONSTRAINT
            else:
                result.method_used = DisambiguationMethod.CONTEXT

            # Check if truly ambiguous
            if len(scored_candidates) > 1:
                score_gap = scored_candidates[0].score - scored_candidates[1].score
                result.ambiguous = score_gap < 0.2
            else:
                result.ambiguous = False

        return result

    def _get_candidates(self, mention: str) -> List[DisambiguationCandidate]:
        """Get candidates for a mention."""
        key = mention.lower().strip()

        # Check known ambiguous terms
        if key in self.AMBIGUOUS_TERMS:
            # Return copies to avoid mutation
            return [
                DisambiguationCandidate(
                    entity_id=c.entity_id,
                    entity_name=c.entity_name,
                    entity_type=c.entity_type,
                    score=c.score,
                    evidence=c.evidence.copy(),
                    metadata=c.metadata.copy()
                )
                for c in self.AMBIGUOUS_TERMS[key]
            ]

        # Check without hyphens
        key_no_hyphen = key.replace("-", "").replace(" ", "")
        if key_no_hyphen in self.AMBIGUOUS_TERMS:
            return [
                DisambiguationCandidate(
                    entity_id=c.entity_id,
                    entity_name=c.entity_name,
                    entity_type=c.entity_type,
                    score=c.score,
                    evidence=c.evidence.copy(),
                    metadata=c.metadata.copy()
                )
                for c in self.AMBIGUOUS_TERMS[key_no_hyphen]
            ]

        return []

    def _score_candidates(
        self,
        candidates: List[DisambiguationCandidate],
        context: str,
        type_hint: Optional[str]
    ) -> List[DisambiguationCandidate]:
        """Score candidates based on context and constraints."""
        context_lower = context.lower()

        for candidate in candidates:
            score = 0.0
            evidence = []

            # 1. Type constraint match
            if type_hint and candidate.entity_type == type_hint:
                score += 0.4
                evidence.append(f"Type matches hint: {type_hint}")

            # 2. Context keyword matching
            type_keywords = self.CONTEXT_KEYWORDS.get(candidate.entity_type, [])
            keyword_matches = sum(1 for kw in type_keywords if kw in context_lower)
            if keyword_matches > 0:
                context_score = min(0.3, keyword_matches * 0.05)
                score += context_score
                evidence.append(f"Context keywords: {keyword_matches} matches")

            # 3. Domain preference
            if self.domain and self.domain in self.DOMAIN_RULES:
                rules = self.DOMAIN_RULES[self.domain]
                if candidate.entity_type in rules["prefer_types"]:
                    score += rules["context_boost"]
                    evidence.append(f"Domain preference: {self.domain}")

            # 4. Popularity/common usage (simple heuristic)
            if self.use_popularity:
                # Prefer genes/proteins in scientific text
                if candidate.entity_type in ["gene", "protein", "biomarker"]:
                    score += 0.1
                    evidence.append("Common entity type boost")

            # 5. Name similarity
            if candidate.entity_name.lower() in context_lower:
                score += 0.15
                evidence.append("Entity name found in context")

            # Update candidate
            candidate.score = min(1.0, score)
            candidate.evidence = evidence

        return candidates

    def batch_disambiguate(
        self,
        mentions: List[Tuple[str, str]],
        type_hints: Optional[List[str]] = None
    ) -> List[DisambiguationResult]:
        """
        Disambiguate multiple mentions.

        Args:
            mentions: List of (mention, context) tuples
            type_hints: Optional list of type hints

        Returns:
            List of DisambiguationResults
        """
        type_hints = type_hints or [None] * len(mentions)

        results = []
        for (mention, context), type_hint in zip(mentions, type_hints):
            result = self.disambiguate(mention, context, type_hint=type_hint)
            results.append(result)

        return results

    def add_ambiguous_term(
        self,
        term: str,
        candidates: List[DisambiguationCandidate]
    ):
        """
        Add an ambiguous term with its candidates.

        Args:
            term: The ambiguous term
            candidates: List of candidate interpretations
        """
        key = term.lower().strip()
        self.AMBIGUOUS_TERMS[key] = candidates

    def get_ambiguity_info(self, mention: str) -> Dict[str, Any]:
        """
        Get information about ambiguity for a mention.

        Args:
            mention: The mention to check

        Returns:
            Dictionary with ambiguity information
        """
        key = mention.lower().strip()
        candidates = self._get_candidates(mention)

        return {
            "mention": mention,
            "is_ambiguous": len(candidates) > 1,
            "candidate_count": len(candidates),
            "candidate_types": list(set(c.entity_type for c in candidates)),
            "candidates": [c.to_dict() for c in candidates]
        }

    def get_statistics(self) -> Dict[str, Any]:
        """Get disambiguator statistics."""
        all_types = set()
        for candidates in self.AMBIGUOUS_TERMS.values():
            for c in candidates:
                all_types.add(c.entity_type)

        return {
            "known_ambiguous_terms": len(self.AMBIGUOUS_TERMS),
            "entity_types_covered": list(all_types),
            "context_keyword_types": list(self.CONTEXT_KEYWORDS.keys()),
            "domain": self.domain,
            "confidence_threshold": self.confidence_threshold
        }


# Convenience functions
def disambiguate(mention: str, context: str, type_hint: Optional[str] = None) -> DisambiguationResult:
    """Quick disambiguation using default disambiguator."""
    disambiguator = Disambiguator()
    return disambiguator.disambiguate(mention, context, type_hint=type_hint)


def is_ambiguous(mention: str) -> bool:
    """Check if a mention is ambiguous."""
    disambiguator = Disambiguator()
    info = disambiguator.get_ambiguity_info(mention)
    return info["is_ambiguous"]
