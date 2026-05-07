"""
Discovery Orchestrator API Endpoints

WebSocket-enabled API for controlling the parallel discovery system
with start/pause/stop controls, real-time updates, external factor
simulation, and research paper generation.
"""

import asyncio
import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.discovery_orchestrator import (
    DiscoveryOrchestrator,
    DiscoveryOrchestratorStats,
    OrchestratorState,
)
from app.core.auth import AUTH_REQUIRED, authenticate_websocket
from app.core.config import settings
from app.core.database import get_db
from app.core.logging import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/orchestrator", tags=["orchestrator"], dependencies=AUTH_REQUIRED)
# Async paper generation state
_paper_status: str = "idle"  # idle | generating | done | failed
_paper_result: str | None = None
_paper_error: str | None = None
_paper_task: asyncio.Task | None = None


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
            except (WebSocketDisconnect, ConnectionError, RuntimeError) as e:
                logger.debug(
                    "orchestrator.broadcast_send_failed",
                    extra={"event": "broadcast_send_failed", "error": str(e)},
                )


manager = ConnectionManager()

# Global orchestrator reference
_current_orchestrator: DiscoveryOrchestrator | None = None


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
    disease: str | None = None
    discovery_type: str | None = None
    project_id: str | None = None
    project_name: str | None = None
    stats: DiscoveryOrchestratorStats | None = None
    top_hypotheses: list[dict] = []


# Track auto-created project per discovery run
_auto_project_id: str | None = None
_auto_project_name: str | None = None


