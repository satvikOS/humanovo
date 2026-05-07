"""
Retrospective Benchmark Service — Real API Benchmark Framework

Runs the full 10-stage pipeline against known-good discovery test cases
and measures quality. Uses real API calls only (no mocks).

Key capabilities:
- Manage benchmark test cases (CRUD)
- Run full pipeline benchmarks with real APIs
- Score pipeline output against expected results using semantic comparison
- Track per-stage contribution to discovery quality
- Compare benchmark runs over time to measure improvement
"""

import asyncio
import time
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import and_, desc, select

from app.core.database import async_session_factory
from app.core.logging import get_logger
from app.models.learning_memory import (
    BenchmarkResult,
    BenchmarkRun,
    BenchmarkRunStatus,
    BenchmarkStatus,
    BenchmarkTestCase,
)

logger = get_logger(__name__)


class BenchmarkScoringEngine:
    """Scores pipeline output against expected benchmark results.

    Uses semantic comparison for mechanisms and targets, exact matching
    for PMIDs, and confidence range checking.
    """

    @staticmethod
    def score_mechanism_match(produced: str, expected: str) -> float:
        """Score mechanism similarity using keyword overlap and structure matching.

        For a production system, this would use embedding similarity.
        Here we use a robust keyword-based approach.
        """
        if not produced or not expected:
            return 0.0

        # Normalize
        produced_lower = produced.lower()
        expected_lower = expected.lower()

        # Extract key biomedical terms (multi-word)
        import re
        term_pattern = r'\b[A-Z][A-Za-z0-9-]+(?:\s+[A-Z][a-z]+)*\b'
        produced_terms = set(re.findall(term_pattern, produced))
        expected_terms = set(re.findall(term_pattern, expected))

        if not expected_terms:
            # Fall back to word overlap
            produced_words = set(produced_lower.split())
            expected_words = set(expected_lower.split())
            stop_words = {"the", "a", "an", "is", "are", "was", "were", "in", "on", "at",
                         "to", "for", "of", "with", "by", "from", "this", "that", "and",
                         "or", "but", "not", "it", "its", "as", "be", "has", "have", "had",
                         "which", "may", "can", "could", "through", "via", "into"}
            produced_words -= stop_words
            expected_words -= stop_words
            if not expected_words:
                return 0.0
            overlap = produced_words & expected_words
            return len(overlap) / len(expected_words)

        overlap = produced_terms & expected_terms
        precision = len(overlap) / len(produced_terms) if produced_terms else 0
        recall = len(overlap) / len(expected_terms) if expected_terms else 0
        if precision + recall == 0:
            return 0.0
        return 2 * (precision * recall) / (precision + recall)  # F1

    @staticmethod
    def score_target_match(produced: list, expected: list) -> float:
        """Score target entity overlap."""
        if not expected:
            return 1.0 if not produced else 0.5

        produced_set = {str(t).lower() for t in produced}
        expected_set = {str(t).lower() for t in expected}

        if not expected_set:
            return 1.0

        overlap = produced_set & expected_set
        recall = len(overlap) / len(expected_set)
        return recall

    @staticmethod
    def score_evidence_match(produced_pmids: list, expected_pmids: list) -> float:
        """Score evidence PMID overlap."""
        if not expected_pmids:
            return 1.0 if not produced_pmids else 0.5

        produced_set = {str(p).strip() for p in produced_pmids}
        expected_set = {str(p).strip() for p in expected_pmids}

        if not expected_set:
            return 1.0

        overlap = produced_set & expected_set
        return len(overlap) / len(expected_set)

    @staticmethod
    def score_confidence_accuracy(produced: float, expected_min: float) -> float:
        """Score how well the confidence matches expected range."""
        if produced >= expected_min:
            return 1.0
        # Partial credit for being close
        diff = expected_min - produced
        return max(0.0, 1.0 - diff * 2)

    def score_benchmark_result(
        self,
        test_case: BenchmarkTestCase,
        produced_title: str,
        produced_mechanism: str,
        produced_targets: list,
        produced_confidence: float,
        produced_evidence_pmids: list,
        stage_outputs: dict = None,
    ) -> dict[str, Any]:
        """Score a complete benchmark result."""
        mechanism_score = self.score_mechanism_match(
            produced_mechanism, test_case.expected_mechanism
        )
        target_score = self.score_target_match(
            produced_targets, test_case.expected_targets or []
        )
        evidence_score = self.score_evidence_match(
            produced_evidence_pmids, test_case.expected_evidence_pmids or []
        )
        confidence_score = self.score_confidence_accuracy(
            produced_confidence, test_case.expected_confidence_min
        )

        # Weighted overall score
        overall = (
            mechanism_score * test_case.mechanism_match_weight
            + target_score * test_case.target_match_weight
            + evidence_score * test_case.evidence_match_weight
            + confidence_score * test_case.confidence_match_weight
        )

        # Matched/missed analysis
        produced_target_set = {str(t).lower() for t in produced_targets}
        expected_target_set = {str(t).lower() for t in (test_case.expected_targets or [])}
        matched_targets = list(produced_target_set & expected_target_set)
        missed_targets = list(expected_target_set - produced_target_set)

        produced_pmid_set = {str(p).strip() for p in produced_evidence_pmids}
        expected_pmid_set = {str(p).strip() for p in (test_case.expected_evidence_pmids or [])}
        matched_evidence = list(produced_pmid_set & expected_pmid_set)
        missed_evidence = list(expected_pmid_set - produced_pmid_set)

        return {
            "overall_score": overall,
            "mechanism_match_score": mechanism_score,
            "target_match_score": target_score,
            "evidence_match_score": evidence_score,
            "confidence_accuracy": confidence_score,
            "matched_targets": matched_targets,
            "missed_targets": missed_targets,
            "matched_evidence": matched_evidence,
            "missed_evidence": missed_evidence,
        }


