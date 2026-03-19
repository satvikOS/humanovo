"""
Cost Tracking Service — Accurate Per-API-Call Cost Tracking

Tracks every single LLM and biomedical API call with actual token counts
from provider responses (not estimates). Calculates costs using provider pricing
at the time of the call.

Provides:
- Per-call cost recording with actual tokens from API responses
- Per-stage, per-model, per-run cost breakdowns
- Time-series cost data for visualization
- Provider-specific pricing management
- Full audit trail matching provider usage dashboards
"""

import asyncio
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Optional
from uuid import uuid4

from sqlalchemy import and_, desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import async_session_factory
from app.core.logging import get_logger
from app.models.learning_memory import (
    APICostRecord,
    CostCategory,
    DiscoveryRun,
    ModelPricing,
)

logger = get_logger(__name__)


# ============== Provider Pricing (as of API call time) ==============

# These are the actual prices from each provider's pricing page.
# Updated pricing is stored in the model_pricing table for audit trail.
# All prices are per million tokens.

CURRENT_PRICING = {
    # AWS Bedrock — Claude Opus 4.6
    ("aws_bedrock", "us.anthropic.claude-opus-4-6-v1:0"): {
        "input": 15.00,
        "output": 75.00,
        "cached_input": 1.50,
    },
    # Azure AI — Mistral-Large-3
    ("azure_ai", "Mistral-Large-3"): {
        "input": 2.00,
        "output": 6.00,
        "cached_input": 0.20,
    },
    # Azure OpenAI — GPT-4o
    ("azure_openai", "gpt-4o"): {
        "input": 2.50,
        "output": 10.00,
        "cached_input": 1.25,
    },
    # Azure OpenAI — Cohere Command A
    ("azure_openai", "cohere-command-a"): {
        "input": 2.50,
        "output": 10.00,
        "cached_input": 0.0,
    },
    # Azure OpenAI — o3-mini
    ("azure_openai", "o3-mini"): {
        "input": 1.10,
        "output": 4.40,
        "cached_input": 0.55,
    },
    # Azure OpenAI — GPT-4.1
    ("azure_openai", "gpt-4.1"): {
        "input": 2.00,
        "output": 8.00,
        "cached_input": 0.50,
    },
    # Azure AI — Grok-4-1-fast-reasoning
    ("azure_ai", "grok-4-1-fast-reasoning"): {
        "input": 3.00,
        "output": 12.00,
        "cached_input": 0.0,
    },
    # Azure OpenAI — Embeddings
    ("azure_openai", "text-embedding-3-large"): {
        "input": 0.13,
        "output": 0.0,
        "cached_input": 0.0,
    },
    ("azure_openai", "text-embedding-3-small"): {
        "input": 0.02,
        "output": 0.0,
        "cached_input": 0.0,
    },
    # AWS Bedrock — Cohere Embed v3
    ("aws_bedrock", "cohere.embed-english-v3"): {
        "input": 0.10,
        "output": 0.0,
        "cached_input": 0.0,
    },
}

# Biomedical API costs (per request — most are free but some have usage tiers)
BIOMEDICAL_API_PRICING = {
    "pubmed": 0.0,
    "clinical_trials": 0.0,
    "openfda": 0.0,
    "uniprot": 0.0,
    "reactome": 0.0,
    "kegg": 0.0,
    "ensembl": 0.0,
    "hmdb": 0.0,
    "chebi": 0.0,
    "ncbi_gene": 0.0,
    "clinvar": 0.0,
    "cell_ontology": 0.0,
    "fma": 0.0,
    "hca": 0.0,
    "elsevier_scopus": 0.0,  # Institutional license
    "springer_nature": 0.0,
}


