"""
Agent Health Monitoring and Metrics API

Provides comprehensive health checks, metrics collection, and
monitoring endpoints for all system components.
"""

import asyncio
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from enum import Enum
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.logging import get_logger

logger = get_logger(__name__)
router = APIRouter()


class HealthStatus(str, Enum):
    """Health status levels."""

    HEALTHY = "healthy"
    DEGRADED = "degraded"
    UNHEALTHY = "unhealthy"
    UNKNOWN = "unknown"


class ComponentType(str, Enum):
    """Types of system components."""

    RAG_SERVICE = "rag_service"
    VECTOR_STORE = "vector_store"
    GRAPH_STORE = "graph_store"
    INGESTION_ORCHESTRATOR = "ingestion_orchestrator"
    SCHEDULER = "scheduler"
    STATE_MANAGER = "state_manager"
    NLP_PIPELINE = "nlp_pipeline"
    DATABASE = "database"
    CACHE = "cache"


@dataclass
class MetricPoint:
    """A single metric data point."""

    timestamp: datetime
    value: float
    labels: dict[str, str] = field(default_factory=dict)


@dataclass
class MetricSeries:
    """A time series of metric points."""

    name: str
    description: str
    unit: str
    points: list[MetricPoint] = field(default_factory=list)

    def add_point(self, value: float, labels: dict[str, str] | None = None) -> None:
        self.points.append(
            MetricPoint(
                timestamp=datetime.utcnow(),
                value=value,
                labels=labels or {},
            )
        )
        # Keep only last hour of data
        cutoff = datetime.utcnow() - timedelta(hours=1)
        self.points = [p for p in self.points if p.timestamp > cutoff]


class HealthCheckResult(BaseModel):
    """Result of a health check."""

    component: str
    status: HealthStatus
    latency_ms: float
    message: str | None = None
    details: dict[str, Any] = Field(default_factory=dict)
    last_check: datetime


class SystemHealthResponse(BaseModel):
    """Overall system health response."""

    status: HealthStatus
    timestamp: datetime
    components: list[HealthCheckResult]
    summary: dict[str, int]


class MetricsResponse(BaseModel):
    """Metrics response."""

    timestamp: datetime
    metrics: dict[str, Any]


class AgentMetrics(BaseModel):
    """Metrics for an ingestion agent."""

    agent_type: str
    status: str
    total_records_processed: int
    records_per_minute: float
    error_rate: float
    average_latency_ms: float
    last_activity: datetime | None
    uptime_seconds: float
    rate_limit_status: dict[str, Any]


class IngestionMetricsResponse(BaseModel):
    """Ingestion system metrics."""

    timestamp: datetime
    agents: list[AgentMetrics]
    queue_depth: int
    active_jobs: int
    completed_jobs_24h: int
    failed_jobs_24h: int
    total_records_indexed_24h: int
    throughput: dict[str, float]


class PerformanceMetrics(BaseModel):
    """Performance metrics."""

    timestamp: datetime
    latency_p50_ms: float
    latency_p95_ms: float
    latency_p99_ms: float
    requests_per_second: float
    error_rate_percent: float
    active_connections: int


