"""
Ingestion Agent Management API Endpoints

RESTful API for managing ingestion agents, jobs, and scheduling with SQLAlchemy persistence.
"""

from datetime import datetime
from enum import Enum
from typing import Any
from uuid import UUID, uuid4

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.ingestion.base import SourceType
from app.core.database import get_db
from app.core.logging import get_logger
from app.core.auth import AUTH_REQUIRED, get_current_active_user
from app.models.ingestion_job import (
    IngestionJob,
    IngestionJobStatus as IngestionJobStatusModel,
    IngestionSource as IngestionSourceModel,
)
from app.models.user import User

logger = get_logger(__name__)
router = APIRouter(dependencies=AUTH_REQUIRED)


async def _owned_job_or_404(
    db: AsyncSession, job_id: UUID, current_user: User,
) -> IngestionJob:
    """Look up an ingestion job and confirm `current_user` owns it."""
    result = await db.execute(
        select(IngestionJob).where(
            IngestionJob.id == job_id,
            IngestionJob.owner_id == current_user.id,
        )
    )
    job = result.scalar_one_or_none()
    if job is None:
        raise HTTPException(status_code=404, detail="Ingestion job not found")
    return job
# In-memory tracking for agent status and source configs
_agent_tracker: dict[str, dict[str, Any]] = {}
_source_configs: dict[str, dict[str, Any]] = {}


class IngestionPriority(str, Enum):
    """Priority levels for ingestion tasks."""

    CRITICAL = "critical"
    HIGH = "high"
    NORMAL = "normal"
    LOW = "low"


class IngestionJobCreate(BaseModel):
    """Request to create an ingestion job."""

    name: str = Field(default="Ingestion Job", min_length=3, max_length=255)
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
    project_id: UUID | None = None
    config: dict[str, Any] | None = None


class IngestionJobResponse(BaseModel):
    """Response for an ingestion job."""

    job_id: UUID
    name: str
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

    model_config = {"from_attributes": True}


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


def map_source_to_model(source: str) -> IngestionSourceModel:
    """Map source string to model enum."""
    mapping = {
        "pubmed": IngestionSourceModel.PUBMED,
        "clinical_trials": IngestionSourceModel.CLINICAL_TRIALS,
        "biorxiv": IngestionSourceModel.BIORXIV,
        "medrxiv": IngestionSourceModel.MEDRXIV,
        "arxiv": IngestionSourceModel.ARXIV,
        "patents": IngestionSourceModel.PATENT_USPTO,
        "preprint": IngestionSourceModel.BIORXIV,
        "custom_document": IngestionSourceModel.FILE_UPLOAD,
    }
    return mapping.get(source.lower(), IngestionSourceModel.PUBMED)


def job_to_response(job: IngestionJob) -> IngestionJobResponse:
    """Convert IngestionJob model to response."""
    sources = []
    if job.source:
        sources = [job.source.value]
    if job.source_config and "sources" in job.source_config:
        sources = job.source_config["sources"]

    return IngestionJobResponse(
        job_id=job.id,
        name=job.name,
        query=job.query or "",
        sources=sources,
        status=job.status.value,
        priority=job.source_config.get("priority", "normal") if job.source_config else "normal",
        progress=job.progress,
        records_fetched=job.items_fetched,
        records_processed=job.items_processed,
        records_indexed=job.items_indexed,
        records_failed=job.items_failed,
        entities_extracted=job.source_config.get("entities_extracted", 0) if job.source_config else 0,
        relations_extracted=job.source_config.get("relations_extracted", 0) if job.source_config else 0,
        started_at=job.started_at,
        completed_at=job.completed_at,
        created_at=job.created_at,
        error=job.error_message,
    )


