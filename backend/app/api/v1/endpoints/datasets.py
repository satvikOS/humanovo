"""
Research Data Management API Endpoints

Dataset import/export, data dictionary, profiling, and cohort building.
"""

import csv
import io
import json
import logging
from datetime import datetime
from typing import Optional
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Query, UploadFile, File
from fastapi.responses import Response
from pydantic import BaseModel

logger = logging.getLogger(__name__)
router = APIRouter()

_datasets: dict[str, dict] = {}


def _ensure_defaults():
    if not _datasets:
        ds_id = str(uuid4())
        _datasets[ds_id] = {
            "id": ds_id,
            "name": "Sample Clinical Trial Data",
            "description": "Example dataset with patient demographics and outcomes",
            "format": "csv",
            "columns": [
                {"name": "patient_id", "type": "string", "description": "Unique patient identifier", "nullable": False},
                {"name": "age", "type": "integer", "description": "Patient age in years", "nullable": False},
                {"name": "sex", "type": "categorical", "description": "Patient sex (M/F)", "nullable": False},
                {"name": "bmi", "type": "float", "description": "Body mass index", "nullable": True},
                {"name": "treatment_group", "type": "categorical", "description": "Treatment arm", "nullable": False},
                {"name": "outcome_score", "type": "float", "description": "Primary outcome score", "nullable": False},
                {"name": "adverse_event", "type": "boolean", "description": "Adverse event occurred", "nullable": False},
            ],
            "rows": [
                {"patient_id": "P001", "age": 45, "sex": "M", "bmi": 24.5, "treatment_group": "A", "outcome_score": 78.2, "adverse_event": False},
                {"patient_id": "P002", "age": 52, "sex": "F", "bmi": 28.1, "treatment_group": "B", "outcome_score": 82.5, "adverse_event": False},
                {"patient_id": "P003", "age": 38, "sex": "M", "bmi": 22.3, "treatment_group": "A", "outcome_score": 71.0, "adverse_event": True},
                {"patient_id": "P004", "age": 61, "sex": "F", "bmi": 31.2, "treatment_group": "B", "outcome_score": 85.1, "adverse_event": False},
                {"patient_id": "P005", "age": 29, "sex": "M", "bmi": 20.8, "treatment_group": "A", "outcome_score": 68.7, "adverse_event": False},
                {"patient_id": "P006", "age": 55, "sex": "F", "bmi": None, "treatment_group": "B", "outcome_score": 79.3, "adverse_event": True},
                {"patient_id": "P007", "age": 43, "sex": "M", "bmi": 26.7, "treatment_group": "A", "outcome_score": 74.6, "adverse_event": False},
                {"patient_id": "P008", "age": 67, "sex": "F", "bmi": 29.4, "treatment_group": "B", "outcome_score": 88.2, "adverse_event": False},
            ],
            "row_count": 8,
            "tags": ["clinical-trial", "demographics"],
            "created_at": datetime.utcnow().isoformat(),
            "updated_at": datetime.utcnow().isoformat(),
        }


_ensure_defaults()


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


@router.get("/")
async def list_datasets(page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=200)):
    items = sorted(_datasets.values(), key=lambda d: d["updated_at"], reverse=True)
    total = len(items)
    start = (page - 1) * page_size
    return {"items": items[:], "total": total, "page": page, "page_size": page_size}


@router.post("/")
async def create_dataset(data: DatasetCreate):
    ds_id = str(uuid4())
    now = datetime.utcnow().isoformat()
    ds = {
        "id": ds_id, "name": data.name, "description": data.description,
        "format": data.format, "columns": [], "rows": [], "row_count": 0,
        "tags": data.tags, "created_at": now, "updated_at": now,
    }
    _datasets[ds_id] = ds
    return ds


@router.get("/{dataset_id}")
async def get_dataset(dataset_id: str):
    if dataset_id not in _datasets:
        raise HTTPException(status_code=404, detail="Dataset not found")
    return _datasets[dataset_id]


@router.patch("/{dataset_id}")
async def update_dataset(dataset_id: str, data: DatasetUpdate):
    if dataset_id not in _datasets:
        raise HTTPException(status_code=404, detail="Dataset not found")
    ds = _datasets[dataset_id]
    if data.name is not None: ds["name"] = data.name
    if data.description is not None: ds["description"] = data.description
    if data.tags is not None: ds["tags"] = data.tags
    ds["updated_at"] = datetime.utcnow().isoformat()
    return ds


@router.delete("/{dataset_id}")
async def delete_dataset(dataset_id: str):
    if dataset_id not in _datasets:
        raise HTTPException(status_code=404, detail="Dataset not found")
    del _datasets[dataset_id]
    return {"status": "deleted"}


@router.post("/{dataset_id}/upload")
async def upload_data(dataset_id: str, file: UploadFile = File(...)):
    if dataset_id not in _datasets:
        raise HTTPException(status_code=404, detail="Dataset not found")
    ds = _datasets[dataset_id]
    content = await file.read()
    text = content.decode("utf-8")

    if file.filename and file.filename.endswith(".json"):
        rows = json.loads(text)
        if isinstance(rows, list) and rows:
            ds["rows"] = rows
            ds["columns"] = [{"name": k, "type": _infer_type(v), "description": "", "nullable": True} for k, v in rows[0].items()]
    else:
        reader = csv.DictReader(io.StringIO(text))
        rows = list(reader)
        ds["rows"] = [{k: _parse_value(v) for k, v in row.items()} for row in rows]
        if rows:
            ds["columns"] = [{"name": k, "type": "string", "description": "", "nullable": True} for k in rows[0].keys()]

    ds["row_count"] = len(ds["rows"])
    ds["format"] = "json" if (file.filename and file.filename.endswith(".json")) else "csv"
    ds["updated_at"] = datetime.utcnow().isoformat()
    return {"status": "uploaded", "row_count": ds["row_count"], "columns": len(ds["columns"])}


