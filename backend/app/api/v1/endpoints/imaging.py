"""
Research Imaging API Endpoints

Image study management, annotations, and AI-assisted analysis.
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
from app.models.platform_entities import ImagingStudy

logger = logging.getLogger(__name__)
router = APIRouter()


class StudyCreate(BaseModel):
    title: str
    modality: str = "CT"
    body_part: str = ""
    findings: str = ""


class AnnotationCreate(BaseModel):
    type: str = "rectangle"  # rectangle, circle, freehand, label
    x: float = 0
    y: float = 0
    width: float = 0
    height: float = 0
    label: str = ""
    color: str = "#ef4444"
    notes: str = ""


@router.get("/studies")
async def list_studies(modality: Optional[str] = None, db: AsyncSession = Depends(get_db)):
    stmt = select(ImagingStudy).order_by(ImagingStudy.created_at.desc())
    if modality:
        stmt = stmt.where(ImagingStudy.modality == modality)
    result = await db.execute(stmt)
    items = result.scalars().all()
    return {"items": [s.to_dict() for s in items], "total": len(items)}


@router.post("/studies")
async def create_study(data: StudyCreate, db: AsyncSession = Depends(get_db)):
    study = ImagingStudy(
        title=data.title,
        modality=data.modality,
        body_part=data.body_part,
        findings=data.findings,
        status="pending",
        patient_id="",
        annotations=[],
        ai_analysis=None,
        width=512,
        height=512,
    )
    db.add(study)
    await db.flush()
    return study.to_dict()


@router.get("/studies/{study_id}")
async def get_study(study_id: str, db: AsyncSession = Depends(get_db)):
    study = await db.get(ImagingStudy, study_id)
    if not study:
        raise HTTPException(status_code=404, detail="Study not found")
    return study.to_dict()


@router.delete("/studies/{study_id}")
async def delete_study(study_id: str, db: AsyncSession = Depends(get_db)):
    study = await db.get(ImagingStudy, study_id)
    if not study:
        raise HTTPException(status_code=404, detail="Study not found")
    await db.delete(study)
    await db.flush()
    return {"status": "deleted"}


@router.post("/studies/{study_id}/annotate")
async def add_annotation(study_id: str, data: AnnotationCreate, db: AsyncSession = Depends(get_db)):
    study = await db.get(ImagingStudy, study_id)
    if not study:
        raise HTTPException(status_code=404, detail="Study not found")
    annotation = {
        "id": str(uuid4()),
        "type": data.type,
        "x": data.x,
        "y": data.y,
        "width": data.width,
        "height": data.height,
        "label": data.label,
        "color": data.color,
        "notes": data.notes,
        "created_at": datetime.utcnow().isoformat(),
    }
    current = list(study.annotations or [])
    current.append(annotation)
    study.annotations = current
    await db.flush()
    return annotation


@router.delete("/studies/{study_id}/annotations/{annotation_id}")
async def delete_annotation(study_id: str, annotation_id: str, db: AsyncSession = Depends(get_db)):
    study = await db.get(ImagingStudy, study_id)
    if not study:
        raise HTTPException(status_code=404, detail="Study not found")
    study.annotations = [a for a in (study.annotations or []) if a["id"] != annotation_id]
    await db.flush()
    return {"status": "deleted"}


@router.get("/studies/{study_id}/analysis")
async def get_ai_analysis(study_id: str, db: AsyncSession = Depends(get_db)):
    study = await db.get(ImagingStudy, study_id)
    if not study:
        raise HTTPException(status_code=404, detail="Study not found")
    return {"study_id": study_id, "ai_analysis": study.ai_analysis}
