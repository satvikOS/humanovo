#!/usr/bin/env python3
"""Daily dunning-cycle cron entry point.

Calls `dunning_service.run_dunning_cycle()` and prints a structured
JSON line that journald / CloudWatch picks up. Exit 0 always —
partial failures (some emails couldn't send) log + count but don't
fail the cron (the next day's run picks up where this left off).

Env: DATABASE_URL required. Email driver configured via
settings.EMAIL_DRIVER (defaults to log-only).
"""
from __future__ import annotations

import asyncio
import json
import sys


async def main_async() -> int:
    from app.core.database import async_session_factory
    from app.services.dunning_service import run_dunning_cycle

    async with async_session_factory() as db:
        result = await run_dunning_cycle(db)

    print(json.dumps({
        "stage": "complete",
        "users_evaluated": result.users_evaluated,
        "emails_sent": result.emails_sent,
        "emails_skipped_already_sent": result.emails_skipped_already_sent,
        "emails_failed": result.emails_failed,
    }))
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main_async()))
