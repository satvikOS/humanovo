"""
Discovery Orchestrator API Endpoints

WebSocket-enabled API for controlling the parallel discovery system
with start/pause/stop controls, real-time updates, external factor
simulation, and research paper generation.
"""

import asyncio
import json
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel

from app.core.logging import get_logger
from app.agents.discovery_orchestrator import (
    DiscoveryOrchestrator,
    DiscoveryOrchestratorStats,
    OrchestratorState,
    get_orchestrator,
    start_discovery,
)

logger = get_logger(__name__)

router = APIRouter(prefix="/orchestrator", tags=["orchestrator"])


# WebSocket connection manager for real-time updates
class ConnectionManager:
    """Manages WebSocket connections for real-time updates."""

    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        """Broadcast message to all connected clients."""
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception:
                pass  # Connection might be closed


manager = ConnectionManager()

# Global orchestrator reference
_current_orchestrator: Optional[DiscoveryOrchestrator] = None


class ExternalFactor(BaseModel):
    """An external factor (nutrient, chemical, drug, compound, element)."""
    name: str
    category: str  # nutrient, chemical, drug, compound, element
    interaction: str = ""  # description of known interaction


class StartDiscoveryRequest(BaseModel):
    """Request to start discovery."""
    disease: str
    focus_entities: list[str] = []
    discovery_type: str = "cure"  # cure, prevention, treatment, biomarker, drug_repurposing
    max_agents: int = 1000
    target_confidence: float = 0.95
    external_factors: list[ExternalFactor] = []


class DiscoveryStatusResponse(BaseModel):
    """Response with discovery status."""
    state: str
    disease: Optional[str] = None
    stats: Optional[DiscoveryOrchestratorStats] = None
    top_hypotheses: list[dict] = []


@router.post("/start")
async def start_discovery_endpoint(request: StartDiscoveryRequest):
    """
    Start a new parallel discovery process.

    Launches agents across Llama Maverick, DeepSeek R1, Kimi 2.5, and GPT OSS 120B
    to explore biological pathways and discover potential cures/treatments.
    External factors (nutrients, chemicals, drugs, compounds, elements) are simulated
    alongside biological interactions.
    """
    global _current_orchestrator

    # Check if already running
    if _current_orchestrator and _current_orchestrator.state == OrchestratorState.RUNNING:
        raise HTTPException(
            status_code=400,
            detail="Discovery already running. Stop it first or wait for completion."
        )

    try:
        # Create new orchestrator
        _current_orchestrator = DiscoveryOrchestrator(
            max_agents=request.max_agents,
            target_confidence=request.target_confidence,
        )
        await _current_orchestrator.initialize()

        # Set up callbacks for WebSocket updates
        async def on_hypothesis(hypothesis):
            await manager.broadcast({
                "type": "hypothesis",
                "data": {
                    "id": hypothesis.id,
                    "title": hypothesis.title,
                    "description": hypothesis.description,
                    "confidence": hypothesis.confidence,
                    "mechanism": hypothesis.mechanism,
                    "model_used": hypothesis.model_used,
                    "external_factors": hypothesis.external_factors,
                    "validated": hypothesis.validated,
                }
            })

        async def on_stats_update(stats: DiscoveryOrchestratorStats):
            await manager.broadcast({
                "type": "stats",
                "data": stats.model_dump(),
            })

        _current_orchestrator.set_callbacks(
            on_hypothesis=on_hypothesis,
            on_stats_update=on_stats_update,
        )

        # Convert external factors to dicts
        ext_factors = [f.model_dump() for f in request.external_factors] if request.external_factors else None

        # Start discovery in background
        asyncio.create_task(
            _current_orchestrator.start(
                disease=request.disease,
                focus_entities=request.focus_entities if request.focus_entities else None,
                discovery_type=request.discovery_type,
                external_factors=ext_factors,
            )
        )

        return {
            "status": "started",
            "disease": request.disease,
            "max_agents": request.max_agents,
            "target_confidence": request.target_confidence,
            "models": ["llama_maverick", "deepseek_r1", "kimi_25", "gpt_oss_120b"],
            "external_factors_count": len(request.external_factors),
            "message": (
                f"Discovery started for {request.disease} with {request.max_agents} agents "
                f"across 4 models, {len(request.external_factors)} external factors"
            ),
        }

    except Exception as e:
        logger.error(f"Failed to start discovery: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/pause")
async def pause_discovery():
    """Pause the current discovery process."""
    global _current_orchestrator

    if not _current_orchestrator:
        raise HTTPException(status_code=400, detail="No discovery running")

    if _current_orchestrator.state != OrchestratorState.RUNNING:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot pause: current state is {_current_orchestrator.state.value}"
        )

    _current_orchestrator.pause()

    await manager.broadcast({
        "type": "state_change",
        "data": {"state": "paused"},
    })

    return {"status": "paused", "message": "Discovery paused"}


