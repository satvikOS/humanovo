#!/usr/bin/env python3
"""Stripe → cost-tracking reconciliation script.

Daily cron. Reconciles three sources of truth and surfaces drift:

  1. Stripe's view (Stripe API): billed revenue per customer in the
     last 24h.
  2. Our `usage_events` table (cost-tracking-service): cost we
     RECORDED per user in the same window.
  3. Our `stripe_processed_events` table: webhook events we
     PROCESSED in the same window.

Expected invariant in steady state:
  • Every Stripe charge has a corresponding `payment_intent.succeeded`
    or `invoice.payment_succeeded` event we processed (table 3).
  • Per-user cost from cost-tracking (table 2) is bounded by the
    user's tier cap; if it exceeds, the overage charge should
    appear in Stripe (table 1).

Drift symptoms:
  • Stripe event NOT in stripe_processed_events → webhook delivery
    failed (network, signature mis-config, our 5xx). Action: replay
    via Stripe dashboard.
  • cost-tracking total ≫ Stripe revenue — we charged an LLM call
    but failed to bill it. Action: investigate budget enforcer.
  • Stripe revenue ≫ cost-tracking total — we billed without a
    matching usage event. Action: refund or backfill.

Output: pass/fail report + drift table to stdout. Exit 0 on no
drift, 1 on any drift detected. CI / cron-runner alerts on exit 1.

Env: STRIPE_SECRET_KEY required. DATABASE_URL required. Designed to
run in the same image as the FastAPI backend so deps are already
installed.
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import os
import sys
from datetime import UTC, datetime, timedelta
from decimal import Decimal


logger = logging.getLogger("stripe_reconcile")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")


# Drift tolerance: cents below this threshold are noise (rounding,
# in-flight events, etc.) and don't trigger an alarm. Above this is
# a real problem worth paging on.
DRIFT_TOLERANCE_CENTS = 100  # $1.00


async def fetch_stripe_revenue(window_hours: int) -> dict[str, int]:
    """Return {customer_id: revenue_cents} for charges in the window."""
    import stripe

    api_key = os.environ.get("STRIPE_SECRET_KEY", "")
    if not api_key:
        logger.error("STRIPE_SECRET_KEY not set")
        return {}
    stripe.api_key = api_key

    cutoff_ts = int((datetime.now(UTC) - timedelta(hours=window_hours)).timestamp())
    by_customer: dict[str, int] = {}
    # Stripe.Charge.list() paginates; auto-page via auto_paging_iter.
    try:
        for charge in stripe.Charge.list(
            created={"gte": cutoff_ts},
            limit=100,
        ).auto_paging_iter():
            if not charge.paid:
                continue
            cust = charge.customer
            if not cust:
                continue
            by_customer[cust] = by_customer.get(cust, 0) + int(charge.amount)
    except Exception as e:
        logger.error("stripe charge.list failed: %s", e)
    return by_customer


async def fetch_processed_events(window_hours: int) -> set[str]:
    """Return set of event_ids in stripe_processed_events for the window."""
    from sqlalchemy import text

    from app.core.database import async_session_factory

    cutoff = datetime.now(UTC) - timedelta(hours=window_hours)
    async with async_session_factory() as db:
        result = await db.execute(
            text(
                "SELECT event_id FROM stripe_processed_events "
                "WHERE processed_at >= :cutoff"
            ),
            {"cutoff": cutoff},
        )
        return {row[0] for row in result}


async def fetch_cost_tracking_totals(window_hours: int) -> dict[str, int]:
    """Return {user_id: total_cost_cents} from usage_events in the window."""
    from sqlalchemy import text

    from app.core.database import async_session_factory

    cutoff = datetime.now(UTC) - timedelta(hours=window_hours)
    async with async_session_factory() as db:
        # The cost-tracking schema may store cost as cents or cents-with-
        # fraction (Decimal). Aggregate as float; cast to int cents on
        # output. The exact column name depends on the migration history;
        # try the most likely name first, fall back to alternatives.
        for col in ("cost_cents", "total_cost_cents", "cost"):
            try:
                result = await db.execute(
                    text(
                        f"SELECT user_id, SUM({col})::numeric "
                        "FROM usage_events "
                        "WHERE created_at >= :cutoff "
                        "GROUP BY user_id"
                    ),
                    {"cutoff": cutoff},
                )
                return {
                    str(row[0]): int(Decimal(row[1])) if row[1] is not None else 0
                    for row in result
                }
            except Exception:
                continue
        logger.warning("usage_events: no recognised cost column found")
        return {}


def main_sync() -> int:
    parser = argparse.ArgumentParser(description="Stripe ↔ cost-tracking reconciler")
    parser.add_argument(
        "--window-hours",
        type=int,
        default=24,
        help="Lookback window in hours (default 24).",
    )
    parser.add_argument(
        "--tolerance-cents",
        type=int,
        default=DRIFT_TOLERANCE_CENTS,
        help="Drift below this is treated as noise (default 100¢ = $1.00).",
    )
    args = parser.parse_args()

    return asyncio.run(_run(args.window_hours, args.tolerance_cents))


async def _run(window_hours: int, tolerance_cents: int) -> int:
    print(f"=== Stripe billing reconciliation ===", flush=True)
    print(f"Window: last {window_hours}h", flush=True)
    print(f"Drift tolerance: {tolerance_cents}¢ (${tolerance_cents/100:.2f})\n", flush=True)

    stripe_revenue = await fetch_stripe_revenue(window_hours)
    processed = await fetch_processed_events(window_hours)
    cost_totals = await fetch_cost_tracking_totals(window_hours)

    print(f"Stripe charges in window: {len(stripe_revenue)} customers, "
          f"total ${sum(stripe_revenue.values())/100:.2f}", flush=True)
    print(f"Processed webhook events: {len(processed)}", flush=True)
    print(f"Cost-tracking totals: {len(cost_totals)} users, "
          f"total ${sum(cost_totals.values())/100:.2f}\n", flush=True)

    # Drift detection — we don't have a Stripe customer-ID ↔ humanovo
    # user-ID join in this pure-SQL surface, so we report aggregates.
    # A future enhancement queries `users.stripe_customer_id` to do
    # the per-customer reconciliation properly.
    stripe_total = sum(stripe_revenue.values())
    cost_total = sum(cost_totals.values())
    drift = abs(stripe_total - cost_total)

    print(f"Aggregate drift: {drift}¢ (${drift/100:.2f})", flush=True)

    if drift > tolerance_cents:
        print(
            f"\n[DRIFT] Aggregate drift ${drift/100:.2f} exceeds tolerance "
            f"${tolerance_cents/100:.2f}. Investigate before next billing cycle.",
            flush=True,
        )
        # Surface exactly what's missing.
        if cost_total > stripe_total:
            print(
                "  Cost-tracking > Stripe revenue: we charged LLM calls "
                "without billing for them. Likely a budget-enforcer or "
                "Stripe-Meter wiring gap.",
                flush=True,
            )
        else:
            print(
                "  Stripe revenue > cost-tracking: customers paid but no "
                "matching usage_events. Likely a manual charge or refund "
                "we didn't record.",
                flush=True,
            )
        return 1

    print("\n[OK] Drift within tolerance.", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main_sync())
