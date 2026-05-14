#!/usr/bin/env python3
"""Daily trial-expiry cron entry point.

Calls `trial_expiry_service.run_trial_expiry_cycle()` and prints a
structured JSON line for journald / CloudWatch.

Env: DATABASE_URL required. Email driver configured via
settings.EMAIL_DRIVER (defaults to log-only).
"""
from __future__ import annotations

import asyncio
import json
import sys


async def main_async() -> int:
    from app.core.database import async_session_factory
    from app.services.trial_expiry_service import run_trial_expiry_cycle

    async with async_session_factory() as db:
        result = await run_trial_expiry_cycle(db)

    print(json.dumps({
        "stage": "complete",
        "users_evaluated": result.users_evaluated,
        "warnings_sent": result.warnings_sent,
        "expirations_processed": result.expirations_processed,
        "emails_skipped_already_sent": result.emails_skipped_already_sent,
        "emails_failed": result.emails_failed,
    }))
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main_async()))