@router.post("/jobs", response_model=IngestionJobResponse, status_code=202)
async def create_ingestion_job(
    job: IngestionJobCreate,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> IngestionJobResponse:
    """Create and start a new ingestion job owned by the caller."""
    logger.info(
        "Creating ingestion job",
        query=job.query[:50],
        sources=job.sources,
        priority=job.priority.value,
    )

    # Validate sources
    valid_sources = {s.value for s in SourceType}
    for source in job.sources:
        if source not in valid_sources:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid source type: {source}. Valid types: {list(valid_sources)}",
            )

    db_job = IngestionJob(
        id=uuid4(),
        owner_id=current_user.id,
        name=job.name,
        query=job.query,
        source=map_source_to_model(job.sources[0]) if job.sources else IngestionSourceModel.PUBMED,
        source_config={
            "sources": job.sources,
            "priority": job.priority.value,
            "max_results_per_source": job.max_results_per_source,
            "extract_entities": job.extract_entities,
            "extract_relations": job.extract_relations,
            "index_to_stores": job.index_to_stores,
            "entities_extracted": 0,
            "relations_extracted": 0,
            "config": job.config or {},
        },
        status=IngestionJobStatusModel.PENDING,
        progress=0.0,
        items_found=0,
        items_fetched=0,
        items_processed=0,
        items_indexed=0,
        items_failed=0,
        target_project_id=job.project_id,
        auto_process=1 if job.extract_entities else 0,
        auto_index=1 if job.index_to_stores else 0,
    )

    db.add(db_job)
    await db.commit()
    await db.refresh(db_job)

    # Schedule execution
    if job.schedule_delay_seconds > 0:
        background_tasks.add_task(
            _delayed_ingestion_job,
            db_job.id,
            job,
            job.schedule_delay_seconds,
        )
    else:
        background_tasks.add_task(_execute_ingestion_job, db_job.id, job)

    logger.info("Ingestion job created", job_id=str(db_job.id))
    return job_to_response(db_job)


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
    from app.core.database import async_session_factory

    logger.info("Executing ingestion job", job_id=str(job_id))

    async with async_session_factory() as db:
        query = select(IngestionJob).where(IngestionJob.id == job_id)
        result = await db.execute(query)
        job = result.scalar_one_or_none()

        if not job:
            logger.error("Job not found", job_id=str(job_id))
            return

        job.start_fetching(worker_id="background")
        await db.commit()

        try:
            from app.agents.ingestion.base import SourceType
            from app.agents.ingestion.orchestrator import IngestionOrchestrator

            # Convert source strings to SourceType enums
            source_types = [SourceType(s) for s in config.sources]

            # Track agent status
            for st in source_types:
                _agent_tracker[st.value] = {
                    "status": "running",
                    "current_query": config.query,
                    "records_processed": 0,
                    "last_activity": datetime.utcnow(),
                    "errors_count": 0,
                }

            orchestrator = IngestionOrchestrator(
                sources=source_types,
                parallel=True,
            )

            result = await orchestrator.ingest(
                query=config.query,
                max_results_per_source=config.max_results_per_source,
                extract_entities=config.extract_entities,
                extract_relations=config.extract_relations,
                index_to_stores=config.index_to_stores,
            )

            # Update final metrics
            metrics = result.get("metrics", {})
            job.items_found = metrics.get("total_records_found", 0)
            job.items_fetched = metrics.get("total_records_fetched", 0)
            job.items_processed = metrics.get("total_records_processed", 0)
            job.items_indexed = metrics.get("total_records_indexed", 0)
            job.items_failed = metrics.get("total_records_failed", 0)

            if job.source_config:
                job.source_config["entities_extracted"] = metrics.get("total_entities_extracted", 0)
                job.source_config["relations_extracted"] = metrics.get("total_relations_extracted", 0)

            job.complete()
            await db.commit()

            # Update agent tracker to idle with final counts
            for st in source_types:
                _agent_tracker[st.value] = {
                    "status": "idle",
                    "current_query": None,
                    "records_processed": _agent_tracker.get(st.value, {}).get("records_processed", 0) + job.items_indexed,
                    "last_activity": datetime.utcnow(),
                    "errors_count": _agent_tracker.get(st.value, {}).get("errors_count", 0),
                }

            logger.info(
                "Ingestion job completed",
                job_id=str(job_id),
                records_indexed=job.items_indexed,
            )

        except Exception as e:
            logger.error("Ingestion job failed", job_id=str(job_id), error=str(e))
            job.fail(str(e))
            await db.commit()

            # Update agent tracker with error
            for s in config.sources:
                if s in _agent_tracker:
                    _agent_tracker[s]["status"] = "error"
                    _agent_tracker[s]["errors_count"] = _agent_tracker[s].get("errors_count", 0) + 1
                    _agent_tracker[s]["last_activity"] = datetime.utcnow()


