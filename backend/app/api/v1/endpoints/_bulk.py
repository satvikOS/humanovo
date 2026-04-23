"""
Shared bulk-ops helpers for list resources (projects, clinical-trials,
biobank samples, manuscripts, regulatory docs...).

Every endpoint that offers per-row Delete gets a /bulk-delete sibling
through `attach_bulk_delete(router, model)`. One round-trip for
multi-select actions, idempotent (unknown IDs silently skipped).
"""
from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db


class BulkIds(BaseModel):
    ids: list[UUID] = Field(..., min_length=1, max_length=200)


def attach_bulk_delete(router: APIRouter, model: Any, *, path: str = "/bulk-delete") -> None:
    """Attach a POST {path} handler that bulk-deletes rows from `model`
    matched by `model.id IN (body.ids)`.
    """
    @router.post(path)
    async def _bulk_delete(body: BulkIds, db: AsyncSession = Depends(get_db)) -> dict:
        result = await db.execute(select(model).where(model.id.in_(body.ids)))
        rows = result.scalars().all()
        found_ids = [str(r.id) for r in rows]
        for r in rows:
            await db.delete(r)
        await db.flush()
        return {"deleted": found_ids, "requested": len(body.ids), "deleted_count": len(found_ids)}


def attach_bulk_archive(
    router: APIRouter,
    model: Any,
    *,
    path: str = "/bulk-archive",
    status_field: str = "status",
    archived_value: str = "archived",
    restored_value: str = "active",
) -> None:
    """Attach a POST {path}?restore=true|false handler that flips
    `model.status_field` between `archived_value` and `restored_value`
    for every id in body. Works for models that store status as a
    string column (which most platform_entities use).
    """
    @router.post(path)
    async def _bulk_archive(
        body: BulkIds,
        restore: bool = Query(False, description="If true, flip archived rows back to active"),
        db: AsyncSession = Depends(get_db),
    ) -> dict:
        result = await db.execute(select(model).where(model.id.in_(body.ids)))
        rows = result.scalars().all()
        target = restored_value if restore else archived_value
        updated_ids: list[str] = []
        for r in rows:
            setattr(r, status_field, target)
            updated_ids.append(str(r.id))
        await db.flush()
        return {
            "updated": updated_ids,
            "requested": len(body.ids),
            "updated_count": len(updated_ids),
            "status": target,
        }
