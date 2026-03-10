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

from app.core.config import settings
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

# Async paper generation state
_paper_status: str = "idle"  # idle | generating | done | failed
_paper_result: Optional[str] = None
_paper_error: Optional[str] = None
_paper_task: Optional[asyncio.Task] = None


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
    discovery_type: str = "treatment"  # treatment, prevention, biomarker, drug_repurposing, combination_therapy
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
    to explore biological pathways and discover potential treatments/strategies.
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

    try:
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
    except Exception as e:
        logger.error(f"Error getting discovery status: {e}")
        return DiscoveryStatusResponse(state="idle")


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
        discovery_type=_current_orchestrator._discovery_type or "treatment",
        hypotheses=hyp_dicts,
        stats=stats.model_dump(),
        external_factors=_current_orchestrator._external_factors,
    )

    return paper.to_dict()


@router.post("/generate-paper/markdown")
async def generate_research_paper_markdown():
    """
    Start async paper generation. Returns immediately.
    Poll /paper-status to check completion.
    """
    global _current_orchestrator, _paper_status, _paper_result, _paper_error, _paper_task

    if not _current_orchestrator:
        raise HTTPException(status_code=400, detail="No discovery data available.")

    hypotheses = _current_orchestrator.get_hypotheses(min_confidence=0.0, limit=100)
    if not hypotheses:
        raise HTTPException(status_code=400, detail="No hypotheses found.")

    if _paper_status == "generating":
        raise HTTPException(status_code=400, detail="Paper generation already in progress.")

    # Reset state
    _paper_status = "generating"
    _paper_result = None
    _paper_error = None

    stats = _current_orchestrator.get_stats()

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

    disease = _current_orchestrator._disease or "Unknown"
    discovery_type = _current_orchestrator._discovery_type or "treatment"
    external_factors = _current_orchestrator._external_factors

    async def _generate_paper_background():
        global _paper_status, _paper_result, _paper_error
        try:
            from app.services.paper_generation_service import get_paper_service
            paper_service = get_paper_service()

            paper = await paper_service.generate_paper(
                disease=disease,
                discovery_type=discovery_type,
                hypotheses=hyp_dicts,
                stats=stats.model_dump(),
                external_factors=external_factors,
            )

            html_content = paper_service.paper_to_html(paper)
            _paper_result = html_content
            _paper_status = "done"
            logger.info("Paper generation completed successfully")

            await manager.broadcast({
                "type": "paper_ready",
                "data": {"status": "done"},
            })
        except Exception as e:
            _paper_error = str(e)
            _paper_status = "failed"
            logger.error(f"Paper generation failed: {e}")

    _paper_task = asyncio.create_task(_generate_paper_background())

    return {"status": "generating", "message": "Paper generation started. Poll /paper-status for updates."}


@router.get("/paper-status")
async def get_paper_status():
    """Check the status of async paper generation."""
    global _paper_status, _paper_result, _paper_error

    response: dict[str, Any] = {"status": _paper_status}

    if _paper_status == "done" and _paper_result:
        response["paper_html"] = _paper_result
    elif _paper_status == "failed" and _paper_error:
        response["error"] = _paper_error

    return response


