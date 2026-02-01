"""
Advanced NLP Pipeline for Biomedical Knowledge Extraction

This module provides transformer-based NLP capabilities for:
- Named Entity Recognition (NER) with BioBERT/PubMedBERT
- Relation Extraction with domain-specific patterns
- Assertion Detection (positive/negative/speculative claims)
- Context Tagging (drug, indication, resistance, biomarker, outcome)
- Domain Relation Encoding (ADC-targets, Drug-mechanism, etc.)
"""

from .assertion_detector import Assertion, AssertionDetector
from .context_tagger import ContextAnnotation, ContextTagger
from .domain_relations import DomainRelation, DomainRelationEncoder
from .pipeline import DocumentAnalysis, NLPPipeline
from .relation_extractor import BiomedicalRelation, RelationExtractor
from .transformer_ner import BiomedicalEntity, TransformerNER

__all__ = [
    "TransformerNER",
    "BiomedicalEntity",
    "RelationExtractor",
    "BiomedicalRelation",
    "AssertionDetector",
    "Assertion",
    "ContextTagger",
    "ContextAnnotation",
    "DomainRelationEncoder",
    "DomainRelation",
    "NLPPipeline",
    "DocumentAnalysis",
]
