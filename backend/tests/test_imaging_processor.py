"""
Unit tests for app.compute.imaging.processor.ImagingProcessor.

Covers the in-process ops — filtering, contrast enhancement, segmentation,
morphological ops, volumetrics, radiomics, and rigid/translation
registration. The DICOM/NIfTI loaders and the neuroimaging GLM path
need real fixture files and are exercised by integration tests instead.
"""
from __future__ import annotations

from typing import Any

import numpy as np
import pytest

from app.compute.imaging.processor import ImagingProcessor
from app.compute.types import ComputeDomain, ComputeRequest, ComputeStatus


# Optional dependencies — skip the tests that need them when the package
# isn't installed rather than masking real failures with xfail.
def _has(mod: str) -> bool:
    try:
        __import__(mod)
        return True
    except ImportError:
        return False


skimage_required = pytest.mark.skipif(not _has("skimage"), reason="scikit-image not installed")
sklearn_required = pytest.mark.skipif(not _has("sklearn"), reason="scikit-learn not installed")


def _req(op: str, **params: Any) -> ComputeRequest:
    return ComputeRequest(
        domain=ComputeDomain.IMAGING,
        operation=op,
        parameters=params,
    )


@pytest.fixture
def proc() -> ImagingProcessor:
    return ImagingProcessor()


# ── unknown operation ─────────────────────────────────────────────────


async def test_unknown_operation_fails(proc: ImagingProcessor) -> None:
    res = await proc.execute(_req("nope"))
    assert res.status == ComputeStatus.FAILED
    assert res.error is not None and "Unknown operation" in res.error


# ── filter_image ──────────────────────────────────────────────────────


async def test_gaussian_filter_smooths_impulse(proc: ImagingProcessor) -> None:
    # Impulse at center should spread out under a Gaussian — peak
    # shrinks, neighbours gain mass. This is the canonical sanity check.
    img = np.zeros((11, 11))
    img[5, 5] = 1.0
    res = await proc.execute(_req("filter_image", image=img.tolist(), filter_type="gaussian", sigma=1.0))
    assert res.status != ComputeStatus.FAILED
    filtered = np.array(res.results["filtered"])
    assert filtered.shape == (11, 11)
    assert filtered[5, 5] < 1.0  # peak attenuated
    assert filtered[5, 4] > 0 and filtered[4, 5] > 0  # mass spread
    # Conservation: Gaussian doesn't destroy mass.
    assert np.sum(filtered) == pytest.approx(1.0, abs=1e-3)


async def test_median_filter_removes_salt_pepper(proc: ImagingProcessor) -> None:
    # A single salt pixel in a constant field should be wiped by a 3×3 median.
    img = np.zeros((9, 9))
    img[4, 4] = 100.0
    res = await proc.execute(_req("filter_image", image=img.tolist(), filter_type="median", kernel_size=3))
    filtered = np.array(res.results["filtered"])
    assert filtered[4, 4] == 0.0


async def test_filter_rejects_unknown_type(proc: ImagingProcessor) -> None:
    img = np.zeros((4, 4))
    res = await proc.execute(_req("filter_image", image=img.tolist(), filter_type="bogus"))
    assert res.status == ComputeStatus.FAILED
    assert "Unknown filter" in (res.error or "")


# ── enhance_contrast ──────────────────────────────────────────────────


@skimage_required
async def test_clahe_enhances_low_contrast(proc: ImagingProcessor) -> None:
    # Build a gradient with narrow dynamic range; CLAHE should preserve
    # monotonicity but stretch the range.
    img = np.tile(np.linspace(0.4, 0.6, 32), (32, 1))
    res = await proc.execute(_req("enhance_contrast", image=img.tolist(), method="clahe"))
    assert res.status != ComputeStatus.FAILED
    out = np.array(res.results["enhanced"])
    assert out.shape == img.shape


