"""
Citation Analysis

Analyzes citation patterns and metrics:
- Citation count trends
- Citation velocity
- Self-citation detection
- Field normalization
- Influential citations
"""

import logging
import math
from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum
from typing import Any

logger = logging.getLogger(__name__)


class CitationType(StrEnum):
    """Types of citations."""

    SUPPORTING = "supporting"  # Cites as supporting evidence
    CONTRASTING = "contrasting"  # Cites as contradicting evidence
    BACKGROUND = "background"  # General background citation
    METHODOLOGICAL = "methodological"  # Cites for methods
    SELF_CITATION = "self_citation"  # Author self-citation
    REVIEW = "review"  # Cited in a review
    UNKNOWN = "unknown"


@dataclass
class CitationMetrics:
    """Citation metrics for a source."""

    source_id: str
    total_citations: int = 0
    citations_per_year: float = 0.0
    citation_velocity: float = 0.0  # Recent citation rate
    self_citation_rate: float = 0.0
    field_normalized_score: float = 0.0
    h_index_contribution: float = 0.0
    top_citing_journals: list[str] = field(default_factory=list)
    citation_trend: str = "stable"  # increasing, decreasing, stable
    highly_cited: bool = False
    influential_citations: int = 0  # Citations from high-impact sources
    citation_contexts: dict[str, int] = field(default_factory=dict)
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "source_id": self.source_id,
            "total_citations": self.total_citations,
            "citations_per_year": self.citations_per_year,
            "citation_velocity": self.citation_velocity,
            "self_citation_rate": self.self_citation_rate,
            "field_normalized_score": self.field_normalized_score,
            "h_index_contribution": self.h_index_contribution,
            "top_citing_journals": self.top_citing_journals,
            "citation_trend": self.citation_trend,
            "highly_cited": self.highly_cited,
            "influential_citations": self.influential_citations,
            "citation_contexts": self.citation_contexts,
            "metadata": self.metadata,
        }

    def get_citation_score(self) -> float:
        """Calculate overall citation-based score."""
        # Base score from citations (logarithmic)
        if self.total_citations == 0:
            base_score = 0
        else:
            base_score = min(1.0, math.log10(self.total_citations + 1) / 4)

        # Boost for field-normalized performance
        normalized_boost = min(0.2, self.field_normalized_score * 0.1)

        # Boost for influential citations
        influential_boost = min(0.1, self.influential_citations * 0.02)

        # Penalty for high self-citation
        self_citation_penalty = max(0, (self.self_citation_rate - 0.2) * 0.5)

        return min(
            1.0, max(0, base_score + normalized_boost + influential_boost - self_citation_penalty)
        )


@dataclass
class CitingSource:
    """Information about a citing source."""

    source_id: str
    title: str
    authors: list[str] = field(default_factory=list)
    journal: str = ""
    year: int = 0
    citation_type: CitationType = CitationType.UNKNOWN
    citation_context: str = ""
    is_influential: bool = False
    metadata: dict[str, Any] = field(default_factory=dict)


