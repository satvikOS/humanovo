"""
Discovery Run Cost Predictor.

Shows the user an ex-ante cost estimate BEFORE they hit Start, based
on their own historical burn + the configured run shape (num
hypotheses, num rounds, which stages are enabled).

Inputs:
    run_config: dict with keys
        num_hypotheses (default 9)
        num_rounds     (default 3)
        enable_paper_gen (default True)
        enable_protocol  (default True)
    user_id: looked up in usage_events to personalise the estimate.
             Falls back to global averages when history is short.

Output:
    PredictedCost(
      estimate_usd=0.85,
      confidence_low=0.60,
      confidence_high=1.20,
      breakdown_per_stage=[{stage, estimated_usd}, ...],
      n_historical_samples=X,
      note=<short explainer>,
    )

The predictor uses a 95% trimmed-mean of the user's last 20 discovery
runs' cost-per-hypothesis as the point estimate. The range is the
10th/90th percentile band. When the user has fewer than 5 historical
runs, we blend with the global median.
"""

from __future__ import annotations

import logging
import statistics
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import text

from app.core.database import async_session_factory

logger = logging.getLogger(__name__)


GLOBAL_MEDIAN_USD_PER_HYPOTHESIS = 1.00
GLOBAL_MEDIAN_USD_PER_PAPER = 2.00
PROTOCOL_COST_USD = 0.05           # tiny — mostly compute engine
FREE_THRESHOLD_SAMPLES = 5


@dataclass
class PredictedCost:
    estimate_usd: float
    confidence_low: float
    confidence_high: float
    breakdown_per_stage: list[dict[str, Any]] = field(default_factory=list)
    n_historical_samples: int = 0
    note: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "estimate_usd": round(self.estimate_usd, 4),
            "confidence_low": round(self.confidence_low, 4),
            "confidence_high": round(self.confidence_high, 4),
            "breakdown_per_stage": self.breakdown_per_stage,
            "n_historical_samples": self.n_historical_samples,
            "note": self.note,
        }


async def predict_discovery_cost(
    *,
    num_hypotheses: int = 9,
    num_rounds: int = 3,
    enable_paper_gen: bool = True,
    enable_protocol: bool = True,
    user_id: str | None = None,
) -> PredictedCost:
    """Return an ex-ante cost estimate for a discovery run."""
    # 1. Pull user's historical discovery-run costs
    history: list[float] = []
    global_history: list[float] = []

    async with async_session_factory() as session:
        try:
            if user_id:
                # Per-user: join usage_events to discovery_runs where owner_id matches
                r = await session.execute(text("""
                    SELECT dr.id, SUM(ue.cost_cents) / 100.0 AS cost_usd,
                           dr.hypotheses_generated
                    FROM discovery_runs dr
                    JOIN usage_events ue ON ue.discovery_run_id = dr.id
                    LEFT JOIN projects p ON p.id = dr.project_id
                    WHERE p.owner_id = :uid
                      AND dr.created_at > NOW() - INTERVAL '60 days'
                      AND dr.hypotheses_generated > 0
                    GROUP BY dr.id, dr.hypotheses_generated
                    ORDER BY dr.created_at DESC
                    LIMIT 20
                """), {"uid": user_id})
                for row in r.fetchall():
                    cost = float(row[1] or 0)
                    n = int(row[2] or 1)
                    history.append(cost / max(1, n))  # cost per hypothesis
        except Exception as e:
            logger.debug(f"[cost_predictor] user-scoped query failed: {e}")

        try:
            r = await session.execute(text("""
                SELECT dr.id, SUM(ue.cost_cents) / 100.0 AS cost_usd,
                       dr.hypotheses_generated
                FROM discovery_runs dr
                JOIN usage_events ue ON ue.discovery_run_id = dr.id
                WHERE dr.created_at > NOW() - INTERVAL '30 days'
                  AND dr.hypotheses_generated > 0
                GROUP BY dr.id, dr.hypotheses_generated
                ORDER BY dr.created_at DESC
                LIMIT 100
            """))
            for row in r.fetchall():
                cost = float(row[1] or 0)
                n = int(row[2] or 1)
                global_history.append(cost / max(1, n))
        except Exception as e:
            logger.debug(f"[cost_predictor] global query failed: {e}")

    # 2. Pick the best available distribution
    if len(history) >= FREE_THRESHOLD_SAMPLES:
        samples = history
        source = "your last 20 runs"
    elif history:
        # Blend
        samples = history + global_history[: (FREE_THRESHOLD_SAMPLES - len(history)) * 3]
        source = "mixed (your history + global)"
    elif global_history:
        samples = global_history
        source = "platform median"
    else:
        samples = [GLOBAL_MEDIAN_USD_PER_HYPOTHESIS]
        source = "calibration default"

    # Trimmed statistics (drop top + bottom 5%)
    if len(samples) >= 5:
        samples_sorted = sorted(samples)
        trim = max(1, len(samples_sorted) // 20)
        samples_sorted = samples_sorted[trim: len(samples_sorted) - trim]
        per_hyp_cost = statistics.mean(samples_sorted)
        low = samples_sorted[max(0, len(samples_sorted) // 10)]
        high = samples_sorted[min(len(samples_sorted) - 1,
                                  len(samples_sorted) * 9 // 10)]
    else:
        per_hyp_cost = statistics.mean(samples)
        low = per_hyp_cost * 0.6
        high = per_hyp_cost * 1.4

    # 3. Compose total estimate from configured run shape
    hyp_total = per_hyp_cost * num_hypotheses
    paper_cost = GLOBAL_MEDIAN_USD_PER_PAPER if enable_paper_gen else 0.0
    proto_cost = (PROTOCOL_COST_USD * num_hypotheses) if enable_protocol else 0.0

    estimate = hyp_total + paper_cost + proto_cost
    low_total = low * num_hypotheses + paper_cost * 0.7 + proto_cost * 0.5
    high_total = high * num_hypotheses + paper_cost * 1.5 + proto_cost * 1.5

    breakdown = [
        {"stage": "discovery_hypotheses",
         "count": num_hypotheses,
         "unit_usd": round(per_hyp_cost, 4),
         "estimated_usd": round(hyp_total, 4)},
    ]
    if enable_paper_gen:
        breakdown.append({
            "stage": "paper_generation",
            "count": 1,
            "unit_usd": GLOBAL_MEDIAN_USD_PER_PAPER,
            "estimated_usd": paper_cost,
        })
    if enable_protocol:
        breakdown.append({
            "stage": "protocol_per_hypothesis",
            "count": num_hypotheses,
            "unit_usd": PROTOCOL_COST_USD,
            "estimated_usd": round(proto_cost, 4),
        })

    return PredictedCost(
        estimate_usd=estimate,
        confidence_low=low_total,
        confidence_high=high_total,
        breakdown_per_stage=breakdown,
        n_historical_samples=len(samples),
        note=(
            f"Based on {source} ({len(samples)} samples). "
            f"Actual cost typically lands in "
            f"${round(low_total, 2)}–${round(high_total, 2)}."
        ),
    )
