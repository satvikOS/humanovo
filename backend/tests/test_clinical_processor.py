"""
Unit tests for app.compute.clinical.processor.ClinicalProcessor.

Covers the deterministic, fast-to-run operations — ICC, Bland-Altman,
clinical rating scales, power analysis, and HRV — which all have
well-known reference answers. The heavier ML/statistical paths
(classification, factor analysis, mixed-effects, RM-ANOVA) are
exercised by integration tests on real datasets instead, since
their outputs depend on iterative optimisers.
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


# ── Clinical Scales ────────────────────────────────────────────────────


async def test_phq9_severity_bands(proc: ClinicalProcessor) -> None:
    # PHQ-9 bands: 0-4 Minimal, 5-9 Mild, 10-14 Moderate, 15-19 Mod.severe, 20+ Severe.
    # Item 9 is suicidality; non-zero should flag it.
    items = [2, 2, 2, 2, 2, 2, 2, 2, 1]  # total = 17 → Moderately severe
    result = await proc.execute(_req("clinical_scales", scale="PHQ-9", items=items))
    assert result.status is ComputeStatus.COMPLETED
    r = result.results
    assert r["total"] == pytest.approx(17.0)
    assert r["severity"] == "Moderately severe"
    assert r["provisional_mdd"] is True
    assert bool(r["suicidality_flag"]) is True  # item 9 (index 8) = 1


async def test_phq9_minimal_depression(proc: ClinicalProcessor) -> None:
    items = [0] * 9
    result = await proc.execute(_req("clinical_scales", scale="PHQ-9", items=items))
    assert result.results["total"] == pytest.approx(0.0)
    assert result.results["severity"] == "Minimal"
    assert result.results["provisional_mdd"] is False
    assert bool(result.results["suicidality_flag"]) is False


async def test_gad7_severity(proc: ClinicalProcessor) -> None:
    # 10 on GAD-7 crosses the clinical threshold → Moderate.
    items = [2, 2, 2, 1, 1, 1, 1]  # total = 10
    result = await proc.execute(_req("clinical_scales", scale="GAD-7", items=items))
    assert result.results["total"] == pytest.approx(10.0)
    assert result.results["severity"] == "Moderate"
    assert result.results["clinical_threshold"] is True


async def test_hamd_response_from_baseline(proc: ClinicalProcessor) -> None:
    # HAM-D with baseline 30 → follow-up total 10 is a 66.7% reduction,
    # which counts as a treatment response (≥50% drop).
    items = [1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 1, 0, 0, 0, 0]  # total = 10
    result = await proc.execute(_req(
        "clinical_scales", scale="HAM-D", items=items, baseline_total=30,
    ))
    assert result.results["total"] == pytest.approx(10.0)
    assert result.results["response"] is True
    assert result.results["pct_change"] == pytest.approx(66.7, abs=0.1)


async def test_madrs_remission_at_threshold(proc: ClinicalProcessor) -> None:
    # MADRS remission cutoff is ≤10.
    items = [1] * 10  # total = 10 → Mild, remission=True
    result = await proc.execute(_req("clinical_scales", scale="MADRS", items=items))
    assert result.results["total"] == pytest.approx(10.0)
    assert result.results["remission"] is True


async def test_ymrs_remission_band(proc: ClinicalProcessor) -> None:
    # YMRS ≤12 = Remission.
    items = [1] * 11  # total = 11 → Remission
    result = await proc.execute(_req("clinical_scales", scale="YMRS", items=items))
    assert result.results["total"] == pytest.approx(11.0)
    assert result.results["severity"] == "Remission"


async def test_unknown_scale_returns_failed(proc: ClinicalProcessor) -> None:
    result = await proc.execute(_req("clinical_scales", scale="BOGUS", items=[0, 0]))
    assert result.status is ComputeStatus.FAILED
    assert "Unknown scale" in (result.error or "")


async def test_panss_remission_andreasen_criteria(proc: ClinicalProcessor) -> None:
    # Andreasen (2005) 8-item criterion: P1,P2,P3,N1,N4,N6,G5,G9 all ≤ 3.
    # Build a 30-item vector where exactly those 8 indices are 3 (pass),
    # everything else is 4 (would fail if indexed wrong).
    items = [4] * 30
    for i in [0, 1, 2, 7, 10, 12, 18, 22]:
        items[i] = 3
    result = await proc.execute(_req("clinical_scales", scale="PANSS", items=items))
    assert result.status is ComputeStatus.COMPLETED
    assert result.results["remission_andreasen"] is True

    # Flipping P1 (index 0) above 3 must break remission.
    items[0] = 4
    result2 = await proc.execute(_req("clinical_scales", scale="PANSS", items=items))
    assert result2.results["remission_andreasen"] is False


async def test_panss_marder_factor_decomposition(proc: ClinicalProcessor) -> None:
    # Putting distinguishable values into each Marder factor lets us verify
    # the 5 sub-scores are summing the right indices (anti-regression against
    # the earlier buggy index list).
    items = [0] * 30
    # Positive factor: P1=0, P3=2, P5=4, P6=5, G9=22 → sum = 5.
    for i in [0, 2, 4, 5, 22]:
        items[i] = 1
    result = await proc.execute(_req("clinical_scales", scale="PANSS", items=items))
    assert result.results["marder_factors"]["positive"] == pytest.approx(5.0)
    # Nothing else should have been assigned, so other factors are 0.
    assert result.results["marder_factors"]["depressed"] == pytest.approx(0.0)
    assert result.results["marder_factors"]["excited"] == pytest.approx(0.0)


# ── Power Analysis ─────────────────────────────────────────────────────


async def test_power_parallel_continuous_sensible_sample_size(proc: ClinicalProcessor) -> None:
    # Cohen's d=0.5 with α=0.05 and power=0.80 is the textbook case —
    # n ≈ 64 per arm. We allow a small tolerance for rounding / z-quantile.
    result = await proc.execute(_req(
        "power_analysis_clinical",
        design="parallel", outcome="continuous",
        effect_size=0.5, alpha=0.05, power=0.80,
    ))
    assert result.status is ComputeStatus.COMPLETED
    assert 60 <= result.results["n_per_arm"] <= 70
    assert result.results["total_n"] == 2 * result.results["n_per_arm_adjusted"]


async def test_power_dropout_inflates_sample(proc: ClinicalProcessor) -> None:
    # 20% dropout must raise the per-arm n above the base estimate.
    base = await proc.execute(_req(
        "power_analysis_clinical",
        design="parallel", outcome="continuous",
        effect_size=0.5, alpha=0.05, power=0.80,
    ))
    adj = await proc.execute(_req(
        "power_analysis_clinical",
        design="parallel", outcome="continuous",
        effect_size=0.5, alpha=0.05, power=0.80,
        dropout_rate=0.2,
    ))
    assert adj.results["n_per_arm_adjusted"] > base.results["n_per_arm_adjusted"]
    # n_adj = ceil(n / (1 - 0.2)) = ceil(n * 1.25)
    assert adj.results["n_per_arm_adjusted"] >= base.results["n_per_arm"] * 1.24


async def test_power_binary_outcome_returns_positive_n(proc: ClinicalProcessor) -> None:
    # Simple two-proportion test: p1=0.5 vs p2=0.3.
    result = await proc.execute(_req(
        "power_analysis_clinical",
        design="parallel", outcome="binary",
        p1=0.5, p2=0.3, alpha=0.05, power=0.80,
    ))
    assert result.status is ComputeStatus.COMPLETED
    assert result.results["n_per_arm"] > 0
    # Reference answer is ~93 per arm for this effect size.
    assert 80 <= result.results["n_per_arm"] <= 110


async def test_power_crossover_needs_fewer_subjects(proc: ClinicalProcessor) -> None:
    # Crossover design with rho=0.5 should demand fewer subjects than
    # the equivalent parallel design, because within-subject comparison
    # cancels between-subject variance.
    parallel = await proc.execute(_req(
        "power_analysis_clinical",
        design="parallel", outcome="continuous", effect_size=0.5,
    ))
    crossover = await proc.execute(_req(
        "power_analysis_clinical",
        design="crossover", outcome="continuous", effect_size=0.5,
        correlation=0.5,
    ))
    # Crossover uses the same subjects for both arms, so total n < 2 * parallel/arm.
    assert crossover.results["total_n"] < parallel.results["total_n"]


# ── HRV Analysis ───────────────────────────────────────────────────────


async def test_hrv_time_domain_on_steady_beats(proc: ClinicalProcessor) -> None:
    # A long, nearly-constant series of RR intervals should give
    # low variability metrics (SDNN, RMSSD both small) and a mean
    # heart rate that maps correctly to the mean NN interval.
    rng = np.random.default_rng(7)
    rr = 800 + rng.normal(0, 5, 600)  # ms, tight noise around 800 ms
    result = await proc.execute(_req("hrv_analysis", rr_intervals=rr.tolist()))
    assert result.status is ComputeStatus.COMPLETED
    td = result.results["time_domain"]
    # Mean NN ≈ 800 ms → HR ≈ 75 bpm.
    assert td["mean_nn_ms"] == pytest.approx(800.0, abs=2.0)
    assert td["mean_hr_bpm"] == pytest.approx(75.0, abs=0.5)
    # SDNN should be close to the injected noise std (~5 ms), but the
    # Malik artifact corrector may clip outliers so just bound it.
    assert 0 < td["sdnn_ms"] < 15
    # Nonlinear block must be present with positive ellipse area.
    assert result.results["nonlinear"]["ellipse_area"] > 0


async def test_hrv_artifact_correction_flags_outliers(proc: ClinicalProcessor) -> None:
    # Inject a wild outlier; the Malik >20% rule should replace it with
    # the local median and report at least one correction.
    rr = [800.0] * 50
    rr[25] = 2000.0  # obvious ectopic beat
    result = await proc.execute(_req("hrv_analysis", rr_intervals=rr))
    assert result.status is ComputeStatus.COMPLETED
    assert result.results["n_artifacts_corrected"] >= 1
