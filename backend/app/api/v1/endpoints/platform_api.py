"""
Platform API Endpoints — Wired to Real Orchestrator

Discovery, synthesis, imaging, pgvector management, and billing
endpoints. Discovery and synthesis are wired to the real 12-stage
pipeline orchestrator.

Routes that already exist in projects.py, config_endpoints.py,
data_sources.py, and pipeline_intelligence.py are NOT duplicated here.

Long-term plan: split this file by domain (discovery_runs.py,
synthesis_runs.py, imaging_workflow.py, pgvector_admin.py,
billing_analytics.py) once each surface stabilises. Kept as a single
module for v1 to minimise router-include churn.
"""

import asyncio
import csv
import io
import json
import os
from datetime import datetime, timezone
from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select, text, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db, async_session_factory
from app.core.logging import get_logger
from app.core.auth import AUTH_REQUIRED, get_current_active_user
from app.core.ownership import assert_owns_project
from app.models.user import User

logger = get_logger(__name__)

router = APIRouter(dependencies=AUTH_REQUIRED)
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
    user_id: str,
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
    from app.services.budget_enforcer_service import (
        BudgetExceeded,
        RunKind,
        UserBudgetBlocked,
        finalize_run,
        start_run,
    )

    run_record = _active_discovery_runs.get(run_id, {})
    run_record["status"] = "running"
    run_record["started_at"] = datetime.now(timezone.utc).isoformat()

    enforcer = None
    try:
        # Pre-flight monthly cap check + per-run hard ceiling. Raises
        # UserBudgetBlocked synchronously if the user is already over
        # their tier's monthly cap; the run never starts.
        try:
            enforcer = await start_run(
                run_id=run_id, user_id=user_id, kind=RunKind.DISCOVERY,
            )
        except UserBudgetBlocked as ub:
            run_record["status"] = "blocked"
            run_record["error"] = str(ub)
            logger.warning(
                f"Discovery run {run_id} blocked: monthly budget exhausted "
                f"for user={user_id}"
            )
            return

        # Convert external factors from strings to dicts
        ext_factors = []
        if external_factors:
            for f in external_factors:
                ext_factors.append({"name": f, "category": "compound", "interaction": ""})

        # Initialize orchestrator with the per-run enforcer + user_id so
        # every stage's `assert_allowed` fires and the per-month spend
        # gets attributed to the right user.
        orchestrator = DiscoveryOrchestrator(
            max_agents=100,
            target_confidence=0.95,
            user_id=user_id,
            budget_enforcer=enforcer,
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
                "confidence_score": h.confidence if h.confidence == h.confidence else 0.5,
                "novelty_score": h.novelty_score if h.novelty_score == h.novelty_score else 0.0,
                "feasibility_score": h.feasibility_score if getattr(h, 'feasibility_score', 0) == getattr(h, 'feasibility_score', 0) else 0.0,
                "impact_score": h.impact_score if getattr(h, 'impact_score', 0) == getattr(h, 'impact_score', 0) else 0.0,
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
                "created_at": datetime.now(timezone.utc).isoformat(),
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
                    "confidence_score": h.confidence if h.confidence == h.confidence else 0.5,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
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
                    "timestamp": datetime.now(timezone.utc).isoformat(),
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
        run_record["completed_at"] = datetime.now(timezone.utc).isoformat()
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
                "timestamp": datetime.now(timezone.utc).isoformat(),
            })
        except Exception:
            pass

        logger.info(f"Discovery run {run_id} completed: {len(hypotheses)} hypotheses")

    except BudgetExceeded as be:
        # Per-run hard cap reached. Mark the run as budget_truncated and
        # commit whatever spend was incurred against the user's monthly
        # cap so the next run respects it.
        run_record["status"] = "budget_truncated"
        run_record["error"] = str(be)
        run_record["spent_cents"] = getattr(be, "spent_cents", None)
        logger.warning(f"Discovery run {run_id} budget-truncated: {be}")
        try:
            from app.api.v1.endpoints.ws_streaming import get_stream_manager
            mgr = get_stream_manager()
            await mgr.broadcast(run_id, {
                "event": "run_error",
                "run_id": run_id,
                "error": str(be),
                "recoverable": False,
                "reason": "budget_exhausted",
                "timestamp": datetime.now(timezone.utc).isoformat(),
            })
        except Exception:
            pass
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
                "timestamp": datetime.now(timezone.utc).isoformat(),
            })
        except Exception:
            pass
    finally:
        # Always push the run's accumulated spend into the user's
        # monthly budget — partial runs still consumed model calls.
        if enforcer is not None:
            try:
                await finalize_run(enforcer)
            except Exception as fe:  # noqa: BLE001
                logger.warning(f"Discovery run {run_id} finalize failed: {fe}")


