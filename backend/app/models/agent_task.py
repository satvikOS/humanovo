"""
Agent Task Model

Tracks tasks executed by various AI agents in the system.
"""

from datetime import datetime
from enum import Enum as PyEnum
from typing import Any

from sqlalchemy import Column, DateTime, Enum, Float, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import relationship

from app.models.base import BaseModel


class AgentTaskStatus(str, PyEnum):
    """Agent task status enum."""

    PENDING = "pending"
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"
    RETRYING = "retrying"


class AgentTaskType(str, PyEnum):
    """Type of agent task."""

    LITERATURE_SEARCH = "literature_search"
    HYPOTHESIS_GENERATION = "hypothesis_generation"
    EVIDENCE_ANALYSIS = "evidence_analysis"
    SIMULATION_RUN = "simulation_run"
    DATA_INGESTION = "data_ingestion"
    ENTITY_EXTRACTION = "entity_extraction"
    KNOWLEDGE_GRAPH_UPDATE = "knowledge_graph_update"
    RAG_INDEXING = "rag_indexing"
    VALIDATION = "validation"
    SUMMARIZATION = "summarization"
    CUSTOM = "custom"


class AgentTask(BaseModel):
    """Agent task model for tracking agent work."""

    __tablename__ = "agent_tasks"

    # Project reference
    project_id = Column(
        PGUUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Task metadata
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    task_type = Column(
        Enum(AgentTaskType, name="agent_task_type"),
        default=AgentTaskType.CUSTOM,
        nullable=False,
        index=True,
    )

    # Status tracking
    status = Column(
        Enum(AgentTaskStatus, name="agent_task_status"),
        default=AgentTaskStatus.PENDING,
        nullable=False,
        index=True,
    )
    progress = Column(Float, default=0.0, nullable=False)

    # Input/output
    input_data = Column(JSONB, nullable=True)
    output_data = Column(JSONB, nullable=True)

    # Execution metadata
    priority = Column(Integer, default=5, nullable=False)  # 1-10, higher = more urgent
    retry_count = Column(Integer, default=0, nullable=False)
    max_retries = Column(Integer, default=3, nullable=False)

    # Timing
    queued_at = Column(DateTime(timezone=True), nullable=True)
    started_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    timeout_seconds = Column(Integer, default=600, nullable=False)
    runtime_seconds = Column(Float, nullable=True)

    # Agent info
    agent_id = Column(String(100), nullable=True, index=True)
    agent_model = Column(String(100), nullable=True)  # e.g., "gpt-4", "claude-3"
    worker_id = Column(String(100), nullable=True)

    # Error handling
    error_message = Column(Text, nullable=True)
    error_details = Column(JSONB, nullable=True)

    # Resource tracking
    tokens_used = Column(Integer, default=0, nullable=False)
    api_calls_made = Column(Integer, default=0, nullable=False)
    cost_usd = Column(Float, default=0.0, nullable=False)

    # Parent/child task relationships
    parent_task_id = Column(
        PGUUID(as_uuid=True),
        ForeignKey("agent_tasks.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # Tags for filtering
    tags = Column(ARRAY(String), default=list, nullable=False)

    # Relationships
    project = relationship("Project", back_populates="agent_tasks")
    parent_task = relationship(
        "AgentTask",
        remote_side="AgentTask.id",
        back_populates="child_tasks",
    )
    child_tasks = relationship(
        "AgentTask",
        back_populates="parent_task",
        lazy="dynamic",
    )

    def __repr__(self) -> str:
        return f"<AgentTask {self.name}: {self.status.value}>"

    def queue(self) -> None:
        """Mark task as queued."""
        self.status = AgentTaskStatus.QUEUED
        self.queued_at = datetime.utcnow()

    def start(self, agent_id: str, worker_id: str | None = None) -> None:
        """Mark task as started."""
        self.status = AgentTaskStatus.RUNNING
        self.agent_id = agent_id
        self.worker_id = worker_id
        self.started_at = datetime.utcnow()

    def complete(self, output_data: dict[str, Any]) -> None:
        """Mark task as completed."""
        self.status = AgentTaskStatus.COMPLETED
        self.completed_at = datetime.utcnow()
        self.output_data = output_data
        self.progress = 1.0

        if self.started_at:
            delta = self.completed_at - self.started_at
            self.runtime_seconds = delta.total_seconds()

    def fail(self, error_message: str, error_details: dict | None = None) -> None:
        """Mark task as failed."""
        self.status = AgentTaskStatus.FAILED
        self.completed_at = datetime.utcnow()
        self.error_message = error_message
        self.error_details = error_details

        if self.started_at:
            delta = self.completed_at - self.started_at
            self.runtime_seconds = delta.total_seconds()

    def retry(self) -> bool:
        """Attempt to retry the task. Returns True if retry is allowed."""
        if self.retry_count >= self.max_retries:
            return False

        self.retry_count += 1
        self.status = AgentTaskStatus.RETRYING
        self.error_message = None
        self.error_details = None
        self.started_at = None
        self.completed_at = None
        self.progress = 0.0
        return True

    def cancel(self) -> None:
        """Mark task as cancelled."""
        self.status = AgentTaskStatus.CANCELLED
        self.completed_at = datetime.utcnow()

    def update_progress(self, progress: float) -> None:
        """Update task progress (0.0 to 1.0)."""
        self.progress = min(1.0, max(0.0, progress))

    def add_cost(self, tokens: int, api_calls: int, cost: float) -> None:
        """Add resource usage to the task."""
        self.tokens_used = (self.tokens_used or 0) + tokens
        self.api_calls_made = (self.api_calls_made or 0) + api_calls
        self.cost_usd = (self.cost_usd or 0) + cost

    def is_terminal(self) -> bool:
        """Check if task is in a terminal state."""
        return self.status in (
            AgentTaskStatus.COMPLETED,
            AgentTaskStatus.FAILED,
            AgentTaskStatus.CANCELLED,
        )

    def can_retry(self) -> bool:
        """Check if task can be retried."""
        return self.status == AgentTaskStatus.FAILED and self.retry_count < self.max_retries
