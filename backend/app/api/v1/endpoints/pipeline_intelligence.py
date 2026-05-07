"""
Pipeline Intelligence API — Learning Memory, Cost Tracking, Benchmarks, and Optimization

Comprehensive REST API with full visualization data for:
- Learning memory state and analytics
- Per-API-call cost tracking with breakdowns and time series
- Retrospective benchmark management and execution
- Pipeline optimization recommendations and history
"""

from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.core.logging import get_logger
from app.core.auth import AUTH_REQUIRED

logger = get_logger(__name__)

router = APIRouter(prefix="/pipeline-intelligence", tags=["pipeline-intelligence"], dependencies=AUTH_REQUIRED)
# ============== Request/Response Models ==============


class FeedbackRequest(BaseModel):
    hypothesis_id: str
    feedback_type: str = "user_rating"
    overall_quality: float = Field(..., ge=0.0, le=1.0)
    discovery_run_id: Optional[str] = None
    reviewer: Optional[str] = None
    biological_plausibility: Optional[float] = Field(None, ge=0.0, le=1.0)
    evidence_strength: Optional[float] = Field(None, ge=0.0, le=1.0)
    novelty: Optional[float] = Field(None, ge=0.0, le=1.0)
    feasibility: Optional[float] = Field(None, ge=0.0, le=1.0)
    clinical_relevance: Optional[float] = Field(None, ge=0.0, le=1.0)
    mechanism_clarity: Optional[float] = Field(None, ge=0.0, le=1.0)
    reproducibility: Optional[float] = Field(None, ge=0.0, le=1.0)
    comments: Optional[str] = None
    strengths: list[str] = []
    weaknesses: list[str] = []
    suggested_improvements: list[str] = []
    best_stage: Optional[int] = None
    worst_stage: Optional[int] = None
    stage_contributions: dict[str, float] = {}
    matches_known_biology: Optional[bool] = None
    novel_insight: Optional[bool] = None
    actionable: Optional[bool] = None
    disease: Optional[str] = None
    round_number: Optional[int] = None


class BenchmarkTestCaseRequest(BaseModel):
    name: str
    disease: str
    discovery_type: str
    expected_title: str
    expected_mechanism: str
    expected_targets: list[str] = []
    expected_pathways: list[str] = []
    expected_evidence_pmids: list[str] = []
    expected_confidence_min: float = 0.5
    expected_key_claims: list[str] = []
    focus_entities: list[str] = []
    external_factors: list[dict] = []
    pathway_context: Optional[str] = None
    description: Optional[str] = None
    source_publication: Optional[str] = None
    source_pmid: Optional[str] = None
    difficulty: str = "medium"
    tags: list[str] = []
    mechanism_match_weight: float = 0.3
    target_match_weight: float = 0.2
    evidence_match_weight: float = 0.2
    confidence_match_weight: float = 0.15
    novelty_weight: float = 0.15


class BenchmarkRunRequest(BaseModel):
    test_case_ids: Optional[list[str]] = None
    disease_filter: Optional[str] = None
    name: Optional[str] = None
    description: Optional[str] = None


class OptimizationApplyRequest(BaseModel):
    action: str
    target_stage: Optional[int] = None
    target_model: Optional[str] = None
    target_disease: Optional[str] = None
    parameter_name: str
    old_value: Any = None
    new_value: Any = None
    reasoning: str = ""
    expected_improvement: str = ""


# ============== Learning Memory Endpoints ==============


@router.get("/learning/stats")
async def get_learning_stats():
    """Get comprehensive learning memory statistics."""
    from app.services.learning_memory_service import get_learning_memory
    lm = get_learning_memory()
    return await lm.get_learning_stats()


@router.get("/learning/model-profiles")
async def get_model_profiles(
    stage_number: Optional[int] = None,
    disease: Optional[str] = None,
):
    """Get model performance profiles for all stages/models."""
    from app.services.learning_memory_service import get_learning_memory
    lm = get_learning_memory()
    profiles = await lm.get_model_performance_profiles(stage_number, disease)
    return [
        {
            "model_type": p.model_type,
            "stage_number": p.stage_number,
            "success_rate": p.success_rate,
            "avg_duration": p.avg_duration,
            "avg_cost": p.avg_cost,
            "avg_grounding_ratio": p.avg_grounding_ratio,
            "avg_quality_score": p.avg_quality_score,
            "total_executions": p.total_executions,
            "confidence_impact": p.confidence_impact,
            "cost_efficiency": p.cost_efficiency,
        }
        for p in profiles
    ]


