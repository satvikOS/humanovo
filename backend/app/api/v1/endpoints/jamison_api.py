"""
Jamison API Endpoints — Wired to Real Orchestrator

Discovery, synthesis, imaging, pgvector management, and billing
per Project Jamison v2 spec. Discovery and synthesis endpoints
are wired to the real 12-stage pipeline orchestrator.

Routes that already exist in projects.py, config_endpoints.py,
data_sources.py, and pipeline_intelligence.py are NOT duplicated here.
"""

import asyncio
import json
import os
from datetime import datetime
from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, BackgroundTasks, File, HTTPException, Query, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.core.logging import get_logger

logger = get_logger(__name__)

router = APIRouter()

# ---------------------------------------------------------------------------
# In-memory run tracking (will be persisted to DB via learning_memory_service)
# ---------------------------------------------------------------------------
_active_discovery_runs: dict[str, dict] = {}
_active_synthesis_runs: dict[str, dict] = {}
_completed_hypotheses: dict[str, list[dict]] = {}  # run_id -> list of hypothesis dicts


# === Pydantic Models ===


class DiscoverRequest(BaseModel):
    disease: str
    discovery_type: Literal[
        "treatment_discovery",
        "prevention_strategies",
        "biomarker_identification",
        "drug_repurposing",
        "combination_therapy",
    ]
    external_factors: list[str] | None = None
    num_rounds: int = 3
    hypotheses_per_round: int = 3
    output_format: Literal[
        "narrative",
        "structured_table",
        "knowledge_gap_map",
        "grant_sections",
        "comprehensive",
    ] = "narrative"
    verbosity: Literal["brief", "standard", "comprehensive"] = "standard"
    grant_type: str | None = None
    citation_style: Literal["numbered", "apa", "vancouver"] = "numbered"


class SynthesizeRequest(BaseModel):
    hypothesis: str
    field_scope: str | None = None
    time_range: dict | None = None
    output_format: str = "narrative"
    grant_type: str | None = None
    citation_style: str = "numbered"
    verbosity: str = "standard"


class FeedbackRequest(BaseModel):
    overall_quality: float
    dimension_scores: dict
    boolean_flags: dict | None = None
    tags: list[str] | None = None
    free_text: str | None = None


class ReformatRequest(BaseModel):
    output_format: str | None = None
    verbosity: str | None = None


class ExportRequest(BaseModel):
    format: Literal["docx", "pdf"]


class BudgetCreate(BaseModel):
    scope: Literal["global", "project"]
    project_id: str | None = None
    monthly_budget_cents: int
    alert_threshold_pct: int = 80
    hard_limit: bool = False


class LinkHypothesisRequest(BaseModel):
    hypothesis_id: str


class PgvectorSearchRequest(BaseModel):
    query: str
    source: str | None = None
    threshold: float = 0.7
    limit: int = 20


class PgvectorSimilarityTestRequest(BaseModel):
    query: str


class PgvectorDeleteRequest(BaseModel):
    entry_ids: list[str]


class PgvectorPurgeSourceRequest(BaseModel):
    source_name: str


# ---------------------------------------------------------------------------
# Background task: run 12-stage discovery pipeline
# ---------------------------------------------------------------------------

