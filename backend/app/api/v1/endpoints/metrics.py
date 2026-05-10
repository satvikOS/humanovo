"""Prometheus-format /metrics endpoint.

GET /metrics  →  text/plain in Prometheus exposition format.

Surfaces the operational signals an SRE / on-call dashboard needs:

  • humanovo_users_total                     (gauge)
  • humanovo_users_active                    (gauge)
  • humanovo_users_pending_deletion          (gauge)
  • humanovo_pipeline_runs_24h_total         (counter, last 24h)
  • humanovo_pipeline_budget_aborts_24h_total (counter, last 24h)
  • humanovo_llm_cost_24h_cents              (gauge, sum of last 24h)
  • humanovo_llm_tokens_in_24h_total         (counter)
  • humanovo_llm_tokens_out_24h_total        (counter)
  • humanovo_stripe_events_24h_total         (counter)
  • humanovo_data_sources_healthy            (gauge)
  • humanovo_data_sources_unhealthy          (gauge)

Why text exposition (not OpenMetrics or OTLP push)? Pull-based
Prometheus is the cheapest scraping model that integrates with both
self-hosted Prometheus + AWS CloudWatch (via the OpenTelemetry
Collector's `prometheus_simple` receiver) + Datadog/Grafana Cloud
without per-vendor wiring.

Auth: PUBLIC. Standard for /metrics endpoints since the data is
operational not business. WAF should restrict by source IP at the
network layer; the rate-limit bucket caps abuse.
"""
from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, Response
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.rate_limit import rate_limit


logger = logging.getLogger(__name__)
router = APIRouter(dependencies=[Depends(rate_limit("metrics"))])


def _emit(name: str, value: float | int, *, help_text: str, kind: str = "gauge") -> str:
    """Render one Prometheus metric in exposition format."""
    return (
        f"# HELP {name} {help_text}\n"
        f"# TYPE {name} {kind}\n"
        f"{name} {value}\n\n"
    )


async def _scalar(db: AsyncSession, sql: str, **params) -> Any:
    """Run a scalar-returning query, swallow exceptions to a None
    so a single failed metric doesn't take the whole endpoint down."""
    try:
        result = await db.execute(text(sql), params)
        return result.scalar()
    except Exception as e:
        logger.warning("metrics: scalar query failed: %s", e)
        return None


@router.get("/metrics", response_class=Response)
async def prometheus_metrics(db: AsyncSession = Depends(get_db)) -> Response:
    cutoff_24h = datetime.now(UTC) - timedelta(hours=24)
    body_parts: list[str] = []

    # ─── User counts ─────────────────────────────────────────
    total = await _scalar(db, "SELECT COUNT(*) FROM users") or 0
    active = await _scalar(
        db,
        "SELECT COUNT(*) FROM users WHERE is_active = TRUE AND deleted_at IS NULL",
    ) or 0
    pending_delete = await _scalar(
        db,
        "SELECT COUNT(*) FROM users WHERE delete_requested_at IS NOT NULL AND deleted_at IS NULL",
    ) or 0
    body_parts.append(_emit(
        "humanovo_users_total", total,
        help_text="Total users in the database (active + disabled + soft-deleted).",
    ))
    body_parts.append(_emit(
        "humanovo_users_active", active,
        help_text="Currently active users (is_active=TRUE, not soft-deleted).",
    ))
    body_parts.append(_emit(
        "humanovo_users_pending_deletion", pending_delete,
        help_text="Users in the 30-day GDPR soft-delete grace window.",
    ))

    # ─── Pipeline runs (last 24h) ────────────────────────────
    # Source: audit_log records emitted by audit_writer.write_swarm_audit.
    runs_24h = await _scalar(
        db,
        """
        SELECT COUNT(*) FROM audit_log
        WHERE event_type IN ('pipeline.complete', 'pipeline.error')
          AND timestamp >= :cutoff
        """,
        cutoff=cutoff_24h,
    ) or 0
    aborts_24h = await _scalar(
        db,
        """
        SELECT COUNT(*) FROM audit_log
        WHERE event_type = 'pipeline.error'
          AND timestamp >= :cutoff
        """,
        cutoff=cutoff_24h,
    ) or 0
    body_parts.append(_emit(
        "humanovo_pipeline_runs_24h_total", runs_24h,
        kind="counter",
        help_text="Pipeline runs (complete or error) in the last 24h.",
    ))
    body_parts.append(_emit(
        "humanovo_pipeline_budget_aborts_24h_total", aborts_24h,
        kind="counter",
        help_text="Pipeline runs that aborted via budget cap in the last 24h.",
    ))

    # ─── LLM cost + tokens (last 24h) ────────────────────────
    cost_cents = await _scalar(
        db,
        """
        SELECT COALESCE(SUM(cost_usd * 100), 0) FROM audit_log
        WHERE event_type = 'llm.response'
          AND timestamp >= :cutoff
        """,
        cutoff=cutoff_24h,
    ) or 0
    tokens_in = await _scalar(
        db,
        """
        SELECT COALESCE(SUM(tokens_input), 0) FROM audit_log
        WHERE event_type = 'llm.response'
          AND timestamp >= :cutoff
        """,
        cutoff=cutoff_24h,
    ) or 0
    tokens_out = await _scalar(
        db,
        """
        SELECT COALESCE(SUM(tokens_output), 0) FROM audit_log
        WHERE event_type = 'llm.response'
          AND timestamp >= :cutoff
        """,
        cutoff=cutoff_24h,
    ) or 0
    body_parts.append(_emit(
        "humanovo_llm_cost_24h_cents", float(cost_cents),
        help_text="Total LLM cost in cents recorded in the last 24h.",
    ))
    body_parts.append(_emit(
        "humanovo_llm_tokens_in_24h_total", int(tokens_in),
        kind="counter",
        help_text="Total LLM input tokens billed in the last 24h.",
    ))
    body_parts.append(_emit(
        "humanovo_llm_tokens_out_24h_total", int(tokens_out),
        kind="counter",
        help_text="Total LLM output tokens billed in the last 24h.",
    ))

    # ─── Stripe webhook events (last 24h) ────────────────────
    stripe_events = await _scalar(
        db,
        "SELECT COUNT(*) FROM stripe_processed_events WHERE processed_at >= :cutoff",
        cutoff=cutoff_24h,
    ) or 0
    body_parts.append(_emit(
        "humanovo_stripe_events_24h_total", stripe_events,
        kind="counter",
        help_text="Stripe webhook events processed in the last 24h.",
    ))

    # ─── Data source health snapshot ─────────────────────────
    # Best-effort against the data_sources_health view if present;
    # missing-table errors are swallowed (the metric simply reports 0).
    healthy = await _scalar(
        db,
        "SELECT COUNT(*) FROM data_sources_health WHERE is_healthy = TRUE",
    ) or 0
    unhealthy = await _scalar(
        db,
        "SELECT COUNT(*) FROM data_sources_health WHERE is_healthy = FALSE",
    ) or 0
    body_parts.append(_emit(
        "humanovo_data_sources_healthy", healthy,
        help_text="Biomedical data sources currently reachable.",
    ))
    body_parts.append(_emit(
        "humanovo_data_sources_unhealthy", unhealthy,
        help_text="Biomedical data sources currently unreachable.",
    ))

    return Response(
        content="".join(body_parts),
        media_type="text/plain; version=0.0.4; charset=utf-8",
    )
