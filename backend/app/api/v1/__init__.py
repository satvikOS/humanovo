"""
GenUp API v1 Router

Aggregates all v1 API endpoints.
"""

from fastapi import APIRouter

from app.api.v1.endpoints import (
    hypotheses,
    evidence,
    knowledge,
    simulation,
    agents,
    projects,
    websocket,
)

router = APIRouter()

# Include endpoint routers
router.include_router(projects.router, prefix="/projects", tags=["projects"])
router.include_router(hypotheses.router, prefix="/hypotheses", tags=["hypotheses"])
router.include_router(evidence.router, prefix="/evidence", tags=["evidence"])
router.include_router(knowledge.router, prefix="/knowledge", tags=["knowledge"])
router.include_router(simulation.router, prefix="/simulation", tags=["simulation"])
router.include_router(agents.router, prefix="/agents", tags=["agents"])
router.include_router(websocket.router, prefix="/ws", tags=["websocket"])
