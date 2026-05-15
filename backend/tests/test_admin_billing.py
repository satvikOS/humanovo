"""Unit tests for /admin/billing/refund/{invoice_id} + /admin/billing/refunds.

Stripe SDK + DB mocked. Locks in:
  • Invalid reason → 400
  • reason='other' without reason_text → 400
  • Stripe not configured → 503
  • Stripe-side refund rejection → 200 with status='failed', row still
    recorded in refund_records (the failure paper trail)
  • Successful refund inserts a row with status='succeeded' + Stripe id
  • amount > invoice.amount_paid → 400 (no partial-refund overage)
  • Missing customer linkage → 404 (data drift guard)
  • status_filter validation on the list endpoint → 400 on invalid
"""
from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints.admin_billing import (
    RefundRequest,
    VALID_REFUND_REASONS,
    issue_refund,
    list_refunds,
)


def _admin():
    return SimpleNamespace(id=uuid4(), email="admin@humanovo.net")


def _db_with_user_row(user_id, email: str = "u@example.com"):
    """Build a DB mock whose first execute() (the user lookup) returns
    a single row [(user_id, email)], and subsequent calls are no-op
    AsyncMocks. .commit is stubbed.

    side_effect has extra slack so the refund-confirmation-email
    path (dedup check + INSERT into email_sends after the refund row)
    has rows to consume without raising StopIteration."""
    db = MagicMock()
    user_lookup = MagicMock()
    user_lookup.first = MagicMock(return_value=(user_id, email))
    dedup_lookup = MagicMock()
    dedup_lookup.first = MagicMock(return_value=None)
    db.execute = AsyncMock(side_effect=[
        user_lookup,                 # 1. user lookup in admin_billing
        MagicMock(),                 # 2. INSERT refund_records
        dedup_lookup,                # 3. email_sends dedup check
        MagicMock(),                 # 4. INSERT email_sends row
    ])
    db.commit = AsyncMock()
    return db


def _db_with_no_user():
    db = MagicMock()
    user_lookup = MagicMock()
    user_lookup.first = MagicMock(return_value=None)
    db.execute = AsyncMock(return_value=user_lookup)
    db.commit = AsyncMock()
    return db


def _fake_invoice(amount_paid: int = 4900, charge: str | None = "ch_test"):
    return SimpleNamespace(
        id="in_test",
        customer="cus_test",
        charge=charge,
        amount_paid=amount_paid,
        currency="usd",
    )


def test_valid_reasons_match_constant():
    """Guard against the constant drifting out of sync with the
    pricing UI / admin dashboard's expected enum."""
    assert VALID_REFUND_REASONS == {
        "duplicate",
        "fraudulent",
        "requested_by_customer",
        "other",
    }


@pytest.mark.asyncio
async def test_refund_rejects_invalid_reason():
    actor = _admin()
    db = MagicMock()
    db.execute = AsyncMock()
    db.commit = AsyncMock()
    with pytest.raises(HTTPException) as exc:
        await issue_refund(
            invoice_id="in_test",
            body=RefundRequest(reason="nonsense"),
            db=db,
            actor=actor,
        )
    assert exc.value.status_code == 400
    # No DB writes — bail before any state mutation.
    db.execute.assert_not_called()


@pytest.mark.asyncio
async def test_refund_other_requires_reason_text():
    actor = _admin()
    db = MagicMock()
    db.execute = AsyncMock()
    db.commit = AsyncMock()
    with pytest.raises(HTTPException) as exc:
        await issue_refund(
            invoice_id="in_test",
            body=RefundRequest(reason="other", reason_text=""),
            db=db,
            actor=actor,
        )
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_refund_503_when_stripe_unconfigured():
    actor = _admin()
    db = MagicMock()
    db.execute = AsyncMock()
    db.commit = AsyncMock()
    with patch("app.api.v1.endpoints.admin_billing.settings") as mock_settings:
        mock_settings.STRIPE_SECRET_KEY = None
        with pytest.raises(HTTPException) as exc:
            await issue_refund(
                invoice_id="in_test",
                body=RefundRequest(reason="duplicate"),
                db=db,
                actor=actor,
            )
    assert exc.value.status_code == 503


@pytest.mark.asyncio
async def test_refund_404_when_no_user_for_customer():
    """Defensive: invoice exists but no DB user maps to its customer
    id (data drift / manual Stripe-side row). Don't issue the refund."""
    actor = _admin()
    db = _db_with_no_user()
    fake_stripe = MagicMock()
    fake_stripe.Invoice.retrieve = MagicMock(return_value=_fake_invoice())
    with patch.dict("sys.modules", {"stripe": fake_stripe}), \
         patch("app.api.v1.endpoints.admin_billing.settings") as mock_settings:
        mock_settings.STRIPE_SECRET_KEY = "sk_test"
        with pytest.raises(HTTPException) as exc:
            await issue_refund(
                invoice_id="in_test",
                body=RefundRequest(reason="duplicate"),
                db=db,
                actor=actor,
            )
    assert exc.value.status_code == 404
    fake_stripe.Refund.create.assert_not_called()