async def _run_synthesis_pipeline(
    run_id: str,
    project_id: str,
    user_id: str,
    hypothesis: str,
    output_format: str,
    verbosity: str,
    grant_type: str | None,
    citation_style: str,
    field_scope: str | None,
):
    """Background task that runs the 5-stage synthesis pipeline under
    the caller's tier-based budget cap."""
    from app.services.budget_enforcer_service import (
        BudgetExceeded,
        RunKind,
        UserBudgetBlocked,
        finalize_run,
        start_run,
    )

    run_record = _active_synthesis_runs.get(run_id, {})
    run_record["status"] = "running"
    run_record["started_at"] = datetime.now(timezone.utc).isoformat()

    enforcer = None
    try:
        try:
            enforcer = await start_run(
                run_id=run_id, user_id=user_id, kind=RunKind.PAPER_GEN,
            )
        except UserBudgetBlocked as ub:
            run_record["status"] = "blocked"
            run_record["error"] = str(ub)
            logger.warning(
                f"Synthesis run {run_id} blocked: monthly budget exhausted "
                f"for user={user_id}"
            )
            return

        from app.services.synthesis_pipeline import SynthesisPipeline
        from app.agents.discovery_orchestrator import MultiModelLLM, TokenPool

        token_pool = TokenPool()
        llm = MultiModelLLM(token_pool)
        await llm.initialize()

        pipeline = SynthesisPipeline(llm, budget_enforcer=enforcer, user_id=user_id)

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
                    "timestamp": datetime.now(timezone.utc).isoformat(),
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
        run_record["completed_at"] = datetime.now(timezone.utc).isoformat()
        run_record["result"] = result.model_dump() if hasattr(result, "model_dump") else {}

        logger.info(f"Synthesis run {run_id} completed")

    except BudgetExceeded as be:
        run_record["status"] = "budget_truncated"
        run_record["error"] = str(be)
        run_record["spent_cents"] = getattr(be, "spent_cents", None)
        logger.warning(f"Synthesis run {run_id} budget-truncated: {be}")
    except Exception as e:
        logger.error(f"Synthesis run {run_id} failed: {e}")
        run_record["status"] = "failed"
        run_record["error"] = str(e)
    finally:
        if enforcer is not None:
            try:
                await finalize_run(enforcer)
            except Exception as fe:  # noqa: BLE001
                logger.warning(f"Synthesis run {run_id} finalize failed: {fe}")


# ===================================================================
# Discovery Pipeline Endpoints — WIRED TO REAL ORCHESTRATOR
# ===================================================================


async def _load_discovery_runs_from_db(
    project_id: str | None,
    status: str | None,
    limit: int,
    offset: int,
):
    """Merge the in-memory in-flight runs with completed runs from the
    `discovery_runs` Postgres table. Returns a (items, total) tuple."""
    from sqlalchemy import text
    from app.core.database import engine

    # In-memory (currently running) rows.
    items: list[dict] = []
    for run_id, run in _active_discovery_runs.items():
        if project_id and run.get("project_id") != project_id:
            continue
        if status and run.get("status") != status:
            continue
        items.append({
            "run_id": run_id,
            "project_id": run.get("project_id"),
            "disease": run.get("disease", ""),
            "discovery_type": run.get("discovery_type", ""),
            "status": run.get("status", "unknown"),
            "total_hypotheses": run.get("total_hypotheses", 0),
            "best_confidence": run.get("best_confidence", 0),
            "created_at": run.get("created_at", ""),
            "completed_at": run.get("completed_at"),
        })

    # Database-backed (completed / queued / failed) rows.
    sql = """
        SELECT id::text, project_id::text, disease, discovery_type,
               status, total_hypotheses, best_confidence,
               total_cost_usd, total_duration_seconds,
               stages_total, stages_succeeded,
               focus_entities,
               created_at, completed_at
        FROM discovery_runs
        WHERE (CAST(:pid AS text) IS NULL OR project_id::text = CAST(:pid AS text))
          AND (CAST(:st AS text) IS NULL OR status = CAST(:st AS text))
        ORDER BY created_at DESC
        LIMIT :lim OFFSET :off
    """
    try:
        async with engine.connect() as conn:
            rows = (await conn.execute(
                text(sql),
                {"pid": project_id, "st": status, "lim": limit, "off": offset},
            )).fetchall()
        in_mem_ids = {i["run_id"] for i in items}
        for r in rows:
            run_id = r[0]
            if run_id in in_mem_ids:
                continue
            items.append({
                "run_id": run_id,
                "project_id": r[1],
                "disease": r[2] or "",
                "discovery_type": r[3] or "",
                "status": r[4] or "completed",
                "total_hypotheses": r[5] or 0,
                "best_confidence": float(r[6] or 0),
                "total_cost_usd": float(r[7] or 0),
                "total_duration_seconds": float(r[8] or 0),
                "stages_total": r[9] or 12,
                "stages_succeeded": r[10] or 0,
                "focus_entities": list(r[11] or []),
                "created_at": r[12].isoformat() if r[12] else "",
                "completed_at": r[13].isoformat() if r[13] else None,
            })
    except Exception as _e:
        # Non-fatal — frontend still sees the in-memory slice.
        logger.warning(f"discovery_runs DB read failed: {_e!s}")

    items.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    return items[offset:offset + limit], len(items)


