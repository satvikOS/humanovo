"""Unit tests for the welcome email service.

Locks in:
  • Renderer puts the first-name into both subject-area and body.
  • Renderer falls back to "researcher" when full_name is None / empty.
  • send_welcome_email is idempotent — second call with same user_id
    short-circuits via email_sends.dedup_key and does NOT re-invoke
    the driver.
  • Driver exception is swallowed, status="send_failed", row recorded
    with ok=False.
  • Successful path commits and returns status="sent".
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from app.services.welcome_email_service import (
    TEMPLATE_KEY,
    _render,
    send_welcome_email,
)


def _db_with_dedup(*, already_sent: bool):
    db = MagicMock()
    dedup_result = MagicMock()
    dedup_result.first = MagicMock(
        return_value=(1,) if already_sent else None,
    )
    insert_result = MagicMock()
    db.execute = AsyncMock(side_effect=[dedup_result, insert_result])
    db.commit = AsyncMock()
    return db


def test_render_uses_first_name_when_full_name_provided():
    subject, text_body, html_body = _render(full_name="Ada Lovelace")
    assert "Welcome to humanovo" in subject
    assert "Ada" in text_body
    assert "Ada" in html_body
    # Last name should NOT leak into the message (we want first-name
    # familiarity, not full-name formality).
    assert "Lovelace" not in text_body


def test_render_falls_back_to_researcher_when_full_name_missing():
    for missing in (None, "", "   "):
        _subject, text_body, _html_body = _render(full_name=missing)
        assert "researcher" in text_body.lower()


def test_render_embeds_trial_days():
    _subject, text_body, html_body = _render(full_name="A", trial_days=14)
    assert "14-day" in text_body
    assert "14-day" in html_body


@pytest.mark.asyncio
async def test_send_welcome_email_skips_when_dedup_row_exists():
    user_id = uuid4()
    db = _db_with_dedup(already_sent=True)
    fake_driver = MagicMock()
    fake_driver.send_email = AsyncMock(return_value=True)
    with patch(
        "app.services.email_service.get_email_driver",
        return_value=fake_driver,
    ):
        out = await send_welcome_email(
            db,
            user_id=user_id, user_email="a@example.com",
            full_name="Ada",
        )

    assert out["status"] == "skipped_duplicate"
    fake_driver.send_email.assert_not_called()
    # No commit on dedup short-circuit — only the dedup lookup ran.
    db.commit.assert_not_called()


@pytest.mark.asyncio
async def test_send_welcome_email_success_records_send_and_commits():
    user_id = uuid4()
    db = _db_with_dedup(already_sent=False)
    fake_driver = MagicMock()
    fake_driver.send_email = AsyncMock(return_value=True)
    with patch(
        "app.services.email_service.get_email_driver",
        return_value=fake_driver,
    ):
        out = await send_welcome_email(
            db,
            user_id=user_id, user_email="a@example.com",
            full_name="Ada",
        )

    assert out["status"] == "sent"
    fake_driver.send_email.assert_called_once()
    call_kwargs = fake_driver.send_email.call_args.kwargs
    assert call_kwargs["to"] == "a@example.com"
    assert "humanovo" in call_kwargs["subject"].lower()
    # _record_send INSERTed; commit fired.
    assert db.execute.await_count == 2
    db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_send_welcome_email_swallows_driver_exception():
    """A driver-raise must NOT propagate — the signup that scheduled
    us already succeeded, and we don't want to roll back the user
    just because SMTP hiccupped."""
    user_id = uuid4()
    db = _db_with_dedup(already_sent=False)
    fake_driver = MagicMock()
    fake_driver.send_email = AsyncMock(side_effect=RuntimeError("smtp down"))
    with patch(
        "app.services.email_service.get_email_driver",
        return_value=fake_driver,
    ):
        out = await send_welcome_email(
            db,
            user_id=user_id, user_email="a@example.com",
            full_name="Ada",
        )

    assert out["status"] == "send_failed"
    # Dedup row STILL recorded (ok=False) so we don't retry forever.
    insert_params = db.execute.call_args_list[1].args[1]
    assert insert_params["ok"] is False
    assert insert_params["tpl"] == TEMPLATE_KEY
