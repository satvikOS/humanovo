"""
Activity / Timeline API Endpoints

CRUD operations for tracking and managing platform activities.
"""

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db, async_session_factory
from app.models.activity import Activity

logger = logging.getLogger(__name__)
router = APIRouter()


# ── Schemas ──────────────────────────────────────────────────────

class ActivityUpdate(BaseModel):
    annotation: Optional[str] = None
    description: Optional[str] = None


# ── Helper ───────────────────────────────────────────────────────

async def log_activity(
    type: str,
    action: str,
    title: str,
    description: str = None,
    entity_id: str = None,
    entity_type: str = None,
    project_name: str = None,
    metadata: dict = None,
    db: AsyncSession = None,
) -> dict:
    """Helper to programmatically log an activity.

    If *db* is provided, the caller is responsible for committing.
    Otherwise a standalone session is created and committed internally.
    """
    owns_session = db is None
    if owns_session:
        db = async_session_factory()

    try:
        activity = Activity(
            type=type,
            action=action,
            title=title,
            description=description,
            entity_id=entity_id,
            entity_type=entity_type,
            project_name=project_name,
            metadata=metadata or {},
            annotation=None,
        )
        db.add(activity)
        await db.flush()
        await db.refresh(activity)

        if owns_session:
            await db.commit()

        return activity.to_dict()
    except Exception:
        if owns_session:
            await db.rollback()
        raise
    finally:
        if owns_session:
            await db.close()


# ── Endpoints ────────────────────────────────────────────────────

@router.get("")
async def list_activities(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
    type: Optional[str] = None,
    action: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    """List activities with optional filters.

    Returns JSONResponse directly — FastAPI's jsonable_encoder path
    trips a RecursionError under some warnings-filter + deprecation
    combinations observed in production logs. Bypassing it here keeps
    the endpoint live while the root encoder bug is triaged upstream.
    """
    import json
    from fastapi.responses import JSONResponse
    query = select(Activity)
    count_query = select(func.count(Activity.id))

    if type:
        query = query.where(Activity.type == type)
        count_query = count_query.where(Activity.type == type)
    if action:
        query = query.where(Activity.action == action)
        count_query = count_query.where(Activity.action == action)
    if date_from:
        query = query.where(Activity.created_at >= date_from)
        count_query = count_query.where(Activity.created_at >= date_from)
    if date_to:
        query = query.where(Activity.created_at <= date_to)
        count_query = count_query.where(Activity.created_at <= date_to)

    total_result = await db.execute(count_query)
    total = total_result.scalar_one()

    query = (
        query
        .order_by(Activity.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    result = await db.execute(query)
    items = result.scalars().all()

    # Serialise manually — every value is a primitive or UUID/datetime
    # that json.dumps(default=str) can handle, so we skip FastAPI's
    # generic encoder and side-step the known RecursionError.
    payload = {
        "items": [a.to_dict() for a in items],
        "total": total,
        "page": page,
        "page_size": page_size,
    }
    return JSONResponse(content=json.loads(json.dumps(payload, default=str)))


@router.get("/{activity_id}")
async def get_activity(activity_id: str, db: AsyncSession = Depends(get_db)):
    """Get a single activity."""
    result = await db.execute(
        select(Activity).where(Activity.id == activity_id)
    )
    activity = result.scalar_one_or_none()
    if activity is None:
        raise HTTPException(status_code=404, detail="Activity not found")
    return activity.to_dict()


@router.patch("/{activity_id}")
async def update_activity(
    activity_id: str,
    data: ActivityUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Update an activity (annotation, description)."""
    result = await db.execute(
        select(Activity).where(Activity.id == activity_id)
    )
    activity = result.scalar_one_or_none()
    if activity is None:
        raise HTTPException(status_code=404, detail="Activity not found")

    if data.annotation is not None:
        activity.annotation = data.annotation
    if data.description is not None:
        activity.description = data.description

    await db.flush()
    await db.refresh(activity)
    return activity.to_dict()


@router.delete("/{activity_id}")
async def delete_activity(activity_id: str, db: AsyncSession = Depends(get_db)):
    """Delete an activity."""
    result = await db.execute(
        select(Activity).where(Activity.id == activity_id)
    )
    activity = result.scalar_one_or_none()
    if activity is None:
        raise HTTPException(status_code=404, detail="Activity not found")

    await db.delete(activity)
    await db.flush()
    return {"status": "deleted"}
