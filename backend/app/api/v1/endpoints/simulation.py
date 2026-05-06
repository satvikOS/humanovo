"""
Simulation API Endpoints

Run and manage Monte Carlo simulations.
"""

from datetime import datetime
from enum import Enum
from typing import Any
from uuid import UUID, uuid4

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.logging import get_logger
from app.core.auth import AUTH_REQUIRED

logger = get_logger(__name__)
router = APIRouter(dependencies=AUTH_REQUIRED)


class SimulationType(str, Enum):
    """Types of simulations available."""

    CLINICAL_OUTCOME = "clinical_outcome"
    EPIDEMIOLOGICAL = "epidemiological"
    DOSE_RESPONSE = "dose_response"
    PATHWAY_DYNAMICS = "pathway_dynamics"
    DRUG_INTERACTION = "drug_interaction"
    SURVIVAL_ANALYSIS = "survival_analysis"
    CUSTOM = "custom"


class SimulationStatus(str, Enum):
    """Status of a simulation."""

    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class DistributionType(str, Enum):
    """Statistical distribution types for parameters."""

    NORMAL = "normal"
    LOGNORMAL = "lognormal"
    UNIFORM = "uniform"
    BETA = "beta"
    GAMMA = "gamma"
    EXPONENTIAL = "exponential"
    BINOMIAL = "binomial"
    POISSON = "poisson"
    FIXED = "fixed"


class ParameterDistribution(BaseModel):
    """Definition of a parameter's distribution."""

    name: str
    distribution: DistributionType
    params: dict[str, float] = Field(
        ...,
        description="Distribution parameters (e.g., {'mean': 0.5, 'std': 0.1} for normal)",
    )


class SimulationCreate(BaseModel):
    """Schema for creating a simulation."""

    hypothesis_id: UUID | None = None
    project_id: UUID
    name: str = Field(..., min_length=3, max_length=255)
    description: str | None = None
    simulation_type: SimulationType
    parameters: list[ParameterDistribution]
    iterations: int = Field(
        default=settings.SIMULATION_DEFAULT_ITERATIONS,
        ge=100,
        le=settings.SIMULATION_MAX_ITERATIONS,
    )
    seed: int | None = Field(None, description="Random seed for reproducibility")
    custom_model: str | None = Field(
        None,
        description="Custom Python code for simulation (type=custom only)",
    )


class OutcomeMetric(BaseModel):
    """A single outcome metric from simulation."""

    name: str
    mean: float
    std: float
    median: float
    ci_lower: float  # 95% CI lower bound
    ci_upper: float  # 95% CI upper bound
    min: float
    max: float
    percentiles: dict[str, float] = Field(
        default_factory=dict,
        description="Percentile values (e.g., {'25': 0.3, '75': 0.7})",
    )


class SimulationResponse(BaseModel):
    """Schema for simulation response."""

    id: UUID
    hypothesis_id: UUID | None
    project_id: UUID
    name: str
    description: str | None
    simulation_type: SimulationType
    status: SimulationStatus
    iterations: int
    iterations_completed: int
    seed: int | None
    parameters: list[ParameterDistribution]
    outcomes: list[OutcomeMetric]
    summary: str | None
    runtime_seconds: float | None
    created_at: datetime
    completed_at: datetime | None


class SimulationListResponse(BaseModel):
    """Schema for paginated simulation list."""

    items: list[SimulationResponse]
    total: int
    page: int
    page_size: int


class SimulationRunResponse(BaseModel):
    """Response when starting a simulation."""

    id: UUID
    status: SimulationStatus
    message: str


# In-memory storage
_simulations: dict = {}


@router.post("", response_model=SimulationRunResponse, status_code=202)
async def create_simulation(
    simulation: SimulationCreate,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
) -> SimulationRunResponse:
    """Create and start a new Monte Carlo simulation."""
    logger.info(
        "Creating simulation",
        name=simulation.name,
        type=simulation.simulation_type.value,
        iterations=simulation.iterations,
    )

    simulation_id = uuid4()
    now = datetime.utcnow()

    simulation_data = SimulationResponse(
        id=simulation_id,
        hypothesis_id=simulation.hypothesis_id,
        project_id=simulation.project_id,
        name=simulation.name,
        description=simulation.description,
        simulation_type=simulation.simulation_type,
        status=SimulationStatus.QUEUED,
        iterations=simulation.iterations,
        iterations_completed=0,
        seed=simulation.seed,
        parameters=simulation.parameters,
        outcomes=[],
        summary=None,
        runtime_seconds=None,
        created_at=now,
        completed_at=None,
    )

    _simulations[simulation_id] = simulation_data

    # Queue simulation task
    background_tasks.add_task(
        _run_simulation,
        simulation_id,
        simulation,
    )

    logger.info("Simulation queued", simulation_id=str(simulation_id))

    return SimulationRunResponse(
        id=simulation_id,
        status=SimulationStatus.QUEUED,
        message=f"Simulation queued with {simulation.iterations} iterations",
    )


