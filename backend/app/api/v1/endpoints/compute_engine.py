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

from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from app.core.logging import get_logger
from app.core.auth import AUTH_REQUIRED
from app.compute.types import (
    ComputeDomain,
    ComputeRequest,
    DataFormat,
)

logger = get_logger(__name__)
router = APIRouter(prefix="/compute-engine", tags=["compute-engine"], dependencies=AUTH_REQUIRED)
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


# ── File Upload & Ingestion ─────────────────────────────────────


@router.post("/upload")
async def upload_and_parse(file: UploadFile = File(...)) -> dict[str, Any]:
    """Upload a file and auto-parse it into compute-ready data.

    Supports: CSV, Excel, JSON, XML, Parquet, HDF5, MAT, NetCDF, NPY/NPZ,
    EDF/BDF, WAV, DICOM, NIfTI, TIFF, PNG/JPEG, FASTA, FASTQ, VCF, C3D, TRC.

    Returns parsed data with metadata, preview, shape, and column definitions.
    """
    if file.size and file.size > 500 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File exceeds 500MB limit")

    content = await file.read()
    filename = file.filename or "unknown"

    try:
        from app.compute.ingestion import DataIngestionEngine
        result = await DataIngestionEngine.parse(content, filename)
        return result
    except ImportError:
        raise HTTPException(status_code=501, detail="Data ingestion module not available")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"File parse error: {e}")
        raise HTTPException(status_code=422, detail=f"Failed to parse file: {e}")


@router.post("/upload-and-execute")
async def upload_and_execute(
    file: UploadFile = File(...),
    domain: str = Form(...),
    operation: str = Form(...),
    parameters_json: str = Form("{}"),
) -> ComputeExecuteResponse:
    """Upload a file, parse it, and immediately execute a computation.

    The parsed data is merged into the operation parameters automatically.
    """
    import json

    if file.size and file.size > 500 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File exceeds 500MB limit")

    content = await file.read()
    filename = file.filename or "unknown"

    try:
        extra_params = json.loads(parameters_json)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid parameters_json")

    try:
        from app.compute.ingestion import DataIngestionEngine
        parsed = await DataIngestionEngine.parse(content, filename)
    except ImportError:
        raise HTTPException(status_code=501, detail="Data ingestion module not available")
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Failed to parse file: {e}")

    # Merge parsed data into parameters
    merged_params = {**extra_params}
    if "data" in parsed:
        merged_params["_parsed_data"] = parsed["data"]
    if "metadata" in parsed:
        merged_params["_file_metadata"] = parsed["metadata"]

    return await execute_computation(ComputeExecuteRequest(
        domain=ComputeDomain(domain),
        operation=operation,
        parameters=merged_params,
        data_format=DataFormat(parsed["format"]) if parsed.get("format") in [e.value for e in DataFormat] else None,
    ))


@router.get("/schemas")
async def get_operation_schemas() -> dict[str, Any]:
    """Get parameter schemas for all operations (for frontend form generation)."""
    try:
        from app.compute.schemas import OPERATION_SCHEMAS
        return OPERATION_SCHEMAS
    except ImportError:
        return {}


@router.get("/schemas/{domain}/{operation}")
async def get_operation_schema(domain: str, operation: str) -> dict[str, Any]:
    """Get parameter schema for a specific operation."""
    try:
        from app.compute.schemas import OPERATION_SCHEMAS
        key = f"{domain}/{operation}"
        if key not in OPERATION_SCHEMAS:
            raise HTTPException(status_code=404, detail=f"No schema for {key}")
        return OPERATION_SCHEMAS[key]
    except ImportError:
        raise HTTPException(status_code=501, detail="Schemas module not available")


@router.get("/formats")
async def list_supported_formats() -> dict[str, Any]:
    """List all supported file formats with descriptions."""
    return {
        "tabular": {
            "csv": {"extensions": [".csv"], "description": "Comma-separated values with auto-delimiter detection"},
            "excel": {"extensions": [".xlsx", ".xls"], "description": "Microsoft Excel workbook (multi-sheet support)"},
            "json": {"extensions": [".json"], "description": "JSON arrays/objects, nested structures flattened"},
            "xml": {"extensions": [".xml"], "description": "XML with tabular element extraction"},
            "parquet": {"extensions": [".parquet"], "description": "Apache Parquet columnar format"},
        },
        "scientific": {
            "hdf5": {"extensions": [".h5", ".hdf5"], "description": "HDF5 hierarchical data — groups, datasets, attributes"},
            "mat": {"extensions": [".mat"], "description": "MATLAB .mat files (v5 and v7.3/HDF5)"},
            "netcdf": {"extensions": [".nc"], "description": "NetCDF climate/scientific data with dimensions"},
            "npy": {"extensions": [".npy"], "description": "NumPy single array binary"},
            "npz": {"extensions": [".npz"], "description": "NumPy compressed archive of arrays"},
        },
        "biomedical_signals": {
            "edf": {"extensions": [".edf"], "description": "European Data Format — EEG/ECG/PSG multichannel signals"},
            "bdf": {"extensions": [".bdf"], "description": "BioSemi Data Format — 24-bit resolution signals"},
            "wav": {"extensions": [".wav"], "description": "Audio waveform — sample rate + amplitude array"},
        },
        "medical_imaging": {
            "dicom": {"extensions": [".dcm", ".dicom"], "description": "DICOM — medical images with patient/study metadata"},
            "nifti": {"extensions": [".nii", ".nii.gz"], "description": "NIfTI neuroimaging — 3D/4D volumes with affine"},
            "tiff": {"extensions": [".tif", ".tiff"], "description": "TIFF — multi-page stacks, microscopy, micro-CT"},
            "png": {"extensions": [".png"], "description": "PNG image — grayscale or RGB as numpy array"},
            "jpeg": {"extensions": [".jpg", ".jpeg"], "description": "JPEG image"},
        },
        "genomics": {
            "fasta": {"extensions": [".fa", ".fasta", ".fna"], "description": "FASTA sequences with headers"},
            "fastq": {"extensions": [".fq", ".fastq"], "description": "FASTQ sequences with quality scores"},
            "vcf": {"extensions": [".vcf"], "description": "Variant Call Format — genomic variants"},
        },
        "biomechanics": {
            "c3d": {"extensions": [".c3d"], "description": "C3D motion capture — markers + analog channels"},
            "trc": {"extensions": [".trc"], "description": "TRC marker trajectories — tab-delimited"},
        },
    }


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
