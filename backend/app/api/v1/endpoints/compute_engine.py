"""
Unified Compute Engine API — All biomedical numeric computation domains.

Provides a single gateway to the full computation lab:
- Medical Imaging (DICOM/NIfTI processing, segmentation, volumetrics)
- Electrophysiology (EEG/ECG signal processing, filtering, spectral analysis)
- Genomics (sequence alignment, expression analysis, enrichment)
- Biomechanics (motion capture, kinematics, inverse dynamics)
- Pharmacokinetics (ODE solver, compartmental models, dosing)
- Statistics (exact tests, corrections, bootstrap, Bayesian)
- Simulation (Monte Carlo with sensitivity analysis)
"""

from __future__ import annotations

import time
from typing import Any
from uuid import UUID, uuid4

from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel, Field

from app.core.logging import get_logger
from app.compute.types import (
    ComputeDomain,
    ComputeRequest,
    ComputeResult,
    ComputeStatus,
    DataFormat,
    FigureFormat,
)

logger = get_logger(__name__)
router = APIRouter(prefix="/compute-engine", tags=["compute-engine"])


# ── Request / Response Schemas ───────────────────────────────────


class ComputeExecuteRequest(BaseModel):
    """Request to execute a computation."""

    domain: ComputeDomain
    operation: str
    parameters: dict[str, Any] = Field(default_factory=dict)
    data: dict[str, Any] | None = None
    data_format: DataFormat | None = None
    options: dict[str, Any] = Field(default_factory=dict)


class ComputeExecuteResponse(BaseModel):
    """Response from a computation execution."""

    request_id: UUID
    domain: str
    operation: str
    status: str
    results: dict[str, Any] = Field(default_factory=dict)
    statistics: list[dict[str, Any]] = Field(default_factory=list)
    descriptive: dict[str, Any] = Field(default_factory=dict)
    figures: list[dict[str, Any]] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    error: str | None = None
    runtime_seconds: float = 0.0
    metadata: dict[str, Any] = Field(default_factory=dict)


class AsyncComputeResponse(BaseModel):
    """Response when a computation is queued for async execution."""

    job_id: UUID
    status: str = "queued"
    message: str


class DomainInfo(BaseModel):
    """Information about a compute domain."""

    domain: str
    operations: list[str]
    description: str


# ── In-memory job storage ────────────────────────────────────────

_compute_jobs: dict[UUID, dict[str, Any]] = {}


# ── Endpoints ────────────────────────────────────────────────────


@router.post("/execute", response_model=ComputeExecuteResponse)
async def execute_computation(request: ComputeExecuteRequest) -> ComputeExecuteResponse:
    """Execute a computation synchronously.

    For short-running computations (< 30s). For longer tasks, use /execute-async.
    """
    from app.compute.engine import ComputeEngine

    engine = ComputeEngine()

    compute_request = ComputeRequest(
        domain=request.domain,
        operation=request.operation,
        parameters=request.parameters,
        data=request.data,
        data_format=request.data_format,
        options=request.options,
    )

    result = await engine.execute(compute_request)

    return ComputeExecuteResponse(
        request_id=result.request_id,
        domain=result.domain.value,
        operation=result.operation,
        status=result.status.value,
        results=result.results,
        statistics=[s.model_dump() for s in result.statistics],
        descriptive={k: v.model_dump() for k, v in result.descriptive.items()},
        figures=[f.model_dump() for f in result.figures],
        warnings=result.warnings,
        error=result.error,
        runtime_seconds=result.runtime_seconds,
        metadata=result.metadata,
    )


@router.post("/execute-async", response_model=AsyncComputeResponse, status_code=202)
async def execute_computation_async(
    request: ComputeExecuteRequest,
    background_tasks: BackgroundTasks,
) -> AsyncComputeResponse:
    """Queue a computation for asynchronous execution.

    Returns immediately with a job_id. Poll /jobs/{job_id} for results.
    """
    job_id = uuid4()
    _compute_jobs[job_id] = {
        "status": "queued",
        "request": request.model_dump(),
        "result": None,
        "created_at": time.time(),
    }

    background_tasks.add_task(_run_async_job, job_id, request)

    return AsyncComputeResponse(
        job_id=job_id,
        status="queued",
        message=f"Computation queued: {request.domain.value}/{request.operation}",
    )


