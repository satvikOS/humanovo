"""
Clinical Trial Management API Endpoints

Protocol registry, subject enrollment, visit scheduling,
regulatory documents, and budget tracking.

Tenant isolation (Round 10): trial-level rows filter by owner_id =
current_user.id; child rows (subjects, documents) inherit ownership
through the parent trial. Cross-tenant access returns 404.
"""

import logging
from datetime import UTC, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints._bulk import attach_bulk_archive, attach_bulk_delete
from app.core.auth import AUTH_REQUIRED, get_current_active_user
from app.core.database import get_db
from app.core.ownership import fetch_owned_directly_or_404, filter_by_owner
from app.models.platform_entities import ClinicalTrial, TrialDocument, TrialSubject
from app.models.user import User

logger = logging.getLogger(__name__)
router = APIRouter(dependencies=AUTH_REQUIRED)
# ── Schemas ─────────────────────────────────────────────────────


class TrialCreate(BaseModel):
    protocol_number: str
    title: str
    phase: str = "Phase I"
    description: str = ""
    pi: str = ""
    sponsor: str = ""
    target_enrollment: int = 0
    start_date: str | None = None
    estimated_end: str | None = None


class TrialUpdate(BaseModel):
    title: str | None = None
    status: str | None = None
    description: str | None = None
    target_enrollment: int | None = None


class SubjectCreate(BaseModel):
    trial_id: str
    subject_number: str
    display_name: str = ""
    age: int | None = None
    sex: str | None = None
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


# ── Trial CRUD ──────────────────────────────────────────────────


