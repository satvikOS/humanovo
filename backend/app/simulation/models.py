"""
Simulation Models — Overhauled

Data models for Monte Carlo simulations with support for:
- Extended distribution types (Weibull, Triangular, Truncated Normal)
- Sensitivity analysis configuration
- Time-series output
- Convergence diagnostics
"""

from __future__ import annotations

from enum import Enum
from typing import Any
from uuid import UUID, uuid4

import numpy as np
from pydantic import BaseModel, Field


class DistributionType(str, Enum):
    """Statistical distribution types for parameter sampling."""

    NORMAL = "normal"
    LOGNORMAL = "lognormal"
    UNIFORM = "uniform"
    BETA = "beta"
    GAMMA = "gamma"
    EXPONENTIAL = "exponential"
    BINOMIAL = "binomial"
    POISSON = "poisson"
    FIXED = "fixed"
    # Extended distributions
    WEIBULL = "weibull"
    TRIANGULAR = "triangular"
    TRUNCATED_NORMAL = "truncated_normal"
    NEGATIVE_BINOMIAL = "negative_binomial"
    CAUCHY = "cauchy"
    CHI_SQUARED = "chi_squared"
    STUDENT_T = "student_t"


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
    description: str | None = None

    model_config = {"use_enum_values": True}


class SimulationConfig(BaseModel):
    """Configuration for a simulation run."""

    simulation_type: SimulationType
    parameters: list[DistributionConfig]
    iterations: int = 1000
    seed: int | None = None
    custom_model: str | None = None
    outcomes: list[str] = Field(default_factory=lambda: ["result"])

    # New options
    include_sensitivity: bool = False
    include_convergence: bool = False
    include_timeseries: bool = False
    use_gpu: bool = False

    model_config = {"use_enum_values": True}


class OutcomeMetric(BaseModel):
    """Statistics for a simulation outcome — enhanced with additional metrics."""

    name: str
    mean: float
    std: float
    median: float
    ci_lower: float
    ci_upper: float
    min: float
    max: float
    percentiles: dict[str, float] = Field(default_factory=dict)
    skewness: float = 0.0
    kurtosis: float = 0.0
    n_samples: int = 0
    se: float = 0.0  # Standard error of the mean

    @classmethod
    def from_samples(cls, name: str, samples: list[float]) -> OutcomeMetric:
        """Create OutcomeMetric from a list of samples with full statistics."""
        from scipy import stats as sp_stats

        arr = np.array(samples)
        arr = arr[~np.isnan(arr)]  # Remove NaNs
        n = len(arr)

        if n == 0:
            return cls(
                name=name, mean=0.0, std=0.0, median=0.0,
                ci_lower=0.0, ci_upper=0.0, min=0.0, max=0.0,
                n_samples=0,
            )

        mean_val = float(np.mean(arr))
        std_val = float(np.std(arr, ddof=1)) if n > 1 else 0.0
        se = std_val / np.sqrt(n) if n > 0 else 0.0

        return cls(
            name=name,
            mean=mean_val,
            std=std_val,
            median=float(np.median(arr)),
            ci_lower=float(np.percentile(arr, 2.5)),
            ci_upper=float(np.percentile(arr, 97.5)),
            min=float(np.min(arr)),
            max=float(np.max(arr)),
            percentiles={
                "1": float(np.percentile(arr, 1)),
                "5": float(np.percentile(arr, 5)),
                "10": float(np.percentile(arr, 10)),
                "25": float(np.percentile(arr, 25)),
                "50": float(np.percentile(arr, 50)),
                "75": float(np.percentile(arr, 75)),
                "90": float(np.percentile(arr, 90)),
                "95": float(np.percentile(arr, 95)),
                "99": float(np.percentile(arr, 99)),
            },
            skewness=float(sp_stats.skew(arr)) if n > 2 else 0.0,
            kurtosis=float(sp_stats.kurtosis(arr)) if n > 3 else 0.0,
            n_samples=n,
            se=float(se),
        )


class SensitivityResult(BaseModel):
    """Sensitivity analysis results."""

    total_variance: float
    indices: dict[str, float]  # Parameter name -> first-order Sobol index
    most_influential: str
    n_samples: int


class ConvergenceResult(BaseModel):
    """Convergence diagnostic results."""

    iterations: int
    all_converged: bool
    convergence: dict[str, dict[str, Any]]


class SimulationResult(BaseModel):
    """Complete results from a simulation run — enhanced."""

    id: UUID = Field(default_factory=uuid4)
    config: SimulationConfig
    outcomes: list[OutcomeMetric]
    iterations_completed: int
    runtime_seconds: float
    raw_samples: dict[str, list[float]] | None = None
    timeseries: list[dict[str, Any]] | None = None
    sensitivity: SensitivityResult | None = None
    convergence: ConvergenceResult | None = None
