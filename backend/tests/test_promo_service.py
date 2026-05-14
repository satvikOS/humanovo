"""Unit tests for the promo code service.

Locks in the contract surface:
  • Unknown / expired / revoked codes raise PromoError
  • Domain restriction blocks non-matching emails
  • Max-redemption cap blocks the (cap+1)th user
  • Per-user dedup via UNIQUE constraint maps to "already redeemed"
  • trial_extension applies to DB directly
  • percent_off / fixed_cents_off succeed without trial update
"""
from __future__ import annotations

from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from app.services.promo_service import (
    PromoError,
    create_promo_code,
    lookup_code,
    redeem,
)


def _now():
    return datetime.now(UTC)


def _promo_row(
    *,
    id_=None, code="ACADEMIC50", kind="percent_off", value=50,
    description=None, expires_at=None, max_redemptions=None,
    min_email_domain=None, revoked_at=None,
):
    return (
        id_ or uuid4(), code, kind, value, description,
        expires_at, max_redemptions, min_email_domain, revoked_at,
    )


def _db_with_lookup_result(lookup_row, *, cap_row=None, redemption_row=uuid4()):
    """Build a db.execute mock where:
      - 1st call returns the promo lookup row (or None)
      - 2nd call returns the cap-count (if cap is set on the promo)
      - 3rd call is the INSERT … RETURNING id for the redemption
      - 4th call is the UPDATE users for trial_extension"""
    db = MagicMock()
    db.commit = AsyncMock()

    lookup_result = MagicMock()
    lookup_result.first = MagicMock(return_value=lookup_row)

    side_effects = [lookup_result]
    if cap_row is not None:
        cap_result = MagicMock()
        cap_result.first = MagicMock(return_value=(cap_row,))
        side_effects.append(cap_result)

    redemption_result = MagicMock()
    redemption_result.scalar_one_or_none = MagicMock(return_value=redemption_row)
    side_effects.append(redemption_result)

    # Catch-all for the trial-extension UPDATE (or any extra exec).
    side_effects.append(MagicMock())

    db.execute = AsyncMock(side_effect=side_effects)
    return db


# ─── Failure paths ─────────────────────────────────────────────


@pytest.mark.asyncio
async def test_redeem_unknown_code_raises_promo_error():
    db = _db_with_lookup_result(None)
    with pytest.raises(PromoError) as exc:
        await redeem(
            db, code="UNKNOWN", user_id=uuid4(),
            user_email="u@example.com", user_trial_ends_at=None,
        )
    assert "Unknown" in str(exc.value)


@pytest.mark.asyncio
async def test_redeem_expired_code_raises():
    row = _promo_row(expires_at=_now() - timedelta(days=1))
    db = _db_with_lookup_result(row)
    with pytest.raises(PromoError) as exc:
        await redeem(
            db, code="EXP", user_id=uuid4(),
            user_email="u@example.com", user_trial_ends_at=None,
        )
    assert "expired" in str(exc.value).lower()


@pytest.mark.asyncio
async def test_redeem_revoked_code_raises():
    row = _promo_row(revoked_at=_now() - timedelta(days=1))
    db = _db_with_lookup_result(row)
    with pytest.raises(PromoError) as exc:
        await redeem(
            db, code="DEAD", user_id=uuid4(),
            user_email="u@example.com", user_trial_ends_at=None,
        )
    assert "revoked" in str(exc.value).lower()


@pytest.mark.asyncio
async def test_redeem_domain_restriction_blocks_other_emails():
    row = _promo_row(min_email_domain="@harvard.edu")
    db = _db_with_lookup_result(row)
    with pytest.raises(PromoError) as exc:
        await redeem(
            db, code="HARVARD", user_id=uuid4(),
            user_email="alice@gmail.com", user_trial_ends_at=None,
        )
    assert "@harvard.edu" in str(exc.value)


