"""
Alembic Environment Configuration

This module configures Alembic for database migrations.
"""
# ruff: noqa: E402
# The pre-flight DDL block below has to run before app.* imports load
# Base.metadata, so the import-vs-side-effect ordering is intentional.

import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy import pool, text
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

# Postgres extensions required by humanovo migrations:
#   - pg_trgm     (gin_trgm_ops indexes on evidence text columns)
#   - uuid-ossp   (uuid_generate_v4 server-side defaults)
#   - vector      (pgvector for embeddings; migration 003 expects it)
# Auto-enabling them here keeps a fresh DB self-bootstrappable; CREATE
# EXTENSION IF NOT EXISTS is a no-op on existing clusters.
_REQUIRED_EXTENSIONS = ("pg_trgm", "uuid-ossp", "vector")

# Import all models so Alembic can detect them via Base.metadata.
# Importing `app.models` triggers app/models/__init__.py which pulls in every
# ORM class (including AuditRecord and the full platform-entities set).
from app.core.config import settings
from app.models import (
    Base,
)

# Alembic Config object
config = context.config

# Interpret the config file for Python logging
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Model MetaData for autogenerate
target_metadata = Base.metadata


def get_url():
    """Get database URL from settings."""
    return settings.DATABASE_URL


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode.

    This configures the context with just a URL
    and not an Engine, though an Engine is acceptable
    here as well. By skipping the Engine creation
    we don't even need a DBAPI to be available.
    """
    url = get_url()
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    """Run migrations with a connection."""
    context.configure(connection=connection, target_metadata=target_metadata)

    with context.begin_transaction():
        context.run_migrations()


def _preflight(sync_connection: Connection) -> None:
    """Idempotent DDL run BEFORE alembic claims the connection.

    Two jobs:
      (1) Ensure Postgres extensions humanovo migrations rely on are
          installed (pg_trgm, uuid-ossp, vector). CREATE EXTENSION IF
          NOT EXISTS is a no-op when present.
      (2) Widen `alembic_version.version_num` to VARCHAR(255). The
          project uses descriptive revision IDs (e.g. `018_user_org_and_bio`)
          that overflow the alembic default of VARCHAR(32). Done in
          AUTOCOMMIT so it commits immediately and doesn't fight the
          per-migration transaction alembic itself opens.
    """
    autocommit = sync_connection.execution_options(isolation_level="AUTOCOMMIT")
    for ext in _REQUIRED_EXTENSIONS:
        autocommit.execute(text(f'CREATE EXTENSION IF NOT EXISTS "{ext}"'))
    autocommit.execute(text(
        "CREATE TABLE IF NOT EXISTS alembic_version ("
        "  version_num VARCHAR(255) NOT NULL, "
        "  CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num)"
        ")"
    ))
    autocommit.execute(text(
        "ALTER TABLE alembic_version ALTER COLUMN version_num TYPE VARCHAR(255)"
    ))


async def run_async_migrations() -> None:
    """Run migrations in 'online' mode with async engine."""
    configuration = config.get_section(config.config_ini_section) or {}
    configuration["sqlalchemy.url"] = get_url()

    connectable = async_engine_from_config(
        configuration,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    async with connectable.connect() as connection:
        await connection.run_sync(_preflight)
        await connection.run_sync(do_run_migrations)

    await connectable.dispose()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode."""
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
