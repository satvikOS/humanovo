"""
User State API Endpoints

Sync user state (localStorage) across devices.
Uses in-memory storage for the FastAPI backend (same pattern as simulation.py).
"""

from datetime import datetime
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.core.logging import get_logger

logger = get_logger(__name__)
router = APIRouter()

# Valid state keys that can be synced
VALID_KEYS = {
    "experiments",
    "mc-simulations",
    "eq-history",
    "comp-history",
    "activity-log",
    "notebook-index",
    "workspace-tabs",
    "workspace-active-tab",
    "charts",
    "research-papers",
    "tab-counter",
    "citations",
    "project-documents",
}


class StateValue(BaseModel):
    """Schema for setting a state value."""
    value: Any


class StateItemResponse(BaseModel):
    """Schema for a single state item."""
    key: str
    value: Any
    updated_at: str


class StateKeyInfo(BaseModel):
    """Schema for state key metadata (no value)."""
    key: str
    updated_at: str


class StateListResponse(BaseModel):
    """Schema for listing all state keys."""
    items: list[StateKeyInfo]


# In-memory storage: key -> { value, updated_at }
_state_store: dict[str, dict[str, Any]] = {}


@router.get("", response_model=StateListResponse)
async def list_state_keys() -> StateListResponse:
    """List all stored state keys with their updated_at timestamps."""
    items = [
        StateKeyInfo(key=k, updated_at=v["updated_at"])
        for k, v in _state_store.items()
    ]
    items.sort(key=lambda x: x.updated_at, reverse=True)
    return StateListResponse(items=items)


@router.get("/{key}", response_model=StateItemResponse)
async def get_state(key: str) -> StateItemResponse:
    """Get a state value by key."""
    if key not in _state_store:
        raise HTTPException(status_code=404, detail=f"State key not found: {key}")

    entry = _state_store[key]
    return StateItemResponse(
        key=key,
        value=entry["value"],
        updated_at=entry["updated_at"],
    )


@router.put("/{key}", response_model=StateItemResponse)
async def put_state(key: str, body: StateValue) -> StateItemResponse:
    """Set a state value by key (last-write-wins)."""
    now = datetime.utcnow().isoformat()

    _state_store[key] = {
        "value": body.value,
        "updated_at": now,
    }

    logger.info("State updated", key=key)

    return StateItemResponse(
        key=key,
        value=body.value,
        updated_at=now,
    )


@router.delete("/{key}", status_code=200)
async def delete_state(key: str) -> dict[str, str]:
    """Delete a state key."""
    if key not in _state_store:
        raise HTTPException(status_code=404, detail=f"State key not found: {key}")

    del _state_store[key]
    logger.info("State deleted", key=key)

    return {"detail": f"State key '{key}' deleted"}
