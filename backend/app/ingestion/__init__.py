"""
GenUp Data Ingestion Module

Continuous data ingestion pipeline for biomedical data sources.
"""

from app.ingestion.pipeline import IngestionPipeline
from app.ingestion.sources import (
    DataSource,
    PubMedSource,
    ClinicalTrialsSource,
)
from app.ingestion.extractors import EntityExtractor, RelationExtractor

__all__ = [
    "IngestionPipeline",
    "DataSource",
    "PubMedSource",
    "ClinicalTrialsSource",
    "EntityExtractor",
    "RelationExtractor",
]
