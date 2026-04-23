"""
Session-level test configuration.

Creates the database schema once per pytest run so tests that hit
the DB directly (test_citations_endpoint.py, test_discovery_sessions.py)
can find their tables in a freshly-provisioned Postgres.

CI spins up an empty `humanovo` database via the postgres service
in .github/workflows/ci.yml; no alembic upgrade step runs before
pytest. Historically this worked because most tests introspected
routers without touching the DB — but the citations + discovery-
session suites now call async handlers directly, which means the
engine lazily opens a connection and fails on "relation does not
exist" if the tables aren't there.

This conftest calls Base.metadata.create_all once at session start
(equivalent to what app.core.database.init_db() does on FastAPI
startup), then disposes the engine so the per-test autouse fixtures
in the individual test files can rebuild a fresh pool on the current
event loop. Idempotent — safe to run against a DB that already
contains the tables.
"""
from __future__ import annotations

import asyncio

import pytest


@pytest.fixture(scope="session", autouse=True)
def _ensure_schema() -> None:
    # Import lazily: the tests module gets collected before app is
    # fully importable in some branches, and we don't want module-
    # level imports here to affect non-DB tests.
    from app.core.database import engine
    from app.models.base import Base
    import app.models  # noqa: F401  — loads every model into Base.metadata

    async def _setup() -> None:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        await engine.dispose()

    # Run schema creation on a dedicated loop so it doesn't collide
    # with pytest-asyncio's per-test loops.
    try:
        loop = asyncio.new_event_loop()
        loop.run_until_complete(_setup())
        loop.close()
    except Exception as e:
        # Surface the failure — without tables the DB tests would
        # fail anyway, but with a much less obvious error.
        raise RuntimeError(
            f"Failed to create test schema: {e}. "
            "Check DATABASE_URL and that Postgres is reachable."
        ) from e
