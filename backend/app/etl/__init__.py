"""
Bulk ETL Pipeline for Open Biomedical Datasets

Downloads, parses, and indexes open-source biomedical ontologies and
reference datasets into DynamoDB for grounding LLM responses.

Designed for $0/mo operation using Lambda free tier + S3 + DynamoDB free tier.
"""

from app.etl.datasets import DATASETS, DatasetConfig
from app.etl.bulk_loader import BulkLoader
from app.etl.parsers import OWLParser, TSVParser, OBOParser, XMLParser

__all__ = [
    "BulkLoader",
    "DATASETS",
    "DatasetConfig",
    "OWLParser",
    "TSVParser",
    "OBOParser",
    "XMLParser",
]