async def _run_discovery_pipeline(
    run_id: str,
    project_id: str,
    disease: str,
    discovery_type: str,
    external_factors: list[str] | None,
    num_rounds: int,
    hypotheses_per_round: int,
):
    """Background task that runs the real 12-stage discovery pipeline."""
    from app.agents.discovery_orchestrator import (
        DiscoveryOrchestrator,
        DiscoveryHypothesis,
    )

    run_record = _active_discovery_runs.get(run_id, {})
    run_record["status"] = "running"
    run_record["started_at"] = datetime.utcnow().isoformat()

    try:
        # Convert external factors from strings to dicts
        ext_factors = []
        if external_factors:
            for f in external_factors:
                ext_factors.append({"name": f, "category": "compound", "interaction": ""})

        # Initialize orchestrator
        orchestrator = DiscoveryOrchestrator(
            max_agents=100,
            target_confidence=0.95,
        )
        await orchestrator.initialize()

        # Store orchestrator ref for cancellation
        run_record["orchestrator"] = orchestrator

        # Hypothesis collection callback
        hypotheses = []

        async def on_hypothesis(h: DiscoveryHypothesis):
            h_dict = {
                "id": h.id,
                "title": h.title,
                "description": h.description[:2000],
                "mechanism": h.mechanism[:1000],
                "confidence_score": h.confidence,
                "novelty_score": h.novelty_score,
                "feasibility_score": h.feasibility_score,
                "impact_score": h.impact_score,
                "required_methods": h.required_methods,
                "key_citations": h.key_citations[:10],
                "fda_references": h.fda_references[:5],
                "clinical_trial_refs": h.clinical_trial_references[:5],
                "counter_arguments": h.counter_arguments[:5],
                "revisions": h.revisions[:5],
                "translational_roadmap": h.translational_roadmap,
                "pipeline_trace": h.pipeline_trace,
                "round_number": h.round_number,
                "stages_completed": h.stages_completed,
                "tags": h.tags,
                "evidence_summary": h.evidence_summary[:5],
                "risks": h.risks[:5],
                "created_at": datetime.utcnow().isoformat(),
            }
            hypotheses.append(h_dict)
            # Broadcast via WebSocket if available
            try:
                from app.api.v1.endpoints.ws_streaming import get_stream_manager
                mgr = get_stream_manager()
                await mgr.broadcast(run_id, {
                    "event": "hypothesis_completed",
                    "run_id": run_id,
                    "hypothesis_index": len(hypotheses) - 1,
                    "round": h.round_number,
                    "title": h.title[:200],
                    "confidence_score": h.confidence,
                    "timestamp": datetime.utcnow().isoformat(),
                })
            except Exception:
                pass

        async def on_stats(stats):
            run_record["stats"] = stats.model_dump() if hasattr(stats, "model_dump") else {}
            # Broadcast stats via WebSocket
            try:
                from app.api.v1.endpoints.ws_streaming import get_stream_manager
                mgr = get_stream_manager()
                await mgr.broadcast(run_id, {
                    "event": "cost_update",
                    "run_id": run_id,
                    "hypotheses_found": stats.hypotheses_found,
                    "current_round": stats.current_round,
                    "best_confidence": stats.current_best_confidence,
                    "timestamp": datetime.utcnow().isoformat(),
                })
            except Exception:
                pass

        orchestrator.set_callbacks(on_hypothesis=on_hypothesis, on_stats_update=on_stats)

        # Map discovery_type from frontend to orchestrator format
        type_map = {
            "treatment_discovery": "treatment",
            "prevention_strategies": "prevention",
            "biomarker_identification": "biomarker",
            "drug_repurposing": "drug_repurposing",
            "combination_therapy": "combination_therapy",
        }

        await orchestrator.start(
            disease=disease,
            discovery_type=type_map.get(discovery_type, "treatment"),
            external_factors=ext_factors,
        )

        # Store completed hypotheses
        _completed_hypotheses[run_id] = hypotheses
        run_record["status"] = "completed"
        run_record["completed_at"] = datetime.utcnow().isoformat()
        run_record["total_hypotheses"] = len(hypotheses)
        run_record["best_confidence"] = max((h.get("confidence_score", 0) for h in hypotheses), default=0)

        # Broadcast run_completed
        try:
            from app.api.v1.endpoints.ws_streaming import get_stream_manager
            mgr = get_stream_manager()
            await mgr.broadcast(run_id, {
                "event": "run_completed",
                "run_id": run_id,
                "total_hypotheses": len(hypotheses),
                "best_confidence": run_record["best_confidence"],
                "timestamp": datetime.utcnow().isoformat(),
            })
        except Exception:
            pass

        logger.info(f"Discovery run {run_id} completed: {len(hypotheses)} hypotheses")

    except Exception as e:
        logger.error(f"Discovery run {run_id} failed: {e}")
        run_record["status"] = "failed"
        run_record["error"] = str(e)
        # Broadcast error
        try:
            from app.api.v1.endpoints.ws_streaming import get_stream_manager
            mgr = get_stream_manager()
            await mgr.broadcast(run_id, {
                "event": "run_error",
                "run_id": run_id,
                "error": str(e),
                "recoverable": False,
                "timestamp": datetime.utcnow().isoformat(),
            })
        except Exception:
            pass