@router.post("/start")
async def start_discovery_endpoint(request: StartDiscoveryRequest):
    """
    Start a new parallel discovery process.

    Launches agents across multiple AI models
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
        global _auto_project_id, _auto_project_name

        # Auto-create a project in the database for this discovery run
        try:
            from app.core.database import async_session_factory
            from app.models.project import Project, ProjectStatus

            discovery_type = request.discovery_type or "treatment"
            project_name = f"{request.disease} - {discovery_type.replace('_', ' ').title()} Discovery"

            async with async_session_factory() as db:
                db_project = Project(
                    name=project_name,
                    description=f"Auto-generated discovery project for {request.disease}",
                    disease_focus=request.disease,
                    research_question=f"What are the most promising {discovery_type} strategies for {request.disease}?",
                    tags=[request.disease.lower(), discovery_type, "ai-discovery"],
                    status=ProjectStatus.ACTIVE,
                    hypothesis_count=0,
                )
                db.add(db_project)
                await db.commit()
                await db.refresh(db_project)
                _auto_project_id = str(db_project.id)
                _auto_project_name = project_name
                logger.info("Auto-created project for discovery", project_id=_auto_project_id, name=project_name)
        except Exception as e:
            logger.warning("Failed to auto-create project — hypotheses will be in-memory only", error=str(e))
            _auto_project_id = None
            _auto_project_name = None

        # Create new orchestrator
        _current_orchestrator = DiscoveryOrchestrator(
            max_agents=request.max_agents,
            target_confidence=request.target_confidence,
        )
        await _current_orchestrator.initialize()

        # Set up callbacks for WebSocket updates + auto-save each hypothesis
        async def on_hypothesis(hypothesis):
            # Auto-save hypothesis to database
            if _auto_project_id:
                try:
                    from uuid import UUID as _UUID

                    from app.core.database import async_session_factory
                    from app.models.hypothesis import Hypothesis as HypModel
                    from app.models.hypothesis import HypothesisStatus as HypStatus

                    async with async_session_factory() as db:
                        db_hyp = HypModel(
                            project_id=_UUID(_auto_project_id),
                            statement=hypothesis.title,
                            mechanism=hypothesis.mechanism,
                            rationale=hypothesis.description,
                            status=HypStatus.ACTIVE,
                            confidence_score=hypothesis.confidence,
                            novelty_score=getattr(hypothesis, "novelty_score", 0.0),
                            generated_by="ai",
                            generation_context={
                                "model_used": hypothesis.model_used,
                                "disease": getattr(hypothesis, "disease", ""),
                                "external_factors": hypothesis.external_factors,
                                "contributing_agents": getattr(hypothesis, "contributing_agents", []),
                            },
                            tags=[getattr(hypothesis, "disease", "").lower(), hypothesis.model_used],
                            translational_roadmap=getattr(hypothesis, "translational_roadmap", None),
                        )
                        db.add(db_hyp)
                        # Update project hypothesis count
                        from sqlalchemy import func as sa_func
                        from sqlalchemy import select as sa_select

                        from app.models.project import Project
                        count_result = await db.execute(
                            sa_select(sa_func.count()).select_from(HypModel).where(
                                HypModel.project_id == _UUID(_auto_project_id)
                            )
                        )
                        new_count = (count_result.scalar() or 0) + 1
                        project = await db.get(Project, _UUID(_auto_project_id))
                        if project:
                            project.hypothesis_count = new_count
                        await db.commit()
                        logger.info("Auto-saved hypothesis to project", project_id=_auto_project_id)
                except Exception as e:
                    logger.warning("Failed to auto-save hypothesis", error=str(e))

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
                    "evidence_summary": getattr(hypothesis, "evidence_summary", []),
                    "risks": getattr(hypothesis, "risks", []),
                    "validation_steps": getattr(hypothesis, "validation_steps", []),
                    "novelty_score": getattr(hypothesis, "novelty_score", 0.0),
                    "citations": getattr(hypothesis, "citations", []),
                    "fda_references": getattr(hypothesis, "fda_references", []),
                    "clinical_trial_references": getattr(hypothesis, "clinical_trial_references", []),
                    "tags": getattr(hypothesis, "tags", []),
                    "translational_roadmap": getattr(hypothesis, "translational_roadmap", {}),
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
            "models": ["llama_maverick", "gpt_oss_120b"],
            "external_factors_count": len(request.external_factors),
            "project_id": _auto_project_id,
            "project_name": _auto_project_name,
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
            discovery_type=getattr(_current_orchestrator, "_discovery_type", None),
            project_id=_auto_project_id,
            project_name=_auto_project_name,
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
                    "evidence_summary": getattr(h, "evidence_summary", []),
                    "risks": getattr(h, "risks", []),
                    "validation_steps": getattr(h, "validation_steps", []),
                    "novelty_score": getattr(h, "novelty_score", 0.0),
                    "citations": getattr(h, "citations", []),
                    "fda_references": getattr(h, "fda_references", []),
                    "clinical_trial_references": getattr(h, "clinical_trial_references", []),
                    "tags": getattr(h, "tags", []),
                    "translational_roadmap": getattr(h, "translational_roadmap", {}),
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
                "evidence_summary": getattr(h, "evidence_summary", []),
                "risks": getattr(h, "risks", []),
                "validation_steps": getattr(h, "validation_steps", []),
                "novelty_score": getattr(h, "novelty_score", 0.0),
                "citations": getattr(h, "citations", []),
                "fda_references": getattr(h, "fda_references", []),
                "clinical_trial_references": getattr(h, "clinical_trial_references", []),
                "tags": getattr(h, "tags", []),
                "translational_roadmap": getattr(h, "translational_roadmap", {}),
            }
            for h in hypotheses
        ],
        "total": len(hypotheses),
    }


# Frontend (api.ts) hits /paper/generate — keep both shapes alive.
@router.post("/paper/generate")
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
            "evidence_summary": getattr(h, "evidence_summary", []),
            "risks": getattr(h, "risks", []),
            "validation_steps": getattr(h, "validation_steps", []),
            "translational_roadmap": getattr(h, "translational_roadmap", {}),
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
            "evidence_summary": getattr(h, "evidence_summary", []),
            "risks": getattr(h, "risks", []),
            "validation_steps": getattr(h, "validation_steps", []),
            "translational_roadmap": getattr(h, "translational_roadmap", {}),
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


# Frontend (api.ts) hits /paper/status — keep both shapes alive.
@router.get("/paper/status")
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


@router.post("/cancel-paper")
async def cancel_paper_generation():
    """Cancel the in-flight async paper generation task, if any.

    The frontend calls this when the user navigates away or hits Cancel
    during a long-running paper render. Safe to call even when no task
    is running (idempotent no-op).
    """
    global _paper_task, _paper_status, _paper_error

    task = _paper_task
    if task is not None and not task.done():
        task.cancel()
        _paper_status = "idle"
        _paper_error = None
        return {"status": "cancelled"}
    return {"status": "idle"}


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
            "evidence_summary": getattr(h, "evidence_summary", []),
            "risks": getattr(h, "risks", []),
            "validation_steps": getattr(h, "validation_steps", []),
            "translational_roadmap": getattr(h, "translational_roadmap", {}),
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


    name = project_name or f"{disease} - {discovery_type.replace('_', ' ').title()} Discovery"

    # Save to database
    from app.core.database import get_db
    from app.models.hypothesis import Hypothesis, HypothesisStatus
    from app.models.project import Project, ProjectStatus

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
        "mistral_large_3": False,
        "gpt_4o_azure": False,
        "cohere_command_a": False,
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
            for key in ("mistral_large_3", "cohere_command_a"):
                if hasattr(llm, '_azure_clients') or True:  # Available if configured
                    models_status[key] = True
            # Mark Azure OpenAI models
            for key in ("gpt_4o_azure", "o3_mini", "gpt_41"):
                models_status[key] = True
        else:
            try:
                from app.core.config import settings
                if settings.aws_access_key_value and settings.aws_secret_key_value:
                    models_status["claude_opus"] = True
                if settings.AZURE_MISTRAL_ENDPOINT:
                    models_status["mistral_large_3"] = True
                if settings.AZURE_GPT4O_ENDPOINT:
                    models_status["gpt_4o_azure"] = True
                if settings.AZURE_COHERE_ENDPOINT:
                    models_status["cohere_command_a"] = True
                if settings.AZURE_O3MINI_ENDPOINT:
                    models_status["o3_mini"] = True
                if settings.AZURE_GPT41_ENDPOINT:
                    models_status["gpt_41"] = True
            except (ImportError, AttributeError) as e:
                logger.debug(
                    "orchestrator.settings_unavailable",
                    extra={"event": "settings_unavailable", "error": str(e)},
                )
    except Exception as e:
        logger.error(f"Error checking orchestrator health: {e}")

    active_count = sum(1 for v in models_status.values() if v)

    return {
        "status": "healthy" if active_count > 0 else "no_models",
        "models": models_status,
        "connected_count": active_count,
        "total_models": 6,
        "orchestrator_initialized": _current_orchestrator is not None,
    }


@router.websocket("/ws")
async def websocket_endpoint(
    websocket: WebSocket,
    db: AsyncSession = Depends(get_db),
):
    """
    WebSocket endpoint for real-time discovery updates.

    Clients receive:
    - hypothesis: New hypothesis discovered
    - stats: Updated statistics
    - state_change: State changed (running/paused/stopped)
    - paper_ready: Research paper generation complete
    """
    user = await authenticate_websocket(websocket, db)
    if user is None:
        return
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

            except TimeoutError:
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
    platform_context: dict = {}


CONSTANT_SYSTEM_PROMPT = """You are Constant, an AI research tutor and assistant built into the HumaNovo biomedical discovery platform. You serve as both a knowledgeable research companion and an educational tutor who helps users learn and grow as researchers.