async def _run_async_job(job_id: UUID, request: ComputeExecuteRequest) -> None:
    """Background task to execute a computation."""
    from app.compute.engine import ComputeEngine

    _compute_jobs[job_id]["status"] = "running"

    try:
        engine = ComputeEngine()
        compute_request = ComputeRequest(
            domain=request.domain,
            operation=request.operation,
            parameters=request.parameters,
            data=request.data,
            data_format=request.data_format,
            options=request.options,
        )

        result = await engine.execute(compute_request)

        _compute_jobs[job_id]["status"] = result.status.value
        _compute_jobs[job_id]["result"] = ComputeExecuteResponse(
            request_id=result.request_id,
            domain=result.domain.value,
            operation=result.operation,
            status=result.status.value,
            results=result.results,
            statistics=[s.model_dump() for s in result.statistics],
            descriptive={k: v.model_dump() for k, v in result.descriptive.items()},
            figures=[f.model_dump() for f in result.figures],
            warnings=result.warnings,
            error=result.error,
            runtime_seconds=result.runtime_seconds,
            metadata=result.metadata,
        ).model_dump()

    except Exception as e:
        logger.error(f"Async compute job failed: {e}")
        _compute_jobs[job_id]["status"] = "failed"
        _compute_jobs[job_id]["error"] = str(e)


@router.get("/jobs/{job_id}")
async def get_compute_job(job_id: UUID) -> dict[str, Any]:
    """Get the status and result of an async computation job."""
    if job_id not in _compute_jobs:
        raise HTTPException(status_code=404, detail="Job not found")

    job = _compute_jobs[job_id]
    return {
        "job_id": str(job_id),
        "status": job["status"],
        "result": job.get("result"),
        "error": job.get("error"),
    }


@router.get("/domains", response_model=list[DomainInfo])
async def list_domains() -> list[DomainInfo]:
    """List all available compute domains and their operations."""
    from app.compute.engine import ComputeEngine

    engine = ComputeEngine()
    ops = engine.list_operations()

    descriptions = {
        "imaging": "Medical imaging & neuroimaging — DICOM/NIfTI, segmentation, volumetrics, radiomics, voxel-wise GLM, HRF convolution, RFT correction, functional connectivity, atlas ROI, ICA, DCM",
        "electrophysiology": "Signal processing & cardiovascular — EEG/ECG filtering, PSD, spectrograms, ERP, Pan-Tompkins QRS, ECG delineation, full HRV pipeline, Windkessel hemodynamics, arrhythmia classification, pulse wave analysis",
        "genomics": "Bioinformatics & expression — sequence alignment, negative binomial RNA-seq (DESeq2-equivalent), GSEA, co-expression networks (WGCNA), clustergram, PCA/t-SNE/UMAP, gene set variation, pathway topology",
        "biomechanics": "Movement science & musculoskeletal — motion capture, inverse dynamics, gait analysis, EMG processing, finite element bone analysis, micro-CT morphometry, muscle force estimation, joint stiffness",
        "pharmacokinetics": "PK/PD modeling — ODE solver, compartmental models, dosing optimization, bioequivalence, Michaelis-Menten, systems biology",
        "statistics": "Statistical analysis — exact tests, ANOVA, survival, bootstrap, Bayesian, multiple testing correction, effect sizes",
        "clinical": "Clinical & psychiatry — linear mixed-effects models, clinical rating scales (HAM-D/PANSS/PHQ-9/GAD-7/MADRS/YMRS/CGI), HRV biomarkers, classification with ROC/AUC, factor analysis, repeated measures ANOVA, ICC, Bland-Altman, clinical trial power analysis",
    }

    return [
        DomainInfo(
            domain=domain,
            operations=operations,
            description=descriptions.get(domain, ""),
        )
        for domain, operations in ops.items()
    ]


