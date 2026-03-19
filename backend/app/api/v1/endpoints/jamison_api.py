"""
Jamison API Endpoints

Unified API surface for discovery, synthesis, imaging, pipeline intelligence,
data sources, pgvector management, and billing.
Returns mock data — will be wired to real services.
"""

from fastapi import APIRouter, HTTPException, BackgroundTasks, Query, UploadFile, File
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel
from typing import Literal
from uuid import uuid4
from datetime import datetime
import json
import os

router = APIRouter()


# === Pydantic Models ===


class DiscoveryConfigUpdate(BaseModel):
    discovery_type: str | None = None
    num_rounds: int | None = None
    hypotheses_per_round: int | None = None


class LabProfileUpdate(BaseModel):
    equipment: list[str] = []
    modalities: list[str] = []
    techniques: list[str] = []
    excluded_methods: list[str] = []
    filter_mode: Literal["strict", "permissive"] = "permissive"


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
    top_k: int = 10
    namespace: str | None = None


class PgvectorSimilarityTestRequest(BaseModel):
    text_a: str
    text_b: str


class PgvectorDeleteRequest(BaseModel):
    ids: list[str] | None = None
    namespace: str | None = None


class PgvectorPurgeSourceRequest(BaseModel):
    source: str


class DataSourceConfigUpdate(BaseModel):
    enabled: bool | None = None
    api_key: str | None = None
    rate_limit: int | None = None


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
        "description": "Placeholder hypothesis for API scaffolding.",
        "score": 0.85,
        "status": "generated",
        "created_at": datetime.utcnow().isoformat(),
    }


# ===================================================================
# Project Discovery Endpoints
# ===================================================================


@router.patch("/projects/{project_id}/discovery-config")
async def update_discovery_config(
    project_id: str, body: DiscoveryConfigUpdate
) -> dict:
    return {
        "project_id": project_id,
        "discovery_config": body.model_dump(exclude_none=True),
        "updated_at": datetime.utcnow().isoformat(),
    }


@router.patch("/projects/{project_id}/lab-profile")
async def update_lab_profile(project_id: str, body: LabProfileUpdate) -> dict:
    return {
        "project_id": project_id,
        "lab_profile": body.model_dump(),
        "updated_at": datetime.utcnow().isoformat(),
    }


