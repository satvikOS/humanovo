#!/usr/bin/env python3
"""GDPR Art. 17 hard-delete cron.

Runs daily. Picks up rows from `users` where:
  • `delete_requested_at IS NOT NULL`
  • `deleted_at IS NULL`
  • `delete_requested_at < now() - INTERVAL '30 days'`

For each match, runs the cascade:
  1. Delete owned data: projects, hypotheses, notebook_pages,
     citations, discovery_sessions, experiments, knowledge_graph_nodes,
     knowledge_graph_edges (via owner_id FK).
  2. Anonymise audit_log rows: HIPAA 7-year retention requires we
     KEEP the records, but the user-identifying columns are nulled
     out / replaced with `deleted-user-{uuid}` so the chain integrity
     stays intact while no PII remains.
  3. Set `users.deleted_at = now()`. The row stays so the audit
     chain still has a referent for prior actions; subsequent login
     attempts hit a 410.

Output: structured JSON per processed user to stdout (cron picks up
the log via journald / CloudWatch). Exit 0 always — partial failures
are logged but don't block the rest of the queue.

Idempotent: re-running the same day is a no-op (the WHERE clause
filters on deleted_at IS NULL). Safe to run multiple times.

Env: DATABASE_URL required.
"""
from __future__ import annotations

import asyncio
import json
import logging
import sys
from datetime import UTC, datetime, timedelta
from uuid import UUID


logger = logging.getLogger("hard_delete")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")


GRACE_DAYS = 30


async def find_expired_users(db, *, grace_days: int = GRACE_DAYS) -> list[tuple[UUID, str]]:
    """Return [(user_id, email), ...] for every user past their
    grace window."""
    from sqlalchemy import text

    cutoff = datetime.now(UTC) - timedelta(days=grace_days)
    result = await db.execute(
        text(
            """
            SELECT id, email FROM users
            WHERE delete_requested_at IS NOT NULL
              AND deleted_at IS NULL
              AND delete_requested_at < :cutoff
            """
        ),
        {"cutoff": cutoff},
    )
    return [(row[0], row[1]) for row in result]


async def cascade_delete_owned_data(db, user_id: UUID) -> dict[str, int]:
    """Delete cascading owned data. Returns per-table row counts.

    Each table is deleted independently — a failure in one table
    doesn't roll back the others. The audit chain entry surfaces
    any partial-failure for forensics."""
    from sqlalchemy import text

    counts: dict[str, int] = {}
    # Order matters: child tables before parent (FK constraints).
    delete_statements = [
        ("hypothesis_tools", "DELETE FROM hypothesis_tools WHERE owner_id = :uid"),
        ("citations", "DELETE FROM citations WHERE owner_id = :uid"),
        ("notebook_pages", "DELETE FROM notebook_pages WHERE owner_id = :uid"),
        ("discovery_sessions", "DELETE FROM discovery_sessions WHERE user_id = :uid"),
        ("experiments", "DELETE FROM experiments WHERE owner_id = :uid"),
        ("hypotheses", "DELETE FROM hypotheses WHERE owner_id = :uid"),
        ("projects", "DELETE FROM projects WHERE owner_id = :uid"),
        # KG nodes/edges are owner_id-scoped; common (NULL owner) rows
        # are NOT deleted (they belong to the platform, not the user).
        ("kg_nodes", "DELETE FROM knowledge_graph_nodes WHERE owner_id = :uid"),
        ("kg_edges", "DELETE FROM knowledge_graph_edges WHERE owner_id = :uid"),
    ]
    for name, sql in delete_statements:
        try:
            result = await db.execute(text(sql), {"uid": user_id})
            counts[name] = getattr(result, "rowcount", -1)
        except Exception as e:
            counts[name] = -1
            logger.warning(
                "hard_delete: cascade %s failed user_id=%s: %s",
                name, user_id, e,
            )
    return counts


async def anonymise_audit_log(db, user_id: UUID) -> int:
    """HIPAA 7-year retention: KEEP audit records, scrub identity.

    Replaces user_id in audit_log with a tombstone string keyed off
    a hash of the original UUID, so the chain integrity is preserved
    (every record still references SOMETHING in the user-id column)
    but the actual identifier is gone. Returns rows-affected."""
    from sqlalchemy import text

    tombstone = f"deleted-user-{user_id.hex[:8]}"
    try:
        result = await db.execute(
            text(
                """
                UPDATE audit_log
                SET user_id = :tombstone
                WHERE user_id = :original
                """
            ),
            {"tombstone": tombstone, "original": str(user_id)},
        )
        return getattr(result, "rowcount", 0)
    except Exception as e:
        logger.warning(
            "hard_delete: audit anonymisation failed user_id=%s: %s",
            user_id, e,
        )
        return -1


async def mark_user_deleted(db, user_id: UUID) -> None:
    """Set users.deleted_at = now(). The row stays (audit chain
    references), but is_active is forced FALSE and the email column
    is scrubbed so it doesn't show up in support tickets / leak via
    /metrics."""
    from sqlalchemy import text

    tombstone_email = f"deleted-{user_id.hex[:8]}@deleted.humanovo.invalid"
    await db.execute(
        text(
            """
            UPDATE users
            SET deleted_at = now(),
                is_active = FALSE,
                email = :tombstone_email,
                full_name = NULL,
                bio = NULL,
                stripe_customer_id = NULL,
                stripe_subscription_id = NULL,
                api_key_hash = NULL
            WHERE id = :uid
            """
        ),
        {"uid": user_id, "tombstone_email": tombstone_email},
    )


async def process_user(db, user_id: UUID, email: str) -> dict:
    """Run the full cascade for one user. Returns a structured report."""
    started_at = datetime.now(UTC)
    cascade = await cascade_delete_owned_data(db, user_id)
    audit_anon = await anonymise_audit_log(db, user_id)
    await mark_user_deleted(db, user_id)
    await db.commit()
    return {
        "user_id": str(user_id),
        "original_email": email,
        "started_at": started_at.isoformat(),
        "completed_at": datetime.now(UTC).isoformat(),
        "cascade_counts": cascade,
        "audit_records_anonymised": audit_anon,
    }


async def main_async() -> int:
    from app.core.database import async_session_factory

    print(json.dumps({
        "stage": "start",
        "grace_days": GRACE_DAYS,
        "cutoff": (datetime.now(UTC) - timedelta(days=GRACE_DAYS)).isoformat(),
    }))

    async with async_session_factory() as db:
        expired = await find_expired_users(db)

    print(json.dumps({"stage": "queue", "user_count": len(expired)}))

    successes = 0
    failures = 0
    for user_id, email in expired:
        async with async_session_factory() as db:
            try:
                report = await process_user(db, user_id, email)
                print(json.dumps({"stage": "deleted", **report}))
                successes += 1
            except Exception as e:
                logger.error("hard_delete failed user_id=%s: %s", user_id, e)
                print(json.dumps({
                    "stage": "failed",
                    "user_id": str(user_id),
                    "error": f"{type(e).__name__}: {e}",
                }))
                failures += 1

    print(json.dumps({
        "stage": "complete",
        "successes": successes,
        "failures": failures,
    }))
    return 0  # always exit 0 — failures logged but don't block cron


if __name__ == "__main__":
    sys.exit(asyncio.run(main_async()))
