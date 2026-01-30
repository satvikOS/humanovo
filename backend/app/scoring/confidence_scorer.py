"""
Unified Edge-Level Confidence Scoring

Combines all scoring components for comprehensive edge confidence:
- Source quality scoring
- Citation analysis
- Claim type classification
- Co-occurrence patterns
- Model certainty
- Full evidence provenance
"""

import logging
from dataclasses import dataclass, field
from datetime import datetime
from typing import Dict, List, Optional, Any, Tuple

from .source_quality import SourceQualityAnalyzer, SourceQuality, EvidenceLevel
from .citation_analyzer import CitationAnalyzer, CitationMetrics
from .claim_classifier import ClaimClassifier, ClaimClassification, ClaimStrength
from .provenance_tracker import ProvenanceTracker, ProvenanceRecord, ProvenanceEventType

logger = logging.getLogger(__name__)


@dataclass
class SourceQualityScore:
    """Source quality component of confidence."""
    source_id: str
    quality: SourceQuality
    weight: float
    contribution: float

    def to_dict(self) -> Dict[str, Any]:
        return {
            "source_id": self.source_id,
            "quality": self.quality.to_dict(),
            "weight": self.weight,
            "contribution": self.contribution
        }


@dataclass
class CitationScore:
    """Citation component of confidence."""
    metrics: CitationMetrics
    weight: float
    contribution: float

    def to_dict(self) -> Dict[str, Any]:
        return {
            "metrics": self.metrics.to_dict(),
            "weight": self.weight,
            "contribution": self.contribution
        }


@dataclass
class EvidenceProvenance:
    """Provenance component of confidence."""
    record: ProvenanceRecord
    source_count: int
    validation_status: bool
    contribution: float

    def to_dict(self) -> Dict[str, Any]:
        return {
            "record": self.record.to_dict(),
            "source_count": self.source_count,
            "validation_status": self.validation_status,
            "contribution": self.contribution
        }


@dataclass
class EdgeScore:
    """Complete confidence score for a knowledge graph edge."""
    edge_id: str
    source_entity: str
    target_entity: str
    relation_type: str
    final_score: float
    source_quality_scores: List[SourceQualityScore] = field(default_factory=list)
    citation_score: Optional[CitationScore] = None
    claim_classification: Optional[ClaimClassification] = None
    co_occurrence_score: float = 0.0
    model_certainty: float = 0.0
    provenance: Optional[EvidenceProvenance] = None
    component_weights: Dict[str, float] = field(default_factory=dict)
    component_contributions: Dict[str, float] = field(default_factory=dict)
    confidence_level: str = "moderate"  # low, moderate, high, very_high
    evidence_count: int = 0
    metadata: Dict[str, Any] = field(default_factory=dict)
    timestamp: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return {
            "edge_id": self.edge_id,
            "source_entity": self.source_entity,
            "target_entity": self.target_entity,
            "relation_type": self.relation_type,
            "final_score": self.final_score,
            "source_quality_scores": [s.to_dict() for s in self.source_quality_scores],
            "citation_score": self.citation_score.to_dict() if self.citation_score else None,
            "claim_classification": self.claim_classification.to_dict() if self.claim_classification else None,
            "co_occurrence_score": self.co_occurrence_score,
            "model_certainty": self.model_certainty,
            "provenance": self.provenance.to_dict() if self.provenance else None,
            "component_weights": self.component_weights,
            "component_contributions": self.component_contributions,
            "confidence_level": self.confidence_level,
            "evidence_count": self.evidence_count,
            "metadata": self.metadata,
            "timestamp": self.timestamp
        }

    def get_explanation(self) -> str:
        """Generate human-readable explanation of score."""
        parts = [f"Edge confidence: {self.final_score:.2f} ({self.confidence_level})"]

        if self.component_contributions:
            parts.append("\nScore breakdown:")
            for component, contribution in sorted(
                self.component_contributions.items(),
                key=lambda x: x[1],
                reverse=True
            ):
                parts.append(f"  - {component}: {contribution:.2f}")

        if self.evidence_count:
            parts.append(f"\nBased on {self.evidence_count} evidence source(s)")

        if self.claim_classification:
            parts.append(f"\nClaim type: {self.claim_classification.claim_type.value}")
            parts.append(f"Claim strength: {self.claim_classification.strength.value}")

        return "\n".join(parts)