@router.get("/learning/recommendations")
async def get_optimization_recommendations():
    """Get learning-based optimization recommendations for the pipeline."""
    from app.services.learning_memory_service import get_learning_memory
    lm = get_learning_memory()
    recs = await lm.get_optimization_recommendations()
    return [
        {
            "stage_number": r.stage_number,
            "stage_name": r.stage_name,
            "current_model": r.current_model,
            "recommended_model": r.recommended_model,
            "recommended_temperature": r.recommended_temperature,
            "recommended_max_tokens": r.recommended_max_tokens,
            "reasoning": r.reasoning,
            "expected_improvement": r.expected_improvement,
            "confidence": r.confidence,
        }
        for r in recs
    ]


@router.post("/learning/feedback")
async def submit_feedback(request: FeedbackRequest):
    """Submit feedback on a hypothesis to feed learning memory."""
    from app.services.learning_memory_service import get_learning_memory
    lm = get_learning_memory()
    feedback_id = await lm.submit_feedback(**request.model_dump())
    return {"feedback_id": feedback_id, "status": "recorded"}


@router.get("/learning/export")
async def export_learning_memory():
    """Export learning memory state (backward-compatible with in-memory format)."""
    from app.services.learning_memory_service import get_learning_memory
    lm = get_learning_memory()
    return await lm.export_to_dict()


# ============== Cost Tracking Endpoints ==============


@router.get("/costs/summary")
async def get_cost_summary():
    """Get cumulative cost summary across all time with period breakdowns.

    Returns total cost, token counts, and call counts for all-time,
    last 24h, last 7d, and last 30d periods.
    """
    from app.services.cost_tracking_service import get_cost_tracker
    tracker = get_cost_tracker()
    return await tracker.get_cumulative_cost()


@router.get("/costs/run/{run_id}")
async def get_run_cost_breakdown(run_id: str):
    """Get complete cost breakdown for a discovery run.

    Returns costs broken down by provider, model, stage, category, and round.
    Full visualization data for pie charts, bar charts, and tables.
    """
    from app.services.cost_tracking_service import get_cost_tracker
    tracker = get_cost_tracker()
    return await tracker.get_run_cost_breakdown(run_id)


@router.get("/costs/time-series")
async def get_cost_time_series(
    days: int = Query(30, ge=1, le=365),
    granularity: str = Query("day", pattern="^(hour|day|week)$"),
):
    """Get cost time series for line/area chart visualization.

    Returns cost and token data bucketed by hour/day/week.
    """
    from app.services.cost_tracking_service import get_cost_tracker
    tracker = get_cost_tracker()
    return await tracker.get_cost_time_series(days, granularity)


@router.get("/costs/model-comparison")
async def get_model_cost_comparison():
    """Get cost comparison across all models.

    Returns per-model total cost, average cost per call, latency,
    and token usage for bar/radar chart visualization.
    """
    from app.services.cost_tracking_service import get_cost_tracker
    tracker = get_cost_tracker()
    return await tracker.get_model_cost_comparison()


@router.get("/costs/stage-heatmap")
async def get_stage_cost_heatmap():
    """Get stage x model cost heatmap data.

    Returns a matrix of cost/latency data indexed by (stage, model)
    for heatmap visualization.
    """
    from app.services.cost_tracking_service import get_cost_tracker
    tracker = get_cost_tracker()
    return await tracker.get_stage_cost_heatmap()


@router.get("/costs/recent")
async def get_recent_api_calls(
    limit: int = Query(50, ge=1, le=500),
    run_id: Optional[str] = None,
):
    """Get recent API calls for real-time monitoring.

    Returns individual API call records with costs and latency.
    """
    from app.services.cost_tracking_service import get_cost_tracker
    tracker = get_cost_tracker()
    return await tracker.get_recent_calls(limit, run_id)