def calculate_cost(
    provider: str,
    model_name: str,
    input_tokens: int,
    output_tokens: int,
    cached_tokens: int = 0,
) -> tuple[float, float, float]:
    """Calculate cost from actual token counts using current pricing.

    Returns: (input_cost, output_cost, total_cost) in USD.
    """
    key = (provider, model_name)
    pricing = CURRENT_PRICING.get(key)

    if not pricing:
        # Try partial match
        for (p, m), pr in CURRENT_PRICING.items():
            if p == provider and model_name.lower() in m.lower():
                pricing = pr
                break

    if not pricing:
        logger.warning(f"No pricing found for {provider}/{model_name}, recording $0")
        return 0.0, 0.0, 0.0

    # Cached tokens are charged at cached rate, rest at full rate
    non_cached_input = max(0, input_tokens - cached_tokens)
    input_cost = (non_cached_input * pricing["input"] / 1_000_000) + \
                 (cached_tokens * pricing.get("cached_input", 0) / 1_000_000)
    output_cost = output_tokens * pricing["output"] / 1_000_000
    total_cost = input_cost + output_cost

    return input_cost, output_cost, total_cost


class CostTrackingService:
    """Tracks every API call with actual token counts and costs.

    Records are stored in PostgreSQL and queryable for:
    - Real-time cost dashboards
    - Per-run cost breakdowns
    - Model cost comparisons
    - Time-series cost analysis
    - Provider usage verification
    """

    def __init__(self, session_factory=None):
        self._session_factory = session_factory or async_session_factory

    async def record_llm_call(
        self,
        provider: str,
        model_name: str,
        input_tokens: int,
        output_tokens: int,
        cached_tokens: int = 0,
        latency_ms: int = 0,
        discovery_run_id: str = None,
        stage_execution_id: str = None,
        stage_number: int = None,
        stage_name: str = None,
        hypothesis_id: str = None,
        round_number: int = None,
        request_id: str = None,
        response_status: int = 200,
        is_retry: bool = False,
        retry_of: str = None,
        endpoint: str = None,
    ) -> str:
        """Record a single LLM API call with actual token counts from the response.

        This is called AFTER the API response is received, using the actual
        usage data from the response (not estimates).
        """
        input_cost, output_cost, total_cost = calculate_cost(
            provider, model_name, input_tokens, output_tokens, cached_tokens
        )

        pricing = CURRENT_PRICING.get((provider, model_name), {})

        async with self._session_factory() as session:
            async with session.begin():
                record = APICostRecord(
                    discovery_run_id=discovery_run_id,
                    stage_execution_id=stage_execution_id,
                    provider=provider,
                    model_name=model_name,
                    endpoint=endpoint,
                    api_type="llm",
                    category=CostCategory.LLM_INPUT if input_tokens > output_tokens else CostCategory.LLM_OUTPUT,
                    input_tokens=input_tokens,
                    output_tokens=output_tokens,
                    total_tokens=input_tokens + output_tokens,
                    cached_tokens=cached_tokens,
                    input_cost_usd=input_cost,
                    output_cost_usd=output_cost,
                    total_cost_usd=total_cost,
                    input_price_per_million=pricing.get("input"),
                    output_price_per_million=pricing.get("output"),
                    request_id=request_id,
                    response_status=response_status,
                    latency_ms=latency_ms,
                    is_retry=is_retry,
                    retry_of=retry_of,
                    stage_number=stage_number,
                    stage_name=stage_name,
                    hypothesis_id=hypothesis_id,
                    round_number=round_number,
                    called_at=datetime.utcnow(),
                )
                session.add(record)
                await session.flush()
                return str(record.id)

    async def record_embedding_call(
        self,
        provider: str,
        model_name: str,
        total_tokens: int,
        latency_ms: int = 0,
        discovery_run_id: str = None,
        stage_number: int = None,
        hypothesis_id: str = None,
    ) -> str:
        """Record an embedding API call."""
        pricing = CURRENT_PRICING.get((provider, model_name), {})
        cost = total_tokens * pricing.get("input", 0) / 1_000_000

        async with self._session_factory() as session:
            async with session.begin():
                record = APICostRecord(
                    discovery_run_id=discovery_run_id,
                    provider=provider,
                    model_name=model_name,
                    api_type="embedding",
                    category=CostCategory.EMBEDDING,
                    input_tokens=total_tokens,
                    output_tokens=0,
                    total_tokens=total_tokens,
                    cached_tokens=0,
                    input_cost_usd=cost,
                    output_cost_usd=0.0,
                    total_cost_usd=cost,
                    input_price_per_million=pricing.get("input"),
                    latency_ms=latency_ms,
                    stage_number=stage_number,
                    hypothesis_id=hypothesis_id,
                    called_at=datetime.utcnow(),
                )
                session.add(record)
                await session.flush()
                return str(record.id)

    async def record_biomedical_api_call(
        self,
        api_name: str,
        latency_ms: int = 0,
        discovery_run_id: str = None,
        stage_number: int = None,
        hypothesis_id: str = None,
        endpoint: str = None,
        response_status: int = 200,
    ) -> str:
        """Record a biomedical API call (PubMed, ClinicalTrials, etc.)."""
        cost = BIOMEDICAL_API_PRICING.get(api_name, 0.0)

        async with self._session_factory() as session:
            async with session.begin():
                record = APICostRecord(
                    discovery_run_id=discovery_run_id,
                    provider=api_name,
                    model_name=api_name,
                    endpoint=endpoint,
                    api_type="biomedical",
                    category=CostCategory.BIOMEDICAL_API,
                    input_tokens=0,
                    output_tokens=0,
                    total_tokens=0,
                    cached_tokens=0,
                    input_cost_usd=0.0,
                    output_cost_usd=0.0,
                    total_cost_usd=cost,
                    per_request_price=cost,
                    response_status=response_status,
                    latency_ms=latency_ms,
                    stage_number=stage_number,
                    hypothesis_id=hypothesis_id,
                    called_at=datetime.utcnow(),
                )
                session.add(record)
                await session.flush()
                return str(record.id)

    # ============== Query Methods for Visualization ==============

    async def get_run_cost_breakdown(self, run_id: str) -> dict[str, Any]:
        """Get complete cost breakdown for a discovery run."""
        async with self._session_factory() as session:
            # Total by provider
            by_provider = await session.execute(
                select(
                    APICostRecord.provider,
                    func.sum(APICostRecord.total_cost_usd).label("cost"),
                    func.sum(APICostRecord.input_tokens).label("input_tokens"),
                    func.sum(APICostRecord.output_tokens).label("output_tokens"),
                    func.count(APICostRecord.id).label("calls"),
                    func.avg(APICostRecord.latency_ms).label("avg_latency"),
                )
                .where(APICostRecord.discovery_run_id == run_id)
                .group_by(APICostRecord.provider)
            )

            # Total by model
            by_model = await session.execute(
                select(
                    APICostRecord.model_name,
                    APICostRecord.provider,
                    func.sum(APICostRecord.total_cost_usd).label("cost"),
                    func.sum(APICostRecord.input_tokens).label("input_tokens"),
                    func.sum(APICostRecord.output_tokens).label("output_tokens"),
                    func.count(APICostRecord.id).label("calls"),
                )
                .where(APICostRecord.discovery_run_id == run_id)
                .group_by(APICostRecord.model_name, APICostRecord.provider)
            )

            # Total by stage
            by_stage = await session.execute(
                select(
                    APICostRecord.stage_number,
                    APICostRecord.stage_name,
                    func.sum(APICostRecord.total_cost_usd).label("cost"),
                    func.sum(APICostRecord.input_tokens).label("input_tokens"),
                    func.sum(APICostRecord.output_tokens).label("output_tokens"),
                    func.count(APICostRecord.id).label("calls"),
                )
                .where(
                    and_(
                        APICostRecord.discovery_run_id == run_id,
                        APICostRecord.stage_number.isnot(None),
                    )
                )
                .group_by(APICostRecord.stage_number, APICostRecord.stage_name)
                .order_by(APICostRecord.stage_number)
            )

            # Total by category
            by_category = await session.execute(
                select(
                    APICostRecord.category,
                    func.sum(APICostRecord.total_cost_usd).label("cost"),
                    func.count(APICostRecord.id).label("calls"),
                )
                .where(APICostRecord.discovery_run_id == run_id)
                .group_by(APICostRecord.category)
            )

            # Total by round
            by_round = await session.execute(
                select(
                    APICostRecord.round_number,
                    func.sum(APICostRecord.total_cost_usd).label("cost"),
                    func.count(APICostRecord.id).label("calls"),
                )
                .where(
                    and_(
                        APICostRecord.discovery_run_id == run_id,
                        APICostRecord.round_number.isnot(None),
                    )
                )
                .group_by(APICostRecord.round_number)
                .order_by(APICostRecord.round_number)
            )

            # Grand total
            total = await session.execute(
                select(
                    func.sum(APICostRecord.total_cost_usd).label("total_cost"),
                    func.sum(APICostRecord.input_tokens).label("total_input"),
                    func.sum(APICostRecord.output_tokens).label("total_output"),
                    func.sum(APICostRecord.total_tokens).label("total_tokens"),
                    func.count(APICostRecord.id).label("total_calls"),
                    func.sum(APICostRecord.latency_ms).label("total_latency"),
                )
                .where(APICostRecord.discovery_run_id == run_id)
            )
            total_row = total.one()

            return {
                "run_id": run_id,
                "total": {
                    "cost_usd": float(total_row.total_cost or 0),
                    "input_tokens": int(total_row.total_input or 0),
                    "output_tokens": int(total_row.total_output or 0),
                    "total_tokens": int(total_row.total_tokens or 0),
                    "total_calls": int(total_row.total_calls or 0),
                    "total_latency_ms": int(total_row.total_latency or 0),
                },
                "by_provider": [
                    {
                        "provider": row.provider,
                        "cost_usd": float(row.cost or 0),
                        "input_tokens": int(row.input_tokens or 0),
                        "output_tokens": int(row.output_tokens or 0),
                        "calls": int(row.calls or 0),
                        "avg_latency_ms": float(row.avg_latency or 0),
                    }
                    for row in by_provider
                ],
                "by_model": [
                    {
                        "model_name": row.model_name,
                        "provider": row.provider,
                        "cost_usd": float(row.cost or 0),
                        "input_tokens": int(row.input_tokens or 0),
                        "output_tokens": int(row.output_tokens or 0),
                        "calls": int(row.calls or 0),
                    }
                    for row in by_model
                ],
                "by_stage": [
                    {
                        "stage_number": row.stage_number,
                        "stage_name": row.stage_name,
                        "cost_usd": float(row.cost or 0),
                        "input_tokens": int(row.input_tokens or 0),
                        "output_tokens": int(row.output_tokens or 0),
                        "calls": int(row.calls or 0),
                    }
                    for row in by_stage
                ],
                "by_category": [
                    {
                        "category": row.category.value if hasattr(row.category, 'value') else str(row.category),
                        "cost_usd": float(row.cost or 0),
                        "calls": int(row.calls or 0),
                    }
                    for row in by_category
                ],
                "by_round": [
                    {
                        "round_number": row.round_number,
                        "cost_usd": float(row.cost or 0),
                        "calls": int(row.calls or 0),
                    }
                    for row in by_round
                ],
            }

    async def get_cost_time_series(
        self,
        days: int = 30,
        granularity: str = "day",
    ) -> list[dict[str, Any]]:
        """Get cost time series for visualization (line/area charts)."""
        since = datetime.utcnow() - timedelta(days=days)

        if granularity == "hour":
            trunc_fn = func.date_trunc("hour", APICostRecord.called_at)
        elif granularity == "day":
            trunc_fn = func.date_trunc("day", APICostRecord.called_at)
        else:
            trunc_fn = func.date_trunc("week", APICostRecord.called_at)

        async with self._session_factory() as session:
            result = await session.execute(
                select(
                    trunc_fn.label("period"),
                    func.sum(APICostRecord.total_cost_usd).label("cost"),
                    func.sum(APICostRecord.input_tokens).label("input_tokens"),
                    func.sum(APICostRecord.output_tokens).label("output_tokens"),
                    func.count(APICostRecord.id).label("calls"),
                )
                .where(APICostRecord.called_at >= since)
                .group_by("period")
                .order_by("period")
            )

            return [
                {
                    "period": row.period.isoformat() if row.period else None,
                    "cost_usd": float(row.cost or 0),
                    "input_tokens": int(row.input_tokens or 0),
                    "output_tokens": int(row.output_tokens or 0),
                    "calls": int(row.calls or 0),
                }
                for row in result
            ]

    async def get_model_cost_comparison(self) -> list[dict[str, Any]]:
        """Get cost comparison across all models (for bar/radar charts)."""
        async with self._session_factory() as session:
            result = await session.execute(
                select(
                    APICostRecord.provider,
                    APICostRecord.model_name,
                    func.sum(APICostRecord.total_cost_usd).label("total_cost"),
                    func.sum(APICostRecord.input_tokens).label("total_input"),
                    func.sum(APICostRecord.output_tokens).label("total_output"),
                    func.count(APICostRecord.id).label("total_calls"),
                    func.avg(APICostRecord.latency_ms).label("avg_latency"),
                    func.avg(APICostRecord.total_cost_usd).label("avg_cost_per_call"),
                )
                .where(APICostRecord.api_type == "llm")
                .group_by(APICostRecord.provider, APICostRecord.model_name)
                .order_by(desc("total_cost"))
            )

            return [
                {
                    "provider": row.provider,
                    "model_name": row.model_name,
                    "total_cost_usd": float(row.total_cost or 0),
                    "total_input_tokens": int(row.total_input or 0),
                    "total_output_tokens": int(row.total_output or 0),
                    "total_calls": int(row.total_calls or 0),
                    "avg_latency_ms": float(row.avg_latency or 0),
                    "avg_cost_per_call": float(row.avg_cost_per_call or 0),
                }
                for row in result
            ]

    async def get_cumulative_cost(self) -> dict[str, Any]:
        """Get cumulative cost across all time."""
        async with self._session_factory() as session:
            result = await session.execute(
                select(
                    func.sum(APICostRecord.total_cost_usd).label("total_cost"),
                    func.sum(APICostRecord.input_tokens).label("total_input"),
                    func.sum(APICostRecord.output_tokens).label("total_output"),
                    func.sum(APICostRecord.total_tokens).label("total_tokens"),
                    func.count(APICostRecord.id).label("total_calls"),
                    func.count(func.distinct(APICostRecord.discovery_run_id)).label("total_runs"),
                )
            )
            row = result.one()

            # Last 24h
            since_24h = datetime.utcnow() - timedelta(hours=24)
            last_24h = await session.execute(
                select(
                    func.sum(APICostRecord.total_cost_usd).label("cost"),
                    func.count(APICostRecord.id).label("calls"),
                )
                .where(APICostRecord.called_at >= since_24h)
            )
            h24 = last_24h.one()

            # Last 7d
            since_7d = datetime.utcnow() - timedelta(days=7)
            last_7d = await session.execute(
                select(
                    func.sum(APICostRecord.total_cost_usd).label("cost"),
                    func.count(APICostRecord.id).label("calls"),
                )
                .where(APICostRecord.called_at >= since_7d)
            )
            d7 = last_7d.one()

            # Last 30d
            since_30d = datetime.utcnow() - timedelta(days=30)
            last_30d = await session.execute(
                select(
                    func.sum(APICostRecord.total_cost_usd).label("cost"),
                    func.count(APICostRecord.id).label("calls"),
                )
                .where(APICostRecord.called_at >= since_30d)
            )
            d30 = last_30d.one()

            return {
                "all_time": {
                    "cost_usd": float(row.total_cost or 0),
                    "input_tokens": int(row.total_input or 0),
                    "output_tokens": int(row.total_output or 0),
                    "total_tokens": int(row.total_tokens or 0),
                    "total_calls": int(row.total_calls or 0),
                    "total_runs": int(row.total_runs or 0),
                },
                "last_24h": {
                    "cost_usd": float(h24.cost or 0),
                    "calls": int(h24.calls or 0),
                },
                "last_7d": {
                    "cost_usd": float(d7.cost or 0),
                    "calls": int(d7.calls or 0),
                },
                "last_30d": {
                    "cost_usd": float(d30.cost or 0),
                    "calls": int(d30.calls or 0),
                },
            }

    async def get_stage_cost_heatmap(self) -> list[dict[str, Any]]:
        """Get cost heatmap data: stage x model matrix (for heatmap visualization)."""
        async with self._session_factory() as session:
            result = await session.execute(
                select(
                    APICostRecord.stage_number,
                    APICostRecord.stage_name,
                    APICostRecord.model_name,
                    func.sum(APICostRecord.total_cost_usd).label("cost"),
                    func.avg(APICostRecord.total_cost_usd).label("avg_cost"),
                    func.count(APICostRecord.id).label("calls"),
                    func.avg(APICostRecord.latency_ms).label("avg_latency"),
                )
                .where(
                    and_(
                        APICostRecord.stage_number.isnot(None),
                        APICostRecord.api_type == "llm",
                    )
                )
                .group_by(
                    APICostRecord.stage_number,
                    APICostRecord.stage_name,
                    APICostRecord.model_name,
                )
                .order_by(APICostRecord.stage_number)
            )

            return [
                {
                    "stage_number": row.stage_number,
                    "stage_name": row.stage_name,
                    "model_name": row.model_name,
                    "total_cost_usd": float(row.cost or 0),
                    "avg_cost_usd": float(row.avg_cost or 0),
                    "calls": int(row.calls or 0),
                    "avg_latency_ms": float(row.avg_latency or 0),
                }
                for row in result
            ]

    async def get_recent_calls(
        self, limit: int = 50, run_id: str = None
    ) -> list[dict[str, Any]]:
        """Get recent API calls for real-time monitoring."""
        async with self._session_factory() as session:
            query = select(APICostRecord).order_by(desc(APICostRecord.called_at)).limit(limit)
            if run_id:
                query = query.where(APICostRecord.discovery_run_id == run_id)

            result = await session.execute(query)
            records = result.scalars().all()

            return [
                {
                    "id": str(r.id),
                    "provider": r.provider,
                    "model_name": r.model_name,
                    "api_type": r.api_type,
                    "category": r.category.value if hasattr(r.category, 'value') else str(r.category),
                    "input_tokens": r.input_tokens,
                    "output_tokens": r.output_tokens,
                    "total_tokens": r.total_tokens,
                    "total_cost_usd": r.total_cost_usd,
                    "latency_ms": r.latency_ms,
                    "stage_number": r.stage_number,
                    "stage_name": r.stage_name,
                    "hypothesis_id": r.hypothesis_id,
                    "round_number": r.round_number,
                    "called_at": r.called_at.isoformat() if r.called_at else None,
                    "is_retry": r.is_retry,
                }
                for r in records
            ]

    # ============== Pricing Management ==============

    async def sync_pricing_to_db(self) -> int:
        """Sync current in-memory pricing to database for audit trail."""
        count = 0
        async with self._session_factory() as session:
            async with session.begin():
                for (provider, model), prices in CURRENT_PRICING.items():
                    existing = await session.execute(
                        select(ModelPricing)
                        .where(
                            and_(
                                ModelPricing.provider == provider,
                                ModelPricing.model_name == model,
                                ModelPricing.is_current == True,
                            )
                        )
                        .limit(1)
                    )
                    if not existing.scalar_one_or_none():
                        pricing = ModelPricing(
                            provider=provider,
                            model_name=model,
                            input_price_per_million=prices["input"],
                            output_price_per_million=prices["output"],
                            cached_input_price_per_million=prices.get("cached_input", 0),
                            is_current=True,
                            pricing_source="hardcoded_defaults",
                        )
                        session.add(pricing)
                        count += 1
        return count


# ============== Singleton ==============

_cost_tracker: Optional[CostTrackingService] = None


def get_cost_tracker() -> CostTrackingService:
    """Get the singleton cost tracking service."""
    global _cost_tracker
    if _cost_tracker is None:
        _cost_tracker = CostTrackingService()
    return _cost_tracker
