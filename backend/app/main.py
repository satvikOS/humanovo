"""
Humanovo Backend - Main FastAPI Application

This module initializes the FastAPI application with all routes,
middleware, and event handlers for the Humanovo platform.
"""

# Silence pydantic-v1-check warnings globally BEFORE fastapi imports so
# fastapi._compat.shared.is_pydantic_v1_model_instance doesn't hit a
# RecursionError in warnings.simplefilter (observed on pydantic 2.13 +
# fastapi 0.136 with certain response shapes). Filter is set once at
# process start rather than per-request.
import warnings as _warnings
_warnings.filterwarnings("ignore", category=UserWarning, module="pydantic")

from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api import router as api_router
from app.core.config import settings
from app.core.logging import get_logger, setup_logging

logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Application lifespan handler for startup and shutdown events."""
    # Startup
    logger.info("Starting Humanovo Backend", version=settings.VERSION)

    # Initialize database connections
    from app.core.database import init_db

    await init_db()

    # Initialize knowledge stores (non-fatal — app starts without them)
    try:
        from app.knowledge.vector_store import init_vector_store

        await init_vector_store()
    except Exception as e:
        logger.warning("Vector store initialization failed — continuing without it", error=str(e))

    try:
        from app.knowledge.graph_store import init_graph_store

        await init_graph_store()
    except Exception as e:
        logger.warning("Graph store initialization failed — continuing without it", error=str(e))

    logger.info("Humanovo Backend started successfully")

    yield

    # Shutdown
    logger.info("Shutting down Humanovo Backend")

    # Cleanup connections
    from app.core.database import close_db

    await close_db()

    logger.info("Humanovo Backend shutdown complete")


def create_app() -> FastAPI:
    """Create and configure the FastAPI application."""
    setup_logging()

    app = FastAPI(
        title="humanovo API",
        description="Biomedical Discovery Platform API",
        version=settings.VERSION,
        docs_url="/api/docs",
        redoc_url="/api/redoc",
        openapi_url="/api/openapi.json",
        lifespan=lifespan,
        # Disable the 307 trailing-slash redirect: we'd rather accept
        # both `/clinical-trials` and `/clinical-trials/` inline than
        # force the browser to follow a cross-origin redirect through
        # the Vite / CloudFront proxy (which strips CORS headers).
        redirect_slashes=False,
    )

    # Configure CORS
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.CORS_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Include API routers
    app.include_router(api_router, prefix="/api")

    # Health check endpoint with service-level diagnostics
    @app.get("/health")
    async def health_check():
        """Health check endpoint with connectivity diagnostics for AWS monitoring."""
        from sqlalchemy import text

        from app.core.database import engine

        checks: dict[str, str] = {}

        # Check PostgreSQL / RDS connectivity
        try:
            async with engine.connect() as conn:
                await conn.execute(text("SELECT 1"))
            checks["database"] = "connected"
        except Exception as e:
            checks["database"] = f"error: {str(e)[:120]}"

        # Check pgvector extension
        try:
            async with engine.connect() as conn:
                await conn.execute(text("SELECT 1 FROM pg_extension WHERE extname = 'vector'"))
            checks["pgvector"] = "available"
        except Exception as e:
            checks["pgvector"] = f"error: {str(e)[:120]}"

        # Check Neo4j / graph store
        try:
            from app.knowledge.graph_store import graph_store

            if graph_store and hasattr(graph_store, "_driver") and graph_store._driver:
                checks["neo4j"] = "connected"
            else:
                checks["neo4j"] = "not_configured"
        except Exception as e:
            checks["neo4j"] = f"error: {str(e)[:120]}"

        overall = "healthy" if checks.get("database") == "connected" else "degraded"

        return JSONResponse(
            content={
                "status": overall,
                "version": settings.VERSION,
                "service": "humanovo-backend",
                "environment": settings.ENVIRONMENT,
                "checks": checks,
            }
        )

    return app


app = create_app()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=settings.DEBUG,
        log_level="debug" if settings.DEBUG else "info",
    )
