"""
humanovo SQLAlchemy ORM Models

Complete database models for persistent storage.
"""

from app.models.agent_task import AgentTask, AgentTaskStatus, AgentTaskType
from app.models.base import Base, TimestampMixin
# AuditRecord lives in app.services.audit_service (co-located with behavior);
# import it here so Alembic's Base.metadata is complete.
from app.services.audit_service import AuditRecord
from app.models.evidence import Evidence, EvidenceSource
from app.models.hypothesis import EvidenceReference, Hypothesis, HypothesisStatus
from app.models.ingestion_job import IngestionJob, IngestionJobStatus, IngestionSource
from app.models.project import Project
from app.models.simulation import Simulation, SimulationStatus, SimulationType
from app.models.learning_memory import (
    APICostRecord,
    BenchmarkResult,
    BenchmarkRun,
    BenchmarkTestCase,
    DiscoveryRun,
    HypothesisFeedback,
    LearningMemoryState,
    ModelPricing,
    PipelineOptimization,
    StageExecution,
    StagePerformanceAggregate,
)
from app.models.user import User, UserRole
from app.models.discovery_session import DiscoverySession
from app.models.platform_entities import (
    AuditLogEntry,
    BillingBudget,
    BillingNotification,
    BiobankSample,
    ClinicalTrial,
    CollaborationComment,
    CollaborationNotification,
    ComplianceChecklist,
    ConsentForm,
    DataUseAgreement,
    IRBSubmission,
    ImagingStudy,
    KnowledgeGraphEdge,
    KnowledgeGraphNode,
    MLModel,
    Manuscript,
    ProjectShare,
    ResearchDataset,
    SavedAnalysis,
    StorageLocation,
    TrialDocument,
    TrialSubject,
)

__all__ = [
    "Base",
    "TimestampMixin",
    "AuditRecord",
    "User",
    "UserRole",
    "Project",
    "Hypothesis",
    "HypothesisStatus",
    "EvidenceReference",
    "Evidence",
    "EvidenceSource",
    "Simulation",
    "SimulationStatus",
    "SimulationType",
    "AgentTask",
    "AgentTaskStatus",
    "AgentTaskType",
    "IngestionJob",
    "IngestionJobStatus",
    "IngestionSource",
    # Pipeline Intelligence
    "DiscoveryRun",
    "StageExecution",
    "APICostRecord",
    "ModelPricing",
    "HypothesisFeedback",
    "LearningMemoryState",
    "StagePerformanceAggregate",
    "BenchmarkTestCase",
    "BenchmarkRun",
    "BenchmarkResult",
    "PipelineOptimization",
    # Platform Entities
    "ClinicalTrial",
    "TrialSubject",
    "TrialDocument",
    "StorageLocation",
    "BiobankSample",
    "IRBSubmission",
    "DataUseAgreement",
    "ConsentForm",
    "ComplianceChecklist",
    "MLModel",
    "ImagingStudy",
    "Manuscript",
    "ResearchDataset",
    "KnowledgeGraphNode",
    "KnowledgeGraphEdge",
    "CollaborationComment",
    "ProjectShare",
    "CollaborationNotification",
    "AuditLogEntry",
    "BillingBudget",
    "BillingNotification",
    "SavedAnalysis",
    "DiscoverySession",
]
