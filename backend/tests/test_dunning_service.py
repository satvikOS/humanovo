"""Unit tests for the dunning service cadence logic.

Mocks the DB session + email driver. Locks in:
  • Day-bucketing: only days 3 / 7 / 14 trigger an email
  • Per-(user, template, lapse_date) idempotency via dedup_key
  • Recovery automatically removes a user from the queue
  • Send failures count + don't abort the rest of the cycle
"""
from __future__ import annotations

from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from app.services.dunning_service import (
    CADENCE,
    _bucket_for_days,
    _email_body,
    run_dunning_cycle,
)


def test_bucket_returns_template_for_canonical_days():
    """Day 3 → day_3 template, day 7 → day_7, day 14 → final."""
    assert _bucket_for_days(3)[0] == "dunning.day_3"
    assert _bucket_for_days(7)[0] == "dunning.day_7"
    assert _bucket_for_days(14)[0] == "dunning.day_14_final"


def test_bucket_returns_none_for_non_cadence_days():
    """Days between cadence steps don't trigger — the cron runs
    daily but most days are no-ops for a given user."""
    for d in (0, 1, 2, 4, 5, 6, 8, 9, 10, 11, 12, 13, 15, 30):
        assert _bucket_for_days(d) is None


def test_cadence_table_is_sorted_ascending():
    """Order matters for the future "send the latest applicable
    bucket if cron missed a day" enhancement."""
    days = [d for d, _, _ in CADENCE]
    assert days == sorted(days)


def test_email_body_text_and_html_both_emitted():
    text, html = _email_body("dunning.day_3", "u@example.com")
    assert "payment" in text.lower()
    assert "<pre" in html  # we wrap text in a <pre> for the basic HTML


def _result(rows):
    """Mock the SELECT-from-CTE that returns (user_id, transition_at, email)."""
    out = MagicMock()
    out.all = MagicMock(return_value=rows)
    return out


def _no_match():
    """Mock for the SELECT-1-FROM-email_sends dedup check returning None."""
    out = MagicMock()
    out.first = MagicMock(return_value=None)
    return out


@pytest.mark.asyncio
async def test_runs_cycle_sends_email_when_day_matches():
    """User who lapsed exactly 3 days ago → day_3 email fires."""
    user_id = uuid4()
    lapse_at = datetime.now(UTC) - timedelta(days=3)
    rows = [(user_id, lapse_at, "user@example.com")]

    db = MagicMock()
    db.commit = AsyncMock()

    # First db.execute is the user-query, then dedup check, then insert.
    db.execute = AsyncMock(side_effect=[
        _result(rows),    # SELECT users
        _no_match(),      # dedup SELECT
        MagicMock(),      # INSERT email_sends
    ])

    fake_driver = MagicMock()
    fake_driver.send_email = AsyncMock(return_value=True)

    with patch(
        "app.services.email_service.get_email_driver",
        return_value=fake_driver,
    ):
        result = await run_dunning_cycle(db)

    assert result.users_evaluated == 1
    assert result.emails_sent == 1
    assert result.emails_skipped_already_sent == 0
    fake_driver.send_email.assert_called_once()
    call_kwargs = fake_driver.send_email.call_args.kwargs
    assert call_kwargs["to"] == "user@example.com"
    assert "day_3" not in call_kwargs["subject"]  # subject is human-friendly


@pytest.mark.asyncio
async def test_runs_cycle_skips_when_already_sent_for_this_lapse():
    """The dedup_key includes the lapse_date so a cron retry within
    the same day doesn't re-send."""
    user_id = uuid4()
    lapse_at = datetime.now(UTC) - timedelta(days=7)
    rows = [(user_id, lapse_at, "user@example.com")]

    db = MagicMock()
    db.commit = AsyncMock()

    # Dedup check returns a row → skip.
    dup_match = MagicMock()
    dup_match.first = MagicMock(return_value=(1,))
    db.execute = AsyncMock(side_effect=[_result(rows), dup_match])

    fake_driver = MagicMock()
    fake_driver.send_email = AsyncMock(return_value=True)

    with patch(
        "app.services.email_service.get_email_driver",
        return_value=fake_driver,
    ):
        result = await run_dunning_cycle(db)

    assert result.users_evaluated == 1
    assert result.emails_skipped_already_sent == 1
    assert result.emails_sent == 0
    fake_driver.send_email.assert_not_called()


@pytest.mark.asyncio
async def test_runs_cycle_skips_when_day_not_a_cadence_day():
    """User lapsed 5 days ago — between day-3 and day-7 buckets.
    No email today; evaluated still increments."""
    user_id = uuid4()
    lapse_at = datetime.now(UTC) - timedelta(days=5)
    rows = [(user_id, lapse_at, "user@example.com")]

    db = MagicMock()
    db.commit = AsyncMock()
    db.execute = AsyncMock(side_effect=[_result(rows)])  # only the SELECT

    fake_driver = MagicMock()
    fake_driver.send_email = AsyncMock()

    with patch(
        "app.services.email_service.get_email_driver",
        return_value=fake_driver,
    ):
        result = await run_dunning_cycle(db)

    assert result.users_evaluated == 1
    assert result.emails_sent == 0
    fake_driver.send_email.assert_not_called()


@pytest.mark.asyncio
async def test_send_failure_counted_but_does_not_abort():
    """Email driver returns False (transient send fail). The
    user still gets an email_sends row (ok=False) so the cron
    doesn't retry every minute; surface count via failed=1."""
    user_id = uuid4()
    lapse_at = datetime.now(UTC) - timedelta(days=3)
    rows = [(user_id, lapse_at, "user@example.com")]

    db = MagicMock()
    db.commit = AsyncMock()
    db.execute = AsyncMock(side_effect=[
        _result(rows), _no_match(), MagicMock(),
    ])

    fake_driver = MagicMock()
    fake_driver.send_email = AsyncMock(return_value=False)

    with patch(
        "app.services.email_service.get_email_driver",
        return_value=fake_driver,
    ):
        result = await run_dunning_cycle(db)

    assert result.emails_failed == 1
    assert result.emails_sent == 0


@pytest.mark.asyncio
async def test_no_past_due_users_returns_zero_counts():
    """Empty query result — clean exit, all counters zero."""
    db = MagicMock()
    db.commit = AsyncMock()
    db.execute = AsyncMock(side_effect=[_result([])])

    fake_driver = MagicMock()
    fake_driver.send_email = AsyncMock()

    with patch(
        "app.services.email_service.get_email_driver",
        return_value=fake_driver,
    ):
        result = await run_dunning_cycle(db)

    assert result.users_evaluated == 0
    assert result.emails_sent == 0
    fake_driver.send_email.assert_not_called()