@pytest.mark.asyncio
async def test_refund_409_when_invoice_has_no_charge():
    actor = _admin()
    db = MagicMock()
    db.execute = AsyncMock()
    db.commit = AsyncMock()
    fake_stripe = MagicMock()
    fake_stripe.Invoice.retrieve = MagicMock(
        return_value=_fake_invoice(charge=None),
    )
    with patch.dict("sys.modules", {"stripe": fake_stripe}), \
         patch("app.api.v1.endpoints.admin_billing.settings") as mock_settings:
        mock_settings.STRIPE_SECRET_KEY = "sk_test"
        with pytest.raises(HTTPException) as exc:
            await issue_refund(
                invoice_id="in_test",
                body=RefundRequest(reason="duplicate"),
                db=db,
                actor=actor,
            )
    assert exc.value.status_code == 409


@pytest.mark.asyncio
async def test_refund_rejects_amount_above_invoice_paid():
    actor = _admin()
    user_id = uuid4()
    db = _db_with_user_row(user_id)
    fake_stripe = MagicMock()
    fake_stripe.Invoice.retrieve = MagicMock(
        return_value=_fake_invoice(amount_paid=4900),
    )
    with patch.dict("sys.modules", {"stripe": fake_stripe}), \
         patch("app.api.v1.endpoints.admin_billing.settings") as mock_settings:
        mock_settings.STRIPE_SECRET_KEY = "sk_test"
        with pytest.raises(HTTPException) as exc:
            await issue_refund(
                invoice_id="in_test",
                body=RefundRequest(reason="duplicate", amount_cents=5000),
                db=db,
                actor=actor,
            )
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_refund_success_records_row_with_status_succeeded():
    actor = _admin()
    user_id = uuid4()
    db = _db_with_user_row(user_id)
    fake_stripe = MagicMock()
    fake_stripe.Invoice.retrieve = MagicMock(return_value=_fake_invoice())
    fake_stripe.Refund.create = MagicMock(return_value=SimpleNamespace(
        id="re_test_abc", status="succeeded",
    ))
    with patch.dict("sys.modules", {"stripe": fake_stripe}), \
         patch("app.api.v1.endpoints.admin_billing.settings") as mock_settings:
        mock_settings.STRIPE_SECRET_KEY = "sk_test"
        out = await issue_refund(
            invoice_id="in_test",
            body=RefundRequest(reason="duplicate"),
            db=db,
            actor=actor,
        )

    assert out["status"] == "succeeded"
    assert out["refund_id"] == "re_test_abc"
    assert out["amount_cents"] == 4900  # full invoice amount
    assert out["error_message"] is None
    # Stripe Refund.create called with charge + amount + reason.
    fake_stripe.Refund.create.assert_called_once()
    create_kwargs = fake_stripe.Refund.create.call_args.kwargs
    assert create_kwargs["charge"] == "ch_test"
    assert create_kwargs["amount"] == 4900
    assert create_kwargs["reason"] == "duplicate"
    # The refund_records INSERT ran (db.execute called twice: user
    # lookup then insert).
    assert db.execute.await_count >= 2
    db.commit.assert_awaited()


@pytest.mark.asyncio
async def test_refund_stripe_failure_records_row_as_failed():
    """Stripe-side rejection → 200 with status='failed' AND the failure
    captured in refund_records for ops to investigate. We must NOT
    raise — admin needs the structured response."""
    actor = _admin()
    user_id = uuid4()
    db = _db_with_user_row(user_id)
    fake_stripe = MagicMock()
    fake_stripe.Invoice.retrieve = MagicMock(return_value=_fake_invoice())
    fake_stripe.Refund.create = MagicMock(
        side_effect=RuntimeError("charge_already_refunded"),
    )
    with patch.dict("sys.modules", {"stripe": fake_stripe}), \
         patch("app.api.v1.endpoints.admin_billing.settings") as mock_settings:
        mock_settings.STRIPE_SECRET_KEY = "sk_test"
        out = await issue_refund(
            invoice_id="in_test",
            body=RefundRequest(reason="duplicate"),
            db=db,
            actor=actor,
        )

    assert out["status"] == "failed"
    assert out["refund_id"] is None
    assert out["error_message"] is not None
    assert "charge_already_refunded" in out["error_message"]
    # Still committed the failure row.
    db.commit.assert_awaited()