@router.get("/jobs", response_model=IngestionJobListResponse)
async def list_ingestion_jobs(
    status: str | None = None,
    source: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> IngestionJobListResponse:
    """List the caller's ingestion jobs with filtering and pagination."""
    query = select(IngestionJob).where(IngestionJob.owner_id == current_user.id)
    count_query = select(func.count(IngestionJob.id)).where(
        IngestionJob.owner_id == current_user.id
    )

    if status:
        try:
            status_enum = IngestionJobStatusModel(status)
            query = query.where(IngestionJob.status == status_enum)
            count_query = count_query.where(IngestionJob.status == status_enum)
        except ValueError:
            logger.debug("Invalid status filter ignored", status=status)
    if source:
        query = query.where(IngestionJob.source == map_source_to_model(source))
        count_query = count_query.where(IngestionJob.source == map_source_to_model(source))

    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0

    query = query.order_by(desc(IngestionJob.created_at))
    offset = (page - 1) * page_size
    query = query.offset(offset).limit(page_size)

    result = await db.execute(query)
    jobs = result.scalars().all()

    return IngestionJobListResponse(
        items=[job_to_response(j) for j in jobs],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/jobs/{job_id}", response_model=IngestionJobResponse)
async def get_ingestion_job(
    job_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> IngestionJobResponse:
    """Get one of the caller's ingestion jobs by ID."""
    job = await _owned_job_or_404(db, job_id, current_user)
    return job_to_response(job)


@router.post("/jobs/{job_id}/cancel")
async def cancel_ingestion_job(
    job_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> dict[str, Any]:
    """Cancel one of the caller's running or pending ingestion jobs."""
    job = await _owned_job_or_404(db, job_id, current_user)

    if job.is_terminal():
        raise HTTPException(
            status_code=400,
            detail=f"Cannot cancel job in status: {job.status.value}",
        )

    job.cancel()
    await db.commit()

    logger.info("Ingestion job cancelled", job_id=str(job_id))
    return {"status": "cancelled", "job_id": str(job_id)}


@router.post("/jobs/{job_id}/retry")
async def retry_ingestion_job(
    job_id: UUID,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> IngestionJobResponse:
    """Retry one of the caller's failed ingestion jobs."""
    job = await _owned_job_or_404(db, job_id, current_user)

    if job.status != IngestionJobStatusModel.FAILED:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot retry job in status: {job.status.value}",
        )

    # Reset job state
    job.status = IngestionJobStatusModel.PENDING
    job.progress = 0.0
    job.error_message = None
    job.started_at = None
    job.completed_at = None
    job.items_fetched = 0
    job.items_processed = 0
    job.items_indexed = 0
    job.items_failed = 0

    await db.commit()
    await db.refresh(job)

    # Create config from stored job
    config = IngestionJobCreate(
        name=job.name,
        query=job.query or "",
        sources=job.source_config.get("sources", ["pubmed"]) if job.source_config else ["pubmed"],
        priority=IngestionPriority(job.source_config.get("priority", "normal")) if job.source_config else IngestionPriority.NORMAL,
        max_results_per_source=job.source_config.get("max_results_per_source", 100) if job.source_config else 100,
        extract_entities=job.source_config.get("extract_entities", True) if job.source_config else True,
        extract_relations=job.source_config.get("extract_relations", True) if job.source_config else True,
        index_to_stores=job.source_config.get("index_to_stores", True) if job.source_config else True,
        config=job.source_config.get("config") if job.source_config else None,
    )

    background_tasks.add_task(_execute_ingestion_job, job_id, config)

    logger.info("Ingestion job retry scheduled", job_id=str(job_id))
    return job_to_response(job)


@router.delete("/jobs/{job_id}", status_code=204)
async def delete_ingestion_job(
    job_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> None:
    """Delete one of the caller's ingestion jobs."""
    job = await _owned_job_or_404(db, job_id, current_user)
    await db.delete(job)
    await db.commit()
    logger.info("Ingestion job deleted", job_id=str(job_id))


@router.post("/recurring", response_model=RecurringJobResponse)
async def create_recurring_job(
    job: RecurringJobCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> RecurringJobResponse:
    """Create a recurring ingestion job owned by the caller."""
    logger.info(
        "Creating recurring job",
        query=job.query[:50],
        interval_hours=job.interval_hours,
    )

    now = datetime.utcnow()

    db_job = IngestionJob(
        id=uuid4(),
        owner_id=current_user.id,
        name=f"Recurring: {job.query[:30]}",
        query=job.query,
        source=map_source_to_model(job.sources[0]) if job.sources else IngestionSourceModel.PUBMED,
        source_config={
            "sources": job.sources,
            "priority": job.priority.value,
            "max_results_per_source": job.max_results_per_source,
            "interval_hours": job.interval_hours,
            "enabled": job.enabled,
            "run_count": 0,
        },
        status=IngestionJobStatusModel.PENDING,
        is_scheduled=1 if job.enabled else 0,
        schedule_cron=f"0 */{job.interval_hours} * * *",
        next_run_at=now if job.enabled else None,
        target_project_id=None,
    )

    db.add(db_job)
    await db.commit()
    await db.refresh(db_job)

    logger.info("Recurring job created", job_id=str(db_job.id))

    return RecurringJobResponse(
        job_id=db_job.id,
        query=db_job.query or "",
        sources=job.sources,
        interval_hours=job.interval_hours,
        priority=job.priority.value,
        enabled=job.enabled,
        last_run=db_job.last_run_at,
        next_run=db_job.next_run_at,
        run_count=0,
        created_at=db_job.created_at,
    )


@router.get("/recurring", response_model=list[RecurringJobResponse])
async def list_recurring_jobs(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> list[RecurringJobResponse]:
    """List the caller's recurring ingestion jobs."""
    query = select(IngestionJob).where(
        IngestionJob.is_scheduled == 1,
        IngestionJob.owner_id == current_user.id,
    )
    result = await db.execute(query)
    jobs = result.scalars().all()

    responses = []
    for job in jobs:
        config = job.source_config or {}
        responses.append(
            RecurringJobResponse(
                job_id=job.id,
                query=job.query or "",
                sources=config.get("sources", []),
                interval_hours=config.get("interval_hours", 24),
                priority=config.get("priority", "normal"),
                enabled=bool(job.is_scheduled),
                last_run=job.last_run_at,
                next_run=job.next_run_at,
                run_count=config.get("run_count", 0),
                created_at=job.created_at,
            )
        )

    return responses


@router.delete("/recurring/{job_id}")
async def delete_recurring_job(
    job_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> dict[str, Any]:
    """Delete one of the caller's recurring jobs."""
    query = select(IngestionJob).where(
        IngestionJob.id == job_id,
        IngestionJob.is_scheduled == 1,
        IngestionJob.owner_id == current_user.id,
    )
    result = await db.execute(query)
    job = result.scalar_one_or_none()

    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    await db.delete(job)
    await db.commit()

    logger.info("Recurring job deleted", job_id=str(job_id))
    return {"status": "deleted", "job_id": str(job_id)}


@router.patch("/recurring/{job_id}/toggle")
async def toggle_recurring_job(
    job_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> RecurringJobResponse:
    """Enable or disable one of the caller's recurring jobs."""
    query = select(IngestionJob).where(
        IngestionJob.id == job_id,
        IngestionJob.is_scheduled == 1,
        IngestionJob.owner_id == current_user.id,
    )
    result = await db.execute(query)
    job = result.scalar_one_or_none()

    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    enabled = not bool(job.is_scheduled)
    job.is_scheduled = 1 if enabled else 0

    if enabled:
        job.next_run_at = datetime.utcnow()
    else:
        job.next_run_at = None

    if job.source_config:
        job.source_config["enabled"] = enabled

    await db.commit()
    await db.refresh(job)

    config = job.source_config or {}
    logger.info("Recurring job toggled", job_id=str(job_id), enabled=enabled)

    return RecurringJobResponse(
        job_id=job.id,
        query=job.query or "",
        sources=config.get("sources", []),
        interval_hours=config.get("interval_hours", 24),
        priority=config.get("priority", "normal"),
        enabled=enabled,
        last_run=job.last_run_at,
        next_run=job.next_run_at,
        run_count=config.get("run_count", 0),
        created_at=job.created_at,
    )


@router.get("/agents/status", response_model=list[AgentStatusResponse])
async def get_agents_status(
    db: AsyncSession = Depends(get_db),
) -> list[AgentStatusResponse]:
    """Get status of all ingestion agents."""
    statuses = []

    for source_type in SourceType:
        tracked = _agent_tracker.get(source_type.value, {})
        statuses.append(
            AgentStatusResponse(
                agent_type=source_type.value,
                status=tracked.get("status", "idle"),
                current_query=tracked.get("current_query"),
                records_processed=tracked.get("records_processed", 0),
                last_activity=tracked.get("last_activity"),
                rate_limit_remaining=100,
                errors_count=tracked.get("errors_count", 0),
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
    current_user: User = Depends(get_current_active_user),
) -> dict[str, Any]:
    """Upload a custom document for ingestion under the caller's account.

    Accepts a generous whitelist of research-document formats. We check
    both MIME type and filename extension because browsers are wildly
    inconsistent at labelling less-common formats (Safari tends to send
    `application/octet-stream` for .md / .rtf / .xml; Firefox will
    sometimes use `application/x-download` for .docx). Before this
    double-check, clinicians would hit a 400 "Unsupported file type"
    when dragging in perfectly valid research files.
    """
    logger.info("Document upload received", filename=file.filename)

    # Canonical MIME allow-list. Extensions below cover the same set
    # plus the octet-stream edge cases browsers serve up.
    allowed_types = {
        "application/pdf",
        "text/plain",
        "text/csv",
        "text/tab-separated-values",
        "text/markdown",
        "text/x-markdown",
        "text/html",
        "text/xml",
        "application/xml",
        "application/json",
        "application/rtf",
        "text/rtf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "application/vnd.ms-powerpoint",
        "application/vnd.oasis.opendocument.text",
        "application/vnd.oasis.opendocument.spreadsheet",
        "application/vnd.oasis.opendocument.presentation",
    }
    allowed_extensions = {
        ".pdf", ".txt", ".csv", ".tsv", ".md", ".markdown", ".mdx",
        ".json", ".jsonl", ".ndjson", ".xml", ".html", ".htm",
        ".rtf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
        ".odt", ".ods", ".odp", ".log", ".bib",
    }

    filename = file.filename or ""
    ext = filename.lower().rsplit(".", 1)
    ext = f".{ext[1]}" if len(ext) == 2 else ""
    mime_ok = file.content_type in allowed_types
    ext_ok = ext in allowed_extensions
    if not (mime_ok or ext_ok):
        raise HTTPException(
            status_code=400,
            detail=(
                f"Unsupported file type: {file.content_type or 'unknown'}"
                f" (extension '{ext or '<none>'}'). Supported formats: "
                f"PDF, TXT, CSV, TSV, MD, JSON, XML, HTML, RTF, DOC/DOCX,"
                f" XLS/XLSX, PPT/PPTX, ODT/ODS/ODP."
            ),
        )

    # Read file content
    content = await file.read()

    # Parse authors and keywords
    authors_list = [a.strip() for a in authors.split(",")] if authors else []
    keywords_list = [k.strip() for k in keywords.split(",")] if keywords else []

    # Create ingestion job for the document
    db_job = IngestionJob(
        id=uuid4(),
        owner_id=current_user.id,
        name=f"Document: {title or file.filename}",
        source=IngestionSourceModel.FILE_UPLOAD,
        source_config={
            "filename": file.filename,
            "title": title,
            "authors": authors_list,
            "keywords": keywords_list,
            "content_type": file.content_type,
            "size_bytes": len(content),
        },
        status=IngestionJobStatusModel.PENDING,
    )

    db.add(db_job)
    await db.commit()

    # Process in background
    if background_tasks:
        background_tasks.add_task(
            _process_uploaded_document,
            str(db_job.id),
            content,
            file.filename,
            title,
            authors_list,
            keywords_list,
        )

    return {
        "document_id": str(db_job.id),
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
    from app.core.database import async_session_factory

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

        # Update job status
        async with async_session_factory() as db:
            query = select(IngestionJob).where(IngestionJob.id == UUID(doc_id))
            result = await db.execute(query)
            job = result.scalar_one_or_none()
            if job:
                job.complete()
                await db.commit()

        logger.info("Document processed", doc_id=doc_id)

    except Exception as e:
        logger.error("Document processing failed", doc_id=doc_id, error=str(e))

        async with async_session_factory() as db:
            query = select(IngestionJob).where(IngestionJob.id == UUID(doc_id))
            result = await db.execute(query)
            job = result.scalar_one_or_none()
            if job:
                job.fail(str(e))
                await db.commit()


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

    # Persist config in memory
    config_data = config.model_dump()
    config_data["updated_at"] = datetime.utcnow().isoformat()
    _source_configs[source_type] = config_data

    return {
        "status": "updated",
        "source_type": source_type,
        "config": config_data,
    }


@router.get("/sources/{source_type}/config")
async def get_source_config(
    source_type: str,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Get configuration for a data source."""
    try:
        SourceType(source_type)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid source type: {source_type}")

    return {
        "source_type": source_type,
        "config": _source_configs.get(source_type, {}),
    }


@router.get("/queue/stats")
async def get_queue_stats(
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Get ingestion queue statistics."""
    # Get counts by status
    stats = {}
    for status in IngestionJobStatusModel:
        count_query = select(func.count()).select_from(IngestionJob).where(IngestionJob.status == status)
        result = await db.execute(count_query)
        stats[status.value] = result.scalar() or 0

    # Get totals
    totals_query = select(
        func.sum(IngestionJob.items_indexed).label("total_indexed"),
        func.sum(IngestionJob.items_failed).label("total_failed"),
    )
    result = await db.execute(totals_query)
    row = result.first()

    return {
        "pending": stats.get("pending", 0),
        "running": stats.get("fetching", 0) + stats.get("processing", 0) + stats.get("indexing", 0),
        "completed": stats.get("completed", 0) + stats.get("partial", 0),
        "failed": stats.get("failed", 0),
        "total_indexed": row.total_indexed or 0 if row else 0,
        "total_failed": row.total_failed or 0 if row else 0,
    }