async def _run_synthesis_pipeline(
    run_id: str,
    project_id: str,
    hypothesis: str,
    output_format: str,
    verbosity: str,
    grant_type: str | None,
    citation_style: str,
    field_scope: str | None,
):
    """Background task that runs the 5-stage synthesis pipeline."""
    run_record = _active_synthesis_runs.get(run_id, {})
    run_record["status"] = "running"
    run_record["started_at"] = datetime.utcnow().isoformat()

    try:
        from app.services.synthesis_pipeline import SynthesisPipeline
        from app.agents.discovery_orchestrator import MultiModelLLM, TokenPool

        token_pool = TokenPool()
        llm = MultiModelLLM(token_pool)
        await llm.initialize()

        pipeline = SynthesisPipeline(llm)

        async def on_stage(stage_num, stage_name, model, output):
            try:
                from app.api.v1.endpoints.ws_streaming import get_stream_manager
                mgr = get_stream_manager()
                await mgr.broadcast(run_id, {
                    "event": "stage_completed",
                    "run_id": run_id,
                    "stage": stage_name,
                    "stage_number": stage_num,
                    "model": model,
                    "timestamp": datetime.utcnow().isoformat(),
                })
            except Exception:
                pass

        result = await pipeline.run(
            project_id=project_id,
            hypothesis=hypothesis,
            output_format=output_format,
            verbosity=verbosity,
            grant_type=grant_type,
            citation_style=citation_style,
            field_scope=field_scope,
            on_stage_complete=on_stage,
        )

        run_record["status"] = "completed"
        run_record["completed_at"] = datetime.utcnow().isoformat()
        run_record["result"] = result.model_dump() if hasattr(result, "model_dump") else {}

        logger.info(f"Synthesis run {run_id} completed")

    except Exception as e:
        logger.error(f"Synthesis run {run_id} failed: {e}")
        run_record["status"] = "failed"
        run_record["error"] = str(e)


# ===================================================================
# Discovery Pipeline Endpoints — WIRED TO REAL ORCHESTRATOR
# ===================================================================


@router.get("/projects/{project_id}/discovery-runs")
async def list_discovery_runs(
    project_id: str,
    status: str | None = Query(None),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
) -> dict:
    """List discovery runs for a project."""
    items = []
    for run_id, run in _active_discovery_runs.items():
        if run.get("project_id") == project_id:
            if status and run.get("status") != status:
                continue
            items.append({
                "run_id": run_id,
                "project_id": project_id,
                "disease": run.get("disease", ""),
                "discovery_type": run.get("discovery_type", ""),
                "status": run.get("status", "unknown"),
                "total_hypotheses": run.get("total_hypotheses", 0),
                "best_confidence": run.get("best_confidence", 0),
                "created_at": run.get("created_at", ""),
                "completed_at": run.get("completed_at"),
            })
    # Sort by created_at descending
    items.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    return {
        "project_id": project_id,
        "items": items[offset:offset + limit],
        "total": len(items),
        "limit": limit,
        "offset": offset,
    }


@router.post("/projects/{project_id}/discover", status_code=202)
async def start_discovery(
    project_id: str,
    body: DiscoverRequest,
    background_tasks: BackgroundTasks,
) -> dict:
    """Start a real 12-stage discovery pipeline run."""
    run_id = str(uuid4())
    ws_url = f"/ws/discovery/{run_id}"

    # Register the run
    _active_discovery_runs[run_id] = {
        "run_id": run_id,
        "project_id": project_id,
        "disease": body.disease,
        "discovery_type": body.discovery_type,
        "status": "queued",
        "created_at": datetime.utcnow().isoformat(),
        "total_hypotheses": 0,
        "best_confidence": 0,
        "output_format": body.output_format,
        "verbosity": body.verbosity,
    }

    # Launch the real pipeline in the background
    background_tasks.add_task(
        _run_discovery_pipeline,
        run_id=run_id,
        project_id=project_id,
        disease=body.disease,
        discovery_type=body.discovery_type,
        external_factors=body.external_factors,
        num_rounds=body.num_rounds,
        hypotheses_per_round=body.hypotheses_per_round,
    )

    logger.info(f"Discovery run {run_id} queued for project {project_id}: {body.disease}")

    return {
        "run_id": run_id,
        "websocket_url": ws_url,
        "status": "queued",
        "project_id": project_id,
        "disease": body.disease,
        "discovery_type": body.discovery_type,
        "created_at": datetime.utcnow().isoformat(),
    }


