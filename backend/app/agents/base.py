"""
Base Agent Module

Defines the base classes and interfaces for all humanovo agents.
"""

from abc import ABC, abstractmethod
from collections.abc import Callable
from datetime import datetime, timezone
from enum import Enum
from typing import Any
from uuid import UUID, uuid4

from pydantic import BaseModel, Field

from app.core.logging import LoggerMixin


class AgentType(str, Enum):
    """Types of agents in the system."""

    CONTROLLER = "controller"
    SEARCH = "search"
    EXTRACTION = "extraction"
    REASONING = "reasoning"
    VERIFICATION = "verification"
    SIMULATION = "simulation"
    REPORTING = "reporting"
    INGESTION = "ingestion"


class AgentStatus(str, Enum):
    """Status of an agent execution."""

    IDLE = "idle"
    RUNNING = "running"
    WAITING = "waiting"
    COMPLETED = "completed"
    FAILED = "failed"


class AgentContext(BaseModel):
    """Shared context passed between agents."""

    session_id: UUID = Field(default_factory=uuid4)
    project_id: UUID | None = None
    query: str = ""
    entities: list[str] = Field(default_factory=list)
    evidence: list[dict[str, Any]] = Field(default_factory=list)
    hypotheses: list[dict[str, Any]] = Field(default_factory=list)
    graph_facts: list[dict[str, Any]] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)
    iteration: int = 0
    max_iterations: int = 10


class AgentStep(BaseModel):
    """Record of a single agent step."""

    step_id: UUID = Field(default_factory=uuid4)
    agent_type: AgentType
    action: str
    input_data: dict[str, Any] = Field(default_factory=dict)
    output_data: dict[str, Any] = Field(default_factory=dict)
    tool_calls: list[str] = Field(default_factory=list)
    duration_ms: int = 0
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    error: str | None = None


class AgentResult(BaseModel):
    """Result from an agent execution."""

    success: bool
    data: dict[str, Any] = Field(default_factory=dict)
    steps: list[AgentStep] = Field(default_factory=list)
    error: str | None = None
    context: AgentContext | None = None


class Tool(BaseModel):
    """Definition of a tool available to an agent."""

    model_config = {"arbitrary_types_allowed": True}

    name: str
    description: str
    parameters: dict[str, Any] = Field(default_factory=dict)
    handler: Callable | None = Field(default=None, exclude=True)


