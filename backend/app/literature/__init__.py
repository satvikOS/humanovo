"""
Literature Pipeline for Biomedical Knowledge Extraction

End-to-end pipeline for processing:
- Scientific papers (PubMed, journals)
- Abstracts
- Patents
- Clinical trial records
- Regulatory documents

Features:
- Source selection and configuration
- Inclusion/exclusion criteria
- Incremental updates
- Data snapshots and versioning
- Quality control
"""

from .criteria import ExclusionCriteria, InclusionCriteria, SelectionResult
from .pipeline import LiteraturePipeline, PipelineConfig, PipelineResult
from .snapshots import DataSnapshot, SnapshotManager
from .sources import (
    ClinicalTrialsSource,
    LiteratureSource,
    PatentSource,
    PrePrintSource,
    PubMedSource,
)
from .updates import UpdateManager, UpdateResult

__all__ = [
    "LiteraturePipeline",
    "PipelineConfig",
    "PipelineResult",
    "LiteratureSource",
    "PubMedSource",
    "PatentSource",
    "ClinicalTrialsSource",
    "PrePrintSource",
    "InclusionCriteria",
    "ExclusionCriteria",
    "SelectionResult",
    "SnapshotManager",
    "DataSnapshot",
    "UpdateManager",
    "UpdateResult",
]
