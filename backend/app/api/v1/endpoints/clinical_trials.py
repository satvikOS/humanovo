"""
Clinical Trial Management API Endpoints

Protocol registry, subject enrollment, visit scheduling,
regulatory documents, and budget tracking.
"""

import logging
from datetime import datetime
from typing import Optional
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

logger = logging.getLogger(__name__)
router = APIRouter()

_trials: dict[str, dict] = {}
_subjects: dict[str, dict] = {}
_visits: dict[str, dict] = {}
_documents: dict[str, dict] = {}


def _seed():
    if _trials:
        return
    tid = str(uuid4())
    _trials[tid] = {
        "id": tid, "protocol_number": "NCT-2024-001",
        "title": "Phase II Trial of Novel EGFR Inhibitor in NSCLC",
        "phase": "Phase II", "status": "recruiting",
        "pi": "Dr. Sarah Chen", "sponsor": "HumaNovo Research Institute",
        "start_date": "2024-06-01", "estimated_end": "2026-06-01",
        "target_enrollment": 120, "current_enrollment": 45,
        "description": "A randomized, double-blind, placebo-controlled study evaluating the efficacy and safety of HN-4521 in patients with EGFR-mutant non-small cell lung cancer.",
        "arms": [
            {"name": "Treatment", "description": "HN-4521 150mg daily", "target_n": 60},
            {"name": "Placebo", "description": "Matching placebo daily", "target_n": 60},
        ],
        "budget": {
            "total": 2500000, "spent": 875000,
            "categories": [
                {"name": "Personnel", "budgeted": 800000, "spent": 320000},
                {"name": "Drug Supply", "budgeted": 600000, "spent": 210000},
                {"name": "Lab Tests", "budgeted": 400000, "spent": 145000},
                {"name": "Equipment", "budgeted": 300000, "spent": 100000},
                {"name": "Travel", "budgeted": 150000, "spent": 50000},
                {"name": "Overhead", "budgeted": 250000, "spent": 50000},
            ],
        },
        "created_at": datetime.utcnow().isoformat(),
        "updated_at": datetime.utcnow().isoformat(),
    }

    # Seed some subjects
    for i, (sid_str, name, age, sex, arm, status) in enumerate([
        ("S001", "Patient 001", 58, "M", "Treatment", "active"),
        ("S002", "Patient 002", 45, "F", "Placebo", "active"),
        ("S003", "Patient 003", 62, "M", "Treatment", "completed"),
        ("S004", "Patient 004", 51, "F", "Treatment", "withdrawn"),
        ("S005", "Patient 005", 67, "M", "Placebo", "active"),
    ]):
        subj_id = str(uuid4())
        _subjects[subj_id] = {
            "id": subj_id, "trial_id": tid, "subject_number": sid_str,
            "display_name": name, "age": age, "sex": sex,
            "arm": arm, "status": status,
            "enrolled_date": f"2024-{7+i:02d}-{10+i:02d}",
            "created_at": datetime.utcnow().isoformat(),
        }

    # Seed documents
    for dtype, dname, dstatus in [
        ("protocol", "Study Protocol v3.0", "approved"),
        ("consent", "Informed Consent Form v2.1", "approved"),
        ("irb", "IRB Approval Letter", "approved"),
        ("amendment", "Protocol Amendment #1", "pending"),
    ]:
        did = str(uuid4())
        _documents[did] = {
            "id": did, "trial_id": tid, "document_type": dtype,
            "name": dname, "status": dstatus, "version": "1.0",
            "uploaded_by": "Dr. Sarah Chen",
            "created_at": datetime.utcnow().isoformat(),
        }


_seed()


class TrialCreate(BaseModel):
    protocol_number: str
    title: str
    phase: str = "Phase I"
    description: str = ""
    pi: str = ""
    sponsor: str = ""
    target_enrollment: int = 0
    start_date: Optional[str] = None
    estimated_end: Optional[str] = None


class TrialUpdate(BaseModel):
    title: Optional[str] = None
    status: Optional[str] = None
    description: Optional[str] = None
    target_enrollment: Optional[int] = None


class SubjectCreate(BaseModel):
    trial_id: str
    subject_number: str
    display_name: str = ""
    age: Optional[int] = None
    sex: Optional[str] = None
    arm: str = ""


class VisitCreate(BaseModel):
    trial_id: str
    subject_id: str
    visit_name: str
    scheduled_date: str
    status: str = "scheduled"
    notes: str = ""


class DocumentCreate(BaseModel):
    trial_id: str
    document_type: str
    name: str
    version: str = "1.0"


class BudgetUpdate(BaseModel):
    categories: list[dict]


# ── Trial CRUD ───────────────────────────────────────────────────

@router.get("/")
async def list_trials():
    items = sorted(_trials.values(), key=lambda t: t["created_at"], reverse=True)
    return {"items": items, "total": len(items)}


@router.post("/")
async def create_trial(data: TrialCreate):
    tid = str(uuid4())
    now = datetime.utcnow().isoformat()
    trial = {
        "id": tid, "protocol_number": data.protocol_number, "title": data.title,
        "phase": data.phase, "status": "planning", "pi": data.pi, "sponsor": data.sponsor,
        "description": data.description, "target_enrollment": data.target_enrollment,
        "current_enrollment": 0, "start_date": data.start_date, "estimated_end": data.estimated_end,
        "arms": [], "budget": {"total": 0, "spent": 0, "categories": []},
        "created_at": now, "updated_at": now,
    }
    _trials[tid] = trial
    return trial


