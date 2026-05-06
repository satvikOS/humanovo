"""
Citation Library models — Mendeley-equivalent reference manager.

Three tables:

  citations          — one row per reference (paper, book, preprint, etc.)
  citation_folders   — hierarchical collections (parent_id self-FK)
  citation_highlights — per-PDF annotations (page + bounding box + note)

Design notes:

* Kept separate from the Evidence table because evidence items are
  automated RAG ingestions while citations are a curated personal
  library. They share schema fields (title/authors/doi) but have
  different lifecycles — a user can star, tag, annotate, and
  re-export a citation without touching the evidence corpus.

* `csl_json` stores the full CSL-JSON object so export round-trips
  (BibTeX / RIS / CSL / Zotero / EndNote) don't lose any field the
  source gave us. Individual columns (title, year, doi, etc.) are
  denormalized copies for fast list-view queries.

* `folders` is a JSONB array of folder UUIDs — Mendeley-style
  multi-folder membership. Hierarchy lives in CitationFolder.parent_id.

* `highlights` live in their own table so bulk-loading the library
  list doesn't drag full annotation payloads across the wire.
"""
from sqlalchemy import Boolean, Column, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID as PGUUID

from app.models.base import BaseModel


class Citation(BaseModel):
    __tablename__ = "citations"

    # Owner — every row belongs to exactly one user. See migration
    # 015_owner_id_on_sessions_and_citations: nullable for backfill,
    # tightened to NOT NULL once orphan rows are reassigned.
    owner_id = Column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )

    # Optional project association — NULL means "unfiled / my library".
    project_id = Column(PGUUID(as_uuid=True), nullable=True, index=True)

    # Mendeley-compatible entry type.
    type = Column(String(32), nullable=False, default="journal")

    title = Column(Text, nullable=False)
    authors = Column(ARRAY(String), nullable=False, default=list)
    year = Column(Integer, nullable=True)
    abstract = Column(Text, nullable=True)

    # Journal / container fields.
    journal = Column(String(512), nullable=True)
    volume = Column(String(32), nullable=True)
    issue = Column(String(32), nullable=True)
    pages = Column(String(64), nullable=True)
    publisher = Column(String(256), nullable=True)

    # Identifiers.
    doi = Column(String(256), nullable=True, index=True)
    pmid = Column(String(64), nullable=True, index=True)
    pmcid = Column(String(64), nullable=True)
    arxiv_id = Column(String(64), nullable=True)
    isbn = Column(String(32), nullable=True)
    url = Column(Text, nullable=True)

    # Organization.
    tags = Column(ARRAY(String), nullable=False, default=list)
    folders = Column(JSONB, nullable=False, default=list)   # list[uuid-str]
    starred = Column(Boolean, nullable=False, default=False, index=True)
    read = Column(Boolean, nullable=False, default=False, index=True)
    notes = Column(Text, nullable=True)

    # User-editable BibTeX cite key (e.g. "smith2024alpha"). Unique per
    # library would be ideal but Mendeley doesn't enforce it either —
    # left nullable for painless round-trip with BibTeX imports that
    # may lack keys or have duplicates.
    cite_key = Column(String(128), nullable=True)

    # PDF attachment.
    pdf_url = Column(Text, nullable=True)            # external URL OR blob URL
    pdf_file_id = Column(String(256), nullable=True) # ingestion_jobs.id when uploaded via /ingestion

    # Full CSL-JSON payload for lossless re-export.
    csl_json = Column(JSONB, nullable=False, default=dict)


class CitationFolder(BaseModel):
    __tablename__ = "citation_folders"

    # Owner — folders are per-user collections. See migration
    # 015_owner_id_on_sessions_and_citations.
    owner_id = Column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    name = Column(String(256), nullable=False)
    parent_id = Column(PGUUID(as_uuid=True), nullable=True, index=True)
    color = Column(String(32), nullable=True)   # hex, optional for sidebar accent
    icon = Column(String(32), nullable=True)    # emoji / icon key
    order_index = Column(Integer, nullable=False, default=0)
    project_id = Column(PGUUID(as_uuid=True), nullable=True, index=True)


class CitationHighlight(BaseModel):
    __tablename__ = "citation_highlights"

    citation_id = Column(PGUUID(as_uuid=True), nullable=False, index=True)
    page = Column(Integer, nullable=False)
    # Bounding box in page-normalized coords:
    #   { x: 0-1, y: 0-1, w: 0-1, h: 0-1 }
    rect = Column(JSONB, nullable=False, default=dict)
    # Optional selected text (helps when the PDF re-flows across
    # pdfjs versions).
    text = Column(Text, nullable=True)
    # Accent color — kept to the app's muted palette set.
    color = Column(String(32), nullable=False, default="#C4956A")
    note = Column(Text, nullable=True)
