"""
Research Data Management API Endpoints

Dataset import/export, data dictionary, profiling, and cohort building.
"""

import csv
import io
import json
import logging
from collections import Counter
from datetime import datetime
from typing import Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.platform_entities import ResearchDataset

logger = logging.getLogger(__name__)
router = APIRouter()


# ── Schemas ──────────────────────────────────────────────────────

class DatasetCreate(BaseModel):
    name: str
    description: str = ""
    format: str = "csv"
    tags: list[str] = []


class DatasetUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    tags: Optional[list[str]] = None


class ColumnUpdate(BaseModel):
    name: str
    description: Optional[str] = None
    type: Optional[str] = None


class CohortFilter(BaseModel):
    column: str
    operator: str  # eq, ne, gt, lt, gte, lte, in, contains
    value: str | int | float | list


class CohortRequest(BaseModel):
    dataset_id: str
    filters: list[CohortFilter]
    name: str = "Untitled Cohort"


# ── Helpers ──────────────────────────────────────────────────────

def _infer_type(v) -> str:
    if isinstance(v, bool):
        return "boolean"
    if isinstance(v, int):
        return "integer"
    if isinstance(v, float):
        return "float"
    return "string"


def _parse_value(v: str):
    if v is None or v == "":
        return None
    try:
        return int(v)
    except ValueError:
        pass
    try:
        return float(v)
    except ValueError:
        pass
    if v.lower() in ("true", "false"):
        return v.lower() == "true"
    return v


async def _get_dataset_or_404(db: AsyncSession, dataset_id: str) -> ResearchDataset:
    result = await db.execute(
        select(ResearchDataset).where(ResearchDataset.id == dataset_id)
    )
    ds = result.scalar_one_or_none()
    if ds is None:
        raise HTTPException(status_code=404, detail="Dataset not found")
    return ds


# ── Endpoints ────────────────────────────────────────────────────