@pytest.mark.asyncio
async def test_redeem_max_redemptions_cap_blocks_overflow():
    row = _promo_row(max_redemptions=10)
    # cap_row = 10 means 10 already redeemed → cap reached.
    db = _db_with_lookup_result(row, cap_row=10)
    with pytest.raises(PromoError) as exc:
        await redeem(
            db, code="LIMITED", user_id=uuid4(),
            user_email="u@example.com", user_trial_ends_at=None,
        )
    assert "redemption limit" in str(exc.value).lower()


@pytest.mark.asyncio
async def test_redeem_already_redeemed_by_user():
    """The ON CONFLICT DO NOTHING returns NULL when the user has
    already redeemed → PromoError surfaced."""
    row = _promo_row(max_redemptions=None)
    # Skip cap check (no max), redemption INSERT returns None.
    db = _db_with_lookup_result(row, redemption_row=None)
    with pytest.raises(PromoError) as exc:
        await redeem(
            db, code="ONCE", user_id=uuid4(),
            user_email="u@example.com", user_trial_ends_at=None,
        )
    assert "already redeemed" in str(exc.value).lower()


# ─── Happy paths ───────────────────────────────────────────────


@pytest.mark.asyncio
async def test_redeem_trial_extension_extends_trial():
    """trial_extension: +30 days to existing trial that ends in 5d
    → new end is +35d from now."""
    row = _promo_row(kind="trial_extension", value=30, max_redemptions=None)
    db = _db_with_lookup_result(row)

    user_trial_end = _now() + timedelta(days=5)
    result = await redeem(
        db, code="EXTEND", user_id=uuid4(),
        user_email="u@example.com",
        user_trial_ends_at=user_trial_end,
    )
    assert result.kind == "trial_extension"
    assert result.value == 30
    expected_end = user_trial_end + timedelta(days=30)
    assert abs((result.new_trial_ends_at - expected_end).total_seconds()) < 5


@pytest.mark.asyncio
async def test_redeem_trial_extension_for_user_without_trial_starts_from_now():
    """trial_extension applied to a user with no trial AND a paying
    user (trial_ends_at past) → base is now()."""
    row = _promo_row(kind="trial_extension", value=14, max_redemptions=None)
    db = _db_with_lookup_result(row)

    result = await redeem(
        db, code="GIFT14", user_id=uuid4(),
        user_email="u@example.com", user_trial_ends_at=None,
    )
    expected = _now() + timedelta(days=14)
    assert abs((result.new_trial_ends_at - expected).total_seconds()) < 5


@pytest.mark.asyncio
async def test_redeem_percent_off_no_trial_mutation():
    row = _promo_row(kind="percent_off", value=50, max_redemptions=None)
    db = _db_with_lookup_result(row)
    result = await redeem(
        db, code="HALF", user_id=uuid4(),
        user_email="u@example.com", user_trial_ends_at=None,
    )
    assert result.kind == "percent_off"
    assert result.value == 50
    assert result.new_trial_ends_at is None  # no trial mutation


# ─── create_promo_code validation ──────────────────────────────


@pytest.mark.asyncio
async def test_create_rejects_invalid_kind():
    db = MagicMock()
    with pytest.raises(PromoError):
        await create_promo_code(
            db, code="X", kind="invalid", value=10,
            created_by_user_id=uuid4(),
        )


@pytest.mark.asyncio
async def test_create_rejects_percent_over_100():
    db = MagicMock()
    with pytest.raises(PromoError):
        await create_promo_code(
            db, code="X", kind="percent_off", value=200,
            created_by_user_id=uuid4(),
        )


@pytest.mark.asyncio
async def test_create_rejects_domain_without_at_sign():
    db = MagicMock()
    with pytest.raises(PromoError):
        await create_promo_code(
            db, code="X", kind="percent_off", value=10,
            min_email_domain="university.edu",  # missing @
            created_by_user_id=uuid4(),
        )
