"""
Unit tests for app.compute.engine.ComputeEngine.

The engine is a thin dispatcher — these tests focus on its contract:
unknown domains / operations surface cleanly, runtime_seconds is
populated, and list_operations returns a useful manifest.
"""
from __future__ import annotations

import pytest

from app.compute.engine import ComputeEngine
from app.compute.types import (
    ComputeDomain,
    ComputeRequest,
    ComputeStatus,
)


@pytest.fixture
def engine() -> ComputeEngine:
    return ComputeEngine()


async def test_list_operations_returns_every_registered_domain(engine: ComputeEngine) -> None:
    ops = engine.list_operations()
    # At minimum statistics should be registered with non-empty ops.
    assert "statistics" in ops
    assert len(ops["statistics"]) > 0
    # Every registered domain is a ComputeDomain value.
    for key in ops:
        ComputeDomain(key)  # raises if not a valid enum value


async def test_list_operations_filter_by_domain(engine: ComputeEngine) -> None:
    ops = engine.list_operations(ComputeDomain.STATISTICS)
    assert list(ops.keys()) == ["statistics"]
    assert "t_test" in ops["statistics"]


async def test_execute_populates_runtime_seconds(engine: ComputeEngine) -> None:
    req = ComputeRequest(
        domain=ComputeDomain.STATISTICS,
        operation="descriptive",
        parameters={"data": [1.0, 2.0, 3.0, 4.0, 5.0]},
    )
    result = await engine.execute(req)
    assert result.status is ComputeStatus.COMPLETED
    # Runtime is tiny but always >= 0.
    assert result.runtime_seconds >= 0
    # And strictly < 30s — a sanity bound.
    assert result.runtime_seconds < 30


async def test_execute_unknown_operation_is_non_fatal(engine: ComputeEngine) -> None:
    req = ComputeRequest(
        domain=ComputeDomain.STATISTICS,
        operation="operation_that_does_not_exist",
        parameters={},
    )
    result = await engine.execute(req)
    assert result.status is ComputeStatus.FAILED
    assert result.error is not None


async def test_execute_handler_exception_is_captured(engine: ComputeEngine) -> None:
    # Missing required parameters — the domain processor raises; engine
    # should convert that into a FAILED result rather than propagating.
    req = ComputeRequest(
        domain=ComputeDomain.STATISTICS,
        operation="t_test",
        parameters={},
    )
    result = await engine.execute(req)
    assert result.status is ComputeStatus.FAILED
    # runtime_seconds should still be populated even on failure path.
    assert result.runtime_seconds >= 0
