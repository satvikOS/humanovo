"""
Simulation Models

Data models for Monte Carlo simulations.
"""

from enum import Enum
from uuid import UUID, uuid4

from pydantic import BaseModel, Field


class DistributionType(str, Enum):
    """Statistical distribution types."""

    NORMAL = "normal"
    LOGNORMAL = "lognormal"
    UNIFORM = "uniform"
    BETA = "beta"
    GAMMA = "gamma"
    EXPONENTIAL = "exponential"
    BINOMIAL = "binomial"
    POISSON = "poisson"
    FIXED = "fixed"


class SimulationType(str, Enum):
    """Types of simulations."""

    CLINICAL_OUTCOME = "clinical_outcome"
    EPIDEMIOLOGICAL = "epidemiological"
    DOSE_RESPONSE = "dose_response"
    PATHWAY_DYNAMICS = "pathway_dynamics"
    DRUG_INTERACTION = "drug_interaction"
    SURVIVAL_ANALYSIS = "survival_analysis"
    CUSTOM = "custom"


class DistributionConfig(BaseModel):
    """Configuration for a parameter distribution."""

    name: str
    distribution: DistributionType
    params: dict[str, float] = Field(default_factory=dict)

    class Config:
        use_enum_values = True


class SimulationConfig(BaseModel):
    """Configuration for a simulation run."""

    simulation_type: SimulationType
    parameters: list[DistributionConfig]
    iterations: int = 1000
    seed: int | None = None
    custom_model: str | None = None
    outcomes: list[str] = Field(default_factory=lambda: ["result"])

    class Config:
        use_enum_values = True


class OutcomeMetric(BaseModel):
    """Statistics for a simulation outcome."""

    name: str
    mean: float
    std: float
    median: float
    ci_lower: float
    ci_upper: float
    min: float
    max: float
    percentiles: dict[str, float] = Field(default_factory=dict)

    @classmethod
    def from_samples(cls, name: str, samples: list[float]) -> "OutcomeMetric":
        """Create OutcomeMetric from a list of samples."""
        import numpy as np

        arr = np.array(samples)

        return cls(
            name=name,
            mean=float(np.mean(arr)),
            std=float(np.std(arr)),
            median=float(np.median(arr)),
            ci_lower=float(np.percentile(arr, 2.5)),
            ci_upper=float(np.percentile(arr, 97.5)),
            min=float(np.min(arr)),
            max=float(np.max(arr)),
            percentiles={
                "5": float(np.percentile(arr, 5)),
                "25": float(np.percentile(arr, 25)),
                "50": float(np.percentile(arr, 50)),
                "75": float(np.percentile(arr, 75)),
                "95": float(np.percentile(arr, 95)),
            },
        )


class SimulationResult(BaseModel):
    """Complete results from a simulation run."""

    id: UUID = Field(default_factory=uuid4)
    config: SimulationConfig
    outcomes: list[OutcomeMetric]
    iterations_completed: int
    runtime_seconds: float
    raw_samples: dict[str, list[float]] | None = None
