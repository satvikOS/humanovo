"""
Research Imaging API Endpoints

Image study management, annotations, and AI-assisted analysis
via AWS Bedrock Claude Sonnet 4.6 for vision-based diagnostics.
"""

import base64
import json
import logging
from datetime import datetime
from typing import Optional
from uuid import uuid4

import boto3
from botocore.config import Config as BotoConfig
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.models.platform_entities import ImagingStudy

logger = logging.getLogger(__name__)
router = APIRouter()


class StudyCreate(BaseModel):
    title: str
    modality: str = "CT"
    body_part: str = ""
    findings: str = ""
    width: int = 0
    height: int = 0


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
        width=data.width,
        height=data.height,
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


# ─── AI Image Analysis via AWS Bedrock Claude Sonnet 4.6 ────────────────

class ImageAnalysisRequest(BaseModel):
    image_base64: str  # PNG base64 (no data: prefix)
    modality: str = "CT"
    body_part: str = ""
    width: int = 0
    height: int = 0
    window_center: int = 128
    window_width: int = 256
    filter_applied: str = "none"


def _get_bedrock_client():
    """Build a Bedrock runtime client from app settings."""
    kwargs = {"region_name": settings.AWS_REGION}
    if settings.AWS_ACCESS_KEY_ID and settings.AWS_SECRET_ACCESS_KEY:
        kwargs["aws_access_key_id"] = settings.AWS_ACCESS_KEY_ID.get_secret_value()
        kwargs["aws_secret_access_key"] = settings.AWS_SECRET_ACCESS_KEY.get_secret_value()
    return boto3.client(
        "bedrock-runtime",
        config=BotoConfig(
            retries={"max_attempts": 3, "mode": "adaptive"},
            read_timeout=120,
        ),
        **kwargs,
    )


@router.post("/analyze")
async def analyze_image(data: ImageAnalysisRequest):
    """Run AI-powered clinical image analysis using Claude Sonnet 4.6 via AWS Bedrock."""
    try:
        client = _get_bedrock_client()

        prompt = (
            f"You are analyzing a {data.modality} medical image"
            f"{f' of the {data.body_part}' if data.body_part else ''}. "
            f"Image dimensions: {data.width}x{data.height}px. "
            f"Current windowing: center={data.window_center}, width={data.window_width}. "
            f"Filter applied: {data.filter_applied}.\n\n"
            "Provide a concise clinical analysis:\n"
            "1. **Modality Confirmation**: Confirm or suggest the correct imaging modality\n"
            "2. **Key Observations**: Notable anatomical structures, any abnormalities or areas of interest\n"
            "3. **Image Quality**: Assessment of contrast, noise, artifacts\n"
            "4. **Quantitative Assessment**: Density/intensity distribution observations\n"
            "5. **Recommendations**: Suggested filters, windowing adjustments, or additional analysis\n\n"
            "Keep response under 400 words. Be precise and clinically relevant."
        )

        body = {
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": 1024,
            "temperature": 0.3,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": "image/png",
                                "data": data.image_base64,
                            },
                        },
                        {"type": "text", "text": prompt},
                    ],
                }
            ],
        }

        response = client.invoke_model(
            modelId=settings.BEDROCK_MODEL_CLAUDE_SONNET,
            contentType="application/json",
            accept="application/json",
            body=json.dumps(body),
        )

        result = json.loads(response["body"].read())
        text = result.get("content", [{}])[0].get("text", "")
        return {"analysis": text, "model": settings.BEDROCK_MODEL_CLAUDE_SONNET}

    except Exception as e:
        logger.exception("Imaging AI analysis failed")
        raise HTTPException(status_code=500, detail=f"AI analysis failed: {str(e)}")
