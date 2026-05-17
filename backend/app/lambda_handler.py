"""AWS Lambda entrypoint. Wraps the FastAPI app in Mangum for API Gateway v2 events.

Also exposes an out-of-band migration path: invoking the function
with the payload {"action": "migrate"} runs `alembic upgrade head`
against the database instead of serving an HTTP request. The Aurora
cluster sits in an isolated VPC subnet unreachable from CI, so the
in-VPC Lambda is the only thing that can apply migrations — the
deploy workflow triggers this via `aws lambda invoke` after each
backend deploy.
"""
import logging
import os

from mangum import Mangum

from app.main import app

logger = logging.getLogger(__name__)

# lifespan="off" because Lambda containers don't have a graceful shutdown
# hook that would let FastAPI's lifespan tasks run cleanly. Move any
# startup work to module import (it runs once per cold container).
_asgi_handler = Mangum(app, lifespan="off")


def _run_migrations() -> dict:
    """Apply all pending Alembic migrations (`upgrade head`).

    alembic.ini + migrations/ are copied into LAMBDA_TASK_ROOT by
    Dockerfile.lambda. migrations/env.py reads the DB URL from
    app.core.config.settings (which resolves it from Secrets Manager
    in prod), so no extra wiring is needed here.
    """
    from alembic import command
    from alembic.config import Config

    task_root = os.environ.get("LAMBDA_TASK_ROOT", ".")
    ini_path = os.path.join(task_root, "alembic.ini")
    cfg = Config(ini_path)
    # script_location in alembic.ini is the relative "migrations" —
    # make it absolute so it resolves regardless of CWD.
    cfg.set_main_option("script_location", os.path.join(task_root, "migrations"))
    logger.info("Running alembic upgrade head (ini=%s)", ini_path)
    command.upgrade(cfg, "head")
    logger.info("alembic upgrade head complete")
    return {"ok": True, "migrated": "head"}


def _run_ingest(event: dict) -> dict:
    """Bulk-ingest real literature for a batch of topics into the
    global Evidence corpus + common KG.

    The regular ingestion endpoints schedule work as FastAPI
    BackgroundTasks, which don't survive on Lambda (the container
    freezes once the HTTP response is returned). This out-of-band
    invoke runs the ingestion synchronously inside one Lambda
    execution so it actually completes and commits.
    """
    import asyncio

    from app.services.bulk_ingest import run_ingest

    topics = event.get("topics") or []
    if not isinstance(topics, list) or not topics:
        return {"ok": False, "error": "no topics supplied"}
    max_per_source = int(event.get("max_per_source", 100))
    logger.info("Bulk ingest: %d topics, max_per_source=%d",
                len(topics), max_per_source)
    return asyncio.run(run_ingest(topics, max_per_source))


def handler(event, context):
    """Lambda handler. Routes out-of-band maintenance invokes
    ({"action": "migrate"} / {"action": "ingest"}) to their runners;
    everything else is a normal API Gateway v2 request handled by
    Mangum.

    API Gateway v2 HTTP events are dicts with keys like `version`,
    `routeKey`, `rawPath` — never a top-level `action` — so these
    branches can't be reached by ordinary traffic."""
    if isinstance(event, dict) and event.get("action") == "migrate":
        try:
            return _run_migrations()
        except Exception as e:  # noqa: BLE001 - report failure to the invoker
            logger.exception("Migration run failed")
            return {"ok": False, "error": f"{type(e).__name__}: {e}"}
    if isinstance(event, dict) and event.get("action") == "ingest":
        try:
            return _run_ingest(event)
        except Exception as e:  # noqa: BLE001 - report failure to the invoker
            logger.exception("Bulk ingest run failed")
            return {"ok": False, "error": f"{type(e).__name__}: {e}"}
    return _asgi_handler(event, context)