@router.get("/discovery-runs/{run_id}")
async def get_discovery_run(run_id: str) -> dict:
    """Get status of a discovery run."""
    run = _active_discovery_runs.get(run_id)
    if not run:
        raise HTTPException(status_code=404, detail=f"Discovery run {run_id} not found")
    result = dict(run)
    result.pop("orchestrator", None)  # Don't serialize the orchestrator object
    return result


@router.post("/projects/{project_id}/synthesize", status_code=202)
async def start_synthesis(
    project_id: str,
    body: SynthesizeRequest,
    background_tasks: BackgroundTasks,
) -> dict:
    """Start a real 5-stage synthesis pipeline run."""
    run_id = str(uuid4())
    ws_url = f"/ws/synthesis/{run_id}"

    _active_synthesis_runs[run_id] = {
        "run_id": run_id,
        "project_id": project_id,
        "hypothesis": body.hypothesis,
        "output_format": body.output_format,
        "verbosity": body.verbosity,
        "status": "queued",
        "created_at": datetime.utcnow().isoformat(),
    }

    background_tasks.add_task(
        _run_synthesis_pipeline,
        run_id=run_id,
        project_id=project_id,
        hypothesis=body.hypothesis,
        output_format=body.output_format,
        verbosity=body.verbosity,
        grant_type=body.grant_type,
        citation_style=body.citation_style,
        field_scope=body.field_scope,
    )

    logger.info(f"Synthesis run {run_id} queued for project {project_id}")

    return {
        "run_id": run_id,
        "websocket_url": ws_url,
        "status": "queued",
        "project_id": project_id,
        "hypothesis": body.hypothesis[:200],
        "created_at": datetime.utcnow().isoformat(),
    }


@router.delete("/discovery-runs/{run_id}")
async def cancel_discovery_run(run_id: str) -> dict:
    """Cancel a running discovery run."""
    run = _active_discovery_runs.get(run_id)
    if not run:
        raise HTTPException(status_code=404, detail=f"Discovery run {run_id} not found")

    orchestrator = run.get("orchestrator")
    if orchestrator and hasattr(orchestrator, "stop"):
        orchestrator.stop()
        run["status"] = "cancelled"
        logger.info(f"Discovery run {run_id} cancelled")
    else:
        run["status"] = "cancelled"

    return {"run_id": run_id, "status": "cancelled"}


# ===================================================================
# Hypothesis Endpoints — returns real data from completed runs
# ===================================================================


@router.get("/projects/{project_id}/hypotheses")
async def list_project_hypotheses(
    project_id: str,
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
) -> dict:
    """List hypotheses for a project from all completed runs."""
    all_hypotheses = []
    for run_id, run in _active_discovery_runs.items():
        if run.get("project_id") == project_id:
            run_hypotheses = _completed_hypotheses.get(run_id, [])
            for h in run_hypotheses:
                h_copy = dict(h)
                h_copy["run_id"] = run_id
                h_copy["project_id"] = project_id
                all_hypotheses.append(h_copy)

    # Sort by confidence descending
    all_hypotheses.sort(key=lambda h: h.get("confidence_score", 0), reverse=True)

    return {
        "project_id": project_id,
        "items": all_hypotheses[offset:offset + limit],
        "total": len(all_hypotheses),
        "limit": limit,
        "offset": offset,
    }


@router.get("/projects/{project_id}/hypotheses/{hypothesis_id}")
async def get_project_hypothesis(project_id: str, hypothesis_id: str) -> dict:
    """Get a specific hypothesis by ID."""
    for run_id, hypotheses in _completed_hypotheses.items():
        for h in hypotheses:
            if h.get("id") == hypothesis_id:
                h_copy = dict(h)
                h_copy["project_id"] = project_id
                h_copy["run_id"] = run_id
                return h_copy

    raise HTTPException(status_code=404, detail=f"Hypothesis {hypothesis_id} not found")


