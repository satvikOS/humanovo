"""Admin endpoints for per-user state management.

Surfaces:
  • POST /admin/users/{user_id}/disable — kill switch. Sets
    is_active=False so logins fail and existing sessions invalidate
    on next /me check. Use when a user is burning budget, abusing the
    platform, or otherwise needs to be stopped right now.
  • POST /admin/users/{user_id}/restore — undoes a disable. Doesn't
    touch delete_requested_at (that's a different flow); just flips
    is_active back to True. NOOP if the user is already active.
  • POST /admin/users/{user_id}/restore-deletion — special case:
    cancels a soft-delete that's still inside the 30-day grace
    window. Sets delete_requested_at=NULL + is_active=True.

All three log to the Merkle audit chain so the action is provably
attributed to the admin who took it. Rate-limited via "admin" bucket;
admin-role required.
"""
from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import ADMIN_REQUIRED, get_current_user
from app.core.database import get_db
from app.core.rate_limit import rate_limit
from app.models.user import User


logger = logging.getLogger(__name__)
router = APIRouter(dependencies=[*ADMIN_REQUIRED, Depends(rate_limit("admin"))])


async def _audit(
    db: AsyncSession,
    *,
    actor: User,
    action: str,
    target_user_id: str,
    details: dict[str, Any],
) -> None:
    """Best-effort audit-chain write. A failed audit doesn't block the
    state change — but the warning surfaces in monitoring so we know
    the chain has a gap that needs reconciling."""
    try:
        from app.services.audit_service import (
            AuditContext,
            AuditEventType,
            AuditSeverity,
            get_audit_service,
        )
        audit = get_audit_service()
        await audit.record(
            db=db,
            event_type=AuditEventType.AUTH_FAILED,  # closest existing type for forced state changes
            action=action,
            context=AuditContext(user_id=str(actor.id)),
            severity=AuditSeverity.WARNING,
            resource_type="user",
            resource_id=target_user_id,
            details=details,
        )
    except Exception as e:
        logger.warning("admin_users audit write failed: %s", e)


async def _get_target_user(db: AsyncSession, user_id: UUID) -> User:
    result = await db.execute(select(User).where(User.id == user_id))
    target = result.scalar_one_or_none()
    if target is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found.",
        )
    return target


@router.post("/admin/users/{user_id}/disable", status_code=status.HTTP_200_OK)
async def disable_user(
    user_id: UUID,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(get_current_user),
) -> dict[str, Any]:
    """Per-tenant kill switch. Disables the user immediately.

    Existing sessions (JWT bearer tokens) remain valid until expiry,
    BUT every authenticated endpoint runs through `get_current_user`
    which checks `is_active` — so the user is locked out within the
    next request. For hard immediate revocation, the JWT token
    blacklist (Sprint 2 work) is the next layer."""
    target = await _get_target_user(db, user_id)

    if target.id == actor.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot disable your own account from this endpoint.",
        )

    if not target.is_active:
        return {
            "status": "already_disabled",
            "user_id": str(target.id),
            "is_active": False,
        }

    target.is_active = False
    await db.commit()
    await _audit(
        db,
        actor=actor,
        action="admin.user.disable",
        target_user_id=str(target.id),
        details={"target_email": target.email, "actor_id": str(actor.id)},
    )
    logger.warning(
        "admin disabled user user_id=%s by actor=%s", target.id, actor.id,
    )
    return {
        "status": "disabled",
        "user_id": str(target.id),
        "is_active": False,
        "disabled_at": datetime.now(UTC).isoformat(),
    }


@router.post("/admin/users/{user_id}/restore", status_code=status.HTTP_200_OK)
async def restore_user(
    user_id: UUID,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(get_current_user),
) -> dict[str, Any]:
    """Reverse `disable_user`. Idempotent — restoring an already-active
    user is a no-op that returns the same status shape."""
    target = await _get_target_user(db, user_id)

    if target.is_active:
        return {
            "status": "already_active",
            "user_id": str(target.id),
            "is_active": True,
        }

    # If the user is in the GDPR soft-delete window, restore() alone
    # isn't enough — direct the operator to the dedicated endpoint.
    if target.delete_requested_at is not None and target.deleted_at is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "User has a pending account deletion. Use "
                "/admin/users/{id}/restore-deletion to cancel it."
            ),
        )

    if target.deleted_at is not None:
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="User account has been permanently deleted.",
        )

    target.is_active = True
    await db.commit()
    await _audit(
        db,
        actor=actor,
        action="admin.user.restore",
        target_user_id=str(target.id),
        details={"target_email": target.email, "actor_id": str(actor.id)},
    )
    return {
        "status": "restored",
        "user_id": str(target.id),
        "is_active": True,
        "restored_at": datetime.now(UTC).isoformat(),
    }


@router.post(
    "/admin/users/{user_id}/restore-deletion",
    status_code=status.HTTP_200_OK,
)
async def restore_account_deletion(
    user_id: UUID,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(get_current_user),
) -> dict[str, Any]:
    """Cancel a pending GDPR soft-delete. Only valid within the 30-day
    grace window (i.e. before the daily cron hard-deletes). Sets
    delete_requested_at=NULL + is_active=True."""
    target = await _get_target_user(db, user_id)

    if target.deleted_at is not None:
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="Hard-delete already fired; cannot restore.",
        )
    if target.delete_requested_at is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No pending deletion to restore.",
        )

    target.delete_requested_at = None
    target.is_active = True
    await db.commit()
    await _audit(
        db,
        actor=actor,
        action="admin.user.restore_deletion",
        target_user_id=str(target.id),
        details={"target_email": target.email, "actor_id": str(actor.id)},
    )
    return {
        "status": "deletion_cancelled",
        "user_id": str(target.id),
        "is_active": True,
        "restored_at": datetime.now(UTC).isoformat(),
    }
