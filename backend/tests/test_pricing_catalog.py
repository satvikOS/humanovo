"""Unit test for the public /pricing/tiers endpoint.

Locks in the shape contract the desktop UI + landing page will
consume. Schema-only — no DB or auth dependency since the endpoint
is pure constants.
"""
from __future__ import annotations

import pytest

from app.api.v1.endpoints.pricing_catalog import (
    DEFAULT_SUB_AGENTS_PER_STAGE,
    OVERAGE_PER_RUN_CENTS,
    PRICING_TIERS,
    TRIAL_DAYS,
    get_pricing_tiers,
)


def test_pricing_tiers_constant_is_well_formed():
    """Every tier has the required fields, monotone ordering by price."""
    required_keys = {
        "key", "name", "tagline", "monthly_price_cents",
        "annual_price_cents", "monthly_cap_cents",
        "monthly_runs_at_default_n", "features",
        "stripe_price_id_monthly", "stripe_price_id_annual",
    }
    for tier in PRICING_TIERS:
        missing = required_keys - set(tier.keys())
        assert not missing, f"tier {tier.get('key')} missing keys: {missing}"
        assert isinstance(tier["features"], list)
        assert len(tier["features"]) >= 1


def test_pricing_tiers_are_in_ascending_price_order():
    prices = [t["monthly_price_cents"] for t in PRICING_TIERS]
    assert prices == sorted(prices), "tiers must be ordered ascending by monthly_price_cents"


def test_annual_price_is_about_17_pct_off_for_paid_tiers():
    for tier in PRICING_TIERS:
        monthly = tier["monthly_price_cents"]
        annual = tier["annual_price_cents"]
        if monthly == 0:
            assert annual == 0  # trial: both free
            continue
        full_year = monthly * 12
        # Allow ±2% slop for rounding to round-dollar prices.
        discount_pct = 100 * (full_year - annual) / full_year
        assert 15 <= discount_pct <= 19, (
            f"tier {tier['key']}: annual discount is {discount_pct:.1f}%, "
            "expected ~17%"
        )


def test_paid_tiers_have_stripe_price_ids_set():
    """The trial tier has None price_ids (free); every other tier
    must reference Stripe price catalogue entries — operators MUST
    create matching prices in Stripe live mode before paid launch."""
    for tier in PRICING_TIERS:
        if tier["key"] == "trial":
            assert tier["stripe_price_id_monthly"] is None
            assert tier["stripe_price_id_annual"] is None
        else:
            assert tier["stripe_price_id_monthly"] is not None
            assert tier["stripe_price_id_annual"] is not None


def test_constants_are_documented():
    """The pricing-page UI reads these constants directly. Lock
    sensible values."""
    assert OVERAGE_PER_RUN_CENTS == 120
    assert TRIAL_DAYS == 14
    assert DEFAULT_SUB_AGENTS_PER_STAGE == 25


@pytest.mark.asyncio
async def test_endpoint_returns_tiers_plus_metadata():
    out = await get_pricing_tiers()
    assert "tiers" in out
    assert len(out["tiers"]) == len(PRICING_TIERS)
    assert out["overage_per_run_cents"] == 120
    assert out["trial_days"] == 14
    assert out["annual_discount_pct"] == 17
    assert out["currency"] == "usd"
    assert "note" in out and len(out["note"]) > 20
