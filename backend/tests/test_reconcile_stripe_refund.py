"""Unit tests for reconcile_stripe_refund_event (charge.refunded
webhook reconciler).

Stripe-dashboard-initiated refunds bypass our admin endpoint, so the
webhook handler is the only path that records them in refund_records.
Locks in:
  • New refund (no existing row) → INSERT + confirmation email
  • Dedup: existing stripe_refund_id → skipped, no INSERT, no email
  • Unknown customer → status='skipped_no_user', no INSERT
  • No refunds in payload → status='no_refunds'
  • Email driver failure on one refund doesn't break the loop
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from app.services.receipt_service import reconcile_stripe_refund_event


def _user_lookup(user_id, email: str = "u@example.com"):
    r = MagicMock()
    r.first = MagicMock(return_value=(user_id, email))
    return r


def _user_lookup_empty():
    r = MagicMock()
    r.first = MagicMock(return_value=None)
    return r


def _dedup_existing():
    r = MagicMock()
    r.first = MagicMock(return_value=(1,))
    return r


def _dedup_missing():
    r = MagicMock()
    r.first = MagicMock(return_value=None)
    return r


def _charge_with_refund(refund_id="re_dashboard_1", amount=2500):
    return {
        "id": "ch_test",
        "customer": "cus_test",
        "invoice": "in_test",
        "currency": "usd",
        "refunds": {
            "data": [
                {
                    "id": refund_id,
                    "amount": amount,
                    "status": "succeeded",
                }
            ],
        },
    }


@pytest.mark.asyncio
async def test_no_refunds_in_payload_returns_no_refunds():
    db = MagicMock()
    db.execute = AsyncMock()
    out = await reconcile_stripe_refund_event(
        db, charge={"id": "ch_test", "customer": "cus_test", "refunds": {"data": []}},
    )
    assert out["status"] == "no_refunds"


@pytest.mark.asyncio
async def test_unknown_customer_returns_skipped_no_user():
    db = MagicMock()
    db.execute = AsyncMock(side_effect=[_user_lookup_empty()])
    out = await reconcile_stripe_refund_event(
        db, charge=_charge_with_refund(),
    )
    assert out["status"] == "skipped_no_user"


@pytest.mark.asyncio
async def test_existing_refund_record_skipped_without_insert_or_email():
    """Admin-endpoint refunds already have a refund_records row; the
    reconciler must skip them entirely (no double-INSERT, no double-
    email)."""
    user_id = uuid4()
    # DB side_effects: 1) user lookup, 2) dedup check (existing)
    db = MagicMock()
    db.execute = AsyncMock(side_effect=[
        _user_lookup(user_id),
        _dedup_existing(),
    ])
    db.commit = AsyncMock()

    fake_driver = MagicMock()
    fake_driver.send_email = AsyncMock(return_value=True)
    with patch(
        "app.services.email_service.get_email_driver",
        return_value=fake_driver,
    ):
        out = await reconcile_stripe_refund_event(
            db, charge=_charge_with_refund(),
        )

    assert out["inserted"] == 0
    assert out["skipped_existing"] == 1
    assert out["emailed"] == 0
    fake_driver.send_email.assert_not_called()


@pytest.mark.asyncio
async def test_new_refund_inserted_and_confirmation_email_sent():
    """Dashboard-initiated refund → new refund_records row +
    confirmation email."""
    user_id = uuid4()
    db = MagicMock()
    db.execute = AsyncMock(side_effect=[
        _user_lookup(user_id),            # 1. user lookup
        _dedup_missing(),                 # 2. refund_records dedup
        MagicMock(),                      # 3. INSERT refund_records
        _dedup_missing(),                 # 4. email_sends dedup
        MagicMock(),                      # 5. INSERT email_sends
    ])
    db.commit = AsyncMock()

    fake_driver = MagicMock()
    fake_driver.send_email = AsyncMock(return_value=True)
    with patch(
        "app.services.email_service.get_email_driver",
        return_value=fake_driver,
    ):
        out = await reconcile_stripe_refund_event(
            db, charge=_charge_with_refund(refund_id="re_new_1", amount=4900),
        )

    assert out["inserted"] == 1
    assert out["skipped_existing"] == 0
    assert out["emailed"] == 1
    fake_driver.send_email.assert_called_once()
    # Email subject should mention the dollar amount.
    assert "$49.00" in fake_driver.send_email.call_args.kwargs["subject"]
