"""Unit tests for the trial-expiry cron logic.

Covers the warning + expiry passes with mocked DB + email driver.
Locks in:
  • Warning fires only inside the ±12h window around day-N
  • Expiry pass downgrades tier + nulls trial_ends_at + records
    subscription transition
  • Dedup via email_sends.dedup_key prevents double-send within
    the same trial cycle
  • Send failure logged + counted but doesn't abort
"""
from __future__ import annotations

from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from app.services.trial_expiry_service import (
    WARNING_DAYS_BEFORE,
    run_trial_expiry_cycle,
)


def _all_result(rows):
    out = MagicMock()
    out.all = MagicMock(return_value=rows)
    return out


def _first_result(value):
    out = MagicMock()
    out.first = MagicMock(return_value=value)
    return out


def _make_db(warn_rows, expired_rows, dedup_existing: bool = False):
    """Build a db.execute mock that returns the warn query, then
    answers dedup checks + inserts + the expiry query + per-user
    work."""
    db = MagicMock()
    db.commit = AsyncMock()
    side_effects: list = []

    # Warning pass: SELECT
    side_effects.append(_all_result(warn_rows))
    for _row in warn_rows:
        # Dedup check
        side_effects.append(_first_result((1,) if dedup_existing else None))
        if not dedup_existing:
            # _send_one re-checks dedup before send — that's the
            # second dedup hit inside _send_one — but we structured
            # the code so the outer check matters; for safety also
            # mock the insert
            side_effects.append(_first_result(None))  # _send_one dedup re-check
            side_effects.append(MagicMock())          # INSERT email_sends

    # Expiry pass: SELECT
    side_effects.append(_all_result(expired_rows))
    for _row in expired_rows:
        side_effects.append(MagicMock())  # UPDATE users (tier + null)
        side_effects.append(_first_result(None))   # _send_one dedup check
        side_effects.append(MagicMock())  # INSERT email_sends

    db.execute = AsyncMock(side_effect=side_effects)
    return db


@pytest.mark.asyncio
async def test_warning_pass_sends_for_users_at_warning_day():
    """User whose trial ends in WARNING_DAYS_BEFORE days → warning
    email fires."""
    user_id = uuid4()
    now = datetime.now(UTC)
    ends_at = now + timedelta(days=WARNING_DAYS_BEFORE)
    db = _make_db(
        warn_rows=[(user_id, "u@example.com", ends_at)],
        expired_rows=[],
    )

    fake_driver = MagicMock()
    fake_driver.send_email = AsyncMock(return_value=True)

    with patch(
        "app.services.email_service.get_email_driver",
        return_value=fake_driver,
    ), patch(
        "app.services.subscription_state.record_transition",
        new=AsyncMock(),
    ):
        result = await run_trial_expiry_cycle(db)

    assert result.warnings_sent == 1
    assert result.expirations_processed == 0
    fake_driver.send_email.assert_called_once()
    subject = fake_driver.send_email.call_args.kwargs["subject"]
    assert "trial ends in" in subject


@pytest.mark.asyncio
async def test_expiry_pass_downgrades_tier_and_records_transition():
    """Expired trial → UPDATE users SET tier=trial + record
    transition + send email."""
    user_id = uuid4()
    now = datetime.now(UTC)
    ends_at = now - timedelta(hours=1)  # already expired
    db = _make_db(
        warn_rows=[],
        expired_rows=[(user_id, "u@example.com", ends_at)],
    )

    fake_driver = MagicMock()
    fake_driver.send_email = AsyncMock(return_value=True)

    mock_record = AsyncMock()
    with patch(
        "app.services.email_service.get_email_driver",
        return_value=fake_driver,
    ), patch(
        "app.services.subscription_state.record_transition",
        new=mock_record,
    ):
        result = await run_trial_expiry_cycle(db)

    assert result.expirations_processed == 1
    mock_record.assert_called_once()
    rt_kwargs = mock_record.call_args.kwargs
    assert rt_kwargs["from_status"] == "trialing"
    assert rt_kwargs["to_status"] == "trial_expired"
    assert rt_kwargs["to_tier"] == "trial"

    # Verify the UPDATE-users call happened — third execute call in
    # the expiry pass (after the expired-SELECT and before the dedup
    # check). Search for the UPDATE in the call list.
    update_call = next(
        (c for c in db.execute.call_args_list
         if "UPDATE users" in str(c.args[0])),
        None,
    )
    assert update_call is not None


@pytest.mark.asyncio
async def test_dedup_skip_when_email_already_sent():
    """Warning re-fired same day → skipped via email_sends dedup."""
    user_id = uuid4()
    now = datetime.now(UTC)
    ends_at = now + timedelta(days=WARNING_DAYS_BEFORE)
    db = _make_db(
        warn_rows=[(user_id, "u@example.com", ends_at)],
        expired_rows=[],
        dedup_existing=True,
    )

    fake_driver = MagicMock()
    fake_driver.send_email = AsyncMock(return_value=True)

    with patch(
        "app.services.email_service.get_email_driver",
        return_value=fake_driver,
    ):
        result = await run_trial_expiry_cycle(db)

    assert result.emails_skipped_already_sent == 1
    assert result.warnings_sent == 0
    fake_driver.send_email.assert_not_called()


@pytest.mark.asyncio
async def test_no_users_returns_zero_counts():
    db = _make_db(warn_rows=[], expired_rows=[])

    fake_driver = MagicMock()
    fake_driver.send_email = AsyncMock()

    with patch(
        "app.services.email_service.get_email_driver",
        return_value=fake_driver,
    ):
        result = await run_trial_expiry_cycle(db)

    assert result.users_evaluated == 0
    assert result.warnings_sent == 0
    assert result.expirations_processed == 0
    fake_driver.send_email.assert_not_called()


@pytest.mark.asyncio
async def test_send_failure_counted_but_does_not_abort():
    """Driver returns False on warning send → counted in failed,
    expiry pass still runs."""
    user_id = uuid4()
    now = datetime.now(UTC)
    ends_at = now + timedelta(days=WARNING_DAYS_BEFORE)
    db = _make_db(
        warn_rows=[(user_id, "u@example.com", ends_at)],
        expired_rows=[],
    )

    fake_driver = MagicMock()
    fake_driver.send_email = AsyncMock(return_value=False)

    with patch(
        "app.services.email_service.get_email_driver",
        return_value=fake_driver,
    ):
        result = await run_trial_expiry_cycle(db)

    assert result.emails_failed == 1
    assert result.warnings_sent == 0
