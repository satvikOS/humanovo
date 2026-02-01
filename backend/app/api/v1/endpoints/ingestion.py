"""
Ingestion Agent Management API Endpoints

RESTful API for managing ingestion agents, jobs, and scheduling.
"""

from datetime import datetime
from enum import Enum
from typing import Any
from uuid import UUID, uuid4

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.ingestion.base import SourceType
from app.core.database import get_db
from app.core.logging import get_logger

logger = get_logger(__name__)
router = APIRouter()


class IngestionPriority(str, Enum):
    """Priority levels for ingestion tasks."""

    CRITICAL = "critical"
    HIGH = "high"
    NORMAL = "normal"
    LOW = "low"


class IngestionJobCreate(BaseModel):
    """Request to create an ingestion job."""

    query: str = Field(..., min_length=3, max_length=500)
    sources: list[str] = Field(
        default=["pubmed"],
        description="Data sources to ingest from",
    )
    priority: IngestionPriority = Field(default=IngestionPriority.NORMAL)
    max_results_per_source: int = Field(default=100, ge=1, le=1000)
    extract_entities: bool = True
    extract_relations: bool = True
    index_to_stores: bool = True
    schedule_delay_seconds: int = Field(default=0, ge=0, le=86400)
    config: dict[str, Any] | None = None


class IngestionJobResponse(BaseModel):
    """Response for an ingestion job."""

    job_id: UUID
    query: str
    sources: list[str]
    status: str
    priority: str
    progress: float
    records_fetched: int
    records_processed: int
    records_indexed: int
    records_failed: int
    entities_extracted: int
    relations_extracted: int
    started_at: datetime | None
    completed_at: datetime | None
    created_at: datetime
    error: str | None


class IngestionJobListResponse(BaseModel):
    """Paginated list of ingestion jobs."""

    items: list[IngestionJobResponse]
    total: int
    page: int
    page_size: int


class RecurringJobCreate(BaseModel):
    """Request to create a recurring ingestion job."""

    query: str = Field(..., min_length=3, max_length=500)
    sources: list[str] = Field(default=["pubmed"])
    interval_hours: int = Field(default=24, ge=1, le=720)
    priority: IngestionPriority = Field(default=IngestionPriority.LOW)
    max_results_per_source: int = Field(default=50, ge=1, le=500)
    enabled: bool = True


class RecurringJobResponse(BaseModel):
    """Response for a recurring job."""

    job_id: UUID
    query: str
    sources: list[str]
    interval_hours: int
    priority: str
    enabled: bool
    last_run: datetime | None
    next_run: datetime | None
    run_count: int
    created_at: datetime


class AgentStatusResponse(BaseModel):
    """Status of an ingestion agent."""

    agent_type: str
    status: str
    current_query: str | None
    records_processed: int
    last_activity: datetime | None
    rate_limit_remaining: int
    errors_count: int


class SourceConfigUpdate(BaseModel):
    """Configuration update for a data source."""

    source_type: str
    rate_limit_per_minute: int | None = Field(default=None, ge=1, le=100)
    rate_limit_per_hour: int | None = Field(default=None, ge=1, le=5000)
    max_concurrent: int | None = Field(default=None, ge=1, le=10)
    enabled: bool = True


class DocumentUpload(BaseModel):
    """Metadata for document upload."""

    title: str | None = None
    authors: list[str] | None = None
    keywords: list[str] | None = None
    metadata: dict[str, Any] | None = None


# In-memory storage for jobs
_ingestion_jobs: dict[UUID, dict] = {}
_recurring_jobs: dict[UUID, dict] = {}


@router.post("/jobs", response_model=IngestionJobResponse, status_code=202)
async def create_ingestion_job(
    job: IngestionJobCreate,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
) -> IngestionJobResponse:
    """
    Create and start a new ingestion job.

    The job will run in the background and can be monitored via the status endpoint.
    """
    logger.info(
        "Creating ingestion job",
        query=job.query[:50],
        sources=job.sources,
        priority=job.priority.value,
    )

    job_id = uuid4()
    now = datetime.utcnow()

    # Validate sources
    valid_sources = {s.value for s in SourceType}
    for source in job.sources:
        if source not in valid_sources:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid source type: {source}. Valid types: {list(valid_sources)}",
            )

    job_data = {
        "job_id": job_id,
        "query": job.query,
        "sources": job.sources,
        "status": "pending",
        "priority": job.priority.value,
        "progress": 0.0,
        "records_fetched": 0,
        "records_processed": 0,
        "records_indexed": 0,
        "records_failed": 0,
        "entities_extracted": 0,
        "relations_extracted": 0,
        "started_at": None,
        "completed_at": None,
        "created_at": now,
        "error": None,
        "config": job.config or {},
    }

    _ingestion_jobs[job_id] = job_data

    # Schedule execution
    if job.schedule_delay_seconds > 0:
        background_tasks.add_task(
            _delayed_ingestion_job,
            job_id,
            job,
            job.schedule_delay_seconds,
        )
    else:
        background_tasks.add_task(_execute_ingestion_job, job_id, job)

    logger.info("Ingestion job created", job_id=str(job_id))

    return IngestionJobResponse(**job_data)


