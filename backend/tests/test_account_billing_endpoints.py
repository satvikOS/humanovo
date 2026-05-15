"""Unit tests for /account/cancel-subscription + /account/invoices.

Stripe SDK + DB mocked. Locks in:
  • Invalid reason_category → 400
  • Active subscription required → 409 when missing
  • Reason recorded BEFORE Stripe call (so analytics survives
    Stripe outages)
  • Stripe error → 200 with logged_only status (user-facing UX
    stays clean; ops follow up)
  • /invoices returns [] for users without stripe_customer_id
"""
from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints.account_billing import (
    CancelSubscriptionRequest,
    PortalSessionRequest,
    cancel_subscription,
    create_portal_session,
    list_invoices,
)


def _user(*, has_sub: bool = True, has_customer: bool = True):
    return SimpleNamespace(
        id=uuid4(),
        email="u@example.com",
        stripe_customer_id="cus_test" if has_customer else None,
        stripe_subscription_id="sub_test" if has_sub else None,
    )


def _db():
    db = MagicMock()
    db.execute = AsyncMock()
    db.commit = AsyncMock()
    return db


@pytest.mark.asyncio
async def test_cancel_rejects_invalid_reason_category():
    user = _user()
    db = _db()
    with pytest.raises(HTTPException) as exc:
        await cancel_subscription(
            body=CancelSubscriptionRequest(reason_category="invalid"),
            db=db,
            current_user=user,
        )
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_cancel_409_when_no_active_subscription():
    user = _user(has_sub=False)
    db = _db()
    with pytest.raises(HTTPException) as exc:
        await cancel_subscription(
            body=CancelSubscriptionRequest(reason_category="price"),
            db=db,
            current_user=user,
        )
    assert exc.value.status_code == 409


@pytest.mark.asyncio
async def test_cancel_records_reason_before_stripe_call():
    """The INSERT must complete + commit BEFORE the stripe call,
    so a Stripe outage doesn't lose the analytics signal."""
    user = _user()
    db = _db()
    fake_stripe = MagicMock()
    fake_stripe.Subscription.modify = MagicMock(
        return_value=SimpleNamespace(current_period_end=1700000000),
    )
    with patch.dict("sys.modules", {"stripe": fake_stripe}), \
         patch("app.api.v1.endpoints.account_billing.settings") as mock_settings:
        mock_settings.STRIPE_SECRET_KEY = "sk_test"

        out = await cancel_subscription(
            body=CancelSubscriptionRequest(
                reason_category="price",
                reason_text="too expensive for solo researcher",
            ),
            db=db,
            current_user=user,
        )

    assert out["reason_recorded"] is True
    assert out["stripe"]["status"] == "scheduled"
    # INSERT happened
    db.execute.assert_called_once()
    # The INSERT's bind params should carry the reason fields.
    bound = db.execute.call_args.args[1]
    assert bound["cat"] == "price"
    assert bound["txt"] == "too expensive for solo researcher"
    # Stripe modify also called.
    fake_stripe.Subscription.modify.assert_called_once_with(
        "sub_test", cancel_at_period_end=True,
    )


@pytest.mark.asyncio
async def test_cancel_returns_logged_only_when_stripe_errors():
    """Stripe outage during cancel → reason still recorded, response
    surface stripe.status=logged_only so the user UX stays clean."""
    user = _user()
    db = _db()
    fake_stripe = MagicMock()
    fake_stripe.Subscription.modify = MagicMock(
        side_effect=RuntimeError("stripe down"),
    )
    with patch.dict("sys.modules", {"stripe": fake_stripe}), \
         patch("app.api.v1.endpoints.account_billing.settings") as mock_settings:
        mock_settings.STRIPE_SECRET_KEY = "sk_test"

        out = await cancel_subscription(
            body=CancelSubscriptionRequest(reason_category="features"),
            db=db,
            current_user=user,
        )

    assert out["reason_recorded"] is True
    assert out["stripe"]["status"] == "logged_only"
    # Reason still recorded.
    db.execute.assert_called_once()


@pytest.mark.asyncio
async def test_invoices_returns_empty_for_user_without_customer():
    user = _user(has_customer=False, has_sub=False)
    out = await list_invoices(limit=20, current_user=user)
    assert out["invoices"] == []
    assert out["count"] == 0


@pytest.mark.asyncio
async def test_invoices_returns_stripe_data_mapped_to_schema():
    user = _user()
    fake_invoices = SimpleNamespace(data=[
        SimpleNamespace(
            id="in_1", amount_paid=4900, amount_due=0,
            currency="usd", status="paid",
            period_start=1700000000, period_end=1702592000,
            created=1700000000,
            hosted_invoice_url="https://pay.stripe.com/invoice/x",
            invoice_pdf="https://pay.stripe.com/invoice/x/pdf",
            subscription="sub_test",
        ),
    ])
    fake_stripe = MagicMock()
    fake_stripe.Invoice.list = MagicMock(return_value=fake_invoices)

    with patch.dict("sys.modules", {"stripe": fake_stripe}), \
         patch("app.api.v1.endpoints.account_billing.settings") as mock_settings:
        mock_settings.STRIPE_SECRET_KEY = "sk_test"
        out = await list_invoices(limit=10, current_user=user)

    assert out["count"] == 1
    assert out["invoices"][0]["id"] == "in_1"
    assert out["invoices"][0]["amount_paid_cents"] == 4900
    assert out["invoices"][0]["status"] == "paid"