HumaNovo is a platform for biomedical hypothesis generation, evidence gathering, and drug discovery. It uses multi-model AI orchestration across a 10-stage discovery pipeline to explore biological pathways and discover potential treatments.

Your capabilities:
1. **Research Tutoring & Education:**
   - Teach and explain molecular biology, pharmacology, genetics, biochemistry, immunology, cell biology, and biomedical research methodology
   - Break down complex biological concepts into understandable explanations with examples
   - Explain statistical methods (t-tests, ANOVA, survival analysis, regression) and when to use them
   - Teach experimental design principles, controls, sample sizing, and bias mitigation
   - Explain genomics concepts (pathway enrichment, GSEA, variant annotation, biomarkers)
   - Guide users through reading and interpreting research papers and clinical trial data
   - Explain disease mechanisms, drug mechanisms of action, and pharmacokinetics
   - Teach about research ethics, regulatory pathways (FDA, EMA), and GLP/GMP compliance

2. **Platform Assistance:**
   - Help researchers formulate and refine hypotheses about disease mechanisms
   - Suggest experimental designs and validation strategies based on platform evidence
   - Analyze and discuss drug repurposing, combination therapies, and biomarkers
   - Guide users on using HumaNovo features (projects, discovery, simulations, evidence search, workbench, notebook, statistical analysis, genomics analysis, knowledge graph)

