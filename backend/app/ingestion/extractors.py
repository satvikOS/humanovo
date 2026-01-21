"""
Entity and Relation Extractors

NLP-based extraction of biomedical entities and relationships.
"""

import re
from typing import Any, Dict, List, Optional, Set, Tuple

from pydantic import BaseModel

from app.core.logging import get_logger, LoggerMixin

logger = get_logger(__name__)


class ExtractedEntity(BaseModel):
    """An extracted biomedical entity."""

    text: str
    entity_type: str
    start: int
    end: int
    confidence: float = 1.0
    normalized_id: Optional[str] = None


class ExtractedRelation(BaseModel):
    """An extracted relationship between entities."""

    subject: ExtractedEntity
    predicate: str
    object: ExtractedEntity
    confidence: float = 1.0
    source_text: Optional[str] = None


class EntityExtractor(LoggerMixin):
    """Extracts biomedical entities from text.

    Uses pattern matching and optionally NLP models (spaCy, scispaCy).
    """

    # Common entity patterns
    GENE_PATTERN = re.compile(r'\b[A-Z][A-Z0-9]{1,10}\b')
    DRUG_PATTERN = re.compile(r'\b\w+(?:mab|nib|lib|zumab|ximab|tinib|ciclib)\b', re.IGNORECASE)
    DISEASE_PATTERN = re.compile(r'\b(?:cancer|carcinoma|tumor|tumour|melanoma|leukemia|lymphoma|syndrome|disease)\b', re.IGNORECASE)

    def __init__(self, use_nlp: bool = True):
        self.use_nlp = use_nlp
        self._nlp_model = None
        self._load_nlp_model()

    def _load_nlp_model(self) -> None:
        """Load NLP model if available."""
        if not self.use_nlp:
            return

        try:
            import spacy
            # Try to load scispaCy biomedical model
            try:
                self._nlp_model = spacy.load("en_core_sci_sm")
                self.logger.info("Loaded scispaCy model")
            except OSError:
                # Fall back to standard spaCy
                try:
                    self._nlp_model = spacy.load("en_core_web_sm")
                    self.logger.info("Loaded standard spaCy model")
                except OSError:
                    self.logger.warning("No spaCy model available, using pattern matching only")
        except ImportError:
            self.logger.warning("spaCy not installed, using pattern matching only")

    def extract(self, text: str) -> List[ExtractedEntity]:
        """Extract entities from text."""
        entities = []

        # Use NLP if available
        if self._nlp_model is not None:
            entities.extend(self._extract_with_nlp(text))

        # Always add pattern-based extraction
        entities.extend(self._extract_with_patterns(text))

        # Deduplicate by (text, type)
        seen = set()
        unique_entities = []
        for entity in entities:
            key = (entity.text.lower(), entity.entity_type)
            if key not in seen:
                seen.add(key)
                unique_entities.append(entity)

        return unique_entities

    def _extract_with_nlp(self, text: str) -> List[ExtractedEntity]:
        """Extract entities using NLP model."""
        entities = []
        doc = self._nlp_model(text)

        # Map spaCy entity types to our types
        type_mapping = {
            "GENE": "gene",
            "PROTEIN": "protein",
            "CHEMICAL": "drug",
            "DISEASE": "disease",
            "CELL_TYPE": "cell_type",
            "CELL_LINE": "cell_type",
            "ORGANISM": "organism",
            "ORG": "organism",
            "GPE": "location",
        }

        for ent in doc.ents:
            entity_type = type_mapping.get(ent.label_, "other")
            if entity_type != "other":
                entities.append(
                    ExtractedEntity(
                        text=ent.text,
                        entity_type=entity_type,
                        start=ent.start_char,
                        end=ent.end_char,
                        confidence=0.85,
                    )
                )

        return entities

    def _extract_with_patterns(self, text: str) -> List[ExtractedEntity]:
        """Extract entities using regex patterns."""
        entities = []

        # Gene-like patterns (uppercase with numbers)
        for match in self.GENE_PATTERN.finditer(text):
            # Filter out common non-gene words
            word = match.group()
            if word not in {"DNA", "RNA", "PCR", "MRI", "CT", "PET", "FDA", "NIH", "WHO"}:
                entities.append(
                    ExtractedEntity(
                        text=word,
                        entity_type="gene",
                        start=match.start(),
                        end=match.end(),
                        confidence=0.6,
                    )
                )

        # Drug-like patterns
        for match in self.DRUG_PATTERN.finditer(text):
            entities.append(
                ExtractedEntity(
                    text=match.group(),
                    entity_type="drug",
                    start=match.start(),
                    end=match.end(),
                    confidence=0.8,
                )
            )

        # Disease patterns
        for match in self.DISEASE_PATTERN.finditer(text):
            # Try to capture preceding words for full disease name
            start = match.start()
            prefix_start = max(0, start - 50)
            prefix = text[prefix_start:start]

            # Look for descriptive words before disease keyword
            full_match = match.group()
            words_before = prefix.split()[-3:]  # Last 3 words
            for word in reversed(words_before):
                if word[0].isupper() or word.lower() in {"non-small", "small", "acute", "chronic"}:
                    full_match = word + " " + full_match
                else:
                    break

            entities.append(
                ExtractedEntity(
                    text=full_match.strip(),
                    entity_type="disease",
                    start=start - (len(full_match) - len(match.group())),
                    end=match.end(),
                    confidence=0.7,
                )
            )

        return entities


