"""Unit test for GET /metrics — Prometheus exposition format.

Verifies the contract the alerting/dashboarding stack will lock onto:
  • Response is text/plain
  • Every documented metric name appears
  • Every metric has HELP + TYPE + value lines (Prometheus format)
  • A single failed scalar query doesn't take the whole endpoint down
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from app.api.v1.endpoints.metrics import prometheus_metrics


EXPECTED_METRIC_NAMES = [
    "humanovo_users_total",
    "humanovo_users_active",
    "humanovo_users_pending_deletion",
    "humanovo_pipeline_runs_24h_total",
    "humanovo_pipeline_budget_aborts_24h_total",
    "humanovo_llm_cost_24h_cents",
    "humanovo_llm_tokens_in_24h_total",
    "humanovo_llm_tokens_out_24h_total",
    "humanovo_stripe_events_24h_total",
    "humanovo_data_sources_healthy",
    "humanovo_data_sources_unhealthy",
]


def _db_with_canned_scalars(values_in_order: list):
    """Build an AsyncSession mock whose execute().scalar() returns
    successive canned values from `values_in_order`. Used to drive
    the metric handlers through their happy path."""
    db = MagicMock()
    iterator = iter(values_in_order)

    async def _execute(*_args, **_kwargs):
        result = MagicMock()
        try:
            value = next(iterator)
        except StopIteration:
            value = 0
        result.scalar = MagicMock(return_value=value)
        return result

    db.execute = AsyncMock(side_effect=_execute)
    return db


@pytest.mark.asyncio
async def test_metrics_response_contains_every_expected_name():
    db = _db_with_canned_scalars([
        100, 87, 3,        # users
        2400, 12,          # pipeline runs / aborts
        45_000, 12_500_000, 1_800_000,  # cost cents / tok in / tok out
        2400,              # stripe events
        58, 4,             # sources healthy / unhealthy
    ])
    response = await prometheus_metrics(db=db)
    body = response.body.decode()

    for name in EXPECTED_METRIC_NAMES:
        assert f"# HELP {name}" in body, f"missing HELP for {name}"
        assert f"# TYPE {name}" in body, f"missing TYPE for {name}"
        assert f"\n{name} " in body, f"missing value line for {name}"

    # Counter vs gauge: pipeline runs + tokens are counters.
    assert "# TYPE humanovo_pipeline_runs_24h_total counter" in body
    assert "# TYPE humanovo_users_total gauge" in body


@pytest.mark.asyncio
async def test_metrics_response_is_plain_text_prometheus_content_type():
    db = _db_with_canned_scalars([0] * 12)
    response = await prometheus_metrics(db=db)
    ct = response.media_type
    assert ct.startswith("text/plain")


@pytest.mark.asyncio
async def test_metrics_endpoint_resilient_to_query_failures():
    """A single missing table or transient DB hiccup should NOT take
    down /metrics — failed scalars degrade to 0."""
    db = MagicMock()
    db.execute = AsyncMock(side_effect=RuntimeError("table missing"))

    response = await prometheus_metrics(db=db)
    body = response.body.decode()

    # Every documented metric still present, all values 0.
    for name in EXPECTED_METRIC_NAMES:
        assert f"\n{name} 0" in body or f"\n{name} 0.0" in body


@pytest.mark.asyncio
async def test_metrics_render_numeric_values_correctly():
    db = _db_with_canned_scalars([
        42, 30, 1,
        100, 5,
        12345, 50000, 8000,
        100,
        10, 2,
    ])
    response = await prometheus_metrics(db=db)
    body = response.body.decode()

    assert "\nhumanovo_users_total 42\n" in body
    assert "\nhumanovo_users_active 30\n" in body
    assert "\nhumanovo_pipeline_runs_24h_total 100\n" in body
    assert "\nhumanovo_pipeline_budget_aborts_24h_total 5\n" in body
    assert "\nhumanovo_llm_cost_24h_cents 12345" in body
    assert "\nhumanovo_data_sources_healthy 10\n" in body
    assert "\nhumanovo_data_sources_unhealthy 2\n" in body