3. **Research Companion:**
   - Discuss and reference specific hypotheses, evidence, and projects from the platform
   - Help interpret simulation results and statistical outputs
   - Suggest next steps in the research workflow
   - Help draft research notes, experiment protocols, and manuscript sections

4. **Workbench & Knowledge Graph:**
   - When in workbench context, explain biological relationships between nodes on the graph
   - Suggest connections between biological entities (e.g., "TP53 regulates apoptosis via BAX")
   - Recommend new nodes to add based on the current graph context
   - Explain signaling pathways, protein interactions, and gene regulatory networks

Guidelines:
- Be conversational and natural — talk like a knowledgeable research mentor, not a robot
- When teaching, use analogies and real-world examples to make concepts accessible
- Be scientifically accurate and cite specific genes, proteins, pathways, and mechanisms
- When discussing hypotheses, consider confidence levels, supporting evidence, and potential confounders
- If the user provides platform context (projects, hypotheses, evidence), use it extensively
- If RAG context is provided below, use it as your primary source of truth
- Proactively offer to teach related concepts when they come up naturally
- Format responses clearly with short paragraphs; use markdown for structure when explaining complex topics
- Never fabricate data — if you don't have enough platform context, say so and use your biomedical knowledge to educate"""


async def _retrieve_rag_context(query: str) -> str:
    """
    Retrieve relevant platform knowledge via Azure text-embedding-3-large
    embeddings and hybrid RAG search to ground Constant's responses.
    """
    rag_chunks: list[str] = []

    # --- RAG retrieval via Azure text-embedding-3-large embeddings ---
    if settings.AZURE_EMBEDDING_ENDPOINT and settings.AZURE_EMBEDDING_KEY:
        try:
            import httpx

            # Step 1: Generate embedding for the user query using text-embedding-3-large
            embed_url = settings.AZURE_EMBEDDING_ENDPOINT.rstrip("/")
            deploy = settings.AZURE_OPENAI_EMBEDDING_DEPLOYMENT_LARGE
            api_ver = settings.AZURE_EMBEDDING_API_VERSION
            url = f"{embed_url}/openai/deployments/{deploy}/embeddings?api-version={api_ver}"

            async with httpx.AsyncClient(timeout=15) as client:
                embed_resp = await client.post(
                    url,
                    headers={"api-key": settings.AZURE_EMBEDDING_KEY.get_secret_value()},
                    json={"input": query, "model": deploy},
                )
                if embed_resp.status_code == 200:
                    embed_data = embed_resp.json()
                    query_embedding = embed_data.get("data", [{}])[0].get("embedding", [])

                    if query_embedding:
                        # Step 2: Search pgvector grounding_cache
                        try:
                            import asyncpg
                            db_url = getattr(settings, "DATABASE_URL", None)
                            if db_url:
                                conn = await asyncpg.connect(str(db_url))
                                try:
                                    rows = await conn.fetch(
                                        """
                                        SELECT content
                                        FROM grounding_cache
                                        WHERE embedding_openai IS NOT NULL
                                          AND 1 - (embedding_openai <=> $1::vector) >= 0.5
                                        ORDER BY embedding_openai <=> $1::vector
                                        LIMIT $2
                                        """,
                                        str(query_embedding),
                                        getattr(settings, "GROUNDING_RAG_TOP_K", 8),
                                    )
                                    for row in rows:
                                        doc = row["content"]
                                        if doc and len(doc.strip()) > 20:
                                            rag_chunks.append(doc.strip())
                                finally:
                                    await conn.close()
                        except ImportError:
                            logger.debug("asyncpg not installed — skipping pgvector RAG")
                        except Exception as e:
                            logger.debug(f"pgvector retrieval skipped: {e}")

        except Exception as e:
            logger.warning(f"RAG embedding retrieval error: {e}")

    # --- Also search local platform data (hypotheses, projects, evidence) ---
    try:
        import httpx

        async with httpx.AsyncClient(timeout=10, base_url="http://localhost:8000/api/v1") as client:
            # Search evidence
            try:
                resp = await client.post("/evidence/search", json={"query": query, "limit": 5})
                if resp.status_code == 200:
                    items = resp.json().get("items", [])
                    for item in items[:5]:
                        title = item.get("title", "")
                        abstract = item.get("abstract", item.get("snippet", ""))
                        if title:
                            rag_chunks.append(f"Evidence: {title}. {abstract}")
            except Exception as exc:
                # best-effort: RAG falls back to other sources if evidence retrieval fails
                logger.debug("rag.evidence_lookup_failed", error=str(exc))

            # Search hypotheses
            try:
                resp = await client.get("/hypotheses", params={"page_size": 10})
                if resp.status_code == 200:
                    items = resp.json().get("items", [])
                    for item in items:
                        statement = item.get("statement", "")
                        mechanism = item.get("mechanism", "")
                        confidence = item.get("confidence_score", 0)
                        if statement and query.lower() in (statement + mechanism).lower():
                            rag_chunks.append(
                                f"Hypothesis (confidence: {confidence:.0%}): {statement}. Mechanism: {mechanism}"
                            )
            except Exception as exc:
                # best-effort: RAG falls back to other sources if hypothesis retrieval fails
                logger.debug("rag.hypothesis_lookup_failed", error=str(exc))
    except Exception as e:
        logger.debug(f"Platform data retrieval skipped: {e}")

    return "\n\n".join(rag_chunks[:10]) if rag_chunks else ""


