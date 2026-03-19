"""
Humanovo API v1 Router

Aggregates all v1 API endpoints.
"""

from fastapi import APIRouter

from app.api.v1.endpoints import (
    activities,
    agents,
    auth,
    biobank,
    clinical_trials,
    collaboration,
    config_endpoints,
    data_sources,
    datasets,
    discovery,
    document_pipeline,
    evidence,
    genomics,
    hypotheses,
    imaging,
    ingestion,
    ingestion_ws,
    jamison_api,
    knowledge,
    knowledge_graph,
    manuscripts,
    ml_models,
    monitoring,
    notebook,
    orchestrator,
    pipeline_intelligence,
    projects,
    rag,
    regulatory,
    simulation,
    statistics,
    websocket,
    ws_streaming,
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

# New feature modules
router.include_router(statistics.router, prefix="/statistics", tags=["statistics"])
router.include_router(datasets.router, prefix="/datasets", tags=["datasets"])
router.include_router(collaboration.router, prefix="/collaboration", tags=["collaboration"])
router.include_router(knowledge_graph.router, prefix="/knowledge-graph", tags=["knowledge-graph"])
router.include_router(clinical_trials.router, prefix="/clinical-trials", tags=["clinical-trials"])
router.include_router(genomics.router, prefix="/genomics", tags=["genomics"])
router.include_router(manuscripts.router, prefix="/manuscripts", tags=["manuscripts"])
router.include_router(regulatory.router, prefix="/regulatory", tags=["regulatory"])
router.include_router(imaging.router, prefix="/imaging", tags=["imaging"])
router.include_router(ml_models.router, prefix="/ml-models", tags=["ml-models"])
router.include_router(biobank.router, prefix="/biobank", tags=["biobank"])

# Pipeline Intelligence (Learning Memory, Cost Tracking, Benchmarks, Optimization)
router.include_router(pipeline_intelligence.router)

# Data Sources (60+ biomedical APIs)
router.include_router(data_sources.router)

# Configuration (methods taxonomy, model pricing, constitutional constraints)
router.include_router(config_endpoints.router)

# Project Jamison — unified discovery, synthesis, imaging, billing, pgvector endpoints
router.include_router(jamison_api.router)

# WebSocket streaming for discovery/synthesis runs (Jamison v2)
router.include_router(ws_streaming.router)
