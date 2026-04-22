"""Pipeline Intelligence — Learning Memory, Cost Tracking, Benchmarks, Optimization

Revision ID: 002_pipeline_intelligence
Revises: 001_initial
Create Date: 2026-03-11

Creates all tables for the pipeline intelligence system:
- discovery_runs: Track complete discovery pipeline runs
- stage_executions: Per-stage execution records with metrics
- api_cost_records: Individual API call cost tracking
- model_pricing: Provider pricing audit trail
- hypothesis_feedback: Feedback on generated hypotheses
- learning_memory_state: Persistent learning memory
- stage_performance_aggregates: Pre-computed performance stats
- benchmark_test_cases: Known-good discovery test cases
- benchmark_runs: Benchmark execution runs
- benchmark_results: Individual benchmark results
- pipeline_optimizations: Applied optimization records
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "002_pipeline_intelligence"
down_revision: Union[str, None] = "001_initial"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Enum types are auto-created by sa.Enum(...) when the tables below
    # first reference them; manual CREATE TYPE calls would double-up
    # and fail on asyncpg with DuplicateObjectError.

    # Discovery Runs
    op.create_table(
        "discovery_runs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("disease", sa.String(500), nullable=False, index=True),
        sa.Column("discovery_type", sa.String(100), nullable=False),
        sa.Column("total_rounds", sa.Integer(), default=4, nullable=False),
        sa.Column("total_hypotheses", sa.Integer(), default=0, nullable=False),
        sa.Column("hypotheses_per_round", sa.Integer(), default=3, nullable=False),
        sa.Column("max_agents", sa.Integer(), default=1000, nullable=False),
        sa.Column("target_confidence", sa.Float(), default=0.95, nullable=False),
        sa.Column("best_confidence", sa.Float(), default=0.0, nullable=False),
        sa.Column("avg_confidence", sa.Float(), default=0.0, nullable=False),
        sa.Column("total_duration_seconds", sa.Float(), default=0.0, nullable=False),
        sa.Column("stages_total", sa.Integer(), default=0, nullable=False),
        sa.Column("stages_succeeded", sa.Integer(), default=0, nullable=False),
        sa.Column("stages_failed", sa.Integer(), default=0, nullable=False),
        sa.Column("total_cost_usd", sa.Float(), default=0.0, nullable=False),
        sa.Column("total_input_tokens", sa.BigInteger(), default=0, nullable=False),
        sa.Column("total_output_tokens", sa.BigInteger(), default=0, nullable=False),
        sa.Column("total_embedding_tokens", sa.BigInteger(), default=0, nullable=False),
        sa.Column("total_api_calls", sa.Integer(), default=0, nullable=False),
        sa.Column("config_snapshot", postgresql.JSONB(), default={}, nullable=False),
        sa.Column("external_factors", postgresql.JSONB(), default=[], nullable=False),
        sa.Column("focus_entities", postgresql.ARRAY(sa.String()), default=[], nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(50), default="running", nullable=False, index=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
    )
    op.create_index("ix_discovery_runs_disease_created", "discovery_runs", ["disease", "created_at"])
    op.create_index("ix_discovery_runs_status_created", "discovery_runs", ["status", "created_at"])

    # Stage Executions
    op.create_table(
        "stage_executions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("discovery_run_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("discovery_runs.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("hypothesis_id", sa.String(255), nullable=False, index=True),
        sa.Column("round_number", sa.Integer(), nullable=False),
        sa.Column("hypothesis_index", sa.Integer(), nullable=False),
        sa.Column("stage_number", sa.Integer(), nullable=False),
        sa.Column("stage_name", sa.String(50), nullable=False),
        sa.Column("model_type", sa.String(100), nullable=False, index=True),
        sa.Column("model_id", sa.String(255), nullable=True),
        sa.Column("outcome", sa.Enum("success", "partial", "failure", "skipped", "timeout", "content_filtered", name="stage_outcome"), default="success", nullable=False, index=True),
        sa.Column("duration_seconds", sa.Float(), default=0.0, nullable=False),
        sa.Column("input_tokens", sa.BigInteger(), default=0, nullable=False),
        sa.Column("output_tokens", sa.BigInteger(), default=0, nullable=False),
        sa.Column("cost_usd", sa.Float(), default=0.0, nullable=False),
        sa.Column("grounding_ratio", sa.Float(), nullable=True),
        sa.Column("grounded_claims", sa.Integer(), nullable=True),
        sa.Column("ungrounded_claims", sa.Integer(), nullable=True),
        sa.Column("confidence_delta", sa.Float(), nullable=True),
        sa.Column("evidence_sources_used", sa.Integer(), default=0, nullable=False),
        sa.Column("output_quality_score", sa.Float(), nullable=True),
        sa.Column("output_novelty_score", sa.Float(), nullable=True),
        sa.Column("output_coherence_score", sa.Float(), nullable=True),
        sa.Column("parse_success", sa.Boolean(), default=True, nullable=False),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("retry_count", sa.Integer(), default=0, nullable=False),
        sa.Column("content_filter_triggered", sa.Boolean(), default=False, nullable=False),
        sa.Column("prompt_hash", sa.String(64), nullable=True),
        sa.Column("output_hash", sa.String(64), nullable=True),
        sa.Column("prompt_length_chars", sa.Integer(), default=0, nullable=False),
        sa.Column("output_length_chars", sa.Integer(), default=0, nullable=False),
        sa.Column("metadata", postgresql.JSONB(), default={}, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
    )
    op.create_index("ix_stage_exec_run_stage", "stage_executions", ["discovery_run_id", "stage_number"])
    op.create_index("ix_stage_exec_model_outcome", "stage_executions", ["model_type", "outcome"])
    op.create_index("ix_stage_exec_hyp_stage", "stage_executions", ["hypothesis_id", "stage_number"])

    # API Cost Records
    op.create_table(
        "api_cost_records",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("discovery_run_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("discovery_runs.id", ondelete="CASCADE"), nullable=True, index=True),
        sa.Column("stage_execution_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("stage_executions.id", ondelete="SET NULL"), nullable=True, index=True),
        sa.Column("provider", sa.String(100), nullable=False, index=True),
        sa.Column("model_name", sa.String(255), nullable=False, index=True),
        sa.Column("endpoint", sa.String(500), nullable=True),
        sa.Column("api_type", sa.String(50), nullable=False),
        sa.Column("category", sa.Enum("llm_input", "llm_output", "embedding", "biomedical_api", "search_api", "storage", name="cost_category"), nullable=False, index=True),
        sa.Column("input_tokens", sa.BigInteger(), default=0, nullable=False),
        sa.Column("output_tokens", sa.BigInteger(), default=0, nullable=False),
        sa.Column("total_tokens", sa.BigInteger(), default=0, nullable=False),
        sa.Column("cached_tokens", sa.BigInteger(), default=0, nullable=False),
        sa.Column("input_cost_usd", sa.Float(), default=0.0, nullable=False),
        sa.Column("output_cost_usd", sa.Float(), default=0.0, nullable=False),
        sa.Column("total_cost_usd", sa.Float(), default=0.0, nullable=False),
        sa.Column("input_price_per_million", sa.Float(), nullable=True),
        sa.Column("output_price_per_million", sa.Float(), nullable=True),
        sa.Column("request_id", sa.String(255), nullable=True),
        sa.Column("response_status", sa.Integer(), nullable=True),
        sa.Column("latency_ms", sa.Integer(), default=0, nullable=False),
        sa.Column("is_retry", sa.Boolean(), default=False, nullable=False),
        sa.Column("retry_of", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("stage_number", sa.Integer(), nullable=True),
        sa.Column("stage_name", sa.String(50), nullable=True),
        sa.Column("hypothesis_id", sa.String(255), nullable=True),
        sa.Column("round_number", sa.Integer(), nullable=True),
        sa.Column("called_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
    )
    op.create_index("ix_api_cost_provider_model", "api_cost_records", ["provider", "model_name"])
    op.create_index("ix_api_cost_called_at", "api_cost_records", ["called_at"])
    op.create_index("ix_api_cost_category_called", "api_cost_records", ["category", "called_at"])
    op.create_index("ix_api_cost_run_stage", "api_cost_records", ["discovery_run_id", "stage_number"])

    # Model Pricing
    op.create_table(
        "model_pricing",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("provider", sa.String(100), nullable=False, index=True),
        sa.Column("model_name", sa.String(255), nullable=False, index=True),
        sa.Column("model_type", sa.String(100), nullable=True),
        sa.Column("input_price_per_million", sa.Float(), nullable=False),
        sa.Column("output_price_per_million", sa.Float(), nullable=False),
        sa.Column("cached_input_price_per_million", sa.Float(), default=0.0, nullable=False),
        sa.Column("embedding_price_per_million", sa.Float(), default=0.0, nullable=False),
        sa.Column("per_request_price", sa.Float(), default=0.0, nullable=False),
        sa.Column("effective_from", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("effective_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_current", sa.Boolean(), default=True, nullable=False, index=True),
        sa.Column("pricing_source", sa.String(255), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
    )
    op.create_index("ix_model_pricing_provider_model_current", "model_pricing", ["provider", "model_name", "is_current"])

    # Hypothesis Feedback
    op.create_table(
        "hypothesis_feedback",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("discovery_run_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("discovery_runs.id", ondelete="CASCADE"), nullable=True, index=True),
        sa.Column("hypothesis_id", sa.String(255), nullable=False, index=True),
        sa.Column("feedback_type", sa.Enum("expert_review", "automated_score", "benchmark_comparison", "literature_validation", "experimental_result", "user_rating", name="feedback_type"), nullable=False, index=True),
        sa.Column("reviewer", sa.String(255), nullable=True),
        sa.Column("overall_quality", sa.Float(), nullable=False),
        sa.Column("biological_plausibility", sa.Float(), nullable=True),
        sa.Column("evidence_strength", sa.Float(), nullable=True),
        sa.Column("novelty", sa.Float(), nullable=True),
        sa.Column("feasibility", sa.Float(), nullable=True),
        sa.Column("clinical_relevance", sa.Float(), nullable=True),
        sa.Column("mechanism_clarity", sa.Float(), nullable=True),
        sa.Column("reproducibility", sa.Float(), nullable=True),
        sa.Column("comments", sa.Text(), nullable=True),
        sa.Column("strengths", postgresql.JSONB(), default=[], nullable=False),
        sa.Column("weaknesses", postgresql.JSONB(), default=[], nullable=False),
        sa.Column("suggested_improvements", postgresql.JSONB(), default=[], nullable=False),
        sa.Column("best_stage", sa.Integer(), nullable=True),
        sa.Column("worst_stage", sa.Integer(), nullable=True),
        sa.Column("stage_contributions", postgresql.JSONB(), default={}, nullable=False),
        sa.Column("matches_known_biology", sa.Boolean(), nullable=True),
        sa.Column("novel_insight", sa.Boolean(), nullable=True),
        sa.Column("actionable", sa.Boolean(), nullable=True),
        sa.Column("disease", sa.String(500), nullable=True, index=True),
        sa.Column("round_number", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
    )
    op.create_index("ix_feedback_hyp_type", "hypothesis_feedback", ["hypothesis_id", "feedback_type"])
    op.create_index("ix_feedback_disease_quality", "hypothesis_feedback", ["disease", "overall_quality"])

    # Learning Memory State
    op.create_table(
        "learning_memory_state",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("disease", sa.String(500), nullable=True, index=True),
        sa.Column("scope", sa.String(50), default="global", nullable=False, index=True),
        sa.Column("explored_paths", postgresql.JSONB(), default=[], nullable=False),
        sa.Column("low_value_paths", postgresql.JSONB(), default=[], nullable=False),
        sa.Column("high_value_paths", postgresql.JSONB(), default={}, nullable=False),
        sa.Column("relation_scores", postgresql.JSONB(), default={}, nullable=False),
        sa.Column("entity_pair_scores", postgresql.JSONB(), default={}, nullable=False),
        sa.Column("model_performance", postgresql.JSONB(), default={}, nullable=False),
        sa.Column("stage_effectiveness", postgresql.JSONB(), default={}, nullable=False),
        sa.Column("prompt_patterns", postgresql.JSONB(), default={}, nullable=False),
        sa.Column("disease_knowledge", postgresql.JSONB(), default={}, nullable=False),
        sa.Column("grounding_stats", postgresql.JSONB(), default={}, nullable=False),
        sa.Column("optimization_history", postgresql.JSONB(), default=[], nullable=False),
        sa.Column("total_runs_incorporated", sa.Integer(), default=0, nullable=False),
        sa.Column("last_updated_from_run", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("version", sa.Integer(), default=1, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
    )
    op.create_index("ix_learning_memory_scope_disease", "learning_memory_state", ["scope", "disease"])

    # Stage Performance Aggregates
    op.create_table(
        "stage_performance_aggregates",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("stage_number", sa.Integer(), nullable=False),
        sa.Column("stage_name", sa.String(50), nullable=False),
        sa.Column("model_type", sa.String(100), nullable=False, index=True),
        sa.Column("disease", sa.String(500), nullable=True, index=True),
        sa.Column("total_executions", sa.Integer(), default=0, nullable=False),
        sa.Column("success_count", sa.Integer(), default=0, nullable=False),
        sa.Column("failure_count", sa.Integer(), default=0, nullable=False),
        sa.Column("timeout_count", sa.Integer(), default=0, nullable=False),
        sa.Column("content_filter_count", sa.Integer(), default=0, nullable=False),
        sa.Column("success_rate", sa.Float(), default=0.0, nullable=False),
        sa.Column("avg_duration_seconds", sa.Float(), default=0.0, nullable=False),
        sa.Column("p50_duration_seconds", sa.Float(), default=0.0, nullable=False),
        sa.Column("p95_duration_seconds", sa.Float(), default=0.0, nullable=False),
        sa.Column("avg_input_tokens", sa.Float(), default=0.0, nullable=False),
        sa.Column("avg_output_tokens", sa.Float(), default=0.0, nullable=False),
        sa.Column("avg_cost_usd", sa.Float(), default=0.0, nullable=False),
        sa.Column("total_cost_usd", sa.Float(), default=0.0, nullable=False),
        sa.Column("avg_grounding_ratio", sa.Float(), nullable=True),
        sa.Column("avg_confidence_delta", sa.Float(), nullable=True),
        sa.Column("avg_output_quality", sa.Float(), nullable=True),
        sa.Column("avg_evidence_sources", sa.Float(), nullable=True),
        sa.Column("last_aggregated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
    )
    op.create_index("ix_stage_perf_agg_stage_model", "stage_performance_aggregates", ["stage_number", "model_type"])
    op.create_index("ix_stage_perf_agg_stage_disease", "stage_performance_aggregates", ["stage_number", "disease"])

    # Benchmark Test Cases
    op.create_table(
        "benchmark_test_cases",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(500), nullable=False, index=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("disease", sa.String(500), nullable=False, index=True),
        sa.Column("discovery_type", sa.String(100), nullable=False),
        sa.Column("expected_title", sa.Text(), nullable=False),
        sa.Column("expected_mechanism", sa.Text(), nullable=False),
        sa.Column("expected_targets", postgresql.JSONB(), default=[], nullable=False),
        sa.Column("expected_pathways", postgresql.JSONB(), default=[], nullable=False),
        sa.Column("expected_evidence_pmids", postgresql.ARRAY(sa.String()), default=[], nullable=False),
        sa.Column("expected_confidence_min", sa.Float(), default=0.5, nullable=False),
        sa.Column("expected_key_claims", postgresql.JSONB(), default=[], nullable=False),
        sa.Column("focus_entities", postgresql.ARRAY(sa.String()), default=[], nullable=False),
        sa.Column("external_factors", postgresql.JSONB(), default=[], nullable=False),
        sa.Column("pathway_context", sa.Text(), nullable=True),
        sa.Column("mechanism_match_weight", sa.Float(), default=0.3, nullable=False),
        sa.Column("target_match_weight", sa.Float(), default=0.2, nullable=False),
        sa.Column("evidence_match_weight", sa.Float(), default=0.2, nullable=False),
        sa.Column("confidence_match_weight", sa.Float(), default=0.15, nullable=False),
        sa.Column("novelty_weight", sa.Float(), default=0.15, nullable=False),
        sa.Column("source_publication", sa.String(500), nullable=True),
        sa.Column("source_pmid", sa.String(50), nullable=True),
        sa.Column("difficulty", sa.String(50), default="medium", nullable=False),
        sa.Column("tags", postgresql.ARRAY(sa.String()), default=[], nullable=False),
        sa.Column("status", sa.Enum("active", "deprecated", "draft", name="benchmark_status"), default="active", nullable=False, index=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
    )
    op.create_index("ix_benchmark_tc_disease_status", "benchmark_test_cases", ["disease", "status"])

    # Benchmark Runs
    op.create_table(
        "benchmark_runs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(500), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("config_snapshot", postgresql.JSONB(), default={}, nullable=False),
        sa.Column("pipeline_version", sa.String(100), nullable=True),
        sa.Column("total_test_cases", sa.Integer(), default=0, nullable=False),
        sa.Column("completed_test_cases", sa.Integer(), default=0, nullable=False),
        sa.Column("avg_overall_score", sa.Float(), default=0.0, nullable=False),
        sa.Column("avg_mechanism_score", sa.Float(), default=0.0, nullable=False),
        sa.Column("avg_target_score", sa.Float(), default=0.0, nullable=False),
        sa.Column("avg_evidence_score", sa.Float(), default=0.0, nullable=False),
        sa.Column("avg_confidence_score", sa.Float(), default=0.0, nullable=False),
        sa.Column("total_cost_usd", sa.Float(), default=0.0, nullable=False),
        sa.Column("total_duration_seconds", sa.Float(), default=0.0, nullable=False),
        sa.Column("status", sa.Enum("pending", "running", "completed", "failed", "cancelled", name="benchmark_run_status"), default="pending", nullable=False, index=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
    )
    op.create_index("ix_benchmark_runs_status_created", "benchmark_runs", ["status", "created_at"])

    # Benchmark Results
    op.create_table(
        "benchmark_results",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("benchmark_run_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("benchmark_runs.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("test_case_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("benchmark_test_cases.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("discovery_run_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("discovery_runs.id", ondelete="SET NULL"), nullable=True, index=True),
        sa.Column("overall_score", sa.Float(), default=0.0, nullable=False),
        sa.Column("mechanism_match_score", sa.Float(), default=0.0, nullable=False),
        sa.Column("target_match_score", sa.Float(), default=0.0, nullable=False),
        sa.Column("evidence_match_score", sa.Float(), default=0.0, nullable=False),
        sa.Column("confidence_accuracy", sa.Float(), default=0.0, nullable=False),
        sa.Column("novelty_score", sa.Float(), default=0.0, nullable=False),
        sa.Column("stage_scores", postgresql.JSONB(), default={}, nullable=False),
        sa.Column("produced_title", sa.Text(), nullable=True),
        sa.Column("produced_mechanism", sa.Text(), nullable=True),
        sa.Column("produced_targets", postgresql.JSONB(), default=[], nullable=False),
        sa.Column("produced_confidence", sa.Float(), default=0.0, nullable=False),
        sa.Column("produced_evidence_pmids", postgresql.ARRAY(sa.String()), default=[], nullable=False),
        sa.Column("matched_targets", postgresql.JSONB(), default=[], nullable=False),
        sa.Column("missed_targets", postgresql.JSONB(), default=[], nullable=False),
        sa.Column("matched_evidence", postgresql.JSONB(), default=[], nullable=False),
        sa.Column("missed_evidence", postgresql.JSONB(), default=[], nullable=False),
        sa.Column("mechanism_analysis", sa.Text(), nullable=True),
        sa.Column("cost_usd", sa.Float(), default=0.0, nullable=False),
        sa.Column("duration_seconds", sa.Float(), default=0.0, nullable=False),
        sa.Column("status", sa.String(50), default="completed", nullable=False),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
    )
    op.create_index("ix_benchmark_result_run_case", "benchmark_results", ["benchmark_run_id", "test_case_id"])

    # Pipeline Optimizations
    op.create_table(
        "pipeline_optimizations",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("trigger", sa.String(255), nullable=False),
        sa.Column("analysis_basis", sa.Text(), nullable=True),
        sa.Column("runs_analyzed", sa.Integer(), default=0, nullable=False),
        sa.Column("action", sa.Enum("prompt_adjustment", "temperature_change", "token_allocation", "model_swap", "stage_reorder", "grounding_threshold", "evidence_weight", name="optimization_action"), nullable=False, index=True),
        sa.Column("target_stage", sa.Integer(), nullable=True),
        sa.Column("target_model", sa.String(100), nullable=True),
        sa.Column("target_disease", sa.String(500), nullable=True),
        sa.Column("parameter_name", sa.String(255), nullable=False),
        sa.Column("old_value", postgresql.JSONB(), nullable=False),
        sa.Column("new_value", postgresql.JSONB(), nullable=False),
        sa.Column("expected_improvement", sa.Text(), nullable=True),
        sa.Column("actual_improvement", sa.Float(), nullable=True),
        sa.Column("measured_after_runs", sa.Integer(), default=0, nullable=False),
        sa.Column("applied", sa.Boolean(), default=False, nullable=False),
        sa.Column("reverted", sa.Boolean(), default=False, nullable=False),
        sa.Column("revert_reason", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
    )
    op.create_index("ix_pipeline_opt_action_applied", "pipeline_optimizations", ["action", "applied"])


def downgrade() -> None:
    op.drop_table("pipeline_optimizations")
    op.drop_table("benchmark_results")
    op.drop_table("benchmark_runs")
    op.drop_table("benchmark_test_cases")
    op.drop_table("stage_performance_aggregates")
    op.drop_table("learning_memory_state")
    op.drop_table("hypothesis_feedback")
    op.drop_table("model_pricing")
    op.drop_table("api_cost_records")
    op.drop_table("stage_executions")
    op.drop_table("discovery_runs")

    op.execute("DROP TYPE IF EXISTS optimization_action")
    op.execute("DROP TYPE IF EXISTS benchmark_run_status")
    op.execute("DROP TYPE IF EXISTS benchmark_status")
    op.execute("DROP TYPE IF EXISTS feedback_type")
    op.execute("DROP TYPE IF EXISTS cost_category")
    op.execute("DROP TYPE IF EXISTS stage_outcome")
