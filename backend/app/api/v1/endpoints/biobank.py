"""
Biobank / Sample Management API Endpoints

Sample registry, chain of custody, checkout workflow, storage management.
"""

import logging
from datetime import datetime
from typing import Optional
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

logger = logging.getLogger(__name__)
router = APIRouter()

_samples: dict[str, dict] = {}
_storage_locations: dict[str, dict] = {}


def _seed():
    if _samples:
        return

    # Seed storage locations
    for freezer, temp in [("Freezer-A", "-80°C"), ("Freezer-B", "-20°C"), ("LN2-Tank-1", "-196°C"), ("Fridge-1", "4°C")]:
        lid = str(uuid4())
        _storage_locations[lid] = {
            "id": lid, "name": freezer, "temperature": temp, "type": "freezer" if "Freezer" in freezer else ("cryogenic" if "LN2" in freezer else "refrigerator"),
            "capacity": 500, "used": 0, "racks": [
                {"name": f"Rack {i+1}", "boxes": [
                    {"name": f"Box {j+1}", "positions": 81, "used": 0}
                    for j in range(4)
                ]} for i in range(3)
            ],
            "created_at": datetime.utcnow().isoformat(),
        }

    loc_ids = list(_storage_locations.keys())

    for barcode, stype, status, project, tissue in [
        ("BIO-001", "tissue", "available", "EGFR Trial", "Lung biopsy"),
        ("BIO-002", "blood", "checked_out", "EGFR Trial", "Peripheral blood"),
        ("BIO-003", "dna", "available", "Biomarker Study", "Extracted DNA"),
        ("BIO-004", "rna", "available", "Biomarker Study", "Extracted RNA"),
        ("BIO-005", "plasma", "depleted", "Proteomics", "Plasma aliquot"),
        ("BIO-006", "tissue", "available", "EGFR Trial", "Tumor resection"),
        ("BIO-007", "cell_line", "available", "Drug Screening", "A549 cells"),
        ("BIO-008", "serum", "available", "Longitudinal Study", "Serum sample"),
    ]:
        sid = str(uuid4())
        loc = loc_ids[hash(barcode) % len(loc_ids)] if loc_ids else None
        _samples[sid] = {
            "id": sid, "barcode": barcode, "sample_type": stype,
            "status": status, "project": project, "tissue_type": tissue,
            "patient_id": f"P{hash(barcode) % 100 + 100:03d}",
            "collection_date": f"2024-{(hash(barcode) % 12) + 1:02d}-{(hash(barcode) % 28) + 1:02d}",
            "storage_location": loc,
            "storage_details": {"freezer": "Freezer-A", "rack": "Rack 1", "box": "Box 1", "position": f"{chr(65 + hash(barcode) % 9)}{hash(barcode) % 9 + 1}"},
            "quantity": f"{(hash(barcode) % 5 + 1) * 100}µL" if stype in ("blood", "plasma", "serum") else "1 piece",
            "quality_score": round(0.7 + (hash(barcode) % 30) / 100, 2),
            "chain_of_custody": [
                {"action": "collected", "by": "Lab Tech A", "date": f"2024-{(hash(barcode) % 12) + 1:02d}-{(hash(barcode) % 28) + 1:02d}", "notes": "Initial collection"},
                {"action": "stored", "by": "Lab Tech A", "date": f"2024-{(hash(barcode) % 12) + 1:02d}-{(hash(barcode) % 28) + 2:02d}", "notes": f"Stored in Freezer-A"},
            ],
            "created_at": datetime.utcnow().isoformat(),
        }
        if loc:
            _storage_locations[loc]["used"] += 1


_seed()


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


# ── Samples ──────────────────────────────────────────────────────

@router.get("/samples")
async def list_samples(
    sample_type: Optional[str] = None,
    status: Optional[str] = None,
    project: Optional[str] = None,
    search: Optional[str] = None,
):
    items = list(_samples.values())
    if sample_type:
        items = [s for s in items if s["sample_type"] == sample_type]
    if status:
        items = [s for s in items if s["status"] == status]
    if project:
        items = [s for s in items if project.lower() in s.get("project", "").lower()]
    if search:
        q = search.lower()
        items = [s for s in items if q in s.get("barcode", "").lower() or q in s.get("tissue_type", "").lower() or q in s.get("patient_id", "").lower()]
    items.sort(key=lambda s: s["created_at"], reverse=True)
    return {"items": items, "total": len(items)}


