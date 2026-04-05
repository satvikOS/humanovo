"""
Compute Engine — Unified numeric computation framework for biomedical research.

Full MATLAB-equivalent capabilities across eight biomedical domains:
1. Medical Imaging & Neuroimaging (DICOM/NIfTI, segmentation, volumetrics, radiomics,
   voxel-wise GLM, HRF convolution, RFT correction, functional connectivity, atlas ROI,
   ICA decomposition, Dynamic Causal Modeling, brain extraction)
2. Electrophysiology & Cardiovascular (EEG/ECG signal processing, Pan-Tompkins QRS,
   ECG delineation, full HRV pipeline, Windkessel hemodynamics, arrhythmia classification,
   pulse wave analysis)
3. Genomics & Expression (sequence alignment, negative binomial RNA-seq (DESeq2-equivalent),
   GSEA, co-expression networks (WGCNA), clustergram, PCA/t-SNE/UMAP, pathway topology)
4. Biomechanics & Musculoskeletal (motion capture, inverse dynamics, gait analysis,
   EMG processing, finite element bone analysis, micro-CT morphometry, muscle force estimation)
5. Pharmacokinetics & Systems Biology (ODE solver, 1/2/3-compartment models, PBPK,
   TMDD, population PK, drug interactions, allometric scaling, bioequivalence)
6. Clinical & Psychiatry (linear mixed-effects models, clinical rating scales,
   HRV biomarkers, classification with ROC/AUC, factor analysis, ICC, Bland-Altman)
7. Statistics (exact tests, ANOVA, ANCOVA, Cox regression, survival analysis, bootstrap,
   Bayesian, meta-analysis, equivalence testing, power analysis)
8. Visualization (server-side publication-ready figure generation)
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
