"""
GenUp Backend - Main FastAPI Application

This module initializes the FastAPI application with all routes,
middleware, and event handlers for the GenUp platform.
"""

from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api import router as api_router
from app.core.config import settings
from app.core.logging import setup_logging, get_logger

logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Application lifespan handler for startup and shutdown events."""
    # Startup
    logger.info("Starting GenUp Backend", version=settings.VERSION)

    # Initialize database connections
    from app.core.database import init_db
    await init_db()

    # Initialize knowledge stores
    from app.knowledge.vector_store import init_vector_store
    from app.knowledge.graph_store import init_graph_store
    await init_vector_store()
    await init_graph_store()

    logger.info("GenUp Backend started successfully")

    yield

    # Shutdown
    logger.info("Shutting down GenUp Backend")

    # Cleanup connections
    from app.core.database import close_db
    await close_db()

    logger.info("GenUp Backend shutdown complete")


def create_app() -> FastAPI:
    """Create and configure the FastAPI application."""
    setup_logging()

    app = FastAPI(
        title="GenUp API",
        description="Biomedical Discovery Platform API",
        version=settings.VERSION,
        docs_url="/api/docs",
        redoc_url="/api/redoc",
        openapi_url="/api/openapi.json",
        lifespan=lifespan,
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

    # Health check endpoint
    @app.get("/health")
    async def health_check():
        """Health check endpoint for container orchestration."""
        return JSONResponse(
            content={
                "status": "healthy",
                "version": settings.VERSION,
                "service": "genup-backend",
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
