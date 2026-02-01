"""
GenUp API v1 Router

Aggregates all v1 API endpoints.
"""

from fastapi import APIRouter

from app.api.v1.endpoints import (
    agents,
    evidence,
    hypotheses,
    ingestion,
    ingestion_ws,
    knowledge,
    monitoring,
    projects,
    rag,
    simulation,
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

# New RAG and Ingestion endpoints
router.include_router(rag.router, prefix="/rag", tags=["rag"])
router.include_router(ingestion.router, prefix="/ingestion", tags=["ingestion"])
router.include_router(ingestion_ws.router, prefix="/ws/ingestion", tags=["ingestion-websocket"])
router.include_router(monitoring.router, prefix="/monitoring", tags=["monitoring"])