@router.get("", include_in_schema=False)
@router.get("/")
async def list_trials(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    query = filter_by_owner(select(ClinicalTrial), ClinicalTrial, current_user)
    result = await db.execute(query.order_by(ClinicalTrial.created_at.desc()))
    items = result.scalars().all()
    return {"items": [t.to_dict() for t in items], "total": len(items)}


@router.post("", include_in_schema=False)
@router.post("/")
async def create_trial(
    data: TrialCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    trial = ClinicalTrial(
        owner_id=current_user.id,
        protocol_number=data.protocol_number,
        title=data.title,
        phase=data.phase,
        status="planning",
        pi=data.pi,
        sponsor=data.sponsor,
        description=data.description,
        target_enrollment=data.target_enrollment,
        current_enrollment=0,
        start_date=data.start_date,
        estimated_end=data.estimated_end,
        arms=[],
        budget={"total": 0, "spent": 0, "categories": []},
    )
    db.add(trial)
    await db.flush()
    return trial.to_dict()


@router.get("/{trial_id}")
async def get_trial(
    trial_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    trial = await fetch_owned_directly_or_404(db, ClinicalTrial, trial_id, current_user)
    return trial.to_dict()


@router.patch("/{trial_id}")
async def update_trial(
    trial_id: UUID,
    data: TrialUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    trial = await fetch_owned_directly_or_404(db, ClinicalTrial, trial_id, current_user)
    updates = data.model_dump(exclude_unset=True)
    trial.update_from_dict(updates)
    await db.flush()
    return trial.to_dict()


@router.delete("/{trial_id}")
async def delete_trial(
    trial_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    trial = await fetch_owned_directly_or_404(db, ClinicalTrial, trial_id, current_user)
    await db.delete(trial)
    await db.flush()
    return {"status": "deleted"}


# ── Subjects (transitive ownership through parent trial) ──────────


@router.get("/{trial_id}/subjects")
async def list_subjects(
    trial_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    # Verify the parent trial is owned by the caller before listing children.
    await fetch_owned_directly_or_404(db, ClinicalTrial, trial_id, current_user)
    result = await db.execute(
        select(TrialSubject)
        .where(TrialSubject.trial_id == trial_id)
        .order_by(TrialSubject.created_at.desc())
    )
    items = result.scalars().all()
    return {"items": [s.to_dict() for s in items], "total": len(items)}


@router.post("/{trial_id}/subjects")
async def enroll_subject(
    trial_id: UUID,
    data: SubjectCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    trial = await fetch_owned_directly_or_404(db, ClinicalTrial, trial_id, current_user)
    subject = TrialSubject(
        trial_id=trial_id,
        subject_number=data.subject_number,
        display_name=data.display_name,
        age=data.age,
        sex=data.sex,
        arm=data.arm,
        status="active",
        enrolled_date=datetime.now(UTC).strftime("%Y-%m-%d"),
    )
    db.add(subject)
    await db.flush()

    # Update current enrollment count on the trial
    count_result = await db.execute(
        select(func.count())
        .select_from(TrialSubject)
        .where(TrialSubject.trial_id == trial_id, TrialSubject.status == "active")
    )
    trial.current_enrollment = count_result.scalar() or 0
    await db.flush()

    return subject.to_dict()


@router.patch("/{trial_id}/subjects/{subject_id}")
async def update_subject(
    trial_id: UUID,
    subject_id: UUID,
    status: str = Query(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    # Parent-trial ownership gates the child mutation.
    trial = await fetch_owned_directly_or_404(db, ClinicalTrial, trial_id, current_user)
    subject_q = (
        select(TrialSubject)
        .where(TrialSubject.id == subject_id, TrialSubject.trial_id == trial_id)
    )
    subject = (await db.execute(subject_q)).scalar_one_or_none()
    if subject is None:
        raise HTTPException(status_code=404, detail="Subject not found")
    subject.status = status
    await db.flush()

    # Update current enrollment count on the trial
    count_result = await db.execute(
        select(func.count())
        .select_from(TrialSubject)
        .where(TrialSubject.trial_id == trial_id, TrialSubject.status == "active")
    )
    trial.current_enrollment = count_result.scalar() or 0
    await db.flush()

    return subject.to_dict()


# ── Visits (no dedicated table yet) ────────────────────────────


@router.get("/{trial_id}/visits")
async def list_visits(
    trial_id: UUID,
    subject_id: str | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    await fetch_owned_directly_or_404(db, ClinicalTrial, trial_id, current_user)
    return {"items": [], "total": 0}


@router.post("/{trial_id}/visits")
async def create_visit(
    trial_id: UUID,
    data: VisitCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    await fetch_owned_directly_or_404(db, ClinicalTrial, trial_id, current_user)
    raise HTTPException(
        status_code=501,
        detail="Visit storage not yet implemented; no dedicated table exists.",
    )


# ── Documents ───────────────────────────────────────────────────


@router.get("/{trial_id}/documents")
async def list_documents(
    trial_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    await fetch_owned_directly_or_404(db, ClinicalTrial, trial_id, current_user)
    result = await db.execute(
        select(TrialDocument).where(TrialDocument.trial_id == trial_id)
    )
    items = result.scalars().all()
    return {"items": [d.to_dict() for d in items], "total": len(items)}


@router.post("/{trial_id}/documents")
async def add_document(
    trial_id: UUID,
    data: DocumentCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    await fetch_owned_directly_or_404(db, ClinicalTrial, trial_id, current_user)
    doc = TrialDocument(
        trial_id=trial_id,
        document_type=data.document_type,
        name=data.name,
        status="pending",
        version=data.version,
        uploaded_by=current_user.email,
    )
    db.add(doc)
    await db.flush()
    return doc.to_dict()


# ── Budget ──────────────────────────────────────────────────────


@router.get("/{trial_id}/budget")
async def get_budget(
    trial_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    trial = await fetch_owned_directly_or_404(db, ClinicalTrial, trial_id, current_user)
    return trial.to_dict().get("budget", {})


@router.patch("/{trial_id}/budget")
async def update_budget(
    trial_id: UUID,
    data: BudgetUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    trial = await fetch_owned_directly_or_404(db, ClinicalTrial, trial_id, current_user)
    budget = dict(trial.budget) if trial.budget else {}
    budget["categories"] = data.categories
    budget["total"] = sum(c.get("budgeted", 0) for c in data.categories)
    budget["spent"] = sum(c.get("spent", 0) for c in data.categories)
    trial.budget = budget
    await db.flush()
    return budget


# Bulk operations
attach_bulk_delete(router, ClinicalTrial)
attach_bulk_archive(router, ClinicalTrial)
