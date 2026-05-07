"""
Ingestion Job Model

Tracks data ingestion jobs from various scientific sources.
"""

from datetime import datetime
from enum import Enum as PyEnum
from typing import Any

from sqlalchemy import Column, DateTime, Enum, Float, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import relationship

from app.models.base import BaseModel


class IngestionJobStatus(str, PyEnum):
    """Ingestion job status enum."""

    PENDING = "pending"
    QUEUED = "queued"
    FETCHING = "fetching"
    PROCESSING = "processing"
    INDEXING = "indexing"
    COMPLETED = "completed"
    PARTIAL = "partial"  # Completed with some failures
    FAILED = "failed"
    CANCELLED = "cancelled"


class IngestionSource(str, PyEnum):
    """Data source for ingestion."""

    PUBMED = "pubmed"
    CLINICAL_TRIALS = "clinical_trials"
    BIORXIV = "biorxiv"
    MEDRXIV = "medrxiv"
    ARXIV = "arxiv"
    CHEMBL = "chembl"
    DRUGBANK = "drugbank"
    KEGG = "kegg"
    REACTOME = "reactome"
    STRING = "string"
    UNIPROT = "uniprot"
    GEO = "geo"
    PATENT_USPTO = "patent_uspto"
    PATENT_EPO = "patent_epo"
    WEB_SCRAPE = "web_scrape"
    FILE_UPLOAD = "file_upload"
    API_CUSTOM = "api_custom"


