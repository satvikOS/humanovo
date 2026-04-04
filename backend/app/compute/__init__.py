"""
Compute Engine — Unified numeric computation framework for biomedical research.

Provides MATLAB-equivalent capabilities across five biomedical domains:
1. Medical Imaging (DICOM/NIfTI processing, segmentation, volumetrics)
2. Electrophysiology (EEG/ECG signal processing, filtering, spectral analysis)
3. Genomics (sequence alignment, expression analysis, pathway enrichment)
4. Biomechanics (motion capture, kinematics, inverse dynamics)
5. Pharmacokinetics (ODE solver, compartmental models, dosing optimization)

Plus cross-cutting modules:
- Statistics (exact tests, multiple testing corrections)
- Visualization (server-side publication-ready figure generation)
"""

from app.compute.engine import ComputeEngine
from app.compute.types import (
    ComputeDomain,
    ComputeRequest,
    ComputeResult,
    ComputeStatus,
)

__all__ = [
    "ComputeEngine",
    "ComputeDomain",
    "ComputeRequest",
    "ComputeResult",
    "ComputeStatus",
]
