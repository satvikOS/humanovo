"""API key management endpoints — user self-service.

Three surfaces, all user-scoped (no admin role required, no
admin-role override):

  POST   /api/v1/account/api-keys              create
  GET    /api/v1/account/api-keys              list (no secrets)
  DELETE /api/v1/account/api-keys/{key_id}     revoke

Create response is the ONE time the raw token is surfaced. The
backend stores only the SHA-256 hash from there. Clients that lose
the token have to mint a new one — no recovery path.

Scopes (initial set; extend as features land):
  • discovery:read   list/view runs, costs, audit, /metrics
  • discovery:write  start a discovery, cancel a run
  • account:read     view profile, billing
  • account:write    update profile (no email change — that's a
                     separate verified flow)

A key with empty `scopes` array is effectively read-only on the
account itself; can't drive discoveries.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user
from app.core.database import get_db
from app.core.rate_limit import rate_limit
from app.models.user import User
from app.services.api_key_service import (
    create_api_key,
    list_api_keys,
    revoke_api_key,
)


router = APIRouter()


ALLOWED_SCOPES = {
    "discovery:read",
    "discovery:write",
    "account:read",
    "account:write",
}


class CreateApiKeyRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    scopes: list[str] = Field(default_factory=list)
    expires_at: datetime | None = None


@router.post(
    "/account/api-keys",
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(rate_limit("user"))],
)
async def create_key(
    body: CreateApiKeyRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """Mint a new API key. Response carries the RAW token in
    `raw_token` — the only chance to capture it. Subsequent list
    calls return only the prefix."""
    # Validate scopes against the allowed set so a malformed UI can't
    # mint a key with `admin:*` it has no business holding.
    bad = [s for s in body.scopes if s not in ALLOWED_SCOPES]
    if bad:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown scopes: {bad}. Allowed: {sorted(ALLOWED_SCOPES)}.",
        )

    issued = await create_api_key(
        db,
        user_id=current_user.id,
        name=body.name,
        scopes=body.scopes,
        expires_at=body.expires_at,
    )
    await db.commit()
    return {
        "id": str(issued.id),
        "name": issued.name,
        "prefix": issued.prefix,
        "scopes": issued.scopes,
        "created_at": issued.created_at.isoformat(),
        "expires_at": issued.expires_at.isoformat() if issued.expires_at else None,
        "raw_token": issued.raw_token,
        "warning": (
            "Copy raw_token now — it is shown only once. "
            "Subsequent list calls return only the prefix."
        ),
    }


@router.get(
    "/account/api-keys",
    dependencies=[Depends(rate_limit("user"))],
)
async def list_keys(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """List the user's active (non-revoked) keys. Never includes
    the raw token or hash — only display fields."""
    keys = await list_api_keys(db, user_id=current_user.id)
    return {"keys": keys, "count": len(keys)}


@router.delete(
    "/account/api-keys/{key_id}",
    status_code=status.HTTP_200_OK,
    dependencies=[Depends(rate_limit("user"))],
)
async def revoke_key(
    key_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """Revoke a key. Scoped to the current user — user A can't
    revoke user B's keys. 404 if the key doesn't exist OR belongs
    to someone else (don't leak which)."""
    revoked = await revoke_api_key(db, user_id=current_user.id, key_id=key_id)
    if not revoked:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="API key not found or already revoked.",
        )
    await db.commit()
    return {"status": "revoked", "key_id": str(key_id)}
