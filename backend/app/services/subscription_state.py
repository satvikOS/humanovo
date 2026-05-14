"""Subscription state machine — Stripe transitions → audit table.

Single-write API: every Stripe webhook that mutates subscription
state calls `record_transition()` with the before/after snapshot.
The function:

  1. Inserts a row into subscription_transitions
  2. Returns a structured `Transition` object the caller can use to
     decide downstream actions (fire dunning email, send "thanks
     for upgrading" message, log to audit chain, etc.)

The audit is APPEND-ONLY — no updates, no deletes outside the
GDPR cascade. This keeps the history immutable for compliance + lets
the billing dashboard render an accurate timeline.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


logger = logging.getLogger(__name__)


# Stripe subscription statuses we care about. Other values are
# passed through verbatim so we don't have to redeploy every time
# Stripe adds a new state.
KNOWN_STATUSES = {
    "trialing", "active", "past_due", "canceled",
    "incomplete", "incomplete_expired", "unpaid", "paused",
}


@dataclass
class Transition:
    """One subscription state change. Returned from record_transition
    so the caller can branch (fire emails, log audit, etc.)."""
    user_id: UUID
    from_status: str | None
    to_status: str
    from_tier: str | None
    to_tier: str
    transition_at: datetime
    is_upgrade: bool      # tier went up (researcher → lab)
    is_downgrade: bool    # tier went down
    is_lapse: bool        # status went active → past_due / unpaid
    is_recovery: bool     # status went past_due → active / trialing
    is_cancel: bool       # status went anything → canceled


# Tier ordering — used to decide upgrade vs downgrade.
_TIER_ORDER = {"trial": 0, "researcher": 1, "lab": 2, "institution": 3}


def _classify(
    from_status: str | None, to_status: str,
    from_tier: str | None, to_tier: str,
) -> dict[str, bool]:
    """Pure function — no DB, easy to test. Returns the flag dict
    `Transition` carries."""
    from_rank = _TIER_ORDER.get(from_tier or "", -1)
    to_rank = _TIER_ORDER.get(to_tier, -1)
    is_upgrade = from_rank >= 0 and to_rank > from_rank
    is_downgrade = from_rank >= 0 and to_rank < from_rank
    is_lapse = (
        from_status in {"active", "trialing"}
        and to_status in {"past_due", "unpaid"}
    )
    is_recovery = (
        from_status in {"past_due", "unpaid"}
        and to_status in {"active", "trialing"}
    )
    is_cancel = to_status == "canceled"
    return {
        "is_upgrade": is_upgrade,
        "is_downgrade": is_downgrade,
        "is_lapse": is_lapse,
        "is_recovery": is_recovery,
        "is_cancel": is_cancel,
    }


async def record_transition(
    db: AsyncSession,
    *,
    user_id: UUID,
    from_status: str | None,
    to_status: str,
    from_tier: str | None,
    to_tier: str,
    stripe_subscription_id: str | None = None,
    stripe_event_id: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> Transition | None:
    """Append a row + return the classified transition. Returns None
    if to_status == from_status AND to_tier == from_tier (no-op
    transition — Stripe sometimes re-delivers the same state).

    Caller commits the session (this function only INSERTs)."""
    if from_status == to_status and from_tier == to_tier:
        return None  # no-op; don't pollute the audit table

    import json

    transition_at = datetime.now(UTC)
    await db.execute(
        text(
            """
            INSERT INTO subscription_transitions
                (user_id, stripe_subscription_id,
                 from_status, to_status, from_tier, to_tier,
                 transition_at, stripe_event_id, metadata)
            VALUES
                (:uid, :sub_id, :fs, :ts, :ft, :tt, :at, :evt,
                 CAST(:meta AS JSONB))
            """
        ),
        {
            "uid": str(user_id),
            "sub_id": stripe_subscription_id,
            "fs": from_status,
            "ts": to_status,
            "ft": from_tier,
            "tt": to_tier,
            "at": transition_at,
            "evt": stripe_event_id,
            "meta": json.dumps(metadata) if metadata else None,
        },
    )

    flags = _classify(from_status, to_status, from_tier, to_tier)
    logger.info(
        "subscription transition user_id=%s %s/%s → %s/%s "
        "upgrade=%s downgrade=%s lapse=%s recovery=%s cancel=%s",
        user_id, from_status, from_tier, to_status, to_tier,
        flags["is_upgrade"], flags["is_downgrade"],
        flags["is_lapse"], flags["is_recovery"], flags["is_cancel"],
    )

    return Transition(
        user_id=user_id,
        from_status=from_status,
        to_status=to_status,
        from_tier=from_tier,
        to_tier=to_tier,
        transition_at=transition_at,
        **flags,
    )


async def latest_transition_for_user(
    db: AsyncSession, *, user_id: UUID,
) -> dict[str, Any] | None:
    """Return the most recent transition for the user, or None if no
    history yet. Used by the dunning cron to decide cadence."""
    row = (await db.execute(
        text(
            """
            SELECT from_status, to_status, from_tier, to_tier,
                   transition_at, stripe_event_id, metadata
            FROM subscription_transitions
            WHERE user_id = :uid
            ORDER BY transition_at DESC
            LIMIT 1
            """
        ),
        {"uid": str(user_id)},
    )).first()
    if row is None:
        return None
    return {
        "from_status": row[0],
        "to_status": row[1],
        "from_tier": row[2],
        "to_tier": row[3],
        "transition_at": row[4].isoformat() if row[4] else None,
        "stripe_event_id": row[5],
        "metadata": row[6],
    }