class BaseAgent(ABC, LoggerMixin):
    """Base class for all humanovo agents.

    Provides common functionality for logging, tool management,
    and execution tracking.
    """

    agent_type: AgentType = AgentType.CONTROLLER
    description: str = "Base agent"

    def __init__(
        self,
        max_iterations: int = 10,
        timeout_seconds: int = 120,
    ):
        self.max_iterations = max_iterations
        self.timeout_seconds = timeout_seconds
        self.status = AgentStatus.IDLE
        self.tools: dict[str, Tool] = {}
        self.steps: list[AgentStep] = []
        self._setup_tools()

    def _setup_tools(self) -> None:
        """Set up available tools for this agent. Override in subclasses."""
        pass

    def register_tool(self, tool: Tool) -> None:
        """Register a tool for use by this agent."""
        self.tools[tool.name] = tool
        self.logger.debug("Tool registered", tool=tool.name)

    async def call_tool(
        self,
        tool_name: str,
        **kwargs,
    ) -> Any:
        """Call a registered tool."""
        if tool_name not in self.tools:
            raise ValueError(f"Tool not found: {tool_name}")

        tool = self.tools[tool_name]
        if tool.handler is None:
            raise ValueError(f"Tool has no handler: {tool_name}")

        self.logger.debug("Calling tool", tool=tool_name, kwargs=list(kwargs.keys()))

        start_time = datetime.now(timezone.utc)
        try:
            result = await tool.handler(**kwargs)
            return result
        except Exception as e:
            self.logger.error("Tool call failed", tool=tool_name, error=str(e))
            raise

    def record_step(
        self,
        action: str,
        input_data: dict[str, Any] = None,
        output_data: dict[str, Any] = None,
        tool_calls: list[str] = None,
        duration_ms: int = 0,
        error: str | None = None,
    ) -> AgentStep:
        """Record a step in the agent's execution."""
        step = AgentStep(
            agent_type=self.agent_type,
            action=action,
            input_data=input_data or {},
            output_data=output_data or {},
            tool_calls=tool_calls or [],
            duration_ms=duration_ms,
            error=error,
        )
        self.steps.append(step)
        return step

    @abstractmethod
    async def execute(
        self,
        context: AgentContext,
        **kwargs,
    ) -> AgentResult:
        """Execute the agent's main task.

        Args:
            context: Shared context with query, evidence, etc.
            **kwargs: Additional parameters

        Returns:
            AgentResult with success status and data
        """
        pass

    async def run(
        self,
        query: str,
        context: AgentContext | None = None,
        progress_callback: Callable | None = None,
        **kwargs,
    ) -> AgentResult:
        """Run the agent with the given query.

        Args:
            query: The query or task to process
            context: Optional existing context
            progress_callback: Optional callback for progress updates
            **kwargs: Additional parameters

        Returns:
            AgentResult with execution results
        """
        import time

        self.status = AgentStatus.RUNNING
        self.steps = []
        start_time = time.time()

        # Create or update context
        if context is None:
            context = AgentContext(query=query)
        else:
            context.query = query

        self.logger.info(
            "Agent starting",
            agent_type=self.agent_type.value,
            query=query[:100],
        )

        try:
            result = await self.execute(context, **kwargs)
            self.status = AgentStatus.COMPLETED

            # Add steps to result
            result.steps = self.steps
            result.context = context

            duration = time.time() - start_time
            self.logger.info(
                "Agent completed",
                agent_type=self.agent_type.value,
                success=result.success,
                steps=len(self.steps),
                duration_s=round(duration, 2),
            )

            return result

        except Exception as e:
            self.status = AgentStatus.FAILED
            self.logger.error(
                "Agent failed",
                agent_type=self.agent_type.value,
                error=str(e),
            )

            return AgentResult(
                success=False,
                error=str(e),
                steps=self.steps,
                context=context,
            )


class AgentOrchestrator(LoggerMixin):
    """Orchestrates multiple agents working together.

    Manages shared context, agent communication, and task delegation.
    """

    def __init__(self):
        self.agents: dict[AgentType, BaseAgent] = {}
        self.context: AgentContext | None = None
        self.history: list[AgentStep] = []

    def register_agent(self, agent: BaseAgent) -> None:
        """Register an agent for orchestration."""
        self.agents[agent.agent_type] = agent
        self.logger.debug("Agent registered", agent_type=agent.agent_type.value)

    async def delegate(
        self,
        agent_type: AgentType,
        **kwargs,
    ) -> AgentResult:
        """Delegate a task to a specific agent."""
        if agent_type not in self.agents:
            raise ValueError(f"Agent not registered: {agent_type}")

        agent = self.agents[agent_type]
        result = await agent.execute(self.context, **kwargs)

        # Merge steps into history
        self.history.extend(result.steps)

        # Update context if modified
        if result.context:
            self.context = result.context

        return result

    async def run_pipeline(
        self,
        query: str,
        pipeline: list[AgentType],
        **kwargs,
    ) -> AgentResult:
        """Run a pipeline of agents sequentially."""
        self.context = AgentContext(query=query)
        self.history = []

        final_result = None
        for agent_type in pipeline:
            self.logger.info("Pipeline step", agent_type=agent_type.value)
            result = await self.delegate(agent_type, **kwargs)

            if not result.success:
                self.logger.warning(
                    "Pipeline step failed",
                    agent_type=agent_type.value,
                    error=result.error,
                )
                return result

            final_result = result

        return final_result or AgentResult(success=True)