class RelationExtractor(LoggerMixin):
    """Extracts relationships between entities from text."""

    # Relation patterns: (trigger_words, relation_type)
    RELATION_PATTERNS = [
        (["inhibits", "inhibit", "inhibiting", "inhibited", "blocks", "suppresses"], "inhibits"),
        (["activates", "activate", "activating", "activated", "induces", "promotes"], "activates"),
        (["regulates", "regulate", "regulating", "regulated", "modulates"], "regulates"),
        (["binds", "bind", "binding", "bound", "interacts"], "binds_to"),
        (["targets", "target", "targeting", "targeted"], "targets"),
        (["treats", "treat", "treating", "treated", "therapy for"], "treats"),
        (["causes", "cause", "causing", "caused", "leads to", "results in"], "causes"),
        (["associated with", "linked to", "correlated with"], "associated_with"),
        (["expressed in", "expression in", "found in"], "expressed_in"),
        (["part of", "component of", "member of", "belongs to"], "part_of"),
    ]

    def __init__(self):
        self.entity_extractor = EntityExtractor(use_nlp=True)

    def extract(
        self,
        text: str,
        entities: Optional[List[ExtractedEntity]] = None,
    ) -> List[ExtractedRelation]:
        """Extract relations from text.

        Args:
            text: Input text
            entities: Pre-extracted entities (extracted if not provided)

        Returns:
            List of extracted relations
        """
        if entities is None:
            entities = self.entity_extractor.extract(text)

        if len(entities) < 2:
            return []

        relations = []
        text_lower = text.lower()

        # Find relations between pairs of entities
        for i, entity1 in enumerate(entities):
            for entity2 in entities[i + 1:]:
                # Find relation between these entities
                relation = self._find_relation(text, text_lower, entity1, entity2)
                if relation:
                    relations.append(relation)

        return relations

    def _find_relation(
        self,
        text: str,
        text_lower: str,
        entity1: ExtractedEntity,
        entity2: ExtractedEntity,
    ) -> Optional[ExtractedRelation]:
        """Find relation between two entities."""
        # Get text between entities
        start = min(entity1.end, entity2.end)
        end = max(entity1.start, entity2.start)

        if end <= start:
            return None

        between_text = text_lower[start:end]

        # Check for relation patterns
        for triggers, relation_type in self.RELATION_PATTERNS:
            for trigger in triggers:
                if trigger in between_text:
                    # Determine subject and object based on position
                    if entity1.start < entity2.start:
                        subject, obj = entity1, entity2
                    else:
                        subject, obj = entity2, entity1

                    # Extract source sentence
                    source_text = self._extract_sentence(text, start, end)

                    return ExtractedRelation(
                        subject=subject,
                        predicate=relation_type,
                        object=obj,
                        confidence=0.7,
                        source_text=source_text,
                    )

        return None

    def _extract_sentence(self, text: str, start: int, end: int) -> str:
        """Extract the sentence containing the relation."""
        # Find sentence boundaries
        sentence_start = text.rfind(".", 0, start)
        sentence_start = 0 if sentence_start == -1 else sentence_start + 1

        sentence_end = text.find(".", end)
        sentence_end = len(text) if sentence_end == -1 else sentence_end + 1

        return text[sentence_start:sentence_end].strip()
