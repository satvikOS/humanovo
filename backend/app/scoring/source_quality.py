"""
Source Quality Analysis

Evaluates the quality and reliability of evidence sources:
- Publication venue quality (impact factor, tier)
- Evidence level (clinical trial, cohort, case report)
- Study design quality
- Peer review status
- Replication status
- Source authority
"""

import logging
import re
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any

logger = logging.getLogger(__name__)


class EvidenceLevel(str, Enum):
    """Evidence hierarchy levels."""

    SYSTEMATIC_REVIEW = "systematic_review"  # Level 1a
    RCT = "rct"  # Level 1b - Randomized Controlled Trial
    COHORT_PROSPECTIVE = "cohort_prospective"  # Level 2a
    COHORT_RETROSPECTIVE = "cohort_retrospective"  # Level 2b
    CASE_CONTROL = "case_control"  # Level 3
    CASE_SERIES = "case_series"  # Level 4a
    CASE_REPORT = "case_report"  # Level 4b
    EXPERT_OPINION = "expert_opinion"  # Level 5
    IN_VITRO = "in_vitro"  # Preclinical
    IN_SILICO = "in_silico"  # Computational
    UNKNOWN = "unknown"


class JournalTier(str, Enum):
    """Journal quality tiers."""

    TOP_TIER = "top_tier"  # Nature, Science, Cell, NEJM, Lancet, JAMA
    HIGH_IMPACT = "high_impact"  # IF > 10
    MEDIUM_IMPACT = "medium_impact"  # IF 5-10
    LOW_IMPACT = "low_impact"  # IF < 5
    PREPRINT = "preprint"  # bioRxiv, medRxiv
    UNKNOWN = "unknown"


class SourceType(str, Enum):
    """Types of evidence sources."""

    JOURNAL_ARTICLE = "journal_article"
    REVIEW_ARTICLE = "review_article"
    CLINICAL_TRIAL = "clinical_trial"
    PREPRINT = "preprint"
    CONFERENCE_ABSTRACT = "conference_abstract"
    BOOK_CHAPTER = "book_chapter"
    PATENT = "patent"
    DATABASE = "database"
    GUIDELINE = "guideline"
    FDA_LABEL = "fda_label"
    EMA_REPORT = "ema_report"
    THESIS = "thesis"
    UNKNOWN = "unknown"


@dataclass
class SourceQuality:
    """Represents source quality assessment."""

    source_id: str
    source_type: SourceType
    evidence_level: EvidenceLevel
    journal_tier: JournalTier
    quality_score: float  # 0-1
    impact_factor: float | None = None
    citation_count: int | None = None
    publication_year: int | None = None
    peer_reviewed: bool = True
    retracted: bool = False
    has_corrections: bool = False
    sample_size: int | None = None
    study_quality_score: float | None = None
    replication_status: str = "unknown"  # replicated, not_replicated, partial, unknown
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "source_id": self.source_id,
            "source_type": self.source_type.value,
            "evidence_level": self.evidence_level.value,
            "journal_tier": self.journal_tier.value,
            "quality_score": self.quality_score,
            "impact_factor": self.impact_factor,
            "citation_count": self.citation_count,
            "publication_year": self.publication_year,
            "peer_reviewed": self.peer_reviewed,
            "retracted": self.retracted,
            "has_corrections": self.has_corrections,
            "sample_size": self.sample_size,
            "study_quality_score": self.study_quality_score,
            "replication_status": self.replication_status,
            "metadata": self.metadata,
        }


