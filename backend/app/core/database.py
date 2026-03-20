"""
GenUp Database Configuration

SQLAlchemy async database setup for PostgreSQL.
"""

from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import declarative_base

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)

# Create async engine
engine = create_async_engine(
    settings.DATABASE_URL,
    pool_size=settings.DATABASE_POOL_SIZE,
    max_overflow=settings.DATABASE_MAX_OVERFLOW,
    echo=settings.DEBUG,
)

# Create session factory
async_session_factory = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)

# Declarative base for models
Base = declarative_base()


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """Dependency for getting database sessions."""
    async with async_session_factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


async def init_db() -> None:
    """Initialize database tables."""
    # Mask password in URL for safe logging
    db_url = settings.DATABASE_URL
    masked_url = db_url
    if "@" in db_url:
        pre_at = db_url.split("@")[0]
        post_at = db_url.split("@", 1)[1]
        if ":" in pre_at:
            scheme_user = pre_at.rsplit(":", 1)[0]
            masked_url = f"{scheme_user}:****@{post_at}"
    logger.info("Initializing database connection", database=masked_url)
    try:
        # Test connection
        async with engine.begin() as conn:
            # Create all tables
            await conn.run_sync(Base.metadata.create_all)
        logger.info("Database initialized successfully", database=masked_url)
    except Exception as e:
        logger.error(
            "Failed to initialize database",
            error=str(e),
            database=masked_url,
            hint="Set DATABASE_URL env var to point to your PostgreSQL/RDS instance",
        )
        # Don't raise - allow app to start without DB for development
        logger.warning("Application starting without database connection")


async def close_db() -> None:
    """Close database connections."""
    logger.info("Closing database connection")
    await engine.dispose()