@router.post("/chat")
async def constant_chat(request: ChatRequest):
    """
    Constant AI chat assistant — uses AWS Bedrock Claude Opus 4.6 (primary)
    with RAG grounding via Azure text-embedding-3-large embeddings.
    Falls back to Azure GPT-4o, then Azure GPT-4.1.
    """
    if not request.message.strip():
        return {"response": "Please ask me a question about your research."}

    # Step 1: Retrieve RAG context using text-embedding-3-large
    rag_context = await _retrieve_rag_context(request.message)

    # Step 2: Build platform context string from frontend-provided data
    context_parts = []
    if request.context and request.context != "general":
        context_parts.append(f"Current context: {request.context}")
    if request.platform_context:
        projects = request.platform_context.get("projects", [])
        hypotheses = request.platform_context.get("hypotheses", [])
        if projects:
            context_parts.append(f"User's active projects: {', '.join(str(p) for p in projects[:5])}")
        if hypotheses:
            context_parts.append(f"User's recent hypotheses: {', '.join(str(h) for h in hypotheses[:5])}")

    platform_context_str = "\n".join(context_parts) if context_parts else ""

    # Step 3: Compose the full grounded user message
    user_content_parts = []
    if rag_context:
        user_content_parts.append(f"[RAG Knowledge Base Context — use this as your primary source of truth]\n{rag_context}")
    if platform_context_str:
        user_content_parts.append(f"[Platform context]\n{platform_context_str}")
    user_content_parts.append(f"[User question]\n{request.message}")
    user_content = "\n\n".join(user_content_parts)

    response_text = None

    # --- Attempt 1: AWS Bedrock Claude Opus 4.6 (primary) ---
    if settings.aws_access_key_value and settings.aws_secret_key_value:
        try:
            import boto3
            bedrock_client = boto3.client(
                "bedrock-runtime",
                region_name=settings.AWS_REGION,
                aws_access_key_id=settings.aws_access_key_value,
                aws_secret_access_key=settings.aws_secret_key_value,
            )

            model_id = settings.BEDROCK_MODEL_CLAUDE_OPUS  # us.anthropic.claude-opus-4-6-v1:0

            converse_response = bedrock_client.converse(
                modelId=model_id,
                system=[{"text": CONSTANT_SYSTEM_PROMPT}],
                messages=[
                    {
                        "role": "user",
                        "content": [{"text": user_content}],
                    }
                ],
                inferenceConfig={
                    "maxTokens": 2048,
                    "temperature": 0.5,
                },
            )

            output_message = converse_response.get("output", {}).get("message", {})
            content_blocks = output_message.get("content", [])
            if content_blocks:
                response_text = content_blocks[0].get("text", "")

        except Exception as e:
            logger.warning(f"AWS Bedrock Claude Opus chat error: {e}")

    # --- Attempt 2: Azure GPT-4o (fallback) ---
    if not response_text and settings.AZURE_GPT4O_ENDPOINT and settings.AZURE_GPT4O_KEY:
        try:
            import httpx
            azure_url = settings.AZURE_GPT4O_ENDPOINT.rstrip("/")
            deploy = settings.AZURE_GPT4O_DEPLOYMENT
            api_ver = settings.AZURE_GPT4O_API_VERSION
            url = f"{azure_url}/openai/deployments/{deploy}/chat/completions?api-version={api_ver}"
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.post(
                    url,
                    headers={"api-key": settings.AZURE_GPT4O_KEY.get_secret_value()},
                    json={
                        "messages": [
                            {"role": "system", "content": CONSTANT_SYSTEM_PROMPT},
                            {"role": "user", "content": user_content},
                        ],
                        "max_tokens": 2048,
                        "temperature": 0.5,
                    },
                )
                if resp.status_code == 200:
                    data = resp.json()
                    choices = data.get("choices", [])
                    if choices:
                        response_text = choices[0].get("message", {}).get("content", "")
        except Exception as e:
            logger.warning(f"Azure GPT-4o chat error: {e}")

    # --- Attempt 3: Azure GPT-4.1 (fallback) ---
    if not response_text and settings.AZURE_GPT41_ENDPOINT and settings.AZURE_GPT41_KEY:
        try:
            import httpx
            azure_url = settings.AZURE_GPT41_ENDPOINT.rstrip("/")
            deploy = settings.AZURE_GPT41_DEPLOYMENT
            api_ver = settings.AZURE_GPT41_API_VERSION
            url = f"{azure_url}/openai/deployments/{deploy}/chat/completions?api-version={api_ver}"
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.post(
                    url,
                    headers={"api-key": settings.AZURE_GPT41_KEY.get_secret_value()},
                    json={
                        "messages": [
                            {"role": "system", "content": CONSTANT_SYSTEM_PROMPT},
                            {"role": "user", "content": user_content},
                        ],
                        "max_tokens": 2048,
                        "temperature": 0.5,
                    },
                )
                if resp.status_code == 200:
                    data = resp.json()
                    choices = data.get("choices", [])
                    if choices:
                        response_text = choices[0].get("message", {}).get("content", "")
        except Exception as e:
            logger.warning(f"Azure GPT-4.1 chat error: {e}")

    if not response_text:
        response_text = (
            "I'm having trouble reaching Constant AI right now. "
            "Please check that Constant AI is configured with valid credentials on the server."
        )

    return {"response": response_text}


# Simulation integration - run simulations through orchestrator
@router.post("/simulate")
async def run_simulation(request: StartDiscoveryRequest):
    """
    Run a disease simulation through the orchestrator.
    """
    return await start_discovery_endpoint(request)