class ConfidenceScorer:
    """
    Comprehensive confidence scoring for knowledge graph edges.

    Combines:
    - Source quality analysis
    - Citation metrics
    - Claim classification
    - Co-occurrence patterns
    - Model certainty
    - Evidence provenance
    """

    # Default component weights
    DEFAULT_WEIGHTS = {
        "source_quality": 0.30,
        "citation": 0.15,
        "claim_type": 0.20,
        "co_occurrence": 0.10,
        "model_certainty": 0.15,
        "provenance": 0.10
    }

    # Confidence level thresholds
    CONFIDENCE_LEVELS = {
        0.8: "very_high",
        0.6: "high",
        0.4: "moderate",
        0.2: "low",
        0.0: "very_low"
    }

    def __init__(
        self,
        weights: Optional[Dict[str, float]] = None,
        source_quality_analyzer: Optional[SourceQualityAnalyzer] = None,
        citation_analyzer: Optional[CitationAnalyzer] = None,
        claim_classifier: Optional[ClaimClassifier] = None,
        provenance_tracker: Optional[ProvenanceTracker] = None
    ):
        """
        Initialize the confidence scorer.

        Args:
            weights: Custom component weights
            source_quality_analyzer: Source quality analyzer
            citation_analyzer: Citation analyzer
            claim_classifier: Claim classifier
            provenance_tracker: Provenance tracker
        """
        self.weights = weights or self.DEFAULT_WEIGHTS.copy()

        # Normalize weights
        total_weight = sum(self.weights.values())
        self.weights = {k: v / total_weight for k, v in self.weights.items()}

        # Initialize components
        self.source_quality_analyzer = source_quality_analyzer or SourceQualityAnalyzer()
        self.citation_analyzer = citation_analyzer or CitationAnalyzer()
        self.claim_classifier = claim_classifier or ClaimClassifier()
        self.provenance_tracker = provenance_tracker or ProvenanceTracker()

        logger.info(f"ConfidenceScorer initialized with weights: {self.weights}")

    def score_edge(
        self,
        edge_id: str,
        source_entity: str,
        target_entity: str,
        relation_type: str,
        evidence_sources: List[Dict[str, Any]],
        evidence_text: Optional[str] = None,
        model_confidence: float = 0.5,
        co_occurrence_count: int = 1
    ) -> EdgeScore:
        """
        Calculate comprehensive confidence score for an edge.

        Args:
            edge_id: Unique edge identifier
            source_entity: Source entity
            target_entity: Target entity
            relation_type: Type of relation
            evidence_sources: List of evidence source info
            evidence_text: Combined evidence text
            model_confidence: Model's extraction confidence
            co_occurrence_count: Number of co-occurrences

        Returns:
            Complete EdgeScore
        """
        contributions = {}
        component_scores = {}

        # 1. Source Quality Scoring
        source_quality_scores = []
        if evidence_sources:
            for source in evidence_sources:
                quality = self.source_quality_analyzer.analyze(
                    source_id=source.get("id", ""),
                    title=source.get("title"),
                    abstract=source.get("abstract"),
                    journal=source.get("journal"),
                    publication_year=source.get("year"),
                    citation_count=source.get("citations")
                )
                weight = 1.0 / len(evidence_sources)
                contribution = quality.quality_score * weight
                source_quality_scores.append(SourceQualityScore(
                    source_id=source.get("id", ""),
                    quality=quality,
                    weight=weight,
                    contribution=contribution
                ))

            avg_source_quality = sum(s.contribution for s in source_quality_scores)
            component_scores["source_quality"] = avg_source_quality
            contributions["source_quality"] = avg_source_quality * self.weights["source_quality"]

        # 2. Citation Scoring
        citation_score = None
        if evidence_sources:
            total_citations = sum(s.get("citations", 0) for s in evidence_sources)
            avg_year = sum(s.get("year", 2020) for s in evidence_sources) // len(evidence_sources)

            metrics = self.citation_analyzer.analyze(
                source_id=edge_id,
                total_citations=total_citations,
                publication_year=avg_year
            )
            cite_contribution = metrics.get_citation_score()
            citation_score = CitationScore(
                metrics=metrics,
                weight=self.weights["citation"],
                contribution=cite_contribution
            )
            component_scores["citation"] = cite_contribution
            contributions["citation"] = cite_contribution * self.weights["citation"]

        # 3. Claim Classification
        claim_classification = None
        if evidence_text:
            claim_classification = self.claim_classifier.classify(evidence_text)
            claim_score = claim_classification.get_claim_score()
            component_scores["claim_type"] = claim_score
            contributions["claim_type"] = claim_score * self.weights["claim_type"]

        # 4. Co-occurrence Scoring
        co_occurrence_score = self._calculate_co_occurrence_score(co_occurrence_count)
        component_scores["co_occurrence"] = co_occurrence_score
        contributions["co_occurrence"] = co_occurrence_score * self.weights["co_occurrence"]

        # 5. Model Certainty
        component_scores["model_certainty"] = model_confidence
        contributions["model_certainty"] = model_confidence * self.weights["model_certainty"]

        # 6. Provenance
        provenance = None
        provenance_record = self.provenance_tracker.get_record(edge_id)
        if not provenance_record:
            # Create new record
            provenance_record = self.provenance_tracker.create_record(
                entity_id=edge_id,
                initial_confidence=0.5
            )

            # Record extraction event
            self.provenance_tracker.add_event(
                entity_id=edge_id,
                event_type=ProvenanceEventType.RELATION_EXTRACTION,
                action=f"Extracted relation: {source_entity} -> {relation_type} -> {target_entity}",
                confidence_delta=model_confidence - 0.5
            )

        # Add contributing sources
        for source in evidence_sources:
            source_id = source.get("id")
            if source_id:
                self.provenance_tracker.add_contributing_source(edge_id, source_id)

        provenance_score = self._calculate_provenance_score(provenance_record, len(evidence_sources))
        provenance = EvidenceProvenance(
            record=provenance_record,
            source_count=len(evidence_sources),
            validation_status=provenance_record.is_validated,
            contribution=provenance_score
        )
        component_scores["provenance"] = provenance_score
        contributions["provenance"] = provenance_score * self.weights["provenance"]

        # Calculate final score
        final_score = sum(contributions.values())
        final_score = max(0.0, min(1.0, final_score))

        # Determine confidence level
        confidence_level = self._get_confidence_level(final_score)

        return EdgeScore(
            edge_id=edge_id,
            source_entity=source_entity,
            target_entity=target_entity,
            relation_type=relation_type,
            final_score=final_score,
            source_quality_scores=source_quality_scores,
            citation_score=citation_score,
            claim_classification=claim_classification,
            co_occurrence_score=co_occurrence_score,
            model_certainty=model_confidence,
            provenance=provenance,
            component_weights=self.weights,
            component_contributions=contributions,
            confidence_level=confidence_level,
            evidence_count=len(evidence_sources),
            timestamp=datetime.utcnow().isoformat()
        )

    def _calculate_co_occurrence_score(self, count: int) -> float:
        """Calculate co-occurrence score."""
        if count <= 0:
            return 0.0
        # Logarithmic scale: 1->0.3, 5->0.6, 10->0.75, 50->0.9, 100->1.0
        import math
        return min(1.0, 0.3 + 0.3 * math.log10(count + 1))

    def _calculate_provenance_score(
        self,
        record: ProvenanceRecord,
        source_count: int
    ) -> float:
        """Calculate provenance score."""
        score = 0.5  # Base

        # Validation boost
        if record.is_validated:
            score += 0.3

        # Multiple sources boost
        if source_count > 1:
            score += min(0.1, source_count * 0.02)

        # Multiple validators boost
        if len(record.validators) > 1:
            score += 0.1

        return min(1.0, score)

    def _get_confidence_level(self, score: float) -> str:
        """Get confidence level from score."""
        for threshold, level in sorted(
            self.CONFIDENCE_LEVELS.items(),
            reverse=True
        ):
            if score >= threshold:
                return level
        return "very_low"

    def batch_score(
        self,
        edges: List[Dict[str, Any]]
    ) -> List[EdgeScore]:
        """
        Score multiple edges.

        Args:
            edges: List of edge dictionaries

        Returns:
            List of EdgeScores
        """
        results = []
        for edge in edges:
            score = self.score_edge(
                edge_id=edge.get("id", ""),
                source_entity=edge.get("source", ""),
                target_entity=edge.get("target", ""),
                relation_type=edge.get("relation", ""),
                evidence_sources=edge.get("sources", []),
                evidence_text=edge.get("evidence_text"),
                model_confidence=edge.get("model_confidence", 0.5),
                co_occurrence_count=edge.get("co_occurrence", 1)
            )
            results.append(score)
        return results

    def recalculate_with_validation(
        self,
        edge_score: EdgeScore,
        validator: str,
        is_valid: bool,
        comments: Optional[str] = None
    ) -> EdgeScore:
        """
        Recalculate score after validation.

        Args:
            edge_score: Original edge score
            validator: Validator identifier
            is_valid: Validation result
            comments: Optional comments

        Returns:
            Updated EdgeScore
        """
        # Record validation
        self.provenance_tracker.record_validation(
            entity_id=edge_score.edge_id,
            validator=validator,
            is_valid=is_valid,
            comments=comments
        )

        # Adjust score
        if is_valid:
            adjustment = 0.1
        else:
            adjustment = -0.2

        new_score = max(0.0, min(1.0, edge_score.final_score + adjustment))

        # Update edge score
        edge_score.final_score = new_score
        edge_score.confidence_level = self._get_confidence_level(new_score)

        if edge_score.provenance:
            edge_score.provenance.validation_status = is_valid

        edge_score.metadata["last_validation"] = {
            "validator": validator,
            "is_valid": is_valid,
            "comments": comments,
            "timestamp": datetime.utcnow().isoformat()
        }

        return edge_score

    def get_score_summary(
        self,
        scores: List[EdgeScore]
    ) -> Dict[str, Any]:
        """
        Get summary statistics for a set of scores.

        Args:
            scores: List of EdgeScores

        Returns:
            Summary statistics
        """
        if not scores:
            return {"error": "No scores to summarize"}

        final_scores = [s.final_score for s in scores]
        confidence_levels = [s.confidence_level for s in scores]

        # Component averages
        component_avgs = {}
        for component in self.weights.keys():
            values = [
                s.component_contributions.get(component, 0)
                for s in scores
            ]
            component_avgs[component] = sum(values) / len(values)

        return {
            "total_edges": len(scores),
            "average_confidence": sum(final_scores) / len(final_scores),
            "min_confidence": min(final_scores),
            "max_confidence": max(final_scores),
            "confidence_level_distribution": {
                level: confidence_levels.count(level)
                for level in set(confidence_levels)
            },
            "component_averages": component_avgs,
            "validated_count": sum(
                1 for s in scores
                if s.provenance and s.provenance.validation_status
            ),
            "high_confidence_count": sum(
                1 for s in scores
                if s.final_score >= 0.7
            )
        }

    def export_scores(
        self,
        scores: List[EdgeScore],
        format: str = "dict"
    ) -> Any:
        """
        Export scores in various formats.

        Args:
            scores: List of EdgeScores
            format: Output format (dict, csv, json)

        Returns:
            Exported data
        """
        if format == "dict":
            return [s.to_dict() for s in scores]

        elif format == "csv":
            import csv
            import io
            output = io.StringIO()
            writer = csv.writer(output)

            # Header
            writer.writerow([
                "edge_id", "source", "target", "relation",
                "final_score", "confidence_level", "evidence_count"
            ])

            # Data
            for s in scores:
                writer.writerow([
                    s.edge_id, s.source_entity, s.target_entity,
                    s.relation_type, s.final_score, s.confidence_level,
                    s.evidence_count
                ])

            return output.getvalue()

        elif format == "json":
            import json
            return json.dumps([s.to_dict() for s in scores], indent=2)

        return [s.to_dict() for s in scores]