@router.get("/costs/pricing")
async def get_current_pricing():
    """Get current model pricing configuration."""
    from app.services.cost_tracking_service import CURRENT_PRICING, BIOMEDICAL_API_PRICING
    return {
        "llm_pricing": {
            f"{provider}/{model}": {
                "input_per_million": prices["input"],
                "output_per_million": prices["output"],
                "cached_input_per_million": prices.get("cached_input", 0),
            }
            for (provider, model), prices in CURRENT_PRICING.items()
        },
        "biomedical_api_pricing": BIOMEDICAL_API_PRICING,
    }


@router.post("/costs/sync-pricing")
async def sync_pricing_to_db():
    """Sync current pricing to database for audit trail."""
    from app.services.cost_tracking_service import get_cost_tracker
    tracker = get_cost_tracker()
    count = await tracker.sync_pricing_to_db()
    return {"synced_records": count}


# ============== Benchmark Endpoints ==============


@router.post("/benchmarks/test-cases")
async def create_benchmark_test_case(request: BenchmarkTestCaseRequest):
    """Create a new benchmark test case.

    Test cases define known-good discoveries that the pipeline should be able
    to reproduce. Populate these with published/validated research findings.
    """
    from app.services.benchmark_service import get_benchmark_service
    svc = get_benchmark_service()
    tc_id = await svc.create_test_case(**request.model_dump())
    return {"test_case_id": tc_id, "status": "created"}


@router.get("/benchmarks/test-cases")
async def list_benchmark_test_cases(
    disease: Optional[str] = None,
    status: str = "active",
    limit: int = Query(100, ge=1, le=500),
):
    """List benchmark test cases."""
    from app.services.benchmark_service import get_benchmark_service
    svc = get_benchmark_service()
    return await svc.list_test_cases(disease, status, limit)


@router.get("/benchmarks/test-cases/{test_case_id}")
async def get_benchmark_test_case(test_case_id: str):
    """Get a benchmark test case with full details."""
    from app.services.benchmark_service import get_benchmark_service
    svc = get_benchmark_service()
    tc = await svc.get_test_case(test_case_id)
    if not tc:
        raise HTTPException(status_code=404, detail="Test case not found")
    return tc


@router.put("/benchmarks/test-cases/{test_case_id}")
async def update_benchmark_test_case(test_case_id: str, updates: dict):
    """Update a benchmark test case."""
    from app.services.benchmark_service import get_benchmark_service
    svc = get_benchmark_service()
    success = await svc.update_test_case(test_case_id, updates)
    if not success:
        raise HTTPException(status_code=404, detail="Test case not found")
    return {"status": "updated"}


@router.delete("/benchmarks/test-cases/{test_case_id}")
async def delete_benchmark_test_case(test_case_id: str):
    """Delete a benchmark test case."""
    from app.services.benchmark_service import get_benchmark_service
    svc = get_benchmark_service()
    success = await svc.delete_test_case(test_case_id)
    if not success:
        raise HTTPException(status_code=404, detail="Test case not found")
    return {"status": "deleted"}


@router.post("/benchmarks/runs")
async def start_benchmark_run(request: BenchmarkRunRequest):
    """Start a new benchmark run.

    Runs the full 10-stage pipeline against selected test cases using real
    API calls. This is a long-running operation — the run executes
    asynchronously and results can be polled.
    """
    from app.services.benchmark_service import get_benchmark_service
    svc = get_benchmark_service()
    try:
        run_id = await svc.start_benchmark_run(
            test_case_ids=request.test_case_ids,
            disease_filter=request.disease_filter,
            name=request.name,
            description=request.description,
        )
        return {"benchmark_run_id": run_id, "status": "running"}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/benchmarks/runs")
async def list_benchmark_runs(limit: int = Query(20, ge=1, le=100)):
    """List recent benchmark runs."""
    from app.services.benchmark_service import get_benchmark_service
    svc = get_benchmark_service()
    return await svc.list_benchmark_runs(limit)


@router.get("/benchmarks/runs/{run_id}")
async def get_benchmark_run(run_id: str):
    """Get a benchmark run with all results."""
    from app.services.benchmark_service import get_benchmark_service
    svc = get_benchmark_service()
    run = await svc.get_benchmark_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Benchmark run not found")
    return run


