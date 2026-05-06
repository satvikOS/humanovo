"""
Collaboration API Endpoints

Comments, project sharing, notifications, and audit trail.
"""

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select, func, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.auth import AUTH_REQUIRED
from app.models.platform_entities import (
    AuditLogEntry,
    CollaborationComment,
    CollaborationNotification,
    ProjectShare,
)

logger = logging.getLogger(__name__)
router = APIRouter(dependencies=AUTH_REQUIRED)
# ── Schemas ──────────────────────────────────────────────────────

class CommentCreate(BaseModel):
    entity_type: str  # project, hypothesis, experiment, etc.
    entity_id: str
    content: str
    user_id: str = "user-1"
    user_name: str = ""
    parent_id: Optional[str] = None


class ShareCreate(BaseModel):
    entity_type: str
    entity_id: str
    entity_name: str = ""
    shared_with: str  # user_id
    permission: str = "view"  # view, edit, admin
    shared_by: str = "user-1"
    shared_by_name: str = ""


class NotificationCreate(BaseModel):
    user_id: str
    title: str
    message: str
    link: Optional[str] = None
    notification_type: str = "info"  # info, mention, share, update


# ── Helpers ──────────────────────────────────────────────────────

async def _log_audit(
    db: AsyncSession,
    action: str,
    entity_type: str,
    entity_id: str,
    user_id: str = "user-1",
    user_name: str = "",
    details: str = "",
):
    entry = AuditLogEntry(
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        user_id=user_id,
        user_name=user_name,
        details=details,
    )
    db.add(entry)
    await db.flush()


# ── Comments ─────────────────────────────────────────────────────

