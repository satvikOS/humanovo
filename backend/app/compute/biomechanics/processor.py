"""
Biomechanics Computation Processor -- motion capture, gait analysis, and
inverse dynamics for human movement research.

Provides C3D/TRC loading, marker filtering, gap filling, joint angle
computation, kinematic analysis, inverse dynamics, gait analysis,
center-of-mass estimation, and ground reaction force processing.
"""

from __future__ import annotations

import logging
import math
from collections.abc import Callable
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
)

logger = logging.getLogger(__name__)

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

# de Leva (1996) male body-segment mass fractions
_DE_LEVA_MASS_FRACTIONS: dict[str, float] = {
    "head": 0.0694,
    "trunk": 0.4346,
    "upper_arm_r": 0.0271,
    "upper_arm_l": 0.0271,
    "forearm_r": 0.0162,
    "forearm_l": 0.0162,
    "hand_r": 0.0061,
    "hand_l": 0.0061,
    "thigh_r": 0.1416,
    "thigh_l": 0.1416,
    "shank_r": 0.0433,
    "shank_l": 0.0433,
    "foot_r": 0.0137,
    "foot_l": 0.0137,
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _safe_float(val: Any) -> float:
    v = float(val)
    if np.isnan(v) or np.isinf(v):
        return 0.0
    return v


def _array_to_list(arr: np.ndarray) -> list[float]:
    result = np.asarray(arr, dtype=np.float64)
    result = np.nan_to_num(result, nan=0.0, posinf=0.0, neginf=0.0)
    return result.tolist()


def _make_result(request: ComputeRequest, **kwargs: Any) -> ComputeResult:
    return ComputeResult(
        request_id=request.id,
        domain=ComputeDomain.BIOMECHANICS,
        operation=request.operation,
        status=ComputeStatus.COMPLETED,
        **kwargs,
    )


def _fail(request: ComputeRequest, error: str) -> ComputeResult:
    return ComputeResult(
        request_id=request.id,
        domain=ComputeDomain.BIOMECHANICS,
        operation=request.operation,
        status=ComputeStatus.FAILED,
        error=error,
    )


def _interpolate_nans(data: np.ndarray) -> np.ndarray:
    """Linearly interpolate NaN values in a 1-D array."""
    nans = np.isnan(data)
    if not np.any(nans):
        return data
    if np.all(nans):
        return data
    x = np.arange(len(data))
    data_out = data.copy()
    data_out[nans] = np.interp(x[nans], x[~nans], data[~nans])
    return data_out


def _build_coordinate_system(
    origin: np.ndarray, p1: np.ndarray, p2: np.ndarray
) -> np.ndarray:
    """Build a right-handed coordinate system from three markers.

    Returns a 3x3 rotation matrix whose columns are the unit axes.
    """
    v1 = p1 - origin
    v1 = v1 / (np.linalg.norm(v1) + 1e-12)
    temp = p2 - origin
    v3 = np.cross(v1, temp)
    v3 = v3 / (np.linalg.norm(v3) + 1e-12)
    v2 = np.cross(v3, v1)
    v2 = v2 / (np.linalg.norm(v2) + 1e-12)
    return np.column_stack([v1, v2, v3])


def _rotation_matrix_to_euler_zxy(R: np.ndarray) -> tuple[float, float, float]:
    """Decompose rotation matrix into ZXY Euler angles (in degrees)."""
    # ZXY: Rz * Rx * Ry
    # R[2,1] = sin(x)
    sin_x = np.clip(R[2, 1], -1.0, 1.0)
    x = math.asin(sin_x)
    cos_x = math.cos(x)
    if abs(cos_x) > 1e-6:
        y = math.atan2(-R[2, 0], R[2, 2])
        z = math.atan2(-R[0, 1], R[1, 1])
    else:
        y = 0.0
        z = math.atan2(R[1, 0], R[0, 0])
    return (
        math.degrees(z),
        math.degrees(x),
        math.degrees(y),
    )


def _get_matplotlib():
    """Import matplotlib with Agg backend."""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    return plt



# ---------------------------------------------------------------------------
# Processor
# ---------------------------------------------------------------------------


class BiomechanicsProcessor:
    """Biomechanics computation engine.

    Dispatches operations for motion-capture loading, marker processing,
    joint kinematics/kinetics, gait analysis, centre-of-mass estimation,
    and ground-reaction-force processing.
    """

    # -- Public interface ---------------------------------------------------

    @staticmethod
    def list_operations() -> list[str]:
        """Return names of all supported operations."""
        return list(_OPERATIONS)

    async def execute(
        self,
        request: ComputeRequest,
        progress_callback: Callable[[int, int], None] | None = None,
    ) -> ComputeResult:
        """Execute a biomechanics computation request."""
        op = request.operation
        if op not in _OPERATIONS:
            return _fail(request, f"Unknown operation: {op!r}. Available: {_OPERATIONS}")

        handler = getattr(self, f"_op_{op}", None)
        if handler is None:
            return _fail(request, f"Operation {op!r} is declared but not implemented.")

        try:
            return await handler(request, progress_callback)
        except Exception as exc:  # noqa: BLE001
            logger.exception("Biomechanics operation %s failed", op)
            return _fail(request, str(exc))

    # -- Operations ---------------------------------------------------------

    async def _op_load_c3d(
        self, request: ComputeRequest, _cb: Callable | None
    ) -> ComputeResult:
        """Parse a C3D motion-capture file."""
        try:
            import c3d
        except ImportError:
            return _fail(request, "c3d package is not installed. Install via: pip install c3d")

        params = request.parameters
        file_path = params.get("file_path")
        if not file_path:
            return _fail(request, "Parameter 'file_path' is required for load_c3d.")

        with open(file_path, "rb") as fh:
            reader = c3d.Reader(fh)

        point_labels = [
            label.strip() for label in reader.point_labels
        ]
        frame_rate = reader.point_rate
        frames = list(reader.read_frames())
        n_frames = len(frames)
        duration = n_frames / frame_rate if frame_rate > 0 else 0.0

        markers: dict[str, list[list[float]]] = {name: [] for name in point_labels}
        for _, points, _ in frames:
            for idx, name in enumerate(point_labels):
                markers[name].append(points[idx, :3].tolist())

        return _make_result(
            request,
            results={
                "marker_names": point_labels,
                "n_frames": n_frames,
                "frame_rate": _safe_float(frame_rate),
                "duration": _safe_float(duration),
                "markers": markers,
            },
        )

    async def _op_load_trc(
        self, request: ComputeRequest, _cb: Callable | None
    ) -> ComputeResult:
        """Parse a TRC (Track Row Column) motion-capture text file."""
        params = request.parameters
        content = params.get("content")
        file_path = params.get("file_path")

        if content is None and file_path is None:
            return _fail(request, "Either 'content' or 'file_path' must be provided.")

        if content is None:
            with open(file_path, "r") as fh:
                content = fh.read()

        lines = content.strip().splitlines()
        if len(lines) < 6:
            return _fail(request, "TRC file has fewer than 6 lines; cannot parse header.")

        # Line 1: PathFileType header
        # Line 2: DataRate  CameraRate  NumFrames  NumMarkers  Units  ...
        # Line 3: values for the above
        # Line 4: marker names (tab-separated, first two cols are Frame# and Time)
        # Line 5: coordinate labels (X1 Y1 Z1 ...)
        # Line 6+: data rows

        header_keys = lines[1].split("	")
        header_vals = lines[2].split("	")
        header = {}
        for k, v in zip(header_keys, header_vals):
            k = k.strip()
            v = v.strip()
            if k:
                header[k] = v

        data_rate = float(header.get("DataRate", header.get("data_rate", "0")))
        num_frames = int(header.get("NumFrames", header.get("num_frames", "0")))
        num_markers = int(header.get("NumMarkers", header.get("num_markers", "0")))
        units = header.get("Units", header.get("units", "mm"))

        marker_line = lines[3].split("	")
        # First two columns are Frame# and Time
        marker_names = [m.strip() for m in marker_line[2:] if m.strip()]
        # Each marker occupies 3 columns (X, Y, Z), so deduplicate
        if len(marker_names) > num_markers:
            marker_names = marker_names[:num_markers]

        markers: dict[str, list[list[float]]] = {name: [] for name in marker_names}
        actual_frames = 0
        for line in lines[5:]:
            cols = line.split("	")
            if len(cols) < 3:
                continue
            actual_frames += 1
            for mi, mname in enumerate(marker_names):
                base = 2 + mi * 3
                try:
                    x = float(cols[base])
                    y = float(cols[base + 1])
                    z = float(cols[base + 2])
                    markers[mname].append([x, y, z])
                except (IndexError, ValueError):
                    markers[mname].append([float("nan")] * 3)

        n_frames = actual_frames if actual_frames > 0 else num_frames
        duration = n_frames / data_rate if data_rate > 0 else 0.0

        return _make_result(
            request,
            results={
                "marker_names": marker_names,
                "n_frames": n_frames,
                "frame_rate": _safe_float(data_rate),
                "duration": _safe_float(duration),
                "units": units,
                "markers": markers,
            },
        )


    async def _op_filter_markers(
        self, request: ComputeRequest, _cb: Callable | None
    ) -> ComputeResult:
        """Apply Butterworth low-pass filter to marker trajectories."""
        from scipy.signal import butter, filtfilt

        params = request.parameters
        markers = params.get("markers")
        sampling_rate = float(params.get("sampling_rate", 0))
        cutoff_freq = float(params.get("cutoff_freq", 6.0))
        order = int(params.get("order", 4))

        if markers is None:
            return _fail(request, "Parameter 'markers' is required.")
        if sampling_rate <= 0:
            return _fail(request, "Parameter 'sampling_rate' must be positive.")

        nyquist = sampling_rate / 2.0
        if cutoff_freq >= nyquist:
            return _fail(
                request,
                f"Cutoff frequency ({cutoff_freq} Hz) must be less than Nyquist ({nyquist} Hz).",
            )

        b, a = butter(order, cutoff_freq / nyquist, btype="low")
        filtered_markers: dict[str, list[list[float]]] = {}

        for name, trajectory in markers.items():
            arr = np.array(trajectory, dtype=np.float64)  # (N, 3)
            if arr.ndim != 2 or arr.shape[1] != 3:
                filtered_markers[name] = trajectory
                continue

            filtered = np.empty_like(arr)
            for col in range(3):
                signal = arr[:, col].copy()
                # Interpolate NaN gaps before filtering
                signal = _interpolate_nans(signal)
                if len(signal) > 3 * max(len(a), len(b)):
                    filtered[:, col] = filtfilt(b, a, signal)
                else:
                    filtered[:, col] = signal
            filtered_markers[name] = filtered.tolist()

        return _make_result(
            request,
            results={
                "markers": filtered_markers,
                "filter_type": "butterworth_lowpass",
                "cutoff_freq": cutoff_freq,
                "order": order,
                "sampling_rate": sampling_rate,
            },
        )

    async def _op_fill_gaps(
        self, request: ComputeRequest, _cb: Callable | None
    ) -> ComputeResult:
        """Interpolate missing (NaN/None) marker data."""
        params = request.parameters
        marker_data = params.get("marker_data")
        method = params.get("method", "linear")

        if marker_data is None:
            return _fail(request, "Parameter 'marker_data' is required.")

        # marker_data: list of [x, y, z] with possible None/NaN
        arr = np.array(
            [
                [
                    float(v) if v is not None else float("nan")
                    for v in row
                ]
                for row in marker_data
            ],
            dtype=np.float64,
        )

        n_gaps_before = int(np.sum(np.isnan(arr)))
        filled = np.empty_like(arr)

        for col in range(arr.shape[1]):
            signal = arr[:, col].copy()
            nans = np.isnan(signal)
            if not np.any(nans) or np.all(nans):
                filled[:, col] = signal
                continue

            valid_idx = np.where(~nans)[0]
            valid_vals = signal[valid_idx]
            nan_idx = np.where(nans)[0]

            if method == "linear":
                filled[:, col] = signal
                filled[nan_idx, col] = np.interp(nan_idx, valid_idx, valid_vals)
            elif method == "cubic_spline":
                from scipy.interpolate import CubicSpline
                cs = CubicSpline(valid_idx, valid_vals, extrapolate=True)
                filled[:, col] = signal
                filled[nan_idx, col] = cs(nan_idx)
            elif method == "pchip":
                from scipy.interpolate import PchipInterpolator
                pchip = PchipInterpolator(valid_idx, valid_vals, extrapolate=True)
                filled[:, col] = signal
                filled[nan_idx, col] = pchip(nan_idx)
            else:
                return _fail(
                    request,
                    f"Unknown interpolation method: {method!r}. Use linear, cubic_spline, or pchip.",
                )

        n_gaps_after = int(np.sum(np.isnan(filled)))

        return _make_result(
            request,
            results={
                "filled_data": filled.tolist(),
                "method": method,
                "gaps_before": n_gaps_before,
                "gaps_after": n_gaps_after,
                "gaps_filled": n_gaps_before - n_gaps_after,
            },
        )


    async def _op_joint_angles(
        self, request: ComputeRequest, _cb: Callable | None
    ) -> ComputeResult:
        """Compute joint angles from proximal/distal segment markers."""
        params = request.parameters
        proximal_markers = params.get("proximal_markers")
        distal_markers = params.get("distal_markers")
        sampling_rate = float(params.get("sampling_rate", 0))

        if proximal_markers is None or distal_markers is None:
            return _fail(
                request,
                "Parameters 'proximal_markers' and 'distal_markers' are required "
                "(each a list of 3 marker trajectories, each trajectory a list of [x,y,z]).",
            )
        if len(proximal_markers) != 3 or len(distal_markers) != 3:
            return _fail(request, "Each segment requires exactly 3 markers.")

        prox = [np.array(m, dtype=np.float64) for m in proximal_markers]
        dist = [np.array(m, dtype=np.float64) for m in distal_markers]
        n_frames = prox[0].shape[0]

        angles_z, angles_x, angles_y = [], [], []

        for i in range(n_frames):
            p0, p1, p2 = prox[0][i], prox[1][i], prox[2][i]
            d0, d1, d2 = dist[0][i], dist[1][i], dist[2][i]

            R_prox = _build_coordinate_system(p0, p1, p2)
            R_dist = _build_coordinate_system(d0, d1, d2)

            # Relative rotation: R_rel = R_prox^T @ R_dist
            R_rel = R_prox.T @ R_dist
            z_ang, x_ang, y_ang = _rotation_matrix_to_euler_zxy(R_rel)
            angles_z.append(z_ang)
            angles_x.append(x_ang)
            angles_y.append(y_ang)

        angles_z = np.array(angles_z)
        angles_x = np.array(angles_x)
        angles_y = np.array(angles_y)

        # Range of motion
        rom = {
            "flexion_extension": _safe_float(np.ptp(angles_x)),
            "abduction_adduction": _safe_float(np.ptp(angles_y)),
            "internal_external_rotation": _safe_float(np.ptp(angles_z)),
        }

        # Angular velocity (degrees/s)
        angular_velocity: dict[str, list[float]] = {}
        if sampling_rate > 0:
            dt = 1.0 / sampling_rate
            angular_velocity = {
                "flexion_extension": _array_to_list(np.gradient(angles_x, dt)),
                "abduction_adduction": _array_to_list(np.gradient(angles_y, dt)),
                "internal_external_rotation": _array_to_list(np.gradient(angles_z, dt)),
            }

        descriptive: dict[str, DescriptiveStats] = {}
        for label, arr in [
            ("flexion_extension", angles_x),
            ("abduction_adduction", angles_y),
            ("internal_external_rotation", angles_z),
        ]:
            descriptive[label] = DescriptiveStats.from_array(arr)

        return _make_result(
            request,
            results={
                "angles": {
                    "flexion_extension": _array_to_list(angles_x),
                    "abduction_adduction": _array_to_list(angles_y),
                    "internal_external_rotation": _array_to_list(angles_z),
                },
                "rom": rom,
                "angular_velocity": angular_velocity,
                "decomposition": "ZXY",
                "units": "degrees",
            },
            descriptive=descriptive,
        )

    async def _op_joint_kinematics(
        self, request: ComputeRequest, _cb: Callable | None
    ) -> ComputeResult:
        """Compute position, velocity, and acceleration from marker trajectory."""
        params = request.parameters
        positions = params.get("positions")
        sampling_rate = float(params.get("sampling_rate", 0))

        if positions is None:
            return _fail(request, "Parameter 'positions' is required.")
        if sampling_rate <= 0:
            return _fail(request, "Parameter 'sampling_rate' must be positive.")

        pos = np.array(positions, dtype=np.float64)
        dt = 1.0 / sampling_rate

        # Central finite differences for velocity
        velocity = np.gradient(pos, dt, axis=0)
        # Second derivative for acceleration
        acceleration = np.gradient(velocity, dt, axis=0)

        speed = np.linalg.norm(velocity, axis=1) if pos.ndim == 2 else np.abs(velocity)

        descriptive: dict[str, DescriptiveStats] = {
            "speed": DescriptiveStats.from_array(speed),
        }

        return _make_result(
            request,
            results={
                "positions": _array_to_list(pos.ravel()) if pos.ndim == 1 else pos.tolist(),
                "velocity": velocity.tolist(),
                "acceleration": acceleration.tolist(),
                "speed": _array_to_list(speed),
                "sampling_rate": sampling_rate,
            },
            descriptive=descriptive,
        )


    async def _op_inverse_dynamics(
        self, request: ComputeRequest, _cb: Callable | None
    ) -> ComputeResult:
        """Compute joint moments via Newton-Euler inverse dynamics (2-D sagittal).

        Simplified 2-D sagittal-plane model:
            M = I * alpha + r x F
        where I is the segment moment of inertia, alpha is angular acceleration,
        r is the moment arm, and F is the external force.
        """
        params = request.parameters
        joint_angles = np.array(params.get("joint_angles", []), dtype=np.float64)
        angular_velocities = np.array(params.get("angular_velocities", []), dtype=np.float64)
        angular_accelerations = np.array(params.get("angular_accelerations", []), dtype=np.float64)
        segment_mass = float(params.get("segment_mass", 0))
        segment_length = float(params.get("segment_length", 0))
        external_force = np.array(params.get("external_force", [0.0, 0.0]), dtype=np.float64)

        if joint_angles.size == 0:
            return _fail(request, "Parameter 'joint_angles' is required.")
        if segment_mass <= 0:
            return _fail(request, "Parameter 'segment_mass' must be positive.")
        if segment_length <= 0:
            return _fail(request, "Parameter 'segment_length' must be positive.")

        # Moment of inertia (uniform rod approximation): I = (1/12) * m * L^2
        I_seg = (1.0 / 12.0) * segment_mass * segment_length ** 2  # noqa: E741
        # Moment arm (half segment length for COM)
        r = segment_length / 2.0

        n = len(joint_angles)
        moments = np.zeros(n)

        for i in range(n):
            alpha = angular_accelerations[i] if i < len(angular_accelerations) else 0.0
            # Convert angle to radians for cross product
            theta = np.radians(joint_angles[i])
            # 2-D cross product: r x F = r * (Fx * sin(theta) + Fy * cos(theta))
            if external_force.ndim >= 1 and external_force.size >= 2:
                cross = r * (
                    external_force[0] * math.sin(theta)
                    + external_force[1] * math.cos(theta)
                )
            else:
                cross = 0.0
            moments[i] = I_seg * alpha + cross

        descriptive = {"moments": DescriptiveStats.from_array(moments)}

        return _make_result(
            request,
            results={
                "moments": _array_to_list(moments),
                "units": "Nm",
                "segment_mass": segment_mass,
                "segment_length": segment_length,
                "moment_of_inertia": _safe_float(I_seg),
                "method": "newton_euler_2d_sagittal",
            },
            descriptive=descriptive,
        )

    async def _op_gait_analysis(
        self, request: ComputeRequest, _cb: Callable | None
    ) -> ComputeResult:
        """Detect gait events and compute spatio-temporal parameters."""
        from scipy.signal import find_peaks

        params = request.parameters
        heel_marker = params.get("heel_marker")
        sampling_rate = float(params.get("sampling_rate", 0))
        body_height = float(params.get("body_height", 1.75))  # metres, for normalization

        if heel_marker is None:
            return _fail(request, "Parameter 'heel_marker' is required (list of [x,y,z]).")
        if sampling_rate <= 0:
            return _fail(request, "Parameter 'sampling_rate' must be positive.")

        heel = np.array(heel_marker, dtype=np.float64)
        if heel.ndim != 2 or heel.shape[1] < 3:
            return _fail(request, "'heel_marker' must be an Nx3 array.")

        vertical = heel[:, 1]  # Y is typically vertical

        # Detect heel strikes as local minima in vertical position
        neg_vertical = -vertical
        peaks, properties = find_peaks(neg_vertical, distance=int(sampling_rate * 0.4))
        heel_strikes = peaks.tolist()

        if len(heel_strikes) < 2:
            return _fail(
                request,
                f"Detected only {len(heel_strikes)} heel strike(s); need at least 2 for gait cycle analysis.",
            )

        # Segment into gait cycles
        stride_times = []
        stride_lengths = []
        gait_cycles: list[dict[str, Any]] = []

        for i in range(len(heel_strikes) - 1):
            hs1 = heel_strikes[i]
            hs2 = heel_strikes[i + 1]
            stride_time = (hs2 - hs1) / sampling_rate
            stride_times.append(stride_time)

            # Stride length from horizontal displacement
            dx = heel[hs2, 0] - heel[hs1, 0]
            dz = heel[hs2, 2] - heel[hs1, 2]
            stride_len = math.sqrt(dx ** 2 + dz ** 2)
            stride_lengths.append(stride_len)

            # Time-normalize to 0-100%
            cycle_data = vertical[hs1: hs2 + 1]
            normalized = np.interp(
                np.linspace(0, 100, 101),
                np.linspace(0, 100, len(cycle_data)),
                cycle_data,
            )
            gait_cycles.append({
                "start_frame": hs1,
                "end_frame": hs2,
                "normalized_vertical": _array_to_list(normalized),
            })

        stride_times_arr = np.array(stride_times)
        stride_lengths_arr = np.array(stride_lengths)

        cadence = 60.0 / np.mean(stride_times_arr) if np.mean(stride_times_arr) > 0 else 0.0
        gait_speed = np.mean(stride_lengths_arr) / np.mean(stride_times_arr) if np.mean(stride_times_arr) > 0 else 0.0

        # Estimate stance/swing (approximate: stance ~60%, swing ~40% of gait cycle)
        # Use vertical velocity to find toe-off
        stance_percents = []
        for i in range(len(heel_strikes) - 1):
            hs1 = heel_strikes[i]
            hs2 = heel_strikes[i + 1]
            cycle_v = vertical[hs1:hs2]
            cycle_vel = np.gradient(cycle_v, 1.0 / sampling_rate)
            # Toe-off: point of maximum upward velocity in first 80% of cycle
            search_end = int(0.8 * len(cycle_vel))
            if search_end > 0:
                toe_off_idx = np.argmax(cycle_vel[:search_end])
                stance_pct = 100.0 * toe_off_idx / len(cycle_vel)
            else:
                stance_pct = 60.0
            stance_percents.append(stance_pct)

        mean_stance = _safe_float(np.mean(stance_percents))
        mean_swing = _safe_float(100.0 - mean_stance)

        # Generate gait cycle figure
        figures = []
        try:
            plt = _get_matplotlib()
            fig, ax = plt.subplots(figsize=(10, 5))
            for idx, gc in enumerate(gait_cycles):
                pct = np.linspace(0, 100, 101)
                ax.plot(pct, gc["normalized_vertical"], alpha=0.5, label=f"Cycle {idx + 1}")
            if gait_cycles:
                mean_cycle = np.mean(
                    [gc["normalized_vertical"] for gc in gait_cycles], axis=0
                )
                ax.plot(
                    np.linspace(0, 100, 101), mean_cycle,
                    "k-", linewidth=2.5, label="Mean",
                )
            ax.set_xlabel("Gait Cycle (%)")
            ax.set_ylabel("Vertical Heel Position")
            ax.set_title("Gait Cycle Analysis")
            ax.legend(loc="best", fontsize=8)
            ax.grid(True, alpha=0.3)
            fig.tight_layout()
            figures.append(GeneratedFigure.from_matplotlib(fig, "Gait Cycle"))
            plt.close(fig)
        except Exception:
            logger.warning("Could not generate gait cycle figure.", exc_info=True)

        descriptive = {
            "stride_time": DescriptiveStats.from_array(stride_times_arr),
            "stride_length": DescriptiveStats.from_array(stride_lengths_arr),
        }

        return _make_result(
            request,
            results={
                "heel_strikes": heel_strikes,
                "n_cycles": len(gait_cycles),
                "stride_time_mean": _safe_float(np.mean(stride_times_arr)),
                "stride_length_mean": _safe_float(np.mean(stride_lengths_arr)),
                "cadence": _safe_float(cadence),
                "gait_speed": _safe_float(gait_speed),
                "stance_percent": mean_stance,
                "swing_percent": mean_swing,
                "gait_cycles": gait_cycles,
            },
            descriptive=descriptive,
            figures=figures,
        )


    async def _op_center_of_mass(
        self, request: ComputeRequest, _cb: Callable | None
    ) -> ComputeResult:
        """Compute whole-body centre of mass from segmental data (de Leva 1996)."""
        params = request.parameters
        segments = params.get("segments")
        body_mass = float(params.get("body_mass", 0))
        custom_fractions = params.get("mass_fractions")

        if segments is None:
            return _fail(
                request,
                "Parameter 'segments' is required: dict mapping segment names to "
                "position trajectories (list of [x,y,z]).",
            )

        fractions = dict(_DE_LEVA_MASS_FRACTIONS)
        if custom_fractions:
            fractions.update(custom_fractions)

        # Determine n_frames from first segment
        first_seg = next(iter(segments.values()))
        n_frames = len(first_seg)

        total_mass = 0.0
        weighted_pos = np.zeros((n_frames, 3), dtype=np.float64)

        for seg_name, positions in segments.items():
            frac = fractions.get(seg_name, 0.0)
            if frac == 0.0:
                logger.warning("No mass fraction for segment %r; skipping.", seg_name)
                continue
            seg_mass = frac * body_mass if body_mass > 0 else frac
            total_mass += seg_mass
            pos_arr = np.array(positions, dtype=np.float64)
            if pos_arr.shape[0] != n_frames:
                return _fail(
                    request,
                    f"Segment '{seg_name}' has {pos_arr.shape[0]} frames; expected {n_frames}.",
                )
            weighted_pos += seg_mass * pos_arr

        if total_mass > 0:
            com = weighted_pos / total_mass
        else:
            com = weighted_pos

        com_list = com.tolist()

        descriptive: dict[str, DescriptiveStats] = {}
        for axis_idx, axis_name in enumerate(["com_x", "com_y", "com_z"]):
            descriptive[axis_name] = DescriptiveStats.from_array(com[:, axis_idx])

        return _make_result(
            request,
            results={
                "center_of_mass": com_list,
                "n_frames": n_frames,
                "total_mass_used": _safe_float(total_mass),
                "segments_included": list(segments.keys()),
                "method": "de_leva_1996",
            },
            descriptive=descriptive,
        )

    async def _op_ground_reaction_forces(
        self, request: ComputeRequest, _cb: Callable | None
    ) -> ComputeResult:
        """Process force-plate ground reaction force data."""
        params = request.parameters
        force_data = params.get("force_data")
        sampling_rate = float(params.get("sampling_rate", 0))
        body_weight = float(params.get("body_weight", 0))

        if force_data is None:
            return _fail(
                request,
                "Parameter 'force_data' is required (Nx3 array of [Fx, Fy, Fz]).",
            )
        if sampling_rate <= 0:
            return _fail(request, "Parameter 'sampling_rate' must be positive.")

        forces = np.array(force_data, dtype=np.float64)
        if forces.ndim != 2 or forces.shape[1] < 3:
            return _fail(request, "'force_data' must be an Nx3 array ([Fx, Fy, Fz]).")

        Fx, Fy, Fz = forces[:, 0], forces[:, 1], forces[:, 2]
        dt = 1.0 / sampling_rate
        n = len(Fx)
        time = np.arange(n) * dt

        # Normalise to body weight if provided
        if body_weight > 0:
            Fx_norm = Fx / body_weight
            Fy_norm = Fy / body_weight
            Fz_norm = Fz / body_weight
            normalised = True
        else:
            Fx_norm = Fx
            Fy_norm = Fy
            Fz_norm = Fz
            normalised = False

        # Peak vertical force (assume Fy or Fz is vertical -- use Fy by convention)
        peak_vertical = _safe_float(np.max(np.abs(Fy)))
        peak_vertical_norm = _safe_float(np.max(np.abs(Fy_norm)))

        # Loading rate: max derivative of vertical force in first 50 ms
        samples_50ms = max(1, int(0.05 * sampling_rate))
        vert_deriv = np.gradient(Fy[:samples_50ms], dt)
        loading_rate = _safe_float(np.max(np.abs(vert_deriv)))

        # Impulse (integral of force over time)
        impulse_x = _safe_float(np.trapz(Fx, dx=dt))
        impulse_y = _safe_float(np.trapz(Fy, dx=dt))
        impulse_z = _safe_float(np.trapz(Fz, dx=dt))

        # Centre of pressure (if moment data provided)
        cop_x_data = params.get("cop_x")
        cop_y_data = params.get("cop_y")
        cop = None
        if cop_x_data is not None and cop_y_data is not None:
            cop = {
                "x": _array_to_list(np.array(cop_x_data, dtype=np.float64)),
                "y": _array_to_list(np.array(cop_y_data, dtype=np.float64)),
            }

        # Generate GRF figure
        figures = []
        try:
            plt = _get_matplotlib()
            fig, axes = plt.subplots(3, 1, figsize=(10, 8), sharex=True)
            labels = ["Anterior-Posterior (Fx)", "Vertical (Fy)", "Medio-Lateral (Fz)"]
            data_norm = [Fx_norm, Fy_norm, Fz_norm]
            for ax, label, d in zip(axes, labels, data_norm):
                ax.plot(time, d, linewidth=1.0)
                ax.set_ylabel("Force (BW)" if normalised else "Force (N)")
                ax.set_title(label)
                ax.grid(True, alpha=0.3)
            axes[-1].set_xlabel("Time (s)")
            fig.suptitle("Ground Reaction Forces", fontsize=14)
            fig.tight_layout()
            figures.append(GeneratedFigure.from_matplotlib(fig, "Ground Reaction Forces"))
            plt.close(fig)
        except Exception:
            logger.warning("Could not generate GRF figure.", exc_info=True)

        descriptive = {
            "Fx": DescriptiveStats.from_array(Fx),
            "Fy": DescriptiveStats.from_array(Fy),
            "Fz": DescriptiveStats.from_array(Fz),
        }

        return _make_result(
            request,
            results={
                "peak_vertical_force": peak_vertical,
                "peak_vertical_force_bw": peak_vertical_norm if normalised else None,
                "loading_rate": loading_rate,
                "impulse": {"x": impulse_x, "y": impulse_y, "z": impulse_z},
                "cop": cop,
                "normalised_to_bw": normalised,
                "sampling_rate": sampling_rate,
                "duration": _safe_float(n * dt),
            },
            descriptive=descriptive,
            figures=figures,
        )