async def _delayed_ingestion_job(
    job_id: UUID,
    config: IngestionJobCreate,
    delay_seconds: int,
) -> None:
    """Execute ingestion job after delay."""
    import asyncio

    await asyncio.sleep(delay_seconds)
    await _execute_ingestion_job(job_id, config)


async def _execute_ingestion_job(job_id: UUID, config: IngestionJobCreate) -> None:
    """Execute an ingestion job in the background."""
    logger.info("Executing ingestion job", job_id=str(job_id))

    job = _ingestion_jobs[job_id]
    job["status"] = "running"
    job["started_at"] = datetime.utcnow()

    try:
        from app.agents.ingestion.base import SourceType
        from app.agents.ingestion.orchestrator import IngestionOrchestrator

        # Convert source strings to SourceType enums
        source_types = [SourceType(s) for s in config.sources]

        orchestrator = IngestionOrchestrator(
            sources=source_types,
            parallel=True,
        )

        # Set progress callback
        def progress_callback(source: str, state):
            job["records_fetched"] = state.metrics.records_fetched
            job["records_processed"] = state.metrics.records_processed
            job["records_indexed"] = state.metrics.records_indexed
            job["records_failed"] = state.metrics.records_failed
            job["entities_extracted"] = state.metrics.entities_extracted
            job["relations_extracted"] = state.metrics.relations_extracted
            if state.metrics.records_indexed > 0:
                job["progress"] = min(
                    0.95, state.metrics.records_indexed / config.max_results_per_source
                )

        orchestrator.set_progress_callback(progress_callback)

        result = await orchestrator.ingest(
            query=config.query,
            max_results_per_source=config.max_results_per_source,
            extract_entities=config.extract_entities,
            extract_relations=config.extract_relations,
            index_to_stores=config.index_to_stores,
        )

        job["status"] = "completed"
        job["progress"] = 1.0
        job["completed_at"] = datetime.utcnow()

        # Update final metrics
        metrics = result.get("metrics", {})
        job["records_fetched"] = metrics.get("total_records_fetched", 0)
        job["records_processed"] = metrics.get("total_records_processed", 0)
        job["records_indexed"] = metrics.get("total_records_indexed", 0)
        job["records_failed"] = metrics.get("total_records_failed", 0)
        job["entities_extracted"] = metrics.get("total_entities_extracted", 0)
        job["relations_extracted"] = metrics.get("total_relations_extracted", 0)

        logger.info(
            "Ingestion job completed",
            job_id=str(job_id),
            records_indexed=job["records_indexed"],
        )

    except Exception as e:
        logger.error("Ingestion job failed", job_id=str(job_id), error=str(e))
        job["status"] = "failed"
        job["error"] = str(e)
        job["completed_at"] = datetime.utcnow()


