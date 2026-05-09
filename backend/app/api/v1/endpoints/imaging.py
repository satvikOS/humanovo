"""
Research Imaging API Endpoints

Image study management, annotations, and AI-assisted analysis
powered by Constant AI for vision-based diagnostics.
"""

import asyncio
import base64
import json
import logging
from datetime import UTC, datetime
from uuid import UUID, uuid4

import boto3
from botocore.config import Config as BotoConfig
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import AUTH_REQUIRED, get_current_active_user
from app.core.config import settings
from app.core.database import get_db
from app.core.ownership import fetch_owned_directly_or_404, filter_by_owner
from app.models.platform_entities import ImagingStudy
from app.models.user import User

logger = logging.getLogger(__name__)
router = APIRouter(dependencies=AUTH_REQUIRED)


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
async def list_studies(
    modality: str | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    stmt = filter_by_owner(select(ImagingStudy), ImagingStudy, current_user)
    stmt = stmt.order_by(ImagingStudy.created_at.desc())
    if modality:
        stmt = stmt.where(ImagingStudy.modality == modality)
    result = await db.execute(stmt)
    items = result.scalars().all()
    return {"items": [s.to_dict() for s in items], "total": len(items)}


@router.post("/studies")
async def create_study(
    data: StudyCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    study = ImagingStudy(
        owner_id=current_user.id,
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
async def get_study(
    study_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    study = await fetch_owned_directly_or_404(db, ImagingStudy, study_id, current_user)
    return study.to_dict()


@router.delete("/studies/{study_id}")
async def delete_study(
    study_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    study = await fetch_owned_directly_or_404(db, ImagingStudy, study_id, current_user)
    await db.delete(study)
    await db.flush()
    return {"status": "deleted"}


@router.post("/studies/{study_id}/annotate")
async def add_annotation(
    study_id: UUID,
    data: AnnotationCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    study = await fetch_owned_directly_or_404(db, ImagingStudy, study_id, current_user)
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
        "created_at": datetime.now(UTC).isoformat(),
    }
    current = list(study.annotations or [])
    current.append(annotation)
    study.annotations = current
    await db.flush()
    return annotation


@router.delete("/studies/{study_id}/annotations/{annotation_id}")
async def delete_annotation(
    study_id: UUID,
    annotation_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    study = await fetch_owned_directly_or_404(db, ImagingStudy, study_id, current_user)
    study.annotations = [a for a in (study.annotations or []) if a["id"] != annotation_id]
    await db.flush()
    return {"status": "deleted"}


@router.get("/studies/{study_id}/analysis")
async def get_ai_analysis(
    study_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    study = await fetch_owned_directly_or_404(db, ImagingStudy, study_id, current_user)
    return {"study_id": study_id, "ai_analysis": study.ai_analysis}


# ─── AI Image Analysis powered by Constant AI ──────────────────────────
# Uses the same proven client configuration as the Discovery pipeline so
# credential handling, timeouts and retries behave identically across the
# platform. All external branding is surfaced to callers as "Constant AI".


class ImageAnalysisRequest(BaseModel):
    image_base64: str  # PNG base64 (no data: prefix)
    modality: str = "CT"
    body_part: str = ""
    width: int = 0
    height: int = 0
    window_center: int = 128
    window_width: int = 256
    filter_applied: str = "none"


_bedrock_client_cache = None


def _get_bedrock_client():
    """Lazily build (and memoise) a Bedrock runtime client using the same
    credential properties the Discovery orchestrator relies on. Returns
    None when AWS credentials aren't configured so callers can surface a
    clean 503 instead of a stack trace."""
    global _bedrock_client_cache
    if _bedrock_client_cache is not None:
        return _bedrock_client_cache
    access = settings.aws_access_key_value
    secret = settings.aws_secret_key_value
    if not (access and secret):
        return None
    _bedrock_client_cache = boto3.client(
        "bedrock-runtime",
        region_name=settings.AWS_REGION,
        aws_access_key_id=access,
        aws_secret_access_key=secret,
        config=BotoConfig(
            retries={"max_attempts": 3, "mode": "adaptive"},
            read_timeout=120,
        ),
    )
    return _bedrock_client_cache


@router.post("/analyze")
async def analyze_image(data: ImageAnalysisRequest):
    """Run AI-powered clinical image analysis via Constant AI."""
    client = _get_bedrock_client()
    if client is None:
        raise HTTPException(
            status_code=503,
            detail="Constant AI is not configured on this deployment.",
        )

    model_id = settings.BEDROCK_MODEL_CLAUDE_SONNET

    system_prompt = (
        "You are a board-certified radiologist reviewing research imaging. "
        "Give concise, clinically grounded observations without speculative diagnoses."
    )

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

    # Primary path: Converse API (matches Discovery orchestrator). This
    # returns richer usage metadata and handles vision content blocks
    # natively.
    try:
        response = await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: client.converse(
                modelId=model_id,
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {
                                "image": {
                                    "format": "png",
                                    "source": {
                                        "bytes": base64.b64decode(data.image_base64)
                                    },
                                }
                            },
                            {"text": prompt},
                        ],
                    }
                ],
                system=[{"text": system_prompt}],
                inferenceConfig={"maxTokens": 1024, "temperature": 0.3},
            ),
        )
        text = response["output"]["message"]["content"][0]["text"]
        return {"analysis": text, "model": "Constant AI"}
    except Exception as converse_err:
        logger.warning(
            "Converse path failed for imaging analysis (%s); falling back to InvokeModel",
            converse_err,
        )

    # Fallback: InvokeModel with Anthropic vision payload.
    try:
        body = {
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": 1024,
            "temperature": 0.3,
            "system": system_prompt,
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
        response = await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: client.invoke_model(
                modelId=model_id,
                contentType="application/json",
                accept="application/json",
                body=json.dumps(body),
            ),
        )
        result = json.loads(response["body"].read())
        text = result.get("content", [{}])[0].get("text", "")
        if not text:
            raise HTTPException(status_code=502, detail="Constant AI returned no content")
        return {"analysis": text, "model": "Constant AI"}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Imaging AI analysis failed")
        raise HTTPException(status_code=500, detail=f"Constant AI analysis failed: {str(e)}")


# ─────────────────────────── MONAI integration ──────────────────
#
# MONAI (Medical Open Network for AI, https://monai.io) is the de-facto
# PyTorch framework for medical-imaging workflows: segmentation,
# classification, registration, and pre-processing pipelines for DICOM
# volumes. The integration plan, scaffolded below, lets the Research
# Imaging surface request MONAI ops by name without each call site
# having to know whether MONAI is locally available, GPU-accelerated,
# or cloud-routed.
#
# ENDPOINT CONTRACT (frozen here so the renderer can integrate now,
# even before MONAI is wired):
#
#   POST /imaging/monai/segment
#     body  : { study_id: UUID, model: "spleen_ct" | "lung_nodule" | ... }
#     200   : { segmentation_url: str, dice_score?: float, latency_ms: int }
#     501   : { detail: "MONAI runtime not configured" } when the
#             backend hasn't yet had `pip install monai[all]` run +
#             model weights downloaded to MONAI_MODEL_DIR.
#
#   POST /imaging/monai/classify
#     body  : { study_id: UUID, model: "covid_chest_xray" | ... }
#     200   : { label: str, probability: float, top_k: list }
#
#   POST /imaging/monai/register
#     body  : { fixed_study_id: UUID, moving_study_id: UUID,
#               method: "rigid" | "affine" | "deformable" }
#     200   : { transformed_study_id: UUID, transform_matrix: list }
#
# Implementation will land MONAI behind an `import` guard so the
# Python venv that doesn't have it installed (default for the
# private-beta backend) keeps booting; the endpoints just 501 with a
# helpful detail message.


class MonaiOpRequest(BaseModel):
    study_id: UUID
    model: str | None = None
    method: str | None = None
    fixed_study_id: UUID | None = None
    moving_study_id: UUID | None = None


def _monai_available() -> bool:
    """Cheap probe — tries an `import monai` once and caches the result."""
    if not hasattr(_monai_available, "_cached"):
        try:
            import monai  # type: ignore  # noqa: F401
            _monai_available._cached = True  # type: ignore[attr-defined]
        except Exception:
            _monai_available._cached = False  # type: ignore[attr-defined]
    return _monai_available._cached  # type: ignore[attr-defined]


def _monai_501() -> HTTPException:
    return HTTPException(
        status_code=501,
        detail=(
            "MONAI runtime not configured on this backend. "
            "Install with `pip install monai[all]` and set MONAI_MODEL_DIR "
            "to a directory holding the requested model's weights. "
            "See docs/planning/MONAI_INTEGRATION.md for the full setup walkthrough."
        ),
    )


@router.post("/monai/segment")
async def monai_segment(
    body: MonaiOpRequest,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    # Tenant isolation — caller must own the study they're segmenting.
    await fetch_owned_directly_or_404(db, ImagingStudy, body.study_id, current_user)
    if not _monai_available():
        raise _monai_501()
    # TODO(monai): load the requested model from MONAI_MODEL_DIR,
    # run inference on the study's pixel data, persist the
    # segmentation mask alongside the original study, return its URL.
    raise HTTPException(status_code=501, detail="MONAI segment endpoint scaffolded; runtime wiring TBD.")


@router.post("/monai/classify")
async def monai_classify(
    body: MonaiOpRequest,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    await fetch_owned_directly_or_404(db, ImagingStudy, body.study_id, current_user)
    if not _monai_available():
        raise _monai_501()
    raise HTTPException(status_code=501, detail="MONAI classify endpoint scaffolded; runtime wiring TBD.")


@router.post("/monai/register")
async def monai_register(
    body: MonaiOpRequest,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    if body.fixed_study_id is None or body.moving_study_id is None:
        raise HTTPException(status_code=422, detail="fixed_study_id and moving_study_id required for register.")
    await fetch_owned_directly_or_404(db, ImagingStudy, body.fixed_study_id, current_user)
    await fetch_owned_directly_or_404(db, ImagingStudy, body.moving_study_id, current_user)
    if not _monai_available():
        raise _monai_501()
    raise HTTPException(status_code=501, detail="MONAI register endpoint scaffolded; runtime wiring TBD.")


@router.get("/monai/health")
async def monai_health():
    """Quick probe — does this backend have MONAI installed?"""
    return {
        "available": _monai_available(),
        "endpoints": ["/monai/segment", "/monai/classify", "/monai/register"],
    }
