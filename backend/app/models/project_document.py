"""
ProjectDocument — uploaded research artifact attached to a project.

Replaces the localStorage `project-documents` key (metadata) plus
IndexedDB blob storage (file bytes) on the frontend with a single
durable Postgres-backed row. Uploaded files include lab protocols,
IRB approvals, datasets, lab notes, manuscripts, and supplementary
materials — anything a researcher wants to attach to a project for
the AI pipeline to consume during evidence grounding.

Storage strategy:
  - Metadata in standard columns (size, mime, doc_type, etc.)
  - File content in a `content` BYTEA column. Postgres TOASTs anything
    over ~2 KB into a side table automatically; the practical row-
    size cap is 1 GB which exceeds anything a researcher would
    actually upload as a single document.
  - When the AWS-hosted backend stands up (Round 9 / infrastructure
    cleanup), a follow-up migration will move `content` to S3 and
    introduce a `storage_url` column. The schema is shaped so that
    transition is additive: add `storage_url`, populate it, then
    drop `content` once all rows are mirrored.

Per the audit's 'every entity has a UUID' directive, the row's `id`
is a UUID populated server-side (`gen_random_uuid()` default) so the
client doesn't generate IDs.

Knowledge-base scope:
  - 'private': only the owning user (and their collaborators on the
    project, once collaboration ships) can grind this document
    through the pipeline.
  - 'common':  the document is opted in to the shared knowledge
    pool. Any user with project access can index it. Useful for
    institution-tier shared corpora (textbooks, master IRB
    templates).
"""
from __future__ import annotations

from sqlalchemy import (
    BigInteger,
    Column,
    Date,
    ForeignKey,
    Index,
    LargeBinary,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.dialects.postgresql import UUID as PGUUID

from app.models.base import BaseModel


class ProjectDocument(BaseModel):
    """File metadata + content for a researcher-uploaded project artifact."""

    __tablename__ = "project_documents"

    owner_id = Column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    project_id = Column(
        PGUUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # User-supplied metadata.
    title = Column(String(512), nullable=False)
    doc_type = Column(String(64), nullable=False, default="Other")
    authors = Column(String(1024), nullable=True)
    document_date = Column(Date, nullable=True)
    description = Column(Text, nullable=True)
    tags = Column(ARRAY(String), nullable=False, default=list)

    # File envelope.
    filename = Column(String(512), nullable=False)
    file_size = Column(BigInteger, nullable=False, default=0)
    mime_type = Column(String(255), nullable=False, default="application/octet-stream")
    content = Column(LargeBinary, nullable=True)

    # Knowledge-base scope: 'private' (default) or 'common' for the
    # institution-tier shared corpus.
    knowledge_base = Column(String(16), nullable=False, default="private")

    __table_args__ = (
        Index(
            "ix_project_documents_owner_project_created",
            "owner_id",
            "project_id",
            "created_at",
        ),
        Index("ix_project_documents_doc_type", "doc_type"),
    )
