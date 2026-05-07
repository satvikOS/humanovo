"""
Unified NLP Pipeline for Biomedical Knowledge Extraction

Combines all NLP components into a single pipeline:
- Entity Recognition (TransformerNER)
- Relation Extraction (RelationExtractor)
- Assertion Detection (AssertionDetector)
- Context Tagging (ContextTagger)
- Domain Relation Encoding (DomainRelationEncoder)

Provides:
- End-to-end document processing
- Batch processing capabilities
- Configurable component selection
- Comprehensive output structure
"""

import hashlib
import logging
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from .assertion_detector import Assertion, AssertionDetector
from .context_tagger import ContextAnnotation, ContextTagger
from .domain_relations import DomainRelation, DomainRelationEncoder
from .relation_extractor import BiomedicalRelation, RelationExtractor
from .transformer_ner import BiomedicalEntity, TransformerNER

logger = logging.getLogger(__name__)


@dataclass
class DocumentAnalysis:
    """Complete analysis result for a document."""

    document_id: str
    text: str
    entities: list[BiomedicalEntity] = field(default_factory=list)
    relations: list[BiomedicalRelation] = field(default_factory=list)
    domain_relations: list[DomainRelation] = field(default_factory=list)
    assertions: list[Assertion] = field(default_factory=list)
    context_annotations: list[ContextAnnotation] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)
    processing_time_ms: float = 0.0
    timestamp: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "document_id": self.document_id,
            "text": self.text[:1000] + "..." if len(self.text) > 1000 else self.text,
            "entities": [e.to_dict() for e in self.entities],
            "relations": [r.to_dict() for r in self.relations],
            "domain_relations": [dr.to_dict() for dr in self.domain_relations],
            "assertions": [a.to_dict() for a in self.assertions],
            "context_annotations": [c.to_dict() for c in self.context_annotations],
            "metadata": self.metadata,
            "processing_time_ms": self.processing_time_ms,
            "timestamp": self.timestamp,
            "statistics": self.get_statistics(),
        }

    def get_statistics(self) -> dict[str, Any]:
        """Calculate analysis statistics."""
        return {
            "entity_count": len(self.entities),
            "entity_types": self._count_by_type(self.entities, lambda e: e.entity_type.value),
            "relation_count": len(self.relations),
            "relation_types": self._count_by_type(self.relations, lambda r: r.predicate.value),
            "domain_relation_count": len(self.domain_relations),
            "domain_relation_types": self._count_by_type(
                self.domain_relations, lambda dr: dr.relation_type.value
            ),
            "assertion_types": self._count_by_type(
                self.assertions, lambda a: a.assertion_type.value
            ),
            "context_categories": self._count_by_type(
                self.context_annotations, lambda c: c.primary_context.value
            ),
            "avg_entity_confidence": self._avg([e.confidence for e in self.entities]),
            "avg_relation_confidence": self._avg([r.confidence for r in self.relations]),
        }

    @staticmethod
    def _count_by_type(items: list, key_func: Callable) -> dict[str, int]:
        counts = {}
        for item in items:
            key = key_func(item)
            counts[key] = counts.get(key, 0) + 1
        return counts

    @staticmethod
    def _avg(values: list[float]) -> float:
        return sum(values) / len(values) if values else 0.0

    def get_knowledge_graph_nodes(self) -> list[dict[str, Any]]:
        """Extract nodes for knowledge graph."""
        nodes = []
        seen = set()

        for entity in self.entities:
            key = (entity.text.lower(), entity.entity_type.value)
            if key not in seen:
                seen.add(key)
                nodes.append(
                    {
                        "id": hashlib.md5(
                            f"{entity.text}_{entity.entity_type.value}".encode()
                        ).hexdigest()[:12],
                        "label": entity.text,
                        "type": entity.entity_type.value,
                        "confidence": entity.confidence,
                        "normalized_id": entity.normalized_id,
                        "properties": entity.metadata,
                    }
                )

        return nodes

    def get_knowledge_graph_edges(self) -> list[dict[str, Any]]:
        """Extract edges for knowledge graph."""
        edges = []

        for dr in self.domain_relations:
            source_id = hashlib.md5(
                f"{dr.source.text}_{dr.source.entity_type.value}".encode()
            ).hexdigest()[:12]
            target_id = hashlib.md5(
                f"{dr.target.text}_{dr.target.entity_type.value}".encode()
            ).hexdigest()[:12]

            edges.append(
                {
                    "source": source_id,
                    "target": target_id,
                    "relation": dr.relation_type.value,
                    "confidence": dr.confidence,
                    "evidence_weight": dr.evidence_weight,
                    "evidence_text": dr.evidence_text[:200],
                    "bidirectional": dr.bidirectional,
                    "ontology": dr.ontology_mapping,
                }
            )

        return edges


