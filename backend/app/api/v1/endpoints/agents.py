"""
Agents API Endpoints

Manage and interact with AI agents with SQLAlchemy persistence.
"""

from datetime import datetime
from enum import Enum
from typing import Any
from uuid import UUID, uuid4

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.logging import get_logger
from app.models.agent_task import (
    AgentTask,
    AgentTaskStatus as AgentTaskStatusModel,
    AgentTaskType as AgentTaskTypeModel,
)

logger = get_logger(__name__)
router = APIRouter()


class AgentType(str, Enum):
    """Types of AI agents."""

    CONTROLLER = "controller"
    SEARCH = "search"
    EXTRACTION = "extraction"
    REASONING = "reasoning"
    VERIFICATION = "verification"
    SIMULATION = "simulation"
    REPORTING = "reporting"


class AgentStatus(str, Enum):
    """Status of an agent task."""

    PENDING = "pending"
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"
    RETRYING = "retrying"


class AgentTaskCreate(BaseModel):
    """Schema for creating an agent task."""

    project_id: UUID
    name: str = Field(default="Agent Task", min_length=3, max_length=255)
    task_type: str = Field(..., description="Type of task to perform")
    query: str = Field(..., min_length=5, max_length=2000)
    context: dict[str, Any] = Field(default_factory=dict)
    max_iterations: int = Field(default=10, ge=1, le=50)
    timeout_seconds: int = Field(default=120, ge=30, le=600)
    priority: int = Field(default=5, ge=1, le=10)


class AgentStepLog(BaseModel):
    """Log entry for an agent step."""

    step_number: int
    agent_type: AgentType
    action: str
    input_summary: str | None
    output_summary: str | None
    tool_calls: list[str] = Field(default_factory=list)
    duration_ms: int
    timestamp: datetime


class AgentTaskResponse(BaseModel):
    """Schema for agent task response."""

    id: UUID
    project_id: UUID
    name: str
    task_type: str
    query: str
    status: AgentStatus
    progress: float = Field(..., ge=0, le=1)
    result: dict[str, Any] | None
    error: str | None
    priority: int
    retry_count: int
    tokens_used: int
    api_calls_made: int
    cost_usd: float
    started_at: datetime | None
    completed_at: datetime | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class AgentTaskListResponse(BaseModel):
    """Schema for paginated agent task list."""

    items: list[AgentTaskResponse]
    total: int
    page: int
    page_size: int


class AgentCapabilities(BaseModel):
    """Capabilities of an agent type."""

    agent_type: AgentType
    name: str
    description: str
    available_tools: list[str]
    max_parallel: int


class SearchAgentRequest(BaseModel):
    """Request for search agent."""

    query: str = Field(..., min_length=3, max_length=500)
    sources: list[str] = Field(
        default=["google", "pubmed"],
        description="Search sources to use",
    )
    max_results: int = Field(default=10, ge=1, le=50)
    include_snippets: bool = True


class SearchResult(BaseModel):
    """A single search result."""

    title: str
    url: str
    snippet: str | None
    source: str
    relevance_score: float


class SearchAgentResponse(BaseModel):
    """Response from search agent."""

    query: str
    results: list[SearchResult]
    sources_searched: list[str]
    total_results: int


def task_to_response(task: AgentTask) -> AgentTaskResponse:
    """Convert an AgentTask model to response."""
    return AgentTaskResponse(
        id=task.id,
        project_id=task.project_id,
        name=task.name,
        task_type=task.task_type.value if task.task_type else "custom",
        query=task.input_data.get("query", "") if task.input_data else "",
        status=AgentStatus(task.status.value),
        progress=task.progress,
        result=task.output_data,
        error=task.error_message,
        priority=task.priority,
        retry_count=task.retry_count,
        tokens_used=task.tokens_used or 0,
        api_calls_made=task.api_calls_made or 0,
        cost_usd=task.cost_usd or 0.0,
        started_at=task.started_at,
        completed_at=task.completed_at,
        created_at=task.created_at,
        updated_at=task.updated_at,
    )


