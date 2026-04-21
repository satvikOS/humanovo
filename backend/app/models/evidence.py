"""
Evidence Model

Evidence items from various sources (PubMed, clinical trials, etc.).
"""

from enum import Enum as PyEnum

from sqlalchemy import Column, DateTime, Enum, Float, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import relationship

from app.models.base import BaseModel


class EvidenceSource(str, PyEnum):
    """Source type of evidence."""

    PUBMED = "pubmed"
    CLINICAL_TRIAL = "clinical_trial"
    PREPRINT = "preprint"
    OMICS = "omics"
    DRUG_DATABASE = "drug_database"
    PATHWAY_DATABASE = "pathway_database"
    WEB_SEARCH = "web_search"
    USER_UPLOAD = "user_upload"
    PATENT = "patent"


class Evidence(BaseModel):
    """Evidence item model."""

    __tablename__ = "evidence"

    # Project reference (optional - evidence can be shared)
    project_id = Column(
        PGUUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # Core content
    title = Column(String(500), nullable=False, index=True)
    abstract = Column(Text, nullable=True)
    full_text = Column(Text, nullable=True)
    snippet = Column(Text, nullable=True)

    # Source information
    source_type = Column(
        Enum(EvidenceSource, name="evidence_source", values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        index=True,
    )
    source_id = Column(String(100), nullable=True, index=True)  # PMID, NCT, etc.
    source_url = Column(String(2048), nullable=True)

    # Publication metadata
    authors = Column(ARRAY(String), default=list, nullable=False)
    publication_date = Column(DateTime(timezone=True), nullable=True)
    journal = Column(String(255), nullable=True)
    doi = Column(String(255), nullable=True, unique=True)

    # Extracted entities and relations
    entities = Column(ARRAY(String), default=list, nullable=False)
    relations = Column(JSONB, nullable=True)

    # Scores and metadata
    relevance_score = Column(Float, nullable=True)
    quality_score = Column(Float, nullable=True)
    citation_count = Column(Integer, nullable=True)

    # Vector embedding reference
    embedding_id = Column(String(255), nullable=True, index=True)
    embedding_model = Column(String(100), nullable=True)

    # Classification
    tags = Column(ARRAY(String), default=list, nullable=False)

    # Ingestion metadata
    ingested_by = Column(String(100), nullable=True)  # Agent/job ID
    ingestion_job_id = Column(
        PGUUID(as_uuid=True),
        ForeignKey("ingestion_jobs.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Raw data (for reprocessing)
    raw_data = Column(JSONB, nullable=True)

    # Relationships
    project = relationship("Project", back_populates="evidence")
    hypothesis_refs = relationship(
        "EvidenceReference",
        back_populates="evidence",
        lazy="dynamic",
        cascade="all, delete-orphan",
    )
    ingestion_job = relationship("IngestionJob", back_populates="evidence_items")

    def __repr__(self) -> str:
        return f"<Evidence {self.source_type.value}: {self.title[:50]}...>"

    def set_embedding(self, embedding_id: str, model: str) -> None:
        """Set embedding reference."""
        self.embedding_id = embedding_id
        self.embedding_model = model

    def extract_snippet(self, max_length: int = 300) -> str:
        """Extract a snippet from abstract or full text."""
        text = self.abstract or self.full_text or ""
        if len(text) <= max_length:
            return text
        return text[:max_length].rsplit(" ", 1)[0] + "..."