class NLPPipeline:
    """
    Unified NLP pipeline for biomedical text analysis.

    Orchestrates multiple NLP components for comprehensive extraction:
    - Named Entity Recognition
    - Relation Extraction
    - Assertion Detection
    - Context Tagging
    - Domain Relation Encoding
    """

    def __init__(
        self,
        ner_model: str = "bionlp",
        enable_ner: bool = True,
        enable_relations: bool = True,
        enable_assertions: bool = True,
        enable_context: bool = True,
        enable_domain_encoding: bool = True,
        confidence_threshold: float = 0.5,
        max_workers: int = 4,
        device: str | None = None,
    ):
        """
        Initialize the NLP pipeline.

        Args:
            ner_model: NER model to use
            enable_ner: Enable entity recognition
            enable_relations: Enable relation extraction
            enable_assertions: Enable assertion detection
            enable_context: Enable context tagging
            enable_domain_encoding: Enable domain relation encoding
            confidence_threshold: Minimum confidence threshold
            max_workers: Max parallel workers for batch processing
            device: Device for model inference
        """
        self.enable_ner = enable_ner
        self.enable_relations = enable_relations
        self.enable_assertions = enable_assertions
        self.enable_context = enable_context
        self.enable_domain_encoding = enable_domain_encoding
        self.confidence_threshold = confidence_threshold
        self.max_workers = max_workers

        # Initialize components lazily
        self._ner: TransformerNER | None = None
        self._relation_extractor: RelationExtractor | None = None
        self._assertion_detector: AssertionDetector | None = None
        self._context_tagger: ContextTagger | None = None
        self._domain_encoder: DomainRelationEncoder | None = None

        self._ner_model = ner_model
        self._device = device

        logger.info(
            f"NLPPipeline initialized with components: "
            f"NER={enable_ner}, Relations={enable_relations}, "
            f"Assertions={enable_assertions}, Context={enable_context}, "
            f"DomainEncoding={enable_domain_encoding}"
        )

    @property
    def ner(self) -> TransformerNER:
        """Lazy-load NER component."""
        if self._ner is None:
            self._ner = TransformerNER(
                model_name=self._ner_model,
                device=self._device,
                confidence_threshold=self.confidence_threshold,
            )
        return self._ner

    @property
    def relation_extractor(self) -> RelationExtractor:
        """Lazy-load relation extractor."""
        if self._relation_extractor is None:
            self._relation_extractor = RelationExtractor(
                device=self._device, confidence_threshold=self.confidence_threshold
            )
        return self._relation_extractor

    @property
    def assertion_detector(self) -> AssertionDetector:
        """Lazy-load assertion detector."""
        if self._assertion_detector is None:
            self._assertion_detector = AssertionDetector(
                confidence_threshold=self.confidence_threshold
            )
        return self._assertion_detector

    @property
    def context_tagger(self) -> ContextTagger:
        """Lazy-load context tagger."""
        if self._context_tagger is None:
            self._context_tagger = ContextTagger(confidence_threshold=self.confidence_threshold)
        return self._context_tagger

    @property
    def domain_encoder(self) -> DomainRelationEncoder:
        """Lazy-load domain encoder."""
        if self._domain_encoder is None:
            self._domain_encoder = DomainRelationEncoder(
                confidence_threshold=self.confidence_threshold
            )
        return self._domain_encoder

    def analyze(
        self, text: str, document_id: str | None = None, metadata: dict[str, Any] | None = None
    ) -> DocumentAnalysis:
        """
        Analyze a single document.

        Args:
            text: Document text
            document_id: Optional document identifier
            metadata: Optional document metadata

        Returns:
            Complete document analysis
        """
        import time

        start_time = time.time()

        # Generate document ID if not provided
        if document_id is None:
            document_id = hashlib.md5(text.encode()).hexdigest()[:16]

        # Initialize result
        analysis = DocumentAnalysis(
            document_id=document_id,
            text=text,
            metadata=metadata or {},
            timestamp=datetime.now(UTC).isoformat(),
        )

        # Step 1: Entity Recognition
        if self.enable_ner:
            try:
                analysis.entities = self.ner.extract_entities(text)
                logger.debug(f"Extracted {len(analysis.entities)} entities")
            except Exception as e:
                logger.error(f"NER failed: {e}")

        # Step 2: Relation Extraction
        if self.enable_relations and analysis.entities:
            try:
                analysis.relations = self.relation_extractor.extract_relations(
                    text, analysis.entities
                )
                logger.debug(f"Extracted {len(analysis.relations)} relations")
            except Exception as e:
                logger.error(f"Relation extraction failed: {e}")

        # Step 3: Domain Relation Encoding
        if self.enable_domain_encoding and analysis.relations:
            try:
                analysis.domain_relations = self.domain_encoder.encode_relations(
                    analysis.relations, text
                )

                # Also try ADC-specific extraction
                adc_relations = self.domain_encoder.encode_adc_relations(text, analysis.entities)
                # Merge, avoiding duplicates
                existing = {dr.to_triple() for dr in analysis.domain_relations}
                for adc_rel in adc_relations:
                    if adc_rel.to_triple() not in existing:
                        analysis.domain_relations.append(adc_rel)

                logger.debug(f"Encoded {len(analysis.domain_relations)} domain relations")
            except Exception as e:
                logger.error(f"Domain encoding failed: {e}")

        # Step 4: Assertion Detection
        if self.enable_assertions:
            try:
                # Split into sentences for assertion detection
                sentences = self._split_sentences(text)
                analysis.assertions = [
                    self.assertion_detector.detect_assertion(sent) for sent in sentences
                ]
                logger.debug(f"Detected {len(analysis.assertions)} assertions")
            except Exception as e:
                logger.error(f"Assertion detection failed: {e}")

        # Step 5: Context Tagging
        if self.enable_context:
            try:
                analysis.context_annotations = self.context_tagger.tag_text(text)
                logger.debug(f"Tagged {len(analysis.context_annotations)} context segments")
            except Exception as e:
                logger.error(f"Context tagging failed: {e}")

        # Calculate processing time
        analysis.processing_time_ms = (time.time() - start_time) * 1000

        return analysis

    def batch_analyze(
        self,
        documents: list[dict[str, Any]],
        text_key: str = "text",
        id_key: str = "id",
        parallel: bool = True,
    ) -> list[DocumentAnalysis]:
        """
        Analyze multiple documents.

        Args:
            documents: List of document dictionaries
            text_key: Key for text content in documents
            id_key: Key for document ID
            parallel: Whether to process in parallel

        Returns:
            List of document analyses
        """
        if parallel and len(documents) > 1:
            with ThreadPoolExecutor(max_workers=self.max_workers) as executor:
                futures = []
                for doc in documents:
                    text = doc.get(text_key, "")
                    doc_id = doc.get(id_key)
                    metadata = {k: v for k, v in doc.items() if k not in [text_key, id_key]}

                    future = executor.submit(self.analyze, text, doc_id, metadata)
                    futures.append(future)

                results = [f.result() for f in futures]
        else:
            results = []
            for doc in documents:
                text = doc.get(text_key, "")
                doc_id = doc.get(id_key)
                metadata = {k: v for k, v in doc.items() if k not in [text_key, id_key]}

                result = self.analyze(text, doc_id, metadata)
                results.append(result)

        return results

    def _split_sentences(self, text: str) -> list[str]:
        """Split text into sentences."""
        import re

        pattern = re.compile(r"(?<=[.!?])\s+")
        sentences = pattern.split(text)
        return [s.strip() for s in sentences if s.strip()]

    def extract_knowledge_graph(self, analyses: list[DocumentAnalysis]) -> dict[str, Any]:
        """
        Extract consolidated knowledge graph from multiple analyses.

        Args:
            analyses: List of document analyses

        Returns:
            Knowledge graph with nodes and edges
        """
        all_nodes = {}
        all_edges = []

        for analysis in analyses:
            # Collect nodes
            for node in analysis.get_knowledge_graph_nodes():
                node_id = node["id"]
                if node_id not in all_nodes:
                    all_nodes[node_id] = node
                else:
                    # Merge confidence (take max)
                    all_nodes[node_id]["confidence"] = max(
                        all_nodes[node_id]["confidence"], node["confidence"]
                    )

            # Collect edges
            for edge in analysis.get_knowledge_graph_edges():
                # Add source document reference
                edge["source_documents"] = [analysis.document_id]
                all_edges.append(edge)

        # Deduplicate and merge edges
        merged_edges = self._merge_edges(all_edges)

        return {
            "nodes": list(all_nodes.values()),
            "edges": merged_edges,
            "statistics": {
                "node_count": len(all_nodes),
                "edge_count": len(merged_edges),
                "document_count": len(analyses),
            },
        }

    def _merge_edges(self, edges: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Merge duplicate edges, combining evidence."""
        merged = {}

        for edge in edges:
            key = (edge["source"], edge["target"], edge["relation"])

            if key not in merged:
                merged[key] = edge.copy()
                merged[key]["evidence_count"] = 1
                merged[key]["source_documents"] = edge.get("source_documents", [])
            else:
                # Merge
                merged[key]["confidence"] = max(merged[key]["confidence"], edge["confidence"])
                merged[key]["evidence_weight"] = max(
                    merged[key]["evidence_weight"], edge["evidence_weight"]
                )
                merged[key]["evidence_count"] += 1
                merged[key]["source_documents"].extend(edge.get("source_documents", []))

        return list(merged.values())

    def get_pipeline_info(self) -> dict[str, Any]:
        """Get pipeline configuration info."""
        return {
            "components": {
                "ner": {"enabled": self.enable_ner, "model": self._ner_model},
                "relation_extraction": {"enabled": self.enable_relations},
                "assertion_detection": {"enabled": self.enable_assertions},
                "context_tagging": {"enabled": self.enable_context},
                "domain_encoding": {"enabled": self.enable_domain_encoding},
            },
            "settings": {
                "confidence_threshold": self.confidence_threshold,
                "max_workers": self.max_workers,
                "device": self._device,
            },
        }


# Factory function
def create_pipeline(preset: str = "full", **kwargs) -> NLPPipeline:
    """
    Create an NLP pipeline with preset configuration.

    Args:
        preset: Configuration preset (full, fast, minimal)
        **kwargs: Additional configuration

    Returns:
        Configured NLPPipeline
    """
    presets = {
        "full": {
            "enable_ner": True,
            "enable_relations": True,
            "enable_assertions": True,
            "enable_context": True,
            "enable_domain_encoding": True,
        },
        "fast": {
            "enable_ner": True,
            "enable_relations": True,
            "enable_assertions": False,
            "enable_context": False,
            "enable_domain_encoding": True,
        },
        "minimal": {
            "enable_ner": True,
            "enable_relations": False,
            "enable_assertions": False,
            "enable_context": False,
            "enable_domain_encoding": False,
        },
    }

    config = presets.get(preset, presets["full"])
    config.update(kwargs)

    return NLPPipeline(**config)


# Convenience function
def analyze_text(text: str) -> DocumentAnalysis:
    """Quick text analysis using default pipeline."""
    pipeline = create_pipeline("full")
    return pipeline.analyze(text)
