"""
Data Sources API Endpoints

Provides access to the 60+ biomedical data source orchestrator.
Supports querying individual sources, categories, or all sources in parallel.
"""

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.core.auth import AUTH_REQUIRED
from app.core.logging import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/data-sources", tags=["data-sources"], dependencies=AUTH_REQUIRED)


class DataSourceQueryRequest(BaseModel):
    """Request body for querying data sources."""
    query: str = Field(..., description="Search query (disease, gene, drug, etc.)")
    disease: str = Field(default="", description="Disease context for more targeted results")
    categories: list[str] = Field(
        default_factory=list,
        description="Categories to query: literature, genomics, proteins, pathways, drugs, clinical, metabolomics, cell_tissue, ontologies, preprints. Empty = all.",
    )
    sources: list[str] = Field(
        default_factory=list,
        description="Specific source names to query. Empty = all in selected categories.",
    )
    max_results_per_source: int = Field(default=5, ge=1, le=50, description="Max results per source")


class DataSourceQueryResponse(BaseModel):
    """Response from data source query."""
    total_results: int
    sources_queried: int
    sources_succeeded: int
    sources_failed: int
    results: list[dict[str, Any]]
    errors: list[dict[str, str]] = []


@router.post("/query", response_model=DataSourceQueryResponse)
async def query_data_sources(request: DataSourceQueryRequest):
    """
    Query biomedical data sources in parallel.

    Supports 60+ sources across 10 categories. Specify categories or
    individual source names to narrow the query scope.
    """
    try:
        from app.services.data_sources import DataSourceOrchestrator
        orchestrator = DataSourceOrchestrator()

        if request.sources:
            results = await orchestrator.query_sources(
                source_names=request.sources,
                query=request.query,
                max_results=request.max_results_per_source,
            )
        elif request.categories:
            all_results = []
            for category in request.categories:
                category_results = await orchestrator.query_category(
                    category=category,
                    query=request.query,
                    max_results=request.max_results_per_source,
                )
                all_results.extend(category_results)
            results = all_results
        else:
            # If a disease context is supplied, prepend it to the query
            # so the orchestrator's per-source search uses the broader
            # phrase. Sources with native disease filters can be added
            # in a future revision; for now this is a uniform widening.
            full_query = (
                f"{request.disease} {request.query}".strip()
                if request.disease
                else request.query
            )
            results = await orchestrator.query_all(
                query=full_query,
                max_results=request.max_results_per_source,
            )

        # Convert to dicts
        result_dicts = []
        for r in results:
            if hasattr(r, '__dict__'):
                result_dicts.append({
                    "source_name": getattr(r, "source_name", "unknown"),
                    "source_category": getattr(r, "source_category", "unknown"),
                    "result_type": getattr(r, "result_type", "unknown"),
                    "title": getattr(r, "title", ""),
                    "description": getattr(r, "description", ""),
                    "external_id": getattr(r, "external_id", ""),
                    "url": getattr(r, "url", ""),
                    "relevance_score": getattr(r, "relevance_score", 0.0),
                    "metadata": getattr(r, "metadata", {}),
                })
            elif isinstance(r, dict):
                result_dicts.append(r)

        return DataSourceQueryResponse(
            total_results=len(result_dicts),
            sources_queried=(
                len(request.sources) if request.sources else len(orchestrator._sources)
            ),
            sources_succeeded=len({r.get("source_name", "") for r in result_dicts}),
            sources_failed=0,
            results=result_dicts,
        )

    except ImportError:
        raise HTTPException(status_code=503, detail="Data sources service not available yet")
    except Exception as e:
        logger.error(f"Data source query failed: {e}")
        raise HTTPException(status_code=500, detail=f"Query failed: {str(e)}")


@router.get("/available")
async def get_available_sources():
    """List all available data sources and their categories."""
    try:
        from app.services.data_sources import DataSourceOrchestrator
        orchestrator = DataSourceOrchestrator()
        return {"sources": orchestrator.get_available_sources()}
    except ImportError:
        raise HTTPException(status_code=503, detail="Data sources service not yet initialized")
    except Exception as e:
        logger.error(f"Failed to list available sources: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/stats")
async def get_source_stats():
    """Get statistics about data source usage."""
    try:
        from app.services.data_sources import DataSourceOrchestrator
        orchestrator = DataSourceOrchestrator()
        return orchestrator.get_source_stats()
    except ImportError:
        raise HTTPException(status_code=503, detail="Data sources service not yet initialized")
    except Exception as e:
        logger.error(f"Failed to get source stats: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# Health endpoint — surfaces per-source liveness for the 62 active sources.
# Reads the in-memory _LAST_SUCCESS_AT / _LAST_ERROR_AT caches populated by
# DataSourceBase._safe_search; does NOT fire 62 simultaneous network probes.
# Sources never queried since process start show as "unknown" rather than
# "down" - the right semantic for "we don't know yet" vs "we know it failed".
# ---------------------------------------------------------------------------


@router.get("/health")
async def get_data_sources_health():
    """Per-source liveness snapshot.

    Returns:
      total_active: number of sources active in the orchestrator (= 62 today).
      summary: rolled-up healthy / degraded / unknown counts.
      sources: per-source detail with category, phase, and last success/error
               age (seconds). Sources never queried this process show as
               status='unknown' to distinguish from confirmed failures.
    """
    try:
        from app.services.data_sources import (
            DataSourceOrchestrator,
            get_source_liveness_snapshot,
        )

        orchestrator = DataSourceOrchestrator()
        liveness = get_source_liveness_snapshot()

        # Healthy = success seen within the last hour.
        # Degraded = error within last hour AND success older than that (or never).
        # Unknown = never queried this process.
        STALE_AFTER = 3600  # 1 hour

        healthy = degraded = unknown = 0
        sources_detail = []

        for src_info in orchestrator.get_available_sources():
            name = src_info["name"]
            entry = liveness.get(name, {})
            last_success_age = entry.get("last_success_age_seconds")
            last_error_age = entry.get("last_error_age_seconds")
            last_error = entry.get("last_error")

            status = "unknown"
            if last_success_age is not None and last_success_age <= STALE_AFTER:
                status = "healthy"
                healthy += 1
            elif last_error_age is not None and last_error_age <= STALE_AFTER:
                status = "degraded"
                degraded += 1
            else:
                unknown += 1

            sources_detail.append({
                "name": name,
                "category": src_info["category"],
                "phase": src_info["phase"],
                "status": status,
                "last_success_age_seconds": last_success_age,
                "last_error_age_seconds": last_error_age,
                "last_error": last_error,
            })

        return {
            "total_active": len(sources_detail),
            "summary": {
                "healthy": healthy,
                "degraded": degraded,
                "unknown": unknown,
            },
            "sources": sources_detail,
        }
    except ImportError:
        raise HTTPException(
            status_code=503, detail="Data sources service not yet initialized"
        )
    except Exception as e:
        logger.error(f"Failed to compute source health: {e}")
        raise HTTPException(status_code=500, detail=str(e))