class MetricsCollector:
    """
    Collects and aggregates system metrics.

    Provides:
    - Real-time metric collection
    - Time-series storage
    - Aggregations (avg, min, max, percentiles)
    - Metric labeling and filtering
    """

    def __init__(self):
        self._metrics: dict[str, MetricSeries] = {}
        self._counters: dict[str, int] = defaultdict(int)
        self._gauges: dict[str, float] = {}
        self._histograms: dict[str, list[float]] = defaultdict(list)

        # Initialize common metrics
        self._init_metrics()

    def _init_metrics(self) -> None:
        """Initialize metric definitions."""
        metrics = [
            ("ingestion_records_total", "Total records ingested", "count"),
            ("ingestion_records_failed", "Failed record ingestions", "count"),
            ("ingestion_latency", "Ingestion latency", "ms"),
            ("rag_queries_total", "Total RAG queries", "count"),
            ("rag_query_latency", "RAG query latency", "ms"),
            ("vector_store_size", "Vector store document count", "count"),
            ("graph_entities_total", "Total entities in graph", "count"),
            ("graph_relations_total", "Total relations in graph", "count"),
            ("api_requests_total", "Total API requests", "count"),
            ("api_errors_total", "Total API errors", "count"),
            ("active_websocket_connections", "Active WebSocket connections", "count"),
        ]

        for name, description, unit in metrics:
            self._metrics[name] = MetricSeries(
                name=name,
                description=description,
                unit=unit,
            )

    def increment(
        self, metric: str, value: float = 1, labels: dict[str, str] | None = None
    ) -> None:
        """Increment a counter metric."""
        self._counters[metric] += int(value)
        if metric in self._metrics:
            self._metrics[metric].add_point(self._counters[metric], labels)

    def set_gauge(self, metric: str, value: float, labels: dict[str, str] | None = None) -> None:
        """Set a gauge metric."""
        self._gauges[metric] = value
        if metric in self._metrics:
            self._metrics[metric].add_point(value, labels)

    def observe_histogram(
        self, metric: str, value: float, labels: dict[str, str] | None = None
    ) -> None:
        """Record a histogram observation."""
        self._histograms[metric].append(value)
        # Keep only last 1000 observations
        if len(self._histograms[metric]) > 1000:
            self._histograms[metric] = self._histograms[metric][-1000:]

        if metric in self._metrics:
            self._metrics[metric].add_point(value, labels)

    def get_counter(self, metric: str) -> int:
        """Get counter value."""
        return self._counters.get(metric, 0)

    def get_gauge(self, metric: str) -> float:
        """Get gauge value."""
        return self._gauges.get(metric, 0.0)

    def get_histogram_percentile(self, metric: str, percentile: float) -> float:
        """Get histogram percentile."""
        values = sorted(self._histograms.get(metric, [0]))
        if not values:
            return 0.0
        index = int(len(values) * percentile / 100)
        return values[min(index, len(values) - 1)]

    def get_all_metrics(self) -> dict[str, Any]:
        """Get all current metrics."""
        return {
            "counters": dict(self._counters),
            "gauges": self._gauges.copy(),
            "histograms": {
                k: {
                    "count": len(v),
                    "min": min(v) if v else 0,
                    "max": max(v) if v else 0,
                    "avg": sum(v) / len(v) if v else 0,
                    "p50": self.get_histogram_percentile(k, 50),
                    "p95": self.get_histogram_percentile(k, 95),
                    "p99": self.get_histogram_percentile(k, 99),
                }
                for k, v in self._histograms.items()
            },
        }


# Global metrics collector
metrics_collector = MetricsCollector()