@router.post("/samples")
async def create_sample(data: SampleCreate):
    sid = str(uuid4())
    now = datetime.utcnow().isoformat()
    sample = {
        "id": sid, "barcode": data.barcode or f"BIO-{str(uuid4())[:6].upper()}",
        "sample_type": data.sample_type, "status": "available",
        "project": data.project, "tissue_type": data.tissue_type,
        "patient_id": data.patient_id, "collection_date": datetime.utcnow().strftime("%Y-%m-%d"),
        "storage_location": data.storage_location,
        "storage_details": {}, "quantity": data.quantity, "quality_score": 1.0,
        "chain_of_custody": [
            {"action": "registered", "by": "Current User", "date": datetime.utcnow().strftime("%Y-%m-%d"), "notes": "Sample registered"},
        ],
        "created_at": now,
    }
    _samples[sid] = sample
    return sample


@router.get("/samples/{sample_id}")
async def get_sample(sample_id: str):
    if sample_id not in _samples:
        raise HTTPException(status_code=404, detail="Sample not found")
    return _samples[sample_id]


@router.patch("/samples/{sample_id}")
async def update_sample(sample_id: str, data: SampleUpdate):
    if sample_id not in _samples:
        raise HTTPException(status_code=404, detail="Sample not found")
    s = _samples[sample_id]
    if data.status is not None: s["status"] = data.status
    if data.project is not None: s["project"] = data.project
    if data.storage_location is not None: s["storage_location"] = data.storage_location
    if data.quality_score is not None: s["quality_score"] = data.quality_score
    return s


@router.delete("/samples/{sample_id}")
async def delete_sample(sample_id: str):
    if sample_id not in _samples:
        raise HTTPException(status_code=404, detail="Sample not found")
    del _samples[sample_id]
    return {"status": "deleted"}


@router.post("/samples/{sample_id}/checkout")
async def checkout_sample(sample_id: str, data: CheckoutRequest):
    if sample_id not in _samples:
        raise HTTPException(status_code=404, detail="Sample not found")
    s = _samples[sample_id]
    if s["status"] != "available":
        raise HTTPException(status_code=400, detail=f"Sample is {s['status']}, cannot checkout")
    s["status"] = "checked_out"
    s["chain_of_custody"].append({
        "action": "checked_out", "by": data.researcher,
        "date": datetime.utcnow().strftime("%Y-%m-%d"),
        "notes": f"Purpose: {data.purpose}" + (f", Expected return: {data.expected_return}" if data.expected_return else ""),
    })
    return s


@router.post("/samples/{sample_id}/checkin")
async def checkin_sample(sample_id: str, condition: str = Query("good")):
    if sample_id not in _samples:
        raise HTTPException(status_code=404, detail="Sample not found")
    s = _samples[sample_id]
    if s["status"] != "checked_out":
        raise HTTPException(status_code=400, detail=f"Sample is {s['status']}, cannot checkin")
    s["status"] = "available"
    s["chain_of_custody"].append({
        "action": "returned", "by": "Current User",
        "date": datetime.utcnow().strftime("%Y-%m-%d"),
        "notes": f"Condition: {condition}",
    })
    return s


# ── Storage ──────────────────────────────────────────────────────

@router.get("/storage")
async def list_storage():
    items = sorted(_storage_locations.values(), key=lambda s: s["name"])
    return {"items": items, "total": len(items)}


@router.get("/storage/{location_id}")
async def get_storage(location_id: str):
    if location_id not in _storage_locations:
        raise HTTPException(status_code=404, detail="Location not found")
    return _storage_locations[location_id]


# ── Inventory Dashboard ─────────────────────────────────────────

@router.get("/inventory")
async def get_inventory():
    samples = list(_samples.values())
    by_type = {}
    by_status = {}
    by_project = {}
    for s in samples:
        by_type[s["sample_type"]] = by_type.get(s["sample_type"], 0) + 1
        by_status[s["status"]] = by_status.get(s["status"], 0) + 1
        if s.get("project"):
            by_project[s["project"]] = by_project.get(s["project"], 0) + 1

    low_stock_types = [t for t, count in by_type.items() if count < 3]
    alerts = []
    if low_stock_types:
        alerts.append({"type": "low_stock", "message": f"Low stock for: {', '.join(low_stock_types)}", "severity": "warning"})
    depleted = by_status.get("depleted", 0)
    if depleted > 0:
        alerts.append({"type": "depleted", "message": f"{depleted} sample(s) depleted", "severity": "info"})

    return {
        "total_samples": len(samples),
        "by_type": by_type,
        "by_status": by_status,
        "by_project": by_project,
        "alerts": alerts,
        "storage_utilization": [
            {"name": loc["name"], "capacity": loc["capacity"], "used": loc["used"],
             "utilization_pct": round(loc["used"] / loc["capacity"] * 100, 1) if loc["capacity"] > 0 else 0}
            for loc in _storage_locations.values()
        ],
    }
