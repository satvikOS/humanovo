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

    # Interactive API docs (Swagger / ReDoc / OpenAPI JSON) are gated
    # behind DEBUG so production doesn't publish the full API surface.
    # The discovery pipeline routes describe the proprietary architecture
    # in their schemas; exposing them on production is an IP leak.
    docs_url = "/api/docs" if settings.DEBUG else None
    redoc_url = "/api/redoc" if settings.DEBUG else None
    openapi_url = "/api/openapi.json" if settings.DEBUG else None

    app = FastAPI(
        title="humanovo API",
        description="Biomedical Discovery Platform API",
        version=settings.VERSION,
        docs_url=docs_url,
        redoc_url=redoc_url,
        openapi_url=openapi_url,
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

    # Liveness endpoint — aggregate-only, no service topology details.
    #
    # Per-service diagnostics (database / pgvector / Neo4j status, error
    # strings) are deliberately NOT returned here because (a) anyone can
    # hit /health unauthenticated, and (b) leaking which services are
    # configured + their failure modes is reconnaissance for an attacker
    # and an IP signal for competitors. Detailed checks run server-side
    # and any non-healthy state is logged + alerted via CloudWatch.
    # An admin-only `/admin/health` (Sprint 1 / D4) returns the full
    # diagnostic for ops/monitoring.
    @app.get("/health")
    async def health_check():
        from sqlalchemy import text

        from app.core.database import engine

        # The only signal we expose to anonymous callers is a 200 with
        # status="healthy" or 503 with status="degraded". No per-service
        # detail; no error strings.
        try:
            async with engine.connect() as conn:
                await conn.execute(text("SELECT 1"))
            healthy = True
        except Exception as exc:
            logger.error("health check failed", exception_type=type(exc).__name__)
            healthy = False

        if healthy:
            return JSONResponse(
                content={"status": "healthy", "service": "humanovo-backend"}
            )
        return JSONResponse(
            status_code=503,
            content={"status": "degraded", "service": "humanovo-backend"},
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
