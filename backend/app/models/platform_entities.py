"""
Platform Entity Models

SQLAlchemy ORM models for all platform entities that were previously
stored in-memory: clinical trials, biobank, IRB, compliance, ML,
imaging, manuscripts, datasets, knowledge graph, collaboration,
audit logs, and billing budgets.
"""

from sqlalchemy import Boolean, Column, Float, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID

from app.models.base import BaseModel


# ---------------------------------------------------------------------------
# Clinical Trials
# ---------------------------------------------------------------------------

class ClinicalTrial(BaseModel):
    """Clinical trial protocol."""

    __tablename__ = "clinical_trials"

    protocol_number = Column(String, unique=True, nullable=False)
    title = Column(String(500), nullable=False)
    phase = Column(String(50), nullable=True)
    status = Column(String(50), default="planning", nullable=False)
    pi = Column(String(255), nullable=True)
    sponsor = Column(String(255), nullable=True)
    description = Column(Text, nullable=True)
    start_date = Column(String(50), nullable=True)
    estimated_end = Column(String(50), nullable=True)
    target_enrollment = Column(Integer, default=0, nullable=False)
    current_enrollment = Column(Integer, default=0, nullable=False)
    arms = Column(JSONB, default=list, nullable=False)
    budget = Column(JSONB, default=dict, nullable=False)


