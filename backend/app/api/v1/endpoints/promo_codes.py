"""Promo code endpoints — admin mint + user redemption.

User-facing:
  POST   /api/v1/account/redeem-code  { code: str }
  GET    /api/v1/account/preview-code/{code}  (no redemption, just
                                                shows what would happen)

Admin-only:
  POST   /api/v1/admin/promo-codes    create a new code
  GET    /api/v1/admin/promo-codes    list all (with redemption counts)
  POST   /api/v1/admin/promo-codes/{id}/revoke
"""
from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import ADMIN_REQUIRED, get_current_user
from app.core.database import get_db
from app.core.rate_limit import rate_limit
from app.models.user import User
from app.services.promo_service import (
    PromoError,
    create_promo_code,
    lookup_code,
    redeem,
)


user_router = APIRouter()
admin_router = APIRouter(
    dependencies=[*ADMIN_REQUIRED, Depends(rate_limit("admin"))],
)


# ─── User endpoints ────────────────────────────────────────────


class RedeemRequest(BaseModel):
    code: str = Field(min_length=1, max_length=80)


@user_router.post(
    "/account/redeem-code",
    dependencies=[Depends(rate_limit("user"))],
)
async def redeem_code(
    body: RedeemRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """Redeem a promo code for the authenticated user."""
    try:
        result = await redeem(
            db,
            code=body.code,
            user_id=current_user.id,
            user_email=current_user.email,
            user_trial_ends_at=current_user.trial_ends_at,
        )
    except PromoError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )
    return {
        "status": "redeemed",
        "code": result.code,
        "kind": result.kind,
        "value": result.value,
        "new_trial_ends_at": (
            result.new_trial_ends_at.isoformat()
            if result.new_trial_ends_at else None
        ),
        "stripe_coupon_id": result.stripe_coupon_id,
        "message": (
            f"Trial extended by {result.value} days."
            if result.kind == "trial_extension"
            else f"Discount applied — proceed to checkout to claim "
                 f"({result.value}{'%' if result.kind == 'percent_off' else '¢'} off)."
        ),
    }


@user_router.get(
    "/account/preview-code/{code}",
    dependencies=[Depends(rate_limit("user"))],
)
async def preview_code(
    code: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """Show what a code would do — does NOT redeem. Used by the
    Settings → Promo UI to validate the input before the user
    commits.

    Returns 404 if the code is unknown / revoked / expired so the
    UI can show "invalid code" without leaking the existence of
    historical codes via 200-vs-404 timing."""
    lookup = await lookup_code(db, code=code)
    if lookup is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Promo code not found, expired, or revoked.",
        )
    return {
        "code": lookup.code,
        "kind": lookup.kind,
        "value": lookup.value,
        "description": lookup.description,
        "expires_at": lookup.expires_at.isoformat() if lookup.expires_at else None,
    }


# ─── Admin endpoints ───────────────────────────────────────────


class CreatePromoRequest(BaseModel):
    code: str = Field(min_length=1, max_length=80)
    kind: str = Field(description="percent_off | fixed_cents_off | trial_extension")
    value: int = Field(gt=0)
    description: str | None = Field(default=None, max_length=400)
    expires_at: datetime | None = None
    max_redemptions: int | None = Field(default=None, gt=0)
    min_email_domain: str | None = Field(default=None, max_length=80)


@admin_router.post("/admin/promo-codes", status_code=status.HTTP_201_CREATED)
async def admin_create_promo(
    body: CreatePromoRequest,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(get_current_user),
) -> dict[str, Any]:
    try:
        promo_id = await create_promo_code(
            db,
            code=body.code,
            kind=body.kind,
            value=body.value,
            description=body.description,
            expires_at=body.expires_at,
            max_redemptions=body.max_redemptions,
            min_email_domain=body.min_email_domain,
            created_by_user_id=actor.id,
        )
    except PromoError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(e),
        )
    return {
        "id": str(promo_id),
        "code": body.code.upper(),
        "kind": body.kind,
        "value": body.value,
    }


@admin_router.get("/admin/promo-codes")
async def admin_list_promos(
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """List every promo with its current redemption count."""
    rows = (await db.execute(
        text(
            """
            SELECT pc.id, pc.code, pc.kind, pc.value, pc.description,
                   pc.expires_at, pc.max_redemptions, pc.min_email_domain,
                   pc.created_at, pc.revoked_at,
                   COALESCE((SELECT COUNT(*) FROM promo_redemptions pr
                             WHERE pr.promo_code_id = pc.id), 0) AS redemption_count
            FROM promo_codes pc
            ORDER BY pc.created_at DESC
            """
        ),
    )).all()
    return {
        "promos": [
            {
                "id": str(r[0]),
                "code": r[1],
                "kind": r[2],
                "value": r[3],
                "description": r[4],
                "expires_at": r[5].isoformat() if r[5] else None,
                "max_redemptions": r[6],
                "min_email_domain": r[7],
                "created_at": r[8].isoformat() if r[8] else None,
                "revoked_at": r[9].isoformat() if r[9] else None,
                "redemption_count": int(r[10]),
            }
            for r in rows
        ],
    }


@admin_router.post("/admin/promo-codes/{promo_id}/revoke")
async def admin_revoke_promo(
    promo_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Mark a code revoked. Existing redemptions stay (their
    discount/trial-extension already applied); future calls to
    /redeem-code reject with "this promo code has been revoked"."""
    result = await db.execute(
        text(
            """
            UPDATE promo_codes
            SET revoked_at = now()
            WHERE id = :pid AND revoked_at IS NULL
            RETURNING id
            """
        ),
        {"pid": str(promo_id)},
    )
    revoked = result.scalar_one_or_none()
    if revoked is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Promo code not found or already revoked.",
        )
    await db.commit()
    return {"status": "revoked", "promo_id": str(promo_id)}
