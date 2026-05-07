"""
humanovo SQLAlchemy ORM Models

Complete database models for persistent storage.
"""

from app.models.agent_task import AgentTask, AgentTaskStatus, AgentTaskType
from app.models.base import Base, TimestampMixin
# AuditRecord lives in app.services.audit_service (co-located with behavior).
# We re-export it here so Alembic's Base.metadata is complete, but we import
# LAZILY via module-level __getattr__ to avoid a circular import: anything
# that loads through `app.services.__init__` → audit_service pulls in
# `app.models.base`, which re-enters this file mid-load. Eager-importing
# AuditRecord there would read a partially-initialised audit_service module
# and raise ImportError. The lazy __getattr__ defers the import to first
# access (Alembic autogen, explicit `from app.models import AuditRecord`,
# etc.), at which point audit_service is fully loaded.
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
from app.models.citation import Citation, CitationFolder, CitationHighlight
from app.models.activity import Activity
from app.models.notebook import NotebookPage
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

def __getattr__(name: str):
    """Lazy attribute access for names that live in other subpackages to
    avoid circular imports. Currently handles `AuditRecord` (defined in
    `app.services.audit_service`)."""
    if name == "AuditRecord":
        from app.services.audit_service import AuditRecord as _AR
        return _AR
    raise AttributeError(f"module 'app.models' has no attribute {name!r}")


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
    "Citation",
    "CitationFolder",
    "CitationHighlight",
]
