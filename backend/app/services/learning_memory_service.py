"""
Learning Memory Service — PostgreSQL-backed Persistent Learning

Replaces the in-memory LearningMemory class with full PostgreSQL persistence.
Learns from every discovery run to improve future pipeline performance.

Key capabilities:
- Persists path exploration outcomes across sessions
- Tracks per-model, per-stage, per-disease performance
- Computes optimization recommendations based on historical data
- Provides model performance rankings for dynamic model selection
- Feeds into the pipeline optimization engine
"""

import asyncio
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import Integer, and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import async_session_factory
from app.core.logging import get_logger
from app.models.learning_memory import (
    APICostRecord,
    DiscoveryRun,
    FeedbackType,
    HypothesisFeedback,
    LearningMemoryState,
    StageExecution,
    StageOutcome,
    StagePerformanceAggregate,
)

logger = get_logger(__name__)


@dataclass
class ModelPerformanceProfile:
    """Computed performance profile for a model at a specific stage."""
    model_type: str
    stage_number: int
    success_rate: float
    avg_duration: float
    avg_cost: float
    avg_grounding_ratio: float
    avg_quality_score: float
    total_executions: int
    confidence_impact: float
    cost_efficiency: float  # quality / cost ratio


@dataclass
class StageOptimizationRecommendation:
    """Recommendation for optimizing a pipeline stage."""
    stage_number: int
    stage_name: str
    current_model: str
    recommended_model: str | None
    recommended_temperature: float | None
    recommended_max_tokens: int | None
    reasoning: str
    expected_improvement: float
    confidence: float


