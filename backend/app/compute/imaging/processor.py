"""
Medical Imaging Processor — DICOM/NIfTI processing, segmentation, volumetrics, radiomics.

Provides MATLAB-equivalent imaging capabilities:
- DICOM/NIfTI loading with full metadata and pixel data extraction
- Spatial filtering (Gaussian, median, bilateral, anisotropic diffusion)
- Contrast enhancement (CLAHE, histogram equalization)
- Segmentation (Otsu, watershed, K-means, region growing, active contour)
- 3D volumetric measurement (volume, surface area, sphericity)
- Morphological operations (erosion, dilation, opening, closing)
- Radiomic feature extraction (first-order, shape, GLCM texture)
- Rigid/affine image registration
"""

from __future__ import annotations

from collections.abc import Callable

import numpy as np
from scipy import ndimage, optimize

from app.compute.types import (
    ComputeDomain,
    ComputeRequest,
    ComputeResult,
    ComputeStatus,
    DescriptiveStats,
    GeneratedFigure,
)


class ImagingProcessor:
    """Medical imaging computation processor."""

    OPERATIONS = [
        "load_dicom", "load_nifti", "filter_image", "enhance_contrast",
        "segment", "measure_volume", "morphological_ops", "extract_radiomics",
        "register_images",
        # Neuroimaging (SPM/FSL equivalent)
        "voxel_glm", "hrf_convolve", "rft_correction",
        "functional_connectivity", "atlas_roi_analysis",
        "ica_decomposition", "dcm", "brain_extraction",
    ]

    def __init__(self) -> None:
        from app.compute.imaging.neuroimaging import NeuroimagingProcessor
        self._neuro = NeuroimagingProcessor()

    def list_operations(self) -> list[str]:
        return self.OPERATIONS

    async def execute(
        self,
        request: ComputeRequest,
        progress_callback: Callable | None = None,
    ) -> ComputeResult:
        op = request.operation
        params = request.parameters

        # Delegate neuroimaging operations
        if op in self._neuro.OPERATIONS:
            return await self._neuro.execute(request, progress_callback)

        dispatch = {
            "load_dicom": self._load_dicom,
            "load_nifti": self._load_nifti,
            "filter_image": self._filter_image,
            "enhance_contrast": self._enhance_contrast,
            "segment": self._segment,
            "measure_volume": self._measure_volume,
            "morphological_ops": self._morphological_ops,
            "extract_radiomics": self._extract_radiomics,
            "register_images": self._register_images,
        }

        handler = dispatch.get(op)
        if handler is None:
            return ComputeResult(
                request_id=request.id, domain=ComputeDomain.IMAGING,
                operation=op, status=ComputeStatus.FAILED,
                error=f"Unknown operation: {op}. Available: {self.OPERATIONS}",
            )

        try:
            return await handler(request, params)
        except Exception as e:
            return ComputeResult(
                request_id=request.id, domain=ComputeDomain.IMAGING,
                operation=op, status=ComputeStatus.FAILED, error=str(e),
            )

    # ── DICOM Loading ────────────────────────────────────────────

    async def _load_dicom(self, req: ComputeRequest, params: dict) -> ComputeResult:
        try:
            import pydicom
        except ImportError:
            return ComputeResult(
                request_id=req.id, domain=ComputeDomain.IMAGING,
                operation="load_dicom", status=ComputeStatus.FAILED,
                error="pydicom not installed. Install with: pip install pydicom",
            )

        file_path = params["file_path"]
        ds = pydicom.dcmread(file_path)

        # Extract pixel data and apply rescale
        pixel_array = ds.pixel_array.astype(np.float64)
        slope = float(getattr(ds, "RescaleSlope", 1))
        intercept = float(getattr(ds, "RescaleIntercept", 0))
        hu_array = pixel_array * slope + intercept

        # Metadata
        metadata = {
            "modality": str(getattr(ds, "Modality", "unknown")),
            "patient_id": str(getattr(ds, "PatientID", "")),
            "study_date": str(getattr(ds, "StudyDate", "")),
            "series_description": str(getattr(ds, "SeriesDescription", "")),
            "body_part": str(getattr(ds, "BodyPartExamined", "")),
            "rows": int(getattr(ds, "Rows", 0)),
            "columns": int(getattr(ds, "Columns", 0)),
            "bits_allocated": int(getattr(ds, "BitsAllocated", 0)),
            "rescale_slope": slope,
            "rescale_intercept": intercept,
        }
        if hasattr(ds, "PixelSpacing"):
            metadata["pixel_spacing"] = [float(x) for x in ds.PixelSpacing]
        if hasattr(ds, "SliceThickness"):
            metadata["slice_thickness"] = float(ds.SliceThickness)

        stats = DescriptiveStats.from_array(hu_array.ravel())

        # Histogram figure
        figures = []
        try:
            import matplotlib
            matplotlib.use("Agg")
            import matplotlib.pyplot as plt

            fig, ax = plt.subplots(figsize=(8, 4))
            ax.hist(hu_array.ravel(), bins=256, color="steelblue", alpha=0.8)
            ax.set_xlabel("Hounsfield Units" if metadata["modality"] == "CT" else "Pixel Value")
            ax.set_ylabel("Count")
            ax.set_title(f"Pixel Distribution — {metadata['modality']}")
            figures.append(GeneratedFigure.from_matplotlib(fig, "pixel_histogram"))
            plt.close(fig)
        except ImportError:
            pass

        return ComputeResult(
            request_id=req.id, domain=ComputeDomain.IMAGING,
            operation="load_dicom",
            results={"metadata": metadata, "shape": list(hu_array.shape)},
            descriptive={"pixel_values": stats},
            figures=figures,
        )

    # ── NIfTI Loading ────────────────────────────────────────────

    async def _load_nifti(self, req: ComputeRequest, params: dict) -> ComputeResult:
        try:
            import nibabel as nib
        except ImportError:
            return ComputeResult(
                request_id=req.id, domain=ComputeDomain.IMAGING,
                operation="load_nifti", status=ComputeStatus.FAILED,
                error="nibabel not installed. Install with: pip install nibabel",
            )

        file_path = params["file_path"]
        img = nib.load(file_path)
        data = np.asarray(img.dataobj, dtype=np.float64)
        header = img.header
        voxel_sizes = header.get_zooms()

        is_4d = len(data.shape) == 4 and data.shape[3] > 1

        metadata = {
            "shape": list(data.shape),
            "voxel_sizes": [float(v) for v in voxel_sizes],
            "is_4d": is_4d,
            "n_timepoints": int(data.shape[3]) if is_4d else 1,
            "affine": img.affine.tolist(),
            "dtype": str(data.dtype),
        }

        stats = DescriptiveStats.from_array(data.ravel()[:1_000_000])

        return ComputeResult(
            request_id=req.id, domain=ComputeDomain.IMAGING,
            operation="load_nifti",
            results={"metadata": metadata},
            descriptive={"voxel_values": stats},
        )

    # ── Spatial Filtering ────────────────────────────────────────

    async def _filter_image(self, req: ComputeRequest, params: dict) -> ComputeResult:
        image = np.array(params["image"], dtype=np.float64)
        filter_type = params.get("filter_type", "gaussian")
        kernel_size = params.get("kernel_size", 3)
        sigma = params.get("sigma", 1.0)

        if filter_type == "gaussian":
            filtered = ndimage.gaussian_filter(image, sigma=sigma)
        elif filter_type == "median":
            filtered = ndimage.median_filter(image, size=int(kernel_size))
        elif filter_type == "bilateral":
            # Approximate bilateral with iterated guided filter
            filtered = self._bilateral_filter(image, sigma_spatial=sigma,
                                               sigma_range=params.get("sigma_range", 0.1))
        elif filter_type == "anisotropic_diffusion":
            filtered = self._anisotropic_diffusion(
                image, niter=params.get("niter", 20),
                kappa=params.get("kappa", 50), gamma=params.get("gamma", 0.1),
            )
        else:
            return ComputeResult(
                request_id=req.id, domain=ComputeDomain.IMAGING,
                operation="filter_image", status=ComputeStatus.FAILED,
                error=f"Unknown filter: {filter_type}",
            )

        return ComputeResult(
            request_id=req.id, domain=ComputeDomain.IMAGING,
            operation="filter_image",
            results={"filtered": filtered.tolist(), "shape": list(filtered.shape)},
            descriptive={"filtered": DescriptiveStats.from_array(filtered.ravel())},
        )

    def _bilateral_filter(self, image: np.ndarray, sigma_spatial: float,
                           sigma_range: float, radius: int = 3) -> np.ndarray:
        """Bilateral filter approximation."""
        filtered = np.zeros_like(image)
        padded = np.pad(image, radius, mode="reflect")
        for dy in range(-radius, radius + 1):
            for dx in range(-radius, radius + 1):
                spatial_w = np.exp(-(dx**2 + dy**2) / (2 * sigma_spatial**2))
                shifted = padded[radius+dy:radius+dy+image.shape[0],
                                  radius+dx:radius+dx+image.shape[-1]] if image.ndim == 2 else padded[radius+dy:radius+dy+image.shape[0]]
                range_w = np.exp(-((image - shifted)**2) / (2 * sigma_range**2))
                w = spatial_w * range_w
                filtered += w * shifted
        # Normalize
        return filtered / (filtered.sum() / image.sum()) if image.sum() != 0 else filtered

    def _anisotropic_diffusion(self, image: np.ndarray, niter: int = 20,
                                kappa: float = 50, gamma: float = 0.1) -> np.ndarray:
        """Perona-Malik anisotropic diffusion."""
        img = image.astype(np.float64).copy()
        for _ in range(niter):
            # Compute gradients
            deltaN = np.zeros_like(img)
            deltaS = np.zeros_like(img)
            deltaE = np.zeros_like(img)
            deltaW = np.zeros_like(img)

            deltaN[1:, ...] = img[:-1, ...] - img[1:, ...]
            deltaS[:-1, ...] = img[1:, ...] - img[:-1, ...]
            if img.ndim >= 2:
                deltaE[:, 1:] = img[:, :-1] - img[:, 1:]
                deltaW[:, :-1] = img[:, 1:] - img[:, :-1]

            # Conduction coefficients
            cN = np.exp(-(deltaN / kappa)**2)
            cS = np.exp(-(deltaS / kappa)**2)
            cE = np.exp(-(deltaE / kappa)**2)
            cW = np.exp(-(deltaW / kappa)**2)

            img += gamma * (cN * deltaN + cS * deltaS + cE * deltaE + cW * deltaW)

        return img

    # ── Contrast Enhancement ─────────────────────────────────────

    async def _enhance_contrast(self, req: ComputeRequest, params: dict) -> ComputeResult:
        image = np.array(params["image"], dtype=np.float64)
        method = params.get("method", "clahe")

        try:
            from skimage import exposure
        except ImportError:
            return ComputeResult(
                request_id=req.id, domain=ComputeDomain.IMAGING,
                operation="enhance_contrast", status=ComputeStatus.FAILED,
                error="scikit-image not installed",
            )

        # Normalize to 0-1 for skimage
        vmin, vmax = image.min(), image.max()
        if vmax - vmin > 0:
            norm_image = (image - vmin) / (vmax - vmin)
        else:
            norm_image = image.copy()

        if method == "clahe":
            clip_limit = params.get("clip_limit", 0.03)
            enhanced = exposure.equalize_adapthist(norm_image, clip_limit=clip_limit)
        elif method == "histogram_eq":
            enhanced = exposure.equalize_hist(norm_image)
        elif method == "rescale_intensity":
            p_low = params.get("percentile_low", 2)
            p_high = params.get("percentile_high", 98)
            p2, p98 = np.percentile(norm_image, (p_low, p_high))
            enhanced = exposure.rescale_intensity(norm_image, in_range=(p2, p98))
        else:
            return ComputeResult(
                request_id=req.id, domain=ComputeDomain.IMAGING,
                operation="enhance_contrast", status=ComputeStatus.FAILED,
                error=f"Unknown method: {method}",
            )

        # Scale back to original range
        enhanced = enhanced * (vmax - vmin) + vmin

        return ComputeResult(
            request_id=req.id, domain=ComputeDomain.IMAGING,
            operation="enhance_contrast",
            results={"enhanced": enhanced.tolist(), "method": method},
            descriptive={"enhanced": DescriptiveStats.from_array(enhanced.ravel())},
        )

    # ── Segmentation ─────────────────────────────────────────────

    async def _segment(self, req: ComputeRequest, params: dict) -> ComputeResult:
        image = np.array(params["image"], dtype=np.float64)
        method = params.get("method", "otsu")
        figures = []

        if method == "otsu":
            from skimage.filters import threshold_otsu
            thresh = threshold_otsu(image)
            mask = (image > thresh).astype(np.int32)
            results = {"mask": mask.tolist(), "threshold": float(thresh)}

        elif method == "kmeans":
            from sklearn.cluster import KMeans
            n_clusters = params.get("n_clusters", 3)
            flat = image.ravel().reshape(-1, 1)
            km = KMeans(n_clusters=n_clusters, n_init=10, random_state=42)
            labels = km.fit_predict(flat).reshape(image.shape)
            results = {
                "mask": labels.tolist(),
                "centers": km.cluster_centers_.ravel().tolist(),
                "n_clusters": n_clusters,
            }

        elif method == "watershed":
            from skimage.feature import peak_local_max
            from skimage.segmentation import watershed
            distance = ndimage.distance_transform_edt(image > image.mean())
            coords = peak_local_max(distance, min_distance=params.get("min_distance", 10))
            mask_markers = np.zeros(distance.shape, dtype=bool)
            mask_markers[tuple(coords.T)] = True
            markers, _ = ndimage.label(mask_markers)
            labels = watershed(-distance, markers, mask=image > image.mean())
            results = {"mask": labels.tolist(), "n_segments": int(labels.max())}

        elif method == "region_growing":
            seed = tuple(params.get("seed_point", [image.shape[0]//2, image.shape[1]//2]))
            tolerance = params.get("tolerance", 10.0)
            mask = self._region_grow(image, seed, tolerance)
            results = {"mask": mask.tolist(), "seed": list(seed), "n_pixels": int(mask.sum())}

        elif method == "active_contour":
            from skimage.segmentation import active_contour
            # Create initial contour (circle centered on image)
            s = np.linspace(0, 2 * np.pi, 400)
            cy, cx = image.shape[0] / 2, image.shape[1] / 2
            r = min(image.shape) * 0.4
            init = np.array([cy + r * np.sin(s), cx + r * np.cos(s)]).T
            snake = active_contour(
                ndimage.gaussian_filter(image, 3), init,
                alpha=params.get("alpha", 0.015),
                beta=params.get("beta", 10),
                gamma=params.get("gamma", 0.001),
            )
            results = {"contour": snake.tolist(), "n_points": len(snake)}

        else:
            return ComputeResult(
                request_id=req.id, domain=ComputeDomain.IMAGING,
                operation="segment", status=ComputeStatus.FAILED,
                error=f"Unknown method: {method}. Use: otsu, kmeans, watershed, region_growing, active_contour",
            )

        return ComputeResult(
            request_id=req.id, domain=ComputeDomain.IMAGING,
            operation="segment", results=results, figures=figures,
        )

    def _region_grow(self, image: np.ndarray, seed: tuple, tolerance: float) -> np.ndarray:
        """Flood-fill region growing from seed point."""
        mask = np.zeros(image.shape, dtype=np.int32)
        seed_val = image[seed]
        visited = set()
        queue = [seed]

        while queue:
            point = queue.pop(0)
            if point in visited:
                continue
            visited.add(point)

            if abs(float(image[point]) - float(seed_val)) <= tolerance:
                mask[point] = 1
                for dy, dx in [(-1,0),(1,0),(0,-1),(0,1)]:
                    ny, nx = point[0]+dy, point[1]+dx
                    if 0 <= ny < image.shape[0] and 0 <= nx < image.shape[1]:
                        if (ny, nx) not in visited:
                            queue.append((ny, nx))
        return mask

    # ── Volume Measurement ───────────────────────────────────────

    async def _measure_volume(self, req: ComputeRequest, params: dict) -> ComputeResult:
        mask = np.array(params["mask"], dtype=np.int32)
        voxel_spacing = params.get("voxel_spacing", [1.0, 1.0, 1.0])

        if mask.ndim != 3:
            return ComputeResult(
                request_id=req.id, domain=ComputeDomain.IMAGING,
                operation="measure_volume", status=ComputeStatus.FAILED,
                error="Mask must be 3D for volumetric measurement",
            )

        voxel_volume_mm3 = float(np.prod(voxel_spacing))
        n_voxels = int(np.sum(mask > 0))
        volume_mm3 = n_voxels * voxel_volume_mm3
        volume_ml = volume_mm3 / 1000.0

        # Bounding box
        nonzero = np.argwhere(mask > 0)
        bb_min = nonzero.min(axis=0).tolist()
        bb_max = nonzero.max(axis=0).tolist()

        # Centroid
        centroid = nonzero.mean(axis=0).tolist()

        # Surface area via marching cubes
        surface_area_mm2 = 0.0
        sphericity = 0.0
        try:
            from skimage.measure import marching_cubes
            verts, faces, _, _ = marching_cubes(mask.astype(float), level=0.5, spacing=voxel_spacing)
            # Surface area from triangle mesh
            v0 = verts[faces[:, 0]]
            v1 = verts[faces[:, 1]]
            v2 = verts[faces[:, 2]]
            cross = np.cross(v1 - v0, v2 - v0)
            surface_area_mm2 = float(0.5 * np.sum(np.linalg.norm(cross, axis=1)))

            if surface_area_mm2 > 0:
                sphericity = float(
                    (np.pi ** (1/3) * (6 * volume_mm3) ** (2/3)) / surface_area_mm2
                )
        except Exception:
            pass

        return ComputeResult(
            request_id=req.id, domain=ComputeDomain.IMAGING,
            operation="measure_volume",
            results={
                "n_voxels": n_voxels,
                "volume_mm3": round(volume_mm3, 3),
                "volume_ml": round(volume_ml, 4),
                "surface_area_mm2": round(surface_area_mm2, 3),
                "sphericity": round(sphericity, 4),
                "bounding_box_min": bb_min,
                "bounding_box_max": bb_max,
                "centroid": [round(c, 2) for c in centroid],
                "voxel_spacing_mm": voxel_spacing,
            },
        )

    # ── Morphological Operations ─────────────────────────────────

    async def _morphological_ops(self, req: ComputeRequest, params: dict) -> ComputeResult:
        mask = np.array(params["mask"], dtype=bool)
        operation = params.get("operation", "dilate")
        iterations = params.get("iterations", 1)
        struct_size = params.get("structure_size", 3)
        structure = ndimage.generate_binary_structure(mask.ndim, 1)
        if struct_size > 3:
            structure = ndimage.iterate_structure(structure, struct_size // 2)

        ops = {
            "erode": ndimage.binary_erosion,
            "dilate": ndimage.binary_dilation,
            "open": ndimage.binary_opening,
            "close": ndimage.binary_closing,
        }

        func = ops.get(operation)
        if func is None:
            return ComputeResult(
                request_id=req.id, domain=ComputeDomain.IMAGING,
                operation="morphological_ops", status=ComputeStatus.FAILED,
                error=f"Unknown operation: {operation}. Use: erode, dilate, open, close",
            )

        result_mask = func(mask, structure=structure, iterations=iterations)

        return ComputeResult(
            request_id=req.id, domain=ComputeDomain.IMAGING,
            operation="morphological_ops",
            results={
                "mask": result_mask.astype(int).tolist(),
                "operation": operation,
                "voxels_before": int(mask.sum()),
                "voxels_after": int(result_mask.sum()),
            },
        )

    # ── Radiomic Feature Extraction ──────────────────────────────

    async def _extract_radiomics(self, req: ComputeRequest, params: dict) -> ComputeResult:
        image = np.array(params["image"], dtype=np.float64)
        mask = np.array(params.get("mask", np.ones_like(image)), dtype=bool)
        roi = image[mask]

        if len(roi) == 0:
            return ComputeResult(
                request_id=req.id, domain=ComputeDomain.IMAGING,
                operation="extract_radiomics", status=ComputeStatus.FAILED,
                error="Empty ROI — mask selects no voxels",
            )

        from scipy.stats import entropy as sp_entropy
        from scipy.stats import kurtosis, skew

        # First-order statistics
        first_order = {
            "mean": float(np.mean(roi)),
            "std": float(np.std(roi)),
            "median": float(np.median(roi)),
            "min": float(np.min(roi)),
            "max": float(np.max(roi)),
            "skewness": float(skew(roi)),
            "kurtosis": float(kurtosis(roi)),
            "energy": float(np.sum(roi ** 2)),
            "entropy": float(sp_entropy(np.histogram(roi, bins=64)[0] + 1e-10)),
            "range": float(np.ptp(roi)),
            "variance": float(np.var(roi)),
            "coefficient_of_variation": float(np.std(roi) / (np.abs(np.mean(roi)) + 1e-10)),
            "uniformity": float(np.sum(np.histogram(roi, bins=64, density=True)[0] ** 2)),
        }

        # Shape features (3D)
        shape_features = {"n_voxels": int(mask.sum())}
        if mask.ndim == 3:
            voxel_spacing = params.get("voxel_spacing", [1.0, 1.0, 1.0])
            shape_features["volume_mm3"] = float(mask.sum() * np.prod(voxel_spacing))
            try:
                from skimage.measure import marching_cubes
                verts, faces, _, _ = marching_cubes(mask.astype(float), level=0.5, spacing=voxel_spacing)
                v0, v1, v2 = verts[faces[:, 0]], verts[faces[:, 1]], verts[faces[:, 2]]
                sa = float(0.5 * np.sum(np.linalg.norm(np.cross(v1-v0, v2-v0), axis=1)))
                shape_features["surface_area_mm2"] = sa
                vol = shape_features["volume_mm3"]
                if sa > 0:
                    shape_features["sphericity"] = float((np.pi**(1/3) * (6*vol)**(2/3)) / sa)
                    shape_features["compactness"] = float(vol / (sa ** 1.5))
            except Exception:
                pass

        # GLCM texture features (2D slices)
        texture = {}
        try:
            from skimage.feature import graycomatrix, graycoprops

            # Use central slice if 3D
            if image.ndim == 3:
                slice_idx = image.shape[0] // 2
                img_slice = image[slice_idx].copy()
                mask_slice = mask[slice_idx]
            else:
                img_slice = image.copy()
                mask_slice = mask

            # Quantize to 64 levels
            vmin, vmax = img_slice[mask_slice].min(), img_slice[mask_slice].max()
            if vmax > vmin:
                quantized = ((img_slice - vmin) / (vmax - vmin) * 63).astype(np.uint8)
            else:
                quantized = np.zeros_like(img_slice, dtype=np.uint8)
            quantized[~mask_slice] = 0

            glcm = graycomatrix(quantized, distances=[1], angles=[0, np.pi/4, np.pi/2, 3*np.pi/4], levels=64)

            for prop in ["contrast", "correlation", "energy", "homogeneity", "dissimilarity"]:
                vals = graycoprops(glcm, prop)
                texture[f"glcm_{prop}"] = float(np.mean(vals))
        except Exception:
            pass

        return ComputeResult(
            request_id=req.id, domain=ComputeDomain.IMAGING,
            operation="extract_radiomics",
            results={
                "first_order": first_order,
                "shape": shape_features,
                "texture": texture,
            },
        )

    # ── Image Registration ───────────────────────────────────────

    async def _register_images(self, req: ComputeRequest, params: dict) -> ComputeResult:
        fixed = np.array(params["fixed_image"], dtype=np.float64)
        moving = np.array(params["moving_image"], dtype=np.float64)
        method = params.get("method", "rigid")

        if fixed.shape != moving.shape:
            return ComputeResult(
                request_id=req.id, domain=ComputeDomain.IMAGING,
                operation="register_images", status=ComputeStatus.FAILED,
                error=f"Shape mismatch: fixed {fixed.shape} vs moving {moving.shape}",
            )

        # Normalize both
        for arr in [fixed, moving]:
            mn, mx = arr.min(), arr.max()
            if mx > mn:
                arr[:] = (arr - mn) / (mx - mn)

        ndim = fixed.ndim

        if method == "translation":
            # Phase correlation for translation
            from scipy.fft import fftn, ifftn
            f_fixed = fftn(fixed)
            f_moving = fftn(moving)
            cross_power = (f_fixed * np.conj(f_moving)) / (np.abs(f_fixed * np.conj(f_moving)) + 1e-10)
            shift_map = np.abs(ifftn(cross_power))
            shift_idx = np.unravel_index(np.argmax(shift_map), shift_map.shape)
            shift = [int(s) if s < fixed.shape[i]//2 else int(s - fixed.shape[i]) for i, s in enumerate(shift_idx)]
            registered = ndimage.shift(moving, shift)
            transform = {"type": "translation", "shift": shift}

        elif method in ("rigid", "affine"):
            # Simplified: use translation + optional rotation via optimization
            def cost(params_vec):
                if method == "rigid" and ndim == 2:
                    tx, ty, angle = params_vec
                    c, s = np.cos(angle), np.sin(angle)
                    matrix = np.array([[c, -s], [s, c]])
                    offset = np.array([tx, ty])
                elif method == "affine" and ndim == 2:
                    matrix = params_vec[:4].reshape(2, 2)
                    offset = params_vec[4:6]
                else:
                    tx, ty, tz, ax, ay, az = params_vec[:6] if ndim == 3 else (*params_vec[:2], 0, *params_vec[2:4], 0)
                    matrix = np.eye(ndim)
                    offset = params_vec[:ndim]
                    return float(np.sum((fixed - ndimage.shift(moving, offset))**2))

                warped = ndimage.affine_transform(moving, matrix, offset=offset, order=1)
                return float(np.sum((fixed - warped)**2))

            if method == "rigid" and ndim == 2:
                x0 = [0.0, 0.0, 0.0]
            elif method == "affine" and ndim == 2:
                x0 = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0]
            else:
                x0 = [0.0] * ndim

            result = optimize.minimize(cost, x0, method="Powell", options={"maxiter": 200})

            if method == "rigid" and ndim == 2:
                tx, ty, angle = result.x
                c, s = np.cos(angle), np.sin(angle)
                matrix = np.array([[c, -s], [s, c]])
                offset = np.array([tx, ty])
                registered = ndimage.affine_transform(moving, matrix, offset=offset, order=1)
                transform = {"type": "rigid", "translation": [tx, ty], "rotation_rad": float(angle)}
            elif method == "affine" and ndim == 2:
                matrix = result.x[:4].reshape(2, 2)
                offset = result.x[4:6]
                registered = ndimage.affine_transform(moving, matrix, offset=offset, order=1)
                transform = {"type": "affine", "matrix": matrix.tolist(), "offset": offset.tolist()}
            else:
                offset = result.x[:ndim]
                registered = ndimage.shift(moving, offset)
                transform = {"type": method, "offset": offset.tolist()}
        else:
            return ComputeResult(
                request_id=req.id, domain=ComputeDomain.IMAGING,
                operation="register_images", status=ComputeStatus.FAILED,
                error=f"Unknown method: {method}",
            )

        # Compute similarity after registration
        mse_before = float(np.mean((fixed - moving)**2))
        mse_after = float(np.mean((fixed - registered)**2))

        return ComputeResult(
            request_id=req.id, domain=ComputeDomain.IMAGING,
            operation="register_images",
            results={
                "registered": registered.tolist(),
                "transform": transform,
                "mse_before": round(mse_before, 6),
                "mse_after": round(mse_after, 6),
                "improvement_pct": round((1 - mse_after / max(mse_before, 1e-10)) * 100, 2),
            },
        )
