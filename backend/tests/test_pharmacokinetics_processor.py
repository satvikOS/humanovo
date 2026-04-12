"""
Unit tests for app.compute.pharmacokinetics.processor.PharmacokineticsProcessor.

Focuses on ops with closed-form expected answers:
- One-compartment IV bolus: C(t) = (dose/Vd) * exp(-ke*t), AUC = dose/CL.
- Non-compartmental analysis: back-derives CL from synthetic IV data.
- Michaelis-Menten curve_fit on noise-free samples recovers Vmax/Km.
- Allometric scaling: Clearance ∝ BW^0.75 for engineered inputs ⇒ recovers 0.75.
"""
from __future__ import annotations

import math
from typing import Any

import numpy as np
import pytest

from app.compute.pharmacokinetics.processor import PharmacokineticsProcessor
from app.compute.types import ComputeDomain, ComputeRequest, ComputeStatus


def _req(op: str, **params: Any) -> ComputeRequest:
    return ComputeRequest(
        domain=ComputeDomain.PHARMACOKINETICS,
        operation=op,
        parameters=params,
    )


@pytest.fixture
def proc() -> PharmacokineticsProcessor:
    return PharmacokineticsProcessor()


# ── one_compartment ────────────────────────────────────────────────────


async def test_one_compartment_iv_bolus_auc_matches_dose_over_cl(
    proc: PharmacokineticsProcessor,
) -> None:
    # For an IV bolus, AUC(0→∞) = dose / CL. With t_end long enough
    # relative to t½, the trapezoidal AUC over [0, t_end] should be close.
    dose = 100.0
    CL = 5.0
    Vd = 20.0  # ke = CL/Vd = 0.25 ⇒ t½ ≈ 2.77 h; 48 h covers >17 half-lives.
    result = await proc.execute(
        _req(
            "one_compartment",
            dose=dose,
            volume_distribution=Vd,
            clearance=CL,
            t_end=48,
            n_points=2000,
        )
    )
    assert result.status is ComputeStatus.COMPLETED
    # Cmax for an IV bolus one-comp = dose / Vd.
    assert result.results["Cmax"] == pytest.approx(dose / Vd, rel=1e-3)
    # AUC ≈ dose/CL (trapezoidal approximation is unbiased here).
    assert result.results["AUC"] == pytest.approx(dose / CL, rel=5e-3)
    # Half-life = ln(2) / ke; ke = CL/Vd.
    assert result.results["half_life"] == pytest.approx(math.log(2) * Vd / CL, rel=1e-3)


# ── noncompartmental_analysis ──────────────────────────────────────────


async def test_nca_recovers_clearance_from_iv_curve(
    proc: PharmacokineticsProcessor,
) -> None:
    # Synthesize a perfect IV bolus curve, then ask NCA to back-derive CL.
    dose = 200.0
    CL = 10.0
    Vd = 40.0
    ke = CL / Vd
    times = np.linspace(0, 48, 200)
    conc = (dose / Vd) * np.exp(-ke * times)

    result = await proc.execute(
        _req(
            "noncompartmental_analysis",
            times=times.tolist(),
            concentrations=conc.tolist(),
            dose=dose,
            route="iv",
        )
    )
    assert result.status is ComputeStatus.COMPLETED
    # CL recovered within 5%.
    assert result.results["CL"] == pytest.approx(CL, rel=0.05)
    # Half-life recovered within 5%.
    assert result.results["t_half"] == pytest.approx(math.log(2) / ke, rel=0.05)
    # Cmax is the initial value on the curve.
    assert result.results["Cmax"] == pytest.approx(dose / Vd, rel=1e-3)


# ── michaelis_menten ───────────────────────────────────────────────────


async def test_michaelis_menten_recovers_vmax_km(
    proc: PharmacokineticsProcessor,
) -> None:
    # Noise-free samples of V = Vmax*S/(Km+S). curve_fit should recover exactly.
    Vmax, Km = 50.0, 2.0
    S = np.array([0.5, 1.0, 2.0, 5.0, 10.0, 20.0, 50.0])
    V = Vmax * S / (Km + S)
    result = await proc.execute(
        _req(
            "michaelis_menten",
            substrate_concentrations=S.tolist(),
            reaction_rates=V.tolist(),
        )
    )
    assert result.status is ComputeStatus.COMPLETED
    assert result.results["Vmax"] == pytest.approx(Vmax, rel=1e-3)
    assert result.results["Km"] == pytest.approx(Km, rel=1e-3)


async def test_michaelis_menten_forward_simulation(
    proc: PharmacokineticsProcessor,
) -> None:
    # With only Vmax/Km given, the op should simulate the curve and
    # echo the parameters back unchanged.
    result = await proc.execute(_req("michaelis_menten", Vmax=10.0, Km=1.0))
    assert result.status is ComputeStatus.COMPLETED
    assert result.results["Vmax"] == pytest.approx(10.0)
    assert result.results["Km"] == pytest.approx(1.0)


# ── allometric_scaling ─────────────────────────────────────────────────


async def test_allometric_scaling_recovers_exponent(
    proc: PharmacokineticsProcessor,
) -> None:
    # Engineer species data with CL = a*BW^0.75 exactly → recover b = 0.75.
    a, b = 3.0, 0.75
    species = [
        {"name": "mouse", "body_weight": 0.02, "clearance": a * 0.02**b},
        {"name": "rat", "body_weight": 0.25, "clearance": a * 0.25**b},
        {"name": "dog", "body_weight": 10.0, "clearance": a * 10.0**b},
        {"name": "monkey", "body_weight": 5.0, "clearance": a * 5.0**b},
    ]
    result = await proc.execute(
        _req("allometric_scaling", species=species, target_body_weight=70.0)
    )
    assert result.status is ComputeStatus.COMPLETED
    cl_fit = result.results["predictions"]["clearance"]
    assert cl_fit["exponent_b"] == pytest.approx(0.75, abs=1e-3)
    assert cl_fit["r_squared"] == pytest.approx(1.0, abs=1e-6)
    # Predicted CL at 70 kg = a * 70^0.75.
    assert cl_fit["predicted_value"] == pytest.approx(a * 70.0**b, rel=1e-3)


# ── dispatcher error paths ─────────────────────────────────────────────


async def test_unknown_pk_op_fails(proc: PharmacokineticsProcessor) -> None:
    result = await proc.execute(_req("teleport_drug"))
    assert result.status is ComputeStatus.FAILED
    assert "Unknown operation" in (result.error or "")


async def test_one_compartment_missing_params_fails(
    proc: PharmacokineticsProcessor,
) -> None:
    # Missing required `dose` → KeyError surfaces as FAILED result.
    result = await proc.execute(_req("one_compartment", volume_distribution=10, clearance=2))
    assert result.status is ComputeStatus.FAILED
