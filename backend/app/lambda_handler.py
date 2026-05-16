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


def handler(event, context):
    """Lambda handler. Routes an out-of-band migration invoke
    ({"action": "migrate"}) to the migration runner; everything else
    is a normal API Gateway v2 request handled by Mangum.

    API Gateway v2 HTTP events are dicts with keys like `version`,
    `routeKey`, `rawPath` — never a top-level `action` — so the
    branch can't be reached by ordinary traffic."""
    if isinstance(event, dict) and event.get("action") == "migrate":
        try:
            return _run_migrations()
        except Exception as e:  # noqa: BLE001 - report failure to the invoker
            logger.exception("Migration run failed")
            return {"ok": False, "error": f"{type(e).__name__}: {e}"}
    return _asgi_handler(event, context)
