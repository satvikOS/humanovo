"""
Unified Entity Resolution System

Combines all resolution components:
- Vocabulary mapping
- Synonym expansion
- Disambiguation
- Canonical ID assignment

Provides end-to-end entity resolution with:
- Multi-source normalization
- Confidence scoring
- Evidence tracking
- Full provenance
"""

import logging
from dataclasses import dataclass, field
from datetime import datetime
from typing import Dict, List, Optional, Any, Tuple
import hashlib

from .vocabulary_mapper import VocabularyMapper, VocabularyEntry, MappingResult, VocabularySource
from .synonym_manager import SynonymManager, SynonymEntry
from .disambiguation import Disambiguator, DisambiguationResult
from .canonical_ids import CanonicalIDManager, CanonicalID, IDNamespace

logger = logging.getLogger(__name__)


@dataclass
class ResolvedEntity:
    """Represents a fully resolved entity."""
    original_mention: str
    canonical_id: Optional[CanonicalID] = None
    canonical_name: str = ""
    entity_type: str = ""
    confidence: float = 0.0
    vocabulary_entries: List[VocabularyEntry] = field(default_factory=list)
    synonyms: List[str] = field(default_factory=list)
    cross_references: Dict[str, List[str]] = field(default_factory=dict)
    disambiguation_info: Optional[DisambiguationResult] = None
    resolution_steps: List[str] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "original_mention": self.original_mention,
            "canonical_id": self.canonical_id.to_dict() if self.canonical_id else None,
            "canonical_name": self.canonical_name,
            "entity_type": self.entity_type,
            "confidence": self.confidence,
            "vocabulary_entries": [e.to_dict() for e in self.vocabulary_entries],
            "synonyms": self.synonyms,
            "cross_references": self.cross_references,
            "disambiguation_info": self.disambiguation_info.to_dict() if self.disambiguation_info else None,
            "resolution_steps": self.resolution_steps,
            "metadata": self.metadata
        }

    def get_best_external_id(self, namespace: Optional[str] = None) -> Optional[str]:
        """Get best external identifier."""
        if namespace and namespace in self.cross_references:
            refs = self.cross_references[namespace]
            return refs[0] if refs else None

        # Priority order for external IDs
        priority = ["hgnc", "drugbank", "mesh", "uniprot", "ncbi_gene", "chebi"]
        for ns in priority:
            if ns in self.cross_references and self.cross_references[ns]:
                return f"{ns}:{self.cross_references[ns][0]}"

        return None


@dataclass
class ResolutionResult:
    """Result of entity resolution process."""
    entities: List[ResolvedEntity] = field(default_factory=list)
    unresolved: List[str] = field(default_factory=list)
    statistics: Dict[str, Any] = field(default_factory=dict)
    processing_time_ms: float = 0.0
    timestamp: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return {
            "entities": [e.to_dict() for e in self.entities],
            "unresolved": self.unresolved,
            "statistics": self.statistics,
            "processing_time_ms": self.processing_time_ms,
            "timestamp": self.timestamp
        }