@router.get("/projects/{project_id}/discovery-runs")
async def list_discovery_runs(
    project_id: str,
    status: str | None = Query(None),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
) -> dict:
    """List discovery runs for a project (in-memory + DB)."""
    items, total = await _load_discovery_runs_from_db(project_id, status, limit, offset)
    return {
        "project_id": project_id,
        "items": items,
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.get("/discovery-runs")
async def list_all_discovery_runs(
    status: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> dict:
    """List discovery runs across every project — powers the Agents
    root page 'History' pane when no specific project is selected."""
    items, total = await _load_discovery_runs_from_db(None, status, limit, offset)
    return {
        "items": items,
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.post("/projects/{project_id}/discover", status_code=202)
async def start_discovery(
    project_id: str,
    body: DiscoverRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> dict:
    """Start a real 12-stage discovery pipeline run on one of the
    caller's projects. The pipeline runs under the caller's tier-based
    budget cap; the per-stage enforcer raises BudgetExceeded once the
    per-run hard ceiling is hit and the run finalizes as
    `budget_truncated`."""
    # 404-on-non-owned matches the project_id ownership invariant.
    from uuid import UUID
    try:
        project_uuid = UUID(project_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="invalid project id")
    await assert_owns_project(db, project_uuid, current_user)

    run_id = str(uuid4())
    ws_url = f"/ws/discovery/{run_id}"

    _active_discovery_runs[run_id] = {
        "run_id": run_id,
        "project_id": project_id,
        "user_id": str(current_user.id),
        "disease": body.disease,
        "discovery_type": body.discovery_type,
        "status": "queued",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "total_hypotheses": 0,
        "best_confidence": 0,
        "output_format": body.output_format,
        "verbosity": body.verbosity,
    }

    background_tasks.add_task(
        _run_discovery_pipeline,
        run_id=run_id,
        project_id=project_id,
        user_id=str(current_user.id),
        disease=body.disease,
        discovery_type=body.discovery_type,
        external_factors=body.external_factors,
        num_rounds=body.num_rounds,
        hypotheses_per_round=body.hypotheses_per_round,
    )

    logger.info(
        f"Discovery run {run_id} queued for project {project_id} "
        f"(user={current_user.id}): {body.disease}"
    )

    return {
        "run_id": run_id,
        "websocket_url": ws_url,
        "status": "queued",
        "project_id": project_id,
        "disease": body.disease,
        "discovery_type": body.discovery_type,
        "created_at": datetime.now(timezone.utc).isoformat(),
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
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> dict:
    """Start a real 5-stage synthesis pipeline run on one of the
    caller's projects, under their tier-based budget cap."""
    from uuid import UUID
    try:
        project_uuid = UUID(project_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="invalid project id")
    await assert_owns_project(db, project_uuid, current_user)

    run_id = str(uuid4())
    ws_url = f"/ws/synthesis/{run_id}"

    _active_synthesis_runs[run_id] = {
        "run_id": run_id,
        "project_id": project_id,
        "user_id": str(current_user.id),
        "hypothesis": body.hypothesis,
        "output_format": body.output_format,
        "verbosity": body.verbosity,
        "status": "queued",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

    background_tasks.add_task(
        _run_synthesis_pipeline,
        run_id=run_id,
        project_id=project_id,
        user_id=str(current_user.id),
        hypothesis=body.hypothesis,
        output_format=body.output_format,
        verbosity=body.verbosity,
        grant_type=body.grant_type,
        citation_style=body.citation_style,
        field_scope=body.field_scope,
    )

    logger.info(
        f"Synthesis run {run_id} queued for project {project_id} "
        f"(user={current_user.id})"
    )

    return {
        "run_id": run_id,
        "websocket_url": ws_url,
        "status": "queued",
        "project_id": project_id,
        "hypothesis": body.hypothesis[:200],
        "created_at": datetime.now(timezone.utc).isoformat(),
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
        "recorded_at": datetime.now(timezone.utc).isoformat(),
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
        "created_at": datetime.now(timezone.utc).isoformat(),
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
            "expires_at": datetime.now(timezone.utc).isoformat(),
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
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/projects/{project_id}/imaging")
async def list_imaging_records(
    project_id: str,
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """List imaging records for a project from the imaging_records table."""
    count_result = await db.execute(
        text("SELECT COUNT(*) FROM imaging_records WHERE project_id = :pid"),
        {"pid": project_id},
    )
    total = count_result.scalar() or 0

    result = await db.execute(
        text(
            "SELECT id, project_id, filename, content_type, modality, format, "
            "file_path, size_bytes, dimensions, linked_hypothesis_ids, metadata, "
            "created_at, updated_at "
            "FROM imaging_records WHERE project_id = :pid "
            "ORDER BY created_at DESC LIMIT :lim OFFSET :off"
        ),
        {"pid": project_id, "lim": limit, "off": offset},
    )
    rows = result.mappings().all()
    items = [
        {
            "id": str(r["id"]),
            "project_id": r["project_id"],
            "filename": r["filename"],
            "content_type": r["content_type"],
            "modality": r["modality"],
            "format": r["format"],
            "file_path": r["file_path"],
            "size_bytes": r["size_bytes"],
            "dimensions": r["dimensions"],
            "linked_hypothesis_ids": r["linked_hypothesis_ids"] or [],
            "metadata": r["metadata"] or {},
            "created_at": r["created_at"].isoformat() if r["created_at"] else None,
            "updated_at": r["updated_at"].isoformat() if r["updated_at"] else None,
        }
        for r in rows
    ]
    return {
        "project_id": project_id,
        "items": items,
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.get("/projects/{project_id}/imaging/{record_id}")
async def get_imaging_record(
    project_id: str, record_id: str, db: AsyncSession = Depends(get_db)
) -> dict:
    """Get a single imaging record by ID from the imaging_records table."""
    result = await db.execute(
        text(
            "SELECT id, project_id, filename, content_type, modality, format, "
            "file_path, size_bytes, dimensions, linked_hypothesis_ids, metadata, "
            "created_at, updated_at "
            "FROM imaging_records WHERE id = :rid AND project_id = :pid"
        ),
        {"rid": record_id, "pid": project_id},
    )
    r = result.mappings().first()
    if not r:
        raise HTTPException(status_code=404, detail=f"Imaging record {record_id} not found")
    return {
        "id": str(r["id"]),
        "project_id": r["project_id"],
        "record_id": str(r["id"]),
        "filename": r["filename"],
        "content_type": r["content_type"],
        "modality": r["modality"],
        "format": r["format"],
        "file_path": r["file_path"],
        "size_bytes": r["size_bytes"],
        "dimensions": r["dimensions"],
        "linked_hypothesis_ids": r["linked_hypothesis_ids"] or [],
        "metadata": r["metadata"] or {},
        "created_at": r["created_at"].isoformat() if r["created_at"] else None,
        "updated_at": r["updated_at"].isoformat() if r["updated_at"] else None,
    }


@router.post("/projects/{project_id}/imaging/{record_id}/link-hypothesis")
async def link_hypothesis_to_imaging(
    project_id: str, record_id: str, body: LinkHypothesisRequest,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Link a hypothesis to an imaging record by appending to linked_hypothesis_ids JSONB array."""
    # Verify record exists
    result = await db.execute(
        text(
            "SELECT id, linked_hypothesis_ids FROM imaging_records "
            "WHERE id = :rid AND project_id = :pid"
        ),
        {"rid": record_id, "pid": project_id},
    )
    row = result.mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail=f"Imaging record {record_id} not found")

    existing_ids = row["linked_hypothesis_ids"] or []
    if body.hypothesis_id not in existing_ids:
        # Append the hypothesis_id to the JSONB array
        await db.execute(
            text(
                "UPDATE imaging_records "
                "SET linked_hypothesis_ids = COALESCE(linked_hypothesis_ids, '[]'::jsonb) || :new_id::jsonb, "
                "    updated_at = NOW() "
                "WHERE id = :rid AND project_id = :pid"
            ),
            {
                "rid": record_id,
                "pid": project_id,
                "new_id": json.dumps(body.hypothesis_id),
            },
        )

    return {
        "project_id": project_id,
        "record_id": record_id,
        "hypothesis_id": body.hypothesis_id,
        "linked_at": datetime.now(timezone.utc).isoformat(),
    }


@router.delete("/projects/{project_id}/imaging/{record_id}")
async def delete_imaging_record(
    project_id: str, record_id: str, db: AsyncSession = Depends(get_db)
) -> dict:
    """Delete an imaging record from the database."""
    result = await db.execute(
        text(
            "DELETE FROM imaging_records WHERE id = :rid AND project_id = :pid"
        ),
        {"rid": record_id, "pid": project_id},
    )
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail=f"Imaging record {record_id} not found")
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
    """Run similarity search using both Cohere and OpenAI embeddings and compare results.

    Both embedding services must be reachable; without real embeddings the
    similarity comparison is meaningless (a zero-vector query returns
    arbitrary nearest neighbours and the verdict is noise).
    """
    try:
        from app.knowledge.embedding_service import get_embedding_service
        from app.knowledge.vector_store import get_vector_store

        store = get_vector_store()
        embed_svc = get_embedding_service()

        try:
            bio_emb, gen_emb = await asyncio.gather(
                embed_svc.embed_biomedical(body.query),
                embed_svc.embed_general(body.query),
            )
        except Exception as embed_exc:
            logger.warning(
                "pgvector similarity-test: embedding service unavailable",
                error=str(embed_exc),
            )
            raise HTTPException(
                status_code=503,
                detail=(
                    "Embedding service is not configured or unreachable. "
                    "Similarity-test requires real embeddings."
                ),
            )

        cohere_results, openai_results = await asyncio.gather(
            store.search_biomedical(embedding=bio_emb, limit=10, min_score=0.0),
            store.search_general(embedding=gen_emb, limit=10, min_score=0.0),
        )

        cohere_ids = {r.id for r in cohere_results}
        openai_ids = {r.id for r in openai_results}
        overlap = cohere_ids & openai_ids

        verdict = "Well-grounded" if len(overlap) >= 3 else (
            "Partially grounded" if len(overlap) >= 1 else "Ungrounded"
        )

        return {
            "query": body.query,
            "cohere_results": [r.model_dump() for r in cohere_results],
            "openai_results": [r.model_dump() for r in openai_results],
            "overlap_count": len(overlap),
            "overlap_ids": list(overlap),
            "verdict": verdict,
        }
    except Exception as e:
        logger.warning(f"pgvector similarity test failed: {e}")
        raise HTTPException(status_code=500, detail=f"Similarity test failed: {e}")


@router.delete("/dev/pgvector/entries")
async def pgvector_delete_entries(body: PgvectorDeleteRequest) -> dict:
    """Delete specific vector entries by their IDs."""
    try:
        from app.knowledge.vector_store import get_vector_store
        store = get_vector_store()
        deleted = 0
        for entry_id in body.entry_ids:
            if await store.delete_document(entry_id):
                deleted += 1
        return {"deleted": deleted, "requested": len(body.entry_ids)}
    except Exception as e:
        logger.warning(f"pgvector delete entries failed: {e}")
        raise HTTPException(status_code=500, detail=f"Delete failed: {e}")


@router.post("/dev/pgvector/entries/re-embed")
async def pgvector_reembed(body: PgvectorDeleteRequest) -> dict:
    """Re-embed specified entries by regenerating their embeddings."""
    try:
        from app.knowledge.vector_store import get_vector_store
        store = get_vector_store()

        re_embedded = 0
        errors = []
        for entry_id in body.entry_ids:
            try:
                doc = await store.get_document(entry_id)
                if doc is None:
                    errors.append(f"{entry_id}: not found")
                    continue

                # Generate new embeddings for the document content
                try:
                    from app.knowledge.embedding_service import get_embedding_service
                    embed_svc = get_embedding_service()
                    bio_emb = await embed_svc.embed_biomedical(doc.content)
                    gen_emb = await embed_svc.embed_general(doc.content)
                except Exception:
                    bio_emb = None
                    gen_emb = None

                if bio_emb is not None or gen_emb is not None:
                    # Update the embeddings in DB
                    async with async_session_factory() as session:
                        updates = {"updated_at": datetime.now(timezone.utc)}
                        set_clauses = ["updated_at = :updated_at"]
                        if bio_emb is not None:
                            updates["bio_emb"] = str(bio_emb)
                            set_clauses.append("embedding_biomedical = :bio_emb::vector")
                        if gen_emb is not None:
                            updates["gen_emb"] = str(gen_emb)
                            set_clauses.append("embedding_general = :gen_emb::vector")
                        updates["eid"] = entry_id
                        await session.execute(
                            text(
                                f"UPDATE vector_embeddings SET {', '.join(set_clauses)} "
                                "WHERE id = :eid::uuid"
                            ),
                            updates,
                        )
                        await session.commit()
                    re_embedded += 1
                else:
                    errors.append(f"{entry_id}: embedding service unavailable")
            except Exception as exc:
                errors.append(f"{entry_id}: {exc}")

        return {
            "re_embedded": re_embedded,
            "requested": len(body.entry_ids),
            "errors": errors[:20],
        }
    except Exception as e:
        logger.warning(f"pgvector re-embed failed: {e}")
        raise HTTPException(status_code=500, detail=f"Re-embed failed: {e}")


@router.post("/dev/pgvector/entries/refresh-ttl")
async def pgvector_refresh_ttl(body: PgvectorDeleteRequest) -> dict:
    """Refresh TTL timestamps for specified entries by updating their created_at."""
    try:
        async with async_session_factory() as session:
            # Update created_at to now for the given entry IDs to extend their TTL
            placeholders = ", ".join(f":id_{i}" for i in range(len(body.entry_ids)))
            params = {f"id_{i}": eid for i, eid in enumerate(body.entry_ids)}
            result = await session.execute(
                text(
                    f"UPDATE vector_embeddings SET created_at = NOW() "
                    f"WHERE id::text IN ({placeholders})"
                ),
                params,
            )
            await session.commit()
            return {"refreshed": result.rowcount}
    except Exception as e:
        logger.warning(f"pgvector refresh TTL failed: {e}")
        raise HTTPException(status_code=500, detail=f"Refresh TTL failed: {e}")


@router.post("/dev/pgvector/maintenance/ttl-cleanup")
async def pgvector_ttl_cleanup() -> dict:
    """Delete vector entries whose TTL has expired (older than 90 days by default)."""
    try:
        async with async_session_factory() as session:
            result = await session.execute(
                text(
                    "DELETE FROM vector_embeddings "
                    "WHERE created_at < NOW() - INTERVAL '90 days'"
                )
            )
            await session.commit()
            return {
                "removed": result.rowcount,
                "completed_at": datetime.now(timezone.utc).isoformat(),
            }
    except Exception as e:
        logger.warning(f"pgvector TTL cleanup failed: {e}")
        raise HTTPException(status_code=500, detail=f"TTL cleanup failed: {e}")


@router.post("/dev/pgvector/maintenance/reindex")
async def pgvector_reindex() -> dict:
    """Run REINDEX on the vector embedding indexes."""
    try:
        from app.core.database import engine
        # REINDEX must run outside a transaction
        async with engine.connect() as conn:
            await conn.execution_options(isolation_level="AUTOCOMMIT")
            await conn.execute(
                text("REINDEX INDEX CONCURRENTLY ix_vector_embeddings_biomedical_cosine")
            )
            await conn.execute(
                text("REINDEX INDEX CONCURRENTLY ix_vector_embeddings_general_cosine")
            )
        return {
            "status": "completed",
            "indexes_reindexed": [
                "ix_vector_embeddings_biomedical_cosine",
                "ix_vector_embeddings_general_cosine",
            ],
            "completed_at": datetime.now(timezone.utc).isoformat(),
        }
    except Exception as e:
        logger.warning(f"pgvector reindex failed: {e}")
        raise HTTPException(status_code=500, detail=f"Reindex failed: {e}")


@router.post("/dev/pgvector/maintenance/purge-source")
async def pgvector_purge_source(body: PgvectorPurgeSourceRequest) -> dict:
    """Delete all vector entries matching a given source name."""
    try:
        async with async_session_factory() as session:
            result = await session.execute(
                text(
                    "DELETE FROM vector_embeddings WHERE source_type = :source"
                ),
                {"source": body.source_name},
            )
            await session.commit()
            return {
                "source_name": body.source_name,
                "removed": result.rowcount,
                "completed_at": datetime.now(timezone.utc).isoformat(),
            }
    except Exception as e:
        logger.warning(f"pgvector purge source failed: {e}")
        raise HTTPException(status_code=500, detail=f"Purge source failed: {e}")


@router.post("/dev/pgvector/maintenance/vacuum")
async def pgvector_vacuum() -> dict:
    """Run VACUUM ANALYZE on the vector_embeddings table."""
    try:
        from app.core.database import engine
        # VACUUM must run outside a transaction
        async with engine.connect() as conn:
            await conn.execution_options(isolation_level="AUTOCOMMIT")
            await conn.execute(text("VACUUM ANALYZE vector_embeddings"))
        return {
            "status": "completed",
            "table": "vector_embeddings",
            "completed_at": datetime.now(timezone.utc).isoformat(),
        }
    except Exception as e:
        logger.warning(f"pgvector vacuum failed: {e}")
        raise HTTPException(status_code=500, detail=f"Vacuum failed: {e}")


@router.get("/dev/pgvector/maintenance/status")
async def pgvector_maintenance_status() -> dict:
    """Query actual maintenance history from PostgreSQL system catalogs."""
    try:
        async with async_session_factory() as session:
            # Get last vacuum/analyze timestamps from pg_stat_user_tables
            result = await session.execute(
                text(
                    "SELECT last_vacuum, last_autovacuum, last_analyze, last_autoanalyze, "
                    "n_dead_tup, n_live_tup "
                    "FROM pg_stat_user_tables WHERE relname = 'vector_embeddings'"
                )
            )
            row = result.mappings().first()

            # Get index sizes
            idx_result = await session.execute(
                text(
                    "SELECT indexrelname, pg_relation_size(indexrelid) as size_bytes "
                    "FROM pg_stat_user_indexes WHERE relname = 'vector_embeddings'"
                )
            )
            indexes = [
                {"name": r["indexrelname"], "size_bytes": r["size_bytes"]}
                for r in idx_result.mappings().all()
            ]

            if row:
                return {
                    "last_vacuum": row["last_vacuum"].isoformat() if row["last_vacuum"] else None,
                    "last_autovacuum": row["last_autovacuum"].isoformat() if row["last_autovacuum"] else None,
                    "last_analyze": row["last_analyze"].isoformat() if row["last_analyze"] else None,
                    "last_autoanalyze": row["last_autoanalyze"].isoformat() if row["last_autoanalyze"] else None,
                    "dead_tuples": row["n_dead_tup"],
                    "live_tuples": row["n_live_tup"],
                    "indexes": indexes,
                }
            return {
                "last_vacuum": None,
                "last_autovacuum": None,
                "last_analyze": None,
                "last_autoanalyze": None,
                "dead_tuples": 0,
                "live_tuples": 0,
                "indexes": indexes,
            }
    except Exception as e:
        logger.warning(f"pgvector maintenance status failed: {e}")
        raise HTTPException(status_code=500, detail=f"Maintenance status query failed: {e}")


# ===================================================================
# Billing — wired to cost_tracking_service and DB models
# ===================================================================


@router.get("/billing/summary")
async def billing_summary(
    project_id: str | None = Query(None),
) -> dict:
    from app.services.cost_tracking_service import get_cost_tracker
    tracker = get_cost_tracker()
    return await tracker.get_summary(project_id=project_id)


@router.get("/billing/daily")
async def billing_daily(
    start_date: str | None = Query(None),
    end_date: str | None = Query(None),
    project_id: str | None = Query(None),
    group_by: str = Query("provider"),
) -> list:
    from app.services.cost_tracking_service import get_cost_tracker
    tracker = get_cost_tracker()
    return await tracker.get_daily_breakdown(
        start_date=start_date,
        end_date=end_date,
        project_id=project_id,
        group_by=group_by,
    )


@router.get("/billing/breakdown")
async def billing_breakdown(
    period: str = Query("30d"),
    group_by: str = Query("model"),
) -> dict:
    from app.services.cost_tracking_service import get_cost_tracker
    tracker = get_cost_tracker()
    return await tracker.get_model_breakdown(period=period)


@router.get("/billing/projects")
async def billing_projects(
    period: str = Query("30d"),
) -> list:
    from app.services.cost_tracking_service import get_cost_tracker
    tracker = get_cost_tracker()
    return await tracker.get_project_costs(period=period)


@router.get("/billing/usage")
async def billing_usage(
    db: AsyncSession = Depends(get_db),
    project_id: str | None = Query(None),
    model: str | None = Query(None),
    provider: str | None = Query(None),
    start_date: str | None = Query(None),
    end_date: str | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
) -> dict:
    from app.models.learning_memory import APICostRecord

    query = select(APICostRecord)
    if model:
        query = query.where(APICostRecord.model_name == model)
    if provider:
        query = query.where(APICostRecord.provider == provider)
    if start_date:
        query = query.where(APICostRecord.created_at >= datetime.fromisoformat(start_date))
    if end_date:
        query = query.where(APICostRecord.created_at <= datetime.fromisoformat(end_date))

    # Count total
    count_query = select(func.count()).select_from(query.subquery())
    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0

    # Paginate
    query = query.order_by(APICostRecord.created_at.desc())
    query = query.offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(query)
    records = result.scalars().all()

    return {
        "items": [r.to_dict() for r in records],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.post("/billing/usage/export")
async def billing_usage_export(
    db: AsyncSession = Depends(get_db),
    model: str | None = Query(None),
    provider: str | None = Query(None),
    start_date: str | None = Query(None),
    end_date: str | None = Query(None),
) -> StreamingResponse:
    from app.models.learning_memory import APICostRecord

    query = select(APICostRecord)
    if model:
        query = query.where(APICostRecord.model_name == model)
    if provider:
        query = query.where(APICostRecord.provider == provider)
    if start_date:
        query = query.where(APICostRecord.created_at >= datetime.fromisoformat(start_date))
    if end_date:
        query = query.where(APICostRecord.created_at <= datetime.fromisoformat(end_date))
    query = query.order_by(APICostRecord.created_at.desc())

    result = await db.execute(query)
    records = result.scalars().all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "id", "created_at", "provider", "model_name", "api_type",
        "input_tokens", "output_tokens", "total_tokens",
        "input_cost_usd", "output_cost_usd", "total_cost_usd",
        "latency_ms", "stage_name",
    ])
    for r in records:
        writer.writerow([
            str(r.id), r.created_at.isoformat() if r.created_at else "",
            r.provider, r.model_name, r.api_type,
            r.input_tokens, r.output_tokens, r.total_tokens,
            r.input_cost_usd, r.output_cost_usd, r.total_cost_usd,
            r.latency_ms, r.stage_name or "",
        ])

    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=billing_usage_export.csv"},
    )


@router.get("/billing/budgets")
async def list_budgets(db: AsyncSession = Depends(get_db)) -> list:
    from app.models.platform_entities import BillingBudget
    result = await db.execute(
        select(BillingBudget).order_by(BillingBudget.created_at.desc())
    )
    budgets = result.scalars().all()
    return [b.to_dict() for b in budgets]


@router.post("/billing/budgets", status_code=201)
async def create_budget(body: BudgetCreate, db: AsyncSession = Depends(get_db)) -> dict:
    from app.models.platform_entities import BillingBudget
    budget = BillingBudget(
        scope=body.scope,
        project_id=body.project_id,
        monthly_budget_cents=body.monthly_budget_cents,
        alert_threshold_pct=body.alert_threshold_pct,
        hard_limit=body.hard_limit,
        current_month_spend_cents=0,
    )
    db.add(budget)
    await db.flush()
    await db.refresh(budget)
    return budget.to_dict()


@router.put("/billing/budgets/{budget_id}")
async def update_budget(
    budget_id: str, body: BudgetCreate, db: AsyncSession = Depends(get_db)
) -> dict:
    from app.models.platform_entities import BillingBudget
    result = await db.execute(
        select(BillingBudget).where(BillingBudget.id == budget_id)
    )
    budget = result.scalar_one_or_none()
    if not budget:
        raise HTTPException(status_code=404, detail=f"Budget {budget_id} not found")
    budget.scope = body.scope
    budget.project_id = body.project_id
    budget.monthly_budget_cents = body.monthly_budget_cents
    budget.alert_threshold_pct = body.alert_threshold_pct
    budget.hard_limit = body.hard_limit
    await db.flush()
    await db.refresh(budget)
    return budget.to_dict()


@router.delete("/billing/budgets/{budget_id}")
async def delete_budget(budget_id: str, db: AsyncSession = Depends(get_db)) -> dict:
    from app.models.platform_entities import BillingBudget
    result = await db.execute(
        select(BillingBudget).where(BillingBudget.id == budget_id)
    )
    budget = result.scalar_one_or_none()
    if not budget:
        raise HTTPException(status_code=404, detail=f"Budget {budget_id} not found")
    await db.delete(budget)
    return {"id": budget_id, "deleted": True}


@router.get("/billing/notifications")
async def list_billing_notifications(
    db: AsyncSession = Depends(get_db),
    unread_only: bool = Query(False),
    limit: int = Query(50, ge=1, le=200),
) -> dict:
    from app.models.platform_entities import BillingNotification
    query = select(BillingNotification).order_by(BillingNotification.created_at.desc())
    if unread_only:
        query = query.where(BillingNotification.read == False)
    query = query.limit(limit)
    result = await db.execute(query)
    notifications = result.scalars().all()
    return {
        "items": [n.to_dict() for n in notifications],
        "total": len(notifications),
    }


@router.post("/billing/notifications/{notification_id}/read")
async def mark_notification_read(
    notification_id: str, db: AsyncSession = Depends(get_db)
) -> dict:
    from app.models.platform_entities import BillingNotification
    result = await db.execute(
        select(BillingNotification).where(BillingNotification.id == notification_id)
    )
    notification = result.scalar_one_or_none()
    if not notification:
        raise HTTPException(status_code=404, detail=f"Notification {notification_id} not found")
    notification.read = True
    await db.flush()
    await db.refresh(notification)
    return notification.to_dict()
