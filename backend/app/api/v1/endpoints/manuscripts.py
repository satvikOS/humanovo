"""
Publication / Manuscript Manager API Endpoints

Manuscript CRUD, co-author management, journal formatting, submission tracking.
"""

import logging
from datetime import datetime
from typing import Optional
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel

logger = logging.getLogger(__name__)
router = APIRouter()

_manuscripts: dict[str, dict] = {}


def _seed():
    if _manuscripts:
        return
    mid = str(uuid4())
    _manuscripts[mid] = {
        "id": mid,
        "title": "Novel EGFR Inhibitor Shows Promise in NSCLC: A Phase II Analysis",
        "status": "draft",
        "journal_target": "Nature Medicine",
        "sections": {
            "abstract": "Background: Epidermal growth factor receptor (EGFR) mutations drive ~15-30% of non-small cell lung cancers (NSCLC)...",
            "introduction": "# Introduction\n\nNon-small cell lung cancer (NSCLC) remains the leading cause of cancer-related mortality worldwide...",
            "methods": "# Methods\n\n## Study Design\nA randomized, double-blind, placebo-controlled Phase II trial...",
            "results": "# Results\n\n## Patient Demographics\nBetween June 2024 and December 2025, 120 patients were enrolled...",
            "discussion": "# Discussion\n\nOur findings demonstrate that HN-4521 significantly improves...",
            "references": "1. Herbst RS, et al. The biology and management of non-small cell lung cancer. Nature. 2018.\n2. Mok TS, et al. Gefitinib or carboplatin-paclitaxel in pulmonary adenocarcinoma. NEJM. 2009.",
        },
        "authors": [
            {"id": str(uuid4()), "name": "Dr. Sarah Chen", "affiliation": "HumaNovo Research Institute", "email": "sarah.chen@research.org", "role": "First Author", "order": 1},
            {"id": str(uuid4()), "name": "Dr. James Wilson", "affiliation": "HumaNovo Research Institute", "email": "james.wilson@research.org", "role": "Co-Author", "order": 2},
            {"id": str(uuid4()), "name": "Dr. Priya Patel", "affiliation": "City Medical Center", "email": "priya.patel@research.org", "role": "Senior Author", "order": 3},
        ],
        "keywords": ["EGFR", "NSCLC", "targeted therapy", "phase II trial"],
        "submission_history": [],
        "word_count": 4500,
        "created_at": datetime.utcnow().isoformat(),
        "updated_at": datetime.utcnow().isoformat(),
    }


_seed()


JOURNAL_TEMPLATES = {
    "Nature Medicine": {"max_words": 5000, "abstract_max": 150, "format": "nature", "reference_style": "numbered"},
    "NEJM": {"max_words": 2500, "abstract_max": 250, "format": "nejm", "reference_style": "numbered"},
    "The Lancet": {"max_words": 4500, "abstract_max": 300, "format": "lancet", "reference_style": "numbered"},
    "JAMA": {"max_words": 3000, "abstract_max": 350, "format": "jama", "reference_style": "numbered"},
    "Science": {"max_words": 4500, "abstract_max": 125, "format": "science", "reference_style": "numbered"},
    "PLOS ONE": {"max_words": 0, "abstract_max": 300, "format": "plos", "reference_style": "vancouver"},
    "BMJ": {"max_words": 4000, "abstract_max": 250, "format": "bmj", "reference_style": "vancouver"},
    "Cell": {"max_words": 7000, "abstract_max": 150, "format": "cell", "reference_style": "numbered"},
}


class ManuscriptCreate(BaseModel):
    title: str
    journal_target: str = ""
    keywords: list[str] = []


class ManuscriptUpdate(BaseModel):
    title: Optional[str] = None
    status: Optional[str] = None
    journal_target: Optional[str] = None
    sections: Optional[dict] = None
    keywords: Optional[list[str]] = None


class AuthorCreate(BaseModel):
    name: str
    affiliation: str = ""
    email: str = ""
    role: str = "Co-Author"


class SubmissionCreate(BaseModel):
    journal: str
    notes: str = ""


@router.get("/")
async def list_manuscripts():
    items = sorted(_manuscripts.values(), key=lambda m: m["updated_at"], reverse=True)
    return {"items": items, "total": len(items)}


@router.post("/")
async def create_manuscript(data: ManuscriptCreate):
    mid = str(uuid4())
    now = datetime.utcnow().isoformat()
    ms = {
        "id": mid, "title": data.title, "status": "draft",
        "journal_target": data.journal_target,
        "sections": {"abstract": "", "introduction": "", "methods": "", "results": "", "discussion": "", "references": ""},
        "authors": [], "keywords": data.keywords, "submission_history": [],
        "word_count": 0, "created_at": now, "updated_at": now,
    }
    _manuscripts[mid] = ms
    return ms