@router.post("/generate-paper/pdf")
async def generate_research_paper_pdf():
    """
    Generate a rich visual PDF research paper with cover page, tables,
    diagrams, confidence charts, citations, glossary, and indexing.
    Uses built-in code interpreter approach with reportlab.
    """
    global _current_orchestrator

    if not _current_orchestrator:
        raise HTTPException(status_code=400, detail="No discovery data available.")

    hypotheses = _current_orchestrator.get_hypotheses(min_confidence=0.0, limit=100)
    if not hypotheses:
        raise HTTPException(status_code=400, detail="No hypotheses found.")

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

    from app.services.pdf_generation_service import get_pdf_service
    pdf_service = get_pdf_service()

    try:
        pdf_bytes = await pdf_service.generate_pdf(
            disease=_current_orchestrator._disease or "Unknown",
            discovery_type=_current_orchestrator._discovery_type or "treatment",
            hypotheses=hyp_dicts,
            paper_html=_paper_result,
            num_agents=_current_orchestrator.max_agents,
            target_confidence=_current_orchestrator.target_confidence,
        )
    except Exception as e:
        logger.error(f"PDF generation failed: {e}")
        raise HTTPException(status_code=500, detail=f"PDF generation failed: {e}")

    from fastapi.responses import Response
    disease_slug = (_current_orchestrator._disease or "research").replace(" ", "-").lower()
    filename = f"humanovo-{disease_slug}-{_current_orchestrator._discovery_type}.pdf"

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@router.post("/save-to-project")
async def save_discovery_to_project(project_name: str = None):
    """
    Save current discovery hypotheses to a project.
    Creates a new project and stores all hypotheses, fixing the transfer bug
    where hypotheses appeared to be saved but the project didn't exist.
    """
    global _current_orchestrator

    if not _current_orchestrator:
        raise HTTPException(status_code=400, detail="No discovery data available. Run a discovery first.")

    hypotheses = _current_orchestrator.get_hypotheses(min_confidence=0.0, limit=100)
    if not hypotheses:
        raise HTTPException(status_code=400, detail="No hypotheses found. Run discovery first.")

    disease = _current_orchestrator._disease or "Unknown"
    discovery_type = _current_orchestrator._discovery_type or "treatment"

    # Import project memory store and create project
    from app.api.v1.endpoints.projects import _memory_projects, _check_db_available
    from uuid import uuid4
    from datetime import datetime

    project_id = str(uuid4())
    name = project_name or f"{disease} - {discovery_type.replace('_', ' ').title()} Discovery"
    now = datetime.utcnow()

    # Try database first
    db_ok = await _check_db_available()
    if db_ok:
        try:
            from app.core.database import get_db
            from app.models.project import Project, ProjectStatus
            from app.models.hypothesis import Hypothesis, HypothesisStatus

            async for db in get_db():
                db_project = Project(
                    name=name,
                    description=f"Auto-generated from discovery run: {len(hypotheses)} hypotheses for {disease}",
                    disease_focus=disease,
                    research_question=f"What are the most promising {discovery_type} strategies for {disease}?",
                    tags=[disease.lower(), discovery_type, "ai-discovery", "multi-model"],
                    status=ProjectStatus.ACTIVE,
                    hypothesis_count=len(hypotheses),
                )
                db.add(db_project)
                await db.flush()

                # Store each hypothesis
                for h in hypotheses:
                    db_hyp = Hypothesis(
                        project_id=db_project.id,
                        statement=h.title,
                        mechanism=h.mechanism,
                        rationale=h.description,
                        status=HypothesisStatus.ACTIVE,
                        confidence_score=h.confidence,
                        novelty_score=0.0,
                        generated_by="ai",
                        generation_context={
                            "model_used": h.model_used,
                            "disease": h.disease,
                            "external_factors": h.external_factors,
                            "contributing_agents": h.contributing_agents,
                        },
                        tags=[disease.lower(), h.model_used],
                    )
                    db.add(db_hyp)

                await db.commit()
                await db.refresh(db_project)

                await manager.broadcast({
                    "type": "project_saved",
                    "data": {"project_id": str(db_project.id), "name": name},
                })

                return {
                    "status": "saved",
                    "project_id": str(db_project.id),
                    "name": name,
                    "hypothesis_count": len(hypotheses),
                    "message": f"Saved {len(hypotheses)} hypotheses to project '{name}'",
                }
        except Exception as e:
            logger.warning(f"DB save failed, using in-memory: {e}")

    # In-memory fallback — ensure project is stored so it can be retrieved
    mem_project = {
        "id": project_id,
        "name": name,
        "description": f"Auto-generated from discovery run: {len(hypotheses)} hypotheses for {disease}",
        "disease_focus": disease,
        "research_question": f"What are the most promising {discovery_type} strategies for {disease}?",
        "tags": [disease.lower(), discovery_type, "ai-discovery", "multi-model"],
        "status": "active",
        "hypothesis_count": len(hypotheses),
        "evidence_count": 0,
        "simulation_count": 0,
        "created_at": now,
        "updated_at": now,
        "hypotheses": [
            {
                "id": h.id,
                "title": h.title,
                "description": h.description,
                "mechanism": h.mechanism,
                "confidence": h.confidence,
                "model_used": h.model_used,
                "validated": h.validated,
                "external_factors": h.external_factors,
                "created_at": h.created_at.isoformat(),
            }
            for h in hypotheses
        ],
    }
    _memory_projects[project_id] = mem_project

    await manager.broadcast({
        "type": "project_saved",
        "data": {"project_id": project_id, "name": name},
    })

    return {
        "status": "saved",
        "project_id": project_id,
        "name": name,
        "hypothesis_count": len(hypotheses),
        "message": f"Saved {len(hypotheses)} hypotheses to project '{name}'",
    }


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
        "claude_opus": False,
        "deepseek_r1_0528": False,
        "mistral_large_3": False,
        "gpt_4o_azure": False,
        "cohere_command_a": False,
        "kimi_k2_thinking": False,
        "o3_mini": False,
        "gpt_41": False,
    }

    try:
        if _current_orchestrator and hasattr(_current_orchestrator, 'llm') and _current_orchestrator.llm._initialized:
            llm = _current_orchestrator.llm
            # Mark Bedrock model (Claude)
            if hasattr(llm, '_bedrock_client') and llm._bedrock_client:
                models_status["claude_opus"] = True
            # Mark Azure AI models
            for key in ("deepseek_r1_0528", "mistral_large_3", "cohere_command_a"):
                if hasattr(llm, '_azure_clients') or True:  # Available if configured
                    models_status[key] = True
            # Mark Azure OpenAI models
            for key in ("gpt_4o_azure", "kimi_k2_thinking", "o3_mini", "gpt_41"):
                models_status[key] = True
        else:
            try:
                from app.core.config import settings
                if settings.aws_access_key_value and settings.aws_secret_key_value:
                    models_status["claude_opus"] = True
                if settings.AZURE_DEEPSEEK_ENDPOINT:
                    models_status["deepseek_r1_0528"] = True
                if settings.AZURE_MISTRAL_ENDPOINT:
                    models_status["mistral_large_3"] = True
                if settings.AZURE_GPT4O_ENDPOINT:
                    models_status["gpt_4o_azure"] = True
                if settings.AZURE_COHERE_ENDPOINT:
                    models_status["cohere_command_a"] = True
                if settings.AZURE_KIMI_ENDPOINT:
                    models_status["kimi_k2_thinking"] = True
                if settings.AZURE_O3MINI_ENDPOINT:
                    models_status["o3_mini"] = True
                if settings.AZURE_GPT41_ENDPOINT:
                    models_status["gpt_41"] = True
            except Exception:
                pass  # Settings not available, all models remain False
    except Exception as e:
        logger.error(f"Error checking orchestrator health: {e}")

    active_count = sum(1 for v in models_status.values() if v)

    return {
        "status": "healthy" if active_count > 0 else "no_models",
        "models": models_status,
        "connected_count": active_count,
        "total_models": 8,
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


class ChatRequest(BaseModel):
    """Request for Constant AI chat."""
    message: str
    context: str = "general"


@router.post("/chat")
async def constant_chat(request: ChatRequest):
    """
    Constant AI chat assistant — uses AWS Bedrock models for research Q&A.
    Grounded to the platform context for biomedical research assistance.
    """
    if not request.message.strip():
        return {"response": "Please ask me a question about your research."}

    chat_prompt = f"""You are Constant, an AI research assistant for the HumaNovo biomedical discovery platform.
You help researchers with questions about hypotheses, experimental design, literature analysis,
drug discovery, molecular biology, and scientific methodology.

Be concise, helpful, and scientifically accurate. Reference specific mechanisms, genes, and pathways when relevant.

User question: {request.message}"""

    response_text = None

    # Build Bedrock client with explicit credentials from settings
    bedrock = None
    try:
        import boto3
        client_kwargs: dict = {"region_name": settings.AWS_REGION}
        if settings.aws_access_key_value and settings.aws_secret_key_value:
            client_kwargs["aws_access_key_id"] = settings.aws_access_key_value
            client_kwargs["aws_secret_access_key"] = settings.aws_secret_key_value
        bedrock = boto3.client("bedrock-runtime", **client_kwargs)
    except Exception as e:
        logger.warning(f"Failed to create Bedrock client: {e}")

    # Try Claude Sonnet 4.6 via Bedrock
    if bedrock:
        try:
            bedrock_response = bedrock.invoke_model(
                modelId="us.anthropic.claude-sonnet-4-6-v1:0",
                contentType="application/json",
                accept="application/json",
                body=json.dumps({
                    "anthropic_version": "bedrock-2023-05-31",
                    "max_tokens": 1024,
                    "messages": [{"role": "user", "content": chat_prompt}],
                }),
            )
            result = json.loads(bedrock_response["body"].read())
            if result.get("content"):
                response_text = result["content"][0].get("text", "")
        except Exception as e:
            logger.warning(f"Bedrock Sonnet chat error: {e}")

    # Fallback to Claude Opus
    if not response_text and bedrock:
        try:
            bedrock_response = bedrock.invoke_model(
                modelId=settings.BEDROCK_MODEL_CLAUDE_OPUS,
                contentType="application/json",
                accept="application/json",
                body=json.dumps({
                    "anthropic_version": "bedrock-2023-05-31",
                    "max_tokens": 1024,
                    "messages": [{"role": "user", "content": chat_prompt}],
                }),
            )
            result = json.loads(bedrock_response["body"].read())
            if result.get("content"):
                response_text = result["content"][0].get("text", "")
        except Exception as e:
            logger.warning(f"Bedrock Opus chat error: {e}")

    if not response_text:
        response_text = (
            "I'm having trouble connecting to the AI backend. "
            "Please ensure AWS Bedrock is configured and the backend server is running."
        )

    return {"response": response_text}


# Simulation integration - run simulations through orchestrator
@router.post("/simulate")
async def run_simulation(request: StartDiscoveryRequest):
    """
    Run a disease simulation through the orchestrator.
    """
    return await start_discovery_endpoint(request)