@skimage_required
async def test_histogram_eq_expands_range(proc: ImagingProcessor) -> None:
    img = np.tile(np.linspace(0.45, 0.55, 16), (16, 1))
    res = await proc.execute(_req("enhance_contrast", image=img.tolist(), method="histogram_eq"))
    out = np.array(res.results["enhanced"])
    # After eq the scaled range should span close to the original
    # [min,max] interval; just check we didn't collapse to a constant.
    assert np.ptp(out) > 0


@skimage_required
async def test_enhance_unknown_method_fails(proc: ImagingProcessor) -> None:
    img = np.zeros((4, 4))
    res = await proc.execute(_req("enhance_contrast", image=img.tolist(), method="zzz"))
    assert res.status == ComputeStatus.FAILED


# ── segment ──────────────────────────────────────────────────────────


@skimage_required
async def test_otsu_segments_bimodal_image(proc: ImagingProcessor) -> None:
    # Two clearly separated intensity regions.
    img = np.zeros((20, 20))
    img[:10, :] = 50
    img[10:, :] = 200
    res = await proc.execute(_req("segment", image=img.tolist(), method="otsu"))
    assert res.status != ComputeStatus.FAILED
    mask = np.array(res.results["mask"])
    thresh = res.results["threshold"]
    # Threshold should land between 50 and 200.
    assert 50 < thresh < 200
    # Bottom half is fg, top half is bg.
    assert mask[15, 10] == 1 and mask[5, 10] == 0


@sklearn_required
async def test_kmeans_segments_three_levels(proc: ImagingProcessor) -> None:
    img = np.zeros((30, 30))
    img[:10, :] = 0
    img[10:20, :] = 100
    img[20:, :] = 200
    res = await proc.execute(_req("segment", image=img.tolist(), method="kmeans", n_clusters=3))
    assert res.status != ComputeStatus.FAILED
    assert res.results["n_clusters"] == 3
    assert len(res.results["centers"]) == 3


async def test_region_growing_floods_connected_pixels(proc: ImagingProcessor) -> None:
    img = np.zeros((10, 10))
    img[2:5, 2:5] = 100  # a 3×3 bright square
    res = await proc.execute(_req(
        "segment", image=img.tolist(), method="region_growing",
        seed_point=[3, 3], tolerance=5.0,
    ))
    assert res.status != ComputeStatus.FAILED
    # Should capture exactly the 9 voxels of the square.
    assert res.results["n_pixels"] == 9


async def test_segment_unknown_method_fails(proc: ImagingProcessor) -> None:
    img = np.zeros((4, 4))
    res = await proc.execute(_req("segment", image=img.tolist(), method="bogus"))
    assert res.status == ComputeStatus.FAILED


# ── morphological_ops ────────────────────────────────────────────────


async def test_dilate_grows_mask(proc: ImagingProcessor) -> None:
    mask = np.zeros((7, 7), dtype=bool)
    mask[3, 3] = True
    res = await proc.execute(_req(
        "morphological_ops", mask=mask.tolist(), operation="dilate", iterations=1,
    ))
    assert res.status != ComputeStatus.FAILED
    assert res.results["voxels_before"] == 1
    # With default connectivity-1 structuring element, dilation grows to 5.
    assert res.results["voxels_after"] == 5


async def test_erode_shrinks_mask(proc: ImagingProcessor) -> None:
    mask = np.zeros((9, 9), dtype=bool)
    mask[2:7, 2:7] = True  # 5×5 = 25 voxels
    res = await proc.execute(_req(
        "morphological_ops", mask=mask.tolist(), operation="erode", iterations=1,
    ))
    # Erosion by a plus-shaped SE removes the entire 1-voxel boundary layer.
    assert res.results["voxels_after"] < res.results["voxels_before"]
    assert res.results["voxels_after"] == 9  # the inner 3×3 survives