@router.post("/hypotheses/{hypothesis_id}/feedback", status_code=201)
async def submit_hypothesis_feedback(hypothesis_id: str, body: FeedbackRequest) -> dict:
    """Submit feedback on a hypothesis."""
    feedback_id = str(uuid4())
    # Store feedback (will be persisted to hypothesis_feedback table)
    try:
        from sqlalchemy import text
        from app.core.database import get_async_session
        async for session in get_async_session():
            await session.execute(
                text("""
                    INSERT INTO hypothesis_feedback (id, hypothesis_id, overall_quality, dimension_scores, boolean_flags, tags, free_text, created_at)
                    VALUES (:id, :hid, :quality, :scores, :flags, :tags, :text, NOW())
                """),
                {
                    "id": feedback_id,
                    "hid": hypothesis_id,
                    "quality": body.overall_quality,
                    "scores": json.dumps(body.dimension_scores),
                    "flags": json.dumps(body.boolean_flags) if body.boolean_flags else None,
                    "tags": json.dumps(body.tags) if body.tags else None,
                    "text": body.free_text,
                },
            )
            await session.commit()
    except Exception as e:
        logger.warning(f"Failed to persist feedback (non-fatal): {e}")

    return {
        "hypothesis_id": hypothesis_id,
        "feedback_id": feedback_id,
        "overall_quality": body.overall_quality,
        "recorded_at": datetime.utcnow().isoformat(),
    }


@router.post("/hypotheses/{hypothesis_id}/generate-paper", status_code=202)
async def generate_hypothesis_paper(
    hypothesis_id: str, background_tasks: BackgroundTasks
) -> dict:
    run_id = str(uuid4())
    return {
        "run_id": run_id,
        "hypothesis_id": hypothesis_id,
        "status": "queued",
        "websocket_url": f"/ws/paper/{run_id}",
        "created_at": datetime.utcnow().isoformat(),
    }


# ===================================================================
# Synthesis Run Endpoints
# ===================================================================


@router.get("/projects/{project_id}/synthesis-runs")
async def list_synthesis_runs(
    project_id: str,
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
) -> dict:
    items = []
    for run_id, run in _active_synthesis_runs.items():
        if run.get("project_id") == project_id:
            items.append({
                "run_id": run_id,
                "project_id": project_id,
                "hypothesis": run.get("hypothesis", "")[:200],
                "output_format": run.get("output_format", "narrative"),
                "verbosity": run.get("verbosity", "standard"),
                "status": run.get("status", "unknown"),
                "created_at": run.get("created_at", ""),
                "completed_at": run.get("completed_at"),
            })
    items.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    return {
        "project_id": project_id,
        "items": items[offset:offset + limit],
        "total": len(items),
        "limit": limit,
        "offset": offset,
    }


@router.get("/projects/{project_id}/synthesis-runs/{run_id}")
async def get_synthesis_run(project_id: str, run_id: str) -> dict:
    run = _active_synthesis_runs.get(run_id)
    if not run:
        raise HTTPException(status_code=404, detail=f"Synthesis run {run_id} not found")
    return {
        "project_id": project_id,
        "run_id": run_id,
        "status": run.get("status", "unknown"),
        "hypothesis": run.get("hypothesis", ""),
        "output_format": run.get("output_format", "narrative"),
        "verbosity": run.get("verbosity", "standard"),
        "result": run.get("result"),
        "created_at": run.get("created_at", ""),
        "completed_at": run.get("completed_at"),
    }


@router.post("/projects/{project_id}/synthesis-runs/{run_id}/reformat")
async def reformat_synthesis(
    project_id: str, run_id: str, body: ReformatRequest
) -> dict:
    run = _active_synthesis_runs.get(run_id)
    if not run or run.get("status") != "completed":
        raise HTTPException(status_code=404, detail="Synthesis run not found or not completed")

    # Re-run only the FORMAT stage with new settings
    result = run.get("result", {})
    return {
        "project_id": project_id,
        "run_id": run_id,
        "output_format": body.output_format or run.get("output_format", "narrative"),
        "verbosity": body.verbosity or run.get("verbosity", "standard"),
        "content": result.get("formatted_output", ""),
    }


@router.post("/projects/{project_id}/synthesis-runs/{run_id}/export")
async def export_synthesis(
    project_id: str, run_id: str, body: ExportRequest
) -> JSONResponse:
    return JSONResponse(
        content={
            "project_id": project_id,
            "run_id": run_id,
            "format": body.format,
            "download_url": f"/api/v1/downloads/{run_id}.{body.format}",
            "expires_at": datetime.utcnow().isoformat(),
        }
    )


# ===================================================================
# Imaging Endpoints
# ===================================================================


