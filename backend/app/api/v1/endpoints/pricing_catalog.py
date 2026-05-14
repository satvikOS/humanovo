"""Public pricing-catalog endpoint.

GET /api/v1/pricing/tiers (PUBLIC — no auth) returns the live
pricing table so the desktop landing page + in-app billing UI can
render without hardcoding figures that drift from backend reality.

Shape:

  {
    "tiers": [
      {
        "key": "researcher",
        "name": "Researcher",
        "monthly_price_cents": 2900,
        "annual_price_cents": 28800,   // 17% off
        "monthly_cap_cents": 400,
        "monthly_runs_at_default_n": 7,
        "features": ["..."],
        "stripe_price_id_monthly": "price_xxx",
        "stripe_price_id_annual": "price_yyy"
      },
      ...
    ],
    "overage_per_run_cents": 120,
    "trial_days": 14
  }

The endpoint is intentionally PUBLIC because the landing page +
unauthenticated checkout flow both need the prices. No PII / no
revenue signal — pricing is public knowledge anyway.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends

from app.core.rate_limit import rate_limit


router = APIRouter()


# Pricing table — authoritative source for the desktop UI. The
# Stripe price catalogue (live mode) is the BILLING truth; this is
# the DISPLAY truth. Operators editing tiers update BOTH this
# constant and Stripe's price catalogue, then redeploy + dispatch
# the pricing webhook on a fresh checkout to verify alignment.
#
# Annual prices = 12 × monthly × 0.83 (≈ 17% discount), rounded to
# nearest dollar to keep the savings story clean.
PRICING_TIERS: list[dict[str, Any]] = [
    {
        "key": "trial",
        "name": "Trial",
        "tagline": "14 days free, no credit card",
        "monthly_price_cents": 0,
        "annual_price_cents": 0,
        "monthly_cap_cents": 50,    # TIER_MONTHLY_CAP_CENTS["trial"]
        "monthly_runs_at_default_n": 0,  # ~0.5 run at $1.12 each
        "features": [
            "Full access to the 12-stage discovery pipeline",
            "All 62 biomedical data sources",
            "Citation chain export",
            "Workspace + knowledge graph",
        ],
        "stripe_price_id_monthly": None,
        "stripe_price_id_annual": None,
    },
    {
        "key": "researcher",
        "name": "Researcher",
        "tagline": "Solo researcher, focused on depth",
        "monthly_price_cents": 2900,
        "annual_price_cents": 28800,   # 12 × 29 × 0.83 ≈ 288
        "monthly_cap_cents": 400,      # TIER_MONTHLY_CAP_CENTS["researcher"]
        "monthly_runs_at_default_n": 3,
        "features": [
            "Everything in Trial",
            "Priority support",
            "API key access",
            "Audit-log export",
            "Multi-hypothesis parallelism",
        ],
        "stripe_price_id_monthly": "price_researcher_monthly",
        "stripe_price_id_annual": "price_researcher_annual",
    },
    {
        "key": "lab",
        "name": "Lab",
        "tagline": "Up to 10 seats for small research teams",
        "monthly_price_cents": 19900,
        "annual_price_cents": 198000,  # 12 × 199 × 0.83 ≈ 1980
        "monthly_cap_cents": 4_000,    # TIER_MONTHLY_CAP_CENTS["lab"]
        "monthly_runs_at_default_n": 35,
        "features": [
            "Everything in Researcher",
            "Up to 10 seats",
            "Shared knowledge graph",
            "Collaboration on hypotheses",
            "SSO (Google / GitHub)",
            "Dedicated Slack channel",
        ],
        "stripe_price_id_monthly": "price_lab_monthly",
        "stripe_price_id_annual": "price_lab_annual",
    },
    {
        "key": "institution",
        "name": "Institution",
        "tagline": "Department / hospital-grade deployment",
        "monthly_price_cents": 99900,
        "annual_price_cents": 995000,  # 12 × 999 × 0.83 ≈ 9950
        "monthly_cap_cents": 20_000,   # TIER_MONTHLY_CAP_CENTS["institution"]
        "monthly_runs_at_default_n": 178,
        "features": [
            "Everything in Lab",
            "Unlimited seats",
            "HIPAA BAA",
            "SOC 2 attestation",
            "Custom data residency (US / EU)",
            "Dedicated infrastructure",
            "Quarterly business review",
        ],
        "stripe_price_id_monthly": "price_institution_monthly",
        "stripe_price_id_annual": "price_institution_annual",
    },
]


# Constants that the pricing page surfaces alongside tiers.
OVERAGE_PER_RUN_CENTS = 120         # from stripe_overage.py
TRIAL_DAYS = 14                     # from create_user default
DEFAULT_SUB_AGENTS_PER_STAGE = 25   # production default; affects
                                    # the "monthly_runs_at_default_n"


@router.get(
    "/pricing/tiers",
    dependencies=[Depends(rate_limit("public"))],
)
async def get_pricing_tiers() -> dict[str, Any]:
    """Return the live pricing catalogue.

    PUBLIC endpoint — no auth required. Pricing is published on the
    landing page anyway. Rate-limited via the "public" bucket so a
    scraper can't hammer it.
    """
    return {
        "tiers": PRICING_TIERS,
        "overage_per_run_cents": OVERAGE_PER_RUN_CENTS,
        "trial_days": TRIAL_DAYS,
        "default_sub_agents_per_stage": DEFAULT_SUB_AGENTS_PER_STAGE,
        "annual_discount_pct": 17,
        "currency": "usd",
        "note": (
            "Annual billing saves ~17% — same monthly cap, billed once "
            "per year. Overage runs (beyond your monthly cap) charge "
            "$1.20 each when overage_enabled=true; otherwise the cap "
            "is a hard wall."
        ),
    }
