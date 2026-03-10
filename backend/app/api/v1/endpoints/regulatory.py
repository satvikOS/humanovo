"""
Regulatory / Compliance Tracking API Endpoints

IRB submissions, data use agreements, consent forms, compliance checklists.
"""

import logging
from datetime import datetime
from typing import Optional
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

logger = logging.getLogger(__name__)
router = APIRouter()

_irb_submissions: dict[str, dict] = {}
_agreements: dict[str, dict] = {}
_consent_forms: dict[str, dict] = {}
_checklists: dict[str, dict] = {}


def _seed():
    if _irb_submissions:
        return

    iid = str(uuid4())
    _irb_submissions[iid] = {
        "id": iid, "protocol_title": "Phase II Trial of Novel EGFR Inhibitor",
        "irb_number": "IRB-2024-0451", "status": "approved",
        "submission_date": "2024-03-15", "approval_date": "2024-05-01",
        "expiration_date": "2025-05-01", "pi": "Dr. Sarah Chen",
        "risk_level": "greater_than_minimal",
        "review_type": "full_board",
        "history": [
            {"date": "2024-03-15", "action": "Submitted", "notes": "Initial submission"},
            {"date": "2024-04-10", "action": "Revisions Requested", "notes": "Clarify consent process"},
            {"date": "2024-04-20", "action": "Revisions Submitted", "notes": "Updated consent form"},
            {"date": "2024-05-01", "action": "Approved", "notes": "Full board approval granted"},
        ],
        "created_at": datetime.utcnow().isoformat(),
    }

    aid = str(uuid4())
    _agreements[aid] = {
        "id": aid, "title": "Data Use Agreement - City Hospital",
        "agreement_type": "DUA", "status": "active",
        "party": "City Medical Center", "start_date": "2024-06-01",
        "end_date": "2026-06-01", "data_types": ["demographics", "genomics", "imaging"],
        "restrictions": ["No re-identification", "Destroy after study completion"],
        "created_at": datetime.utcnow().isoformat(),
    }

    cid = str(uuid4())
    _consent_forms[cid] = {
        "id": cid, "title": "Informed Consent - EGFR Trial",
        "version": "2.1", "status": "active",
        "language": "English", "irb_approved": True,
        "versions": [
            {"version": "1.0", "date": "2024-03-01", "changes": "Initial version"},
            {"version": "2.0", "date": "2024-04-15", "changes": "Updated risk section per IRB feedback"},
            {"version": "2.1", "date": "2024-04-25", "changes": "Minor language clarifications"},
        ],
        "created_at": datetime.utcnow().isoformat(),
    }

    for framework, items in [
        ("HIPAA", [
            ("Privacy Rule compliance", True), ("Security Rule compliance", True),
            ("Breach notification plan", True), ("Business associate agreements", True),
            ("Minimum necessary standard", False), ("Patient access rights", True),
        ]),
        ("GCP", [
            ("Investigator qualifications", True), ("Protocol compliance", True),
            ("Informed consent process", True), ("IRB/IEC approval", True),
            ("Adverse event reporting", True), ("Source data verification", False),
        ]),
        ("GDPR", [
            ("Lawful basis for processing", True), ("Data protection impact assessment", False),
            ("Data subject rights", True), ("Data processing records", True),
            ("Cross-border transfer safeguards", False),
        ]),
    ]:
        clid = str(uuid4())
        _checklists[clid] = {
            "id": clid, "framework": framework,
            "items": [{"name": name, "completed": completed, "notes": ""} for name, completed in items],
            "completion_pct": round(sum(1 for _, c in items if c) / len(items) * 100),
            "last_reviewed": datetime.utcnow().isoformat(),
            "created_at": datetime.utcnow().isoformat(),
        }


_seed()


class IRBCreate(BaseModel):
    protocol_title: str
    pi: str = ""
    risk_level: str = "minimal"
    review_type: str = "expedited"


class AgreementCreate(BaseModel):
    title: str
    agreement_type: str = "DUA"
    party: str = ""
    data_types: list[str] = []
    start_date: Optional[str] = None
    end_date: Optional[str] = None


class ConsentFormCreate(BaseModel):
    title: str
    version: str = "1.0"
    language: str = "English"


