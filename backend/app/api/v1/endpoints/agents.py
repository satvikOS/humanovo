"""
Agents API Endpoints

Manage and interact with AI agents.
"""

from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.logging import get_logger

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
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class AgentTaskCreate(BaseModel):
    """Schema for creating an agent task."""

    project_id: UUID
    task_type: str = Field(..., description="Type of task to perform")
    query: str = Field(..., min_length=5, max_length=2000)
    context: Dict[str, Any] = Field(default_factory=dict)
    max_iterations: int = Field(default=10, ge=1, le=50)
    timeout_seconds: int = Field(default=120, ge=30, le=600)


class AgentStepLog(BaseModel):
    """Log entry for an agent step."""

    step_number: int
    agent_type: AgentType
    action: str
    input_summary: Optional[str]
    output_summary: Optional[str]
    tool_calls: List[str] = Field(default_factory=list)
    duration_ms: int
    timestamp: datetime


class AgentTaskResponse(BaseModel):
    """Schema for agent task response."""

    id: UUID
    project_id: UUID
    task_type: str
    query: str
    status: AgentStatus
    progress: float = Field(..., ge=0, le=1)
    current_step: int
    max_iterations: int
    result: Optional[Dict[str, Any]]
    error: Optional[str]
    steps: List[AgentStepLog]
    started_at: Optional[datetime]
    completed_at: Optional[datetime]
    created_at: datetime


class AgentTaskListResponse(BaseModel):
    """Schema for paginated agent task list."""

    items: List[AgentTaskResponse]
    total: int
    page: int
    page_size: int


class AgentCapabilities(BaseModel):
    """Capabilities of an agent type."""

    agent_type: AgentType
    name: str
    description: str
    available_tools: List[str]
    max_parallel: int


class SearchAgentRequest(BaseModel):
    """Request for search agent."""

    query: str = Field(..., min_length=3, max_length=500)
    sources: List[str] = Field(
        default=["google", "pubmed"],
        description="Search sources to use",
    )
    max_results: int = Field(default=10, ge=1, le=50)
    include_snippets: bool = True


class SearchResult(BaseModel):
    """A single search result."""

    title: str
    url: str
    snippet: Optional[str]
    source: str
    relevance_score: float


class SearchAgentResponse(BaseModel):
    """Response from search agent."""

    query: str
    results: List[SearchResult]
    sources_searched: List[str]
    total_results: int


# In-memory storage
_agent_tasks: dict = {}


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

    task_id = uuid4()
    now = datetime.utcnow()

    task_data = AgentTaskResponse(
        id=task_id,
        project_id=task.project_id,
        task_type=task.task_type,
        query=task.query,
        status=AgentStatus.PENDING,
        progress=0.0,
        current_step=0,
        max_iterations=task.max_iterations,
        result=None,
        error=None,
        steps=[],
        started_at=None,
        completed_at=None,
        created_at=now,
    )

    _agent_tasks[task_id] = task_data

    # Queue task execution
    background_tasks.add_task(
        _execute_agent_task,
        task_id,
        task,
    )

    logger.info("Agent task created", task_id=str(task_id))
    return task_data


async def _execute_agent_task(task_id: UUID, config: AgentTaskCreate) -> None:
    """Execute an agent task in the background."""
    logger.info("Executing agent task", task_id=str(task_id))

    task = _agent_tasks[task_id]
    task.status = AgentStatus.RUNNING
    task.started_at = datetime.utcnow()

    try:
        from app.agents.controller import ControllerAgent

        controller = ControllerAgent(
            max_iterations=config.max_iterations,
            timeout_seconds=config.timeout_seconds,
        )

        result = await controller.execute(
            query=config.query,
            context=config.context,
            progress_callback=lambda p, s: _update_task_progress(task_id, p, s),
        )

        task.status = AgentStatus.COMPLETED
        task.result = result
        task.progress = 1.0
        task.completed_at = datetime.utcnow()

        logger.info("Agent task completed", task_id=str(task_id))

    except Exception as e:
        logger.error("Agent task failed", task_id=str(task_id), error=str(e))
        task.status = AgentStatus.FAILED
        task.error = str(e)
        task.completed_at = datetime.utcnow()


def _update_task_progress(task_id: UUID, progress: float, step: AgentStepLog) -> None:
    """Update task progress and add step log."""
    if task_id in _agent_tasks:
        task = _agent_tasks[task_id]
        task.progress = progress
        task.current_step = step.step_number
        task.steps.append(step)


@router.get("/tasks", response_model=AgentTaskListResponse)
async def list_agent_tasks(
    project_id: Optional[UUID] = None,
    status: Optional[AgentStatus] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
) -> AgentTaskListResponse:
    """List agent tasks with filtering and pagination."""
    items = list(_agent_tasks.values())

    # Apply filters
    if project_id:
        items = [t for t in items if t.project_id == project_id]
    if status:
        items = [t for t in items if t.status == status]

    # Sort by created_at descending
    items.sort(key=lambda x: x.created_at, reverse=True)

    # Paginate
    total = len(items)
    start = (page - 1) * page_size
    end = start + page_size

    return AgentTaskListResponse(
        items=items[start:end],
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
    if task_id not in _agent_tasks:
        raise HTTPException(status_code=404, detail="Task not found")

    return _agent_tasks[task_id]


@router.post("/tasks/{task_id}/cancel", response_model=AgentTaskResponse)
async def cancel_agent_task(
    task_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> AgentTaskResponse:
    """Cancel a running agent task."""
    if task_id not in _agent_tasks:
        raise HTTPException(status_code=404, detail="Task not found")

    task = _agent_tasks[task_id]

    if task.status not in [AgentStatus.PENDING, AgentStatus.RUNNING]:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot cancel task in status: {task.status}",
        )

    task.status = AgentStatus.CANCELLED
    task.completed_at = datetime.utcnow()
    logger.info("Agent task cancelled", task_id=str(task_id))

    return task


@router.post("/search", response_model=SearchAgentResponse)
async def run_search_agent(
    request: SearchAgentRequest,
    db: AsyncSession = Depends(get_db),
) -> SearchAgentResponse:
    """Run the search agent synchronously for quick searches."""
    logger.info("Running search agent", query=request.query, sources=request.sources)

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


@router.get("/capabilities", response_model=List[AgentCapabilities])
async def list_agent_capabilities() -> List[AgentCapabilities]:
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
            description="Searches web, PubMed, and other sources for relevant information",
            available_tools=["google_search", "brave_search", "pubmed_search", "web_fetch"],
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