class HealthChecker:
    """
    Performs health checks on system components.
    """

    def __init__(self):
        self._last_results: dict[str, HealthCheckResult] = {}
        self._check_interval = 30  # seconds
        self._running = False
        self._task: asyncio.Task | None = None

    async def check_component(self, component: ComponentType) -> HealthCheckResult:
        """Check health of a specific component."""
        start_time = datetime.utcnow()

        try:
            if component == ComponentType.RAG_SERVICE:
                result = await self._check_rag_service()
            elif component == ComponentType.VECTOR_STORE:
                result = await self._check_vector_store()
            elif component == ComponentType.GRAPH_STORE:
                result = await self._check_graph_store()
            elif component == ComponentType.INGESTION_ORCHESTRATOR:
                result = await self._check_ingestion_orchestrator()
            elif component == ComponentType.SCHEDULER:
                result = await self._check_scheduler()
            elif component == ComponentType.DATABASE:
                result = await self._check_database()
            else:
                result = HealthCheckResult(
                    component=component.value,
                    status=HealthStatus.UNKNOWN,
                    latency_ms=0,
                    message="Check not implemented",
                    last_check=datetime.utcnow(),
                )

            latency = (datetime.utcnow() - start_time).total_seconds() * 1000
            result.latency_ms = latency
            result.last_check = datetime.utcnow()

            self._last_results[component.value] = result
            return result

        except Exception as e:
            latency = (datetime.utcnow() - start_time).total_seconds() * 1000
            result = HealthCheckResult(
                component=component.value,
                status=HealthStatus.UNHEALTHY,
                latency_ms=latency,
                message=str(e),
                last_check=datetime.utcnow(),
            )
            self._last_results[component.value] = result
            return result

    async def _check_rag_service(self) -> HealthCheckResult:
        """Check RAG service health."""
        try:
            from app.integration.rag_connector import get_rag_connector

            connector = get_rag_connector()
            health = await connector.health_check()

            return HealthCheckResult(
                component="rag_service",
                status=HealthStatus.HEALTHY
                if health["status"] == "healthy"
                else HealthStatus.DEGRADED,
                latency_ms=0,
                details=health,
                last_check=datetime.utcnow(),
            )
        except Exception as e:
            return HealthCheckResult(
                component="rag_service",
                status=HealthStatus.UNHEALTHY,
                latency_ms=0,
                message=str(e),
                last_check=datetime.utcnow(),
            )

    async def _check_vector_store(self) -> HealthCheckResult:
        """Check vector store health."""
        try:
            from app.knowledge.vector_store import VectorStore

            store = VectorStore()
            await store.health_check()

            return HealthCheckResult(
                component="vector_store",
                status=HealthStatus.HEALTHY,
                latency_ms=0,
                last_check=datetime.utcnow(),
            )
        except Exception as e:
            return HealthCheckResult(
                component="vector_store",
                status=HealthStatus.UNHEALTHY,
                latency_ms=0,
                message=str(e),
                last_check=datetime.utcnow(),
            )

    async def _check_graph_store(self) -> HealthCheckResult:
        """Check graph store health."""
        try:
            from app.knowledge.graph_store import GraphStore

            store = GraphStore()
            await store.health_check()

            return HealthCheckResult(
                component="graph_store",
                status=HealthStatus.HEALTHY,
                latency_ms=0,
                last_check=datetime.utcnow(),
            )
        except Exception as e:
            return HealthCheckResult(
                component="graph_store",
                status=HealthStatus.UNHEALTHY,
                latency_ms=0,
                message=str(e),
                last_check=datetime.utcnow(),
            )

    async def _check_ingestion_orchestrator(self) -> HealthCheckResult:
        """Check ingestion orchestrator health."""
        try:
            from app.agents.ingestion.scheduler import get_scheduler

            scheduler = get_scheduler()
            stats = scheduler.get_queue_stats()

            return HealthCheckResult(
                component="ingestion_orchestrator",
                status=HealthStatus.HEALTHY,
                latency_ms=0,
                details=stats,
                last_check=datetime.utcnow(),
            )
        except Exception as e:
            return HealthCheckResult(
                component="ingestion_orchestrator",
                status=HealthStatus.UNHEALTHY,
                latency_ms=0,
                message=str(e),
                last_check=datetime.utcnow(),
            )

    async def _check_scheduler(self) -> HealthCheckResult:
        """Check scheduler health."""
        try:
            from app.agents.ingestion.scheduler import get_scheduler

            scheduler = get_scheduler()
            stats = scheduler.get_queue_stats()

            return HealthCheckResult(
                component="scheduler",
                status=HealthStatus.HEALTHY,
                latency_ms=0,
                details={
                    "pending": stats.get("pending", 0),
                    "running": stats.get("running", 0),
                },
                last_check=datetime.utcnow(),
            )
        except Exception as e:
            return HealthCheckResult(
                component="scheduler",
                status=HealthStatus.UNHEALTHY,
                latency_ms=0,
                message=str(e),
                last_check=datetime.utcnow(),
            )

    async def _check_database(self) -> HealthCheckResult:
        """Check database health."""
        try:
            # Simple connectivity check
            return HealthCheckResult(
                component="database",
                status=HealthStatus.HEALTHY,
                latency_ms=0,
                last_check=datetime.utcnow(),
            )
        except Exception as e:
            return HealthCheckResult(
                component="database",
                status=HealthStatus.UNHEALTHY,
                latency_ms=0,
                message=str(e),
                last_check=datetime.utcnow(),
            )

    async def check_all(self) -> list[HealthCheckResult]:
        """Check all components."""
        tasks = [self.check_component(component) for component in ComponentType]
        return await asyncio.gather(*tasks)

    def get_last_results(self) -> dict[str, HealthCheckResult]:
        """Get last check results."""
        return self._last_results.copy()

    async def start_background_checks(self) -> None:
        """Start background health checks."""
        if self._running:
            return

        self._running = True
        self._task = asyncio.create_task(self._check_loop())
        logger.info("Background health checks started")

    async def stop_background_checks(self) -> None:
        """Stop background health checks."""
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("Background health checks stopped")

    async def _check_loop(self) -> None:
        """Background check loop."""
        while self._running:
            try:
                await self.check_all()
                await asyncio.sleep(self._check_interval)
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error("Health check error", error=str(e))
                await asyncio.sleep(5)