class EntityResolver:
    """
    Unified entity resolution system.

    Provides end-to-end resolution:
    1. Normalize text
    2. Expand synonyms
    3. Map to vocabularies
    4. Disambiguate if needed
    5. Assign canonical ID
    """

    def __init__(
        self,
        enabled_vocabularies: Optional[List[VocabularySource]] = None,
        enable_disambiguation: bool = True,
        enable_synonym_expansion: bool = True,
        confidence_threshold: float = 0.5,
        domain: Optional[str] = None
    ):
        """
        Initialize the entity resolver.

        Args:
            enabled_vocabularies: Vocabularies to use for mapping
            enable_disambiguation: Enable disambiguation
            enable_synonym_expansion: Enable synonym expansion
            confidence_threshold: Minimum confidence threshold
            domain: Domain context for resolution
        """
        self.confidence_threshold = confidence_threshold
        self.enable_disambiguation = enable_disambiguation
        self.enable_synonym_expansion = enable_synonym_expansion
        self.domain = domain

        # Initialize components
        self.vocabulary_mapper = VocabularyMapper(
            enabled_sources=enabled_vocabularies,
            use_fuzzy_matching=True,
            fuzzy_threshold=0.8
        )

        self.synonym_manager = SynonymManager(
            enable_normalization=True,
            case_sensitive=False
        )

        self.disambiguator = Disambiguator(
            confidence_threshold=confidence_threshold,
            domain=domain
        ) if enable_disambiguation else None

        self.id_manager = CanonicalIDManager(
            default_namespace=IDNamespace.GENUP,
            enable_versioning=True
        )

        logger.info(f"EntityResolver initialized, domain: {domain}")

    def resolve(
        self,
        mention: str,
        context: Optional[str] = None,
        entity_type: Optional[str] = None,
        preferred_vocabulary: Optional[VocabularySource] = None
    ) -> ResolvedEntity:
        """
        Resolve an entity mention.

        Args:
            mention: Entity mention to resolve
            context: Surrounding context text
            entity_type: Optional entity type hint
            preferred_vocabulary: Preferred vocabulary source

        Returns:
            ResolvedEntity
        """
        result = ResolvedEntity(original_mention=mention)
        steps = []

        # Step 1: Normalize
        normalized = self.synonym_manager.normalize(mention)
        if normalized != mention:
            steps.append(f"Normalized: '{mention}' -> '{normalized}'")

        # Step 2: Get canonical form from synonyms
        canonical_form = self.synonym_manager.get_canonical(normalized)
        if canonical_form:
            steps.append(f"Synonym found: '{normalized}' -> '{canonical_form}'")
            normalized = canonical_form

        # Step 3: Map to vocabularies
        mapping_result = self.vocabulary_mapper.map_entity(
            normalized,
            entity_type=entity_type,
            preferred_source=preferred_vocabulary
        )

        if mapping_result.entries:
            result.vocabulary_entries = mapping_result.entries
            steps.append(f"Vocabulary match: {mapping_result.match_type} ({len(mapping_result.entries)} entries)")

            # Use best match
            if mapping_result.best_match:
                best = mapping_result.best_match
                result.canonical_name = best.name
                result.entity_type = best.semantic_types[0] if best.semantic_types else "unknown"
                result.synonyms = list(self.vocabulary_mapper.get_all_synonyms(best))
                result.cross_references = best.cross_references
                result.confidence = mapping_result.confidence

        # Step 4: Disambiguation (if multiple candidates)
        if self.enable_disambiguation and len(mapping_result.entries) > 1:
            context_text = context or mention
            disambiguation_result = self.disambiguator.disambiguate(
                mention=normalized,
                context=context_text,
                type_hint=entity_type
            )

            result.disambiguation_info = disambiguation_result
            steps.append(f"Disambiguation: {disambiguation_result.method_used}")

            if disambiguation_result.selected:
                selected = disambiguation_result.selected
                result.canonical_name = selected.entity_name
                result.entity_type = selected.entity_type
                result.confidence = disambiguation_result.confidence

        # Step 5: Assign canonical ID
        if result.canonical_name:
            # Try to find existing ID from cross-references
            canonical_id = None
            for namespace, ids in result.cross_references.items():
                if ids:
                    canonical_id = self.id_manager.get_canonical(namespace, ids[0])
                    if canonical_id:
                        break

            # Generate new ID if not found
            if canonical_id is None:
                canonical_id = self.id_manager.generate_id(
                    entity_name=result.canonical_name,
                    entity_type=result.entity_type,
                    metadata={
                        "original_mention": mention,
                        "resolution_confidence": result.confidence
                    }
                )

                # Register cross-references
                for namespace, ids in result.cross_references.items():
                    for ext_id in ids:
                        self.id_manager.register_external_id(
                            external_namespace=namespace,
                            external_id=ext_id,
                            canonical_id=canonical_id,
                            confidence=result.confidence
                        )

            result.canonical_id = canonical_id
            steps.append(f"Canonical ID: {canonical_id.get_curie()}")
        else:
            # No vocabulary match - generate ID from mention
            result.canonical_name = normalized
            result.entity_type = entity_type or "unknown"
            result.confidence = 0.3

            result.canonical_id = self.id_manager.generate_id(
                entity_name=normalized,
                entity_type=result.entity_type,
                metadata={
                    "original_mention": mention,
                    "unmatched": True
                }
            )
            steps.append(f"Generated ID (no match): {result.canonical_id.get_curie()}")

        result.resolution_steps = steps
        result.metadata["resolution_timestamp"] = datetime.utcnow().isoformat()

        return result

    def batch_resolve(
        self,
        mentions: List[str],
        contexts: Optional[List[str]] = None,
        entity_types: Optional[List[str]] = None
    ) -> ResolutionResult:
        """
        Resolve multiple entity mentions.

        Args:
            mentions: List of entity mentions
            contexts: Optional list of contexts
            entity_types: Optional list of entity types

        Returns:
            ResolutionResult
        """
        import time
        start_time = time.time()

        contexts = contexts or [None] * len(mentions)
        entity_types = entity_types or [None] * len(mentions)

        result = ResolutionResult(
            timestamp=datetime.utcnow().isoformat()
        )

        resolved_count = 0
        unresolved_count = 0
        confidence_sum = 0.0

        for mention, context, etype in zip(mentions, contexts, entity_types):
            try:
                resolved = self.resolve(mention, context, etype)
                result.entities.append(resolved)

                if resolved.confidence >= self.confidence_threshold:
                    resolved_count += 1
                else:
                    unresolved_count += 1
                    result.unresolved.append(mention)

                confidence_sum += resolved.confidence

            except Exception as e:
                logger.error(f"Failed to resolve '{mention}': {e}")
                result.unresolved.append(mention)
                unresolved_count += 1

        # Calculate statistics
        total = len(mentions)
        result.statistics = {
            "total_mentions": total,
            "resolved_count": resolved_count,
            "unresolved_count": unresolved_count,
            "resolution_rate": resolved_count / total if total > 0 else 0,
            "average_confidence": confidence_sum / total if total > 0 else 0,
            "entity_types": self._count_types(result.entities),
            "vocabulary_sources": self._count_sources(result.entities)
        }

        result.processing_time_ms = (time.time() - start_time) * 1000

        return result

    def _count_types(self, entities: List[ResolvedEntity]) -> Dict[str, int]:
        """Count entity types."""
        counts = {}
        for entity in entities:
            etype = entity.entity_type
            counts[etype] = counts.get(etype, 0) + 1
        return counts

    def _count_sources(self, entities: List[ResolvedEntity]) -> Dict[str, int]:
        """Count vocabulary sources."""
        counts = {}
        for entity in entities:
            for entry in entity.vocabulary_entries:
                source = entry.source.value
                counts[source] = counts.get(source, 0) + 1
        return counts

    def resolve_from_text(
        self,
        text: str,
        entities: List[Dict[str, Any]]
    ) -> List[ResolvedEntity]:
        """
        Resolve entities extracted from text.

        Args:
            text: Source text
            entities: List of extracted entities with 'text', 'type', 'start', 'end'

        Returns:
            List of ResolvedEntity
        """
        results = []

        for entity in entities:
            mention = entity.get("text", "")
            entity_type = entity.get("type")
            start = entity.get("start", 0)
            end = entity.get("end", len(text))

            # Extract context around entity
            context_start = max(0, start - 100)
            context_end = min(len(text), end + 100)
            context = text[context_start:context_end]

            resolved = self.resolve(
                mention=mention,
                context=context,
                entity_type=entity_type
            )

            # Add position info
            resolved.metadata["start"] = start
            resolved.metadata["end"] = end

            results.append(resolved)

        return results

    def get_resolver_info(self) -> Dict[str, Any]:
        """Get resolver configuration info."""
        return {
            "vocabulary_mapper": self.vocabulary_mapper.get_statistics(),
            "synonym_manager": self.synonym_manager.get_statistics(),
            "disambiguator": self.disambiguator.get_statistics() if self.disambiguator else None,
            "id_manager": self.id_manager.get_statistics(),
            "settings": {
                "confidence_threshold": self.confidence_threshold,
                "disambiguation_enabled": self.enable_disambiguation,
                "synonym_expansion_enabled": self.enable_synonym_expansion,
                "domain": self.domain
            }
        }