@router.get("/comments")
async def list_comments(
    entity_type: Optional[str] = None,
    entity_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    query = select(CollaborationComment)
    if entity_type:
        query = query.where(CollaborationComment.entity_type == entity_type)
    if entity_id:
        query = query.where(CollaborationComment.entity_id == entity_id)
    query = query.order_by(CollaborationComment.created_at.desc())

    result = await db.execute(query)
    items = result.scalars().all()
    return {"items": [c.to_dict() for c in items], "total": len(items)}


@router.post("/comments")
async def create_comment(data: CommentCreate, db: AsyncSession = Depends(get_db)):
    comment = CollaborationComment(
        entity_type=data.entity_type,
        entity_id=data.entity_id,
        content=data.content,
        user_id=data.user_id,
        user_name=data.user_name,
        parent_id=data.parent_id,
    )
    db.add(comment)
    await db.flush()
    await db.refresh(comment)

    await _log_audit(
        db,
        action="commented",
        entity_type=data.entity_type,
        entity_id=data.entity_id,
        user_id=data.user_id,
        user_name=data.user_name,
        details=f"Comment: {data.content[:50]}",
    )
    return comment.to_dict()


@router.delete("/comments/{comment_id}")
async def delete_comment(comment_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(CollaborationComment).where(CollaborationComment.id == comment_id)
    )
    comment = result.scalar_one_or_none()
    if comment is None:
        raise HTTPException(status_code=404, detail="Comment not found")
    await db.delete(comment)
    await db.flush()
    return {"status": "deleted"}


# ── Shares ───────────────────────────────────────────────────────

@router.get("/shares")
async def list_shares(
    entity_type: Optional[str] = None,
    user_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    query = select(ProjectShare)
    if entity_type:
        # Filter by project_id pattern or similar — but model uses project_id
        pass
    if user_id:
        query = query.where(ProjectShare.user_id == user_id)

    result = await db.execute(query)
    items = result.scalars().all()
    return {"items": [s.to_dict() for s in items], "total": len(items)}


@router.post("/shares")
async def create_share(data: ShareCreate, db: AsyncSession = Depends(get_db)):
    share = ProjectShare(
        project_id=data.entity_id,
        user_id=data.shared_with,
        user_name="",
        permission=data.permission,
        status="active",
    )
    db.add(share)
    await db.flush()
    await db.refresh(share)

    await _log_audit(
        db,
        action="shared",
        entity_type=data.entity_type,
        entity_id=data.entity_id,
        user_id=data.shared_by,
        user_name=data.shared_by_name,
        details=f"Shared with {data.shared_with} ({data.permission})",
    )

    # Auto-create notification
    notif = CollaborationNotification(
        user_id=data.shared_with,
        type="share",
        title="New shared item",
        message=f"{data.shared_by_name or data.shared_by} shared a {data.entity_type} with you ({data.permission} access)",
        read=False,
        entity_type=data.entity_type,
        entity_id=data.entity_id,
        actor_name=data.shared_by_name or data.shared_by,
    )
    db.add(notif)
    await db.flush()

    return share.to_dict()


@router.delete("/shares/{share_id}")
async def delete_share(share_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(ProjectShare).where(ProjectShare.id == share_id)
    )
    share = result.scalar_one_or_none()
    if share is None:
        raise HTTPException(status_code=404, detail="Share not found")
    await db.delete(share)
    await db.flush()
    return {"status": "deleted"}


# ── Notifications ────────────────────────────────────────────────

@router.get("/notifications")
async def list_notifications(
    user_id: str = Query("user-1"),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(CollaborationNotification)
        .where(CollaborationNotification.user_id == user_id)
        .order_by(CollaborationNotification.created_at.desc())
    )
    items = result.scalars().all()
    unread = sum(1 for n in items if not n.read)
    return {
        "items": [n.to_dict() for n in items],
        "total": len(items),
        "unread": unread,
    }


@router.post("/notifications")
async def create_notification(
    data: NotificationCreate, db: AsyncSession = Depends(get_db)
):
    notif = CollaborationNotification(
        user_id=data.user_id,
        type=data.notification_type,
        title=data.title,
        message=data.message,
        read=False,
        entity_type=None,
        entity_id=None,
        actor_name=None,
    )
    db.add(notif)
    await db.flush()
    await db.refresh(notif)
    return notif.to_dict()


@router.patch("/notifications/{notification_id}/read")
async def mark_read(notification_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(CollaborationNotification).where(
            CollaborationNotification.id == notification_id
        )
    )
    notif = result.scalar_one_or_none()
    if notif is None:
        raise HTTPException(status_code=404, detail="Notification not found")
    notif.read = True
    await db.flush()
    await db.refresh(notif)
    return notif.to_dict()


@router.post("/notifications/mark-all-read")
async def mark_all_read(
    user_id: str = Query("user-1"),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        update(CollaborationNotification)
        .where(
            CollaborationNotification.user_id == user_id,
            CollaborationNotification.read == False,  # noqa: E712
        )
        .values(read=True)
    )
    return {"marked": result.rowcount}


# ── Audit Log ────────────────────────────────────────────────────

@router.get("/audit-log")
async def get_audit_log(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    entity_type: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    query = select(AuditLogEntry)
    count_query = select(func.count(AuditLogEntry.id))

    if entity_type:
        query = query.where(AuditLogEntry.entity_type == entity_type)
        count_query = count_query.where(AuditLogEntry.entity_type == entity_type)

    total_result = await db.execute(count_query)
    total = total_result.scalar_one()

    query = (
        query
        .order_by(AuditLogEntry.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    result = await db.execute(query)
    items = result.scalars().all()

    return {
        "items": [a.to_dict() for a in items],
        "total": total,
        "page": page,
    }


@router.get("/team")
async def list_team_members(db: AsyncSession = Depends(get_db)) -> dict:
    members: dict[str, dict] = {}
    try:
        result = await db.execute(
            select(
                CollaborationComment.user_id,
                CollaborationComment.user_name,
            )
            .group_by(CollaborationComment.user_id, CollaborationComment.user_name)
            .limit(100)
        )
        for uid, uname in result.all():
            if not uid:
                continue
            members.setdefault(str(uid), {
                "id": str(uid),
                "name": uname or str(uid),
                "email": "",
                "role": "collaborator",
                "avatar_color": "#60a5fa",
            })
    except Exception:
        pass
    try:
        share_result = await db.execute(
            select(ProjectShare.shared_with, ProjectShare.permission).limit(100)
        )
        for uid, perm in share_result.all():
            if not uid:
                continue
            members.setdefault(str(uid), {
                "id": str(uid),
                "name": str(uid),
                "email": "",
                "role": perm or "collaborator",
                "avatar_color": "#a78bfa",
            })
    except Exception:
        pass
    return {"members": list(members.values()), "total": len(members)}
