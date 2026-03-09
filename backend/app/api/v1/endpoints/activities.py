"""
Activity / Timeline API Endpoints

CRUD operations for tracking and managing platform activities.
"""

import logging
from datetime import datetime
from typing import Optional
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

logger = logging.getLogger(__name__)
router = APIRouter()

# ── In-memory storage ────────────────────────────────────────────

_activities: dict[str, dict] = {}


def _seed_activities():
    """Seed with some initial activities."""
    if _activities:
        return
    seeds = [
        {"type": "project", "action": "created", "title": "Platform initialized", "description": "HumaNovo research platform started"},
    ]
    for seed in seeds:
        aid = str(uuid4())
        _activities[aid] = {
            "id": aid,
            **seed,
            "entity_id": None,
            "entity_type": None,
            "project_name": None,
            "metadata": {},
            "annotation": None,
            "created_at": datetime.utcnow().isoformat(),
        }


_seed_activities()


def log_activity(
    type: str,
    action: str,
    title: str,
    description: str = None,
    entity_id: str = None,
    entity_type: str = None,
    project_name: str = None,
    metadata: dict = None,
):
    """Helper to programmatically log an activity."""
    aid = str(uuid4())
    _activities[aid] = {
        "id": aid,
        "type": type,
        "action": action,
        "title": title,
        "description": description,
        "entity_id": entity_id,
        "entity_type": entity_type,
        "project_name": project_name,
        "metadata": metadata or {},
        "annotation": None,
        "created_at": datetime.utcnow().isoformat(),
    }
    return _activities[aid]


# ── Schemas ──────────────────────────────────────────────────────

class ActivityUpdate(BaseModel):
    annotation: Optional[str] = None
    description: Optional[str] = None


# ── Endpoints ────────────────────────────────────────────────────

@router.get("")
async def list_activities(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
    type: Optional[str] = None,
    action: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
):
    """List activities with optional filters."""
    items = sorted(_activities.values(), key=lambda a: a["created_at"], reverse=True)

    if type:
        items = [a for a in items if a["type"] == type]
    if action:
        items = [a for a in items if a["action"] == action]
    if date_from:
        items = [a for a in items if a["created_at"] >= date_from]
    if date_to:
        items = [a for a in items if a["created_at"] <= date_to]

    total = len(items)
    start = (page - 1) * page_size
    paged = items[start:start + page_size]

    return {
        "items": paged,
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.get("/{activity_id}")
async def get_activity(activity_id: str):
    """Get a single activity."""
    if activity_id not in _activities:
        raise HTTPException(status_code=404, detail="Activity not found")
    return _activities[activity_id]


@router.patch("/{activity_id}")
async def update_activity(activity_id: str, data: ActivityUpdate):
    """Update an activity (annotation, description)."""
    if activity_id not in _activities:
        raise HTTPException(status_code=404, detail="Activity not found")

    activity = _activities[activity_id]
    if data.annotation is not None:
        activity["annotation"] = data.annotation
    if data.description is not None:
        activity["description"] = data.description

    _activities[activity_id] = activity
    return activity


@router.delete("/{activity_id}")
async def delete_activity(activity_id: str):
    """Delete an activity."""
    if activity_id not in _activities:
        raise HTTPException(status_code=404, detail="Activity not found")
    del _activities[activity_id]
    return {"status": "deleted"}