class PersistentLearningMemory:
    """PostgreSQL-backed learning memory that persists across all sessions.

    This service replaces the in-memory LearningMemory class and adds:
    - Full PostgreSQL persistence for all path/relation/entity scores
    - Per-model performance tracking with statistical analysis
    - Per-stage effectiveness tracking
    - Disease-specific knowledge accumulation
    - Optimization recommendations based on historical data
    """

    def __init__(self, session_factory=None):
        self._session_factory = session_factory or async_session_factory
        self._cache: LearningMemoryState | None = None
        self._cache_lock = asyncio.Lock()
        self._model_profiles_cache: dict[str, ModelPerformanceProfile] = {}

    async def _get_or_create_state(
        self, session: AsyncSession, scope: str = "global", disease: str = None
    ) -> LearningMemoryState:
        """Get or create a learning memory state record."""
        conditions = [LearningMemoryState.scope == scope]
        if disease:
            conditions.append(LearningMemoryState.disease == disease)
        else:
            conditions.append(LearningMemoryState.disease.is_(None))

        result = await session.execute(
            select(LearningMemoryState).where(and_(*conditions)).limit(1)
        )
        state = result.scalar_one_or_none()

        if not state:
            state = LearningMemoryState(
                scope=scope,
                disease=disease,
                explored_paths=[],
                low_value_paths=[],
                high_value_paths={},
                relation_scores={},
                entity_pair_scores={},
                model_performance={},
                stage_effectiveness={},
                prompt_patterns={},
                disease_knowledge={},
                grounding_stats={},
                optimization_history=[],
                total_runs_incorporated=0,
                version=1,
            )
            session.add(state)
            await session.flush()

        return state

    # ============== Path Learning (replacing in-memory LearningMemory) ==============

    async def should_skip_path(self, path_hash: int, relations: list[str]) -> tuple[bool, str]:
        """Check if a path should be skipped based on persistent learning."""
        async with self._session_factory() as session:
            state = await self._get_or_create_state(session)

            if path_hash in (state.explored_paths or []):
                return True, "Already explored in previous session"
            if path_hash in (state.low_value_paths or []):
                return True, "Previously low value"

            for relation in relations:
                score = (state.relation_scores or {}).get(relation, 1.0)
                if score < 0.2:
                    return True, f"Relation '{relation}' has low historical success rate ({score:.2f})"

            return False, ""

    async def record_path_exploration(
        self,
        path_hash: int,
        relations: list[str],
        entities: list[str],
        outcome_confidence: float,
        led_to_discovery: bool,
        disease: str = None,
    ) -> None:
        """Record the outcome of exploring a path, updating persistent scores."""
        async with self._session_factory() as session:
            async with session.begin():
                state = await self._get_or_create_state(session)

                explored = list(state.explored_paths or [])
                explored.append(path_hash)
                state.explored_paths = explored

                if outcome_confidence < 0.3 and not led_to_discovery:
                    low = list(state.low_value_paths or [])
                    low.append(path_hash)
                    state.low_value_paths = low
                elif outcome_confidence > 0.6 or led_to_discovery:
                    high = dict(state.high_value_paths or {})
                    high[str(path_hash)] = outcome_confidence
                    state.high_value_paths = high

                score_delta = 0.1 if led_to_discovery else -0.05
                scores = dict(state.relation_scores or {})
                for relation in relations:
                    current = scores.get(relation, 0.5)
                    scores[relation] = max(0, min(1, current + score_delta))
                state.relation_scores = scores

                pair_scores = dict(state.entity_pair_scores or {})
                for i in range(len(entities) - 1):
                    pair_key = f"{entities[i]}|{entities[i + 1]}"
                    current = pair_scores.get(pair_key, 0.5)
                    pair_scores[pair_key] = max(0, min(1, current + score_delta))
                state.entity_pair_scores = pair_scores

                # Also update disease-specific knowledge
                if disease:
                    disease_state = await self._get_or_create_state(session, scope="disease", disease=disease)
                    d_scores = dict(disease_state.relation_scores or {})
                    for relation in relations:
                        current = d_scores.get(relation, 0.5)
                        d_scores[relation] = max(0, min(1, current + score_delta * 1.5))
                    disease_state.relation_scores = d_scores

    # ============== Discovery Run Tracking ==============

    async def create_discovery_run(
        self,
        disease: str,
        discovery_type: str,
        max_agents: int,
        target_confidence: float,
        external_factors: list[dict] = None,
        focus_entities: list[str] = None,
        config_snapshot: dict = None,
    ) -> str:
        """Create a new discovery run record. Returns the run ID."""
        async with self._session_factory() as session:
            async with session.begin():
                run = DiscoveryRun(
                    disease=disease,
                    discovery_type=discovery_type,
                    max_agents=max_agents,
                    target_confidence=target_confidence,
                    external_factors=external_factors or [],
                    focus_entities=focus_entities or [],
                    config_snapshot=config_snapshot or {},
                    started_at=datetime.now(UTC),
                    status="running",
                )
                session.add(run)
                await session.flush()
                return str(run.id)

    async def complete_discovery_run(
        self,
        run_id: str,
        total_hypotheses: int,
        best_confidence: float,
        avg_confidence: float,
        total_duration: float,
        stages_total: int,
        stages_succeeded: int,
        stages_failed: int,
    ) -> None:
        """Mark a discovery run as completed and update aggregates."""
        async with self._session_factory() as session:
            async with session.begin():
                run = await session.get(DiscoveryRun, run_id)
                if run:
                    run.total_hypotheses = total_hypotheses
                    run.best_confidence = best_confidence
                    run.avg_confidence = avg_confidence
                    run.total_duration_seconds = total_duration
                    run.stages_total = stages_total
                    run.stages_succeeded = stages_succeeded
                    run.stages_failed = stages_failed
                    run.completed_at = datetime.now(UTC)
                    run.status = "completed"

                    # Compute cost totals from APICostRecords
                    cost_result = await session.execute(
                        select(
                            func.sum(APICostRecord.total_cost_usd).label("total_cost"),
                            func.sum(APICostRecord.input_tokens).label("total_input"),
                            func.sum(APICostRecord.output_tokens).label("total_output"),
                            func.count(APICostRecord.id).label("total_calls"),
                        ).where(APICostRecord.discovery_run_id == run_id)
                    )
                    row = cost_result.one()
                    run.total_cost_usd = float(row.total_cost or 0)
                    run.total_input_tokens = int(row.total_input or 0)
                    run.total_output_tokens = int(row.total_output or 0)
                    run.total_api_calls = int(row.total_calls or 0)

        # Update learning memory state from this run
        await self._incorporate_run_into_memory(run_id)
        # Update aggregate tables
        await self._update_stage_aggregates(run_id)

    async def record_stage_execution(
        self,
        discovery_run_id: str,
        hypothesis_id: str,
        round_number: int,
        hypothesis_index: int,
        stage_number: int,
        stage_name: str,
        model_type: str,
        model_id: str = None,
        outcome: str = "success",
        duration_seconds: float = 0.0,
        input_tokens: int = 0,
        output_tokens: int = 0,
        cost_usd: float = 0.0,
        grounding_ratio: float = None,
        grounded_claims: int = None,
        ungrounded_claims: int = None,
        confidence_delta: float = None,
        evidence_sources_used: int = 0,
        output_quality_score: float = None,
        parse_success: bool = True,
        error_message: str = None,
        retry_count: int = 0,
        content_filter_triggered: bool = False,
        prompt_length_chars: int = 0,
        output_length_chars: int = 0,
        metadata: dict = None,
    ) -> str:
        """Record a single stage execution."""
        async with self._session_factory() as session:
            async with session.begin():
                exec_record = StageExecution(
                    discovery_run_id=discovery_run_id,
                    hypothesis_id=hypothesis_id,
                    round_number=round_number,
                    hypothesis_index=hypothesis_index,
                    stage_number=stage_number,
                    stage_name=stage_name,
                    model_type=model_type,
                    model_id=model_id,
                    outcome=StageOutcome(outcome),
                    duration_seconds=duration_seconds,
                    input_tokens=input_tokens,
                    output_tokens=output_tokens,
                    cost_usd=cost_usd,
                    grounding_ratio=grounding_ratio,
                    grounded_claims=grounded_claims,
                    ungrounded_claims=ungrounded_claims,
                    confidence_delta=confidence_delta,
                    evidence_sources_used=evidence_sources_used,
                    output_quality_score=output_quality_score,
                    parse_success=parse_success,
                    error_message=error_message,
                    retry_count=retry_count,
                    content_filter_triggered=content_filter_triggered,
                    prompt_length_chars=prompt_length_chars,
                    output_length_chars=output_length_chars,
                    metadata=metadata or {},
                )
                session.add(exec_record)
                await session.flush()
                return str(exec_record.id)

    # ============== Learning from Runs ==============

    async def _incorporate_run_into_memory(self, run_id: str) -> None:
        """Incorporate a completed discovery run into learning memory."""
        async with self._session_factory() as session:
            # Get all stage executions for this run
            result = await session.execute(
                select(StageExecution)
                .where(StageExecution.discovery_run_id == run_id)
                .order_by(StageExecution.stage_number)
            )
            executions = result.scalars().all()

            if not executions:
                return

            # Get the run info
            run = await session.get(DiscoveryRun, run_id)
            if not run:
                return

            # Update global state
            state = await self._get_or_create_state(session)

            # Update model performance
            model_perf = dict(state.model_performance or {})
            for exec_record in executions:
                model_key = exec_record.model_type
                if model_key not in model_perf:
                    model_perf[model_key] = {
                        "total_calls": 0,
                        "successes": 0,
                        "failures": 0,
                        "total_duration": 0.0,
                        "total_cost": 0.0,
                        "total_input_tokens": 0,
                        "total_output_tokens": 0,
                        "grounding_ratios": [],
                        "quality_scores": [],
                    }
                mp = model_perf[model_key]
                mp["total_calls"] += 1
                if exec_record.outcome == StageOutcome.SUCCESS:
                    mp["successes"] += 1
                else:
                    mp["failures"] += 1
                mp["total_duration"] += exec_record.duration_seconds
                mp["total_cost"] += exec_record.cost_usd
                mp["total_input_tokens"] += exec_record.input_tokens
                mp["total_output_tokens"] += exec_record.output_tokens
                if exec_record.grounding_ratio is not None:
                    ratios = mp.get("grounding_ratios", [])
                    ratios.append(exec_record.grounding_ratio)
                    mp["grounding_ratios"] = ratios[-100:]  # Keep last 100
                if exec_record.output_quality_score is not None:
                    scores = mp.get("quality_scores", [])
                    scores.append(exec_record.output_quality_score)
                    mp["quality_scores"] = scores[-100:]

            state.model_performance = model_perf

            # Update stage effectiveness
            stage_eff = dict(state.stage_effectiveness or {})
            for exec_record in executions:
                sk = str(exec_record.stage_number)
                if sk not in stage_eff:
                    stage_eff[sk] = {
                        "total_executions": 0,
                        "successes": 0,
                        "avg_grounding": 0.0,
                        "grounding_samples": [],
                        "avg_confidence_delta": 0.0,
                        "delta_samples": [],
                    }
                se = stage_eff[sk]
                se["total_executions"] += 1
                if exec_record.outcome == StageOutcome.SUCCESS:
                    se["successes"] += 1
                if exec_record.grounding_ratio is not None:
                    samples = se.get("grounding_samples", [])
                    samples.append(exec_record.grounding_ratio)
                    se["grounding_samples"] = samples[-50:]
                    se["avg_grounding"] = sum(se["grounding_samples"]) / len(se["grounding_samples"])
                if exec_record.confidence_delta is not None:
                    samples = se.get("delta_samples", [])
                    samples.append(exec_record.confidence_delta)
                    se["delta_samples"] = samples[-50:]
                    se["avg_confidence_delta"] = sum(se["delta_samples"]) / len(se["delta_samples"])

            state.stage_effectiveness = stage_eff
            state.total_runs_incorporated += 1
            state.last_updated_from_run = run_id

            await session.commit()

        logger.info(f"Incorporated run {run_id} into learning memory ({len(executions)} stage executions)")

    async def _update_stage_aggregates(self, run_id: str) -> None:
        """Update pre-computed aggregate statistics after a run."""
        async with self._session_factory() as session:
            async with session.begin():
                # Get stage executions grouped by stage+model
                result = await session.execute(
                    select(
                        StageExecution.stage_number,
                        StageExecution.stage_name,
                        StageExecution.model_type,
                        func.count(StageExecution.id).label("total"),
                        func.sum(
                            func.cast(StageExecution.outcome == StageOutcome.SUCCESS.value, Integer)
                        ).label("successes"),
                        func.avg(StageExecution.duration_seconds).label("avg_duration"),
                        func.avg(StageExecution.input_tokens).label("avg_input"),
                        func.avg(StageExecution.output_tokens).label("avg_output"),
                        func.avg(StageExecution.cost_usd).label("avg_cost"),
                        func.sum(StageExecution.cost_usd).label("total_cost"),
                        func.avg(StageExecution.grounding_ratio).label("avg_grounding"),
                        func.avg(StageExecution.confidence_delta).label("avg_delta"),
                        func.avg(StageExecution.output_quality_score).label("avg_quality"),
                        func.avg(StageExecution.evidence_sources_used).label("avg_evidence"),
                    )
                    .group_by(StageExecution.stage_number, StageExecution.stage_name, StageExecution.model_type)
                )


                for row in result:
                    # Upsert aggregate record
                    existing = await session.execute(
                        select(StagePerformanceAggregate)
                        .where(
                            and_(
                                StagePerformanceAggregate.stage_number == row.stage_number,
                                StagePerformanceAggregate.model_type == row.model_type,
                                StagePerformanceAggregate.disease.is_(None),
                            )
                        )
                        .limit(1)
                    )
                    agg = existing.scalar_one_or_none()

                    if not agg:
                        agg = StagePerformanceAggregate(
                            stage_number=row.stage_number,
                            stage_name=row.stage_name,
                            model_type=row.model_type,
                        )
                        session.add(agg)

                    total = int(row.total or 0)
                    successes = int(row.successes or 0)
                    agg.total_executions = total
                    agg.success_count = successes
                    agg.failure_count = total - successes
                    agg.success_rate = successes / total if total > 0 else 0.0
                    agg.avg_duration_seconds = float(row.avg_duration or 0)
                    agg.avg_input_tokens = float(row.avg_input or 0)
                    agg.avg_output_tokens = float(row.avg_output or 0)
                    agg.avg_cost_usd = float(row.avg_cost or 0)
                    agg.total_cost_usd = float(row.total_cost or 0)
                    agg.avg_grounding_ratio = float(row.avg_grounding) if row.avg_grounding else None
                    agg.avg_confidence_delta = float(row.avg_delta) if row.avg_delta else None
                    agg.avg_output_quality = float(row.avg_quality) if row.avg_quality else None
                    agg.avg_evidence_sources = float(row.avg_evidence) if row.avg_evidence else None
                    agg.last_aggregated_at = datetime.now(UTC)

    # ============== Feedback ==============

    async def submit_feedback(
        self,
        hypothesis_id: str,
        feedback_type: str,
        overall_quality: float,
        discovery_run_id: str = None,
        reviewer: str = None,
        biological_plausibility: float = None,
        evidence_strength: float = None,
        novelty: float = None,
        feasibility: float = None,
        clinical_relevance: float = None,
        mechanism_clarity: float = None,
        reproducibility: float = None,
        comments: str = None,
        strengths: list = None,
        weaknesses: list = None,
        suggested_improvements: list = None,
        best_stage: int = None,
        worst_stage: int = None,
        stage_contributions: dict = None,
        matches_known_biology: bool = None,
        novel_insight: bool = None,
        actionable: bool = None,
        disease: str = None,
        round_number: int = None,
    ) -> str:
        """Submit feedback on a hypothesis."""
        async with self._session_factory() as session:
            async with session.begin():
                fb = HypothesisFeedback(
                    discovery_run_id=discovery_run_id,
                    hypothesis_id=hypothesis_id,
                    feedback_type=FeedbackType(feedback_type),
                    reviewer=reviewer,
                    overall_quality=overall_quality,
                    biological_plausibility=biological_plausibility,
                    evidence_strength=evidence_strength,
                    novelty=novelty,
                    feasibility=feasibility,
                    clinical_relevance=clinical_relevance,
                    mechanism_clarity=mechanism_clarity,
                    reproducibility=reproducibility,
                    comments=comments,
                    strengths=strengths or [],
                    weaknesses=weaknesses or [],
                    suggested_improvements=suggested_improvements or [],
                    best_stage=best_stage,
                    worst_stage=worst_stage,
                    stage_contributions=stage_contributions or {},
                    matches_known_biology=matches_known_biology,
                    novel_insight=novel_insight,
                    actionable=actionable,
                    disease=disease,
                    round_number=round_number,
                )
                session.add(fb)
                await session.flush()
                return str(fb.id)

    # ============== Analytics Queries ==============

    async def get_model_performance_profiles(
        self, stage_number: int = None, disease: str = None
    ) -> list[ModelPerformanceProfile]:
        """Get performance profiles for all models, optionally filtered by stage/disease."""
        async with self._session_factory() as session:
            query = select(StagePerformanceAggregate)
            conditions = []
            if stage_number is not None:
                conditions.append(StagePerformanceAggregate.stage_number == stage_number)
            if disease:
                conditions.append(StagePerformanceAggregate.disease == disease)
            else:
                conditions.append(StagePerformanceAggregate.disease.is_(None))
            if conditions:
                query = query.where(and_(*conditions))

            result = await session.execute(query)
            aggregates = result.scalars().all()

            profiles = []
            for agg in aggregates:
                cost_eff = 0.0
                if agg.avg_cost_usd and agg.avg_cost_usd > 0:
                    quality = agg.avg_output_quality or agg.success_rate
                    cost_eff = quality / agg.avg_cost_usd

                profiles.append(ModelPerformanceProfile(
                    model_type=agg.model_type,
                    stage_number=agg.stage_number,
                    success_rate=agg.success_rate,
                    avg_duration=agg.avg_duration_seconds,
                    avg_cost=agg.avg_cost_usd,
                    avg_grounding_ratio=agg.avg_grounding_ratio or 0.0,
                    avg_quality_score=agg.avg_output_quality or 0.0,
                    total_executions=agg.total_executions,
                    confidence_impact=agg.avg_confidence_delta or 0.0,
                    cost_efficiency=cost_eff,
                ))

            return profiles

    async def get_optimization_recommendations(self) -> list[StageOptimizationRecommendation]:
        """Analyze learning memory and generate optimization recommendations."""
        recommendations = []

        async with self._session_factory() as session:
            state = await self._get_or_create_state(session)

            stage_eff = state.stage_effectiveness or {}
            model_perf = state.model_performance or {}

            for stage_key, stage_data in stage_eff.items():
                stage_num = int(stage_key)
                total = stage_data.get("total_executions", 0)
                if total < 5:
                    continue  # Need sufficient data

                successes = stage_data.get("successes", 0)
                success_rate = successes / total if total > 0 else 0
                avg_grounding = stage_data.get("avg_grounding", 0)

                # Flag underperforming stages
                if success_rate < 0.7:
                    recommendations.append(StageOptimizationRecommendation(
                        stage_number=stage_num,
                        stage_name=f"stage_{stage_num}",
                        current_model="unknown",
                        recommended_model=None,
                        recommended_temperature=None,
                        recommended_max_tokens=None,
                        reasoning=f"Stage {stage_num} has {success_rate:.0%} success rate across {total} runs. Consider model swap or prompt adjustment.",
                        expected_improvement=0.15,
                        confidence=min(total / 20, 1.0),
                    ))

                if avg_grounding < 0.4 and total > 3:
                    recommendations.append(StageOptimizationRecommendation(
                        stage_number=stage_num,
                        stage_name=f"stage_{stage_num}",
                        current_model="unknown",
                        recommended_model=None,
                        recommended_temperature=None,
                        recommended_max_tokens=None,
                        reasoning=f"Stage {stage_num} has low grounding ratio ({avg_grounding:.0%}). Increase evidence injection or lower grounding threshold.",
                        expected_improvement=0.10,
                        confidence=min(total / 20, 1.0),
                    ))

        return recommendations

    async def get_learning_stats(self) -> dict[str, Any]:
        """Get comprehensive learning memory statistics."""
        async with self._session_factory() as session:
            state = await self._get_or_create_state(session)

            # Count total records
            runs_count = await session.execute(select(func.count(DiscoveryRun.id)))
            stages_count = await session.execute(select(func.count(StageExecution.id)))
            feedback_count = await session.execute(select(func.count(HypothesisFeedback.id)))

            return {
                "total_runs": runs_count.scalar() or 0,
                "total_stage_executions": stages_count.scalar() or 0,
                "total_feedback_records": feedback_count.scalar() or 0,
                "runs_incorporated_into_memory": state.total_runs_incorporated,
                "explored_paths": len(state.explored_paths or []),
                "low_value_paths": len(state.low_value_paths or []),
                "high_value_paths": len(state.high_value_paths or {}),
                "tracked_relations": len(state.relation_scores or {}),
                "tracked_entity_pairs": len(state.entity_pair_scores or {}),
                "tracked_models": len(state.model_performance or {}),
                "tracked_stages": len(state.stage_effectiveness or {}),
                "version": state.version,
                "model_performance_summary": {
                    k: {
                        "total_calls": v.get("total_calls", 0),
                        "success_rate": v.get("successes", 0) / max(v.get("total_calls", 1), 1),
                        "total_cost": v.get("total_cost", 0),
                    }
                    for k, v in (state.model_performance or {}).items()
                },
            }

    async def export_to_dict(self) -> dict[str, Any]:
        """Export learning memory state for backward compatibility with in-memory LearningMemory."""
        async with self._session_factory() as session:
            state = await self._get_or_create_state(session)
            return {
                "explored_paths": state.explored_paths or [],
                "low_value_paths": state.low_value_paths or [],
                "high_value_paths": state.high_value_paths or {},
                "relation_scores": state.relation_scores or {},
                "entity_pair_scores": state.entity_pair_scores or {},
            }

    async def import_from_dict(self, data: dict[str, Any]) -> None:
        """Import from in-memory LearningMemory dict format (migration path)."""
        async with self._session_factory() as session:
            async with session.begin():
                state = await self._get_or_create_state(session)
                if data.get("explored_paths"):
                    existing = set(state.explored_paths or [])
                    existing.update(data["explored_paths"])
                    state.explored_paths = list(existing)
                if data.get("low_value_paths"):
                    existing = set(state.low_value_paths or [])
                    existing.update(data["low_value_paths"])
                    state.low_value_paths = list(existing)
                if data.get("high_value_paths"):
                    merged = dict(state.high_value_paths or {})
                    merged.update(data["high_value_paths"])
                    state.high_value_paths = merged
                if data.get("relation_scores"):
                    merged = dict(state.relation_scores or {})
                    merged.update(data["relation_scores"])
                    state.relation_scores = merged
                if data.get("entity_pair_scores"):
                    merged = dict(state.entity_pair_scores or {})
                    merged.update(data["entity_pair_scores"])
                    state.entity_pair_scores = merged


# ============== Singleton ==============

_learning_memory: PersistentLearningMemory | None = None


def get_learning_memory() -> PersistentLearningMemory:
    """Get the singleton learning memory service."""
    global _learning_memory
    if _learning_memory is None:
        _learning_memory = PersistentLearningMemory()
    return _learning_memory