def map_task_type(task_type: str) -> AgentTaskTypeModel:
    """Map string task type to model enum."""
    mapping = {
        "search": AgentTaskTypeModel.LITERATURE_SEARCH,
        "hypothesis": AgentTaskTypeModel.HYPOTHESIS_GENERATION,
        "evidence": AgentTaskTypeModel.EVIDENCE_ANALYSIS,
        "simulation": AgentTaskTypeModel.SIMULATION_RUN,
        "ingestion": AgentTaskTypeModel.DATA_INGESTION,
        "extraction": AgentTaskTypeModel.ENTITY_EXTRACTION,
        "knowledge": AgentTaskTypeModel.KNOWLEDGE_GRAPH_UPDATE,
        "rag": AgentTaskTypeModel.RAG_INDEXING,
        "validation": AgentTaskTypeModel.VALIDATION,
        "summarization": AgentTaskTypeModel.SUMMARIZATION,
    }
    return mapping.get(task_type.lower(), AgentTaskTypeModel.CUSTOM)


@router.post("/tasks", response_model=AgentTaskResponse, status_code=202)
async def create_agent_task(
    task: AgentTaskCreate,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
) -> AgentTaskResponse:
    """Create and start a new agent task."""
    logger.info(
        "Creating agent task",
        task_type=task.task_type,
        project_id=str(task.project_id),
    )

    db_task = AgentTask(
        id=uuid4(),
        project_id=task.project_id,
        name=task.name,
        task_type=map_task_type(task.task_type),
        status=AgentTaskStatusModel.PENDING,
        progress=0.0,
        input_data={
            "query": task.query,
            "context": task.context,
            "max_iterations": task.max_iterations,
        },
        priority=task.priority,
        timeout_seconds=task.timeout_seconds,
    )

    db.add(db_task)
    await db.commit()
    await db.refresh(db_task)

    # Queue task execution
    background_tasks.add_task(
        _execute_agent_task,
        db_task.id,
        task,
    )

    logger.info("Agent task created", task_id=str(db_task.id))
    return task_to_response(db_task)


async def _execute_agent_task(task_id: UUID, config: AgentTaskCreate) -> None:
    """Execute an agent task in the background."""
    from app.core.database import async_session_factory

    logger.info("Executing agent task", task_id=str(task_id))

    async with async_session_factory() as db:
        query = select(AgentTask).where(AgentTask.id == task_id)
        result = await db.execute(query)
        task = result.scalar_one_or_none()

        if not task:
            logger.error("Task not found", task_id=str(task_id))
            return

        task.start(agent_id="controller", worker_id="background")
        await db.commit()

        try:
            from app.agents.controller import ControllerAgent

            controller = ControllerAgent(
                max_iterations=config.max_iterations,
                timeout_seconds=config.timeout_seconds,
            )

            result = await controller.execute(
                query=config.query,
                context=config.context,
                progress_callback=lambda p, s: _update_task_progress_db(task_id, p),
            )

            task.complete(result)
            await db.commit()

            logger.info("Agent task completed", task_id=str(task_id))

        except Exception as e:
            logger.error("Agent task failed", task_id=str(task_id), error=str(e))
            task.fail(str(e))
            await db.commit()


async def _update_task_progress_db(task_id: UUID, progress: float) -> None:
    """Update task progress in database."""
    from app.core.database import async_session_factory

    try:
        async with async_session_factory() as db:
            query = select(AgentTask).where(AgentTask.id == task_id)
            result = await db.execute(query)
            task = result.scalar_one_or_none()

            if task:
                task.update_progress(progress)
                await db.commit()
    except Exception as e:
        logger.warning(f"Failed to update task progress: {e}")


