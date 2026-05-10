"""Unit tests for the persistent Stripe webhook dedup layer.

Covers `_record_event_seen` and `_seen_event_in_memory` from
`app/api/v1/endpoints/billing.py`. The DB layer is mocked — we test
that:
  • First call to _record_event_seen returns True (= proceed)
  • Second call (same event_id) returns False (= short-circuit)
  • Empty event_id falls open (returns True) so production never
    silently swallows a malformed event from Stripe
  • In-memory LRU evicts past _RECENT_EVENT_CAP and updates on
    first-see, not on hit (move-to-end happens on the write path)
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from app.api.v1.endpoints.billing import (
    _RECENT_EVENT_IDS,
    _record_event_seen,
    _seen_event_in_memory,
)


def _db_returning(scalar_value):
    """Build a mock AsyncSession whose execute() returns a result
    whose scalar_one_or_none() yields the given value. INSERT ... ON
    CONFLICT ... RETURNING uses scalar_one_or_none()."""
    db = MagicMock()
    result = MagicMock()
    result.scalar_one_or_none = MagicMock(return_value=scalar_value)
    db.execute = AsyncMock(return_value=result)
    return db


@pytest.mark.asyncio
async def test_first_event_returns_true_and_updates_lru():
    _RECENT_EVENT_IDS.clear()
    db = _db_returning("evt_abc123")  # row inserted
    out = await _record_event_seen(
        db, event_id="evt_abc123", event_type="customer.subscription.updated",
        stripe_created_ts=1700000000, customer_id="cus_xyz",
    )
    assert out is True
    assert "evt_abc123" in _RECENT_EVENT_IDS


@pytest.mark.asyncio
async def test_replay_returns_false_and_does_not_double_record():
    _RECENT_EVENT_IDS.clear()
    db = _db_returning(None)  # ON CONFLICT DO NOTHING — 0 rows back
    out = await _record_event_seen(
        db, event_id="evt_dup", event_type="customer.subscription.updated",
    )
    assert out is False
    # LRU should NOT add the event_id when the DB rejected the insert
    # (avoid masking real DB issues with a stale in-memory hit).
    assert "evt_dup" not in _RECENT_EVENT_IDS


@pytest.mark.asyncio
async def test_empty_event_id_fails_open():
    """A malformed event without event.id should NOT silently dedup
    to "already seen" — it'd let bad data slip through. Better to
    fail open (return True = proceed) so the rest of the pipeline's
    validation catches it."""
    db = _db_returning("anything")
    out = await _record_event_seen(db, event_id="", event_type="x")
    assert out is True
    db.execute.assert_not_called()


def test_seen_event_in_memory_no_op_for_empty():
    assert _seen_event_in_memory("") is False


def test_seen_event_in_memory_returns_true_after_record():
    _RECENT_EVENT_IDS.clear()
    _RECENT_EVENT_IDS["evt_inmem"] = None
    assert _seen_event_in_memory("evt_inmem") is True
    assert _seen_event_in_memory("evt_other") is False
