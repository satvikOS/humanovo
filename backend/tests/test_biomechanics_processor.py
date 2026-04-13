"""
Unit tests for app.compute.biomechanics.processor.BiomechanicsProcessor.

Targets deterministic motion-data operations — marker filtering, gap
filling, and center-of-mass aggregation. Joint-angle / gait-event ops
rely on anatomically-meaningful marker layouts and are covered by
higher-level integration tests.
"""
from __future__ import annotations

from typing import Any

import numpy as np
import pytest

from app.compute.biomechanics.processor import BiomechanicsProcessor
from app.compute.types import ComputeDomain, ComputeRequest, ComputeStatus


def _req(op: str, **params: Any) -> ComputeRequest:
    return ComputeRequest(
        domain=ComputeDomain.BIOMECHANICS,
        operation=op,
        parameters=params,
    )


@pytest.fixture
def proc() -> BiomechanicsProcessor:
    return BiomechanicsProcessor()


# ── filter_markers ─────────────────────────────────────────────────────


async def test_filter_markers_attenuates_high_freq(proc: BiomechanicsProcessor) -> None:
    # 100 Hz sampling; mix a 2 Hz slow signal with 40 Hz noise; low-pass at 6 Hz.
    fs = 100.0
    t = np.arange(0, 4.0, 1.0 / fs)
    slow = np.sin(2 * np.pi * 2.0 * t)
    noise = np.sin(2 * np.pi * 40.0 * t)
    mixed = (slow + noise)[:, None] * np.array([1.0, 0.0, 0.0])  # (n,3) — noise on X only.

    result = await proc.execute(
        _req(
            "filter_markers",
            markers={"M1": mixed.tolist()},
            sampling_rate=fs,
            cutoff_freq=6.0,
            order=4,
        )
    )
    assert result.status is ComputeStatus.COMPLETED
    filtered_x = np.array([row[0] for row in result.results["filtered_markers"]["M1"]])
    # Ignore filter edge artifacts; interior should track the slow component.
    interior = slice(40, len(t) - 40)
    resid = filtered_x[interior] - slow[interior]
    assert float(np.max(np.abs(resid))) < 0.15


async def test_filter_markers_rejects_cutoff_above_nyquist(
    proc: BiomechanicsProcessor,
) -> None:
    # Nyquist = 50 Hz; cutoff at 60 Hz should raise ValueError → FAILED.
    traj = np.zeros((200, 3)).tolist()
    result = await proc.execute(
        _req(
            "filter_markers",
            markers={"M1": traj},
            sampling_rate=100.0,
            cutoff_freq=60.0,
        )
    )
    assert result.status is ComputeStatus.FAILED
    assert "Nyquist" in (result.error or "")


# ── fill_gaps ──────────────────────────────────────────────────────────


async def test_fill_gaps_linear_recovers_straight_line(
    proc: BiomechanicsProcessor,
) -> None:
    # y = 2x + 1; blow a 5-frame gap in the middle → linear interp must recover.
    x = np.arange(20, dtype=float)
    y = 2.0 * x + 1.0
    data = np.column_stack([y, y * 0 + 3.0, y * 0 + 5.0])  # (n,3)
    data[8:13, 0] = np.nan  # gap only on column 0

    result = await proc.execute(
        _req("fill_gaps", marker_data=data.tolist(), method="linear")
    )
    assert result.status is ComputeStatus.COMPLETED
    filled = np.array(result.results["filled_data"])
    assert np.allclose(filled[:, 0], 2.0 * x + 1.0)
    # Gap info should report a single 5-frame gap on axis 0.
    gaps = result.results["gap_info"]
    assert len(gaps) == 1
    assert gaps[0]["axis"] == 0
    assert gaps[0]["duration"] == 5


# ── center_of_mass ─────────────────────────────────────────────────────


async def test_center_of_mass_identical_segments(proc: BiomechanicsProcessor) -> None:
    # If every segment sits at the same trajectory, COM == that trajectory
    # regardless of mass fractions.
    traj = [[float(i), float(i) * 2, 0.0] for i in range(10)]
    segs = [
        {"name": "seg_a", "marker_positions": traj, "mass_fraction": 0.4},
        {"name": "seg_b", "marker_positions": traj, "mass_fraction": 0.6},
    ]
    result = await proc.execute(_req("center_of_mass", segment_data=segs))
    assert result.status is ComputeStatus.COMPLETED
    com = np.array(result.results["com_trajectory"])
    assert np.allclose(com, np.array(traj))
    # Path length in the horizontal (XZ) plane of this straight-line trajectory
    # equals the total X displacement (Z stays at 0).
    path = result.results["stability_metrics"]["path_length"]
    assert path == pytest.approx(9.0)


async def test_center_of_mass_weights_two_segments(
    proc: BiomechanicsProcessor,
) -> None:
    # Two segments at fixed positions with known mass fractions; expected
    # COM is the weighted average per axis.
    pos_a = [[10.0, 0.0, 0.0], [10.0, 0.0, 0.0]]
    pos_b = [[0.0, 0.0, 0.0], [0.0, 0.0, 0.0]]
    segs = [
        {"name": "sa", "marker_positions": pos_a, "mass_fraction": 0.25},
        {"name": "sb", "marker_positions": pos_b, "mass_fraction": 0.75},
    ]
    result = await proc.execute(_req("center_of_mass", segment_data=segs))
    assert result.status is ComputeStatus.COMPLETED
    com = np.array(result.results["com_trajectory"])
    # Weighted mean of [10,0,0] with 0.25 and [0,0,0] with 0.75 ⇒ 2.5 on X.
    assert com[0, 0] == pytest.approx(2.5)
    assert com[0, 1] == pytest.approx(0.0)


# ── dispatcher error paths ─────────────────────────────────────────────


async def test_unknown_biomech_op_fails(proc: BiomechanicsProcessor) -> None:
    result = await proc.execute(_req("summon_skeleton"))
    assert result.status is ComputeStatus.FAILED
    assert "Unknown biomechanics operation" in (result.error or "")


async def test_filter_markers_missing_params_fails(
    proc: BiomechanicsProcessor,
) -> None:
    # No `markers` key ⇒ KeyError surfaces as FAILED.
    result = await proc.execute(_req("filter_markers", sampling_rate=100.0))
    assert result.status is ComputeStatus.FAILED
