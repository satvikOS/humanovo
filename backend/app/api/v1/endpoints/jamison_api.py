"""
Jamison API Endpoints

New endpoints for discovery, synthesis, imaging, pgvector management,
and billing per Project Jamison v2 spec.

Routes that already exist in projects.py, config_endpoints.py,
data_sources.py, and pipeline_intelligence.py are NOT duplicated here.
"""

from fastapi import APIRouter, HTTPException, BackgroundTasks, Query, UploadFile, File
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Literal
from uuid import uuid4
from datetime import datetime
import json
import os

router = APIRouter()


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
# Helpers
# ---------------------------------------------------------------------------

def _run_stub(status: str = "running") -> dict:
    run_id = str(uuid4())
    return {
        "run_id": run_id,
        "websocket_url": f"/ws/runs/{run_id}",
        "status": status,
        "created_at": datetime.utcnow().isoformat(),
    }


def _mock_hypothesis(hypothesis_id: str | None = None) -> dict:
    hid = hypothesis_id or str(uuid4())
    return {
        "id": hid,
        "title": "Mock hypothesis",
        "summary": "Placeholder hypothesis for API scaffolding.",
        "mechanism": "",
        "confidence_score": None,
        "novelty_score": None,
        "feasibility_score": None,
        "impact_score": None,
        "required_methods": [],
        "key_citations": [],
        "fda_references": None,
        "clinical_trial_refs": None,
        "counter_arguments": [],
        "revisions": [],
        "translational_roadmap": None,
        "pipeline_trace": {},
        "round_number": 1,
        "hypothesis_index": 0,
        "created_at": datetime.utcnow().isoformat(),
    }


# ===================================================================
# Discovery Pipeline Endpoints (NEW — not in projects.py)
# ===================================================================


@router.get("/projects/{project_id}/discovery-runs")
async def list_discovery_runs(
    project_id: str,
    status: str | None = Query(None),
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


@router.post("/projects/{project_id}/discover", status_code=202)
async def start_discovery(
    project_id: str,
    body: DiscoverRequest,
    background_tasks: BackgroundTasks,
) -> dict:
    result = _run_stub("running")
    result["project_id"] = project_id
    result["disease"] = body.disease
    result["discovery_type"] = body.discovery_type
    return result


@router.post("/projects/{project_id}/synthesize", status_code=202)
async def start_synthesis(
    project_id: str,
    body: SynthesizeRequest,
    background_tasks: BackgroundTasks,
) -> dict:
    result = _run_stub("running")
    result["project_id"] = project_id
    result["hypothesis"] = body.hypothesis
    return result


@router.delete("/discovery-runs/{run_id}")
async def cancel_discovery_run(run_id: str) -> dict:
    return {"run_id": run_id, "status": "cancelled"}


# ===================================================================
# Hypothesis Endpoints (NEW — extends existing hypotheses.py)
# ===================================================================


@router.get("/projects/{project_id}/hypotheses")
async def list_project_hypotheses(
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


@router.get("/projects/{project_id}/hypotheses/{hypothesis_id}")
async def get_project_hypothesis(project_id: str, hypothesis_id: str) -> dict:
    h = _mock_hypothesis(hypothesis_id)
    h["project_id"] = project_id
    return h


@router.post("/hypotheses/{hypothesis_id}/feedback", status_code=201)
async def submit_hypothesis_feedback(hypothesis_id: str, body: FeedbackRequest) -> dict:
    return {
        "hypothesis_id": hypothesis_id,
        "feedback_id": str(uuid4()),
        "overall_quality": body.overall_quality,
        "recorded_at": datetime.utcnow().isoformat(),
    }


@router.post("/hypotheses/{hypothesis_id}/generate-paper", status_code=202)
async def generate_hypothesis_paper(
    hypothesis_id: str, background_tasks: BackgroundTasks
) -> dict:
    result = _run_stub("running")
    result["hypothesis_id"] = hypothesis_id
    return result


# ===================================================================
# Synthesis Run Endpoints (NEW)
# ===================================================================


@router.get("/projects/{project_id}/synthesis-runs")
async def list_synthesis_runs(
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


@router.get("/projects/{project_id}/synthesis-runs/{run_id}")
async def get_synthesis_run(project_id: str, run_id: str) -> dict:
    return {
        "project_id": project_id,
        "run_id": run_id,
        "status": "completed",
        "hypothesis": "",
        "output_format": "narrative",
        "verbosity": "standard",
        "result": None,
        "created_at": datetime.utcnow().isoformat(),
    }


@router.post("/projects/{project_id}/synthesis-runs/{run_id}/reformat")
async def reformat_synthesis(
    project_id: str, run_id: str, body: ReformatRequest
) -> dict:
    return {
        "project_id": project_id,
        "run_id": run_id,
        "output_format": body.output_format or "narrative",
        "verbosity": body.verbosity or "standard",
        "content": "Reformatted synthesis content.",
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
# Imaging Endpoints (NEW)
# ===================================================================


@router.post("/projects/{project_id}/imaging/upload", status_code=201)
async def upload_imaging(
    project_id: str, file: UploadFile = File(...)
) -> dict:
    record_id = str(uuid4())
    return {
        "project_id": project_id,
        "record_id": record_id,
        "filename": file.filename,
        "content_type": file.content_type,
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
        "filename": "mock_image.dcm",
        "format": "dicom",
        "modality": "MRI",
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
# pgvector Management (dev) — NEW
# ===================================================================


@router.get("/dev/pgvector/stats")
async def pgvector_stats() -> dict:
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
# Billing — NEW
# ===================================================================


@router.get("/billing/summary")
async def billing_summary(
    project_id: str | None = Query(None),
) -> dict:
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
    return []


@router.get("/billing/breakdown")
async def billing_breakdown(
    period: str = Query("30d"),
    group_by: str = Query("model"),
) -> dict:
    return {"period": period, "group_by": group_by, "items": []}


@router.get("/billing/projects")
async def billing_projects(
    period: str = Query("30d"),
) -> list:
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