@router.get("/tasks", response_model=AgentTaskListResponse)
async def list_agent_tasks(
    project_id: UUID | None = None,
    status: AgentStatus | None = None,
    task_type: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
) -> AgentTaskListResponse:
    """List agent tasks with filtering and pagination."""
    # Build query
    query = select(AgentTask)

    # Apply filters
    if project_id:
        query = query.where(AgentTask.project_id == project_id)
    if status:
        query = query.where(AgentTask.status == AgentTaskStatusModel(status.value))
    if task_type:
        query = query.where(AgentTask.task_type == map_task_type(task_type))

    # Get total count
    count_query = select(func.count()).select_from(AgentTask)
    if project_id:
        count_query = count_query.where(AgentTask.project_id == project_id)
    if status:
        count_query = count_query.where(AgentTask.status == AgentTaskStatusModel(status.value))
    if task_type:
        count_query = count_query.where(AgentTask.task_type == map_task_type(task_type))

    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0

    # Sort by created_at descending
    query = query.order_by(desc(AgentTask.created_at))

    # Paginate
    offset = (page - 1) * page_size
    query = query.offset(offset).limit(page_size)

    result = await db.execute(query)
    tasks = result.scalars().all()

    return AgentTaskListResponse(
        items=[task_to_response(t) for t in tasks],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/tasks/{task_id}", response_model=AgentTaskResponse)
async def get_agent_task(
    task_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> AgentTaskResponse:
    """Get a specific agent task by ID."""
    query = select(AgentTask).where(AgentTask.id == task_id)
    result = await db.execute(query)
    task = result.scalar_one_or_none()

    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    return task_to_response(task)


@router.post("/tasks/{task_id}/cancel", response_model=AgentTaskResponse)
async def cancel_agent_task(
    task_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> AgentTaskResponse:
    """Cancel a running agent task."""
    query = select(AgentTask).where(AgentTask.id == task_id)
    result = await db.execute(query)
    task = result.scalar_one_or_none()

    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    if task.is_terminal():
        raise HTTPException(
            status_code=400,
            detail=f"Cannot cancel task in status: {task.status.value}",
        )

    task.cancel()
    await db.commit()
    await db.refresh(task)

    logger.info("Agent task cancelled", task_id=str(task_id))
    return task_to_response(task)


@router.post("/tasks/{task_id}/retry", response_model=AgentTaskResponse)
async def retry_agent_task(
    task_id: UUID,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
) -> AgentTaskResponse:
    """Retry a failed agent task."""
    query = select(AgentTask).where(AgentTask.id == task_id)
    result = await db.execute(query)
    task = result.scalar_one_or_none()

    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    if not task.can_retry():
        raise HTTPException(
            status_code=400,
            detail=f"Cannot retry task: status={task.status.value}, retries={task.retry_count}/{task.max_retries}",
        )

    task.retry()
    await db.commit()
    await db.refresh(task)

    # Re-queue task
    config = AgentTaskCreate(
        project_id=task.project_id,
        name=task.name,
        task_type=task.task_type.value,
        query=task.input_data.get("query", ""),
        context=task.input_data.get("context", {}),
        max_iterations=task.input_data.get("max_iterations", 10),
        timeout_seconds=task.timeout_seconds,
        priority=task.priority,
    )
    background_tasks.add_task(_execute_agent_task, task.id, config)

    logger.info("Agent task retried", task_id=str(task_id), retry_count=task.retry_count)
    return task_to_response(task)


@router.delete("/tasks/{task_id}", status_code=204)
async def delete_agent_task(
    task_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> None:
    """Delete an agent task."""
    query = select(AgentTask).where(AgentTask.id == task_id)
    result = await db.execute(query)
    task = result.scalar_one_or_none()

    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    await db.delete(task)
    await db.commit()
    logger.info("Agent task deleted", task_id=str(task_id))


@router.post("/search", response_model=SearchAgentResponse)
async def run_search_agent(
    request: SearchAgentRequest,
    db: AsyncSession = Depends(get_db),
) -> SearchAgentResponse:
    """Run the search agent synchronously for quick searches."""
    logger.info("Running search agent", query=request.query, sources=request.sources)

    try:
        from app.agents.search_agent import SearchAgent

        agent = SearchAgent()
        results = await agent.search(
            query=request.query,
            sources=request.sources,
            max_results=request.max_results,
            include_snippets=request.include_snippets,
        )

        return SearchAgentResponse(
            query=request.query,
            results=results,
            sources_searched=request.sources,
            total_results=len(results),
        )
    except Exception as e:
        logger.error(f"Search agent failed: {e}")
        return SearchAgentResponse(
            query=request.query,
            results=[],
            sources_searched=request.sources,
            total_results=0,
        )


@router.get("/capabilities", response_model=list[AgentCapabilities])
async def list_agent_capabilities() -> list[AgentCapabilities]:
    """List all available agent types and their capabilities."""
    return [
        AgentCapabilities(
            agent_type=AgentType.CONTROLLER,
            name="Controller Agent",
            description="Orchestrates other agents, decomposes tasks, and aggregates results",
            available_tools=["task_decomposition", "agent_coordination", "result_aggregation"],
            max_parallel=1,
        ),
        AgentCapabilities(
            agent_type=AgentType.SEARCH,
            name="Search Agent",
            description="Searches PubMed, ClinicalTrials.gov, and other open biomedical sources",
            available_tools=["pubmed_search", "clinical_trials_search"],
            max_parallel=5,
        ),
        AgentCapabilities(
            agent_type=AgentType.EXTRACTION,
            name="Extraction Agent",
            description="Extracts entities, relations, and key information from text",
            available_tools=["ner", "relation_extraction", "summarization"],
            max_parallel=3,
        ),
        AgentCapabilities(
            agent_type=AgentType.REASONING,
            name="Reasoning Agent",
            description="Synthesizes information and generates hypotheses using LLMs",
            available_tools=["llm_reasoning", "context_retrieval", "hypothesis_generation"],
            max_parallel=2,
        ),
        AgentCapabilities(
            agent_type=AgentType.VERIFICATION,
            name="Verification Agent",
            description="Verifies claims against knowledge graph and finds contradictions",
            available_tools=["kg_query", "fact_check", "contradiction_detection"],
            max_parallel=2,
        ),
        AgentCapabilities(
            agent_type=AgentType.SIMULATION,
            name="Simulation Agent",
            description="Configures and runs Monte Carlo simulations",
            available_tools=["simulation_setup", "monte_carlo", "result_analysis"],
            max_parallel=1,
        ),
        AgentCapabilities(
            agent_type=AgentType.REPORTING,
            name="Reporting Agent",
            description="Compiles results into structured reports with citations",
            available_tools=["report_generation", "citation_formatting", "visualization"],
            max_parallel=1,
        ),
    ]


@router.get("/stats", response_model=dict)
async def get_agent_stats(
    project_id: UUID | None = None,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Get agent task statistics."""
    # Get counts by status
    status_counts = {}
    for status in AgentTaskStatusModel:
        count_query = select(func.count()).select_from(AgentTask).where(AgentTask.status == status)
        if project_id:
            count_query = count_query.where(AgentTask.project_id == project_id)
        result = await db.execute(count_query)
        status_counts[status.value] = result.scalar() or 0

    # Get total cost and tokens
    totals_query = select(
        func.sum(AgentTask.tokens_used).label("total_tokens"),
        func.sum(AgentTask.api_calls_made).label("total_api_calls"),
        func.sum(AgentTask.cost_usd).label("total_cost"),
    )
    if project_id:
        totals_query = totals_query.where(AgentTask.project_id == project_id)

    result = await db.execute(totals_query)
    row = result.first()

    return {
        "status_counts": status_counts,
        "total_tasks": sum(status_counts.values()),
        "total_tokens": row.total_tokens or 0 if row else 0,
        "total_api_calls": row.total_api_calls or 0 if row else 0,
        "total_cost_usd": row.total_cost or 0.0 if row else 0.0,
    }