class BenchmarkService:
    """Manages benchmark test cases and orchestrates benchmark runs."""

    def __init__(self, session_factory=None):
        self._session_factory = session_factory or async_session_factory
        self._scoring = BenchmarkScoringEngine()

    # ============== Test Case Management ==============

    async def create_test_case(
        self,
        name: str,
        disease: str,
        discovery_type: str,
        expected_title: str,
        expected_mechanism: str,
        expected_targets: list = None,
        expected_pathways: list = None,
        expected_evidence_pmids: list = None,
        expected_confidence_min: float = 0.5,
        expected_key_claims: list = None,
        focus_entities: list = None,
        external_factors: list = None,
        pathway_context: str = None,
        description: str = None,
        source_publication: str = None,
        source_pmid: str = None,
        difficulty: str = "medium",
        tags: list = None,
        mechanism_match_weight: float = 0.3,
        target_match_weight: float = 0.2,
        evidence_match_weight: float = 0.2,
        confidence_match_weight: float = 0.15,
        novelty_weight: float = 0.15,
    ) -> str:
        """Create a new benchmark test case."""
        async with self._session_factory() as session:
            async with session.begin():
                tc = BenchmarkTestCase(
                    name=name,
                    description=description,
                    disease=disease,
                    discovery_type=discovery_type,
                    expected_title=expected_title,
                    expected_mechanism=expected_mechanism,
                    expected_targets=expected_targets or [],
                    expected_pathways=expected_pathways or [],
                    expected_evidence_pmids=expected_evidence_pmids or [],
                    expected_confidence_min=expected_confidence_min,
                    expected_key_claims=expected_key_claims or [],
                    focus_entities=focus_entities or [],
                    external_factors=external_factors or [],
                    pathway_context=pathway_context,
                    mechanism_match_weight=mechanism_match_weight,
                    target_match_weight=target_match_weight,
                    evidence_match_weight=evidence_match_weight,
                    confidence_match_weight=confidence_match_weight,
                    novelty_weight=novelty_weight,
                    source_publication=source_publication,
                    source_pmid=source_pmid,
                    difficulty=difficulty,
                    tags=tags or [],
                    status=BenchmarkStatus.ACTIVE,
                )
                session.add(tc)
                await session.flush()
                return str(tc.id)

    async def list_test_cases(
        self, disease: str = None, status: str = "active", limit: int = 100
    ) -> list[dict[str, Any]]:
        """List benchmark test cases."""
        async with self._session_factory() as session:
            query = select(BenchmarkTestCase)
            conditions = []
            if disease:
                conditions.append(BenchmarkTestCase.disease == disease)
            if status:
                conditions.append(BenchmarkTestCase.status == BenchmarkStatus(status))
            if conditions:
                query = query.where(and_(*conditions))
            query = query.order_by(desc(BenchmarkTestCase.created_at)).limit(limit)

            result = await session.execute(query)
            cases = result.scalars().all()

            return [
                {
                    "id": str(tc.id),
                    "name": tc.name,
                    "disease": tc.disease,
                    "discovery_type": tc.discovery_type,
                    "expected_title": tc.expected_title,
                    "expected_mechanism": tc.expected_mechanism[:200] + "..." if len(tc.expected_mechanism) > 200 else tc.expected_mechanism,
                    "expected_targets": tc.expected_targets,
                    "expected_evidence_pmids": tc.expected_evidence_pmids,
                    "expected_confidence_min": tc.expected_confidence_min,
                    "difficulty": tc.difficulty,
                    "tags": tc.tags,
                    "status": tc.status.value,
                    "source_publication": tc.source_publication,
                    "created_at": tc.created_at.isoformat() if tc.created_at else None,
                }
                for tc in cases
            ]

    async def get_test_case(self, test_case_id: str) -> dict[str, Any] | None:
        """Get a single test case with full details."""
        async with self._session_factory() as session:
            tc = await session.get(BenchmarkTestCase, test_case_id)
            if not tc:
                return None
            return {
                "id": str(tc.id),
                "name": tc.name,
                "description": tc.description,
                "disease": tc.disease,
                "discovery_type": tc.discovery_type,
                "expected_title": tc.expected_title,
                "expected_mechanism": tc.expected_mechanism,
                "expected_targets": tc.expected_targets,
                "expected_pathways": tc.expected_pathways,
                "expected_evidence_pmids": tc.expected_evidence_pmids,
                "expected_confidence_min": tc.expected_confidence_min,
                "expected_key_claims": tc.expected_key_claims,
                "focus_entities": tc.focus_entities,
                "external_factors": tc.external_factors,
                "pathway_context": tc.pathway_context,
                "mechanism_match_weight": tc.mechanism_match_weight,
                "target_match_weight": tc.target_match_weight,
                "evidence_match_weight": tc.evidence_match_weight,
                "confidence_match_weight": tc.confidence_match_weight,
                "novelty_weight": tc.novelty_weight,
                "source_publication": tc.source_publication,
                "source_pmid": tc.source_pmid,
                "difficulty": tc.difficulty,
                "tags": tc.tags,
                "status": tc.status.value,
                "created_at": tc.created_at.isoformat() if tc.created_at else None,
            }

    async def update_test_case(self, test_case_id: str, updates: dict[str, Any]) -> bool:
        """Update a benchmark test case."""
        async with self._session_factory() as session:
            async with session.begin():
                tc = await session.get(BenchmarkTestCase, test_case_id)
                if not tc:
                    return False
                for key, value in updates.items():
                    if hasattr(tc, key) and key not in ("id", "created_at"):
                        if key == "status":
                            value = BenchmarkStatus(value)
                        setattr(tc, key, value)
                return True

    async def delete_test_case(self, test_case_id: str) -> bool:
        """Delete a benchmark test case."""
        async with self._session_factory() as session:
            async with session.begin():
                tc = await session.get(BenchmarkTestCase, test_case_id)
                if not tc:
                    return False
                await session.delete(tc)
                return True

    # ============== Benchmark Execution ==============

    async def start_benchmark_run(
        self,
        test_case_ids: list[str] = None,
        disease_filter: str = None,
        name: str = None,
        description: str = None,
    ) -> str:
        """Start a new benchmark run.

        If test_case_ids is None, runs all active test cases.
        Returns the benchmark run ID.
        """
        async with self._session_factory() as session:
            # Get test cases
            if test_case_ids:
                query = select(BenchmarkTestCase).where(
                    BenchmarkTestCase.id.in_(test_case_ids)
                )
            else:
                conditions = [BenchmarkTestCase.status == BenchmarkStatus.ACTIVE]
                if disease_filter:
                    conditions.append(BenchmarkTestCase.disease == disease_filter)
                query = select(BenchmarkTestCase).where(and_(*conditions))

            result = await session.execute(query)
            test_cases = result.scalars().all()

            if not test_cases:
                raise ValueError("No active test cases found for benchmarking")

            # Create benchmark run
            async with session.begin():
                from app.core.config import settings
                run = BenchmarkRun(
                    name=name or f"Benchmark Run {datetime.now(UTC).strftime('%Y-%m-%d %H:%M')}",
                    description=description,
                    config_snapshot={
                        "pipeline_stages": 10,
                        "grounding_enabled": settings.GROUNDING_GATE_ENABLED,
                        "grounding_threshold": settings.GROUNDING_SIMILARITY_THRESHOLD,
                    },
                    pipeline_version=settings.VERSION,
                    total_test_cases=len(test_cases),
                    status=BenchmarkRunStatus.RUNNING,
                    started_at=datetime.now(UTC),
                )
                session.add(run)
                await session.flush()
                run_id = str(run.id)

        # Execute benchmarks asynchronously
        asyncio.create_task(self._execute_benchmark_run(run_id, [str(tc.id) for tc in test_cases]))

        return run_id

    async def _execute_benchmark_run(self, run_id: str, test_case_ids: list[str]) -> None:
        """Execute all test cases in a benchmark run."""
        from app.agents.discovery_orchestrator import DiscoveryOrchestrator

        total_cost = 0.0
        total_duration = 0.0
        scores = []

        for tc_id in test_case_ids:
            try:
                async with self._session_factory() as session:
                    tc = await session.get(BenchmarkTestCase, tc_id)
                    if not tc:
                        continue

                    tc_data = {
                        "id": str(tc.id),
                        "disease": tc.disease,
                        "discovery_type": tc.discovery_type,
                        "focus_entities": tc.focus_entities,
                        "external_factors": tc.external_factors,
                        "expected_title": tc.expected_title,
                        "expected_mechanism": tc.expected_mechanism,
                        "expected_targets": tc.expected_targets,
                        "expected_evidence_pmids": tc.expected_evidence_pmids,
                        "expected_confidence_min": tc.expected_confidence_min,
                        "mechanism_match_weight": tc.mechanism_match_weight,
                        "target_match_weight": tc.target_match_weight,
                        "evidence_match_weight": tc.evidence_match_weight,
                        "confidence_match_weight": tc.confidence_match_weight,
                        "novelty_weight": tc.novelty_weight,
                    }

                # Run the pipeline for this test case
                start_time = time.time()

                orchestrator = DiscoveryOrchestrator(max_agents=100, target_confidence=0.95)
                await orchestrator.initialize()
                await orchestrator.start(
                    disease=tc_data["disease"],
                    focus_entities=tc_data.get("focus_entities"),
                    discovery_type=tc_data["discovery_type"],
                    external_factors=tc_data.get("external_factors"),
                )

                duration = time.time() - start_time

                # Get the best hypothesis
                hypotheses = orchestrator.get_hypotheses(min_confidence=0.0, limit=1)
                if hypotheses:
                    best = hypotheses[0]
                    produced_targets = []
                    if hasattr(best, 'supporting_paths'):
                        for path in best.supporting_paths:
                            produced_targets.extend(path.entities)

                    # Score it
                    async with self._session_factory() as session:
                        tc_obj = await session.get(BenchmarkTestCase, tc_data["id"])
                        if tc_obj:
                            score_data = self._scoring.score_benchmark_result(
                                test_case=tc_obj,
                                produced_title=best.title,
                                produced_mechanism=best.mechanism,
                                produced_targets=produced_targets,
                                produced_confidence=best.confidence,
                                produced_evidence_pmids=[
                                    c.get("pmid", "") for c in best.citations if isinstance(c, dict)
                                ],
                            )

                            # Save result
                            async with session.begin():
                                br = BenchmarkResult(
                                    benchmark_run_id=run_id,
                                    test_case_id=tc_data["id"],
                                    overall_score=score_data["overall_score"],
                                    mechanism_match_score=score_data["mechanism_match_score"],
                                    target_match_score=score_data["target_match_score"],
                                    evidence_match_score=score_data["evidence_match_score"],
                                    confidence_accuracy=score_data["confidence_accuracy"],
                                    produced_title=best.title,
                                    produced_mechanism=best.mechanism,
                                    produced_targets=produced_targets,
                                    produced_confidence=best.confidence,
                                    produced_evidence_pmids=[
                                        c.get("pmid", "") for c in best.citations if isinstance(c, dict)
                                    ],
                                    matched_targets=score_data["matched_targets"],
                                    missed_targets=score_data["missed_targets"],
                                    matched_evidence=score_data["matched_evidence"],
                                    missed_evidence=score_data["missed_evidence"],
                                    cost_usd=0.0,
                                    duration_seconds=duration,
                                    status="completed",
                                )
                                session.add(br)

                            scores.append(score_data["overall_score"])
                            total_duration += duration

                else:
                    # No hypotheses produced
                    async with self._session_factory() as session:
                        async with session.begin():
                            br = BenchmarkResult(
                                benchmark_run_id=run_id,
                                test_case_id=tc_data["id"],
                                overall_score=0.0,
                                mechanism_match_score=0.0,
                                target_match_score=0.0,
                                evidence_match_score=0.0,
                                confidence_accuracy=0.0,
                                duration_seconds=duration,
                                status="no_output",
                            )
                            session.add(br)
                    scores.append(0.0)
                    total_duration += duration

            except Exception as e:
                logger.error(f"Benchmark test case {tc_id} failed: {e}")
                async with self._session_factory() as session:
                    async with session.begin():
                        br = BenchmarkResult(
                            benchmark_run_id=run_id,
                            test_case_id=tc_id,
                            overall_score=0.0,
                            status="failed",
                            error_message=str(e),
                        )
                        session.add(br)
                scores.append(0.0)

        # Update benchmark run with results
        async with self._session_factory() as session:
            async with session.begin():
                run = await session.get(BenchmarkRun, run_id)
                if run:
                    run.completed_test_cases = len(scores)
                    run.avg_overall_score = sum(scores) / len(scores) if scores else 0.0
                    run.total_cost_usd = total_cost
                    run.total_duration_seconds = total_duration
                    run.status = BenchmarkRunStatus.COMPLETED
                    run.completed_at = datetime.now(UTC)

        logger.info(
            f"Benchmark run {run_id} completed: {len(scores)} cases, "
            f"avg score: {sum(scores) / len(scores) if scores else 0:.2f}"
        )

    # ============== Query Methods ==============

    async def get_benchmark_run(self, run_id: str) -> dict[str, Any] | None:
        """Get benchmark run with all results."""
        async with self._session_factory() as session:
            run = await session.get(BenchmarkRun, run_id)
            if not run:
                return None

            results = await session.execute(
                select(BenchmarkResult)
                .where(BenchmarkResult.benchmark_run_id == run_id)
            )
            result_list = results.scalars().all()

            return {
                "id": str(run.id),
                "name": run.name,
                "description": run.description,
                "pipeline_version": run.pipeline_version,
                "total_test_cases": run.total_test_cases,
                "completed_test_cases": run.completed_test_cases,
                "avg_overall_score": run.avg_overall_score,
                "total_cost_usd": run.total_cost_usd,
                "total_duration_seconds": run.total_duration_seconds,
                "status": run.status.value,
                "started_at": run.started_at.isoformat() if run.started_at else None,
                "completed_at": run.completed_at.isoformat() if run.completed_at else None,
                "results": [
                    {
                        "id": str(r.id),
                        "test_case_id": str(r.test_case_id),
                        "overall_score": r.overall_score,
                        "mechanism_match_score": r.mechanism_match_score,
                        "target_match_score": r.target_match_score,
                        "evidence_match_score": r.evidence_match_score,
                        "confidence_accuracy": r.confidence_accuracy,
                        "produced_title": r.produced_title,
                        "produced_confidence": r.produced_confidence,
                        "matched_targets": r.matched_targets,
                        "missed_targets": r.missed_targets,
                        "cost_usd": r.cost_usd,
                        "duration_seconds": r.duration_seconds,
                        "status": r.status,
                    }
                    for r in result_list
                ],
            }

    async def list_benchmark_runs(self, limit: int = 20) -> list[dict[str, Any]]:
        """List recent benchmark runs."""
        async with self._session_factory() as session:
            result = await session.execute(
                select(BenchmarkRun)
                .order_by(desc(BenchmarkRun.created_at))
                .limit(limit)
            )
            runs = result.scalars().all()

            return [
                {
                    "id": str(r.id),
                    "name": r.name,
                    "total_test_cases": r.total_test_cases,
                    "completed_test_cases": r.completed_test_cases,
                    "avg_overall_score": r.avg_overall_score,
                    "total_cost_usd": r.total_cost_usd,
                    "total_duration_seconds": r.total_duration_seconds,
                    "status": r.status.value,
                    "started_at": r.started_at.isoformat() if r.started_at else None,
                    "completed_at": r.completed_at.isoformat() if r.completed_at else None,
                }
                for r in runs
            ]

    async def get_benchmark_trend(self) -> list[dict[str, Any]]:
        """Get benchmark score trend over time (for line chart visualization)."""
        async with self._session_factory() as session:
            result = await session.execute(
                select(
                    BenchmarkRun.id,
                    BenchmarkRun.name,
                    BenchmarkRun.avg_overall_score,
                    BenchmarkRun.avg_mechanism_score,
                    BenchmarkRun.avg_target_score,
                    BenchmarkRun.avg_evidence_score,
                    BenchmarkRun.total_cost_usd,
                    BenchmarkRun.completed_at,
                )
                .where(BenchmarkRun.status == BenchmarkRunStatus.COMPLETED)
                .order_by(BenchmarkRun.completed_at)
            )

            return [
                {
                    "id": str(row.id),
                    "name": row.name,
                    "avg_overall_score": row.avg_overall_score,
                    "avg_mechanism_score": row.avg_mechanism_score,
                    "avg_target_score": row.avg_target_score,
                    "avg_evidence_score": row.avg_evidence_score,
                    "total_cost_usd": row.total_cost_usd,
                    "completed_at": row.completed_at.isoformat() if row.completed_at else None,
                }
                for row in result
            ]


# ============== Singleton ==============

_benchmark_service: BenchmarkService | None = None


def get_benchmark_service() -> BenchmarkService:
    """Get the singleton benchmark service."""
    global _benchmark_service
    if _benchmark_service is None:
        _benchmark_service = BenchmarkService()
    return _benchmark_service
