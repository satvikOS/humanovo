"""
Biomedical Relation Extraction

Extracts relationships between biomedical entities using:
- Transformer-based relation classification
- Dependency parsing patterns
- Domain-specific rules
- Co-occurrence analysis

Relation Types:
- TREATS: Drug treats disease
- CAUSES: Entity causes condition
- INHIBITS: Entity inhibits target
- ACTIVATES: Entity activates target
- TARGETS: Drug/ADC targets antigen
- EXPRESSES: Cell/tissue expresses gene/protein
- ASSOCIATES: Statistical association
- UPREGULATES: Increases expression
- DOWNREGULATES: Decreases expression
- INTERACTS: Protein-protein interaction
- BINDS: Molecular binding
- MODULATES: Biomarker modulates outcome
- MECHANISM: Drug mechanism of action
- RESISTANCE: Resistance mechanism
"""

import logging
import re
from dataclasses import dataclass, field
from enum import Enum
from functools import lru_cache
from typing import Any

import torch

from .transformer_ner import BiomedicalEntity, EntityType

logger = logging.getLogger(__name__)


class RelationType(str, Enum):
    """Biomedical relation types."""

    TREATS = "treats"
    CAUSES = "causes"
    INHIBITS = "inhibits"
    ACTIVATES = "activates"
    TARGETS = "targets"
    EXPRESSES = "expresses"
    ASSOCIATES = "associates"
    UPREGULATES = "upregulates"
    DOWNREGULATES = "downregulates"
    INTERACTS = "interacts"
    BINDS = "binds"
    MODULATES = "modulates"
    MECHANISM = "mechanism"
    RESISTANCE = "resistance"
    METABOLIZES = "metabolizes"
    TRANSPORTS = "transports"
    REGULATES = "regulates"
    PREVENTS = "prevents"
    DIAGNOSES = "diagnoses"
    BIOMARKER_OF = "biomarker_of"
    SIDE_EFFECT = "side_effect"
    CONTRAINDICATED = "contraindicated"
    SYNERGIZES = "synergizes"
    ANTAGONIZES = "antagonizes"


@dataclass
class BiomedicalRelation:
    """Represents an extracted biomedical relation."""

    subject: BiomedicalEntity
    predicate: RelationType
    object: BiomedicalEntity
    confidence: float
    evidence_text: str
    sentence: str
    assertion_type: str = "positive"  # positive, negative, speculative
    source_model: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "subject": self.subject.to_dict(),
            "predicate": self.predicate.value,
            "object": self.object.to_dict(),
            "confidence": self.confidence,
            "evidence_text": self.evidence_text,
            "sentence": self.sentence,
            "assertion_type": self.assertion_type,
            "source_model": self.source_model,
            "metadata": self.metadata,
        }

    def to_triple(self) -> tuple[str, str, str]:
        """Return as (subject, predicate, object) triple."""
        return (self.subject.text, self.predicate.value, self.object.text)