class IngestionJob(BaseModel):
    """Ingestion job model for tracking data import."""

    __tablename__ = "ingestion_jobs"

    # Owner — see migration 016_owner_id_on_notebook_activity_ingestion.
    owner_id = Column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )

    # Job metadata
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)

    # Source configuration
    source = Column(
        Enum(IngestionSource, name="ingestion_source", values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        index=True,
    )
    source_config = Column(JSONB, nullable=True)  # API keys, endpoints, etc.

    # Query/filter parameters
    query = Column(Text, nullable=True)  # Search query if applicable
    filters = Column(JSONB, nullable=True)  # Date ranges, categories, etc.
    date_from = Column(DateTime(timezone=True), nullable=True)
    date_to = Column(DateTime(timezone=True), nullable=True)

    # Status tracking
    status = Column(
        Enum(IngestionJobStatus, name="ingestion_job_status", values_callable=lambda x: [e.value for e in x]),
        default=IngestionJobStatus.PENDING,
        nullable=False,
        index=True,
    )
    progress = Column(Float, default=0.0, nullable=False)

    # Counts
    items_found = Column(Integer, default=0, nullable=False)
    items_fetched = Column(Integer, default=0, nullable=False)
    items_processed = Column(Integer, default=0, nullable=False)
    items_indexed = Column(Integer, default=0, nullable=False)
    items_skipped = Column(Integer, default=0, nullable=False)  # Duplicates, invalid
    items_failed = Column(Integer, default=0, nullable=False)

    # Timing
    queued_at = Column(DateTime(timezone=True), nullable=True)
    started_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    timeout_seconds = Column(Integer, default=3600, nullable=False)
    runtime_seconds = Column(Float, nullable=True)

    # Worker info
    worker_id = Column(String(100), nullable=True)
    agent_task_id = Column(
        PGUUID(as_uuid=True),
        ForeignKey("agent_tasks.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Error handling
    error_message = Column(Text, nullable=True)
    error_details = Column(JSONB, nullable=True)
    failed_items = Column(JSONB, nullable=True)  # List of failed item IDs with reasons

    # Scheduling
    is_scheduled = Column(Integer, default=0, nullable=False)  # Boolean as int
    schedule_cron = Column(String(100), nullable=True)  # e.g., "0 0 * * *"
    last_run_at = Column(DateTime(timezone=True), nullable=True)
    next_run_at = Column(DateTime(timezone=True), nullable=True)

    # Output settings
    target_project_id = Column(
        PGUUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    auto_process = Column(Integer, default=1, nullable=False)  # Auto entity extraction
    auto_index = Column(Integer, default=1, nullable=False)  # Auto RAG indexing

    # Tags
    tags = Column(ARRAY(String), default=list, nullable=False)

    # Relationships
    target_project = relationship("Project")
    agent_task = relationship("AgentTask")
    evidence_items = relationship(
        "Evidence",
        back_populates="ingestion_job",
        lazy="dynamic",
    )

    def __repr__(self) -> str:
        return f"<IngestionJob {self.name}: {self.status.value}>"

    def queue(self) -> None:
        """Mark job as queued."""
        self.status = IngestionJobStatus.QUEUED
        self.queued_at = datetime.utcnow()

    def start_fetching(self, worker_id: str | None = None) -> None:
        """Mark job as fetching data."""
        self.status = IngestionJobStatus.FETCHING
        self.worker_id = worker_id
        self.started_at = datetime.utcnow()

    def start_processing(self) -> None:
        """Mark job as processing data."""
        self.status = IngestionJobStatus.PROCESSING

    def start_indexing(self) -> None:
        """Mark job as indexing data."""
        self.status = IngestionJobStatus.INDEXING

    def complete(self) -> None:
        """Mark job as completed."""
        now = datetime.utcnow()

        # Determine final status based on failures
        if self.items_failed > 0 and self.items_indexed > 0:
            self.status = IngestionJobStatus.PARTIAL
        elif self.items_indexed == 0 and self.items_found > 0:
            self.status = IngestionJobStatus.FAILED
        else:
            self.status = IngestionJobStatus.COMPLETED

        self.completed_at = now
        self.progress = 1.0
        self.last_run_at = now

        if self.started_at:
            delta = self.completed_at - self.started_at
            self.runtime_seconds = delta.total_seconds()

    def fail(self, error_message: str, error_details: dict | None = None) -> None:
        """Mark job as failed."""
        self.status = IngestionJobStatus.FAILED
        self.completed_at = datetime.utcnow()
        self.error_message = error_message
        self.error_details = error_details
        self.last_run_at = self.completed_at

        if self.started_at:
            delta = self.completed_at - self.started_at
            self.runtime_seconds = delta.total_seconds()

    def cancel(self) -> None:
        """Mark job as cancelled."""
        self.status = IngestionJobStatus.CANCELLED
        self.completed_at = datetime.utcnow()

    def update_progress(
        self,
        found: int | None = None,
        fetched: int | None = None,
        processed: int | None = None,
        indexed: int | None = None,
        skipped: int | None = None,
        failed: int | None = None,
    ) -> None:
        """Update job progress counts."""
        if found is not None:
            self.items_found = found
        if fetched is not None:
            self.items_fetched = fetched
        if processed is not None:
            self.items_processed = processed
        if indexed is not None:
            self.items_indexed = indexed
        if skipped is not None:
            self.items_skipped = skipped
        if failed is not None:
            self.items_failed = failed

        # Calculate overall progress
        total = self.items_found or 1
        completed = (self.items_indexed or 0) + (self.items_skipped or 0) + (self.items_failed or 0)
        self.progress = min(1.0, completed / total)

    def add_failed_item(self, item_id: str, reason: str) -> None:
        """Add a failed item to the list."""
        if self.failed_items is None:
            self.failed_items = []
        self.failed_items.append(
            {
                "item_id": item_id,
                "reason": reason,
                "timestamp": datetime.utcnow().isoformat(),
            }
        )
        self.items_failed = (self.items_failed or 0) + 1

    def is_terminal(self) -> bool:
        """Check if job is in a terminal state."""
        return self.status in (
            IngestionJobStatus.COMPLETED,
            IngestionJobStatus.PARTIAL,
            IngestionJobStatus.FAILED,
            IngestionJobStatus.CANCELLED,
        )

    def get_stats(self) -> dict[str, Any]:
        """Get job statistics."""
        return {
            "items_found": self.items_found,
            "items_fetched": self.items_fetched,
            "items_processed": self.items_processed,
            "items_indexed": self.items_indexed,
            "items_skipped": self.items_skipped,
            "items_failed": self.items_failed,
            "progress": self.progress,
            "runtime_seconds": self.runtime_seconds,
        }
