"""
Compute Engine — Unified orchestrator for all biomedical computation domains.

Routes computation requests to the appropriate domain processor,
manages execution lifecycle, and returns standardized results.
Supports async execution with progress callbacks and WebSocket streaming.
"""

from __future__ import annotations

import time
from collections.abc import Callable
from typing import Any

from app.core.logging import LoggerMixin, get_logger
from app.compute.types import (
    ComputeDomain,
    ComputeRequest,
    ComputeResult,
    ComputeStatus,
)

logger = get_logger(__name__)


class ComputeEngine(LoggerMixin):
    """Unified computation engine that dispatches to domain-specific processors.

    Usage:
        engine = ComputeEngine()
        result = await engine.execute(ComputeRequest(
            domain=ComputeDomain.PHARMACOKINETICS,
            operation="solve_ode",
            parameters={...},
        ))
    """

    def __init__(self) -> None:
        self._processors: dict[ComputeDomain, Any] = {}
        self._register_processors()

    def _register_processors(self) -> None:
        """Lazily register all domain processors."""
        # Lazy imports to avoid circular dependencies and speed up startup
        from app.compute.imaging import ImagingProcessor
        from app.compute.signals import SignalProcessor
        from app.compute.genomics import GenomicsProcessor
        from app.compute.biomechanics import BiomechanicsProcessor
        from app.compute.pharmacokinetics import PharmacokineticsProcessor
        from app.compute.statistics import StatisticsProcessor

        self._processors = {
            ComputeDomain.IMAGING: ImagingProcessor(),
            ComputeDomain.ELECTROPHYSIOLOGY: SignalProcessor(),
            ComputeDomain.GENOMICS: GenomicsProcessor(),
            ComputeDomain.BIOMECHANICS: BiomechanicsProcessor(),
            ComputeDomain.PHARMACOKINETICS: PharmacokineticsProcessor(),
            ComputeDomain.STATISTICS: StatisticsProcessor(),
        }

    async def execute(
        self,
        request: ComputeRequest,
        progress_callback: Callable[[int, int], None] | None = None,
    ) -> ComputeResult:
        """Execute a computation request.

        Args:
            request: The computation request specifying domain, operation, and data.
            progress_callback: Optional callback(current, total) for progress updates.

        Returns:
            ComputeResult with numerical results, statistics, and optional figures.
        """
        start_time = time.time()

        processor = self._processors.get(request.domain)
        if processor is None:
            return ComputeResult(
                request_id=request.id,
                domain=request.domain,
                operation=request.operation,
                status=ComputeStatus.FAILED,
                error=f"No processor registered for domain: {request.domain}",
            )

        try:
            self.logger.info(
                "Executing computation",
                domain=request.domain.value,
                operation=request.operation,
                request_id=str(request.id),
            )

            result = await processor.execute(request, progress_callback)
            result.runtime_seconds = time.time() - start_time

            self.logger.info(
                "Computation completed",
                domain=request.domain.value,
                operation=request.operation,
                runtime_s=round(result.runtime_seconds, 3),
            )

            return result

        except Exception as e:
            elapsed = time.time() - start_time
            self.logger.error(
                "Computation failed",
                domain=request.domain.value,
                operation=request.operation,
                error=str(e),
            )
            return ComputeResult(
                request_id=request.id,
                domain=request.domain,
                operation=request.operation,
                status=ComputeStatus.FAILED,
                error=str(e),
                runtime_seconds=elapsed,
            )

    def list_operations(self, domain: ComputeDomain | None = None) -> dict[str, list[str]]:
        """List available operations, optionally filtered by domain."""
        result = {}
        targets = {domain: self._processors[domain]} if domain else self._processors
        for d, proc in targets.items():
            result[d.value] = proc.list_operations()
        return result