@router.post("/resume")
async def resume_discovery():
    """Resume a paused discovery process."""
    global _current_orchestrator

    if not _current_orchestrator:
        raise HTTPException(status_code=400, detail="No discovery running")

    if _current_orchestrator.state != OrchestratorState.PAUSED:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot resume: current state is {_current_orchestrator.state.value}"
        )

    _current_orchestrator.resume()

    await manager.broadcast({
        "type": "state_change",
        "data": {"state": "running"},
    })

    return {"status": "running", "message": "Discovery resumed"}


@router.post("/stop")
async def stop_discovery():
    """Stop the current discovery process."""
    global _current_orchestrator

    if not _current_orchestrator:
        raise HTTPException(status_code=400, detail="No discovery running")

    if _current_orchestrator.state == OrchestratorState.IDLE:
        raise HTTPException(status_code=400, detail="Discovery not running")

    _current_orchestrator.stop()

    await manager.broadcast({
        "type": "state_change",
        "data": {"state": "stopping"},
    })

    return {"status": "stopping", "message": "Discovery stopping"}


@router.get("/status", response_model=DiscoveryStatusResponse)
async def get_discovery_status():
    """Get the current status of the discovery process."""
    global _current_orchestrator

    if not _current_orchestrator:
        return DiscoveryStatusResponse(state="idle")

    stats = _current_orchestrator.get_stats()
    hypotheses = _current_orchestrator.get_hypotheses(min_confidence=0.5, limit=10)

    return DiscoveryStatusResponse(
        state=_current_orchestrator.state.value,
        disease=_current_orchestrator._disease,
        stats=stats,
        top_hypotheses=[
            {
                "id": h.id,
                "title": h.title,
                "description": h.description,
                "mechanism": h.mechanism,
                "confidence": h.confidence,
                "model_used": h.model_used,
                "validated": h.validated,
                "external_factors": h.external_factors,
            }
            for h in hypotheses
        ],
    )


@router.get("/hypotheses")
async def get_hypotheses(
    min_confidence: float = 0.0,
    limit: int = 100,
):
    """Get discovered hypotheses."""
    global _current_orchestrator

    if not _current_orchestrator:
        return {"hypotheses": [], "total": 0}

    hypotheses = _current_orchestrator.get_hypotheses(
        min_confidence=min_confidence,
        limit=limit,
    )

    return {
        "hypotheses": [
            {
                "id": h.id,
                "disease": h.disease,
                "hypothesis_type": h.hypothesis_type,
                "title": h.title,
                "description": h.description,
                "mechanism": h.mechanism,
                "confidence": h.confidence,
                "contributing_agents": h.contributing_agents,
                "model_used": h.model_used,
                "external_factors": h.external_factors,
                "created_at": h.created_at.isoformat(),
                "validated": h.validated,
            }
            for h in hypotheses
        ],
        "total": len(hypotheses),
    }


@router.post("/generate-paper")
async def generate_research_paper():
    """
    Generate a fully formatted research paper from the current discovery results.

    The paper includes:
    - Title, Abstract, Introduction, Methods, Results, Discussion, Conclusion
    - Tables: hypothesis rankings, model performance, external factors
    - Figures: pipeline flowchart, confidence distribution, mechanism diagrams (Mermaid)
    - References and citations
    - External factors analysis

    Call this after discovery reaches target confidence or after manual stop.
    """
    global _current_orchestrator

    if not _current_orchestrator:
        raise HTTPException(status_code=400, detail="No discovery data available. Run a discovery first.")

    hypotheses = _current_orchestrator.get_hypotheses(min_confidence=0.0, limit=100)
    if not hypotheses:
        raise HTTPException(status_code=400, detail="No hypotheses found. Run discovery first.")

    stats = _current_orchestrator.get_stats()

    from app.services.paper_generation_service import get_paper_service
    paper_service = get_paper_service()

    hyp_dicts = [
        {
            "id": h.id,
            "title": h.title,
            "description": h.description,
            "mechanism": h.mechanism,
            "confidence": h.confidence,
            "model_used": h.model_used,
            "validated": h.validated,
            "external_factors": h.external_factors,
        }
        for h in hypotheses
    ]

    paper = await paper_service.generate_paper(
        disease=_current_orchestrator._disease or "Unknown",
        discovery_type="cure",
        hypotheses=hyp_dicts,
        stats=stats.model_dump(),
        external_factors=_current_orchestrator._external_factors,
    )

    return paper.to_dict()


