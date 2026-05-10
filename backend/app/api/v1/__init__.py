"""
Humanovo API v1 Router

Aggregates all v1 API endpoints.
"""

from fastapi import APIRouter

from app.api.v1.endpoints import (
    activities,
    admin,
    agent_chat_stream,
    agents,
    ai_health,
    auth,
    billing,
    biobank,
    citation_verify,
    citations,
    clinical_trials,
    collaboration,
    compute,
    compute_engine,
    config_endpoints,
    data_sources,
    datasets,
    discovery,
    discovery_sessions,
    document_pipeline,
    evidence,
    evoe,
    experiments,
    genomics,
    hypotheses,
    hypothesis_trace,
    imaging,
    ingestion,
    ingestion_ws,
    kg_permissions,
    knowledge,
    knowledge_graph,
    knowledge_graph_entities,
    manuscripts,
    ml_models,
    monitoring,
    notebook,
    orchestrator,
    paper_qa,
    pipeline_intelligence,
    platform_api,
    project_documents,
    project_kg,
    projects,
    rag,
    regulatory,
    saved_papers,
    simulation,
    statistics,
    user_budget,
    user_state,
    websocket,
    ws_streaming,
)

router = APIRouter()

# Include endpoint routers
router.include_router(auth.router, prefix="/auth", tags=["auth"])
router.include_router(projects.router, prefix="/projects", tags=["projects"])
router.include_router(hypotheses.router, prefix="/hypotheses", tags=["hypotheses"])
# Hypothesis trace + Merkle-anchored audit log replay (the /provenance
# product surface). The router carries its own /hypotheses prefix so it
# attaches as /api/v1/hypotheses/{id}/{trace,audit-log} alongside the
# core CRUD routes from hypotheses.router above.
router.include_router(hypothesis_trace.router)
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

# Discovery Sessions (conversational Discovery persistence)
router.include_router(discovery_sessions.router)

# Conversational Discovery SSE streaming
router.include_router(agent_chat_stream.router)

# Simulation endpoints — frontend uses /simulations (plural).
router.include_router(simulation.router, prefix="/simulations", tags=["simulation"])

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
router.include_router(experiments.router, prefix="/experiments", tags=["experiments"])
router.include_router(collaboration.router, prefix="/collaboration", tags=["collaboration"])
router.include_router(knowledge_graph.router, prefix="/knowledge-graph", tags=["knowledge-graph"])
# Entity-centric API surface (what frontend/src/services/knowledge.ts calls).
# Mounted at the same /knowledge-graph prefix so URLs stay consistent.
router.include_router(
    knowledge_graph_entities.router, prefix="/knowledge-graph", tags=["knowledge-graph"],
)
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

# Unified discovery, synthesis, imaging, billing, pgvector endpoints
router.include_router(platform_api.router)

# WebSocket streaming for discovery/synthesis runs
router.include_router(ws_streaming.router)

# Computational Lab (Python/R/Julia code execution)
router.include_router(compute.router)

# Unified Compute Engine (all biomedical numeric computation domains)
router.include_router(compute_engine.router)

# User State (localStorage sync across devices)
router.include_router(user_state.router, prefix="/user-state", tags=["user-state"])
router.include_router(user_budget.router)
router.include_router(kg_permissions.router)
router.include_router(project_kg.router)
router.include_router(evoe.router)
router.include_router(paper_qa.router)
router.include_router(paper_qa.cost_router)

# Admin (non-prod): kg-stats, seed-kg. Disabled in production via guard.
router.include_router(admin.router, prefix="/admin", tags=["admin"])

# AI provider health probes — admin-only, /admin/ai/health.
# Probes each Bedrock model + Azure deployment with a 1-token call
# and reports per-model latency_ms / reachable / error. Cached 30 s.
router.include_router(ai_health.router, tags=["admin", "ai"])

# Citation verification — CrossRef + NCBI round-trip for single citations.
router.include_router(citation_verify.router, prefix="/citation", tags=["citation"])

# Citation Library — full Mendeley-equivalent reference manager.
router.include_router(citations.router)

# Stripe billing — Checkout + Customer Portal + webhook receiver.
# Webhook endpoint is intentionally NOT under AUTH_REQUIRED; signature
# verification on the Stripe-Signature header is the auth.
router.include_router(billing.router)

# Saved research papers (replaces frontend localStorage 'research-papers' key).
router.include_router(saved_papers.router)

# Project documents (replaces frontend localStorage 'project-documents'
# key + IndexedDB blob shards). Multipart upload of file + metadata.
router.include_router(project_documents.router)
