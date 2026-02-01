"""
Edge-Level Confidence Scoring System

Provides comprehensive scoring for knowledge graph edges:
- Source quality scoring
- Citation analysis
- Claim type classification
- Co-occurrence analysis
- Model certainty estimation
- Full evidence provenance tracking
"""

from .citation_analyzer import CitationAnalyzer, CitationMetrics
from .claim_classifier import ClaimClassification, ClaimClassifier, ClaimType
from .confidence_scorer import (
    CitationScore,
    ConfidenceScorer,
    EdgeScore,
    EvidenceProvenance,
    SourceQualityScore,
)
from .provenance_tracker import ProvenanceRecord, ProvenanceTracker
from .source_quality import SourceQuality, SourceQualityAnalyzer

__all__ = [
    "ConfidenceScorer",
    "EdgeScore",
    "SourceQualityScore",
    "CitationScore",
    "EvidenceProvenance",
    "SourceQualityAnalyzer",
    "SourceQuality",
    "CitationAnalyzer",
    "CitationMetrics",
    "ClaimClassifier",
    "ClaimType",
    "ClaimClassification",
    "ProvenanceTracker",
    "ProvenanceRecord",
]