def _infer_type(v) -> str:
    if isinstance(v, bool): return "boolean"
    if isinstance(v, int): return "integer"
    if isinstance(v, float): return "float"
    return "string"


def _parse_value(v: str):
    if v is None or v == "": return None
    try: return int(v)
    except ValueError: pass
    try: return float(v)
    except ValueError: pass
    if v.lower() in ("true", "false"): return v.lower() == "true"
    return v


@router.get("/{dataset_id}/preview")
async def preview_data(dataset_id: str, limit: int = Query(20, ge=1, le=100)):
    if dataset_id not in _datasets:
        raise HTTPException(status_code=404, detail="Dataset not found")
    ds = _datasets[dataset_id]
    return {"columns": ds["columns"], "rows": ds["rows"][:limit], "total_rows": ds["row_count"]}


@router.get("/{dataset_id}/profile")
async def profile_data(dataset_id: str):
    if dataset_id not in _datasets:
        raise HTTPException(status_code=404, detail="Dataset not found")
    ds = _datasets[dataset_id]
    rows = ds["rows"]
    n = len(rows)
    if n == 0:
        return {"columns": [], "row_count": 0, "completeness": 1.0}

    col_profiles = []
    for col in ds["columns"]:
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
            from collections import Counter
            counts = Counter(str(v) for v in non_null)
            profile["value_counts"] = dict(counts.most_common(10))

        col_profiles.append(profile)

    total_cells = n * len(ds["columns"])
    null_cells = sum(p["null_count"] for p in col_profiles)

    return {
        "row_count": n,
        "column_count": len(ds["columns"]),
        "total_completeness": round(1 - null_cells / total_cells, 4) if total_cells > 0 else 1.0,
        "columns": col_profiles,
    }


@router.get("/{dataset_id}/dictionary")
async def get_dictionary(dataset_id: str):
    if dataset_id not in _datasets:
        raise HTTPException(status_code=404, detail="Dataset not found")
    return {"columns": _datasets[dataset_id]["columns"]}


@router.patch("/{dataset_id}/dictionary")
async def update_dictionary(dataset_id: str, columns: list[ColumnUpdate]):
    if dataset_id not in _datasets:
        raise HTTPException(status_code=404, detail="Dataset not found")
    ds = _datasets[dataset_id]
    col_map = {c["name"]: c for c in ds["columns"]}
    for update in columns:
        if update.name in col_map:
            if update.description is not None: col_map[update.name]["description"] = update.description
            if update.type is not None: col_map[update.name]["type"] = update.type
    ds["updated_at"] = datetime.utcnow().isoformat()
    return {"columns": ds["columns"]}


@router.post("/{dataset_id}/export")
async def export_data(dataset_id: str, format: str = Query("csv")):
    if dataset_id not in _datasets:
        raise HTTPException(status_code=404, detail="Dataset not found")
    ds = _datasets[dataset_id]

    if format == "json":
        return Response(
            content=json.dumps(ds["rows"], indent=2),
            media_type="application/json",
            headers={"Content-Disposition": f"attachment; filename={ds['name']}.json"},
        )
    else:
        if not ds["rows"]:
            return Response(content="", media_type="text/csv")
        output = io.StringIO()
        writer = csv.DictWriter(output, fieldnames=[c["name"] for c in ds["columns"]])
        writer.writeheader()
        writer.writerows(ds["rows"])
        return Response(
            content=output.getvalue(),
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename={ds['name']}.csv"},
        )


@router.post("/cohort")
async def build_cohort(request: CohortRequest):
    if request.dataset_id not in _datasets:
        raise HTTPException(status_code=404, detail="Dataset not found")
    ds = _datasets[request.dataset_id]
    filtered = ds["rows"][:]

    for f in request.filters:
        col = f.column
        op = f.operator
        val = f.value

        def _matches(row: dict) -> bool:
            rv = row.get(col)
            if rv is None: return False
            if op == "eq": return str(rv) == str(val)
            if op == "ne": return str(rv) != str(val)
            if op == "gt": return float(rv) > float(val)
            if op == "lt": return float(rv) < float(val)
            if op == "gte": return float(rv) >= float(val)
            if op == "lte": return float(rv) <= float(val)
            if op == "in": return str(rv) in (val if isinstance(val, list) else [str(val)])
            if op == "contains": return str(val).lower() in str(rv).lower()
            return True

        filtered = [r for r in filtered if _matches(r)]

    cohort_id = str(uuid4())
    return {
        "cohort_id": cohort_id,
        "name": request.name,
        "source_dataset": request.dataset_id,
        "filters": [{"column": f.column, "operator": f.operator, "value": f.value} for f in request.filters],
        "row_count": len(filtered),
        "source_row_count": ds["row_count"],
        "rows": filtered[:100],
        "created_at": datetime.utcnow().isoformat(),
    }
