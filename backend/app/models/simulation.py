"""
Simulation Model

Monte Carlo simulation runs and results.
"""

from datetime import UTC
from enum import StrEnum
from typing import Any

from sqlalchemy import Column, DateTime, Enum, Float, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import relationship

from app.models.base import BaseModel


class SimulationStatus(StrEnum):
    """Simulation status enum."""

    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class SimulationType(StrEnum):
    """Type of simulation."""

    CLINICAL_OUTCOME = "clinical_outcome"
    EPIDEMIOLOGICAL = "epidemiological"
    DOSE_RESPONSE = "dose_response"
    PATHWAY_DYNAMICS = "pathway_dynamics"
    DRUG_INTERACTION = "drug_interaction"
    SURVIVAL_ANALYSIS = "survival_analysis"
    CUSTOM = "custom"


class DistributionType(StrEnum):
    """Parameter distribution types."""

    NORMAL = "normal"
    LOGNORMAL = "lognormal"
    UNIFORM = "uniform"
    BETA = "beta"
    GAMMA = "gamma"
    EXPONENTIAL = "exponential"
    BINOMIAL = "binomial"
    POISSON = "poisson"
    FIXED = "fixed"


class Simulation(BaseModel):
    """Simulation run model."""

    __tablename__ = "simulations"

    # References
    project_id = Column(
        PGUUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    hypothesis_id = Column(
        PGUUID(as_uuid=True),
        ForeignKey("hypotheses.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # Simulation metadata
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    simulation_type = Column(
        Enum(SimulationType, name="simulation_type", values_callable=lambda x: [e.value for e in x]),
        default=SimulationType.CUSTOM,
        nullable=False,
    )

    # Status tracking
    status = Column(
        Enum(SimulationStatus, name="simulation_status", values_callable=lambda x: [e.value for e in x]),
        default=SimulationStatus.PENDING,
        nullable=False,
        index=True,
    )
    progress = Column(Float, default=0.0, nullable=False)

    # Execution parameters
    iterations = Column(Integer, default=1000, nullable=False)
    iterations_completed = Column(Integer, default=0, nullable=False)
    seed = Column(Integer, nullable=True)
    timeout_seconds = Column(Integer, default=300, nullable=False)

    # Input parameters (JSON)
    parameters = Column(JSONB, nullable=False, default=dict)
    custom_model = Column(Text, nullable=True)  # Python code for custom simulations

    # Results (JSON)
    outcomes = Column(JSONB, nullable=True)
    intermediate_results = Column(JSONB, nullable=True)

    # Execution metadata
    started_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    runtime_seconds = Column(Float, nullable=True)
    error_message = Column(Text, nullable=True)

    # Worker info
    worker_id = Column(String(100), nullable=True)

    # Relationships
    project = relationship("Project", back_populates="simulations")
    hypothesis = relationship("Hypothesis")

    def __repr__(self) -> str:
        return f"<Simulation {self.name}: {self.status.value}>"

    def start(self) -> None:
        """Mark simulation as started."""
        from datetime import datetime

        self.status = SimulationStatus.RUNNING
        self.started_at = datetime.now(UTC)

    def complete(self, outcomes: dict[str, Any]) -> None:
        """Mark simulation as completed with outcomes."""
        from datetime import datetime

        self.status = SimulationStatus.COMPLETED
        self.completed_at = datetime.now(UTC)
        self.outcomes = outcomes
        self.progress = 1.0
        self.iterations_completed = self.iterations

        if self.started_at:
            delta = self.completed_at - self.started_at
            self.runtime_seconds = delta.total_seconds()

    def fail(self, error_message: str) -> None:
        """Mark simulation as failed."""
        from datetime import datetime

        self.status = SimulationStatus.FAILED
        self.completed_at = datetime.now(UTC)
        self.error_message = error_message

        if self.started_at:
            delta = self.completed_at - self.started_at
            self.runtime_seconds = delta.total_seconds()

    def cancel(self) -> None:
        """Mark simulation as cancelled."""
        from datetime import datetime

        self.status = SimulationStatus.CANCELLED
        self.completed_at = datetime.now(UTC)

    def update_progress(self, completed: int) -> None:
        """Update progress based on completed iterations."""
        self.iterations_completed = completed
        self.progress = completed / max(1, self.iterations)
