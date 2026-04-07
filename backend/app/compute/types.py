"""
Compute Engine — Shared types and data models.

Provides the universal contract between researchers and the computation engine:
- ComputeRequest: what goes in (data, parameters, domain)
- ComputeResult: what comes out (numerical results, statistics, visualizations)
"""

from __future__ import annotations

import base64
from datetime import datetime
from enum import Enum
from typing import Any
from uuid import UUID, uuid4

import numpy as np
from pydantic import BaseModel, Field


# ── Domain Enums ─────────────────────────────────────────────────


class ComputeDomain(str, Enum):
    """Biomedical computation domains."""

    IMAGING = "imaging"
    ELECTROPHYSIOLOGY = "electrophysiology"
    GENOMICS = "genomics"
    BIOMECHANICS = "biomechanics"
    PHARMACOKINETICS = "pharmacokinetics"
    SIMULATION = "simulation"
    STATISTICS = "statistics"
    CLINICAL = "clinical"


class ComputeStatus(str, Enum):
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class DataFormat(str, Enum):
    """Supported input data formats — MATLAB-equivalent coverage."""

    # ── Imaging ──
    DICOM = "dicom"
    NIFTI = "nifti"
    PNG = "png"
    JPEG = "jpeg"
    BMP = "bmp"
    TIFF = "tiff"
    # ── Electrophysiology / Audio ──
    EDF = "edf"
    BDF = "bdf"
    WAV = "wav"
    CSV_TIMESERIES = "csv_timeseries"
    # ── Genomics ──
    FASTA = "fasta"
    FASTQ = "fastq"
    VCF = "vcf"
    GFF = "gff"
    CSV_EXPRESSION = "csv_expression"
    # ── Biomechanics ──
    C3D = "c3d"
    CSV_MOTION = "csv_motion"
    TRC = "trc"
    # ── Scientific Containers ──
    HDF5 = "hdf5"
    MAT = "mat"
    NETCDF = "netcdf"
    NPY = "npy"
    NPZ = "npz"
    # ── Tabular ──
    CSV = "csv"
    JSON = "json"
    EXCEL = "excel"
    PARQUET = "parquet"
    XML = "xml"
    # ── Legacy ──
    NUMPY = "numpy"


# ── Statistical Result Types ─────────────────────────────────────


class ConfidenceInterval(BaseModel):
    lower: float
    upper: float
    level: float = 0.95


class StatisticalTest(BaseModel):
    test_name: str
    statistic: float
    p_value: float
    degrees_of_freedom: float | None = None
    effect_size: float | None = None
    ci: ConfidenceInterval | None = None
    significant: bool = False
    correction_method: str | None = None


class DescriptiveStats(BaseModel):
    n: int
    mean: float
    std: float
    median: float
    min: float
    max: float
    q1: float
    q3: float
    iqr: float
    skewness: float
    kurtosis: float
    ci: ConfidenceInterval | None = None

    @classmethod
    def from_array(cls, arr: np.ndarray, confidence: float = 0.95) -> DescriptiveStats:
        from scipy import stats as sp_stats

        arr = arr[~np.isnan(arr)]
        n = len(arr)
        if n == 0:
            return cls(
                n=0, mean=0.0, std=0.0, median=0.0, min=0.0, max=0.0,
                q1=0.0, q3=0.0, iqr=0.0, skewness=0.0, kurtosis=0.0,
            )

        mean_val = float(np.mean(arr))
        std_val = float(np.std(arr, ddof=1)) if n > 1 else 0.0
        q1, median_val, q3 = np.percentile(arr, [25, 50, 75])

        ci = None
        if n > 1 and std_val > 0:
            se = std_val / np.sqrt(n)
            t_crit = sp_stats.t.ppf((1 + confidence) / 2, df=n - 1)
            ci = ConfidenceInterval(
                lower=mean_val - t_crit * se,
                upper=mean_val + t_crit * se,
                level=confidence,
            )

        return cls(
            n=n,
            mean=mean_val,
            std=std_val,
            median=float(median_val),
            min=float(np.min(arr)),
            max=float(np.max(arr)),
            q1=float(q1),
            q3=float(q3),
            iqr=float(q3 - q1),
            skewness=float(sp_stats.skew(arr)) if n > 2 else 0.0,
            kurtosis=float(sp_stats.kurtosis(arr)) if n > 3 else 0.0,
            ci=ci,
        )


# ── Visualization Types ──────────────────────────────────────────


class FigureFormat(str, Enum):
    PNG = "png"
    SVG = "svg"
    PDF = "pdf"
    JSON_PLOTLY = "json_plotly"


class GeneratedFigure(BaseModel):
    title: str
    format: FigureFormat
    data_base64: str | None = None
    plotly_json: dict[str, Any] | None = None
    width: int = 800
    height: int = 600

    @classmethod
    def from_matplotlib(cls, fig, title: str, fmt: FigureFormat = FigureFormat.PNG) -> GeneratedFigure:
        import io

        buf = io.BytesIO()
        fig.savefig(buf, format=fmt.value, dpi=150, bbox_inches="tight")
        buf.seek(0)
        return cls(
            title=title,
            format=fmt,
            data_base64=base64.b64encode(buf.read()).decode("utf-8"),
            width=int(fig.get_figwidth() * 150),
            height=int(fig.get_figheight() * 150),
        )

    @classmethod
    def from_plotly(cls, fig, title: str) -> GeneratedFigure:
        return cls(
            title=title,
            format=FigureFormat.JSON_PLOTLY,
            plotly_json=fig.to_dict(),
        )


# ── Request / Result ─────────────────────────────────────────────


class ComputeRequest(BaseModel):
    """Universal computation request."""

    id: UUID = Field(default_factory=uuid4)
    domain: ComputeDomain
    operation: str
    parameters: dict[str, Any] = Field(default_factory=dict)
    data: dict[str, Any] | None = None
    data_format: DataFormat | None = None
    options: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class ComputeResult(BaseModel):
    """Universal computation result."""

    request_id: UUID
    domain: ComputeDomain
    operation: str
    status: ComputeStatus = ComputeStatus.COMPLETED
    results: dict[str, Any] = Field(default_factory=dict)
    statistics: list[StatisticalTest] = Field(default_factory=list)
    descriptive: dict[str, DescriptiveStats] = Field(default_factory=dict)
    figures: list[GeneratedFigure] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    error: str | None = None
    runtime_seconds: float = 0.0
    metadata: dict[str, Any] = Field(default_factory=dict)

    class Config:
        arbitrary_types_allowed = True
