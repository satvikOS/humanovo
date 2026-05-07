"""
Activity / Timeline API Endpoints

CRUD operations for tracking and managing platform activities.

Tenant-scoped: every R/U/D filters by `owner_id` so a caller only
sees their own activity timeline. The `log_activity` helper takes a
`user_id` so internal callers (project create, hypothesis verify,
etc.) can attribute activities to the right user.
"""

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import AUTH_REQUIRED, get_current_active_user
from app.core.database import async_session_factory, get_db
from app.models.activity import Activity
from app.models.user import User

logger = logging.getLogger(__name__)
router = APIRouter(dependencies=AUTH_REQUIRED)
# ── Schemas ──────────────────────────────────────────────────────

class ActivityUpdate(BaseModel):
    annotation: str | None = None
    description: str | None = None


# ── Helper ───────────────────────────────────────────────────────

async def log_activity(
    type: str,
    action: str,
    title: str,
    user_id: UUID | str | None = None,
    description: str = None,
    entity_id: str = None,
    entity_type: str = None,
    project_name: str = None,
    metadata: dict = None,
    db: AsyncSession = None,
) -> dict:
    """Helper to programmatically log an activity for a specific user.

    Pass `user_id` to attribute the entry to a real account; rows
    without `user_id` are still legal (orphan / system events) but
    don't appear on any user's timeline. If `db` is provided, the
    caller is responsible for committing. Otherwise a standalone
    session is created and committed internally.
    """
    owns_session = db is None
    if owns_session:
        db = async_session_factory()

    try:
        activity = Activity(
            owner_id=user_id,
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


async def _owned_activity_or_404(
    db: AsyncSession, activity_id: UUID, current_user: User,
) -> Activity:
    """Look up an activity row and confirm `current_user` owns it."""
    result = await db.execute(
        select(Activity).where(
            Activity.id == activity_id,
            Activity.owner_id == current_user.id,
        )
    )
    activity = result.scalar_one_or_none()
    if activity is None:
        raise HTTPException(status_code=404, detail="Activity not found")
    return activity


# ── Endpoints ────────────────────────────────────────────────────

@router.get("")
async def list_activities(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
    type: str | None = None,
    action: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """List the caller's activities with optional filters.

    Returns JSONResponse directly — FastAPI's jsonable_encoder hits a
    RecursionError on this response shape under fastapi 0.136 +
    pydantic 2.13 even with the process-wide warnings.filterwarnings
    fix in app.main. Bypassing the encoder keeps the endpoint live
    while the root bug is triaged upstream.
    """
    import json

    from fastapi.responses import JSONResponse
    query = select(Activity).where(Activity.owner_id == current_user.id)
    count_query = select(func.count(Activity.id)).where(
        Activity.owner_id == current_user.id
    )

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

    payload = {
        "items": [a.to_dict() for a in items],
        "total": total,
        "page": page,
        "page_size": page_size,
    }
    return JSONResponse(content=json.loads(json.dumps(payload, default=str)))


@router.get("/{activity_id}")
async def get_activity(
    activity_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Get one of the caller's activities."""
    activity = await _owned_activity_or_404(db, activity_id, current_user)
    return activity.to_dict()


@router.patch("/{activity_id}")
async def update_activity(
    activity_id: UUID,
    data: ActivityUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Update one of the caller's activities (annotation, description)."""
    activity = await _owned_activity_or_404(db, activity_id, current_user)

    if data.annotation is not None:
        activity.annotation = data.annotation
    if data.description is not None:
        activity.description = data.description

    await db.flush()
    await db.refresh(activity)
    return activity.to_dict()


@router.delete("/{activity_id}")
async def delete_activity(
    activity_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Delete one of the caller's activities."""
    activity = await _owned_activity_or_404(db, activity_id, current_user)
    await db.delete(activity)
    await db.flush()
    return {"status": "deleted"}