@router.get("/{manuscript_id}")
async def get_manuscript(manuscript_id: str):
    if manuscript_id not in _manuscripts:
        raise HTTPException(status_code=404, detail="Manuscript not found")
    return _manuscripts[manuscript_id]


@router.patch("/{manuscript_id}")
async def update_manuscript(manuscript_id: str, data: ManuscriptUpdate):
    if manuscript_id not in _manuscripts:
        raise HTTPException(status_code=404, detail="Manuscript not found")
    ms = _manuscripts[manuscript_id]
    if data.title is not None: ms["title"] = data.title
    if data.status is not None: ms["status"] = data.status
    if data.journal_target is not None: ms["journal_target"] = data.journal_target
    if data.keywords is not None: ms["keywords"] = data.keywords
    if data.sections is not None:
        ms["sections"].update(data.sections)
        ms["word_count"] = sum(len(s.split()) for s in ms["sections"].values())
    ms["updated_at"] = datetime.utcnow().isoformat()
    return ms


@router.delete("/{manuscript_id}")
async def delete_manuscript(manuscript_id: str):
    if manuscript_id not in _manuscripts:
        raise HTTPException(status_code=404, detail="Manuscript not found")
    del _manuscripts[manuscript_id]
    return {"status": "deleted"}


@router.get("/{manuscript_id}/authors")
async def list_authors(manuscript_id: str):
    if manuscript_id not in _manuscripts:
        raise HTTPException(status_code=404, detail="Manuscript not found")
    return {"authors": _manuscripts[manuscript_id].get("authors", [])}


@router.post("/{manuscript_id}/authors")
async def add_author(manuscript_id: str, data: AuthorCreate):
    if manuscript_id not in _manuscripts:
        raise HTTPException(status_code=404, detail="Manuscript not found")
    ms = _manuscripts[manuscript_id]
    author = {
        "id": str(uuid4()), "name": data.name, "affiliation": data.affiliation,
        "email": data.email, "role": data.role, "order": len(ms["authors"]) + 1,
    }
    ms["authors"].append(author)
    ms["updated_at"] = datetime.utcnow().isoformat()
    return author


@router.delete("/{manuscript_id}/authors/{author_id}")
async def remove_author(manuscript_id: str, author_id: str):
    if manuscript_id not in _manuscripts:
        raise HTTPException(status_code=404, detail="Manuscript not found")
    ms = _manuscripts[manuscript_id]
    ms["authors"] = [a for a in ms["authors"] if a["id"] != author_id]
    for i, a in enumerate(ms["authors"]):
        a["order"] = i + 1
    return {"status": "removed"}


@router.get("/{manuscript_id}/export")
async def export_manuscript(manuscript_id: str, format: str = Query("markdown")):
    if manuscript_id not in _manuscripts:
        raise HTTPException(status_code=404, detail="Manuscript not found")
    ms = _manuscripts[manuscript_id]

    authors_str = ", ".join(f"{a['name']} ({a['affiliation']})" for a in ms["authors"])
    sections = ms["sections"]

    if format == "markdown":
        content = f"# {ms['title']}\n\n**Authors:** {authors_str}\n\n**Keywords:** {', '.join(ms['keywords'])}\n\n"
        for section_name in ["abstract", "introduction", "methods", "results", "discussion", "references"]:
            text = sections.get(section_name, "")
            if text:
                content += f"\n## {section_name.title()}\n\n{text}\n\n"
        return Response(content=content, media_type="text/markdown",
                       headers={"Content-Disposition": f"attachment; filename={ms['title'][:50]}.md"})

    return {"content": sections, "title": ms["title"], "authors": authors_str}


@router.post("/{manuscript_id}/submit")
async def submit_manuscript(manuscript_id: str, data: SubmissionCreate):
    if manuscript_id not in _manuscripts:
        raise HTTPException(status_code=404, detail="Manuscript not found")
    ms = _manuscripts[manuscript_id]
    submission = {
        "id": str(uuid4()), "journal": data.journal, "notes": data.notes,
        "status": "submitted", "submitted_at": datetime.utcnow().isoformat(),
    }
    ms["submission_history"].append(submission)
    ms["status"] = "submitted"
    ms["updated_at"] = datetime.utcnow().isoformat()
    return submission


@router.get("/templates/journals")
async def list_journal_templates():
    return {"journals": JOURNAL_TEMPLATES}