@router.get("/{trial_id}")
async def get_trial(trial_id: str):
    if trial_id not in _trials:
        raise HTTPException(status_code=404, detail="Trial not found")
    return _trials[trial_id]


@router.patch("/{trial_id}")
async def update_trial(trial_id: str, data: TrialUpdate):
    if trial_id not in _trials:
        raise HTTPException(status_code=404, detail="Trial not found")
    trial = _trials[trial_id]
    if data.title is not None: trial["title"] = data.title
    if data.status is not None: trial["status"] = data.status
    if data.description is not None: trial["description"] = data.description
    if data.target_enrollment is not None: trial["target_enrollment"] = data.target_enrollment
    trial["updated_at"] = datetime.utcnow().isoformat()
    return trial


@router.delete("/{trial_id}")
async def delete_trial(trial_id: str):
    if trial_id not in _trials:
        raise HTTPException(status_code=404, detail="Trial not found")
    del _trials[trial_id]
    return {"status": "deleted"}


# ── Subjects ─────────────────────────────────────────────────────

@router.get("/{trial_id}/subjects")
async def list_subjects(trial_id: str):
    items = [s for s in _subjects.values() if s["trial_id"] == trial_id]
    items.sort(key=lambda s: s["created_at"], reverse=True)
    return {"items": items, "total": len(items)}


@router.post("/{trial_id}/subjects")
async def enroll_subject(trial_id: str, data: SubjectCreate):
    if trial_id not in _trials:
        raise HTTPException(status_code=404, detail="Trial not found")
    sid = str(uuid4())
    subject = {
        "id": sid, "trial_id": trial_id, "subject_number": data.subject_number,
        "display_name": data.display_name, "age": data.age, "sex": data.sex,
        "arm": data.arm, "status": "active",
        "enrolled_date": datetime.utcnow().strftime("%Y-%m-%d"),
        "created_at": datetime.utcnow().isoformat(),
    }
    _subjects[sid] = subject
    _trials[trial_id]["current_enrollment"] = sum(1 for s in _subjects.values() if s["trial_id"] == trial_id and s["status"] == "active")
    return subject


@router.patch("/{trial_id}/subjects/{subject_id}")
async def update_subject(trial_id: str, subject_id: str, status: str = Query(...)):
    if subject_id not in _subjects:
        raise HTTPException(status_code=404, detail="Subject not found")
    _subjects[subject_id]["status"] = status
    if trial_id in _trials:
        _trials[trial_id]["current_enrollment"] = sum(1 for s in _subjects.values() if s["trial_id"] == trial_id and s["status"] == "active")
    return _subjects[subject_id]


# ── Visits ───────────────────────────────────────────────────────

@router.get("/{trial_id}/visits")
async def list_visits(trial_id: str, subject_id: Optional[str] = None):
    items = [v for v in _visits.values() if v["trial_id"] == trial_id]
    if subject_id:
        items = [v for v in items if v["subject_id"] == subject_id]
    items.sort(key=lambda v: v["scheduled_date"])
    return {"items": items, "total": len(items)}


@router.post("/{trial_id}/visits")
async def create_visit(trial_id: str, data: VisitCreate):
    vid = str(uuid4())
    visit = {
        "id": vid, "trial_id": trial_id, "subject_id": data.subject_id,
        "visit_name": data.visit_name, "scheduled_date": data.scheduled_date,
        "status": data.status, "notes": data.notes,
        "created_at": datetime.utcnow().isoformat(),
    }
    _visits[vid] = visit
    return visit


# ── Documents ────────────────────────────────────────────────────

@router.get("/{trial_id}/documents")
async def list_documents(trial_id: str):
    items = [d for d in _documents.values() if d["trial_id"] == trial_id]
    return {"items": items, "total": len(items)}


@router.post("/{trial_id}/documents")
async def add_document(trial_id: str, data: DocumentCreate):
    did = str(uuid4())
    doc = {
        "id": did, "trial_id": trial_id, "document_type": data.document_type,
        "name": data.name, "status": "pending", "version": data.version,
        "uploaded_by": "Current User",
        "created_at": datetime.utcnow().isoformat(),
    }
    _documents[did] = doc
    return doc


# ── Budget ───────────────────────────────────────────────────────

@router.get("/{trial_id}/budget")
async def get_budget(trial_id: str):
    if trial_id not in _trials:
        raise HTTPException(status_code=404, detail="Trial not found")
    return _trials[trial_id].get("budget", {})


@router.patch("/{trial_id}/budget")
async def update_budget(trial_id: str, data: BudgetUpdate):
    if trial_id not in _trials:
        raise HTTPException(status_code=404, detail="Trial not found")
    budget = _trials[trial_id].get("budget", {})
    budget["categories"] = data.categories
    budget["total"] = sum(c.get("budgeted", 0) for c in data.categories)
    budget["spent"] = sum(c.get("spent", 0) for c in data.categories)
    _trials[trial_id]["budget"] = budget
    return budget
