"""Unit tests for receipt + payment-failed email dispatch.

Mocked DB + email driver. Locks in:
  • send_receipt builds correct text/HTML + dedups per invoice.id
  • send_payment_failed surfaces the update-billing CTA
  • Missing customer / unknown user → status=skipped, no email
  • Already-sent dedup short-circuits to status=sent (treated as
    success — the retry would be a duplicate)
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from app.services.receipt_service import (
    _format_amount,
    send_payment_failed,
    send_receipt,
)


def _db_with_user_resolution(user_row, dedup_existing: bool = False):
    """Build a DB mock that:
      - resolves the user lookup (first call)
      - then a dedup check (second call) — returns (1,) if
        dedup_existing else None
      - then either short-circuits (no INSERT) or runs the INSERT
        when not duplicated"""
    db = MagicMock()

    user_result = MagicMock()
    user_result.first = MagicMock(return_value=user_row)

    dedup_result = MagicMock()
    dedup_result.first = MagicMock(
        return_value=(1,) if dedup_existing else None,
    )

    side_effects = [user_result, dedup_result, MagicMock()]
    db.execute = AsyncMock(side_effect=side_effects)
    return db


def test_format_amount_renders_dollars_with_currency():
    assert _format_amount(12345, "usd") == "$123.45 USD"
    assert _format_amount(99, "eur") == "$0.99 EUR"


@pytest.mark.asyncio
async def test_send_receipt_sends_email_with_amount_and_invoice_link():
    user_id = uuid4()
    db = _db_with_user_resolution((user_id, "u@example.com"))

    fake_driver = MagicMock()
    fake_driver.send_email = AsyncMock(return_value=True)
    with patch(
        "app.services.email_service.get_email_driver",
        return_value=fake_driver,
    ):
        out = await send_receipt(
            db,
            invoice={
                "customer": "cus_test",
                "id": "in_test_123",
                "amount_paid": 4900,
                "currency": "usd",
                "hosted_invoice_url": "https://pay.stripe.com/invoice/x",
                "period_start": 1700000000,
                "period_end": 1702592000,
            },
        )

    assert out["status"] == "sent"
    fake_driver.send_email.assert_called_once()
    call_kwargs = fake_driver.send_email.call_args.kwargs
    assert call_kwargs["to"] == "u@example.com"
    assert "$49.00" in call_kwargs["subject"]
    assert "in_test_123" in call_kwargs["text"]
    assert "pay.stripe.com" in call_kwargs["text"]


@pytest.mark.asyncio
async def test_send_receipt_skips_when_customer_missing():
    db = MagicMock()
    db.execute = AsyncMock()
    out = await send_receipt(db, invoice={"id": "in_test"})
    assert out["status"] == "skipped"
    db.execute.assert_not_called()


@pytest.mark.asyncio
async def test_send_receipt_skips_when_user_unknown_for_customer():
    """customer_id resolves to no user → skipped with reason."""
    db = MagicMock()
    user_result = MagicMock()
    user_result.first = MagicMock(return_value=None)
    db.execute = AsyncMock(return_value=user_result)

    out = await send_receipt(
        db,
        invoice={"customer": "cus_unknown", "id": "in_x", "amount_paid": 100},
    )
    assert out["status"] == "skipped"
    assert "no user" in out["reason"]


@pytest.mark.asyncio
async def test_send_receipt_dedup_returns_sent_without_emailing():
    """Already-sent dedup short-circuits → returns status=sent but
    the email driver is NOT invoked (treat replay as success)."""
    user_id = uuid4()
    db = _db_with_user_resolution(
        (user_id, "u@example.com"), dedup_existing=True,
    )
    fake_driver = MagicMock()
    fake_driver.send_email = AsyncMock(return_value=True)
    with patch(
        "app.services.email_service.get_email_driver",
        return_value=fake_driver,
    ):
        out = await send_receipt(
            db, invoice={"customer": "cus_x", "id": "in_dup", "amount_paid": 100},
        )
    assert out["status"] == "sent"
    fake_driver.send_email.assert_not_called()


@pytest.mark.asyncio
async def test_send_payment_failed_includes_update_billing_url():
    user_id = uuid4()
    db = _db_with_user_resolution((user_id, "u@example.com"))
    fake_driver = MagicMock()
    fake_driver.send_email = AsyncMock(return_value=True)
    with patch(
        "app.services.email_service.get_email_driver",
        return_value=fake_driver,
    ):
        out = await send_payment_failed(
            db,
            invoice={
                "customer": "cus_test",
                "id": "in_fail_123",
                "amount_due": 2500,
                "currency": "usd",
                "hosted_invoice_url": "https://pay.stripe.com/invoice/y",
            },
        )

    assert out["status"] == "sent"
    text_body = fake_driver.send_email.call_args.kwargs["text"]
    assert "$25.00" in text_body
    assert "app.humanovo.net/account/billing" in text_body


@pytest.mark.asyncio
async def test_send_payment_failed_send_error_returns_send_failed():
    user_id = uuid4()
    db = _db_with_user_resolution((user_id, "u@example.com"))
    fake_driver = MagicMock()
    fake_driver.send_email = AsyncMock(return_value=False)
    with patch(
        "app.services.email_service.get_email_driver",
        return_value=fake_driver,
    ):
        out = await send_payment_failed(
            db,
            invoice={"customer": "cus_test", "id": "in_e", "amount_due": 100},
        )
    assert out["status"] == "send_failed"