# Factory function
def create_scorer(
    preset: str = "default"
) -> ConfidenceScorer:
    """
    Create a confidence scorer with preset configuration.

    Args:
        preset: Configuration preset

    Returns:
        Configured ConfidenceScorer
    """
    presets = {
        "default": ConfidenceScorer.DEFAULT_WEIGHTS,
        "source_focused": {
            "source_quality": 0.40,
            "citation": 0.20,
            "claim_type": 0.15,
            "co_occurrence": 0.05,
            "model_certainty": 0.10,
            "provenance": 0.10
        },
        "model_focused": {
            "source_quality": 0.20,
            "citation": 0.10,
            "claim_type": 0.15,
            "co_occurrence": 0.10,
            "model_certainty": 0.35,
            "provenance": 0.10
        },
        "balanced": {
            "source_quality": 0.20,
            "citation": 0.20,
            "claim_type": 0.20,
            "co_occurrence": 0.10,
            "model_certainty": 0.20,
            "provenance": 0.10
        }
    }

    weights = presets.get(preset, presets["default"])
    return ConfidenceScorer(weights=weights)


# Convenience function
def score_edge(
    source: str,
    target: str,
    relation: str,
    evidence_sources: List[Dict[str, Any]]
) -> EdgeScore:
    """Quick edge scoring using default scorer."""
    import hashlib
    edge_id = hashlib.md5(f"{source}_{relation}_{target}".encode()).hexdigest()[:12]
    scorer = create_scorer()
    return scorer.score_edge(
        edge_id=edge_id,
        source_entity=source,
        target_entity=target,
        relation_type=relation,
        evidence_sources=evidence_sources
    )