# Factory function
def create_resolver(
    preset: str = "default",
    domain: Optional[str] = None
) -> EntityResolver:
    """
    Create an entity resolver with preset configuration.

    Args:
        preset: Configuration preset (default, oncology, pharmacology)
        domain: Optional domain override

    Returns:
        Configured EntityResolver
    """
    presets = {
        "default": {
            "enable_disambiguation": True,
            "enable_synonym_expansion": True,
            "confidence_threshold": 0.5
        },
        "oncology": {
            "enable_disambiguation": True,
            "enable_synonym_expansion": True,
            "confidence_threshold": 0.6,
            "domain": "oncology"
        },
        "pharmacology": {
            "enable_disambiguation": True,
            "enable_synonym_expansion": True,
            "confidence_threshold": 0.6,
            "domain": "pharmacology"
        },
        "strict": {
            "enable_disambiguation": True,
            "enable_synonym_expansion": True,
            "confidence_threshold": 0.8
        }
    }

    config = presets.get(preset, presets["default"])
    if domain:
        config["domain"] = domain

    return EntityResolver(**config)


# Convenience functions
def resolve_entity(
    mention: str,
    context: Optional[str] = None,
    entity_type: Optional[str] = None
) -> ResolvedEntity:
    """Quick entity resolution using default resolver."""
    resolver = create_resolver()
    return resolver.resolve(mention, context, entity_type)


def batch_resolve_entities(
    mentions: List[str],
    contexts: Optional[List[str]] = None
) -> ResolutionResult:
    """Quick batch resolution using default resolver."""
    resolver = create_resolver()
    return resolver.batch_resolve(mentions, contexts)