@router.post("/batch", response_model=list[ComputeExecuteResponse])
async def execute_batch(requests: list[ComputeExecuteRequest]) -> list[ComputeExecuteResponse]:
    """Execute multiple computations in sequence.

    Useful for chaining operations (e.g., load data -> filter -> analyze).
    """
    if len(requests) > 20:
        raise HTTPException(status_code=400, detail="Maximum 20 operations per batch")

    from app.compute.engine import ComputeEngine

    engine = ComputeEngine()
    results = []

    # Shared context: previous results accessible to subsequent operations
    context: dict[str, Any] = {}

    for i, req in enumerate(requests):
        # Inject previous results if referenced
        params = {**req.parameters}
        if "__prev_result__" in params:
            ref = params.pop("__prev_result__")
            if isinstance(ref, int) and 0 <= ref < len(results):
                params["_input_data"] = results[ref].results

        compute_request = ComputeRequest(
            domain=req.domain,
            operation=req.operation,
            parameters=params,
            data=req.data,
            data_format=req.data_format,
            options=req.options,
        )

        result = await engine.execute(compute_request)

        results.append(ComputeExecuteResponse(
            request_id=result.request_id,
            domain=result.domain.value,
            operation=result.operation,
            status=result.status.value,
            results=result.results,
            statistics=[s.model_dump() for s in result.statistics],
            descriptive={k: v.model_dump() for k, v in result.descriptive.items()},
            figures=[f.model_dump() for f in result.figures],
            warnings=result.warnings,
            error=result.error,
            runtime_seconds=result.runtime_seconds,
            metadata=result.metadata,
        ))

    return results


# ── Convenience Shortcuts ────────────────────────────────────────
# These provide domain-specific entry points for common operations.


@router.post("/imaging/{operation}")
async def imaging_shortcut(operation: str, params: dict[str, Any]) -> ComputeExecuteResponse:
    """Shortcut for imaging operations."""
    return await execute_computation(ComputeExecuteRequest(
        domain=ComputeDomain.IMAGING, operation=operation, parameters=params,
    ))


@router.post("/signals/{operation}")
async def signals_shortcut(operation: str, params: dict[str, Any]) -> ComputeExecuteResponse:
    """Shortcut for electrophysiology operations."""
    return await execute_computation(ComputeExecuteRequest(
        domain=ComputeDomain.ELECTROPHYSIOLOGY, operation=operation, parameters=params,
    ))


@router.post("/genomics/{operation}")
async def genomics_shortcut(operation: str, params: dict[str, Any]) -> ComputeExecuteResponse:
    """Shortcut for genomics operations."""
    return await execute_computation(ComputeExecuteRequest(
        domain=ComputeDomain.GENOMICS, operation=operation, parameters=params,
    ))


@router.post("/biomechanics/{operation}")
async def biomechanics_shortcut(operation: str, params: dict[str, Any]) -> ComputeExecuteResponse:
    """Shortcut for biomechanics operations."""
    return await execute_computation(ComputeExecuteRequest(
        domain=ComputeDomain.BIOMECHANICS, operation=operation, parameters=params,
    ))


@router.post("/pharma/{operation}")
async def pharma_shortcut(operation: str, params: dict[str, Any]) -> ComputeExecuteResponse:
    """Shortcut for pharmacokinetics operations."""
    return await execute_computation(ComputeExecuteRequest(
        domain=ComputeDomain.PHARMACOKINETICS, operation=operation, parameters=params,
    ))


@router.post("/stats/{operation}")
async def stats_shortcut(operation: str, params: dict[str, Any]) -> ComputeExecuteResponse:
    """Shortcut for statistics operations."""
    return await execute_computation(ComputeExecuteRequest(
        domain=ComputeDomain.STATISTICS, operation=operation, parameters=params,
    ))


@router.post("/clinical/{operation}")
async def clinical_shortcut(operation: str, params: dict[str, Any]) -> ComputeExecuteResponse:
    """Shortcut for clinical/psychiatry operations."""
    return await execute_computation(ComputeExecuteRequest(
        domain=ComputeDomain.CLINICAL, operation=operation, parameters=params,
    ))
