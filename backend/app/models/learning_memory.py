"""
Learning Memory Models

PostgreSQL-backed persistent learning memory for the 10-stage discovery pipeline.
Tracks stage performance, model effectiveness, hypothesis quality feedback,
API call costs, and benchmark results across all discovery runs.
"""

from enum import Enum as PyEnum

from sqlalchemy import (
    BigInteger,
    Boolean,
    Column,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import relationship

from app.models.base import BaseModel


# ============== Enums ==============


class FeedbackType(str, PyEnum):
    """Type of feedback on a hypothesis or stage output."""
    EXPERT_REVIEW = "expert_review"
    AUTOMATED_SCORE = "automated_score"
    BENCHMARK_COMPARISON = "benchmark_comparison"
    LITERATURE_VALIDATION = "literature_validation"
    EXPERIMENTAL_RESULT = "experimental_result"
    USER_RATING = "user_rating"


class StageOutcome(str, PyEnum):
    """Outcome classification of a pipeline stage."""
    SUCCESS = "success"
    PARTIAL = "partial"
    FAILURE = "failure"
    SKIPPED = "skipped"
    TIMEOUT = "timeout"
    CONTENT_FILTERED = "content_filtered"


class CostCategory(str, PyEnum):
    """Category for API cost tracking."""
    LLM_INPUT = "llm_input"
    LLM_OUTPUT = "llm_output"
    EMBEDDING = "embedding"
    BIOMEDICAL_API = "biomedical_api"
    SEARCH_API = "search_api"
    STORAGE = "storage"


class BenchmarkStatus(str, PyEnum):
    """Status of a benchmark test case."""
    ACTIVE = "active"
    DEPRECATED = "deprecated"
    DRAFT = "draft"


class BenchmarkRunStatus(str, PyEnum):
    """Status of a benchmark run."""
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class OptimizationAction(str, PyEnum):
    """Type of optimization action taken."""
    PROMPT_ADJUSTMENT = "prompt_adjustment"
    TEMPERATURE_CHANGE = "temperature_change"
    TOKEN_ALLOCATION = "token_allocation"
    MODEL_SWAP = "model_swap"
    STAGE_REORDER = "stage_reorder"
    GROUNDING_THRESHOLD = "grounding_threshold"
    EVIDENCE_WEIGHT = "evidence_weight"


# ============== Discovery Run Tracking ==============


class DiscoveryRun(BaseModel):
    """Record of a complete discovery pipeline run (all 4 rounds, all hypotheses)."""

    __tablename__ = "discovery_runs"

    disease = Column(String(500), nullable=False, index=True)
    discovery_type = Column(String(100), nullable=False)
    total_rounds = Column(Integer, default=4, nullable=False)
    total_hypotheses = Column(Integer, default=0, nullable=False)
    hypotheses_per_round = Column(Integer, default=3, nullable=False)
    max_agents = Column(Integer, default=1000, nullable=False)
    target_confidence = Column(Float, default=0.95, nullable=False)

    # Results
    best_confidence = Column(Float, default=0.0, nullable=False)
    avg_confidence = Column(Float, default=0.0, nullable=False)
    total_duration_seconds = Column(Float, default=0.0, nullable=False)
    stages_total = Column(Integer, default=0, nullable=False)
    stages_succeeded = Column(Integer, default=0, nullable=False)
    stages_failed = Column(Integer, default=0, nullable=False)

    # Cost summary (aggregated from individual API calls)
    total_cost_usd = Column(Float, default=0.0, nullable=False)
    total_input_tokens = Column(BigInteger, default=0, nullable=False)
    total_output_tokens = Column(BigInteger, default=0, nullable=False)
    total_embedding_tokens = Column(BigInteger, default=0, nullable=False)
    total_api_calls = Column(Integer, default=0, nullable=False)

    # Configuration snapshot
    config_snapshot = Column(JSONB, default=dict, nullable=False)
    external_factors = Column(JSONB, default=list, nullable=False)
    focus_entities = Column(ARRAY(String), default=list, nullable=False)

    # Status
    started_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    status = Column(String(50), default="running", nullable=False, index=True)

    # Relationships
    stage_executions = relationship(
        "StageExecution",
        back_populates="discovery_run",
        lazy="selectin",
        cascade="all, delete-orphan",
    )
    api_cost_records = relationship(
        "APICostRecord",
        back_populates="discovery_run",
        lazy="dynamic",
        cascade="all, delete-orphan",
    )
    feedback_records = relationship(
        "HypothesisFeedback",
        back_populates="discovery_run",
        lazy="dynamic",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        Index("ix_discovery_runs_disease_created", "disease", "created_at"),
        Index("ix_discovery_runs_status_created", "status", "created_at"),
    )


class StageExecution(BaseModel):
    """Record of a single stage execution within the 10-stage pipeline."""

    __tablename__ = "stage_executions"

    discovery_run_id = Column(
        PGUUID(as_uuid=True),
        ForeignKey("discovery_runs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    hypothesis_id = Column(String(255), nullable=False, index=True)
    round_number = Column(Integer, nullable=False)
    hypothesis_index = Column(Integer, nullable=False)

    # Stage info
    stage_number = Column(Integer, nullable=False)
    stage_name = Column(String(50), nullable=False)
    model_type = Column(String(100), nullable=False, index=True)
    model_id = Column(String(255), nullable=True)

    # Execution metrics
    outcome = Column(
        Enum(StageOutcome, name="stage_outcome", values_callable=lambda x: [e.value for e in x]),
        default=StageOutcome.SUCCESS,
        nullable=False,
        index=True,
    )
    duration_seconds = Column(Float, default=0.0, nullable=False)
    input_tokens = Column(BigInteger, default=0, nullable=False)
    output_tokens = Column(BigInteger, default=0, nullable=False)
    cost_usd = Column(Float, default=0.0, nullable=False)

    # Quality metrics
    grounding_ratio = Column(Float, nullable=True)
    grounded_claims = Column(Integer, nullable=True)
    ungrounded_claims = Column(Integer, nullable=True)
    confidence_delta = Column(Float, nullable=True)
    evidence_sources_used = Column(Integer, default=0, nullable=False)

    # Output analysis
    output_quality_score = Column(Float, nullable=True)
    output_novelty_score = Column(Float, nullable=True)
    output_coherence_score = Column(Float, nullable=True)
    parse_success = Column(Boolean, default=True, nullable=False)

    # Error tracking
    error_message = Column(Text, nullable=True)
    retry_count = Column(Integer, default=0, nullable=False)
    content_filter_triggered = Column(Boolean, default=False, nullable=False)

    # Raw data (for debugging and analysis)
    prompt_hash = Column(String(64), nullable=True)
    output_hash = Column(String(64), nullable=True)
    prompt_length_chars = Column(Integer, default=0, nullable=False)
    output_length_chars = Column(Integer, default=0, nullable=False)

    # Metadata (attribute renamed to avoid clash with SQLAlchemy reserved name)
    extra_metadata = Column("metadata", JSONB, default=dict, nullable=False)

    # Relationships
    discovery_run = relationship("DiscoveryRun", back_populates="stage_executions")

    __table_args__ = (
        Index("ix_stage_exec_run_stage", "discovery_run_id", "stage_number"),
        Index("ix_stage_exec_model_outcome", "model_type", "outcome"),
        Index("ix_stage_exec_hyp_stage", "hypothesis_id", "stage_number"),
    )


# ============== API Cost Tracking ==============


class APICostRecord(BaseModel):
    """Individual API call cost record — tracks every single API call with actual token counts."""

    __tablename__ = "api_cost_records"

    discovery_run_id = Column(
        PGUUID(as_uuid=True),
        ForeignKey("discovery_runs.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    stage_execution_id = Column(
        PGUUID(as_uuid=True),
        ForeignKey("stage_executions.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # API identification
    provider = Column(String(100), nullable=False, index=True)
    model_name = Column(String(255), nullable=False, index=True)
    endpoint = Column(String(500), nullable=True)
    api_type = Column(String(50), nullable=False)

    # Cost category
    category = Column(
        Enum(CostCategory, name="cost_category", values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        index=True,
    )

    # Token counts (from actual API response, not estimated)
    input_tokens = Column(BigInteger, default=0, nullable=False)
    output_tokens = Column(BigInteger, default=0, nullable=False)
    total_tokens = Column(BigInteger, default=0, nullable=False)
    cached_tokens = Column(BigInteger, default=0, nullable=False)

    # Cost (calculated from provider pricing at time of call)
    input_cost_usd = Column(Float, default=0.0, nullable=False)
    output_cost_usd = Column(Float, default=0.0, nullable=False)
    total_cost_usd = Column(Float, default=0.0, nullable=False)

    # Pricing rates used (for audit trail)
    input_price_per_million = Column(Float, nullable=True)
    output_price_per_million = Column(Float, nullable=True)

    # Request metadata
    request_id = Column(String(255), nullable=True)
    response_status = Column(Integer, nullable=True)
    latency_ms = Column(Integer, default=0, nullable=False)
    is_retry = Column(Boolean, default=False, nullable=False)
    retry_of = Column(PGUUID(as_uuid=True), nullable=True)

    # Context
    stage_number = Column(Integer, nullable=True)
    stage_name = Column(String(50), nullable=True)
    hypothesis_id = Column(String(255), nullable=True)
    round_number = Column(Integer, nullable=True)

    # Timestamps
    called_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Relationships
    discovery_run = relationship("DiscoveryRun", back_populates="api_cost_records")

    __table_args__ = (
        Index("ix_api_cost_provider_model", "provider", "model_name"),
        Index("ix_api_cost_called_at", "called_at"),
        Index("ix_api_cost_category_called", "category", "called_at"),
        Index("ix_api_cost_run_stage", "discovery_run_id", "stage_number"),
    )


# ============== Model Pricing ==============


class ModelPricing(BaseModel):
    """Current and historical pricing for each model/provider combination.

    Updated from provider dashboards. Cost calculations use the pricing
    record that was active at the time of the API call.
    """

    __tablename__ = "model_pricing"

    provider = Column(String(100), nullable=False, index=True)
    model_name = Column(String(255), nullable=False, index=True)
    model_type = Column(String(100), nullable=True)

    # Pricing per million tokens
    input_price_per_million = Column(Float, nullable=False)
    output_price_per_million = Column(Float, nullable=False)
    cached_input_price_per_million = Column(Float, default=0.0, nullable=False)

    # Embedding pricing (per million tokens)
    embedding_price_per_million = Column(Float, default=0.0, nullable=False)

    # Per-request pricing (for biomedical APIs)
    per_request_price = Column(Float, default=0.0, nullable=False)

    # Validity period
    effective_from = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    effective_until = Column(DateTime(timezone=True), nullable=True)
    is_current = Column(Boolean, default=True, nullable=False, index=True)

    # Source
    pricing_source = Column(String(255), nullable=True)
    notes = Column(Text, nullable=True)

    __table_args__ = (
        Index("ix_model_pricing_provider_model_current", "provider", "model_name", "is_current"),
    )


# ============== Hypothesis Feedback ==============


class HypothesisFeedback(BaseModel):
    """Feedback on a generated hypothesis — feeds into learning memory."""

    __tablename__ = "hypothesis_feedback"

    discovery_run_id = Column(
        PGUUID(as_uuid=True),
        ForeignKey("discovery_runs.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    hypothesis_id = Column(String(255), nullable=False, index=True)

    # Feedback type and source
    feedback_type = Column(
        Enum(FeedbackType, name="feedback_type", values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        index=True,
    )
    reviewer = Column(String(255), nullable=True)

    # Scores (all 0.0-1.0)
    overall_quality = Column(Float, nullable=False)
    biological_plausibility = Column(Float, nullable=True)
    evidence_strength = Column(Float, nullable=True)
    novelty = Column(Float, nullable=True)
    feasibility = Column(Float, nullable=True)
    clinical_relevance = Column(Float, nullable=True)
    mechanism_clarity = Column(Float, nullable=True)
    reproducibility = Column(Float, nullable=True)

    # Textual feedback
    comments = Column(Text, nullable=True)
    strengths = Column(JSONB, default=list, nullable=False)
    weaknesses = Column(JSONB, default=list, nullable=False)
    suggested_improvements = Column(JSONB, default=list, nullable=False)

    # Stage-level feedback (which stages contributed most/least)
    best_stage = Column(Integer, nullable=True)
    worst_stage = Column(Integer, nullable=True)
    stage_contributions = Column(JSONB, default=dict, nullable=False)

    # Comparison to known results
    matches_known_biology = Column(Boolean, nullable=True)
    novel_insight = Column(Boolean, nullable=True)
    actionable = Column(Boolean, nullable=True)

    # Context
    disease = Column(String(500), nullable=True, index=True)
    round_number = Column(Integer, nullable=True)

    # Relationships
    discovery_run = relationship("DiscoveryRun", back_populates="feedback_records")

    __table_args__ = (
        Index("ix_feedback_hyp_type", "hypothesis_id", "feedback_type"),
        Index("ix_feedback_disease_quality", "disease", "overall_quality"),
    )


# ============== Learning Memory State ==============


class LearningMemoryState(BaseModel):
    """Persistent learning memory — stores accumulated knowledge about
    model performance, stage effectiveness, and discovery patterns.

    This replaces the in-memory LearningMemory class with PostgreSQL persistence.
    """

    __tablename__ = "learning_memory_state"

    # Scope
    disease = Column(String(500), nullable=True, index=True)
    scope = Column(String(50), default="global", nullable=False, index=True)

    # Path learning (serialized from in-memory sets/dicts)
    explored_paths = Column(JSONB, default=list, nullable=False)
    low_value_paths = Column(JSONB, default=list, nullable=False)
    high_value_paths = Column(JSONB, default=dict, nullable=False)
    relation_scores = Column(JSONB, default=dict, nullable=False)
    entity_pair_scores = Column(JSONB, default=dict, nullable=False)

    # Model performance (per-model statistics)
    model_performance = Column(JSONB, default=dict, nullable=False)

    # Stage effectiveness (per-stage statistics)
    stage_effectiveness = Column(JSONB, default=dict, nullable=False)

    # Prompt effectiveness (which prompt patterns produce best results)
    prompt_patterns = Column(JSONB, default=dict, nullable=False)

    # Disease-specific knowledge (what works for which diseases)
    disease_knowledge = Column(JSONB, default=dict, nullable=False)

    # Grounding statistics
    grounding_stats = Column(JSONB, default=dict, nullable=False)

    # Optimization history
    optimization_history = Column(JSONB, default=list, nullable=False)

    # Metadata
    total_runs_incorporated = Column(Integer, default=0, nullable=False)
    last_updated_from_run = Column(PGUUID(as_uuid=True), nullable=True)
    version = Column(Integer, default=1, nullable=False)

    __table_args__ = (
        Index("ix_learning_memory_scope_disease", "scope", "disease"),
    )


# ============== Stage Performance Aggregate ==============


class StagePerformanceAggregate(BaseModel):
    """Pre-computed aggregate statistics for each stage+model combination.

    Updated after every discovery run to enable fast optimization queries.
    """

    __tablename__ = "stage_performance_aggregates"

    stage_number = Column(Integer, nullable=False)
    stage_name = Column(String(50), nullable=False)
    model_type = Column(String(100), nullable=False, index=True)
    disease = Column(String(500), nullable=True, index=True)

    # Execution stats
    total_executions = Column(Integer, default=0, nullable=False)
    success_count = Column(Integer, default=0, nullable=False)
    failure_count = Column(Integer, default=0, nullable=False)
    timeout_count = Column(Integer, default=0, nullable=False)
    content_filter_count = Column(Integer, default=0, nullable=False)
    success_rate = Column(Float, default=0.0, nullable=False)

    # Performance stats
    avg_duration_seconds = Column(Float, default=0.0, nullable=False)
    p50_duration_seconds = Column(Float, default=0.0, nullable=False)
    p95_duration_seconds = Column(Float, default=0.0, nullable=False)
    avg_input_tokens = Column(Float, default=0.0, nullable=False)
    avg_output_tokens = Column(Float, default=0.0, nullable=False)
    avg_cost_usd = Column(Float, default=0.0, nullable=False)
    total_cost_usd = Column(Float, default=0.0, nullable=False)

    # Quality stats
    avg_grounding_ratio = Column(Float, nullable=True)
    avg_confidence_delta = Column(Float, nullable=True)
    avg_output_quality = Column(Float, nullable=True)
    avg_evidence_sources = Column(Float, nullable=True)

    # Last updated
    last_aggregated_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        Index("ix_stage_perf_agg_stage_model", "stage_number", "model_type"),
        Index("ix_stage_perf_agg_stage_disease", "stage_number", "disease"),
    )


# ============== Retrospective Benchmark ==============


class BenchmarkTestCase(BaseModel):
    """A known-good discovery test case for retrospective benchmarking.

    Users populate these with published/validated discoveries.
    The benchmark framework runs the pipeline against these and measures quality.
    """

    __tablename__ = "benchmark_test_cases"

    # Test case identification
    name = Column(String(500), nullable=False, index=True)
    description = Column(Text, nullable=True)
    disease = Column(String(500), nullable=False, index=True)
    discovery_type = Column(String(100), nullable=False)

    # Expected output (the known-good discovery)
    expected_title = Column(Text, nullable=False)
    expected_mechanism = Column(Text, nullable=False)
    expected_targets = Column(JSONB, default=list, nullable=False)
    expected_pathways = Column(JSONB, default=list, nullable=False)
    expected_evidence_pmids = Column(ARRAY(String), default=list, nullable=False)
    expected_confidence_min = Column(Float, default=0.5, nullable=False)
    expected_key_claims = Column(JSONB, default=list, nullable=False)

    # Input configuration
    focus_entities = Column(ARRAY(String), default=list, nullable=False)
    external_factors = Column(JSONB, default=list, nullable=False)
    pathway_context = Column(Text, nullable=True)

    # Scoring weights (how to evaluate pipeline output against expected)
    mechanism_match_weight = Column(Float, default=0.3, nullable=False)
    target_match_weight = Column(Float, default=0.2, nullable=False)
    evidence_match_weight = Column(Float, default=0.2, nullable=False)
    confidence_match_weight = Column(Float, default=0.15, nullable=False)
    novelty_weight = Column(Float, default=0.15, nullable=False)

    # Metadata
    source_publication = Column(String(500), nullable=True)
    source_pmid = Column(String(50), nullable=True)
    difficulty = Column(String(50), default="medium", nullable=False)
    tags = Column(ARRAY(String), default=list, nullable=False)
    status = Column(
        Enum(BenchmarkStatus, name="benchmark_status", values_callable=lambda x: [e.value for e in x]),
        default=BenchmarkStatus.ACTIVE,
        nullable=False,
        index=True,
    )

    # Relationships
    benchmark_results = relationship(
        "BenchmarkResult",
        back_populates="test_case",
        lazy="dynamic",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        Index("ix_benchmark_tc_disease_status", "disease", "status"),
    )


class BenchmarkRun(BaseModel):
    """A complete benchmark run across multiple test cases."""

    __tablename__ = "benchmark_runs"

    name = Column(String(500), nullable=True)
    description = Column(Text, nullable=True)

    # Configuration used
    config_snapshot = Column(JSONB, default=dict, nullable=False)
    pipeline_version = Column(String(100), nullable=True)

    # Aggregate results
    total_test_cases = Column(Integer, default=0, nullable=False)
    completed_test_cases = Column(Integer, default=0, nullable=False)
    avg_overall_score = Column(Float, default=0.0, nullable=False)
    avg_mechanism_score = Column(Float, default=0.0, nullable=False)
    avg_target_score = Column(Float, default=0.0, nullable=False)
    avg_evidence_score = Column(Float, default=0.0, nullable=False)
    avg_confidence_score = Column(Float, default=0.0, nullable=False)

    # Cost
    total_cost_usd = Column(Float, default=0.0, nullable=False)
    total_duration_seconds = Column(Float, default=0.0, nullable=False)

    # Status
    status = Column(
        Enum(BenchmarkRunStatus, name="benchmark_run_status", values_callable=lambda x: [e.value for e in x]),
        default=BenchmarkRunStatus.PENDING,
        nullable=False,
        index=True,
    )
    started_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)

    # Relationships
    results = relationship(
        "BenchmarkResult",
        back_populates="benchmark_run",
        lazy="selectin",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        Index("ix_benchmark_runs_status_created", "status", "created_at"),
    )


class BenchmarkResult(BaseModel):
    """Result of running a single benchmark test case."""

    __tablename__ = "benchmark_results"

    benchmark_run_id = Column(
        PGUUID(as_uuid=True),
        ForeignKey("benchmark_runs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    test_case_id = Column(
        PGUUID(as_uuid=True),
        ForeignKey("benchmark_test_cases.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    discovery_run_id = Column(
        PGUUID(as_uuid=True),
        ForeignKey("discovery_runs.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # Scores (all 0.0-1.0)
    overall_score = Column(Float, default=0.0, nullable=False)
    mechanism_match_score = Column(Float, default=0.0, nullable=False)
    target_match_score = Column(Float, default=0.0, nullable=False)
    evidence_match_score = Column(Float, default=0.0, nullable=False)
    confidence_accuracy = Column(Float, default=0.0, nullable=False)
    novelty_score = Column(Float, default=0.0, nullable=False)

    # Per-stage contribution scores
    stage_scores = Column(JSONB, default=dict, nullable=False)

    # What the pipeline actually produced
    produced_title = Column(Text, nullable=True)
    produced_mechanism = Column(Text, nullable=True)
    produced_targets = Column(JSONB, default=list, nullable=False)
    produced_confidence = Column(Float, default=0.0, nullable=False)
    produced_evidence_pmids = Column(ARRAY(String), default=list, nullable=False)

    # Detailed comparison
    matched_targets = Column(JSONB, default=list, nullable=False)
    missed_targets = Column(JSONB, default=list, nullable=False)
    matched_evidence = Column(JSONB, default=list, nullable=False)
    missed_evidence = Column(JSONB, default=list, nullable=False)
    mechanism_analysis = Column(Text, nullable=True)

    # Cost and performance
    cost_usd = Column(Float, default=0.0, nullable=False)
    duration_seconds = Column(Float, default=0.0, nullable=False)

    # Status
    status = Column(String(50), default="completed", nullable=False)
    error_message = Column(Text, nullable=True)

    # Relationships
    benchmark_run = relationship("BenchmarkRun", back_populates="results")
    test_case = relationship("BenchmarkTestCase", back_populates="benchmark_results")

    __table_args__ = (
        Index("ix_benchmark_result_run_case", "benchmark_run_id", "test_case_id"),
    )


# ============== Pipeline Optimization ==============


class PipelineOptimization(BaseModel):
    """Record of an optimization action taken based on learning memory analysis."""

    __tablename__ = "pipeline_optimizations"

    # What triggered the optimization
    trigger = Column(String(255), nullable=False)
    analysis_basis = Column(Text, nullable=True)
    runs_analyzed = Column(Integer, default=0, nullable=False)

    # What was changed
    action = Column(
        Enum(OptimizationAction, name="optimization_action", values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        index=True,
    )
    target_stage = Column(Integer, nullable=True)
    target_model = Column(String(100), nullable=True)
    target_disease = Column(String(500), nullable=True)

    # Before/after values
    parameter_name = Column(String(255), nullable=False)
    old_value = Column(JSONB, nullable=False)
    new_value = Column(JSONB, nullable=False)

    # Impact measurement
    expected_improvement = Column(Text, nullable=True)
    actual_improvement = Column(Float, nullable=True)
    measured_after_runs = Column(Integer, default=0, nullable=False)

    # Status
    applied = Column(Boolean, default=False, nullable=False)
    reverted = Column(Boolean, default=False, nullable=False)
    revert_reason = Column(Text, nullable=True)

    __table_args__ = (
        Index("ix_pipeline_opt_action_applied", "action", "applied"),
    )