@router.get("", include_in_schema=False)
@router.get("/")
async def list_datasets(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
):
    # Count
    count_result = await db.execute(select(func.count(ResearchDataset.id)))
    total = count_result.scalar_one()

    # Fetch page
    result = await db.execute(
        select(ResearchDataset)
        .order_by(ResearchDataset.updated_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    items = result.scalars().all()
    return {
        "items": [ds.to_dict() for ds in items],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.post("", include_in_schema=False)
@router.post("/")
async def create_dataset(data: DatasetCreate, db: AsyncSession = Depends(get_db)):
    ds = ResearchDataset(
        name=data.name,
        description=data.description,
        format=data.format,
        columns=[],
        rows=[],
        row_count=0,
        tags=data.tags,
    )
    db.add(ds)
    await db.flush()
    await db.refresh(ds)
    return ds.to_dict()


@router.get("/{dataset_id}")
async def get_dataset(dataset_id: str, db: AsyncSession = Depends(get_db)):
    ds = await _get_dataset_or_404(db, dataset_id)
    return ds.to_dict()


@router.patch("/{dataset_id}")
async def update_dataset(
    dataset_id: str, data: DatasetUpdate, db: AsyncSession = Depends(get_db)
):
    ds = await _get_dataset_or_404(db, dataset_id)
    if data.name is not None:
        ds.name = data.name
    if data.description is not None:
        ds.description = data.description
    if data.tags is not None:
        ds.tags = data.tags
    await db.flush()
    await db.refresh(ds)
    return ds.to_dict()


@router.delete("/{dataset_id}")
async def delete_dataset(dataset_id: str, db: AsyncSession = Depends(get_db)):
    ds = await _get_dataset_or_404(db, dataset_id)
    await db.delete(ds)
    await db.flush()
    return {"status": "deleted"}


@router.post("/{dataset_id}/upload")
async def upload_data(
    dataset_id: str,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    ds = await _get_dataset_or_404(db, dataset_id)
    content = await file.read()
    text = content.decode("utf-8")

    if file.filename and file.filename.endswith(".json"):
        rows = json.loads(text)
        if isinstance(rows, list) and rows:
            ds.rows = rows
            ds.columns = [
                {"name": k, "type": _infer_type(v), "description": "", "nullable": True}
                for k, v in rows[0].items()
            ]
    else:
        reader = csv.DictReader(io.StringIO(text))
        raw_rows = list(reader)
        ds.rows = [{k: _parse_value(v) for k, v in row.items()} for row in raw_rows]
        if raw_rows:
            ds.columns = [
                {"name": k, "type": "string", "description": "", "nullable": True}
                for k in raw_rows[0].keys()
            ]

    ds.row_count = len(ds.rows)
    ds.format = "json" if (file.filename and file.filename.endswith(".json")) else "csv"
    await db.flush()
    await db.refresh(ds)
    return {
        "status": "uploaded",
        "row_count": ds.row_count,
        "columns": len(ds.columns),
    }


@router.get("/{dataset_id}/preview")
async def preview_data(
    dataset_id: str,
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    ds = await _get_dataset_or_404(db, dataset_id)
    rows = ds.rows or []
    return {
        "columns": ds.columns or [],
        "rows": rows[:limit],
        "total_rows": ds.row_count,
    }


@router.get("/{dataset_id}/profile")
async def profile_data(dataset_id: str, db: AsyncSession = Depends(get_db)):
    ds = await _get_dataset_or_404(db, dataset_id)
    rows = ds.rows or []
    columns = ds.columns or []
    n = len(rows)
    if n == 0:
        return {"columns": [], "row_count": 0, "completeness": 1.0}

    col_profiles = []
    for col in columns:
        name = col["name"]
        values = [r.get(name) for r in rows]
        non_null = [v for v in values if v is not None]
        nulls = n - len(non_null)

        profile = {
            "name": name,
            "type": col.get("type", "string"),
            "count": n,
            "non_null": len(non_null),
            "null_count": nulls,
            "completeness": round(len(non_null) / n, 4) if n > 0 else 0,
            "unique": len(set(str(v) for v in non_null)),
        }

        # Numeric stats
        nums = [v for v in non_null if isinstance(v, (int, float))]
        if nums:
            profile["min"] = min(nums)
            profile["max"] = max(nums)
            profile["mean"] = round(sum(nums) / len(nums), 4)

        # Categorical value counts
        if col.get("type") in ("categorical", "string", "boolean"):
            counts = Counter(str(v) for v in non_null)
            profile["value_counts"] = dict(counts.most_common(10))

        col_profiles.append(profile)

    total_cells = n * len(columns)
    null_cells = sum(p["null_count"] for p in col_profiles)

    return {
        "row_count": n,
        "column_count": len(columns),
        "total_completeness": round(1 - null_cells / total_cells, 4) if total_cells > 0 else 1.0,
        "columns": col_profiles,
    }


@router.get("/{dataset_id}/dictionary")
async def get_dictionary(dataset_id: str, db: AsyncSession = Depends(get_db)):
    ds = await _get_dataset_or_404(db, dataset_id)
    return {"columns": ds.columns or []}


@router.patch("/{dataset_id}/dictionary")
async def update_dictionary(
    dataset_id: str,
    columns: list[ColumnUpdate],
    db: AsyncSession = Depends(get_db),
):
    ds = await _get_dataset_or_404(db, dataset_id)
    col_map = {c["name"]: c for c in (ds.columns or [])}
    for update in columns:
        if update.name in col_map:
            if update.description is not None:
                col_map[update.name]["description"] = update.description
            if update.type is not None:
                col_map[update.name]["type"] = update.type
    # Reassign to trigger JSONB change detection
    ds.columns = list(col_map.values())
    await db.flush()
    await db.refresh(ds)
    return {"columns": ds.columns}


@router.post("/{dataset_id}/export")
async def export_data(
    dataset_id: str,
    format: str = Query("csv"),
    db: AsyncSession = Depends(get_db),
):
    ds = await _get_dataset_or_404(db, dataset_id)
    rows = ds.rows or []
    columns = ds.columns or []

    if format == "json":
        return Response(
            content=json.dumps(rows, indent=2),
            media_type="application/json",
            headers={"Content-Disposition": f"attachment; filename={ds.name}.json"},
        )
    else:
        if not rows:
            return Response(content="", media_type="text/csv")
        output = io.StringIO()
        writer = csv.DictWriter(output, fieldnames=[c["name"] for c in columns])
        writer.writeheader()
        writer.writerows(rows)
        return Response(
            content=output.getvalue(),
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename={ds.name}.csv"},
        )


@router.post("/cohort")
async def build_cohort(request: CohortRequest, db: AsyncSession = Depends(get_db)):
    ds = await _get_dataset_or_404(db, request.dataset_id)
    filtered = list(ds.rows or [])

    for f in request.filters:
        col = f.column
        op = f.operator
        val = f.value

        def _matches(row: dict, _col=col, _op=op, _val=val) -> bool:
            rv = row.get(_col)
            if rv is None:
                return False
            if _op == "eq":
                return str(rv) == str(_val)
            if _op == "ne":
                return str(rv) != str(_val)
            if _op == "gt":
                return float(rv) > float(_val)
            if _op == "lt":
                return float(rv) < float(_val)
            if _op == "gte":
                return float(rv) >= float(_val)
            if _op == "lte":
                return float(rv) <= float(_val)
            if _op == "in":
                return str(rv) in (_val if isinstance(_val, list) else [str(_val)])
            if _op == "contains":
                return str(_val).lower() in str(rv).lower()
            return True

        filtered = [r for r in filtered if _matches(r)]

    cohort_id = str(uuid4())
    return {
        "cohort_id": cohort_id,
        "name": request.name,
        "source_dataset": str(ds.id),
        "filters": [
            {"column": f.column, "operator": f.operator, "value": f.value}
            for f in request.filters
        ],
        "row_count": len(filtered),
        "source_row_count": ds.row_count,
        "rows": filtered[:100],
        "created_at": datetime.utcnow().isoformat(),
    }