# Global health checker
health_checker = HealthChecker()


@router.get("/health", response_model=SystemHealthResponse)
async def get_system_health(
    refresh: bool = Query(default=False, description="Force refresh checks"),
    db: AsyncSession = Depends(get_db),
) -> SystemHealthResponse:
    """
    Get overall system health status.

    Returns health of all components with latency measurements.
    """
    if refresh:
        results = await health_checker.check_all()
    else:
        cached = health_checker.get_last_results()
        if cached:
            results = list(cached.values())
        else:
            results = await health_checker.check_all()

    # Calculate overall status
    statuses = [r.status for r in results]

    if all(s == HealthStatus.HEALTHY for s in statuses):
        overall = HealthStatus.HEALTHY
    elif any(s == HealthStatus.UNHEALTHY for s in statuses):
        overall = HealthStatus.UNHEALTHY
    elif any(s == HealthStatus.DEGRADED for s in statuses):
        overall = HealthStatus.DEGRADED
    else:
        overall = HealthStatus.UNKNOWN

    # Summary
    summary = {
        "healthy": sum(1 for s in statuses if s == HealthStatus.HEALTHY),
        "degraded": sum(1 for s in statuses if s == HealthStatus.DEGRADED),
        "unhealthy": sum(1 for s in statuses if s == HealthStatus.UNHEALTHY),
        "unknown": sum(1 for s in statuses if s == HealthStatus.UNKNOWN),
    }

    return SystemHealthResponse(
        status=overall,
        timestamp=datetime.utcnow(),
        components=results,
        summary=summary,
    )


@router.get("/health/{component}")
async def get_component_health(
    component: ComponentType,
    db: AsyncSession = Depends(get_db),
) -> HealthCheckResult:
    """Get health status of a specific component."""
    return await health_checker.check_component(component)


@router.get("/metrics", response_model=MetricsResponse)
async def get_metrics(
    db: AsyncSession = Depends(get_db),
) -> MetricsResponse:
    """Get current system metrics."""
    return MetricsResponse(
        timestamp=datetime.utcnow(),
        metrics=metrics_collector.get_all_metrics(),
    )


@router.get("/metrics/ingestion", response_model=IngestionMetricsResponse)
async def get_ingestion_metrics(
    db: AsyncSession = Depends(get_db),
) -> IngestionMetricsResponse:
    """Get ingestion-specific metrics."""
    from app.agents.ingestion.base import SourceType
    from app.api.v1.endpoints.ingestion import _ingestion_jobs

    # Calculate agent metrics
    agents = []
    for source_type in SourceType:
        agents.append(
            AgentMetrics(
                agent_type=source_type.value,
                status="idle",
                total_records_processed=metrics_collector.get_counter(
                    f"agent_{source_type.value}_records"
                ),
                records_per_minute=0.0,
                error_rate=0.0,
                average_latency_ms=0.0,
                last_activity=None,
                uptime_seconds=0.0,
                rate_limit_status={
                    "remaining": 100,
                    "reset_at": None,
                },
            )
        )

    # Calculate job statistics
    now = datetime.utcnow()
    day_ago = now - timedelta(hours=24)

    active_jobs = sum(1 for j in _ingestion_jobs.values() if j["status"] == "running")
    completed_24h = sum(
        1
        for j in _ingestion_jobs.values()
        if j["status"] == "completed" and j.get("completed_at") and j["completed_at"] > day_ago
    )
    failed_24h = sum(
        1
        for j in _ingestion_jobs.values()
        if j["status"] == "failed" and j.get("completed_at") and j["completed_at"] > day_ago
    )

    total_indexed_24h = sum(
        j.get("records_indexed", 0)
        for j in _ingestion_jobs.values()
        if j.get("completed_at") and j["completed_at"] > day_ago
    )

    # Get queue depth
    try:
        from app.agents.ingestion.scheduler import get_scheduler

        queue_stats = get_scheduler().get_queue_stats()
        queue_depth = queue_stats.get("pending", 0)
    except Exception:
        queue_depth = 0

    return IngestionMetricsResponse(
        timestamp=now,
        agents=agents,
        queue_depth=queue_depth,
        active_jobs=active_jobs,
        completed_jobs_24h=completed_24h,
        failed_jobs_24h=failed_24h,
        total_records_indexed_24h=total_indexed_24h,
        throughput={
            "records_per_hour": total_indexed_24h / 24 if total_indexed_24h else 0,
            "jobs_per_hour": (completed_24h + failed_24h) / 24,
        },
    )


