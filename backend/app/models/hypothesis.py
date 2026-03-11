"""
Hypothesis Model

AI-generated and user-defined hypothesis model.
"""

from enum import Enum as PyEnum

from sqlalchemy import Column, Enum, Float, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import relationship

from app.models.base import BaseModel


class HypothesisStatus(str, PyEnum):
    """Hypothesis status enum."""

    DRAFT = "draft"
    GENERATING = "generating"
    ACTIVE = "active"
    VALIDATED = "validated"
    REJECTED = "rejected"
    ARCHIVED = "archived"


class EvidenceType(str, PyEnum):
    """Type of evidence relationship."""

    SUPPORTING = "supporting"
    CONTRADICTING = "contradicting"
    NEUTRAL = "neutral"


class EvidenceReference(BaseModel):
    """Reference linking evidence to hypotheses."""

    __tablename__ = "evidence_references"

    hypothesis_id = Column(
        PGUUID(as_uuid=True),
        ForeignKey("hypotheses.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    evidence_id = Column(
        PGUUID(as_uuid=True),
        ForeignKey("evidence.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    evidence_type = Column(
        Enum(EvidenceType, name="evidence_type"),
        default=EvidenceType.NEUTRAL,
        nullable=False,
    )
    relevance_score = Column(Float, default=0.0, nullable=False)
    snippet = Column(Text, nullable=True)

    # Relationships
    hypothesis = relationship("Hypothesis", back_populates="evidence_refs")
    evidence = relationship("Evidence", back_populates="hypothesis_refs")


class Hypothesis(BaseModel):
    """Hypothesis model."""

    __tablename__ = "hypotheses"

    # Project reference
    project_id = Column(
        PGUUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Core content
    statement = Column(Text, nullable=False)
    mechanism = Column(Text, nullable=True)
    rationale = Column(Text, nullable=True)

    # Status and scores
    status = Column(
        Enum(HypothesisStatus, name="hypothesis_status"),
        default=HypothesisStatus.DRAFT,
        nullable=False,
        index=True,
    )
    confidence_score = Column(Float, default=0.0, nullable=False)
    novelty_score = Column(Float, default=0.0, nullable=False)

    # Evidence counts
    supporting_count = Column(Integer, default=0, nullable=False)
    contradiction_count = Column(Integer, default=0, nullable=False)

    # Simulation results (JSON)
    simulation_results = Column(JSONB, nullable=True)

    # Metadata
    tags = Column(ARRAY(String), default=list, nullable=False)
    user_notes = Column(Text, nullable=True)
    version = Column(Integer, default=1, nullable=False)

    # Generation metadata
    generated_by = Column(String(50), nullable=True)  # 'user', 'ai', 'system'
    generation_context = Column(JSONB, nullable=True)

    # Translational roadmap (T0-T5 bench-to-bedside)
    translational_roadmap = Column(JSONB, nullable=True)

    # Relationships
    project = relationship("Project", back_populates="hypotheses")
    evidence_refs = relationship(
        "EvidenceReference",
        back_populates="hypothesis",
        lazy="dynamic",
        cascade="all, delete-orphan",
    )

    def __repr__(self) -> str:
        return f"<Hypothesis {self.id}: {self.statement[:50]}...>"

    def update_evidence_counts(self) -> None:
        """Update supporting/contradiction counts from references."""
        supporting = 0
        contradicting = 0

        for ref in self.evidence_refs:
            if ref.evidence_type == EvidenceType.SUPPORTING:
                supporting += 1
            elif ref.evidence_type == EvidenceType.CONTRADICTING:
                contradicting += 1

        self.supporting_count = supporting
        self.contradiction_count = contradicting

    def increment_version(self) -> None:
        """Increment version number."""
        self.version = (self.version or 0) + 1

    def set_simulation_results(
        self,
        simulation_id: str,
        outcome_probability: float,
        confidence_interval: tuple,
        iterations: int,
        summary: str,
    ) -> None:
        """Set simulation results."""
        self.simulation_results = {
            "simulation_id": simulation_id,
            "outcome_probability": outcome_probability,
            "confidence_interval": list(confidence_interval),
            "iterations": iterations,
            "summary": summary,
        }
