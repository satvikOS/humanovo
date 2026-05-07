"""
KG Permissions & Royalties API

Endpoints supporting the product directive on uploaded docs + royalties:

  - PUT  /v1/kg/documents/{document_id}/permission
        Set a document's KG scope to 'private' or 'common'. The UI shows
        this prompt when a user uploads a doc; the default is 'private'
        until the user explicitly opts in to 'common' (which makes it
        royalty-eligible).

  - GET  /v1/kg/documents/{document_id}/permission
        Retrieve the current scope.

  - GET  /v1/user/{user_id}/royalties
        Return the royalty summary for a contributor (hits, citations,
        derivations) across a rolling window. Used by the contributor
        dashboard and the billing system.

  - GET  /v1/user/{user_id}/kg/overview
        Return node counts + coverage stats for the user's private KG.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Path, Query
from pydantic import BaseModel, Field
from sqlalchemy import text

from app.core.database import async_session_factory
from app.core.logging import get_logger
from app.core.auth import AUTH_REQUIRED
from app.services.kg_first_service import (
    UploadPermission,
    get_kg_first_service,
)

logger = get_logger(__name__)

router = APIRouter(prefix="/kg", tags=["kg-permissions"], dependencies=AUTH_REQUIRED)
# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class PermissionUpdate(BaseModel):
    user_id: str = Field(..., min_length=1)
    permission: UploadPermission


class PermissionResponse(BaseModel):
    document_id: str
    user_id: str
    permission: str
    note: str | None = None


class RoyaltyResponse(BaseModel):
    user_id: str
    window_days: int
    by_kind: list[dict]
    total_weight: float
    note: str | None = None


class KGOverview(BaseModel):
    user_id: str
    private_nodes: int
    private_edges: int
    common_contributions: int
    royalty_weight_all_time: float


# ---------------------------------------------------------------------------
# Permission endpoints
# ---------------------------------------------------------------------------


@router.put("/documents/{document_id}/permission", response_model=PermissionResponse)
async def set_document_permission(
    payload: PermissionUpdate,
    document_id: str = Path(..., min_length=1, max_length=128),
):
    """Set the KG scope for a document. Default is 'private'. Choosing
    'common' makes the document and any facts extracted from it royalty-
    eligible for the user when other users query them.
    """
    svc = get_kg_first_service()
    try:
        await svc.record_document_permission(
            user_id=payload.user_id,
            document_id=document_id,
            permission=payload.permission,
        )
    except Exception as e:
        logger.warning(f"permission update failed: {e}")
        raise HTTPException(status_code=500, detail="Failed to set permission")

    note = None
    if payload.permission == UploadPermission.COMMON:
        note = (
            "Document is now shared in the common Knowledge Graph. You will "
            "receive royalty credit each time another user's agent query "
            "hits a fact derived from this document."
        )
    else:
        note = "Document kept private; not accessible to other users' agents."

    return PermissionResponse(
        document_id=document_id,
        user_id=payload.user_id,
        permission=payload.permission.value,
        note=note,
    )


@router.get("/documents/{document_id}/permission", response_model=PermissionResponse)
async def get_document_permission(
    document_id: str = Path(..., min_length=1, max_length=128),
    user_id: str = Query(..., min_length=1),
):
    svc = get_kg_first_service()
    perm = await svc.get_document_permission(user_id=user_id, document_id=document_id)
    if perm is None:
        return PermissionResponse(
            document_id=document_id,
            user_id=user_id,
            permission=UploadPermission.PRIVATE.value,
            note="No permission set yet; defaulting to private.",
        )
    return PermissionResponse(
        document_id=document_id,
        user_id=user_id,
        permission=perm.value,
    )


# ---------------------------------------------------------------------------
# Royalty summary
# ---------------------------------------------------------------------------


@router.get("/user/{user_id}/royalties", response_model=RoyaltyResponse)
async def get_user_royalties(
    user_id: str = Path(..., min_length=1, max_length=128),
    days: int = Query(default=30, ge=1, le=365),
):
    svc = get_kg_first_service()
    try:
        summary = await svc.royalty_summary(user_id=user_id, days=days)
    except Exception as e:
        logger.debug(f"royalty_summary failed (non-fatal): {e}")
        summary = {"user_id": user_id, "window_days": days, "by_kind": [], "total_weight": 0.0}

    return RoyaltyResponse(
        user_id=summary["user_id"],
        window_days=summary["window_days"],
        by_kind=summary["by_kind"],
        total_weight=float(summary["total_weight"]),
        note=(
            "Royalty weight accrues each time another user's agent query hits "
            "a fact derived from your contributed content. Actual payout is "
            "computed by billing based on current rate and your total weight."
        ),
    )


# ---------------------------------------------------------------------------
# KG overview
# ---------------------------------------------------------------------------


@router.get("/user/{user_id}/kg/overview", response_model=KGOverview)
async def get_user_kg_overview(user_id: str = Path(..., min_length=1, max_length=128)):
    svc = get_kg_first_service()
    await svc.ensure_schema()

    async with async_session_factory() as session:
        priv_nodes = await session.execute(
            text("SELECT COUNT(*) FROM kg_nodes WHERE scope='private' AND owner_user_id=:uid"),
            {"uid": user_id},
        )
        priv_edges = await session.execute(
            text("SELECT COUNT(*) FROM kg_edges WHERE scope='private' AND owner_user_id=:uid"),
            {"uid": user_id},
        )
        contrib = await session.execute(
            text("SELECT COUNT(*) FROM kg_nodes WHERE scope='common' AND owner_user_id=:uid"),
            {"uid": user_id},
        )
        royalty = await session.execute(
            text("""
                SELECT COALESCE(SUM(multiplier),0)
                FROM kg_royalty_events WHERE contributor_user_id=:uid
            """),
            {"uid": user_id},
        )

        def _scalar(row):
            r = row.fetchone()
            if not r:
                return 0
            v = r[0]
            return int(v) if isinstance(v, int) else float(v or 0)

        return KGOverview(
            user_id=user_id,
            private_nodes=_scalar(priv_nodes),
            private_edges=_scalar(priv_edges),
            common_contributions=_scalar(contrib),
            royalty_weight_all_time=float(_scalar(royalty)),
        )