async def _run_simulation(simulation_id: UUID, config: SimulationCreate) -> None:
    """Background task to run the simulation."""
    import time

    logger.info("Starting simulation", simulation_id=str(simulation_id))

    sim = _simulations[simulation_id]
    sim.status = SimulationStatus.RUNNING
    start_time = time.time()

    try:
        from app.simulation.engine import MonteCarloEngine

        engine = MonteCarloEngine(
            simulation_type=config.simulation_type,
            parameters=config.parameters,
            iterations=config.iterations,
            seed=config.seed,
            custom_model=config.custom_model,
        )

        # Run simulation
        outcomes = await engine.run(
            progress_callback=lambda completed: _update_progress(simulation_id, completed)
        )

        # Update with results
        end_time = time.time()

        sim.status = SimulationStatus.COMPLETED
        sim.outcomes = outcomes
        sim.iterations_completed = config.iterations
        sim.runtime_seconds = end_time - start_time
        sim.completed_at = datetime.utcnow()
        sim.summary = _generate_summary(outcomes)

        logger.info(
            "Simulation completed",
            simulation_id=str(simulation_id),
            runtime=sim.runtime_seconds,
        )

    except Exception as e:
        logger.error(
            "Simulation failed",
            simulation_id=str(simulation_id),
            error=str(e),
        )
        sim.status = SimulationStatus.FAILED
        sim.summary = f"Simulation failed: {str(e)}"


def _update_progress(simulation_id: UUID, completed: int) -> None:
    """Update simulation progress."""
    if simulation_id in _simulations:
        _simulations[simulation_id].iterations_completed = completed


def _generate_summary(outcomes: list[OutcomeMetric]) -> str:
    """Generate a human-readable summary of simulation outcomes."""
    if not outcomes:
        return "No outcomes recorded."

    summary_parts = []
    for outcome in outcomes:
        summary_parts.append(
            f"{outcome.name}: {outcome.mean:.3f} (95% CI: {outcome.ci_lower:.3f} - {outcome.ci_upper:.3f})"
        )

    return "; ".join(summary_parts)


@router.get("", response_model=SimulationListResponse)
async def list_simulations(
    project_id: UUID | None = None,
    hypothesis_id: UUID | None = None,
    status: SimulationStatus | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
) -> SimulationListResponse:
    """List simulations with filtering and pagination."""
    items = list(_simulations.values())

    # Apply filters
    if project_id:
        items = [s for s in items if s.project_id == project_id]
    if hypothesis_id:
        items = [s for s in items if s.hypothesis_id == hypothesis_id]
    if status:
        items = [s for s in items if s.status == status]

    # Sort by created_at descending
    items.sort(key=lambda x: x.created_at, reverse=True)

    # Paginate
    total = len(items)
    start = (page - 1) * page_size
    end = start + page_size

    return SimulationListResponse(
        items=items[start:end],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/{simulation_id}", response_model=SimulationResponse)
async def get_simulation(
    simulation_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> SimulationResponse:
    """Get a specific simulation by ID."""
    if simulation_id not in _simulations:
        raise HTTPException(status_code=404, detail="Simulation not found")

    return _simulations[simulation_id]


@router.get("/{simulation_id}/results")
async def get_simulation_results(
    simulation_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Get results payload for a completed simulation. Frontend expects
    a `{results: ...}` object even when the run is still in progress
    (returns an empty results dict with the current status)."""
    if simulation_id not in _simulations:
        raise HTTPException(status_code=404, detail="Simulation not found")
    sim = _simulations[simulation_id]
    return {
        "simulation_id": str(simulation_id),
        "status": sim.status,
        "results": sim.results or {},
        "completed_at": sim.completed_at.isoformat() if sim.completed_at else None,
    }


@router.post("/{simulation_id}/cancel", response_model=SimulationResponse)
async def cancel_simulation(
    simulation_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> SimulationResponse:
    """Cancel a running simulation."""
    if simulation_id not in _simulations:
        raise HTTPException(status_code=404, detail="Simulation not found")

    sim = _simulations[simulation_id]

    if sim.status not in [SimulationStatus.QUEUED, SimulationStatus.RUNNING]:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot cancel simulation in status: {sim.status}",
        )

    sim.status = SimulationStatus.CANCELLED
    logger.info("Simulation cancelled", simulation_id=str(simulation_id))

    return sim


@router.delete("/{simulation_id}", status_code=204)
async def delete_simulation(
    simulation_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> None:
    """Delete a simulation."""
    if simulation_id not in _simulations:
        raise HTTPException(status_code=404, detail="Simulation not found")

    del _simulations[simulation_id]
    logger.info("Simulation deleted", simulation_id=str(simulation_id))


@router.get("/types", response_model=list[dict[str, Any]])
async def list_simulation_types() -> list[dict[str, Any]]:
    """List available simulation types with descriptions."""
    return [
        {
            "type": SimulationType.CLINICAL_OUTCOME.value,
            "name": "Clinical Outcome Simulation",
            "description": "Simulate patient outcomes based on treatment parameters",
        },
        {
            "type": SimulationType.EPIDEMIOLOGICAL.value,
            "name": "Epidemiological Model",
            "description": "Model disease spread and population-level outcomes",
        },
        {
            "type": SimulationType.DOSE_RESPONSE.value,
            "name": "Dose-Response Analysis",
            "description": "Simulate dose-response relationships",
        },
        {
            "type": SimulationType.PATHWAY_DYNAMICS.value,
            "name": "Pathway Dynamics",
            "description": "Simulate biochemical pathway behavior",
        },
        {
            "type": SimulationType.DRUG_INTERACTION.value,
            "name": "Drug Interaction Model",
            "description": "Model interactions between multiple drugs",
        },
        {
            "type": SimulationType.SURVIVAL_ANALYSIS.value,
            "name": "Survival Analysis",
            "description": "Simulate time-to-event outcomes",
        },
        {
            "type": SimulationType.CUSTOM.value,
            "name": "Custom Simulation",
            "description": "Define custom simulation logic",
        },
    ]
