"""
Regulatory / Compliance Tracking API Endpoints

IRB submissions, data use agreements, consent forms, compliance checklists.
"""

import logging
from datetime import datetime
from typing import Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.platform_entities import (
    ComplianceChecklist,
    ConsentForm,
    DataUseAgreement,
    IRBSubmission,
)
from app.api.v1.endpoints._bulk import attach_bulk_delete

logger = logging.getLogger(__name__)
router = APIRouter()


# ── Schemas ─────────────────────────────────────────────────────


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


# ── IRB ─────────────────────────────────────────────────────────


@router.get("/irb-submissions")
async def list_irb(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(IRBSubmission).order_by(IRBSubmission.created_at.desc())
    )
    items = result.scalars().all()
    return {"items": [i.to_dict() for i in items], "total": len(items)}


@router.post("/irb-submissions")
async def create_irb(data: IRBCreate, db: AsyncSession = Depends(get_db)):
    now = datetime.utcnow()
    submission = IRBSubmission(
        protocol_title=data.protocol_title,
        irb_number=f"IRB-{now.year}-{str(uuid4())[:4]}",
        status="pending",
        submission_date=now.strftime("%Y-%m-%d"),
        approval_date=None,
        expiration_date=None,
        pi=data.pi,
        risk_level=data.risk_level,
        review_type=data.review_type,
        history=[
            {
                "date": now.strftime("%Y-%m-%d"),
                "action": "Submitted",
                "notes": "Initial submission",
            }
        ],
    )
    db.add(submission)
    await db.flush()
    return submission.to_dict()


@router.get("/irb-submissions/{irb_id}")
async def get_irb(irb_id: str, db: AsyncSession = Depends(get_db)):
    submission = await db.get(IRBSubmission, irb_id)
    if not submission:
        raise HTTPException(status_code=404, detail="IRB submission not found")
    return submission.to_dict()


@router.delete("/irb-submissions/{irb_id}")
async def delete_irb(irb_id: str, db: AsyncSession = Depends(get_db)):
    submission = await db.get(IRBSubmission, irb_id)
    if not submission:
        raise HTTPException(status_code=404, detail="IRB submission not found")
    await db.delete(submission)
    await db.flush()
    return {"status": "deleted"}


# ── Agreements ──────────────────────────────────────────────────


@router.get("/agreements")
async def list_agreements(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(DataUseAgreement))
    items = result.scalars().all()
    return {"items": [a.to_dict() for a in items], "total": len(items)}


@router.post("/agreements")
async def create_agreement(data: AgreementCreate, db: AsyncSession = Depends(get_db)):
    agreement = DataUseAgreement(
        title=data.title,
        agreement_type=data.agreement_type,
        status="draft",
        party=data.party,
        data_types=data.data_types,
        start_date=data.start_date,
        end_date=data.end_date,
        restrictions=[],
    )
    db.add(agreement)
    await db.flush()
    return agreement.to_dict()


@router.delete("/agreements/{agreement_id}")
async def delete_agreement(agreement_id: str, db: AsyncSession = Depends(get_db)):
    agreement = await db.get(DataUseAgreement, agreement_id)
    if not agreement:
        raise HTTPException(status_code=404, detail="Agreement not found")
    await db.delete(agreement)
    await db.flush()
    return {"status": "deleted"}


# ── Consent Forms ───────────────────────────────────────────────


@router.get("/consent-forms")
async def list_consent_forms(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(ConsentForm))
    items = result.scalars().all()
    return {"items": [f.to_dict() for f in items], "total": len(items)}


@router.post("/consent-forms")
async def create_consent_form(data: ConsentFormCreate, db: AsyncSession = Depends(get_db)):
    now = datetime.utcnow()
    form = ConsentForm(
        title=data.title,
        version=data.version,
        status="draft",
        language=data.language,
        irb_approved=False,
        versions=[
            {
                "version": data.version,
                "date": now.strftime("%Y-%m-%d"),
                "changes": "Initial version",
            }
        ],
    )
    db.add(form)
    await db.flush()
    return form.to_dict()


@router.delete("/consent-forms/{form_id}")
async def delete_consent_form(form_id: str, db: AsyncSession = Depends(get_db)):
    form = await db.get(ConsentForm, form_id)
    if not form:
        raise HTTPException(status_code=404, detail="Consent form not found")
    await db.delete(form)
    await db.flush()
    return {"status": "deleted"}


# ── Checklists ──────────────────────────────────────────────────


@router.get("/checklists")
async def list_checklists(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(ComplianceChecklist))
    items = result.scalars().all()
    return {"items": [c.to_dict() for c in items], "total": len(items)}


@router.patch("/checklists/{checklist_id}")
async def update_checklist(
    checklist_id: str,
    data: ChecklistUpdate,
    db: AsyncSession = Depends(get_db),
):
    checklist = await db.get(ComplianceChecklist, checklist_id)
    if not checklist:
        raise HTTPException(status_code=404, detail="Checklist not found")
    checklist.items = data.items
    completed = sum(1 for i in data.items if i.get("completed"))
    checklist.completion_pct = round(completed / len(data.items) * 100) if data.items else 0
    checklist.last_reviewed = datetime.utcnow().isoformat()
    await db.flush()
    return checklist.to_dict()


# Bulk-delete hooks for each regulatory sub-resource. Archive isn't
# provided here because the status fields for these resources carry
# domain-specific meaning (e.g. "approved" for IRB submissions) that
# shouldn't be overwritten with "archived".
attach_bulk_delete(router, IRBSubmission, path="/irb-submissions/bulk-delete")
attach_bulk_delete(router, DataUseAgreement, path="/agreements/bulk-delete")
attach_bulk_delete(router, ConsentForm, path="/consent-forms/bulk-delete")
attach_bulk_delete(router, ComplianceChecklist, path="/checklists/bulk-delete")
