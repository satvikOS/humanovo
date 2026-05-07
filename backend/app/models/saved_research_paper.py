"""
SavedResearchPaper — AI-generated research-paper artifact bound to a hypothesis.

The document-pipeline service renders a hypothesis into a structured HTML
research paper (intro, methods, results, discussion). Until this model
landed, the rendered HTML lived only in browser localStorage under the
`research-papers` key, so a fresh-browser session lost every paper a user
had previously generated. This model gives each paper a UUID, a foreign
key to the originating Hypothesis, ownership for tenant isolation, and
durable storage so the artifact survives device + browser swaps.

Why a separate model from `Manuscript` (platform_entities.py):
  - Manuscript is a multi-section *editorial* doc the user actively writes
    (sections JSONB, journal_target, submission_history, status workflow).
  - SavedResearchPaper is the *generated* output of the discovery pipeline
    — a single rendered HTML payload tied to a specific hypothesis. The
    UX is "view + download + delete," not "edit sections."
  - Keeping them separate avoids overloading Manuscript with generation
    metadata (hypothesis_id, generation_disease, generation_filename) and
    keeps the editorial workflow's schema clean.

The HTML payload is stored as TEXT in Postgres rather than S3 because
generated papers are small (typically 50–200 KB of HTML), well within
Postgres TOAST limits (1 GB per row), and avoiding S3 keeps the local
dev story self-contained.
"""
from __future__ import annotations

from sqlalchemy import Column, ForeignKey, Index, String, Text
from sqlalchemy.dialects.postgresql import UUID as PGUUID

from app.models.base import BaseModel


class SavedResearchPaper(BaseModel):
    """A generated research paper rendered from a discovery hypothesis."""

    __tablename__ = "saved_research_papers"

    # Owner — every row belongs to exactly one user. Tenant-isolation
    # guard checks this at the router layer.
    owner_id = Column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # FK to the originating Hypothesis. Cascades on hypothesis delete:
    # if the underlying hypothesis is gone, the generated paper has no
    # context to reference and should not linger.
    hypothesis_id = Column(
        PGUUID(as_uuid=True),
        ForeignKey("hypotheses.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # FK to Project for cross-project filtering. NULL when the
    # hypothesis was generated outside any project (rare).
    project_id = Column(
        PGUUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # Display label captured at generation time so the paper still
    # makes sense after the hypothesis title is later edited.
    hypothesis_title = Column(String(1024), nullable=False)

    # Disease name pinned at generation time (denormalised for filter
    # speed; the source of truth remains hypothesis.disease).
    disease = Column(String(255), nullable=True)

    # Suggested filename for downloads (the frontend pre-fills the
    # browser save dialog with this).
    filename = Column(String(255), nullable=False)

    # The actual rendered HTML. NOT NULL — a row with no body is just
    # noise. Use deletion if a paper is no longer wanted.
    paper_html = Column(Text, nullable=False)

    # Composite index for the most common query: list papers in a
    # given project for a given user, sorted by created_at DESC.
    __table_args__ = (
        Index(
            "ix_saved_research_papers_owner_project_created",
            "owner_id",
            "project_id",
            "created_at",
        ),
    )
