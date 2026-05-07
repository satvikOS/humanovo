"""
Project Model

Research project/session model.
"""

from enum import StrEnum

from sqlalchemy import Column, Enum, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import relationship

from app.models.base import BaseModel


class ProjectStatus(StrEnum):
    """Project status enum."""

    ACTIVE = "active"
    PAUSED = "paused"
    COMPLETED = "completed"
    ARCHIVED = "archived"


class Project(BaseModel):
    """Research project model."""

    __tablename__ = "projects"

    # Basic info
    name = Column(String(255), nullable=False, index=True)
    description = Column(Text, nullable=True)
    disease_focus = Column(String(255), nullable=True, index=True)
    research_question = Column(Text, nullable=True)

    # Classification
    tags = Column(ARRAY(String), default=list, nullable=False)
    status = Column(
        Enum(
            ProjectStatus,
            name="project_status",
            # Use the enum VALUE (lowercase "active") to match the Postgres
            # enum type, not the Python NAME (uppercase "ACTIVE") —
            # otherwise asyncpg raises InvalidTextRepresentationError.
            values_callable=lambda x: [e.value for e in x],
        ),
        default=ProjectStatus.ACTIVE,
        nullable=False,
    )

    # Owner
    owner_id = Column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # Computed counts (denormalized for performance)
    hypothesis_count = Column(Integer, default=0, nullable=False)
    evidence_count = Column(Integer, default=0, nullable=False)
    simulation_count = Column(Integer, default=0, nullable=False)

    # Settings
    settings = Column(Text, nullable=True)  # JSON stored as text

    # Relationships
    owner = relationship("User", back_populates="projects")
    hypotheses = relationship(
        "Hypothesis",
        back_populates="project",
        lazy="dynamic",
        cascade="all, delete-orphan",
    )
    evidence = relationship(
        "Evidence",
        back_populates="project",
        lazy="dynamic",
        cascade="all, delete-orphan",
    )
    simulations = relationship(
        "Simulation",
        back_populates="project",
        lazy="dynamic",
        cascade="all, delete-orphan",
    )
    agent_tasks = relationship(
        "AgentTask",
        back_populates="project",
        lazy="dynamic",
        cascade="all, delete-orphan",
    )

    def __repr__(self) -> str:
        return f"<Project {self.name}>"

    def increment_hypothesis_count(self) -> None:
        """Increment hypothesis count."""
        self.hypothesis_count = (self.hypothesis_count or 0) + 1

    def decrement_hypothesis_count(self) -> None:
        """Decrement hypothesis count."""
        self.hypothesis_count = max(0, (self.hypothesis_count or 0) - 1)

    def increment_evidence_count(self) -> None:
        """Increment evidence count."""
        self.evidence_count = (self.evidence_count or 0) + 1

    def decrement_evidence_count(self) -> None:
        """Decrement evidence count."""
        self.evidence_count = max(0, (self.evidence_count or 0) - 1)

    def increment_simulation_count(self) -> None:
        """Increment simulation count."""
        self.simulation_count = (self.simulation_count or 0) + 1

    def decrement_simulation_count(self) -> None:
        """Decrement simulation count."""
        self.simulation_count = max(0, (self.simulation_count or 0) - 1)