@pytest.mark.asyncio
async def test_invoices_503_when_stripe_unconfigured():
    user = _user()
    fake_stripe = MagicMock()
    with patch.dict("sys.modules", {"stripe": fake_stripe}), \
         patch("app.api.v1.endpoints.account_billing.settings") as mock_settings:
        mock_settings.STRIPE_SECRET_KEY = None

        with pytest.raises(HTTPException) as exc:
            await list_invoices(limit=10, current_user=user)
        assert exc.value.status_code == 503


@pytest.mark.asyncio
async def test_invoices_502_on_stripe_error():
    user = _user()
    fake_stripe = MagicMock()
    fake_stripe.Invoice.list = MagicMock(side_effect=RuntimeError("stripe down"))

    with patch.dict("sys.modules", {"stripe": fake_stripe}), \
         patch("app.api.v1.endpoints.account_billing.settings") as mock_settings:
        mock_settings.STRIPE_SECRET_KEY = "sk_test"

        with pytest.raises(HTTPException) as exc:
            await list_invoices(limit=10, current_user=user)
        assert exc.value.status_code == 502


# --- Portal session ---

@pytest.mark.asyncio
async def test_portal_session_409_without_stripe_customer():
    """Free / trial-only users have no customer record; nothing to
    manage in the Portal, so we 409 with a hint to start a sub
    instead of opaque 500-style failure."""
    user = _user(has_customer=False, has_sub=False)
    with pytest.raises(HTTPException) as exc:
        await create_portal_session(body=None, current_user=user)
    assert exc.value.status_code == 409


@pytest.mark.asyncio
async def test_portal_session_400_on_non_http_return_url():
    """Don't let the frontend smuggle javascript: or app:// URLs
    into Stripe's redirect."""
    user = _user()
    with pytest.raises(HTTPException) as exc:
        await create_portal_session(
            body=PortalSessionRequest(return_url="javascript:alert(1)"),
            current_user=user,
        )
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_portal_session_503_when_stripe_unconfigured():
    user = _user()
    fake_stripe = MagicMock()
    with patch.dict("sys.modules", {"stripe": fake_stripe}), \
         patch("app.api.v1.endpoints.account_billing.settings") as mock_settings:
        mock_settings.STRIPE_SECRET_KEY = None
        mock_settings.FRONTEND_BASE_URL = "https://app.humanovo.net"
        with pytest.raises(HTTPException) as exc:
            await create_portal_session(body=None, current_user=user)
        assert exc.value.status_code == 503


@pytest.mark.asyncio
async def test_portal_session_returns_url_from_stripe_response():
    user = _user()
    fake_stripe = MagicMock()
    fake_stripe.billing_portal.Session.create = MagicMock(
        return_value=SimpleNamespace(
            url="https://billing.stripe.com/p/session/abc",
            expires_at=1700000000,
        ),
    )
    with patch.dict("sys.modules", {"stripe": fake_stripe}), \
         patch("app.api.v1.endpoints.account_billing.settings") as mock_settings:
        mock_settings.STRIPE_SECRET_KEY = "sk_test"
        mock_settings.FRONTEND_BASE_URL = "https://app.humanovo.net"
        out = await create_portal_session(body=None, current_user=user)

    assert out["url"] == "https://billing.stripe.com/p/session/abc"
    assert out["return_url"] == "https://app.humanovo.net/account/billing"
    # The Stripe call must receive customer + return_url.
    call_kwargs = fake_stripe.billing_portal.Session.create.call_args.kwargs
    assert call_kwargs["customer"] == "cus_test"
    assert call_kwargs["return_url"] == "https://app.humanovo.net/account/billing"


@pytest.mark.asyncio
async def test_portal_session_502_on_stripe_error():
    user = _user()
    fake_stripe = MagicMock()
    fake_stripe.billing_portal.Session.create = MagicMock(
        side_effect=RuntimeError("stripe down"),
    )
    with patch.dict("sys.modules", {"stripe": fake_stripe}), \
         patch("app.api.v1.endpoints.account_billing.settings") as mock_settings:
        mock_settings.STRIPE_SECRET_KEY = "sk_test"
        mock_settings.FRONTEND_BASE_URL = "https://app.humanovo.net"
        with pytest.raises(HTTPException) as exc:
            await create_portal_session(body=None, current_user=user)
        assert exc.value.status_code == 502