class TrialSubject(BaseModel):
    """Subject enrolled in a clinical trial."""

    __tablename__ = "trial_subjects"

    trial_id = Column(
        PGUUID(as_uuid=True),
        ForeignKey("clinical_trials.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    subject_number = Column(String(50), nullable=False)
    display_name = Column(String(255), nullable=True)
    age = Column(Integer, nullable=True)
    sex = Column(String(10), nullable=True)
    arm = Column(String(100), nullable=True)
    status = Column(String(50), default="active", nullable=False)
    enrolled_date = Column(String(50), nullable=True)


class TrialDocument(BaseModel):
    """Document associated with a clinical trial."""

    __tablename__ = "trial_documents"

    trial_id = Column(
        PGUUID(as_uuid=True),
        ForeignKey("clinical_trials.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    document_type = Column(String(50), nullable=False)
    name = Column(String(500), nullable=False)
    status = Column(String(50), default="pending", nullable=False)
    version = Column(String(50), default="1.0", nullable=False)
    uploaded_by = Column(String(255), nullable=True)


# ---------------------------------------------------------------------------
# Biobank
# ---------------------------------------------------------------------------

class StorageLocation(BaseModel):
    """Physical storage location for biobank samples."""

    __tablename__ = "storage_locations"

    name = Column(String(255), nullable=False)
    temperature = Column(String(50), nullable=True)
    type = Column(String(50), nullable=True)
    capacity = Column(Integer, default=500, nullable=False)
    used = Column(Integer, default=0, nullable=False)
    racks = Column(JSONB, default=list, nullable=False)


class BiobankSample(BaseModel):
    """Biological sample in the biobank."""

    __tablename__ = "biobank_samples"

    barcode = Column(String(50), unique=True, nullable=False)
    sample_type = Column(String(50), nullable=False)
    status = Column(String(50), default="available", nullable=False)
    project = Column(String(255), nullable=True)
    tissue_type = Column(String(255), nullable=True)
    patient_id = Column(String(100), nullable=True)
    collection_date = Column(String(50), nullable=True)
    storage_location_id = Column(
        PGUUID(as_uuid=True),
        ForeignKey("storage_locations.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    storage_details = Column(JSONB, default=dict, nullable=False)
    quantity = Column(String(100), nullable=True)
    quality_score = Column(Float, default=1.0, nullable=False)
    chain_of_custody = Column(JSONB, default=list, nullable=False)


# ---------------------------------------------------------------------------
# IRB / Compliance / Consent
# ---------------------------------------------------------------------------

class IRBSubmission(BaseModel):
    """IRB submission record."""

    __tablename__ = "irb_submissions"

    protocol_title = Column(String(500), nullable=False)
    irb_number = Column(String(100), unique=True, nullable=False)
    status = Column(String(50), default="pending", nullable=False)
    submission_date = Column(String(50), nullable=True)
    approval_date = Column(String(50), nullable=True)
    expiration_date = Column(String(50), nullable=True)
    pi = Column(String(255), nullable=True)
    risk_level = Column(String(100), nullable=True)
    review_type = Column(String(100), nullable=True)
    history = Column(JSONB, default=list, nullable=False)


class DataUseAgreement(BaseModel):
    """Data use agreement."""

    __tablename__ = "data_use_agreements"

    title = Column(String(500), nullable=False)
    agreement_type = Column(String(50), nullable=False)
    status = Column(String(50), default="draft", nullable=False)
    party = Column(String(500), nullable=True)
    start_date = Column(String(50), nullable=True)
    end_date = Column(String(50), nullable=True)
    data_types = Column(JSONB, default=list, nullable=False)
    restrictions = Column(JSONB, default=list, nullable=False)


class ConsentForm(BaseModel):
    """Informed consent form template."""

    __tablename__ = "consent_forms"

    title = Column(String(500), nullable=False)
    version = Column(String(50), nullable=True)
    status = Column(String(50), default="draft", nullable=False)
    language = Column(String(100), default="English", nullable=False)
    irb_approved = Column(Boolean, default=False, nullable=False)
    versions = Column(JSONB, default=list, nullable=False)


class ComplianceChecklist(BaseModel):
    """Regulatory compliance checklist."""

    __tablename__ = "compliance_checklists"

    framework = Column(String(100), nullable=False)
    items = Column(JSONB, default=list, nullable=False)
    completion_pct = Column(Integer, default=0, nullable=False)
    last_reviewed = Column(String(50), nullable=True)


# ---------------------------------------------------------------------------
# ML Models
# ---------------------------------------------------------------------------

class MLModel(BaseModel):
    """Machine-learning model registry entry."""

    __tablename__ = "ml_models"

    name = Column(String(500), nullable=False)
    model_type = Column(String(100), nullable=True)
    status = Column(String(50), default="draft", nullable=False)
    description = Column(Text, nullable=True)
    version = Column(String(50), default="1.0", nullable=False)
    framework = Column(String(100), nullable=True)
    hyperparameters = Column(JSONB, default=dict, nullable=False)
    features = Column(JSONB, default=list, nullable=False)
    target = Column(String(255), nullable=True)
    metrics = Column(JSONB, default=dict, nullable=False)
    training_history = Column(JSONB, default=list, nullable=False)
    feature_importance = Column(JSONB, default=list, nullable=False)


# ---------------------------------------------------------------------------
# Imaging
# ---------------------------------------------------------------------------

class ImagingStudy(BaseModel):
    """Medical imaging study."""

    __tablename__ = "imaging_studies"

    title = Column(String(500), nullable=False)
    modality = Column(String(100), nullable=True)
    body_part = Column(String(255), nullable=True)
    findings = Column(Text, nullable=True)
    status = Column(String(50), default="pending", nullable=False)
    patient_id = Column(String(100), nullable=True)
    annotations = Column(JSONB, default=list, nullable=False)
    ai_analysis = Column(JSONB, nullable=True)
    width = Column(Integer, default=512, nullable=False)
    height = Column(Integer, default=512, nullable=False)


# ---------------------------------------------------------------------------
# Manuscripts
# ---------------------------------------------------------------------------

class Manuscript(BaseModel):
    """Research manuscript."""

    __tablename__ = "manuscripts"

    title = Column(String(500), nullable=False)
    status = Column(String(50), default="draft", nullable=False)
    journal_target = Column(String(255), nullable=True)
    sections = Column(JSONB, default=dict, nullable=False)
    authors = Column(JSONB, default=list, nullable=False)
    keywords = Column(JSONB, default=list, nullable=False)
    submission_history = Column(JSONB, default=list, nullable=False)
    word_count = Column(Integer, default=0, nullable=False)


# ---------------------------------------------------------------------------
# Research Datasets
# ---------------------------------------------------------------------------

class ResearchDataset(BaseModel):
    """Tabular research dataset."""

    __tablename__ = "research_datasets"

    name = Column(String(500), nullable=False)
    description = Column(Text, nullable=True)
    format = Column(String(50), default="csv", nullable=False)
    columns = Column(JSONB, default=list, nullable=False)
    rows = Column(JSONB, default=list, nullable=False)
    row_count = Column(Integer, default=0, nullable=False)
    tags = Column(JSONB, default=list, nullable=False)


# ---------------------------------------------------------------------------
# Knowledge Graph
# ---------------------------------------------------------------------------

class KnowledgeGraphNode(BaseModel):
    """Node in the knowledge graph."""

    __tablename__ = "knowledge_graph_nodes"

    name = Column(String(500), nullable=False)
    type = Column(String(100), nullable=True)
    description = Column(Text, nullable=True)
    properties = Column(JSONB, default=dict, nullable=False)


class KnowledgeGraphEdge(BaseModel):
    """Edge (relationship) in the knowledge graph."""

    __tablename__ = "knowledge_graph_edges"

    source_id = Column(
        PGUUID(as_uuid=True),
        ForeignKey("knowledge_graph_nodes.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    target_id = Column(
        PGUUID(as_uuid=True),
        ForeignKey("knowledge_graph_nodes.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    source_name = Column(String(500), nullable=True)
    target_name = Column(String(500), nullable=True)
    relationship = Column(String(255), nullable=False)
    strength = Column(Float, default=0.5, nullable=False)
    evidence = Column(Text, nullable=True)


# ---------------------------------------------------------------------------
# Collaboration
# ---------------------------------------------------------------------------

class CollaborationComment(BaseModel):
    """Comment on any collaborative entity."""

    __tablename__ = "collaboration_comments"

    entity_type = Column(String(100), nullable=False)
    entity_id = Column(String(100), nullable=False)
    content = Column(Text, nullable=False)
    user_id = Column(String(100), nullable=False)
    user_name = Column(String(255), nullable=True)
    parent_id = Column(String(100), nullable=True)
    edited = Column(Boolean, default=False, nullable=False)
    reactions = Column(JSONB, default=dict, nullable=False)


class ProjectShare(BaseModel):
    """Sharing permission for a project."""

    __tablename__ = "project_shares"

    project_id = Column(String(100), nullable=False)
    user_id = Column(String(100), nullable=False)
    user_name = Column(String(255), nullable=True)
    permission = Column(String(50), default="viewer", nullable=False)
    status = Column(String(50), default="pending", nullable=False)


class CollaborationNotification(BaseModel):
    """Notification for collaboration events."""

    __tablename__ = "collaboration_notifications"

    user_id = Column(String(100), nullable=False)
    type = Column(String(100), nullable=False)
    title = Column(String(500), nullable=False)
    message = Column(Text, nullable=True)
    read = Column(Boolean, default=False, nullable=False)
    entity_type = Column(String(100), nullable=True)
    entity_id = Column(String(100), nullable=True)
    actor_name = Column(String(255), nullable=True)


# ---------------------------------------------------------------------------
# Audit Log
# ---------------------------------------------------------------------------

class AuditLogEntry(BaseModel):
    """Immutable audit log entry."""

    __tablename__ = "audit_log_entries"

    action = Column(String(100), nullable=False)
    entity_type = Column(String(100), nullable=False)
    entity_id = Column(String(100), nullable=False)
    user_id = Column(String(100), nullable=False)
    user_name = Column(String(255), nullable=True)
    details = Column(Text, nullable=True)


# ---------------------------------------------------------------------------
# Billing
# ---------------------------------------------------------------------------

class BillingBudget(BaseModel):
    """Budget configuration for billing."""

    __tablename__ = "billing_budgets"

    scope = Column(String(50), nullable=False)
    project_id = Column(String(100), nullable=True)
    monthly_budget_cents = Column(Integer, nullable=False)
    alert_threshold_pct = Column(Integer, default=80, nullable=False)
    hard_limit = Column(Boolean, default=False, nullable=False)
    current_month_spend_cents = Column(Integer, default=0, nullable=False)


class BillingNotification(BaseModel):
    """Notification related to billing/budgets."""

    __tablename__ = "billing_notifications"

    type = Column(String(100), nullable=False)
    title = Column(String(500), nullable=False)
    message = Column(Text, nullable=True)
    read = Column(Boolean, default=False, nullable=False)
    budget_id = Column(
        PGUUID(as_uuid=True),
        ForeignKey("billing_budgets.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
