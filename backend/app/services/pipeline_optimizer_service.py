"""
Pipeline Optimization Engine — Learning-Based Pipeline Tuning

Analyzes learning memory, stage performance aggregates, and feedback data
to generate and apply optimizations to the 10-stage pipeline.

Key capabilities:
- Analyze per-model, per-stage historical performance
- Recommend model swaps for underperforming stages
- Adjust temperature/token allocations based on outcomes
- Generate prompt pattern recommendations
- Apply and track optimization impact over time
- Roll back ineffective optimizations
"""

import json
from typing import Any, Optional

from sqlalchemy import desc, func, select

from app.core.database import async_session_factory
from app.core.logging import get_logger
from app.models.learning_memory import (
    HypothesisFeedback,
    OptimizationAction,
    PipelineOptimization,
    StageExecution,
    StagePerformanceAggregate,
)

logger = get_logger(__name__)


class PipelineOptimizerService:
    """Analyzes historical data and produces pipeline optimization recommendations.

    Uses a data-driven approach:
    1. Query stage performance aggregates
    2. Compare model performance at each stage
    3. Identify underperforming stages/models
    4. Generate specific, actionable recommendations
    5. Track applied optimizations and measure their impact
    """

    def __init__(self, session_factory=None):
        self._session_factory = session_factory or async_session_factory

    # ============== Analysis Methods ==============

    async def analyze_pipeline(self) -> dict[str, Any]:
        """Comprehensive pipeline analysis using all available data."""
        async with self._session_factory() as session:
            # Stage performance summary
            stage_perf = await session.execute(
                select(StagePerformanceAggregate)
                .where(StagePerformanceAggregate.disease.is_(None))
                .order_by(StagePerformanceAggregate.stage_number)
            )
            aggregates = stage_perf.scalars().all()

            stage_analysis = {}
            for agg in aggregates:
                key = agg.stage_number
                if key not in stage_analysis:
                    stage_analysis[key] = {
                        "stage_name": agg.stage_name,
                        "models": {},
                    }
                stage_analysis[key]["models"][agg.model_type] = {
                    "success_rate": agg.success_rate,
                    "avg_duration": agg.avg_duration_seconds,
                    "avg_cost": agg.avg_cost_usd,
                    "total_cost": agg.total_cost_usd,
                    "avg_grounding_ratio": agg.avg_grounding_ratio,
                    "avg_quality": agg.avg_output_quality,
                    "total_executions": agg.total_executions,
                    "content_filter_count": agg.content_filter_count,
                }

            # Best model per stage
            best_models = {}
            for stage_num, data in stage_analysis.items():
                best_model = None
                best_score = -1
                for model, metrics in data["models"].items():
                    # Composite score: quality * success_rate / cost
                    quality = metrics.get("avg_quality") or metrics["success_rate"]
                    cost = max(metrics["avg_cost"], 0.001)
                    score = quality * metrics["success_rate"] / cost
                    if score > best_score:
                        best_score = score
                        best_model = model
                best_models[stage_num] = {
                    "model": best_model,
                    "composite_score": best_score,
                }

            # Feedback analysis
            feedback_result = await session.execute(
                select(
                    HypothesisFeedback.best_stage,
                    HypothesisFeedback.worst_stage,
                    func.avg(HypothesisFeedback.overall_quality).label("avg_quality"),
                    func.count(HypothesisFeedback.id).label("count"),
                )
                .where(HypothesisFeedback.best_stage.isnot(None))
                .group_by(HypothesisFeedback.best_stage, HypothesisFeedback.worst_stage)
            )

            feedback_insights = []
            for row in feedback_result:
                feedback_insights.append({
                    "best_stage": row.best_stage,
                    "worst_stage": row.worst_stage,
                    "avg_quality": float(row.avg_quality or 0),
                    "feedback_count": int(row.count or 0),
                })

            # Content filter analysis
            filter_result = await session.execute(
                select(
                    StageExecution.stage_number,
                    StageExecution.model_type,
                    func.count(StageExecution.id).label("filter_count"),
                )
                .where(StageExecution.content_filter_triggered == True)
                .group_by(StageExecution.stage_number, StageExecution.model_type)
            )

            content_filter_hotspots = [
                {
                    "stage": row.stage_number,
                    "model": row.model_type,
                    "filter_count": int(row.filter_count or 0),
                }
                for row in filter_result
            ]

            return {
                "stage_analysis": stage_analysis,
                "best_models_per_stage": best_models,
                "feedback_insights": feedback_insights,
                "content_filter_hotspots": content_filter_hotspots,
                "total_stages_analyzed": len(stage_analysis),
            }

    async def generate_optimizations(self) -> list[dict[str, Any]]:
        """Generate concrete optimization recommendations."""
        analysis = await self.analyze_pipeline()
        recommendations = []

        stage_analysis = analysis.get("stage_analysis", {})
        best_models = analysis.get("best_models_per_stage", {})

        for stage_num, data in stage_analysis.items():
            stage_name = data["stage_name"]
            models = data["models"]

            if not models:
                continue

            # Find the currently most-used model at this stage
            most_used = max(models.items(), key=lambda x: x[1]["total_executions"])
            current_model = most_used[0]
            current_metrics = most_used[1]

            # Check if there's a better model
            best = best_models.get(stage_num, {})
            best_model = best.get("model")

            if best_model and best_model != current_model:
                best_metrics = models.get(best_model, {})
                if best_metrics:
                    improvement = (
                        (best_metrics.get("avg_quality", 0) or best_metrics["success_rate"])
                        - (current_metrics.get("avg_quality", 0) or current_metrics["success_rate"])
                    )
                    if improvement > 0.05:  # >5% quality improvement
                        recommendations.append({
                            "action": OptimizationAction.MODEL_SWAP.value,
                            "stage_number": stage_num,
                            "stage_name": stage_name,
                            "parameter_name": "model_type",
                            "old_value": current_model,
                            "new_value": best_model,
                            "reasoning": (
                                f"Stage {stage_num} ({stage_name}): {best_model} outperforms "
                                f"{current_model} by {improvement:.1%} in quality "
                                f"(cost: ${best_metrics['avg_cost']:.4f} vs ${current_metrics['avg_cost']:.4f})"
                            ),
                            "expected_improvement": improvement,
                            "confidence": min(current_metrics["total_executions"] / 20, 1.0),
                        })

            # Check for high content filter rates
            if current_metrics.get("content_filter_count", 0) > 0:
                filter_rate = current_metrics["content_filter_count"] / max(current_metrics["total_executions"], 1)
                if filter_rate > 0.1:  # >10% filter rate
                    recommendations.append({
                        "action": OptimizationAction.PROMPT_ADJUSTMENT.value,
                        "stage_number": stage_num,
                        "stage_name": stage_name,
                        "parameter_name": "prompt_sanitization",
                        "old_value": "standard",
                        "new_value": "aggressive",
                        "reasoning": (
                            f"Stage {stage_num} ({stage_name}): {filter_rate:.0%} content filter rate "
                            f"with {current_model}. Needs more aggressive prompt sanitization."
                        ),
                        "expected_improvement": filter_rate * 0.5,
                        "confidence": 0.8,
                    })

            # Check for low grounding ratios
            grounding = current_metrics.get("avg_grounding_ratio")
            if grounding is not None and grounding < 0.5:
                recommendations.append({
                    "action": OptimizationAction.GROUNDING_THRESHOLD.value,
                    "stage_number": stage_num,
                    "stage_name": stage_name,
                    "parameter_name": "grounding_threshold",
                    "old_value": 0.4,
                    "new_value": max(0.2, grounding - 0.1),
                    "reasoning": (
                        f"Stage {stage_num} ({stage_name}): Low grounding ratio ({grounding:.0%}). "
                        f"Lower threshold to prevent excessive claim rejection, or increase evidence injection."
                    ),
                    "expected_improvement": 0.1,
                    "confidence": 0.6,
                })

        return recommendations

    async def apply_optimization(
        self,
        action: str,
        target_stage: int = None,
        target_model: str = None,
        target_disease: str = None,
        parameter_name: str = "",
        old_value: Any = None,
        new_value: Any = None,
        reasoning: str = "",
        expected_improvement: str = "",
        runs_analyzed: int = 0,
    ) -> str:
        """Record an applied optimization for tracking."""
        async with self._session_factory() as session:
            async with session.begin():
                opt = PipelineOptimization(
                    trigger="learning_memory_analysis",
                    analysis_basis=reasoning,
                    runs_analyzed=runs_analyzed,
                    action=OptimizationAction(action),
                    target_stage=target_stage,
                    target_model=target_model,
                    target_disease=target_disease,
                    parameter_name=parameter_name,
                    old_value=json.loads(json.dumps(old_value)) if old_value is not None else {},
                    new_value=json.loads(json.dumps(new_value)) if new_value is not None else {},
                    expected_improvement=expected_improvement,
                    applied=True,
                )
                session.add(opt)
                await session.flush()
                return str(opt.id)

    async def get_optimization_history(self, limit: int = 50) -> list[dict[str, Any]]:
        """Get optimization history."""
        async with self._session_factory() as session:
            result = await session.execute(
                select(PipelineOptimization)
                .order_by(desc(PipelineOptimization.created_at))
                .limit(limit)
            )
            opts = result.scalars().all()

            return [
                {
                    "id": str(o.id),
                    "action": o.action.value,
                    "target_stage": o.target_stage,
                    "target_model": o.target_model,
                    "parameter_name": o.parameter_name,
                    "old_value": o.old_value,
                    "new_value": o.new_value,
                    "reasoning": o.analysis_basis,
                    "expected_improvement": o.expected_improvement,
                    "actual_improvement": o.actual_improvement,
                    "applied": o.applied,
                    "reverted": o.reverted,
                    "runs_analyzed": o.runs_analyzed,
                    "created_at": o.created_at.isoformat() if o.created_at else None,
                }
                for o in opts
            ]

    async def revert_optimization(self, optimization_id: str, reason: str) -> bool:
        """Revert an applied optimization."""
        async with self._session_factory() as session:
            async with session.begin():
                opt = await session.get(PipelineOptimization, optimization_id)
                if not opt:
                    return False
                opt.reverted = True
                opt.revert_reason = reason
                return True

    async def get_stage_model_matrix(self) -> dict[str, Any]:
        """Get full stage x model performance matrix for visualization."""
        async with self._session_factory() as session:
            result = await session.execute(
                select(StagePerformanceAggregate)
                .where(StagePerformanceAggregate.disease.is_(None))
                .order_by(
                    StagePerformanceAggregate.stage_number,
                    StagePerformanceAggregate.model_type,
                )
            )
            aggregates = result.scalars().all()

            stages = set()
            models = set()
            matrix = {}

            for agg in aggregates:
                stages.add(agg.stage_number)
                models.add(agg.model_type)
                key = f"{agg.stage_number}_{agg.model_type}"
                matrix[key] = {
                    "stage_number": agg.stage_number,
                    "stage_name": agg.stage_name,
                    "model_type": agg.model_type,
                    "success_rate": agg.success_rate,
                    "avg_duration": agg.avg_duration_seconds,
                    "avg_cost": agg.avg_cost_usd,
                    "total_cost": agg.total_cost_usd,
                    "avg_grounding": agg.avg_grounding_ratio,
                    "avg_quality": agg.avg_output_quality,
                    "executions": agg.total_executions,
                }

            return {
                "stages": sorted(stages),
                "models": sorted(models),
                "matrix": matrix,
            }


# ============== Singleton ==============

_optimizer: Optional[PipelineOptimizerService] = None


def get_pipeline_optimizer() -> PipelineOptimizerService:
    """Get the singleton pipeline optimizer service."""
    global _optimizer
    if _optimizer is None:
        _optimizer = PipelineOptimizerService()
    return _optimizer