@router.get("/jobs", response_model=IngestionJobListResponse)
async def list_ingestion_jobs(
    status: str | None = None,
    source: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
) -> IngestionJobListResponse:
    """List ingestion jobs with filtering and pagination."""
    items = list(_ingestion_jobs.values())

    # Apply filters
    if status:
        items = [j for j in items if j["status"] == status]
    if source:
        items = [j for j in items if source in j["sources"]]

    # Sort by created_at descending
    items.sort(key=lambda x: x["created_at"], reverse=True)

    # Paginate
    total = len(items)
    start = (page - 1) * page_size
    end = start + page_size

    return IngestionJobListResponse(
        items=[IngestionJobResponse(**j) for j in items[start:end]],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/jobs/{job_id}", response_model=IngestionJobResponse)
async def get_ingestion_job(
    job_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> IngestionJobResponse:
    """Get a specific ingestion job by ID."""
    if job_id not in _ingestion_jobs:
        raise HTTPException(status_code=404, detail="Job not found")

    return IngestionJobResponse(**_ingestion_jobs[job_id])


@router.post("/jobs/{job_id}/cancel")
async def cancel_ingestion_job(
    job_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Cancel a running or pending ingestion job."""
    if job_id not in _ingestion_jobs:
        raise HTTPException(status_code=404, detail="Job not found")

    job = _ingestion_jobs[job_id]

    if job["status"] not in ["pending", "running"]:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot cancel job in status: {job['status']}",
        )

    job["status"] = "cancelled"
    job["completed_at"] = datetime.utcnow()

    logger.info("Ingestion job cancelled", job_id=str(job_id))

    return {"status": "cancelled", "job_id": str(job_id)}


@router.post("/jobs/{job_id}/retry")
async def retry_ingestion_job(
    job_id: UUID,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
) -> IngestionJobResponse:
    """Retry a failed ingestion job."""
    if job_id not in _ingestion_jobs:
        raise HTTPException(status_code=404, detail="Job not found")

    job = _ingestion_jobs[job_id]

    if job["status"] != "failed":
        raise HTTPException(
            status_code=400,
            detail=f"Cannot retry job in status: {job['status']}",
        )

    # Reset job state
    job["status"] = "pending"
    job["progress"] = 0.0
    job["error"] = None
    job["started_at"] = None
    job["completed_at"] = None

    # Create config from stored job
    config = IngestionJobCreate(
        query=job["query"],
        sources=job["sources"],
        priority=IngestionPriority(job["priority"]),
        config=job.get("config"),
    )

    background_tasks.add_task(_execute_ingestion_job, job_id, config)

    logger.info("Ingestion job retry scheduled", job_id=str(job_id))

    return IngestionJobResponse(**job)


@router.post("/recurring", response_model=RecurringJobResponse)
async def create_recurring_job(
    job: RecurringJobCreate,
    db: AsyncSession = Depends(get_db),
) -> RecurringJobResponse:
    """Create a recurring ingestion job."""
    logger.info(
        "Creating recurring job",
        query=job.query[:50],
        interval_hours=job.interval_hours,
    )

    job_id = uuid4()
    now = datetime.utcnow()

    job_data = {
        "job_id": job_id,
        "query": job.query,
        "sources": job.sources,
        "interval_hours": job.interval_hours,
        "priority": job.priority.value,
        "enabled": job.enabled,
        "last_run": None,
        "next_run": now if job.enabled else None,
        "run_count": 0,
        "created_at": now,
        "max_results": job.max_results_per_source,
    }

    _recurring_jobs[job_id] = job_data

    # Register with scheduler
    try:
        from app.agents.ingestion.base import SourceType
        from app.agents.ingestion.scheduler import TaskPriority, get_job_scheduler

        priority_map = {
            "critical": TaskPriority.CRITICAL,
            "high": TaskPriority.HIGH,
            "normal": TaskPriority.NORMAL,
            "low": TaskPriority.LOW,
        }

        job_scheduler = get_job_scheduler()

        for source in job.sources:
            await job_scheduler.add_recurring_job(
                agent_type=SourceType(source),
                query=job.query,
                interval_seconds=job.interval_hours * 3600,
                priority=priority_map.get(job.priority.value, TaskPriority.NORMAL),
                config={"max_results": job.max_results_per_source},
                start_immediately=job.enabled,
            )

    except Exception as e:
        logger.warning("Failed to register with scheduler", error=str(e))

    logger.info("Recurring job created", job_id=str(job_id))

    return RecurringJobResponse(**job_data)


@router.get("/recurring", response_model=list[RecurringJobResponse])
async def list_recurring_jobs(
    db: AsyncSession = Depends(get_db),
) -> list[RecurringJobResponse]:
    """List all recurring ingestion jobs."""
    return [RecurringJobResponse(**j) for j in _recurring_jobs.values()]


@router.delete("/recurring/{job_id}")
async def delete_recurring_job(
    job_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Delete a recurring job."""
    if job_id not in _recurring_jobs:
        raise HTTPException(status_code=404, detail="Job not found")

    del _recurring_jobs[job_id]

    logger.info("Recurring job deleted", job_id=str(job_id))

    return {"status": "deleted", "job_id": str(job_id)}


@router.patch("/recurring/{job_id}/toggle")
async def toggle_recurring_job(
    job_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> RecurringJobResponse:
    """Enable or disable a recurring job."""
    if job_id not in _recurring_jobs:
        raise HTTPException(status_code=404, detail="Job not found")

    job = _recurring_jobs[job_id]
    job["enabled"] = not job["enabled"]

    if job["enabled"]:
        job["next_run"] = datetime.utcnow()
    else:
        job["next_run"] = None

    logger.info(
        "Recurring job toggled",
        job_id=str(job_id),
        enabled=job["enabled"],
    )

    return RecurringJobResponse(**job)


@router.get("/agents/status", response_model=list[AgentStatusResponse])
async def get_agents_status(
    db: AsyncSession = Depends(get_db),
) -> list[AgentStatusResponse]:
    """Get status of all ingestion agents."""
    statuses = []

    for source_type in SourceType:
        statuses.append(
            AgentStatusResponse(
                agent_type=source_type.value,
                status="idle",  # Would be populated from actual agent state
                current_query=None,
                records_processed=0,
                last_activity=None,
                rate_limit_remaining=100,
                errors_count=0,
            )
        )

    return statuses


@router.post("/documents/upload")
async def upload_document(
    file: UploadFile = File(...),
    title: str | None = None,
    authors: str | None = None,
    keywords: str | None = None,
    background_tasks: BackgroundTasks = None,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """
    Upload a custom document for ingestion.

    Supports PDF, TXT, DOCX, and other common formats.
    """
    logger.info("Document upload received", filename=file.filename)

    # Validate file type
    allowed_types = {
        "application/pdf",
        "text/plain",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/msword",
    }

    if file.content_type not in allowed_types:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type: {file.content_type}",
        )

    # Read file content
    content = await file.read()

    # Parse authors and keywords
    authors_list = [a.strip() for a in authors.split(",")] if authors else []
    keywords_list = [k.strip() for k in keywords.split(",")] if keywords else []

    # Create document ID
    doc_id = str(uuid4())

    # Process in background
    if background_tasks:
        background_tasks.add_task(
            _process_uploaded_document,
            doc_id,
            content,
            file.filename,
            title,
            authors_list,
            keywords_list,
        )

    return {
        "document_id": doc_id,
        "filename": file.filename,
        "size_bytes": len(content),
        "status": "processing",
    }


async def _process_uploaded_document(
    doc_id: str,
    content: bytes,
    filename: str,
    title: str | None,
    authors: list[str],
    keywords: list[str],
) -> None:
    """Process an uploaded document."""
    try:
        from app.agents.ingestion.orchestrator import IngestionOrchestrator

        orchestrator = IngestionOrchestrator()
        await orchestrator.add_custom_document(
            content=content,
            filename=filename,
            metadata={
                "title": title,
                "authors": authors,
                "keywords": keywords,
            },
        )

        logger.info("Document processed", doc_id=doc_id)

    except Exception as e:
        logger.error("Document processing failed", doc_id=doc_id, error=str(e))


@router.get("/sources")
async def list_available_sources(
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """List available data sources and their configurations."""
    sources = []

    for source_type in SourceType:
        sources.append(
            {
                "type": source_type.value,
                "name": source_type.name.replace("_", " ").title(),
                "description": _get_source_description(source_type),
                "enabled": True,
                "rate_limits": {
                    "per_minute": 30,
                    "per_hour": 1000,
                },
            }
        )

    return {"sources": sources}


def _get_source_description(source_type: SourceType) -> str:
    """Get description for a source type."""
    descriptions = {
        SourceType.PUBMED: "NCBI PubMed database of biomedical literature",
        SourceType.CLINICAL_TRIALS: "ClinicalTrials.gov database of clinical studies",
        SourceType.PATENTS: "USPTO and EPO patent databases",
        SourceType.PREPRINT: "bioRxiv and medRxiv preprint servers",
        SourceType.CUSTOM_DOCUMENT: "User-uploaded custom documents",
    }
    return descriptions.get(source_type, "")


@router.put("/sources/{source_type}/config")
async def update_source_config(
    source_type: str,
    config: SourceConfigUpdate,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Update configuration for a data source."""
    logger.info("Updating source config", source_type=source_type)

    # Validate source type
    try:
        SourceType(source_type)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid source type: {source_type}")

    # Would update actual configuration here

    return {
        "status": "updated",
        "source_type": source_type,
        "config": config.model_dump(),
    }


@router.get("/queue/stats")
async def get_queue_stats(
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Get ingestion queue statistics."""
    try:
        from app.agents.ingestion.scheduler import get_scheduler

        scheduler = get_scheduler()
        return scheduler.get_queue_stats()

    except Exception as e:
        logger.error("Failed to get queue stats", error=str(e))
        return {
            "pending": 0,
            "running": 0,
            "completed": 0,
            "failed": 0,
            "error": str(e),
        }
