"""
Humanovo API v1 Router

Aggregates all v1 API endpoints.
"""

from fastapi import APIRouter

from app.api.v1.endpoints import (
    activities,
    agents,
    auth,
    discovery,
    document_pipeline,
    evidence,
    hypotheses,
    ingestion,
    ingestion_ws,
    knowledge,
    monitoring,
    notebook,
    orchestrator,
    projects,
    rag,
    simulation,
    websocket,
)

router = APIRouter()

# Include endpoint routers
router.include_router(auth.router, prefix="/auth", tags=["auth"])
router.include_router(projects.router, prefix="/projects", tags=["projects"])
router.include_router(hypotheses.router, prefix="/hypotheses", tags=["hypotheses"])
router.include_router(evidence.router, prefix="/evidence", tags=["evidence"])
router.include_router(knowledge.router, prefix="/knowledge", tags=["knowledge"])
router.include_router(agents.router, prefix="/agents", tags=["agents"])
router.include_router(websocket.router, prefix="/ws", tags=["websocket"])

# New RAG and Ingestion endpoints
router.include_router(rag.router, prefix="/rag", tags=["rag"])
router.include_router(ingestion.router, prefix="/ingestion", tags=["ingestion"])
router.include_router(ingestion_ws.router, prefix="/ws/ingestion", tags=["ingestion-websocket"])
router.include_router(monitoring.router, prefix="/monitoring", tags=["monitoring"])

# Disease Discovery endpoint
router.include_router(discovery.router)

# Simulation endpoints
router.include_router(simulation.router, prefix="/simulation", tags=["simulation"])

# Parallel Discovery Orchestrator
router.include_router(orchestrator.router)

# Document Pipeline (PDF research paper generation)
router.include_router(document_pipeline.router)

# Notebook
router.include_router(notebook.router, prefix="/notebook", tags=["notebook"])

# Activities / Timeline
router.include_router(activities.router, prefix="/activities", tags=["activities"])