@router.get("/benchmarks/trend")
async def get_benchmark_trend():
    """Get benchmark score trend over time for line chart visualization."""
    from app.services.benchmark_service import get_benchmark_service
    svc = get_benchmark_service()
    return await svc.get_benchmark_trend()


# ============== Pipeline Optimization Endpoints ==============


@router.get("/optimization/analysis")
async def analyze_pipeline():
    """Comprehensive pipeline analysis using all historical data.

    Returns per-stage model performance, best models, content filter hotspots,
    and feedback insights.
    """
    from app.services.pipeline_optimizer_service import get_pipeline_optimizer
    opt = get_pipeline_optimizer()
    return await opt.analyze_pipeline()


@router.get("/optimization/recommendations")
async def get_pipeline_optimizations():
    """Generate concrete optimization recommendations based on data analysis.

    Returns actionable recommendations for model swaps, parameter adjustments,
    and prompt improvements.
    """
    from app.services.pipeline_optimizer_service import get_pipeline_optimizer
    opt = get_pipeline_optimizer()
    return await opt.generate_optimizations()


@router.post("/optimization/apply")
async def apply_optimization(request: OptimizationApplyRequest):
    """Record an applied optimization for tracking and impact measurement."""
    from app.services.pipeline_optimizer_service import get_pipeline_optimizer
    opt = get_pipeline_optimizer()
    opt_id = await opt.apply_optimization(**request.model_dump())
    return {"optimization_id": opt_id, "status": "applied"}


@router.get("/optimization/history")
async def get_optimization_history(limit: int = Query(50, ge=1, le=200)):
    """Get optimization history with impact tracking."""
    from app.services.pipeline_optimizer_service import get_pipeline_optimizer
    opt = get_pipeline_optimizer()
    return await opt.get_optimization_history(limit)


@router.post("/optimization/{optimization_id}/revert")
async def revert_optimization(optimization_id: str, reason: str = ""):
    """Revert an applied optimization."""
    from app.services.pipeline_optimizer_service import get_pipeline_optimizer
    opt = get_pipeline_optimizer()
    success = await opt.revert_optimization(optimization_id, reason)
    if not success:
        raise HTTPException(status_code=404, detail="Optimization not found")
    return {"status": "reverted"}


@router.get("/optimization/stage-model-matrix")
async def get_stage_model_matrix():
    """Get full stage x model performance matrix for heatmap/table visualization.

    Returns success rate, duration, cost, and quality for every
    (stage, model) combination that has been executed.
    """
    from app.services.pipeline_optimizer_service import get_pipeline_optimizer
    opt = get_pipeline_optimizer()
    return await opt.get_stage_model_matrix()


# ============== Dashboard Composite Endpoint ==============


@router.get("/dashboard")
async def get_pipeline_intelligence_dashboard():
    """Composite endpoint returning all data needed for the full pipeline intelligence dashboard.

    Combines learning stats, cost summary, recent benchmark trends,
    and top optimization recommendations into a single response.
    """
    from app.services.cost_tracking_service import get_cost_tracker
    from app.services.learning_memory_service import get_learning_memory
    from app.services.pipeline_optimizer_service import get_pipeline_optimizer

    lm = get_learning_memory()
    tracker = get_cost_tracker()
    opt = get_pipeline_optimizer()

    try:
        learning_stats = await lm.get_learning_stats()
    except Exception:
        learning_stats = {}

    try:
        cost_summary = await tracker.get_cumulative_cost()
    except Exception:
        cost_summary = {}

    try:
        model_comparison = await tracker.get_model_cost_comparison()
    except Exception:
        model_comparison = []

    try:
        recommendations = await opt.generate_optimizations()
    except Exception:
        recommendations = []

    try:
        stage_matrix = await opt.get_stage_model_matrix()
    except Exception:
        stage_matrix = {}

    return {
        "learning": learning_stats,
        "costs": cost_summary,
        "model_comparison": model_comparison[:10],
        "recommendations": recommendations[:5],
        "stage_model_matrix": stage_matrix,
    }