class ChecklistUpdate(BaseModel):
    items: list[dict]


# ── IRB ──────────────────────────────────────────────────────────

@router.get("/irb-submissions")
async def list_irb():
    items = sorted(_irb_submissions.values(), key=lambda i: i["created_at"], reverse=True)
    return {"items": items, "total": len(items)}


@router.post("/irb-submissions")
async def create_irb(data: IRBCreate):
    iid = str(uuid4())
    submission = {
        "id": iid, "protocol_title": data.protocol_title,
        "irb_number": f"IRB-{datetime.utcnow().year}-{str(uuid4())[:4]}",
        "status": "pending", "submission_date": datetime.utcnow().strftime("%Y-%m-%d"),
        "approval_date": None, "expiration_date": None,
        "pi": data.pi, "risk_level": data.risk_level,
        "review_type": data.review_type,
        "history": [{"date": datetime.utcnow().strftime("%Y-%m-%d"), "action": "Submitted", "notes": "Initial submission"}],
        "created_at": datetime.utcnow().isoformat(),
    }
    _irb_submissions[iid] = submission
    return submission


@router.get("/irb-submissions/{irb_id}")
async def get_irb(irb_id: str):
    if irb_id not in _irb_submissions:
        raise HTTPException(status_code=404, detail="IRB submission not found")
    return _irb_submissions[irb_id]


@router.delete("/irb-submissions/{irb_id}")
async def delete_irb(irb_id: str):
    if irb_id not in _irb_submissions:
        raise HTTPException(status_code=404, detail="IRB submission not found")
    del _irb_submissions[irb_id]
    return {"status": "deleted"}


# ── Agreements ───────────────────────────────────────────────────

@router.get("/agreements")
async def list_agreements():
    return {"items": list(_agreements.values()), "total": len(_agreements)}


@router.post("/agreements")
async def create_agreement(data: AgreementCreate):
    aid = str(uuid4())
    agreement = {
        "id": aid, "title": data.title, "agreement_type": data.agreement_type,
        "status": "draft", "party": data.party, "data_types": data.data_types,
        "start_date": data.start_date, "end_date": data.end_date,
        "restrictions": [], "created_at": datetime.utcnow().isoformat(),
    }
    _agreements[aid] = agreement
    return agreement


@router.delete("/agreements/{agreement_id}")
async def delete_agreement(agreement_id: str):
    if agreement_id not in _agreements:
        raise HTTPException(status_code=404, detail="Agreement not found")
    del _agreements[agreement_id]
    return {"status": "deleted"}


# ── Consent Forms ────────────────────────────────────────────────

@router.get("/consent-forms")
async def list_consent_forms():
    return {"items": list(_consent_forms.values()), "total": len(_consent_forms)}


@router.post("/consent-forms")
async def create_consent_form(data: ConsentFormCreate):
    cid = str(uuid4())
    form = {
        "id": cid, "title": data.title, "version": data.version,
        "status": "draft", "language": data.language, "irb_approved": False,
        "versions": [{"version": data.version, "date": datetime.utcnow().strftime("%Y-%m-%d"), "changes": "Initial version"}],
        "created_at": datetime.utcnow().isoformat(),
    }
    _consent_forms[cid] = form
    return form


@router.delete("/consent-forms/{form_id}")
async def delete_consent_form(form_id: str):
    if form_id not in _consent_forms:
        raise HTTPException(status_code=404, detail="Consent form not found")
    del _consent_forms[form_id]
    return {"status": "deleted"}


# ── Checklists ───────────────────────────────────────────────────

@router.get("/checklists")
async def list_checklists():
    return {"items": list(_checklists.values()), "total": len(_checklists)}


@router.patch("/checklists/{checklist_id}")
async def update_checklist(checklist_id: str, data: ChecklistUpdate):
    if checklist_id not in _checklists:
        raise HTTPException(status_code=404, detail="Checklist not found")
    cl = _checklists[checklist_id]
    cl["items"] = data.items
    completed = sum(1 for i in data.items if i.get("completed"))
    cl["completion_pct"] = round(completed / len(data.items) * 100) if data.items else 0
    cl["last_reviewed"] = datetime.utcnow().isoformat()
    return cl
