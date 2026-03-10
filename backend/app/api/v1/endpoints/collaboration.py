"""
Collaboration API Endpoints

Comments, project sharing, notifications, and audit trail.
"""

import logging
from datetime import datetime
from typing import Optional
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

logger = logging.getLogger(__name__)
router = APIRouter()

_comments: dict[str, dict] = {}
_shares: dict[str, dict] = {}
_notifications: dict[str, dict] = {}
_audit_log: list[dict] = []

# Simulated users
DEMO_USERS = [
    {"id": "user-1", "name": "Dr. Sarah Chen", "email": "sarah.chen@research.org", "role": "PI", "avatar_color": "#3b82f6"},
    {"id": "user-2", "name": "Dr. James Wilson", "email": "james.wilson@research.org", "role": "Co-PI", "avatar_color": "#8b5cf6"},
    {"id": "user-3", "name": "Maria Rodriguez", "email": "maria.r@research.org", "role": "Postdoc", "avatar_color": "#22c55e"},
    {"id": "user-4", "name": "Alex Kim", "email": "alex.kim@research.org", "role": "PhD Student", "avatar_color": "#f97316"},
    {"id": "user-5", "name": "Dr. Priya Patel", "email": "priya.patel@research.org", "role": "Collaborator", "avatar_color": "#06b6d4"},
]


def _log_audit(action: str, entity_type: str, entity_id: str, user_id: str = "user-1", details: str = ""):
    _audit_log.insert(0, {
        "id": str(uuid4()), "action": action, "entity_type": entity_type,
        "entity_id": entity_id, "user_id": user_id, "user_name": next((u["name"] for u in DEMO_USERS if u["id"] == user_id), "Unknown"),
        "details": details, "timestamp": datetime.utcnow().isoformat(),
    })
    if len(_audit_log) > 500:
        _audit_log[:] = _audit_log[:500]


class CommentCreate(BaseModel):
    entity_type: str  # project, hypothesis, experiment, etc.
    entity_id: str
    content: str
    user_id: str = "user-1"
    parent_id: Optional[str] = None


class ShareCreate(BaseModel):
    entity_type: str
    entity_id: str
    entity_name: str = ""
    shared_with: str  # user_id
    permission: str = "view"  # view, edit, admin
    shared_by: str = "user-1"


class NotificationCreate(BaseModel):
    user_id: str
    title: str
    message: str
    link: Optional[str] = None
    notification_type: str = "info"  # info, mention, share, update


# ── Team / Users ─────────────────────────────────────────────────

@router.get("/team")
async def list_team():
    return {"members": DEMO_USERS}


# ── Comments ─────────────────────────────────────────────────────

@router.get("/comments")
async def list_comments(entity_type: Optional[str] = None, entity_id: Optional[str] = None):
    items = list(_comments.values())
    if entity_type:
        items = [c for c in items if c["entity_type"] == entity_type]
    if entity_id:
        items = [c for c in items if c["entity_id"] == entity_id]
    items.sort(key=lambda c: c["created_at"], reverse=True)
    return {"items": items, "total": len(items)}


@router.post("/comments")
async def create_comment(data: CommentCreate):
    cid = str(uuid4())
    user = next((u for u in DEMO_USERS if u["id"] == data.user_id), DEMO_USERS[0])
    comment = {
        "id": cid, "entity_type": data.entity_type, "entity_id": data.entity_id,
        "content": data.content, "user_id": data.user_id, "user_name": user["name"],
        "user_color": user["avatar_color"], "parent_id": data.parent_id,
        "created_at": datetime.utcnow().isoformat(),
    }
    _comments[cid] = comment
    _log_audit("commented", data.entity_type, data.entity_id, data.user_id, f"Comment: {data.content[:50]}")
    return comment


@router.delete("/comments/{comment_id}")
async def delete_comment(comment_id: str):
    if comment_id not in _comments:
        raise HTTPException(status_code=404, detail="Comment not found")
    del _comments[comment_id]
    return {"status": "deleted"}


# ── Shares ───────────────────────────────────────────────────────

@router.get("/shares")
async def list_shares(entity_type: Optional[str] = None, user_id: Optional[str] = None):
    items = list(_shares.values())
    if entity_type:
        items = [s for s in items if s["entity_type"] == entity_type]
    if user_id:
        items = [s for s in items if s["shared_with"] == user_id or s["shared_by"] == user_id]
    return {"items": items, "total": len(items)}


@router.post("/shares")
async def create_share(data: ShareCreate):
    sid = str(uuid4())
    shared_user = next((u for u in DEMO_USERS if u["id"] == data.shared_with), None)
    sharing_user = next((u for u in DEMO_USERS if u["id"] == data.shared_by), DEMO_USERS[0])
    share = {
        "id": sid, "entity_type": data.entity_type, "entity_id": data.entity_id,
        "entity_name": data.entity_name,
        "shared_with": data.shared_with, "shared_with_name": shared_user["name"] if shared_user else "Unknown",
        "shared_by": data.shared_by, "shared_by_name": sharing_user["name"],
        "permission": data.permission, "created_at": datetime.utcnow().isoformat(),
    }
    _shares[sid] = share
    _log_audit("shared", data.entity_type, data.entity_id, data.shared_by, f"Shared with {share['shared_with_name']} ({data.permission})")

    # Auto-create notification
    nid = str(uuid4())
    _notifications[nid] = {
        "id": nid, "user_id": data.shared_with, "title": "New shared item",
        "message": f"{sharing_user['name']} shared a {data.entity_type} with you ({data.permission} access)",
        "link": None, "notification_type": "share", "read": False, "created_at": datetime.utcnow().isoformat(),
    }
    return share


@router.delete("/shares/{share_id}")
async def delete_share(share_id: str):
    if share_id not in _shares:
        raise HTTPException(status_code=404, detail="Share not found")
    del _shares[share_id]
    return {"status": "deleted"}


# ── Notifications ────────────────────────────────────────────────

@router.get("/notifications")
async def list_notifications(user_id: str = Query("user-1")):
    items = [n for n in _notifications.values() if n["user_id"] == user_id]
    items.sort(key=lambda n: n["created_at"], reverse=True)
    unread = sum(1 for n in items if not n.get("read"))
    return {"items": items, "total": len(items), "unread": unread}


@router.post("/notifications")
async def create_notification(data: NotificationCreate):
    nid = str(uuid4())
    notif = {
        "id": nid, "user_id": data.user_id, "title": data.title,
        "message": data.message, "link": data.link,
        "notification_type": data.notification_type,
        "read": False, "created_at": datetime.utcnow().isoformat(),
    }
    _notifications[nid] = notif
    return notif


@router.patch("/notifications/{notification_id}/read")
async def mark_read(notification_id: str):
    if notification_id not in _notifications:
        raise HTTPException(status_code=404, detail="Notification not found")
    _notifications[notification_id]["read"] = True
    return _notifications[notification_id]


@router.post("/notifications/mark-all-read")
async def mark_all_read(user_id: str = Query("user-1")):
    count = 0
    for n in _notifications.values():
        if n["user_id"] == user_id and not n.get("read"):
            n["read"] = True
            count += 1
    return {"marked": count}


# ── Audit Log ────────────────────────────────────────────────────

@router.get("/audit-log")
async def get_audit_log(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    entity_type: Optional[str] = None,
):
    items = _audit_log[:]
    if entity_type:
        items = [a for a in items if a["entity_type"] == entity_type]
    total = len(items)
    start = (page - 1) * page_size
    return {"items": items[start:start + page_size], "total": total, "page": page}