@pytest.mark.asyncio
async def test_refund_maps_other_reason_to_stripe_requested_by_customer():
    """Stripe's Refund.reason enum doesn't include 'other'; we map it
    to 'requested_by_customer' on the Stripe call while preserving
    'other' (plus the reason_text) in our DB row."""
    actor = _admin()
    user_id = uuid4()
    db = _db_with_user_row(user_id)
    fake_stripe = MagicMock()
    fake_stripe.Invoice.retrieve = MagicMock(return_value=_fake_invoice())
    fake_stripe.Refund.create = MagicMock(return_value=SimpleNamespace(
        id="re_test_other", status="succeeded",
    ))
    with patch.dict("sys.modules", {"stripe": fake_stripe}), \
         patch("app.api.v1.endpoints.admin_billing.settings") as mock_settings:
        mock_settings.STRIPE_SECRET_KEY = "sk_test"
        await issue_refund(
            invoice_id="in_test",
            body=RefundRequest(
                reason="other",
                reason_text="goodwill credit for downtime",
            ),
            db=db,
            actor=actor,
        )

    create_kwargs = fake_stripe.Refund.create.call_args.kwargs
    assert create_kwargs["reason"] == "requested_by_customer"
    # Our DB row keeps the original reason category.
    insert_params = db.execute.call_args_list[1].args[1]
    assert insert_params["rsn"] == "other"
    assert insert_params["rsn_txt"] == "goodwill credit for downtime"


@pytest.mark.asyncio
async def test_refund_success_sends_confirmation_email_via_driver():
    """A successful Stripe refund must fire the refund-confirmation
    email to the customer (so they see the credit coming before it
    posts to their card statement). On failure, no email."""
    actor = _admin()
    user_id = uuid4()
    db = _db_with_user_row(user_id)
    fake_stripe = MagicMock()
    fake_stripe.Invoice.retrieve = MagicMock(return_value=_fake_invoice())
    fake_stripe.Refund.create = MagicMock(return_value=SimpleNamespace(
        id="re_test_email", status="succeeded",
    ))
    fake_driver = MagicMock()
    fake_driver.send_email = AsyncMock(return_value=True)
    with patch.dict("sys.modules", {"stripe": fake_stripe}), \
         patch("app.api.v1.endpoints.admin_billing.settings") as mock_settings, \
         patch(
             "app.services.email_service.get_email_driver",
             return_value=fake_driver,
         ):
        mock_settings.STRIPE_SECRET_KEY = "sk_test"
        out = await issue_refund(
            invoice_id="in_test",
            body=RefundRequest(reason="duplicate"),
            db=db,
            actor=actor,
        )

    assert out["status"] == "succeeded"
    fake_driver.send_email.assert_called_once()
    sent_kwargs = fake_driver.send_email.call_args.kwargs
    assert sent_kwargs["to"] == "u@example.com"
    # Email body must surface refund id + amount + 5–10 business days
    # so the customer recognises the credit when it appears.
    assert "re_test_email" in sent_kwargs["text"]
    assert "$49.00" in sent_kwargs["text"]
    assert "5–10 business days" in sent_kwargs["text"]


@pytest.mark.asyncio
async def test_refund_failure_does_not_send_email():
    """Stripe refund rejection → no customer email (the 'expect a
    credit' copy would be misleading)."""
    actor = _admin()
    user_id = uuid4()
    db = _db_with_user_row(user_id)
    fake_stripe = MagicMock()
    fake_stripe.Invoice.retrieve = MagicMock(return_value=_fake_invoice())
    fake_stripe.Refund.create = MagicMock(
        side_effect=RuntimeError("charge_already_refunded"),
    )
    fake_driver = MagicMock()
    fake_driver.send_email = AsyncMock(return_value=True)
    with patch.dict("sys.modules", {"stripe": fake_stripe}), \
         patch("app.api.v1.endpoints.admin_billing.settings") as mock_settings, \
         patch(
             "app.services.email_service.get_email_driver",
             return_value=fake_driver,
         ):
        mock_settings.STRIPE_SECRET_KEY = "sk_test"
        out = await issue_refund(
            invoice_id="in_test",
            body=RefundRequest(reason="duplicate"),
            db=db,
            actor=actor,
        )

    assert out["status"] == "failed"
    fake_driver.send_email.assert_not_called()


@pytest.mark.asyncio
async def test_list_refunds_400_on_invalid_status_filter():
    actor = _admin()
    db = MagicMock()
    db.execute = AsyncMock()
    with pytest.raises(HTTPException) as exc:
        await list_refunds(
            limit=50,
            offset=0,
            status_filter="nonsense",
            db=db,
            actor=actor,
        )
    assert exc.value.status_code == 400