class CitationAnalyzer:
    """
    Analyzes citation patterns and metrics.

    Evaluates:
    - Raw citation counts
    - Field-normalized impact
    - Citation velocity/trends
    - Self-citation patterns
    - Influential citations
    """

    # Field citation norms (approximate median citations per year)
    FIELD_NORMS = {
        "molecular_biology": 5.0,
        "oncology": 4.5,
        "pharmacology": 4.0,
        "genetics": 5.5,
        "immunology": 4.8,
        "clinical_medicine": 3.5,
        "neuroscience": 4.2,
        "cardiology": 3.8,
        "general": 4.0,
    }

    # Thresholds for "highly cited"
    HIGHLY_CITED_THRESHOLDS = {
        1: 50,  # 1 year old: 50+ citations
        2: 80,  # 2 years: 80+
        3: 100,  # 3 years: 100+
        5: 150,  # 5 years: 150+
        10: 300,  # 10 years: 300+
    }

    def __init__(self, default_field: str = "general", self_citation_threshold: float = 0.3):
        """
        Initialize the citation analyzer.

        Args:
            default_field: Default research field
            self_citation_threshold: Threshold for flagging self-citations
        """
        self.default_field = default_field
        self.self_citation_threshold = self_citation_threshold

        logger.info("CitationAnalyzer initialized")

    def analyze(
        self,
        source_id: str,
        total_citations: int,
        publication_year: int,
        authors: list[str] | None = None,
        citing_sources: list[CitingSource] | None = None,
        field: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> CitationMetrics:
        """
        Analyze citation metrics for a source.

        Args:
            source_id: Source identifier
            total_citations: Total citation count
            publication_year: Year of publication
            authors: List of author names
            citing_sources: List of citing sources
            field: Research field
            metadata: Additional metadata

        Returns:
            CitationMetrics
        """
        current_year = datetime.now().year
        age = max(1, current_year - publication_year)
        field = field or self.default_field

        # Calculate citations per year
        citations_per_year = total_citations / age

        # Calculate field-normalized score
        field_norm = self.FIELD_NORMS.get(field, self.FIELD_NORMS["general"])
        field_normalized_score = citations_per_year / field_norm

        # Analyze citing sources if provided
        self_citation_rate = 0.0
        influential_citations = 0
        citation_contexts = {}
        top_journals = []

        if citing_sources:
            # Self-citation analysis
            if authors:
                authors_lower = {a.lower() for a in authors}
                self_citations = sum(
                    1
                    for cs in citing_sources
                    if any(a.lower() in authors_lower for a in cs.authors)
                )
                self_citation_rate = self_citations / len(citing_sources) if citing_sources else 0

            # Influential citations
            influential_citations = sum(1 for cs in citing_sources if cs.is_influential)

            # Citation contexts
            for cs in citing_sources:
                ctx = cs.citation_type.value
                citation_contexts[ctx] = citation_contexts.get(ctx, 0) + 1

            # Top citing journals
            journal_counts = {}
            for cs in citing_sources:
                if cs.journal:
                    journal_counts[cs.journal] = journal_counts.get(cs.journal, 0) + 1
            top_journals = sorted(
                journal_counts.keys(), key=lambda j: journal_counts[j], reverse=True
            )[:5]

        # Determine if highly cited
        highly_cited = self._is_highly_cited(total_citations, age)

        # Citation trend (would need historical data; simplified here)
        citation_trend = "stable"
        if citations_per_year > field_norm * 1.5:
            citation_trend = "increasing"
        elif citations_per_year < field_norm * 0.5:
            citation_trend = "decreasing"

        # Citation velocity (recent citations / older citations)
        # Simplified: assume constant rate
        citation_velocity = citations_per_year

        return CitationMetrics(
            source_id=source_id,
            total_citations=total_citations,
            citations_per_year=citations_per_year,
            citation_velocity=citation_velocity,
            self_citation_rate=self_citation_rate,
            field_normalized_score=field_normalized_score,
            top_citing_journals=top_journals,
            citation_trend=citation_trend,
            highly_cited=highly_cited,
            influential_citations=influential_citations,
            citation_contexts=citation_contexts,
            metadata=metadata or {},
        )

    def _is_highly_cited(self, citations: int, age: int) -> bool:
        """Check if paper is highly cited for its age."""
        for years, threshold in sorted(self.HIGHLY_CITED_THRESHOLDS.items()):
            if age <= years:
                return citations >= threshold
        return citations >= 300

    def analyze_co_citation(
        self, source_ids: list[str], citation_matrix: dict[str, list[str]]
    ) -> dict[str, Any]:
        """
        Analyze co-citation patterns.

        Args:
            source_ids: List of source IDs
            citation_matrix: Dict mapping source -> list of sources that cite it

        Returns:
            Co-citation analysis
        """
        co_citation_counts = {}

        for source_a in source_ids:
            for source_b in source_ids:
                if source_a >= source_b:
                    continue

                # Find sources that cite both
                citers_a = set(citation_matrix.get(source_a, []))
                citers_b = set(citation_matrix.get(source_b, []))
                co_citations = len(citers_a & citers_b)

                if co_citations > 0:
                    key = f"{source_a}|{source_b}"
                    co_citation_counts[key] = co_citations

        # Find clusters (simplified)
        clusters = self._find_co_citation_clusters(source_ids, co_citation_counts)

        return {
            "co_citation_pairs": co_citation_counts,
            "clusters": clusters,
            "most_co_cited": sorted(co_citation_counts.items(), key=lambda x: x[1], reverse=True)[
                :10
            ],
        }

    def _find_co_citation_clusters(
        self, source_ids: list[str], co_citations: dict[str, int]
    ) -> list[list[str]]:
        """Find clusters of co-cited papers."""
        # Simple connected components
        if not co_citations:
            return []

        # Build adjacency
        adj = {s: set() for s in source_ids}
        for pair, count in co_citations.items():
            if count >= 3:  # Minimum co-citation threshold
                a, b = pair.split("|")
                adj[a].add(b)
                adj[b].add(a)

        # Find components
        visited = set()
        clusters = []

        for source in source_ids:
            if source in visited:
                continue

            cluster = []
            stack = [source]
            while stack:
                node = stack.pop()
                if node in visited:
                    continue
                visited.add(node)
                cluster.append(node)
                stack.extend(adj[node] - visited)

            if len(cluster) > 1:
                clusters.append(cluster)

        return clusters

    def calculate_citation_score(self, metrics: CitationMetrics) -> float:
        """
        Calculate a single citation-based score.

        Args:
            metrics: CitationMetrics object

        Returns:
            Score between 0 and 1
        """
        return metrics.get_citation_score()

    def batch_analyze(self, sources: list[dict[str, Any]]) -> list[CitationMetrics]:
        """
        Analyze multiple sources.

        Args:
            sources: List of source dictionaries

        Returns:
            List of CitationMetrics
        """
        results = []
        for source in sources:
            metrics = self.analyze(
                source_id=source.get("id", ""),
                total_citations=source.get("citations", 0),
                publication_year=source.get("year", datetime.now().year),
                authors=source.get("authors"),
                field=source.get("field"),
                metadata=source.get("metadata"),
            )
            results.append(metrics)
        return results

    def compare_citation_impact(self, metrics_list: list[CitationMetrics]) -> dict[str, Any]:
        """
        Compare citation impact across sources.

        Args:
            metrics_list: List of CitationMetrics

        Returns:
            Comparison summary
        """
        if not metrics_list:
            return {"error": "No metrics to compare"}

        total_cites = [m.total_citations for m in metrics_list]
        normalized = [m.field_normalized_score for m in metrics_list]
        highly_cited = sum(1 for m in metrics_list if m.highly_cited)

        return {
            "total_sources": len(metrics_list),
            "total_citations": sum(total_cites),
            "average_citations": sum(total_cites) / len(total_cites),
            "max_citations": max(total_cites),
            "average_field_normalized": sum(normalized) / len(normalized),
            "highly_cited_count": highly_cited,
            "highly_cited_rate": highly_cited / len(metrics_list),
        }


# Convenience function
def analyze_citations(
    source_id: str, citations: int, year: int, field: str | None = None
) -> CitationMetrics:
    """Quick citation analysis."""
    analyzer = CitationAnalyzer()
    return analyzer.analyze(source_id, citations, year, field=field)