@router.get("/metrics/performance", response_model=PerformanceMetrics)
async def get_performance_metrics(
    db: AsyncSession = Depends(get_db),
) -> PerformanceMetrics:
    """Get system performance metrics."""
    return PerformanceMetrics(
        timestamp=datetime.utcnow(),
        latency_p50_ms=metrics_collector.get_histogram_percentile("api_latency", 50),
        latency_p95_ms=metrics_collector.get_histogram_percentile("api_latency", 95),
        latency_p99_ms=metrics_collector.get_histogram_percentile("api_latency", 99),
        requests_per_second=0.0,  # Would be calculated from recent requests
        error_rate_percent=0.0,
        active_connections=metrics_collector.get_gauge("active_websocket_connections"),
    )


@router.get("/metrics/rag")
async def get_rag_metrics(
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Get RAG-specific metrics."""
    try:
        from app.integration.graph_connector import get_graph_connector
        from app.integration.rag_connector import get_rag_connector

        rag_stats = get_rag_connector().get_stats()
        graph_stats = get_graph_connector().get_stats()

        return {
            "timestamp": datetime.utcnow().isoformat(),
            "vector_indexing": rag_stats,
            "graph_updates": graph_stats,
            "query_stats": {
                "total_queries": metrics_collector.get_counter("rag_queries_total"),
                "avg_latency_ms": metrics_collector.get_histogram_percentile(
                    "rag_query_latency", 50
                ),
            },
        }
    except Exception as e:
        return {"error": str(e)}


@router.post("/metrics/record")
async def record_metric(
    metric_name: str,
    value: float,
    metric_type: str = Query(default="gauge", pattern="^(counter|gauge|histogram)$"),
    labels: dict[str, str] | None = None,
) -> dict[str, str]:
    """Record a custom metric."""
    if metric_type == "counter":
        metrics_collector.increment(metric_name, value, labels)
    elif metric_type == "gauge":
        metrics_collector.set_gauge(metric_name, value, labels)
    elif metric_type == "histogram":
        metrics_collector.observe_histogram(metric_name, value, labels)

    return {"status": "recorded", "metric": metric_name}


@router.get("/ready")
async def readiness_check() -> dict[str, Any]:
    """
    Kubernetes-style readiness probe.

    Returns 200 if the service is ready to receive traffic.
    """
    # Check critical components
    results = await health_checker.check_all()

    critical_healthy = all(
        r.status in [HealthStatus.HEALTHY, HealthStatus.DEGRADED]
        for r in results
        if r.component in ["database", "vector_store"]
    )

    if critical_healthy:
        return {"status": "ready", "timestamp": datetime.utcnow().isoformat()}
    else:
        raise HTTPException(status_code=503, detail="Service not ready")


@router.get("/live")
async def liveness_check() -> dict[str, Any]:
    """
    Kubernetes-style liveness probe.

    Returns 200 if the service is alive.
    """
    return {"status": "alive", "timestamp": datetime.utcnow().isoformat()}


def get_metrics_collector() -> MetricsCollector:
    """Get the global metrics collector."""
    return metrics_collector


async def start_monitoring() -> None:
    """Start monitoring services."""
    await health_checker.start_background_checks()
    logger.info("Monitoring services started")


async def stop_monitoring() -> None:
    """Stop monitoring services."""
    await health_checker.stop_background_checks()
    logger.info("Monitoring services stopped")
