"""
Advanced NLP Pipeline for Biomedical Knowledge Extraction

This module provides transformer-based NLP capabilities for:
- Named Entity Recognition (NER) with BioBERT/PubMedBERT
- Relation Extraction with domain-specific patterns
- Assertion Detection (positive/negative/speculative claims)
- Context Tagging (drug, indication, resistance, biomarker, outcome)
- Domain Relation Encoding (ADC-targets, Drug-mechanism, etc.)
"""

from .transformer_ner import TransformerNER, BiomedicalEntity
from .relation_extractor import RelationExtractor, BiomedicalRelation
from .assertion_detector import AssertionDetector, Assertion
from .context_tagger import ContextTagger, ContextAnnotation
from .domain_relations import DomainRelationEncoder, DomainRelation
from .pipeline import NLPPipeline, DocumentAnalysis

__all__ = [
    'TransformerNER',
    'BiomedicalEntity',
    'RelationExtractor',
    'BiomedicalRelation',
    'AssertionDetector',
    'Assertion',
    'ContextTagger',
    'ContextAnnotation',
    'DomainRelationEncoder',
    'DomainRelation',
    'NLPPipeline',
    'DocumentAnalysis',
]