class RelationExtractor:
    """
    Extracts biomedical relations from text.

    Combines multiple extraction strategies:
    1. Transformer-based relation classification
    2. Pattern-based extraction with dependency parsing
    3. Domain-specific heuristics
    """

    # Relation patterns (subject_type, predicate_keywords, object_type)
    RELATION_PATTERNS = {
        RelationType.TREATS: {
            "subject_types": [EntityType.DRUG, EntityType.ADC],
            "object_types": [EntityType.DISEASE],
            "keywords": [
                r"\b(?:treat[s|ed|ing]?|therapy|therapeutic|treatment|cure[s|d]?)\b",
                r"\b(?:efficac(?:y|ious)|effective|beneficial)\b",
                r"\b(?:administered|prescribed|indicated)\s+(?:for|in)\b",
            ],
            "patterns": [
                r"{SUBJECT}\s+(?:is\s+)?(?:used\s+)?(?:to\s+)?treat[s]?\s+{OBJECT}",
                r"{SUBJECT}\s+(?:was\s+)?(?:shown\s+to\s+be\s+)?effective\s+(?:in|for|against)\s+{OBJECT}",
                r"{OBJECT}\s+(?:was\s+)?treated\s+with\s+{SUBJECT}",
            ],
        },
        RelationType.TARGETS: {
            "subject_types": [EntityType.DRUG, EntityType.ADC, EntityType.PROTEIN],
            "object_types": [EntityType.GENE, EntityType.PROTEIN, EntityType.ANTIGEN],
            "keywords": [
                r"\b(?:target[s|ed|ing]?|bind[s]?|recognize[s]?)\b",
                r"\b(?:directed\s+against|specific\s+(?:to|for))\b",
                r"\b(?:selective(?:ly)?\s+(?:target|inhibit))\b",
            ],
            "patterns": [
                r"{SUBJECT}\s+targets?\s+{OBJECT}",
                r"{SUBJECT}\s+(?:selectively\s+)?binds?\s+(?:to\s+)?{OBJECT}",
                r"{SUBJECT}\s+(?:is\s+)?directed\s+against\s+{OBJECT}",
            ],
        },
        RelationType.INHIBITS: {
            "subject_types": [EntityType.DRUG, EntityType.PROTEIN, EntityType.CHEMICAL],
            "object_types": [EntityType.GENE, EntityType.PROTEIN, EntityType.PATHWAY],
            "keywords": [
                r"\b(?:inhibit[s|ed|ing]?|block[s|ed|ing]?|suppress[es|ed|ing]?)\b",
                r"\b(?:antagoni[sz]e[s|d]?|antagonist)\b",
                r"\b(?:decrease[s|d]?|reduce[s|d]?|lower[s|ed]?)\b",
            ],
            "patterns": [
                r"{SUBJECT}\s+inhibits?\s+{OBJECT}",
                r"{SUBJECT}\s+blocks?\s+{OBJECT}",
                r"{SUBJECT}\s+(?:is\s+)?(?:a\s+)?(?:potent\s+)?inhibitor\s+of\s+{OBJECT}",
            ],
        },
        RelationType.ACTIVATES: {
            "subject_types": [EntityType.DRUG, EntityType.PROTEIN, EntityType.GENE],
            "object_types": [EntityType.GENE, EntityType.PROTEIN, EntityType.PATHWAY],
            "keywords": [
                r"\b(?:activat[es|ed|ing]?|stimulat[es|ed|ing]?|induc[es|ed|ing]?)\b",
                r"\b(?:agonist|upregulat[es|ed|ing]?)\b",
                r"\b(?:increase[s|d]?|enhance[s|d]?|promot[es|ed|ing]?)\b",
            ],
            "patterns": [
                r"{SUBJECT}\s+activates?\s+{OBJECT}",
                r"{SUBJECT}\s+(?:is\s+)?(?:an?\s+)?(?:potent\s+)?activator\s+of\s+{OBJECT}",
                r"{SUBJECT}\s+stimulates?\s+{OBJECT}",
            ],
        },
        RelationType.CAUSES: {
            "subject_types": [EntityType.GENE, EntityType.MUTATION, EntityType.DRUG],
            "object_types": [EntityType.DISEASE, EntityType.MUTATION],
            "keywords": [
                r"\b(?:caus[es|ed|ing]?|lead[s]?\s+to|result[s]?\s+in)\b",
                r"\b(?:induc[es|ed|ing]?|trigger[s|ed|ing]?)\b",
                r"\b(?:responsible\s+for|associated\s+with)\b",
            ],
            "patterns": [
                r"{SUBJECT}\s+(?:mutation\s+)?causes?\s+{OBJECT}",
                r"{SUBJECT}\s+leads?\s+to\s+{OBJECT}",
                r"{SUBJECT}\s+(?:is\s+)?associated\s+with\s+{OBJECT}",
            ],
        },
        RelationType.EXPRESSES: {
            "subject_types": [EntityType.CELL_TYPE, EntityType.CELL_LINE, EntityType.DISEASE],
            "object_types": [EntityType.GENE, EntityType.PROTEIN, EntityType.BIOMARKER],
            "keywords": [
                r"\b(?:express[es|ed|ing]?|overexpress[es|ed|ing]?)\b",
                r"\b(?:positive|negative)\s+(?:for|expression)\b",
                r"\b(?:high|low)\s+(?:expression|levels?)\b",
            ],
            "patterns": [
                r"{SUBJECT}\s+(?:over)?expresses?\s+{OBJECT}",
                r"{SUBJECT}\s+(?:is\s+)?(?:{OBJECT}\s+)?positive",
                r"{OBJECT}\s+(?:is\s+)?(?:highly\s+)?expressed\s+(?:in|by)\s+{SUBJECT}",
            ],
        },
        RelationType.RESISTANCE: {
            "subject_types": [EntityType.MUTATION, EntityType.GENE, EntityType.DISEASE],
            "object_types": [EntityType.DRUG, EntityType.ADC],
            "keywords": [
                r"\b(?:resistan(?:t|ce)|refractor(?:y|iness))\b",
                r"\b(?:insensitiv(?:e|ity)|non-?respons(?:e|ive))\b",
                r"\b(?:fail[s|ed|ing]?\s+to\s+respond)\b",
            ],
            "patterns": [
                r"{SUBJECT}\s+(?:confers?\s+)?resistance\s+to\s+{OBJECT}",
                r"{SUBJECT}\s+(?:mutation\s+)?(?:is\s+)?resistant\s+to\s+{OBJECT}",
                r"{OBJECT}\s+resistance\s+(?:due\s+to|caused\s+by)\s+{SUBJECT}",
            ],
        },
        RelationType.MODULATES: {
            "subject_types": [EntityType.BIOMARKER, EntityType.GENE, EntityType.PROTEIN],
            "object_types": [EntityType.DISEASE, EntityType.PATHWAY],
            "keywords": [
                r"\b(?:modulat[es|ed|ing]?|regulat[es|ed|ing]?)\b",
                r"\b(?:influence[s|d]?|affect[s|ed]?|impact[s|ed]?)\b",
                r"\b(?:correlat[es|ed]?\s+with|predict[s]?)\b",
            ],
            "patterns": [
                r"{SUBJECT}\s+modulates?\s+{OBJECT}",
                r"{SUBJECT}\s+(?:expression\s+)?(?:is\s+)?(?:positively|negatively)?\s+correlated\s+with\s+{OBJECT}",
                r"{SUBJECT}\s+predicts?\s+{OBJECT}\s+(?:outcome|response)",
            ],
        },
        RelationType.MECHANISM: {
            "subject_types": [EntityType.DRUG, EntityType.ADC],
            "object_types": [EntityType.GENE, EntityType.PROTEIN, EntityType.PATHWAY],
            "keywords": [
                r"\b(?:mechanism\s+of\s+action|MOA|mode\s+of\s+action)\b",
                r"\b(?:works?\s+by|acts?\s+(?:by|through|via))\b",
                r"\b(?:mediated\s+(?:by|through)|via)\b",
            ],
            "patterns": [
                r"{SUBJECT}\s+(?:mechanism\s+)?(?:involves?|includes?)\s+{OBJECT}",
                r"{SUBJECT}\s+acts?\s+(?:by|through|via)\s+{OBJECT}",
                r"{SUBJECT}\s+(?:is\s+)?mediated\s+(?:by|through)\s+{OBJECT}",
            ],
        },
        RelationType.BIOMARKER_OF: {
            "subject_types": [EntityType.BIOMARKER, EntityType.GENE, EntityType.PROTEIN],
            "object_types": [EntityType.DISEASE, EntityType.DRUG],
            "keywords": [
                r"\b(?:biomarker|marker|indicator)\b",
                r"\b(?:predictive|prognostic|diagnostic)\b",
                r"\b(?:predicts?\s+response|response\s+predict(?:or|ion))\b",
            ],
            "patterns": [
                r"{SUBJECT}\s+(?:is\s+)?(?:a\s+)?(?:predictive\s+)?biomarker\s+(?:of|for)\s+{OBJECT}",
                r"{SUBJECT}\s+predicts?\s+(?:response\s+to\s+)?{OBJECT}",
                r"{SUBJECT}\s+(?:positive|negative)\s+(?:patients\s+)?(?:respond|benefit)\s+(?:to|from)\s+{OBJECT}",
            ],
        },
        RelationType.INTERACTS: {
            "subject_types": [EntityType.PROTEIN, EntityType.GENE, EntityType.DRUG],
            "object_types": [EntityType.PROTEIN, EntityType.GENE, EntityType.DRUG],
            "keywords": [
                r"\b(?:interact[s|ed|ing]?\s+with|interaction)\b",
                r"\b(?:complex\s+with|form[s]?\s+(?:a\s+)?complex)\b",
                r"\b(?:bind[s]?\s+to|binding)\b",
            ],
            "patterns": [
                r"{SUBJECT}\s+interacts?\s+with\s+{OBJECT}",
                r"{SUBJECT}\s+(?:and\s+)?{OBJECT}\s+(?:form\s+)?(?:a\s+)?complex",
                r"{SUBJECT}\s+binds?\s+(?:to\s+)?{OBJECT}",
            ],
        },
    }

    def __init__(
        self,
        model_name: str = "allenai/scibert_scivocab_cased",
        device: str | None = None,
        confidence_threshold: float = 0.5,
        max_entity_distance: int = 100,
        use_patterns: bool = True,
    ):
        """
        Initialize the relation extractor.

        Args:
            model_name: Name of transformer model for classification
            device: Device to use (cuda/cpu)
            confidence_threshold: Minimum confidence threshold
            max_entity_distance: Maximum character distance between entities
            use_patterns: Whether to use pattern-based extraction
        """
        self.model_name = model_name
        self.confidence_threshold = confidence_threshold
        self.max_entity_distance = max_entity_distance
        self.use_patterns = use_patterns

        if device:
            self.device = device
        elif torch.cuda.is_available():
            self.device = "cuda"
        else:
            self.device = "cpu"

        # Compile keyword patterns
        self._compiled_keywords: dict[RelationType, list[re.Pattern]] = {}
        for rel_type, config in self.RELATION_PATTERNS.items():
            self._compiled_keywords[rel_type] = [
                re.compile(kw, re.IGNORECASE) for kw in config["keywords"]
            ]

        # Initialize model (lazy)
        self._classifier = None
        self._initialized = False

        logger.info(f"RelationExtractor initialized, device: {self.device}")

    def extract_relations(
        self, text: str, entities: list[BiomedicalEntity]
    ) -> list[BiomedicalRelation]:
        """
        Extract relations between entities in text.

        Args:
            text: Input text
            entities: List of entities extracted from text

        Returns:
            List of extracted relations
        """
        relations = []

        # Generate entity pairs
        entity_pairs = self._generate_entity_pairs(entities)

        # Split text into sentences
        sentences = self._split_sentences(text)

        for subj, obj in entity_pairs:
            # Find sentence containing both entities
            sentence = self._find_containing_sentence(sentences, subj, obj, text)

            if not sentence:
                continue

            # Extract relations using patterns
            if self.use_patterns:
                pattern_relations = self._extract_with_patterns(sentence, subj, obj)
                relations.extend(pattern_relations)

            # Extract relations using keyword matching
            keyword_relations = self._extract_with_keywords(sentence, subj, obj)

            # Merge, avoiding duplicates
            existing_triples = {r.to_triple() for r in relations}
            for rel in keyword_relations:
                if rel.to_triple() not in existing_triples:
                    relations.append(rel)

        # Post-process relations
        relations = self._post_process_relations(relations)

        return relations

    def _generate_entity_pairs(
        self, entities: list[BiomedicalEntity]
    ) -> list[tuple[BiomedicalEntity, BiomedicalEntity]]:
        """Generate candidate entity pairs for relation extraction."""
        pairs = []

        for i, e1 in enumerate(entities):
            for j, e2 in enumerate(entities):
                if i >= j:
                    continue

                # Check distance
                distance = abs(e1.start - e2.end)
                if distance > self.max_entity_distance:
                    continue

                # Order by position
                if e1.start < e2.start:
                    pairs.append((e1, e2))
                else:
                    pairs.append((e2, e1))

        return pairs

    def _split_sentences(self, text: str) -> list[tuple[int, int, str]]:
        """Split text into sentences with positions."""
        sentences = []
        pattern = re.compile(r"[.!?]+\s+|\n\n+")

        start = 0
        for match in pattern.finditer(text):
            end = match.end()
            sentence = text[start:end].strip()
            if sentence:
                sentences.append((start, end, sentence))
            start = end

        # Add remaining text
        if start < len(text):
            sentence = text[start:].strip()
            if sentence:
                sentences.append((start, len(text), sentence))

        return sentences

    def _find_containing_sentence(
        self,
        sentences: list[tuple[int, int, str]],
        subj: BiomedicalEntity,
        obj: BiomedicalEntity,
        full_text: str,
    ) -> str | None:
        """Find sentence containing both entities."""
        for start, end, sentence in sentences:
            if start <= subj.start and subj.end <= end:
                if start <= obj.start and obj.end <= end:
                    return sentence

        # Fallback: extract context around entities
        min_pos = min(subj.start, obj.start)
        max_pos = max(subj.end, obj.end)
        context_start = max(0, min_pos - 50)
        context_end = min(len(full_text), max_pos + 50)

        return full_text[context_start:context_end]

    def _extract_with_patterns(
        self, sentence: str, subj: BiomedicalEntity, obj: BiomedicalEntity
    ) -> list[BiomedicalRelation]:
        """Extract relations using predefined patterns."""
        relations = []

        for rel_type, config in self.RELATION_PATTERNS.items():
            # Check type compatibility
            if subj.entity_type not in config["subject_types"]:
                continue
            if obj.entity_type not in config["object_types"]:
                continue

            # Check patterns
            for pattern_template in config.get("patterns", []):
                # Build pattern with entity placeholders
                pattern = pattern_template.replace("{SUBJECT}", re.escape(subj.text)).replace(
                    "{OBJECT}", re.escape(obj.text)
                )

                if re.search(pattern, sentence, re.IGNORECASE):
                    relation = BiomedicalRelation(
                        subject=subj,
                        predicate=rel_type,
                        object=obj,
                        confidence=0.8,
                        evidence_text=sentence,
                        sentence=sentence,
                        source_model="pattern",
                        metadata={"pattern": pattern_template},
                    )
                    relations.append(relation)
                    break

        return relations

    def _extract_with_keywords(
        self, sentence: str, subj: BiomedicalEntity, obj: BiomedicalEntity
    ) -> list[BiomedicalRelation]:
        """Extract relations using keyword matching."""
        relations = []
        sentence_lower = sentence.lower()

        for rel_type, config in self.RELATION_PATTERNS.items():
            # Check type compatibility
            if subj.entity_type not in config["subject_types"]:
                continue
            if obj.entity_type not in config["object_types"]:
                continue

            # Check keywords
            for pattern in self._compiled_keywords[rel_type]:
                if pattern.search(sentence_lower):
                    # Verify both entities are present
                    if subj.text.lower() in sentence_lower and obj.text.lower() in sentence_lower:
                        relation = BiomedicalRelation(
                            subject=subj,
                            predicate=rel_type,
                            object=obj,
                            confidence=0.6,
                            evidence_text=sentence,
                            sentence=sentence,
                            source_model="keyword",
                            metadata={"keyword_pattern": pattern.pattern},
                        )
                        relations.append(relation)
                        break

        return relations

    def _post_process_relations(
        self, relations: list[BiomedicalRelation]
    ) -> list[BiomedicalRelation]:
        """Post-process extracted relations."""
        # Remove duplicates, keeping highest confidence
        unique_relations: dict[tuple, BiomedicalRelation] = {}

        for rel in relations:
            key = rel.to_triple()
            if key not in unique_relations or rel.confidence > unique_relations[key].confidence:
                unique_relations[key] = rel

        return list(unique_relations.values())

    def batch_extract(
        self, texts: list[str], entities_list: list[list[BiomedicalEntity]]
    ) -> list[list[BiomedicalRelation]]:
        """
        Extract relations from multiple texts.

        Args:
            texts: List of input texts
            entities_list: List of entity lists for each text

        Returns:
            List of relation lists for each text
        """
        results = []

        for text, entities in zip(texts, entities_list):
            relations = self.extract_relations(text, entities)
            results.append(relations)

        return results


# Convenience function
@lru_cache(maxsize=1)
def get_default_relation_extractor() -> RelationExtractor:
    """Get a cached default relation extractor."""
    return RelationExtractor()


def extract_relations(text: str, entities: list[BiomedicalEntity]) -> list[BiomedicalRelation]:
    """Quick relation extraction using default extractor."""
    extractor = get_default_relation_extractor()
    return extractor.extract_relations(text, entities)
