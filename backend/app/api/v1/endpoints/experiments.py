"""
Experiments API

Lightweight CRUD for the Experiment Tracker page. In-memory storage
matches the existing `simulations` pattern — real persistence is a
follow-up (migration + ORM model) but the frontend depends on a live
backend surface today, so we provide one.
"""
from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.core.auth import AUTH_REQUIRED

router = APIRouter(dependencies=AUTH_REQUIRED)
# ── Schemas ──────────────────────────────────────────────────────

EXPERIMENT_STATUSES = {"planned", "in_progress", "completed", "failed", "paused"}


class ExperimentCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=300)
    hypothesis: str = ""
    status: str = "planned"
    protocol: list[str] = Field(default_factory=list)
    materials: list[str] = Field(default_factory=list)
    observations: str = ""
    results: str = ""
    conclusion: str = ""
    tags: list[str] = Field(default_factory=list)
    start_date: str | None = None
    end_date: str | None = None
    project_id: UUID | None = None


class ExperimentUpdate(BaseModel):
    title: str | None = None
    hypothesis: str | None = None
    status: str | None = None
    protocol: list[str] | None = None
    materials: list[str] | None = None
    observations: str | None = None
    results: str | None = None
    conclusion: str | None = None
    tags: list[str] | None = None
    start_date: str | None = None
    end_date: str | None = None
    project_id: UUID | None = None


class Experiment(ExperimentCreate):
    id: UUID
    created_at: datetime
    updated_at: datetime


class ExperimentListResponse(BaseModel):
    items: list[Experiment]
    total: int
    page: int
    page_size: int


# ── In-memory store ──────────────────────────────────────────────
# Keyed by UUID. Survives a single process lifetime; good enough for
# demo + dev until an Experiment ORM model lands.
_experiments: dict[UUID, Experiment] = {}


def _validate_status(status: str | None) -> None:
    if status is not None and status not in EXPERIMENT_STATUSES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid status '{status}'. Must be one of: {sorted(EXPERIMENT_STATUSES)}",
        )


# ── Endpoints ────────────────────────────────────────────────────

@router.get("", response_model=ExperimentListResponse)
async def list_experiments(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
    status: str | None = None,
    project_id: UUID | None = None,
) -> ExperimentListResponse:
    _validate_status(status)
    items = list(_experiments.values())
    if status:
        items = [e for e in items if e.status == status]
    if project_id is not None:
        items = [e for e in items if e.project_id == project_id]
    items.sort(key=lambda e: e.updated_at, reverse=True)
    total = len(items)
    offset = (page - 1) * page_size
    return ExperimentListResponse(
        items=items[offset:offset + page_size],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.post("", response_model=Experiment, status_code=201)
async def create_experiment(body: ExperimentCreate) -> Experiment:
    _validate_status(body.status)
    now = datetime.now(UTC)
    exp = Experiment(
        id=uuid4(),
        created_at=now,
        updated_at=now,
        **body.model_dump(),
    )
    _experiments[exp.id] = exp
    return exp


@router.get("/{experiment_id}", response_model=Experiment)
async def get_experiment(experiment_id: UUID) -> Experiment:
    exp = _experiments.get(experiment_id)
    if not exp:
        raise HTTPException(status_code=404, detail="Experiment not found")
    return exp


@router.patch("/{experiment_id}", response_model=Experiment)
async def update_experiment(experiment_id: UUID, body: ExperimentUpdate) -> Experiment:
    exp = _experiments.get(experiment_id)
    if not exp:
        raise HTTPException(status_code=404, detail="Experiment not found")
    update = body.model_dump(exclude_unset=True)
    _validate_status(update.get("status"))
    updated = exp.model_copy(update={**update, "updated_at": datetime.now(UTC)})
    _experiments[experiment_id] = updated
    return updated


@router.delete("/{experiment_id}", status_code=204)
async def delete_experiment(experiment_id: UUID) -> None:
    if experiment_id not in _experiments:
        raise HTTPException(status_code=404, detail="Experiment not found")
    del _experiments[experiment_id]
