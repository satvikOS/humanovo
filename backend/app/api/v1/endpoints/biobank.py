"""
Biobank / Sample Management API Endpoints

Sample registry, chain of custody, checkout workflow, storage management.
"""

import logging
from datetime import datetime, timezone
from typing import Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.auth import AUTH_REQUIRED
from app.models.platform_entities import BiobankSample, StorageLocation
from app.api.v1.endpoints._bulk import attach_bulk_delete, attach_bulk_archive

logger = logging.getLogger(__name__)
router = APIRouter(dependencies=AUTH_REQUIRED)
# ── Schemas ─────────────────────────────────────────────────────


class SampleCreate(BaseModel):
    barcode: str = ""
    sample_type: str = "tissue"
    tissue_type: str = ""
    project: str = ""
    patient_id: str = ""
    quantity: str = ""
    storage_location: Optional[str] = None


class SampleUpdate(BaseModel):
    status: Optional[str] = None
    project: Optional[str] = None
    storage_location: Optional[str] = None
    quality_score: Optional[float] = None


class CheckoutRequest(BaseModel):
    researcher: str
    purpose: str = ""
    expected_return: Optional[str] = None


# ── Samples ─────────────────────────────────────────────────────


@router.get("")
@router.get("/")
@router.get("/samples")
async def list_samples(
    sample_type: Optional[str] = None,
    status: Optional[str] = None,
    project: Optional[str] = None,
    search: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    query = select(BiobankSample)
    if sample_type:
        query = query.where(BiobankSample.sample_type == sample_type)
    if status:
        query = query.where(BiobankSample.status == status)
    if project:
        query = query.where(BiobankSample.project.ilike(f"%{project}%"))
    if search:
        pattern = f"%{search}%"
        query = query.where(
            BiobankSample.barcode.ilike(pattern)
            | BiobankSample.tissue_type.ilike(pattern)
            | BiobankSample.patient_id.ilike(pattern)
        )
    query = query.order_by(BiobankSample.created_at.desc())
    result = await db.execute(query)
    items = result.scalars().all()
    return {"items": [s.to_dict() for s in items], "total": len(items)}


@router.post("/samples")
async def create_sample(data: SampleCreate, db: AsyncSession = Depends(get_db)):
    barcode = data.barcode or f"BIO-{str(uuid4())[:6].upper()}"
    now = datetime.now(timezone.utc)
    sample = BiobankSample(
        barcode=barcode,
        sample_type=data.sample_type,
        status="available",
        project=data.project,
        tissue_type=data.tissue_type,
        patient_id=data.patient_id,
        collection_date=now.strftime("%Y-%m-%d"),
        storage_location_id=data.storage_location,
        storage_details={},
        quantity=data.quantity,
        quality_score=1.0,
        chain_of_custody=[
            {
                "action": "registered",
                "by": "Current User",
                "date": now.strftime("%Y-%m-%d"),
                "notes": "Sample registered",
            }
        ],
    )
    db.add(sample)
    await db.flush()
    return sample.to_dict()


@router.get("/samples/{sample_id}")
async def get_sample(sample_id: str, db: AsyncSession = Depends(get_db)):
    sample = await db.get(BiobankSample, sample_id)
    if not sample:
        raise HTTPException(status_code=404, detail="Sample not found")
    return sample.to_dict()


@router.patch("/samples/{sample_id}")
async def update_sample(sample_id: str, data: SampleUpdate, db: AsyncSession = Depends(get_db)):
    sample = await db.get(BiobankSample, sample_id)
    if not sample:
        raise HTTPException(status_code=404, detail="Sample not found")
    if data.status is not None:
        sample.status = data.status
    if data.project is not None:
        sample.project = data.project
    if data.storage_location is not None:
        sample.storage_location_id = data.storage_location
    if data.quality_score is not None:
        sample.quality_score = data.quality_score
    await db.flush()
    return sample.to_dict()


@router.delete("/samples/{sample_id}")
async def delete_sample(sample_id: str, db: AsyncSession = Depends(get_db)):
    sample = await db.get(BiobankSample, sample_id)
    if not sample:
        raise HTTPException(status_code=404, detail="Sample not found")
    await db.delete(sample)
    await db.flush()
    return {"status": "deleted"}


@router.post("/samples/{sample_id}/checkout")
async def checkout_sample(
    sample_id: str, data: CheckoutRequest, db: AsyncSession = Depends(get_db)
):
    sample = await db.get(BiobankSample, sample_id)
    if not sample:
        raise HTTPException(status_code=404, detail="Sample not found")
    if sample.status != "available":
        raise HTTPException(
            status_code=400, detail=f"Sample is {sample.status}, cannot checkout"
        )
    sample.status = "checked_out"
    custody = list(sample.chain_of_custody or [])
    custody.append(
        {
            "action": "checked_out",
            "by": data.researcher,
            "date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
            "notes": f"Purpose: {data.purpose}"
            + (f", Expected return: {data.expected_return}" if data.expected_return else ""),
        }
    )
    sample.chain_of_custody = custody
    await db.flush()
    return sample.to_dict()


@router.post("/samples/{sample_id}/checkin")
async def checkin_sample(
    sample_id: str,
    condition: str = Query("good"),
    db: AsyncSession = Depends(get_db),
):
    sample = await db.get(BiobankSample, sample_id)
    if not sample:
        raise HTTPException(status_code=404, detail="Sample not found")
    if sample.status != "checked_out":
        raise HTTPException(
            status_code=400, detail=f"Sample is {sample.status}, cannot checkin"
        )
    sample.status = "available"
    custody = list(sample.chain_of_custody or [])
    custody.append(
        {
            "action": "returned",
            "by": "Current User",
            "date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
            "notes": f"Condition: {condition}",
        }
    )
    sample.chain_of_custody = custody
    await db.flush()
    return sample.to_dict()


# ── Storage ─────────────────────────────────────────────────────


@router.get("/storage")
async def list_storage(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(StorageLocation).order_by(StorageLocation.name)
    )
    items = result.scalars().all()
    return {"items": [loc.to_dict() for loc in items], "total": len(items)}


@router.get("/storage/{location_id}")
async def get_storage(location_id: str, db: AsyncSession = Depends(get_db)):
    location = await db.get(StorageLocation, location_id)
    if not location:
        raise HTTPException(status_code=404, detail="Location not found")
    return location.to_dict()


# ── Inventory Dashboard ────────────────────────────────────────


@router.get("/inventory")
async def get_inventory(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(BiobankSample))
    samples = result.scalars().all()

    by_type: dict[str, int] = {}
    by_status: dict[str, int] = {}
    by_project: dict[str, int] = {}
    for s in samples:
        by_type[s.sample_type] = by_type.get(s.sample_type, 0) + 1
        by_status[s.status] = by_status.get(s.status, 0) + 1
        if s.project:
            by_project[s.project] = by_project.get(s.project, 0) + 1

    low_stock_types = [t for t, count in by_type.items() if count < 3]
    alerts: list[dict] = []
    if low_stock_types:
        alerts.append(
            {
                "type": "low_stock",
                "message": f"Low stock for: {', '.join(low_stock_types)}",
                "severity": "warning",
            }
        )
    depleted = by_status.get("depleted", 0)
    if depleted > 0:
        alerts.append(
            {
                "type": "depleted",
                "message": f"{depleted} sample(s) depleted",
                "severity": "info",
            }
        )

    storage_result = await db.execute(select(StorageLocation))
    locations = storage_result.scalars().all()

    return {
        "total_samples": len(samples),
        "by_type": by_type,
        "by_status": by_status,
        "by_project": by_project,
        "alerts": alerts,
        "storage_utilization": [
            {
                "name": loc.name,
                "capacity": loc.capacity,
                "used": loc.used,
                "utilization_pct": round(loc.used / loc.capacity * 100, 1)
                if loc.capacity > 0
                else 0,
            }
            for loc in locations
        ],
    }


# Bulk operations
attach_bulk_delete(router, BiobankSample, path="/samples/bulk-delete")
attach_bulk_archive(router, BiobankSample, path="/samples/bulk-archive")
