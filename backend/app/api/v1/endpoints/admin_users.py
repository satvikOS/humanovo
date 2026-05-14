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


@router.post("/admin/users/{user_id}/grant-trial", status_code=status.HTTP_200_OK)
async def grant_trial(
    user_id: UUID,
    days: int = 14,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(get_current_user),
) -> dict[str, Any]:
    """Grant a trial to an existing user (sets trial_ends_at = now()
    + days). Use for: converted-free user who wants a second trial,
    apology credits after support incidents, beta invitee onboarding
    without going through Stripe.

    Idempotent on the new end date — calling twice extends to whichever
    is later. 410 if the user has been hard-deleted."""
    from datetime import UTC, datetime, timedelta

    if days < 1 or days > 90:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="`days` must be between 1 and 90 (inclusive).",
        )
    target = await _get_target_user(db, user_id)
    if target.deleted_at is not None:
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="User account has been permanently deleted.",
        )

    new_end = datetime.now(UTC) + timedelta(days=days)
    # Idempotent extension: never SHORTEN an existing trial; if the
    # current trial_ends_at is later than the proposed new_end, keep
    # the longer one. Operators wanting to truncate should use a
    # dedicated endpoint (not yet implemented).
    if target.trial_ends_at is not None and target.trial_ends_at > new_end:
        new_end = target.trial_ends_at
        extended = False
    else:
        extended = True

    target.trial_ends_at = new_end
    await db.commit()
    await _audit(
        db,
        actor=actor,
        action="admin.user.grant_trial",
        target_user_id=str(target.id),
        details={
            "target_email": target.email,
            "actor_id": str(actor.id),
            "days": days,
            "new_trial_ends_at": new_end.isoformat(),
            "extended": extended,
        },
    )
    return {
        "status": "granted" if extended else "no_change_existing_is_later",
        "user_id": str(target.id),
        "trial_ends_at": new_end.isoformat(),
    }


@router.get("/admin/users/{user_id}/status")
async def get_user_status(
    user_id: UUID,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(get_current_user),
) -> dict[str, Any]:
    """Full lifecycle snapshot for one user: tier + trial state +
    subscription + latest transition + recent crash count + last
    login. Used by the admin Settings dashboard ("who is this user
    and what state are they in?") + the support inbox to triage
    tickets without round-tripping through three different DB
    queries."""
    from sqlalchemy import text as sql_text

    target = await _get_target_user(db, user_id)

    # Latest subscription transition (best-effort).
    latest_transition = None
    try:
        from app.services.subscription_state import latest_transition_for_user
        latest_transition = await latest_transition_for_user(db, user_id=target.id)
    except Exception:
        pass

    # Recent crash count — last 7 days.
    crash_count_7d = 0
    try:
        row = (await db.execute(
            sql_text(
                "SELECT COUNT(*) FROM crash_reports "
                "WHERE user_id = :uid AND received_at >= now() - INTERVAL '7 days'"
            ),
            {"uid": str(target.id)},
        )).first()
        crash_count_7d = int(row[0]) if row else 0
    except Exception:
        pass

    # Active API key count.
    api_key_count = 0
    try:
        row = (await db.execute(
            sql_text(
                "SELECT COUNT(*) FROM user_api_keys "
                "WHERE user_id = :uid AND revoked_at IS NULL"
            ),
            {"uid": str(target.id)},
        )).first()
        api_key_count = int(row[0]) if row else 0
    except Exception:
        pass

    return {
        "user_id": str(target.id),
        "email": target.email,
        "full_name": target.full_name,
        "role": target.role.value if hasattr(target.role, "value") else str(target.role),
        "tier": target.tier.value if hasattr(target.tier, "value") else str(target.tier),
        "is_active": target.is_active,
        "is_verified": target.is_verified,
        "telemetry_opt_in": bool(getattr(target, "telemetry_opt_in", False)),
        "overage_enabled": bool(getattr(target, "overage_enabled", False)),
        "trial_ends_at": target.trial_ends_at.isoformat() if target.trial_ends_at else None,
        "delete_requested_at": target.delete_requested_at.isoformat() if target.delete_requested_at else None,
        "deleted_at": target.deleted_at.isoformat() if target.deleted_at else None,
        "stripe_customer_id": target.stripe_customer_id,
        "stripe_subscription_id": target.stripe_subscription_id,
        "stripe_subscription_status": target.stripe_subscription_status,
        "created_at": target.created_at.isoformat() if target.created_at else None,
        "last_login_at": target.last_login_at.isoformat() if target.last_login_at else None,
        "latest_subscription_transition": latest_transition,
        "crash_reports_last_7d": crash_count_7d,
        "active_api_keys": api_key_count,
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
