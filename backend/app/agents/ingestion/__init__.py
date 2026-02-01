"""
Ingestion Agent Framework

Specialized agents for continuous data ingestion from biomedical sources.
Includes scheduling, state management, and checkpointing capabilities.
"""

from app.agents.ingestion.base import (
    IngestionAgent,
    IngestionConfig,
    IngestionState,
    IngestionMetrics,
    IngestionStatus,
    SourceType,
    IngestionRecord,
    ExtractedEntity,
    ExtractedRelation,
)
from app.agents.ingestion.pubmed_agent import PubMedIngestionAgent
from app.agents.ingestion.clinical_trials_agent import ClinicalTrialsIngestionAgent
from app.agents.ingestion.patents_agent import PatentsIngestionAgent
from app.agents.ingestion.preprint_agent import PreprintIngestionAgent
from app.agents.ingestion.custom_document_agent import CustomDocumentIngestionAgent
from app.agents.ingestion.orchestrator import IngestionOrchestrator
from app.agents.ingestion.scheduler import (
    AgentScheduler,
    ScheduledIngestionJob,
    TaskPriority,
    get_scheduler,
    get_job_scheduler,
    initialize_schedulers,
    shutdown_schedulers,
)
from app.agents.ingestion.state_manager import (
    AgentStateManager,
    AgentStateTracker,
    Checkpoint,
    CheckpointType,
    get_state_manager,
    initialize_state_manager,
    shutdown_state_manager,
)

__all__ = [
    # Base classes
    "IngestionAgent",
    "IngestionConfig",
    "IngestionState",
    "IngestionMetrics",
    "IngestionStatus",
    "SourceType",
    "IngestionRecord",
    "ExtractedEntity",
    "ExtractedRelation",
    # Agents
    "PubMedIngestionAgent",
    "ClinicalTrialsIngestionAgent",
    "PatentsIngestionAgent",
    "PreprintIngestionAgent",
    "CustomDocumentIngestionAgent",
    # Orchestrator
    "IngestionOrchestrator",
    # Scheduler
    "AgentScheduler",
    "ScheduledIngestionJob",
    "TaskPriority",
    "get_scheduler",
    "get_job_scheduler",
    "initialize_schedulers",
    "shutdown_schedulers",
    # State Management
    "AgentStateManager",
    "AgentStateTracker",
    "Checkpoint",
    "CheckpointType",
    "get_state_manager",
    "initialize_state_manager",
    "shutdown_state_manager",
]