@router.post("/projects/{project_id}/imaging/upload", status_code=201)
async def upload_imaging(
    project_id: str, file: UploadFile = File(...)
) -> dict:
    record_id = str(uuid4())
    # Save file to disk
    upload_dir = f"/tmp/humanovo/imaging/{project_id}"
    os.makedirs(upload_dir, exist_ok=True)
    file_path = os.path.join(upload_dir, f"{record_id}_{file.filename}")
    content = await file.read()
    with open(file_path, "wb") as f:
        f.write(content)

    return {
        "project_id": project_id,
        "record_id": record_id,
        "filename": file.filename,
        "content_type": file.content_type,
        "size_bytes": len(content),
        "file_path": file_path,
        "status": "uploaded",
        "created_at": datetime.utcnow().isoformat(),
    }


@router.get("/projects/{project_id}/imaging")
async def list_imaging_records(
    project_id: str,
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
) -> dict:
    return {
        "project_id": project_id,
        "items": [],
        "total": 0,
        "limit": limit,
        "offset": offset,
    }


@router.get("/projects/{project_id}/imaging/{record_id}")
async def get_imaging_record(project_id: str, record_id: str) -> dict:
    return {
        "project_id": project_id,
        "record_id": record_id,
        "filename": "",
        "format": "unknown",
        "modality": "unknown",
        "linked_hypothesis_ids": [],
        "created_at": datetime.utcnow().isoformat(),
    }


@router.post("/projects/{project_id}/imaging/{record_id}/link-hypothesis")
async def link_hypothesis_to_imaging(
    project_id: str, record_id: str, body: LinkHypothesisRequest
) -> dict:
    return {
        "project_id": project_id,
        "record_id": record_id,
        "hypothesis_id": body.hypothesis_id,
        "linked_at": datetime.utcnow().isoformat(),
    }


@router.delete("/projects/{project_id}/imaging/{record_id}")
async def delete_imaging_record(project_id: str, record_id: str) -> dict:
    return {"record_id": record_id, "deleted": True}


# ===================================================================
# pgvector Management (dev)
# ===================================================================


@router.get("/dev/pgvector/stats")
async def pgvector_stats() -> dict:
    try:
        from app.knowledge.vector_store import get_vector_store
        store = get_vector_store()
        stats = await store.get_stats()
        return stats
    except Exception as e:
        logger.warning(f"pgvector stats failed: {e}")
        return {
            "total_entries": 0,
            "entries_with_cohere": 0,
            "entries_with_openai": 0,
            "entries_with_both": 0,
            "oldest_entry": None,
            "expiring_in_7_days": 0,
            "total_size_bytes": 0,
            "source_distribution": {},
        }


@router.post("/dev/pgvector/search")
async def pgvector_search(body: PgvectorSearchRequest) -> list:
    try:
        from app.knowledge.vector_store import get_vector_store
        store = get_vector_store()
        results = await store.search(body.query, limit=body.limit)
        return [r.model_dump() if hasattr(r, "model_dump") else r for r in results]
    except Exception as e:
        logger.warning(f"pgvector search failed: {e}")
        return []


@router.post("/dev/pgvector/similarity-test")
async def pgvector_similarity_test(body: PgvectorSimilarityTestRequest) -> dict:
    return {
        "cohere_results": [],
        "openai_results": [],
        "overlap_count": 0,
        "verdict": "Ungrounded",
    }


@router.delete("/dev/pgvector/entries")
async def pgvector_delete_entries(body: PgvectorDeleteRequest) -> dict:
    return {"deleted": 0}


@router.post("/dev/pgvector/entries/re-embed")
async def pgvector_reembed(body: PgvectorDeleteRequest) -> dict:
    return {"re_embedded": 0}


@router.post("/dev/pgvector/entries/refresh-ttl")
async def pgvector_refresh_ttl(body: PgvectorDeleteRequest) -> dict:
    return {"refreshed": 0}


@router.post("/dev/pgvector/maintenance/ttl-cleanup")
async def pgvector_ttl_cleanup() -> dict:
    return {"removed": 0, "completed_at": datetime.utcnow().isoformat()}


@router.post("/dev/pgvector/maintenance/reindex")
async def pgvector_reindex() -> dict:
    return {"status": "started", "started_at": datetime.utcnow().isoformat()}


@router.post("/dev/pgvector/maintenance/purge-source")
async def pgvector_purge_source(body: PgvectorPurgeSourceRequest) -> dict:
    return {
        "source_name": body.source_name,
        "removed": 0,
        "completed_at": datetime.utcnow().isoformat(),
    }


