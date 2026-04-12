"""
Unit tests for app.compute.clinical.processor.ClinicalProcessor.

Focus on the deterministic, fast-to-run operations — ICC and
Bland-Altman — which have well-known reference answers.
"""
from __future__ import annotations

from typing import Any

import numpy as np
import pytest

from app.compute.clinical.processor import ClinicalProcessor
from app.compute.types import ComputeDomain, ComputeRequest, ComputeStatus


def _req(op: str, **params: Any) -> ComputeRequest:
    return ComputeRequest(
        domain=ComputeDomain.CLINICAL,
        operation=op,
        parameters=params,
    )


@pytest.fixture
def proc() -> ClinicalProcessor:
    return ClinicalProcessor()


# ── ICC ────────────────────────────────────────────────────────────────


async def test_icc_perfect_agreement_is_one(proc: ClinicalProcessor) -> None:
    # All raters give the identical score per subject ⇒ ICC = 1.0.
    data = [[1, 1], [2, 2], [3, 3], [4, 4], [5, 5]]
    result = await proc.execute(_req("icc", data=data))
    assert result.status is ComputeStatus.COMPLETED
    # ICC(2,1) and ICC(3,1) must hit 1.0 exactly for perfect agreement.
    assert result.results["ICC(2,1)"] == pytest.approx(1.0)
    assert result.results["ICC(3,1)"] == pytest.approx(1.0)


async def test_icc_high_agreement(proc: ClinicalProcessor) -> None:
    rng = np.random.default_rng(13)
    # Two raters with small noise around a true subject score.
    truths = rng.normal(50, 10, 20)
    rater1 = truths + rng.normal(0, 1, 20)
    rater2 = truths + rng.normal(0, 1, 20)
    data = np.vstack([rater1, rater2]).T.tolist()

    result = await proc.execute(_req("icc", data=data))
    assert result.status is ComputeStatus.COMPLETED
    # With tight noise, ICC should be very high.
    assert result.results["ICC(2,1)"] > 0.9


# ── Bland-Altman ───────────────────────────────────────────────────────


async def test_bland_altman_unbiased_methods(proc: ClinicalProcessor) -> None:
    rng = np.random.default_rng(21)
    # Two measurement methods with identical distribution.
    method1 = rng.normal(10, 2, 100).tolist()
    method2 = rng.normal(10, 2, 100).tolist()

    result = await proc.execute(_req("bland_altman", method1=method1, method2=method2))
    assert result.status is ComputeStatus.COMPLETED
    # Bias should be near zero; LoA should bracket it.
    bias = result.results["bias"]
    assert abs(bias) < 1.0
    assert result.results["loa_upper"] > bias
    assert result.results["loa_lower"] < bias


async def test_bland_altman_detects_systematic_bias(proc: ClinicalProcessor) -> None:
    rng = np.random.default_rng(22)
    method1 = rng.normal(10, 2, 100)
    method2 = method1 - 3.0  # systematic offset
    result = await proc.execute(
        _req("bland_altman", method1=method1.tolist(), method2=method2.tolist())
    )
    assert result.status is ComputeStatus.COMPLETED
    # Bias should be ~+3 (method1 − method2 = +3).
    assert abs(result.results["bias"] - 3.0) < 0.1


# ── dispatcher error paths ─────────────────────────────────────────────


async def test_unknown_clinical_op_fails_cleanly(proc: ClinicalProcessor) -> None:
    result = await proc.execute(_req("made_up_op"))
    assert result.status is ComputeStatus.FAILED
    assert "Unknown operation" in (result.error or "")


async def test_missing_params_yields_failed(proc: ClinicalProcessor) -> None:
    result = await proc.execute(_req("icc"))
    assert result.status is ComputeStatus.FAILED
