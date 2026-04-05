"""
Biomechanics computation processor.

Provides motion capture parsing (C3D, TRC), marker filtering, gap filling,
joint angle computation, inverse dynamics, gait analysis, center of mass,
and ground reaction force processing.
"""

from __future__ import annotations

import io
import struct
import warnings
from collections.abc import Callable
from pathlib import Path
from typing import Any

import numpy as np

from app.compute.types import (
    ComputeDomain,
    ComputeRequest,
    ComputeResult,
    ComputeStatus,
    DescriptiveStats,
    FigureFormat,
    GeneratedFigure,
    StatisticalTest,
)

# ---------------------------------------------------------------------------
# De Leva (1996) default segment mass fractions
# ---------------------------------------------------------------------------
_DE_LEVA_MASS_FRACTIONS: dict[str, float] = {
    "head": 0.0694,
    "trunk": 0.4346,
    "upper_arm": 0.0271,
    "forearm": 0.0162,
    "hand": 0.0061,
    "thigh": 0.1416,
    "shank": 0.0433,
    "foot": 0.0137,
}

_GRAVITY = np.array([0.0, -9.81, 0.0])

_OPERATIONS = [
    "load_c3d",
    "load_trc",
    "filter_markers",
    "fill_gaps",
    "joint_angles",
    "joint_kinematics",
    "inverse_dynamics",
    "gait_analysis",
    "center_of_mass",
    "ground_reaction_forces",
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _to_array(data: Any) -> np.ndarray:
    """Convert nested lists / mixed None values to a float ndarray with NaN for gaps."""
    if isinstance(data, np.ndarray):
        return data.astype(float)
    arr = np.array(data, dtype=float)
    return arr


def _has_matplotlib() -> bool:
    try:
        import matplotlib  # noqa: F401
        return True
    except ImportError:
        return False


def _make_figure(plot_fn: Callable, title: str) -> GeneratedFigure | None:
    """Create a GeneratedFigure by calling *plot_fn(fig, ax)*."""
    if not _has_matplotlib():
        return None
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    fig, ax = plt.subplots(figsize=(8, 4))
    plot_fn(fig, ax)
    gen = GeneratedFigure.from_matplotlib(fig, title, FigureFormat.PNG)
    plt.close(fig)
    return gen


def _safe_tolist(arr: np.ndarray) -> list:
    """Recursively convert ndarray to nested Python list with None for NaN."""
    if arr.ndim == 1:
        return [None if np.isnan(v) else float(v) for v in arr]
    return [_safe_tolist(row) for row in arr]


# ---------------------------------------------------------------------------
# C3D binary parsing helpers
# ---------------------------------------------------------------------------

def _parse_c3d_binary(raw: bytes) -> dict[str, Any]:
    """Manually parse a C3D binary file when the ``c3d`` package is unavailable."""

    if len(raw) < 512:
        raise ValueError("File too small to be a valid C3D file")

    param_block_ptr = raw[0]
    magic = raw[1]
    if magic != 0x50:
        raise ValueError(f"Invalid C3D magic byte: expected 0x50, got 0x{magic:02X}")

    # --- Parameter section ---------------------------------------------------
    param_offset = (param_block_ptr - 1) * 512
    if param_offset + 4 > len(raw):
        raise ValueError("Parameter section offset out of range")

    # First 4 bytes of param section: reserved(1), reserved(1), n_param_blocks(1), processor_type(1)
    n_param_blocks = raw[param_offset + 2]
    processor_type = raw[param_offset + 3]  # 1=Intel, 2=DEC, 3=SGI

    # Parse groups and parameters
    groups: dict[int, str] = {}
    params: dict[str, Any] = {}
    pos = param_offset + 4

    while pos < param_offset + n_param_blocks * 512:
        if pos + 2 > len(raw):
            break
        name_len = struct.unpack_from("b", raw, pos)[0]
        group_id = struct.unpack_from("b", raw, pos + 1)[0]

        if name_len == 0 and group_id == 0:
            break

        abs_name_len = abs(name_len)
        if pos + 2 + abs_name_len > len(raw):
            break

        name = raw[pos + 2 : pos + 2 + abs_name_len].decode("ascii", errors="replace").strip()
        offset_next = struct.unpack_from("<h", raw, pos + 2 + abs_name_len)[0]

        if group_id < 0:
            # This is a group entry
            gid = -group_id
            groups[gid] = name.upper()
            next_pos = pos + 2 + abs_name_len + 2
            # skip description
            if next_pos < len(raw):
                desc_len = raw[next_pos]
                next_pos += 1 + desc_len
            pos = pos + offset_next + 2 + abs_name_len if offset_next != 0 else next_pos
        else:
            # This is a parameter entry
            base = pos + 2 + abs_name_len + 2
            if base + 3 <= len(raw):
                data_type = struct.unpack_from("b", raw, base)[0]
                n_dims = raw[base + 1]
                dim_start = base + 2
                dims = []
                for d in range(n_dims):
                    if dim_start + d < len(raw):
                        dims.append(raw[dim_start + d])

                data_start = dim_start + n_dims
                group_name = groups.get(group_id, f"GROUP{group_id}")
                full_name = f"{group_name}:{name.upper()}"

                total_elems = 1
                for d in dims:
                    total_elems *= d

                if data_type == -1 and data_start + total_elems <= len(raw):
                    # Character data
                    val = raw[data_start : data_start + total_elems].decode("ascii", errors="replace")
                    params[full_name] = val
                elif data_type == 1 and data_start + total_elems <= len(raw):
                    # Byte data
                    params[full_name] = list(raw[data_start : data_start + total_elems])
                elif data_type == 2 and data_start + 2 * total_elems <= len(raw):
                    # 16-bit int
                    vals = struct.unpack_from(f"<{total_elems}h", raw, data_start)
                    params[full_name] = vals[0] if total_elems == 1 else list(vals)
                elif data_type == 4 and data_start + 4 * total_elems <= len(raw):
                    # 32-bit float
                    vals = struct.unpack_from(f"<{total_elems}f", raw, data_start)
                    params[full_name] = vals[0] if total_elems == 1 else list(vals)

            if offset_next == 0:
                break
            pos = pos + offset_next + 2 + abs_name_len
        if offset_next == 0:
            break

    # Extract key parameters with safe defaults
    n_points = params.get("POINT:USED", 0)
    frame_rate = params.get("POINT:RATE", 100.0)
    n_frames_param = params.get("POINT:FRAMES", 0)
    scale = params.get("POINT:SCALE", -1.0)

    # Marker labels
    labels_raw = params.get("POINT:LABELS", "")
    if isinstance(labels_raw, str):
        # Labels are stored as a fixed-width character array
        label_width = 4
        if n_points > 0 and len(labels_raw) >= n_points:
            label_width = max(4, len(labels_raw) // n_points)
        marker_names = [
            labels_raw[i * label_width : (i + 1) * label_width].strip()
            for i in range(n_points)
        ]
    else:
        marker_names = [f"Marker{i}" for i in range(n_points)]

    marker_names = [m for m in marker_names if m]
    n_points = len(marker_names)

    # --- Data section --------------------------------------------------------
    data_block_start = params.get("POINT:DATA_START", param_block_ptr + n_param_blocks)
    if isinstance(data_block_start, (list, tuple)):
        data_block_start = data_block_start[0]
    data_offset = (int(data_block_start) - 1) * 512

    use_float = scale < 0
    point_size = 4 if use_float else 2  # bytes per coordinate value
    frame_size = n_points * 4 * point_size + n_points * point_size  # 4 words per point (x,y,z,residual)

    # Read available frames
    available_bytes = len(raw) - data_offset
    if frame_size > 0:
        n_frames = min(n_frames_param, available_bytes // (n_points * 4 * point_size)) if n_points > 0 else 0
    else:
        n_frames = 0

    marker_positions: dict[str, list[list[float]]] = {name: [] for name in marker_names}
    pos = data_offset

    for frame_idx in range(n_frames):
        for m_idx, m_name in enumerate(marker_names):
            if use_float and pos + 16 <= len(raw):
                x, y, z, res = struct.unpack_from("<4f", raw, pos)
                pos += 16
            elif not use_float and pos + 8 <= len(raw):
                xi, yi, zi, resi = struct.unpack_from("<4h", raw, pos)
                s = abs(scale)
                x, y, z = xi * s, yi * s, zi * s
                pos += 8
            else:
                x, y, z = float("nan"), float("nan"), float("nan")
                pos += 16 if use_float else 8

            marker_positions[m_name].append([float(x), float(y), float(z)])

    duration = n_frames / frame_rate if frame_rate > 0 else 0.0

    return {
        "marker_names": marker_names,
        "n_frames": n_frames,
        "frame_rate": float(frame_rate),
        "marker_positions": marker_positions,
        "analog_channels": [],
        "duration_seconds": float(duration),
    }


# ---------------------------------------------------------------------------
# Processor class
# ---------------------------------------------------------------------------

class BiomechanicsProcessor:
    """Domain processor for biomechanics computations."""

    # ── public interface ────────────────────────────────────────────

    @staticmethod
    def list_operations() -> list[str]:
        return list(_OPERATIONS)

    async def execute(
        self,
        request: ComputeRequest,
        progress_callback: Callable[[int, int], None] | None = None,
    ) -> ComputeResult:
        op = request.operation
        params = {**request.parameters, **(request.data or {})}

        dispatch = {
            "load_c3d": self._load_c3d,
            "load_trc": self._load_trc,
            "filter_markers": self._filter_markers,
            "fill_gaps": self._fill_gaps,
            "joint_angles": self._joint_angles,
            "joint_kinematics": self._joint_kinematics,
            "inverse_dynamics": self._inverse_dynamics,
            "gait_analysis": self._gait_analysis,
            "center_of_mass": self._center_of_mass,
            "ground_reaction_forces": self._ground_reaction_forces,
        }

        handler = dispatch.get(op)
        if handler is None:
            return ComputeResult(
                request_id=request.id,
                domain=ComputeDomain.BIOMECHANICS,
                operation=op,
                status=ComputeStatus.FAILED,
                error=f"Unknown biomechanics operation: {op}. Available: {_OPERATIONS}",
            )

        try:
            return await handler(request, params, progress_callback)
        except Exception as exc:
            return ComputeResult(
                request_id=request.id,
                domain=ComputeDomain.BIOMECHANICS,
                operation=op,
                status=ComputeStatus.FAILED,
                error=str(exc),
            )

    # ── 1. load_c3d ────────────────────────────────────────────────

    async def _load_c3d(
        self,
        request: ComputeRequest,
        params: dict[str, Any],
        progress_callback: Callable | None,
    ) -> ComputeResult:
        file_path = params["file_path"]
        raw = Path(file_path).read_bytes()

        # Try the c3d Python package first
        try:
            import c3d

            reader = c3d.Reader(io.BytesIO(raw))
            marker_names = [label.strip() for label in reader.point_labels]
            frame_rate = reader.point_rate
            marker_positions: dict[str, list[list[float]]] = {n: [] for n in marker_names}
            n_frames = 0

            for i, points, analog in reader.read_frames():
                n_frames += 1
                for idx, name in enumerate(marker_names):
                    if idx < points.shape[0]:
                        marker_positions[name].append(
                            [float(points[idx, 0]), float(points[idx, 1]), float(points[idx, 2])]
                        )

            analog_channels = [ch.strip() for ch in reader.analog_labels] if hasattr(reader, "analog_labels") else []
            duration = n_frames / frame_rate if frame_rate > 0 else 0.0

            result_data = {
                "marker_names": marker_names,
                "n_frames": n_frames,
                "frame_rate": float(frame_rate),
                "marker_positions": marker_positions,
                "analog_channels": analog_channels,
                "duration_seconds": float(duration),
            }

        except ImportError:
            result_data = _parse_c3d_binary(raw)

        return ComputeResult(
            request_id=request.id,
            domain=ComputeDomain.BIOMECHANICS,
            operation="load_c3d",
            status=ComputeStatus.COMPLETED,
            results=result_data,
        )

    # ── 2. load_trc ────────────────────────────────────────────────

    async def _load_trc(
        self,
        request: ComputeRequest,
        params: dict[str, Any],
        progress_callback: Callable | None,
    ) -> ComputeResult:
        if "content" in params:
            text = params["content"]
        else:
            text = Path(params["file_path"]).read_text()

        lines = text.strip().splitlines()
        if len(lines) < 6:
            raise ValueError("TRC file must have at least 6 header/data lines")

        # Line 1: PathFileType declaration
        # Line 2: key names  (DataRate  CameraRate  NumFrames  NumMarkers  Units ...)
        # Line 3: key values
        # Line 4: marker names row  (Frame#  Time  marker1  ...  )
        # Line 5: axis labels       (        X1 Y1 Z1 X2 Y2 Z2 ...)
        # Line 6+: data

        header_keys = lines[1].split("\t")
        header_vals = lines[2].split("\t")
        header = dict(zip(header_keys, header_vals))

        data_rate = float(header.get("DataRate", header.get("data_rate", "100")))
        num_frames = int(header.get("NumFrames", header.get("num_frames", "0")))
        num_markers = int(header.get("NumMarkers", header.get("num_markers", "0")))
        units = header.get("Units", header.get("units", "mm"))

        marker_row = lines[3].split("\t")
        # First two columns are Frame# and Time
        marker_names = [m.strip() for m in marker_row[2:] if m.strip()]
        # TRC often repeats marker name 3 times (for x, y, z) or lists once
        # Deduplicate by taking every unique name in order
        seen: set[str] = set()
        unique_markers: list[str] = []
        for m in marker_names:
            if m not in seen:
                seen.add(m)
                unique_markers.append(m)
        marker_names = unique_markers[:num_markers] if num_markers > 0 else unique_markers

        marker_positions: dict[str, list[list[float]]] = {n: [] for n in marker_names}
        actual_frames = 0

        for line in lines[5:]:  # skip axis-label row (line 4, index 4)
            cols = line.split("\t")
            if len(cols) < 3:
                continue
            actual_frames += 1
            # Data columns after Frame# and Time come in triplets (x, y, z)
            for idx, name in enumerate(marker_names):
                base = 2 + idx * 3
                try:
                    x = float(cols[base]) if cols[base].strip() else float("nan")
                    y = float(cols[base + 1]) if cols[base + 1].strip() else float("nan")
                    z = float(cols[base + 2]) if cols[base + 2].strip() else float("nan")
                except (IndexError, ValueError):
                    x, y, z = float("nan"), float("nan"), float("nan")
                marker_positions[name].append([x, y, z])

        n_frames = actual_frames or num_frames
        duration = n_frames / data_rate if data_rate > 0 else 0.0

        return ComputeResult(
            request_id=request.id,
            domain=ComputeDomain.BIOMECHANICS,
            operation="load_trc",
            status=ComputeStatus.COMPLETED,
            results={
                "marker_names": marker_names,
                "n_frames": n_frames,
                "frame_rate": float(data_rate),
                "marker_positions": {k: v for k, v in marker_positions.items()},
                "analog_channels": [],
                "duration_seconds": float(duration),
                "units": units,
            },
        )

    # ── 3. filter_markers ──────────────────────────────────────────

    async def _filter_markers(
        self,
        request: ComputeRequest,
        params: dict[str, Any],
        progress_callback: Callable | None,
    ) -> ComputeResult:
        from scipy.signal import butter, filtfilt

        markers_raw = params["markers"]
        sampling_rate = float(params["sampling_rate"])
        cutoff_freq = float(params.get("cutoff_freq", 6.0))
        order = int(params.get("order", 4))

        nyquist = sampling_rate / 2.0
        if cutoff_freq >= nyquist:
            raise ValueError(
                f"Cutoff frequency ({cutoff_freq} Hz) must be less than Nyquist ({nyquist} Hz)"
            )

        b, a = butter(order, cutoff_freq / nyquist, btype="low")

        filtered_markers: dict[str, list[list[float]]] = {}
        warn_list: list[str] = []

        for name, trajectory in markers_raw.items():
            arr = _to_array(trajectory)  # (n_frames, 3)
            if arr.ndim != 2 or arr.shape[1] != 3:
                warn_list.append(f"Marker '{name}': unexpected shape {arr.shape}, skipping")
                filtered_markers[name] = _safe_tolist(arr)
                continue

            filtered = np.empty_like(arr)
            for axis in range(3):
                col = arr[:, axis].copy()
                nan_mask = np.isnan(col)

                if nan_mask.all():
                    filtered[:, axis] = col
                    continue

                # Interpolate over NaN gaps for filtering
                if nan_mask.any():
                    valid_idx = np.where(~nan_mask)[0]
                    col[nan_mask] = np.interp(
                        np.where(nan_mask)[0], valid_idx, col[valid_idx]
                    )

                # Apply zero-phase Butterworth filter
                if len(col) > 3 * max(len(a), len(b)):
                    col = filtfilt(b, a, col)
                else:
                    warn_list.append(
                        f"Marker '{name}' axis {axis}: too few samples for filtfilt, skipping filter"
                    )

                # Re-insert NaN at original gap locations
                col[nan_mask] = float("nan")
                filtered[:, axis] = col

            filtered_markers[name] = _safe_tolist(filtered)

        return ComputeResult(
            request_id=request.id,
            domain=ComputeDomain.BIOMECHANICS,
            operation="filter_markers",
            status=ComputeStatus.COMPLETED,
            results={"filtered_markers": filtered_markers},
            warnings=warn_list,
        )

    # ── 4. fill_gaps ───────────────────────────────────────────────

    async def _fill_gaps(
        self,
        request: ComputeRequest,
        params: dict[str, Any],
        progress_callback: Callable | None,
    ) -> ComputeResult:
        from scipy.interpolate import CubicSpline, PchipInterpolator, interp1d

        marker_data = _to_array(params["marker_data"])  # (n_frames, 3)
        method = params.get("method", "linear")

        if marker_data.ndim == 1:
            marker_data = marker_data.reshape(-1, 1)

        n_frames, n_cols = marker_data.shape
        filled = marker_data.copy()
        gap_info: list[dict[str, Any]] = []

        for col_idx in range(n_cols):
            col = marker_data[:, col_idx]
            nan_mask = np.isnan(col)

            if not nan_mask.any():
                continue
            if (~nan_mask).sum() < 2:
                continue

            # Identify gap regions
            diff = np.diff(nan_mask.astype(int))
            starts = np.where(diff == 1)[0] + 1
            ends = np.where(diff == -1)[0] + 1

            # Handle edge cases
            if nan_mask[0]:
                starts = np.concatenate(([0], starts))
            if nan_mask[-1]:
                ends = np.concatenate((ends, [n_frames]))

            for s, e in zip(starts, ends):
                gap_info.append({
                    "axis": int(col_idx),
                    "start": int(s),
                    "end": int(e),
                    "duration": int(e - s),
                })

            valid_idx = np.where(~nan_mask)[0]
            valid_vals = col[valid_idx]
            interp_idx = np.where(nan_mask)[0]

            if method == "cubic_spline":
                cs = CubicSpline(valid_idx, valid_vals, extrapolate=True)
                filled[interp_idx, col_idx] = cs(interp_idx)
            elif method == "pchip":
                pchip = PchipInterpolator(valid_idx, valid_vals, extrapolate=True)
                filled[interp_idx, col_idx] = pchip(interp_idx)
            else:
                f = interp1d(valid_idx, valid_vals, kind="linear", fill_value="extrapolate")
                filled[interp_idx, col_idx] = f(interp_idx)

        return ComputeResult(
            request_id=request.id,
            domain=ComputeDomain.BIOMECHANICS,
            operation="fill_gaps",
            status=ComputeStatus.COMPLETED,
            results={
                "filled_data": _safe_tolist(filled),
                "gap_info": gap_info,
            },
        )

    # ── 5. joint_angles ────────────────────────────────────────────

    async def _joint_angles(
        self,
        request: ComputeRequest,
        params: dict[str, Any],
        progress_callback: Callable | None,
    ) -> ComputeResult:
        proximal = [_to_array(m) for m in params["proximal_markers"]]  # 3 markers, each (n,3)
        distal = [_to_array(m) for m in params["distal_markers"]]
        joint_type = params.get("joint_type", "flexion_extension")
        sequence = params.get("sequence", "ZXY")

        n_frames = proximal[0].shape[0]
        angles = np.zeros(n_frames)
        angular_velocity = np.zeros(n_frames)

        for i in range(n_frames):
            R_prox = self._build_segment_cs(
                proximal[0][i], proximal[1][i], proximal[2][i]
            )
            R_dist = self._build_segment_cs(
                distal[0][i], distal[1][i], distal[2][i]
            )
            if R_prox is None or R_dist is None:
                angles[i] = float("nan")
                continue

            R_rel = R_prox.T @ R_dist
            euler = self._decompose_euler(R_rel, sequence)
            if euler is None:
                angles[i] = float("nan")
                continue

            type_map = {
                "flexion_extension": 0,
                "abduction_adduction": 1,
                "internal_external_rotation": 2,
            }
            idx = type_map.get(joint_type, 0)
            angles[i] = np.degrees(euler[idx])

        # Angular velocity via central differences
        valid = ~np.isnan(angles)
        if valid.sum() > 2:
            dt = 1.0  # normalized; caller can scale by 1/sampling_rate
            for i in range(1, n_frames - 1):
                if valid[i - 1] and valid[i + 1]:
                    angular_velocity[i] = (angles[i + 1] - angles[i - 1]) / (2 * dt)

        valid_angles = angles[~np.isnan(angles)]
        rom = float(np.ptp(valid_angles)) if len(valid_angles) > 0 else 0.0
        peak_flex = float(np.max(valid_angles)) if len(valid_angles) > 0 else 0.0
        peak_ext = float(np.min(valid_angles)) if len(valid_angles) > 0 else 0.0

        figures: list[GeneratedFigure] = []
        fig = _make_figure(
            lambda f, ax: (
                ax.plot(angles, linewidth=1.2),
                ax.set_xlabel("Frame"),
                ax.set_ylabel("Angle (deg)"),
                ax.set_title(f"Joint Angle — {joint_type}"),
                ax.grid(True, alpha=0.3),
            ),
            f"Joint Angle — {joint_type}",
        )
        if fig is not None:
            figures.append(fig)

        return ComputeResult(
            request_id=request.id,
            domain=ComputeDomain.BIOMECHANICS,
            operation="joint_angles",
            status=ComputeStatus.COMPLETED,
            results={
                "angles": _safe_tolist(angles),
                "range_of_motion": rom,
                "peak_flexion": peak_flex,
                "peak_extension": peak_ext,
                "angular_velocity": _safe_tolist(angular_velocity),
            },
            descriptive={"angles": DescriptiveStats.from_array(angles)},
            figures=figures,
        )

    # -- helpers for coordinate systems and Euler decomposition -----

    @staticmethod
    def _build_segment_cs(
        p1: np.ndarray, p2: np.ndarray, p3: np.ndarray
    ) -> np.ndarray | None:
        """Build a right-handed orthonormal coordinate system from three markers.

        p1-p2 defines the primary (longitudinal) axis.
        p1-p3 lies in the plane used to derive the second axis.
        """
        v1 = p2 - p1
        v2 = p3 - p1
        if np.any(np.isnan(v1)) or np.any(np.isnan(v2)):
            return None

        e1 = v1 / (np.linalg.norm(v1) + 1e-12)
        temp = np.cross(v1, v2)
        e3 = temp / (np.linalg.norm(temp) + 1e-12)
        e2 = np.cross(e3, e1)
        e2 = e2 / (np.linalg.norm(e2) + 1e-12)

        return np.column_stack([e1, e2, e3])

    @staticmethod
    def _decompose_euler(R: np.ndarray, sequence: str = "ZXY") -> np.ndarray | None:
        """Decompose a 3x3 rotation matrix into Euler/Cardan angles.

        Supports common biomechanical sequences: ZXY, XYZ, YXZ, ZYX.
        Returns angles in radians as [angle1, angle2, angle3].
        """
        try:
            if sequence == "ZXY":
                sy = R[2, 1]
                sy = np.clip(sy, -1.0, 1.0)
                angle2 = np.arcsin(sy)
                if np.abs(np.cos(angle2)) > 1e-6:
                    angle1 = np.arctan2(-R[0, 1], R[1, 1])
                    angle3 = np.arctan2(-R[2, 0], R[2, 2])
                else:
                    angle1 = np.arctan2(R[0, 2], R[0, 0])
                    angle3 = 0.0
                return np.array([angle1, angle2, angle3])

            elif sequence == "XYZ":
                sy = -R[2, 0]
                sy = np.clip(sy, -1.0, 1.0)
                angle2 = np.arcsin(sy)
                if np.abs(np.cos(angle2)) > 1e-6:
                    angle1 = np.arctan2(R[2, 1], R[2, 2])
                    angle3 = np.arctan2(R[1, 0], R[0, 0])
                else:
                    angle1 = np.arctan2(-R[1, 2], R[1, 1])
                    angle3 = 0.0
                return np.array([angle1, angle2, angle3])

            elif sequence == "YXZ":
                sy = R[1, 2]
                sy = np.clip(sy, -1.0, 1.0)
                angle2 = np.arcsin(-sy)
                if np.abs(np.cos(angle2)) > 1e-6:
                    angle1 = np.arctan2(R[0, 2], R[2, 2])
                    angle3 = np.arctan2(R[1, 0], R[1, 1])
                else:
                    angle1 = np.arctan2(-R[0, 1], R[0, 0])
                    angle3 = 0.0
                return np.array([angle1, angle2, angle3])

            elif sequence == "ZYX":
                sy = R[0, 2]
                sy = np.clip(sy, -1.0, 1.0)
                angle2 = np.arcsin(sy)
                if np.abs(np.cos(angle2)) > 1e-6:
                    angle1 = np.arctan2(-R[1, 2], R[2, 2])
                    angle3 = np.arctan2(-R[0, 1], R[0, 0])
                else:
                    angle1 = np.arctan2(R[1, 0], R[1, 1])
                    angle3 = 0.0
                return np.array([angle1, angle2, angle3])

            else:
                warnings.warn(f"Unsupported Euler sequence '{sequence}', using ZXY")
                return BiomechanicsProcessor._decompose_euler(R, "ZXY")
        except Exception:
            return None

    # ── 6. joint_kinematics ────────────────────────────────────────

    async def _joint_kinematics(
        self,
        request: ComputeRequest,
        params: dict[str, Any],
        progress_callback: Callable | None,
    ) -> ComputeResult:
        positions = _to_array(params["positions"])  # (n, 3)
        sampling_rate = float(params["sampling_rate"])
        filter_cutoff = params.get("filter_cutoff")

        if positions.ndim == 1:
            positions = positions.reshape(-1, 1)

        n = positions.shape[0]
        dt = 1.0 / sampling_rate

        # Optional low-pass filter
        if filter_cutoff is not None:
            from scipy.signal import butter, filtfilt

            nyq = sampling_rate / 2.0
            cutoff = float(filter_cutoff)
            if cutoff < nyq:
                b, a = butter(4, cutoff / nyq, btype="low")
                for col in range(positions.shape[1]):
                    mask = ~np.isnan(positions[:, col])
                    if mask.sum() > 15:
                        positions[mask, col] = filtfilt(b, a, positions[mask, col])

        # Central finite differences for velocity
        velocities = np.zeros_like(positions)
        if n > 2:
            velocities[1:-1] = (positions[2:] - positions[:-2]) / (2 * dt)
            velocities[0] = (positions[1] - positions[0]) / dt
            velocities[-1] = (positions[-1] - positions[-2]) / dt

        # Central finite differences for acceleration
        accelerations = np.zeros_like(positions)
        if n > 2:
            accelerations[1:-1] = (positions[2:] - 2 * positions[1:-1] + positions[:-2]) / (dt ** 2)
            accelerations[0] = accelerations[1] if n > 1 else 0.0
            accelerations[-1] = accelerations[-2] if n > 1 else 0.0

        # Speed magnitudes
        speed = np.linalg.norm(velocities, axis=1) if velocities.ndim > 1 else np.abs(velocities.ravel())
        accel_mag = np.linalg.norm(accelerations, axis=1) if accelerations.ndim > 1 else np.abs(accelerations.ravel())

        peak_velocity = float(np.nanmax(speed))
        peak_acceleration = float(np.nanmax(accel_mag))

        descriptive: dict[str, DescriptiveStats] = {
            "speed": DescriptiveStats.from_array(speed),
            "acceleration_magnitude": DescriptiveStats.from_array(accel_mag),
        }

        return ComputeResult(
            request_id=request.id,
            domain=ComputeDomain.BIOMECHANICS,
            operation="joint_kinematics",
            status=ComputeStatus.COMPLETED,
            results={
                "velocities": _safe_tolist(velocities),
                "accelerations": _safe_tolist(accelerations),
                "peak_velocity": peak_velocity,
                "peak_acceleration": peak_acceleration,
            },
            descriptive=descriptive,
        )

    # ── 7. inverse_dynamics ────────────────────────────────────────

    async def _inverse_dynamics(
        self,
        request: ComputeRequest,
        params: dict[str, Any],
        progress_callback: Callable | None,
    ) -> ComputeResult:
        joint_angles_rad = _to_array(params["joint_angles"])  # (n,) in radians
        angular_velocities = _to_array(params.get("angular_velocities", np.zeros_like(joint_angles_rad)))
        angular_accelerations = _to_array(params.get("angular_accelerations", np.zeros_like(joint_angles_rad)))

        segment_mass = float(params["segment_mass"])
        segment_length = float(params["segment_length"])
        com_ratio = float(params.get("segment_com_ratio", 0.5))

        # Moment of inertia: approximate as slender rod if not given
        if "moment_of_inertia" in params and params["moment_of_inertia"] is not None:
            moi = float(params["moment_of_inertia"])
        else:
            moi = (1.0 / 12.0) * segment_mass * segment_length ** 2

        external_force = _to_array(params["external_force"]) if "external_force" in params and params["external_force"] is not None else None
        external_moment = _to_array(params["external_moment"]) if "external_moment" in params and params["external_moment"] is not None else None

        n = len(joint_angles_rad)
        is_2d = joint_angles_rad.ndim == 1

        if is_2d:
            # Simplified 2D sagittal-plane inverse dynamics
            # M = I * alpha + m * g * L_com * cos(theta)
            g = 9.81
            L_com = segment_length * com_ratio
            joint_moments = np.zeros(n)

            for i in range(n):
                theta = joint_angles_rad[i]
                alpha = angular_accelerations[i] if i < len(angular_accelerations) else 0.0
                omega = angular_velocities[i] if i < len(angular_velocities) else 0.0

                # Net moment = inertial + gravitational
                M_inertial = moi * alpha
                M_gravity = segment_mass * g * L_com * np.cos(theta)

                M_ext = 0.0
                if external_moment is not None and i < len(external_moment):
                    M_ext = float(external_moment[i]) if np.ndim(external_moment[i]) == 0 else float(external_moment[i][-1])

                joint_moments[i] = M_inertial + M_gravity - M_ext

            joint_forces = segment_mass * _GRAVITY[1] * np.ones(n)  # simplified

        else:
            # 3D Newton-Euler (simplified single-segment)
            joint_moments = np.zeros(n)
            joint_forces = np.zeros((n, 3))

            g_vec = _GRAVITY
            L_com = segment_length * com_ratio

            for i in range(n):
                alpha_i = angular_accelerations[i] if i < len(angular_accelerations) else 0.0
                omega_i = angular_velocities[i] if i < len(angular_velocities) else 0.0

                M_inertial = moi * alpha_i
                # Gyroscopic term: omega x (I * omega) — scalar approximation
                M_gyro = 0.0  # negligible for slow movements

                M_gravity = segment_mass * 9.81 * L_com

                F_ext = np.zeros(3)
                M_ext = 0.0
                if external_force is not None and i < len(external_force):
                    F_ext = _to_array(external_force[i])
                if external_moment is not None and i < len(external_moment):
                    M_ext = float(external_moment[i]) if np.ndim(external_moment[i]) == 0 else float(np.linalg.norm(external_moment[i]))

                joint_moments[i] = M_inertial + M_gyro + M_gravity - M_ext
                joint_forces[i] = segment_mass * g_vec - F_ext

        peak_moment = float(np.nanmax(np.abs(joint_moments)))

        figures: list[GeneratedFigure] = []
        fig = _make_figure(
            lambda f, ax: (
                ax.plot(joint_moments, linewidth=1.2, color="tab:red"),
                ax.set_xlabel("Frame"),
                ax.set_ylabel("Moment (Nm)"),
                ax.set_title("Joint Moment"),
                ax.grid(True, alpha=0.3),
            ),
            "Joint Moment",
        )
        if fig is not None:
            figures.append(fig)

        return ComputeResult(
            request_id=request.id,
            domain=ComputeDomain.BIOMECHANICS,
            operation="inverse_dynamics",
            status=ComputeStatus.COMPLETED,
            results={
                "joint_moments": _safe_tolist(joint_moments),
                "joint_forces": _safe_tolist(joint_forces) if isinstance(joint_forces, np.ndarray) and joint_forces.ndim > 1 else [float(v) for v in joint_forces],
                "peak_moment": peak_moment,
            },
            descriptive={"joint_moments": DescriptiveStats.from_array(joint_moments)},
            figures=figures,
        )

    # ── 8. gait_analysis ───────────────────────────────────────────

    async def _gait_analysis(
        self,
        request: ComputeRequest,
        params: dict[str, Any],
        progress_callback: Callable | None,
    ) -> ComputeResult:
        from scipy.signal import argrelmin

        heel_marker = _to_array(params["heel_marker"])  # (n, 3) or (n,)
        sampling_rate = float(params["sampling_rate"])
        vertical_axis = int(params.get("vertical_axis", 2))  # default z

        if heel_marker.ndim == 2:
            vertical = heel_marker[:, vertical_axis]
        else:
            vertical = heel_marker

        n = len(vertical)
        dt = 1.0 / sampling_rate

        # Detect heel strikes as local minima in the vertical position
        order = max(1, int(sampling_rate * 0.05))  # search window ~50 ms
        minima_idx = argrelmin(vertical, order=order)[0]

        if len(minima_idx) < 2:
            return ComputeResult(
                request_id=request.id,
                domain=ComputeDomain.BIOMECHANICS,
                operation="gait_analysis",
                status=ComputeStatus.COMPLETED,
                results={"gait_events": [], "gait_parameters": {}, "error_detail": "Fewer than 2 heel strikes detected"},
                warnings=["Insufficient heel strikes detected for gait cycle analysis"],
            )

        heel_strikes = minima_idx.tolist()

        # Segment into gait cycles
        cycles: list[np.ndarray] = []
        stride_times: list[float] = []
        stride_lengths: list[float] = []

        for c in range(len(heel_strikes) - 1):
            start = heel_strikes[c]
            end = heel_strikes[c + 1]
            cycle_data = vertical[start:end]
            cycles.append(cycle_data)

            stride_time = (end - start) * dt
            stride_times.append(stride_time)

            # Stride length from horizontal displacement if 2D+ data available
            if heel_marker.ndim == 2:
                horiz_axes = [a for a in range(heel_marker.shape[1]) if a != vertical_axis]
                disp = heel_marker[end, horiz_axes] - heel_marker[start, horiz_axes]
                stride_lengths.append(float(np.linalg.norm(disp)))
            else:
                stride_lengths.append(0.0)

        # Time-normalize each cycle to 0-100%
        normalized_cycles: list[list[float]] = []
        target_points = 101
        for cycle in cycles:
            x_old = np.linspace(0, 100, len(cycle))
            x_new = np.linspace(0, 100, target_points)
            normalized = np.interp(x_new, x_old, cycle)
            normalized_cycles.append(normalized.tolist())

        # Ensemble average
        if normalized_cycles:
            ensemble = np.mean(normalized_cycles, axis=0).tolist()
            ensemble_std = np.std(normalized_cycles, axis=0).tolist()
        else:
            ensemble = []
            ensemble_std = []

        # Gait parameters
        stride_times_arr = np.array(stride_times)
        stride_lengths_arr = np.array(stride_lengths)
        cadence = 60.0 / np.mean(stride_times_arr) if len(stride_times_arr) > 0 and np.mean(stride_times_arr) > 0 else 0.0
        gait_speed = float(np.mean(stride_lengths_arr / stride_times_arr)) if len(stride_times_arr) > 0 and all(t > 0 for t in stride_times) else 0.0

        # Estimate stance/swing from vertical position within each cycle
        # Stance ~ foot on ground (lower vertical values), swing ~ foot in air
        stance_percents: list[float] = []
        for cycle in cycles:
            threshold = np.min(cycle) + 0.3 * (np.max(cycle) - np.min(cycle))
            stance_samples = np.sum(cycle <= threshold)
            stance_percents.append(100.0 * stance_samples / len(cycle))

        avg_stance = float(np.mean(stance_percents)) if stance_percents else 60.0
        avg_swing = 100.0 - avg_stance

        gait_params = {
            "stride_length_mean": float(np.mean(stride_lengths_arr)) if len(stride_lengths_arr) > 0 else 0.0,
            "stride_time_mean": float(np.mean(stride_times_arr)) if len(stride_times_arr) > 0 else 0.0,
            "cadence_steps_per_min": float(cadence),
            "gait_speed": gait_speed,
            "stance_phase_percent": avg_stance,
            "swing_phase_percent": avg_swing,
            "n_cycles": len(cycles),
        }

        # Gait events
        gait_events = [
            {"event": "heel_strike", "frame": int(hs), "time": float(hs * dt)}
            for hs in heel_strikes
        ]

        figures: list[GeneratedFigure] = []
        if normalized_cycles:
            ens_arr = np.array(ensemble)
            std_arr = np.array(ensemble_std)
            pct = np.linspace(0, 100, target_points)

            def _plot_gait(fig, ax):
                for i, nc in enumerate(normalized_cycles):
                    ax.plot(pct, nc, alpha=0.25, color="gray", linewidth=0.8)
                ax.plot(pct, ens_arr, color="tab:blue", linewidth=2, label="Ensemble mean")
                ax.fill_between(pct, ens_arr - std_arr, ens_arr + std_arr, alpha=0.2, color="tab:blue")
                ax.set_xlabel("Gait Cycle (%)")
                ax.set_ylabel("Vertical Position")
                ax.set_title("Gait Cycle Analysis")
                ax.legend()
                ax.grid(True, alpha=0.3)

            gait_fig = _make_figure(_plot_gait, "Gait Cycle Analysis")
            if gait_fig is not None:
                figures.append(gait_fig)

        return ComputeResult(
            request_id=request.id,
            domain=ComputeDomain.BIOMECHANICS,
            operation="gait_analysis",
            status=ComputeStatus.COMPLETED,
            results={
                "gait_events": gait_events,
                "gait_parameters": gait_params,
                "normalized_cycles": normalized_cycles,
                "ensemble_average": ensemble,
                "ensemble_std": ensemble_std,
            },
            descriptive={
                "stride_time": DescriptiveStats.from_array(stride_times_arr),
                "stride_length": DescriptiveStats.from_array(stride_lengths_arr),
            },
            figures=figures,
        )

    # ── 9. center_of_mass ──────────────────────────────────────────

    async def _center_of_mass(
        self,
        request: ComputeRequest,
        params: dict[str, Any],
        progress_callback: Callable | None,
    ) -> ComputeResult:
        segment_data = params["segment_data"]
        # Each item: {name, marker_positions: [[x,y,z],...], mass_fraction (optional)}

        # Determine number of frames from first segment
        first_positions = _to_array(segment_data[0]["marker_positions"])
        n_frames = first_positions.shape[0]

        total_mass_fraction = 0.0
        weighted_sum = np.zeros((n_frames, 3))

        warn_list: list[str] = []

        for seg in segment_data:
            seg_name = seg.get("name", "unknown")
            positions = _to_array(seg["marker_positions"])  # (n_frames, 3)
            if positions.ndim == 1:
                positions = positions.reshape(1, -1)
            if positions.shape[0] < n_frames:
                # Pad with last known position
                pad = np.tile(positions[-1], (n_frames - positions.shape[0], 1))
                positions = np.vstack([positions, pad])
                warn_list.append(f"Segment '{seg_name}' had fewer frames; padded with last position")

            mass_frac = seg.get("mass_fraction")
            if mass_frac is None:
                mass_frac = _DE_LEVA_MASS_FRACTIONS.get(seg_name.lower())
            if mass_frac is None:
                warn_list.append(
                    f"No mass fraction for segment '{seg_name}', using 1/n_segments"
                )
                mass_frac = 1.0 / len(segment_data)

            mass_frac = float(mass_frac)
            total_mass_fraction += mass_frac
            weighted_sum += mass_frac * positions[:n_frames, :3]

        com_trajectory = weighted_sum / total_mass_fraction if total_mass_fraction > 0 else weighted_sum

        # COM velocity and acceleration via finite differences
        dt = 1.0  # frame-normalized; caller scales with 1/sampling_rate
        com_velocity = np.zeros_like(com_trajectory)
        com_acceleration = np.zeros_like(com_trajectory)

        if n_frames > 2:
            com_velocity[1:-1] = (com_trajectory[2:] - com_trajectory[:-2]) / (2 * dt)
            com_velocity[0] = (com_trajectory[1] - com_trajectory[0]) / dt
            com_velocity[-1] = (com_trajectory[-1] - com_trajectory[-2]) / dt

            com_acceleration[1:-1] = (com_trajectory[2:] - 2 * com_trajectory[1:-1] + com_trajectory[:-2]) / (dt ** 2)

        # Stability metrics (sway area, path length in horizontal plane)
        com_horiz = com_trajectory[:, [0, 2]] if com_trajectory.shape[1] >= 3 else com_trajectory[:, :2]
        path_length = float(np.sum(np.linalg.norm(np.diff(com_horiz, axis=0), axis=1)))
        sway_range_x = float(np.ptp(com_horiz[:, 0])) if com_horiz.shape[1] > 0 else 0.0
        sway_range_z = float(np.ptp(com_horiz[:, 1])) if com_horiz.shape[1] > 1 else 0.0
        sway_area = sway_range_x * sway_range_z  # bounding-box approximation

        return ComputeResult(
            request_id=request.id,
            domain=ComputeDomain.BIOMECHANICS,
            operation="center_of_mass",
            status=ComputeStatus.COMPLETED,
            results={
                "com_trajectory": _safe_tolist(com_trajectory),
                "com_velocity": _safe_tolist(com_velocity),
                "com_acceleration": _safe_tolist(com_acceleration),
                "stability_metrics": {
                    "path_length": path_length,
                    "sway_area": sway_area,
                    "sway_range_ml": sway_range_x,
                    "sway_range_ap": sway_range_z,
                },
            },
            warnings=warn_list,
        )

    # ── 10. ground_reaction_forces ─────────────────────────────────

    async def _ground_reaction_forces(
        self,
        request: ComputeRequest,
        params: dict[str, Any],
        progress_callback: Callable | None,
    ) -> ComputeResult:
        forces = _to_array(params["forces"])  # (n, 3) — Fx, Fy, Fz
        moments = _to_array(params["moments"]) if params.get("moments") is not None else None
        sampling_rate = float(params["sampling_rate"])
        body_mass = float(params["body_mass"])

        if forces.ndim == 1:
            forces = forces.reshape(-1, 1)

        body_weight = body_mass * 9.81
        n = forces.shape[0]
        dt = 1.0 / sampling_rate

        # Normalize to body weight
        normalized_forces = forces / body_weight

        # Vertical force is typically the Y component (index 1)
        vert_idx = 1 if forces.shape[1] >= 2 else 0
        vertical_force = forces[:, vert_idx]
        vertical_norm = normalized_forces[:, vert_idx]

        peak_vertical = float(np.nanmax(vertical_force))
        peak_vertical_bw = float(np.nanmax(vertical_norm))

        # Loading rate: max slope of vertical force in first 20% of stance
        stance_20 = max(1, int(0.2 * n))
        loading_segment = vertical_force[:stance_20]
        if len(loading_segment) > 1:
            gradients = np.diff(loading_segment) / dt
            loading_rate = float(np.nanmax(gradients))
        else:
            loading_rate = 0.0

        # Impulse: integral of force over time (trapezoidal rule)
        impulse_components: list[float] = []
        for col in range(forces.shape[1]):
            imp = float(np.trapz(forces[:, col], dx=dt))
            impulse_components.append(imp)

        # Center of pressure (if moments available)
        cop: list[list[float]] | None = None
        if moments is not None and moments.ndim == 2 and moments.shape[1] >= 3:
            cop_list: list[list[float]] = []
            for i in range(n):
                fz = forces[i, vert_idx] if abs(forces[i, vert_idx]) > 1.0 else float("nan")
                # COP_x = -M_y / F_z,  COP_y = M_x / F_z (sign convention dependent)
                if not np.isnan(fz):
                    cop_x = -moments[i, 1] / fz
                    cop_y = moments[i, 0] / fz
                else:
                    cop_x, cop_y = float("nan"), float("nan")
                cop_list.append([float(cop_x), float(cop_y)])
            cop = cop_list

        grf_params = {
            "peak_vertical_force_N": peak_vertical,
            "peak_vertical_force_BW": peak_vertical_bw,
            "loading_rate_N_per_s": loading_rate,
            "impulse": impulse_components,
        }

        figures: list[GeneratedFigure] = []
        time_axis = np.arange(n) * dt

        def _plot_grf(fig, ax):
            labels = ["Fx (ML)", "Fy (Vertical)", "Fz (AP)"]
            colors = ["tab:green", "tab:blue", "tab:red"]
            for col in range(min(forces.shape[1], 3)):
                lbl = labels[col] if col < len(labels) else f"F{col}"
                clr = colors[col] if col < len(colors) else None
                ax.plot(time_axis, normalized_forces[:, col], label=lbl, color=clr, linewidth=1.2)
            ax.set_xlabel("Time (s)")
            ax.set_ylabel("Force (BW)")
            ax.set_title("Ground Reaction Forces")
            ax.legend()
            ax.grid(True, alpha=0.3)

        grf_fig = _make_figure(_plot_grf, "Ground Reaction Forces")
        if grf_fig is not None:
            figures.append(grf_fig)

        results: dict[str, Any] = {
            "normalized_forces": _safe_tolist(normalized_forces),
            "grf_parameters": grf_params,
        }
        if cop is not None:
            results["center_of_pressure"] = cop

        return ComputeResult(
            request_id=request.id,
            domain=ComputeDomain.BIOMECHANICS,
            operation="ground_reaction_forces",
            status=ComputeStatus.COMPLETED,
            results=results,
            descriptive={
                "vertical_force_BW": DescriptiveStats.from_array(vertical_norm),
            },
            figures=figures,
        )