async def test_morph_unknown_op_fails(proc: ImagingProcessor) -> None:
    mask = np.zeros((4, 4), dtype=bool)
    res = await proc.execute(_req("morphological_ops", mask=mask.tolist(), operation="flip"))
    assert res.status == ComputeStatus.FAILED


# ── measure_volume ───────────────────────────────────────────────────


async def test_measure_volume_counts_voxels(proc: ImagingProcessor) -> None:
    # A unit cube inside a 10³ volume with 1mm voxels → 27 mm³ = 0.027 ml.
    mask = np.zeros((10, 10, 10), dtype=np.int32)
    mask[3:6, 3:6, 3:6] = 1
    res = await proc.execute(_req(
        "measure_volume", mask=mask.tolist(), voxel_spacing=[1.0, 1.0, 1.0],
    ))
    assert res.status != ComputeStatus.FAILED
    assert res.results["n_voxels"] == 27
    assert res.results["volume_mm3"] == pytest.approx(27.0)
    assert res.results["volume_ml"] == pytest.approx(0.027)
    # Centroid of a symmetric cube at [3..5] is [4,4,4].
    assert res.results["centroid"] == [4.0, 4.0, 4.0]


async def test_measure_volume_rejects_2d_mask(proc: ImagingProcessor) -> None:
    mask = np.ones((5, 5), dtype=np.int32)
    res = await proc.execute(_req("measure_volume", mask=mask.tolist()))
    assert res.status == ComputeStatus.FAILED
    assert "3D" in (res.error or "")


# ── extract_radiomics ────────────────────────────────────────────────


async def test_radiomics_first_order_stats(proc: ImagingProcessor) -> None:
    # Uniform ROI: std=0, skew/kurtosis degenerate but computable.
    img = np.full((10, 10), 50.0)
    mask = np.ones_like(img, dtype=bool)
    res = await proc.execute(_req(
        "extract_radiomics", image=img.tolist(), mask=mask.tolist(),
    ))
    assert res.status != ComputeStatus.FAILED
    fo = res.results["first_order"]
    assert fo["mean"] == pytest.approx(50.0)
    assert fo["min"] == 50.0 and fo["max"] == 50.0
    assert fo["std"] == pytest.approx(0.0)
    # Shape section should report the voxel count.
    assert res.results["shape"]["n_voxels"] == 100


async def test_radiomics_empty_roi_fails(proc: ImagingProcessor) -> None:
    img = np.zeros((5, 5))
    mask = np.zeros_like(img, dtype=bool)
    res = await proc.execute(_req(
        "extract_radiomics", image=img.tolist(), mask=mask.tolist(),
    ))
    assert res.status == ComputeStatus.FAILED
    assert "Empty ROI" in (res.error or "")


# ── register_images ──────────────────────────────────────────────────


async def test_translation_registration_recovers_shift(proc: ImagingProcessor) -> None:
    # Build a fixed image, then shift it by a known offset — registration
    # should close most of the gap, not necessarily to zero (phase correlation
    # on discrete grids is integer-accurate only).
    rng = np.random.default_rng(0)
    fixed = np.zeros((32, 32))
    fixed[10:20, 10:20] = rng.random((10, 10))
    moving = np.roll(fixed, shift=(3, 2), axis=(0, 1))
    res = await proc.execute(_req(
        "register_images",
        fixed_image=fixed.tolist(), moving_image=moving.tolist(),
        method="translation",
    ))
    assert res.status != ComputeStatus.FAILED
    assert res.results["mse_after"] <= res.results["mse_before"]
    assert res.results["transform"]["type"] == "translation"


async def test_registration_shape_mismatch_fails(proc: ImagingProcessor) -> None:
    res = await proc.execute(_req(
        "register_images",
        fixed_image=np.zeros((4, 4)).tolist(),
        moving_image=np.zeros((5, 5)).tolist(),
    ))
    assert res.status == ComputeStatus.FAILED
    assert "Shape mismatch" in (res.error or "")