@router.get("/projects/{project_id}/discovery-runs")
async def list_discovery_runs(
    project_id: str,
    status: str | None = Query(None),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
) -> dict:
    return {
        "project_id": project_id,
        "runs": [],
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
# Hypothesis Endpoints
# ===================================================================


@router.get("/projects/{project_id}/hypotheses")
async def list_hypotheses(
    project_id: str,
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
) -> dict:
    return {
        "project_id": project_id,
        "hypotheses": [],
        "total": 0,
        "limit": limit,
        "offset": offset,
    }


@router.get("/projects/{project_id}/hypotheses/{hypothesis_id}")
async def get_hypothesis(project_id: str, hypothesis_id: str) -> dict:
    h = _mock_hypothesis(hypothesis_id)
    h["project_id"] = project_id
    return h


@router.post("/hypotheses/{hypothesis_id}/feedback", status_code=201)
async def submit_feedback(hypothesis_id: str, body: FeedbackRequest) -> dict:
    return {
        "hypothesis_id": hypothesis_id,
        "feedback_id": str(uuid4()),
        "overall_quality": body.overall_quality,
        "recorded_at": datetime.utcnow().isoformat(),
    }


@router.post("/hypotheses/{hypothesis_id}/generate-paper", status_code=202)
async def generate_paper(
    hypothesis_id: str, background_tasks: BackgroundTasks
) -> dict:
    result = _run_stub("running")
    result["hypothesis_id"] = hypothesis_id
    return result


# ===================================================================
# Synthesis Endpoints
# ===================================================================


@router.get("/projects/{project_id}/synthesis-runs")
async def list_synthesis_runs(
    project_id: str,
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
) -> dict:
    return {
        "project_id": project_id,
        "synthesis_runs": [],
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
        "output_format": "narrative",
        "content": "Mock synthesis content.",
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
        "content": "Mock reformatted synthesis content.",
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
        "records": [],
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
        "content_type": "application/dicom",
        "status": "processed",
        "linked_hypotheses": [],
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
# Pipeline Intelligence
# ===================================================================


@router.get("/pipeline-intelligence/costs/summary")
async def pipeline_costs_summary(
    period: str = Query("30d"),
) -> dict:
    return {
        "period": period,
        "total_cost_cents": 0,
        "by_model": {},
        "by_pipeline": {},
        "generated_at": datetime.utcnow().isoformat(),
    }


@router.get("/pipeline-intelligence/models/performance")
async def pipeline_models_performance() -> dict:
    return {
        "models": [],
        "generated_at": datetime.utcnow().isoformat(),
    }


@router.get("/pipeline-intelligence/benchmarks")
async def pipeline_benchmarks() -> dict:
    return {
        "benchmarks": [],
        "generated_at": datetime.utcnow().isoformat(),
    }


# ===================================================================
# Methods Taxonomy
# ===================================================================

_TAXONOMY_PATH = os.path.join(
    os.path.dirname(__file__), "..", "..", "..", "..", "config", "methods_taxonomy.json"
)


@router.get("/config/methods-taxonomy")
async def get_methods_taxonomy() -> dict:
    resolved = os.path.normpath(_TAXONOMY_PATH)
    if not os.path.isfile(resolved):
        raise HTTPException(status_code=404, detail="methods_taxonomy.json not found")
    with open(resolved, "r") as f:
        return json.load(f)


# ===================================================================
# Data Sources
# ===================================================================


@router.get("/data-sources")
async def list_data_sources() -> dict:
    return {"data_sources": [], "total": 0}


@router.get("/data-sources/{name}/health")
async def data_source_health(name: str) -> dict:
    return {
        "name": name,
        "healthy": True,
        "latency_ms": 42,
        "checked_at": datetime.utcnow().isoformat(),
    }


@router.post("/data-sources/{name}/test")
async def test_data_source(name: str) -> dict:
    return {
        "name": name,
        "success": True,
        "message": "Connection successful",
        "tested_at": datetime.utcnow().isoformat(),
    }


@router.patch("/data-sources/{name}/config")
async def update_data_source_config(
    name: str, body: DataSourceConfigUpdate
) -> dict:
    return {
        "name": name,
        "config": body.model_dump(exclude_none=True),
        "updated_at": datetime.utcnow().isoformat(),
    }


# ===================================================================
# pgvector Management (dev)
# ===================================================================


@router.get("/dev/pgvector/stats")
async def pgvector_stats() -> dict:
    return {
        "total_entries": 0,
        "namespaces": {},
        "index_size_bytes": 0,
        "generated_at": datetime.utcnow().isoformat(),
    }


@router.post("/dev/pgvector/search")
async def pgvector_search(body: PgvectorSearchRequest) -> dict:
    return {
        "query": body.query,
        "top_k": body.top_k,
        "results": [],
    }


@router.post("/dev/pgvector/similarity-test")
async def pgvector_similarity_test(body: PgvectorSimilarityTestRequest) -> dict:
    return {
        "text_a": body.text_a,
        "text_b": body.text_b,
        "cosine_similarity": 0.0,
    }


@router.delete("/dev/pgvector/entries")
async def pgvector_delete_entries(body: PgvectorDeleteRequest) -> dict:
    return {"deleted": 0}


@router.post("/dev/pgvector/maintenance/ttl-cleanup")
async def pgvector_ttl_cleanup() -> dict:
    return {"removed": 0, "completed_at": datetime.utcnow().isoformat()}


@router.post("/dev/pgvector/maintenance/reindex")
async def pgvector_reindex() -> dict:
    return {"status": "started", "started_at": datetime.utcnow().isoformat()}


@router.post("/dev/pgvector/maintenance/purge-source")
async def pgvector_purge_source(body: PgvectorPurgeSourceRequest) -> dict:
    return {
        "source": body.source,
        "removed": 0,
        "completed_at": datetime.utcnow().isoformat(),
    }


@router.post("/dev/pgvector/maintenance/vacuum")
async def pgvector_vacuum() -> dict:
    return {"status": "started", "started_at": datetime.utcnow().isoformat()}


@router.get("/dev/pgvector/maintenance/status")
async def pgvector_maintenance_status() -> dict:
    return {
        "last_vacuum": None,
        "last_reindex": None,
        "last_ttl_cleanup": None,
    }


# ===================================================================
# Billing
# ===================================================================


@router.get("/billing/summary")
async def billing_summary(
    period: str = Query("current_month"),
) -> dict:
    return {
        "period": period,
        "total_cost_cents": 0,
        "budget_remaining_cents": None,
        "generated_at": datetime.utcnow().isoformat(),
    }


@router.get("/billing/daily")
async def billing_daily(
    days: int = Query(30, ge=1, le=365),
) -> dict:
    return {"days_requested": days, "daily": []}


@router.get("/billing/breakdown")
async def billing_breakdown(
    period: str = Query("current_month"),
    group_by: str = Query("model"),
) -> dict:
    return {"period": period, "group_by": group_by, "items": []}


@router.get("/billing/projects")
async def billing_projects() -> dict:
    return {"projects": []}


@router.get("/billing/usage")
async def billing_usage(
    period: str = Query("current_month"),
) -> dict:
    return {
        "period": period,
        "total_tokens_in": 0,
        "total_tokens_out": 0,
        "total_requests": 0,
    }


@router.get("/billing/budgets")
async def list_budgets() -> dict:
    return {"budgets": []}


@router.post("/billing/budgets", status_code=201)
async def create_budget(body: BudgetCreate) -> dict:
    return {
        "budget_id": str(uuid4()),
        "scope": body.scope,
        "project_id": body.project_id,
        "monthly_budget_cents": body.monthly_budget_cents,
        "alert_threshold_pct": body.alert_threshold_pct,
        "hard_limit": body.hard_limit,
        "created_at": datetime.utcnow().isoformat(),
    }


@router.put("/billing/budgets/{budget_id}")
async def update_budget(budget_id: str, body: BudgetCreate) -> dict:
    return {
        "budget_id": budget_id,
        "scope": body.scope,
        "project_id": body.project_id,
        "monthly_budget_cents": body.monthly_budget_cents,
        "alert_threshold_pct": body.alert_threshold_pct,
        "hard_limit": body.hard_limit,
        "updated_at": datetime.utcnow().isoformat(),
    }


@router.delete("/billing/budgets/{budget_id}")
async def delete_budget(budget_id: str) -> dict:
    return {"budget_id": budget_id, "deleted": True}


@router.get("/billing/notifications")
async def list_billing_notifications(
    unread_only: bool = Query(False),
    limit: int = Query(50, ge=1, le=200),
) -> dict:
    return {"notifications": [], "total": 0}


@router.post("/billing/notifications/{notification_id}/read")
async def mark_notification_read(notification_id: str) -> dict:
    return {
        "notification_id": notification_id,
        "read": True,
        "read_at": datetime.utcnow().isoformat(),
    }