@router.post("/generate-paper/markdown")
async def generate_research_paper_markdown():
    """
    Generate a research paper in Markdown format for direct viewing/export.
    """
    global _current_orchestrator

    if not _current_orchestrator:
        raise HTTPException(status_code=400, detail="No discovery data available.")

    hypotheses = _current_orchestrator.get_hypotheses(min_confidence=0.0, limit=100)
    if not hypotheses:
        raise HTTPException(status_code=400, detail="No hypotheses found.")

    stats = _current_orchestrator.get_stats()

    from app.services.paper_generation_service import get_paper_service
    paper_service = get_paper_service()

    hyp_dicts = [
        {
            "id": h.id,
            "title": h.title,
            "description": h.description,
            "mechanism": h.mechanism,
            "confidence": h.confidence,
            "model_used": h.model_used,
            "validated": h.validated,
            "external_factors": h.external_factors,
        }
        for h in hypotheses
    ]

    paper = await paper_service.generate_paper(
        disease=_current_orchestrator._disease or "Unknown",
        discovery_type="cure",
        hypotheses=hyp_dicts,
        stats=stats.model_dump(),
        external_factors=_current_orchestrator._external_factors,
    )

    markdown = paper_service.paper_to_markdown(paper)
    return PlainTextResponse(content=markdown, media_type="text/markdown")


@router.get("/learning-stats")
async def get_learning_stats():
    """Get learning memory statistics."""
    global _current_orchestrator

    if not _current_orchestrator:
        return {"error": "No orchestrator initialized"}

    return _current_orchestrator.memory.get_stats()


@router.get("/token-pool-stats")
async def get_token_pool_stats():
    """Get token pool statistics across all models."""
    global _current_orchestrator

    if not _current_orchestrator:
        return {"error": "No orchestrator initialized"}

    return _current_orchestrator.token_pool.get_stats()


@router.get("/health")
async def orchestrator_health():
    """
    Health check for the AI pipeline.
    Reports which models are available and ready.
    """
    global _current_orchestrator

    models_status = {
        "llama_maverick": False,
        "deepseek_r1": False,
        "kimi_25": False,
        "gpt_oss_120b": False,
    }

    if _current_orchestrator and _current_orchestrator.llm._initialized:
        llm = _current_orchestrator.llm
        if llm._bedrock_client:
            models_status["llama_maverick"] = True
            models_status["deepseek_r1"] = True
        if llm._kimi_client:
            models_status["kimi_25"] = True
        if llm._gpt_oss_client:
            models_status["gpt_oss_120b"] = True
    else:
        # Check config for available credentials
        from app.core.config import settings
        if settings.aws_access_key_value and settings.aws_secret_key_value:
            models_status["llama_maverick"] = True
            models_status["deepseek_r1"] = True
        if settings.kimi_api_key_value:
            models_status["kimi_25"] = True
        if settings.gpt_oss_api_key_value or settings.together_api_key_value:
            models_status["gpt_oss_120b"] = True

    active_count = sum(1 for v in models_status.values() if v)

    return {
        "status": "healthy" if active_count > 0 else "no_models",
        "models": models_status,
        "active_model_count": active_count,
        "orchestrator_initialized": _current_orchestrator is not None,
    }


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """
    WebSocket endpoint for real-time discovery updates.

    Clients receive:
    - hypothesis: New hypothesis discovered
    - stats: Updated statistics
    - state_change: State changed (running/paused/stopped)
    - paper_ready: Research paper generation complete
    """
    await manager.connect(websocket)

    try:
        # Send initial state
        if _current_orchestrator:
            stats = _current_orchestrator.get_stats()
            await websocket.send_json({
                "type": "initial_state",
                "data": {
                    "state": _current_orchestrator.state.value,
                    "stats": stats.model_dump(),
                }
            })
        else:
            await websocket.send_json({
                "type": "initial_state",
                "data": {"state": "idle"},
            })

        # Keep connection alive and handle incoming messages
        while True:
            try:
                data = await asyncio.wait_for(
                    websocket.receive_text(),
                    timeout=30.0,
                )

                message = json.loads(data)

                if message.get("type") == "ping":
                    await websocket.send_json({"type": "pong"})

                elif message.get("type") == "get_stats":
                    if _current_orchestrator:
                        stats = _current_orchestrator.get_stats()
                        await websocket.send_json({
                            "type": "stats",
                            "data": stats.model_dump(),
                        })

            except asyncio.TimeoutError:
                await websocket.send_json({"type": "ping"})

    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        manager.disconnect(websocket)


# Simulation integration - run simulations through orchestrator
@router.post("/simulate")
async def run_simulation(request: StartDiscoveryRequest):
    """
    Run a disease simulation through the orchestrator.
    """
    return await start_discovery_endpoint(request)
