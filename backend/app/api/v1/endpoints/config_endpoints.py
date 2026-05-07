"""
Configuration API Endpoints

Serves static configuration data:
- Methods taxonomy (for lab profile editor, method filtering)
- Model pricing (for cost estimation)
"""

import json
from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from app.core.logging import get_logger
from app.core.auth import AUTH_REQUIRED

logger = get_logger(__name__)

router = APIRouter(prefix="/config", tags=["config"], dependencies=AUTH_REQUIRED)
_METHODS_TAXONOMY = None
_MODEL_PRICING = None
_CONSTITUTIONAL_CONSTRAINTS = None


def _load_json(filename: str) -> dict:
    """Load a JSON config file from the config directory."""
    config_dir = Path(__file__).resolve().parents[4] / "config"
    filepath = config_dir / filename
    if filepath.exists():
        with open(filepath) as f:
            return json.load(f)
    return {}


def _load_text(filename: str) -> str:
    """Load a text config file from the config directory."""
    config_dir = Path(__file__).resolve().parents[4] / "config"
    filepath = config_dir / filename
    if filepath.exists():
        return filepath.read_text()
    return ""


@router.get("/methods-taxonomy")
async def get_methods_taxonomy():
    """
    Get the methods taxonomy for lab profile editor and method filtering.

    Returns a hierarchical list of research method categories and methods.
    Cached in memory after first load.
    """
    global _METHODS_TAXONOMY
    if _METHODS_TAXONOMY is None:
        _METHODS_TAXONOMY = _load_json("methods_taxonomy.json")
    return JSONResponse(
        content=_METHODS_TAXONOMY,
        headers={"Cache-Control": "public, max-age=86400"},
    )


@router.get("/model-pricing")
async def get_model_pricing():
    """
    Get the model pricing table for cost estimation.

    Returns per-model input/output token costs.
    """
    global _MODEL_PRICING
    if _MODEL_PRICING is None:
        _MODEL_PRICING = _load_json("model_pricing.json")
    return JSONResponse(content=_MODEL_PRICING)


@router.get("/constitutional-constraints")
async def get_constitutional_constraints():
    """
    Get the constitutional constraints prepended to all pipeline prompts.
    """
    global _CONSTITUTIONAL_CONSTRAINTS
    if _CONSTITUTIONAL_CONSTRAINTS is None:
        _CONSTITUTIONAL_CONSTRAINTS = _load_text("constitutional_constraints.txt")
    return {"constraints": _CONSTITUTIONAL_CONSTRAINTS}