class SourceQualityAnalyzer:
    """
    Analyzes and scores source quality.

    Evaluates:
    - Publication venue (journal tier, impact factor)
    - Evidence level (study design)
    - Study quality
    - Currency (publication age)
    - Replication status
    """

    # Top-tier journals with impact factors (approximate)
    TOP_JOURNALS = {
        # Medical
        "new england journal of medicine": {"tier": JournalTier.TOP_TIER, "if": 91.0},
        "nejm": {"tier": JournalTier.TOP_TIER, "if": 91.0},
        "lancet": {"tier": JournalTier.TOP_TIER, "if": 79.0},
        "jama": {"tier": JournalTier.TOP_TIER, "if": 56.0},
        "bmj": {"tier": JournalTier.HIGH_IMPACT, "if": 39.0},
        "annals of internal medicine": {"tier": JournalTier.HIGH_IMPACT, "if": 39.0},
        # Oncology
        "journal of clinical oncology": {"tier": JournalTier.TOP_TIER, "if": 45.0},
        "jco": {"tier": JournalTier.TOP_TIER, "if": 45.0},
        "lancet oncology": {"tier": JournalTier.TOP_TIER, "if": 41.0},
        "nature medicine": {"tier": JournalTier.TOP_TIER, "if": 58.0},
        "cancer discovery": {"tier": JournalTier.TOP_TIER, "if": 38.0},
        "cancer cell": {"tier": JournalTier.TOP_TIER, "if": 38.0},
        "clinical cancer research": {"tier": JournalTier.HIGH_IMPACT, "if": 13.0},
        # Basic Science
        "nature": {"tier": JournalTier.TOP_TIER, "if": 64.0},
        "science": {"tier": JournalTier.TOP_TIER, "if": 56.0},
        "cell": {"tier": JournalTier.TOP_TIER, "if": 64.0},
        "nature genetics": {"tier": JournalTier.TOP_TIER, "if": 41.0},
        "nature biotechnology": {"tier": JournalTier.TOP_TIER, "if": 46.0},
        "nature communications": {"tier": JournalTier.HIGH_IMPACT, "if": 16.0},
        "pnas": {"tier": JournalTier.HIGH_IMPACT, "if": 12.0},
        # Drug/Pharmacology
        "nature reviews drug discovery": {"tier": JournalTier.TOP_TIER, "if": 84.0},
        "clinical pharmacology and therapeutics": {"tier": JournalTier.HIGH_IMPACT, "if": 7.0},
        # Preprints
        "biorxiv": {"tier": JournalTier.PREPRINT, "if": 0.0},
        "medrxiv": {"tier": JournalTier.PREPRINT, "if": 0.0},
        "arxiv": {"tier": JournalTier.PREPRINT, "if": 0.0},
    }

    # Evidence level weights
    EVIDENCE_WEIGHTS = {
        EvidenceLevel.SYSTEMATIC_REVIEW: 1.0,
        EvidenceLevel.RCT: 0.95,
        EvidenceLevel.COHORT_PROSPECTIVE: 0.8,
        EvidenceLevel.COHORT_RETROSPECTIVE: 0.7,
        EvidenceLevel.CASE_CONTROL: 0.6,
        EvidenceLevel.CASE_SERIES: 0.45,
        EvidenceLevel.CASE_REPORT: 0.35,
        EvidenceLevel.EXPERT_OPINION: 0.25,
        EvidenceLevel.IN_VITRO: 0.3,
        EvidenceLevel.IN_SILICO: 0.2,
        EvidenceLevel.UNKNOWN: 0.5,
    }

    # Journal tier weights
    TIER_WEIGHTS = {
        JournalTier.TOP_TIER: 1.0,
        JournalTier.HIGH_IMPACT: 0.8,
        JournalTier.MEDIUM_IMPACT: 0.6,
        JournalTier.LOW_IMPACT: 0.4,
        JournalTier.PREPRINT: 0.3,
        JournalTier.UNKNOWN: 0.5,
    }

    # Study design keywords
    STUDY_TYPE_PATTERNS = {
        EvidenceLevel.SYSTEMATIC_REVIEW: [r"systematic\s+review", r"meta-?analysis", r"cochrane"],
        EvidenceLevel.RCT: [
            r"randomized\s+controlled",
            r"randomised\s+controlled",
            r"\brct\b",
            r"double-?blind",
            r"placebo-?controlled",
        ],
        EvidenceLevel.COHORT_PROSPECTIVE: [
            r"prospective\s+cohort",
            r"prospective\s+study",
            r"longitudinal\s+study",
        ],
        EvidenceLevel.COHORT_RETROSPECTIVE: [
            r"retrospective\s+cohort",
            r"retrospective\s+study",
            r"retrospective\s+analysis",
        ],
        EvidenceLevel.CASE_CONTROL: [r"case-?control", r"matched\s+cohort"],
        EvidenceLevel.CASE_SERIES: [r"case\s+series", r"case\s+studies"],
        EvidenceLevel.CASE_REPORT: [r"case\s+report", r"single\s+patient"],
        EvidenceLevel.IN_VITRO: [r"in\s+vitro", r"cell\s+line", r"cell\s+culture"],
        EvidenceLevel.IN_SILICO: [r"in\s+silico", r"computational", r"bioinformatic"],
    }

    def __init__(
        self,
        recency_weight: float = 0.1,
        citation_weight: float = 0.1,
        evidence_weight: float = 0.4,
        venue_weight: float = 0.3,
        replication_weight: float = 0.1,
    ):
        """
        Initialize the source quality analyzer.

        Args:
            recency_weight: Weight for publication recency
            citation_weight: Weight for citation count
            evidence_weight: Weight for evidence level
            venue_weight: Weight for publication venue
            replication_weight: Weight for replication status
        """
        self.recency_weight = recency_weight
        self.citation_weight = citation_weight
        self.evidence_weight = evidence_weight
        self.venue_weight = venue_weight
        self.replication_weight = replication_weight

        # Compile patterns
        self._study_patterns = {}
        for level, patterns in self.STUDY_TYPE_PATTERNS.items():
            self._study_patterns[level] = [re.compile(p, re.IGNORECASE) for p in patterns]

        logger.info("SourceQualityAnalyzer initialized")

    def analyze(
        self,
        source_id: str,
        title: str | None = None,
        abstract: str | None = None,
        journal: str | None = None,
        publication_year: int | None = None,
        citation_count: int | None = None,
        source_type: SourceType | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> SourceQuality:
        """
        Analyze source quality.

        Args:
            source_id: Unique source identifier
            title: Publication title
            abstract: Abstract text
            journal: Journal name
            publication_year: Year of publication
            citation_count: Number of citations
            source_type: Type of source
            metadata: Additional metadata

        Returns:
            SourceQuality assessment
        """
        # Detect evidence level
        text = f"{title or ''} {abstract or ''}".lower()
        evidence_level = self._detect_evidence_level(text)

        # Detect journal tier
        journal_tier, impact_factor = self._get_journal_info(journal)

        # Detect source type if not provided
        if source_type is None:
            source_type = self._detect_source_type(journal, text)

        # Calculate quality score
        quality_score = self._calculate_quality_score(
            evidence_level=evidence_level,
            journal_tier=journal_tier,
            publication_year=publication_year,
            citation_count=citation_count,
            source_type=source_type,
        )

        # Check for red flags
        retracted = self._check_retracted(text, metadata)
        has_corrections = self._check_corrections(metadata)

        return SourceQuality(
            source_id=source_id,
            source_type=source_type,
            evidence_level=evidence_level,
            journal_tier=journal_tier,
            quality_score=quality_score,
            impact_factor=impact_factor,
            citation_count=citation_count,
            publication_year=publication_year,
            peer_reviewed=journal_tier != JournalTier.PREPRINT,
            retracted=retracted,
            has_corrections=has_corrections,
            metadata=metadata or {},
        )

    def _detect_evidence_level(self, text: str) -> EvidenceLevel:
        """Detect evidence level from text."""
        for level in [
            EvidenceLevel.SYSTEMATIC_REVIEW,
            EvidenceLevel.RCT,
            EvidenceLevel.COHORT_PROSPECTIVE,
            EvidenceLevel.COHORT_RETROSPECTIVE,
            EvidenceLevel.CASE_CONTROL,
            EvidenceLevel.CASE_SERIES,
            EvidenceLevel.CASE_REPORT,
            EvidenceLevel.IN_VITRO,
            EvidenceLevel.IN_SILICO,
        ]:
            patterns = self._study_patterns.get(level, [])
            for pattern in patterns:
                if pattern.search(text):
                    return level

        return EvidenceLevel.UNKNOWN

    def _get_journal_info(self, journal: str | None) -> tuple:
        """Get journal tier and impact factor."""
        if not journal:
            return JournalTier.UNKNOWN, None

        journal_lower = journal.lower().strip()

        # Check known journals
        for name, info in self.TOP_JOURNALS.items():
            if name in journal_lower or journal_lower in name:
                return info["tier"], info["if"]

        # Estimate tier from journal name patterns
        if any(p in journal_lower for p in ["nature", "science", "cell", "nejm", "jama"]):
            return JournalTier.HIGH_IMPACT, 15.0
        elif any(p in journal_lower for p in ["plos", "bmc", "frontiers"]):
            return JournalTier.MEDIUM_IMPACT, 4.0
        elif "arxiv" in journal_lower or "rxiv" in journal_lower:
            return JournalTier.PREPRINT, 0.0

        return JournalTier.UNKNOWN, None

    def _detect_source_type(self, journal: str | None, text: str) -> SourceType:
        """Detect source type."""
        if journal:
            journal_lower = journal.lower()
            if "rxiv" in journal_lower:
                return SourceType.PREPRINT
            if "clinical trial" in journal_lower or "clinicaltrials" in text:
                return SourceType.CLINICAL_TRIAL

        if "review" in text and ("systematic" in text or "meta" in text):
            return SourceType.REVIEW_ARTICLE
        if "patent" in text.lower():
            return SourceType.PATENT
        if "guideline" in text.lower():
            return SourceType.GUIDELINE

        return SourceType.JOURNAL_ARTICLE

    def _calculate_quality_score(
        self,
        evidence_level: EvidenceLevel,
        journal_tier: JournalTier,
        publication_year: int | None,
        citation_count: int | None,
        source_type: SourceType,
    ) -> float:
        """Calculate overall quality score."""
        scores = []
        weights = []

        # Evidence level score
        evidence_score = self.EVIDENCE_WEIGHTS.get(evidence_level, 0.5)
        scores.append(evidence_score)
        weights.append(self.evidence_weight)

        # Venue score
        venue_score = self.TIER_WEIGHTS.get(journal_tier, 0.5)
        scores.append(venue_score)
        weights.append(self.venue_weight)

        # Recency score
        if publication_year:
            current_year = datetime.now().year
            age = current_year - publication_year
            recency_score = max(0, 1 - (age * 0.05))  # Decay 5% per year
            scores.append(recency_score)
            weights.append(self.recency_weight)

        # Citation score (normalized)
        if citation_count is not None:
            # Logarithmic scale for citations
            import math

            citation_score = min(1.0, math.log10(citation_count + 1) / 4)
            scores.append(citation_score)
            weights.append(self.citation_weight)

        # Weighted average
        if not scores:
            return 0.5

        total_weight = sum(weights)
        weighted_sum = sum(s * w for s, w in zip(scores, weights))

        return weighted_sum / total_weight

    def _check_retracted(self, text: str, metadata: dict | None) -> bool:
        """Check if source is retracted."""
        if metadata and metadata.get("retracted"):
            return True
        if "retract" in text.lower():
            return True
        return False

    def _check_corrections(self, metadata: dict | None) -> bool:
        """Check if source has corrections."""
        if metadata and metadata.get("has_corrections"):
            return True
        return False

    def batch_analyze(self, sources: list[dict[str, Any]]) -> list[SourceQuality]:
        """
        Analyze multiple sources.

        Args:
            sources: List of source dictionaries

        Returns:
            List of SourceQuality assessments
        """
        results = []
        for source in sources:
            quality = self.analyze(
                source_id=source.get("id", ""),
                title=source.get("title"),
                abstract=source.get("abstract"),
                journal=source.get("journal"),
                publication_year=source.get("year"),
                citation_count=source.get("citations"),
                source_type=source.get("source_type"),
                metadata=source.get("metadata"),
            )
            results.append(quality)
        return results

    def compare_sources(self, sources: list[SourceQuality]) -> dict[str, Any]:
        """
        Compare quality of multiple sources.

        Args:
            sources: List of SourceQuality objects

        Returns:
            Comparison summary
        """
        if not sources:
            return {"error": "No sources to compare"}

        scores = [s.quality_score for s in sources]
        levels = [s.evidence_level.value for s in sources]
        tiers = [s.journal_tier.value for s in sources]

        # Find best source
        best_idx = scores.index(max(scores))
        best_source = sources[best_idx]

        return {
            "total_sources": len(sources),
            "average_quality": sum(scores) / len(scores),
            "min_quality": min(scores),
            "max_quality": max(scores),
            "best_source": {
                "id": best_source.source_id,
                "quality_score": best_source.quality_score,
                "evidence_level": best_source.evidence_level.value,
            },
            "evidence_level_distribution": {level: levels.count(level) for level in set(levels)},
            "journal_tier_distribution": {tier: tiers.count(tier) for tier in set(tiers)},
            "retracted_count": sum(1 for s in sources if s.retracted),
            "peer_reviewed_count": sum(1 for s in sources if s.peer_reviewed),
        }


# Convenience function
def analyze_source_quality(
    source_id: str,
    title: str | None = None,
    abstract: str | None = None,
    journal: str | None = None,
) -> SourceQuality:
    """Quick source quality analysis."""
    analyzer = SourceQualityAnalyzer()
    return analyzer.analyze(source_id, title, abstract, journal)