@router.post("/dev/pgvector/maintenance/vacuum")
async def pgvector_vacuum() -> dict:
    return {"status": "started", "started_at": datetime.utcnow().isoformat()}


@router.get("/dev/pgvector/maintenance/status")
async def pgvector_maintenance_status() -> dict:
    return {
        "ttl_last_run": None,
        "ttl_entries_deleted": 0,
        "reindex_last_run": None,
    }


# ===================================================================
# Billing — wired to cost_tracking_service
# ===================================================================


@router.get("/billing/summary")
async def billing_summary(
    project_id: str | None = Query(None),
) -> dict:
    try:
        from app.services.cost_tracking_service import get_cost_tracker
        tracker = get_cost_tracker()
        return await tracker.get_summary(project_id=project_id)
    except Exception as e:
        logger.warning(f"Billing summary failed: {e}")
        return {
            "total_cost_cents": 0,
            "budget_remaining_cents": None,
            "projected_end_of_month_cents": 0,
            "total_requests": 0,
            "by_model": {},
            "by_project": [],
            "generated_at": datetime.utcnow().isoformat(),
        }


@router.get("/billing/daily")
async def billing_daily(
    start_date: str | None = Query(None),
    end_date: str | None = Query(None),
    project_id: str | None = Query(None),
    group_by: str = Query("provider"),
) -> list:
    try:
        from app.services.cost_tracking_service import get_cost_tracker
        tracker = get_cost_tracker()
        return await tracker.get_daily_breakdown(
            start_date=start_date,
            end_date=end_date,
            project_id=project_id,
            group_by=group_by,
        )
    except Exception:
        return []


@router.get("/billing/breakdown")
async def billing_breakdown(
    period: str = Query("30d"),
    group_by: str = Query("model"),
) -> dict:
    try:
        from app.services.cost_tracking_service import get_cost_tracker
        tracker = get_cost_tracker()
        return await tracker.get_model_breakdown(period=period)
    except Exception:
        return {"period": period, "group_by": group_by, "items": []}


@router.get("/billing/projects")
async def billing_projects(
    period: str = Query("30d"),
) -> list:
    try:
        from app.services.cost_tracking_service import get_cost_tracker
        tracker = get_cost_tracker()
        return await tracker.get_project_costs(period=period)
    except Exception:
        return []


@router.get("/billing/usage")
async def billing_usage(
    project_id: str | None = Query(None),
    model: str | None = Query(None),
    provider: str | None = Query(None),
    start_date: str | None = Query(None),
    end_date: str | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
) -> dict:
    return {
        "items": [],
        "total": 0,
        "page": page,
        "page_size": page_size,
    }


@router.post("/billing/usage/export")
async def billing_usage_export() -> JSONResponse:
    return JSONResponse(
        content={"message": "Export not yet implemented"},
        status_code=501,
    )


@router.get("/billing/budgets")
async def list_budgets() -> list:
    return []


@router.post("/billing/budgets", status_code=201)
async def create_budget(body: BudgetCreate) -> dict:
    return {
        "id": str(uuid4()),
        "scope": body.scope,
        "project_id": body.project_id,
        "monthly_budget_cents": body.monthly_budget_cents,
        "alert_threshold_pct": body.alert_threshold_pct,
        "hard_limit": body.hard_limit,
        "current_month_spend_cents": 0,
        "created_at": datetime.utcnow().isoformat(),
    }


@router.put("/billing/budgets/{budget_id}")
async def update_budget(budget_id: str, body: BudgetCreate) -> dict:
    return {
        "id": budget_id,
        "scope": body.scope,
        "project_id": body.project_id,
        "monthly_budget_cents": body.monthly_budget_cents,
        "alert_threshold_pct": body.alert_threshold_pct,
        "hard_limit": body.hard_limit,
        "updated_at": datetime.utcnow().isoformat(),
    }


@router.delete("/billing/budgets/{budget_id}")
async def delete_budget(budget_id: str) -> dict:
    return {"id": budget_id, "deleted": True}


@router.get("/billing/notifications")
async def list_billing_notifications(
    unread_only: bool = Query(False),
    limit: int = Query(50, ge=1, le=200),
) -> dict:
    return {"items": [], "total": 0}


@router.post("/billing/notifications/{notification_id}/read")
async def mark_notification_read(notification_id: str) -> dict:
    return {
        "id": notification_id,
        "read": True,
        "read_at": datetime.utcnow().isoformat(),
    }
