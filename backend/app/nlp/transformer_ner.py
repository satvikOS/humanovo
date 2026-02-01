"""
Transformer-based Named Entity Recognition for Biomedical Text

Supports multiple biomedical NER models:
- BioBERT-NER
- PubMedBERT-NER
- SciBERT
- Custom fine-tuned models

Entity Types:
- GENE: Genes and gene products
- DISEASE: Diseases and conditions
- DRUG: Drugs and compounds
- PROTEIN: Proteins and enzymes
- PATHWAY: Biological pathways
- CELL_TYPE: Cell types and lines
- ORGANISM: Species and organisms
- MUTATION: Genetic mutations
- BIOMARKER: Biomarkers
- ADC: Antibody-drug conjugates
- ANTIGEN: Antigens and targets
"""

import logging
import re
from dataclasses import dataclass, field
from enum import Enum
from functools import lru_cache
from typing import Any

import torch
from transformers import Pipeline, pipeline

logger = logging.getLogger(__name__)


class EntityType(str, Enum):
    """Biomedical entity types."""

    GENE = "gene"
    DISEASE = "disease"
    DRUG = "drug"
    PROTEIN = "protein"
    PATHWAY = "pathway"
    CELL_TYPE = "cell_type"
    ORGANISM = "organism"
    MUTATION = "mutation"
    BIOMARKER = "biomarker"
    ADC = "adc"
    ANTIGEN = "antigen"
    CHEMICAL = "chemical"
    CELL_LINE = "cell_line"
    DNA = "dna"
    RNA = "rna"
    SPECIES = "species"


@dataclass
class BiomedicalEntity:
    """Represents an extracted biomedical entity."""

    text: str
    entity_type: EntityType
    start: int
    end: int
    confidence: float
    normalized_id: str | None = None
    canonical_name: str | None = None
    aliases: list[str] = field(default_factory=list)
    source_model: str = ""
    context_window: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "text": self.text,
            "entity_type": self.entity_type.value,
            "start": self.start,
            "end": self.end,
            "confidence": self.confidence,
            "normalized_id": self.normalized_id,
            "canonical_name": self.canonical_name,
            "aliases": self.aliases,
            "source_model": self.source_model,
            "context_window": self.context_window,
            "metadata": self.metadata,
        }


class TransformerNER:
    """
    Transformer-based Named Entity Recognition for biomedical text.

    Uses state-of-the-art biomedical language models fine-tuned for NER.
    """

    # Model configurations
    MODEL_CONFIGS = {
        "biobert": {
            "model_name": "dmis-lab/biobert-base-cased-v1.2",
            "ner_model": "dmis-lab/biobert-v1.1-pubmed-base-cased",
            "entity_mapping": {},
        },
        "pubmedbert": {
            "model_name": "microsoft/BiomedNLP-PubMedBERT-base-uncased-abstract-fulltext",
            "ner_model": "microsoft/BiomedNLP-PubMedBERT-base-uncased-abstract-fulltext",
            "entity_mapping": {},
        },
        "scibert": {
            "model_name": "allenai/scibert_scivocab_cased",
            "ner_model": "allenai/scibert_scivocab_cased",
            "entity_mapping": {},
        },
        "bionlp": {
            "model_name": "dmis-lab/biobert-large-cased-v1.1-squad",
            "ner_model": "d4data/biomedical-ner-all",
            "entity_mapping": {
                "Amino_acid": EntityType.PROTEIN,
                "Anatomical_system": EntityType.CELL_TYPE,
                "Cancer": EntityType.DISEASE,
                "Cell": EntityType.CELL_TYPE,
                "Cellular_component": EntityType.CELL_TYPE,
                "Developing_anatomical_structure": EntityType.CELL_TYPE,
                "Gene_or_gene_product": EntityType.GENE,
                "Immaterial_anatomical_entity": EntityType.CELL_TYPE,
                "Multi-tissue_structure": EntityType.CELL_TYPE,
                "Organ": EntityType.CELL_TYPE,
                "Organism": EntityType.ORGANISM,
                "Organism_subdivision": EntityType.ORGANISM,
                "Organism_substance": EntityType.CHEMICAL,
                "Pathological_formation": EntityType.DISEASE,
                "Simple_chemical": EntityType.CHEMICAL,
                "Tissue": EntityType.CELL_TYPE,
            },
        },
    }

    # Regex patterns for entity recognition fallback
    ENTITY_PATTERNS = {
        EntityType.GENE: [
            r"\b[A-Z][A-Z0-9]{1,10}\b",  # Gene symbols like BRCA1, TP53
            r"\b[A-Z][a-z]+[0-9]+\b",  # Gene names like Myc2
            r"\bp\.[A-Z][0-9]+[A-Z]\b",  # Protein mutations
        ],
        EntityType.DRUG: [
            r"\b\w+(?:mab|nib|lib|zumab|ximab|umab|tinib|ciclib)\b",  # MAbs and small molecules
            r"\b\w+(?:platin|taxel|rubicin|mycin|statin)\b",  # Chemotherapy drugs
            r"\bADC[-\s]?\d*\b",  # ADC references
        ],
        EntityType.DISEASE: [
            r"\b\w+(?:oma|emia|itis|osis|pathy|plasia)\b",  # Disease suffixes
            r"\b(?:cancer|carcinoma|lymphoma|leukemia|melanoma|sarcoma)\b",
            r"\b(?:syndrome|disorder|disease|deficiency)\b",
        ],
        EntityType.MUTATION: [
            r"\b[A-Z][0-9]+[A-Z]\b",  # Amino acid changes
            r"\bc\.[0-9]+[ACGT]>[ACGT]\b",  # Nucleotide changes
            r"\b(?:deletion|insertion|mutation|variant|polymorphism)\b",
        ],
        EntityType.PATHWAY: [
            r"\b\w+(?:\s+pathway|\s+signaling|\s+cascade)\b",
            r"\b(?:MAPK|PI3K|AKT|mTOR|Wnt|Notch|Hedgehog|NF-κB|JAK-STAT)\b",
        ],
        EntityType.BIOMARKER: [
            r"\b(?:HER2|EGFR|PD-L1|Ki-67|CEA|CA-125|PSA|AFP)\b",
            r"\b\w+(?:\s+expression|\s+level|\s+status)\b",
        ],
        EntityType.ADC: [
            r"\b(?:antibody-drug\s+conjugate|ADC)\b",
            r"\b\w+(?:vedotin|tuxetan|ozogamicin|mertansine|deruxtecan)\b",
        ],
        EntityType.ANTIGEN: [
            r"\b(?:CD[0-9]+|HLA-[A-Z]+)\b",
            r"\b\w+(?:\s+antigen|\s+receptor)\b",
        ],
    }

    def __init__(
        self,
        model_name: str = "bionlp",
        device: str | None = None,
        use_gpu: bool = True,
        batch_size: int = 8,
        max_length: int = 512,
        confidence_threshold: float = 0.5,
        use_patterns: bool = True,
    ):
        """
        Initialize the transformer NER.

        Args:
            model_name: Name of the model configuration to use
            device: Device to use (cuda/cpu)
            use_gpu: Whether to use GPU if available
            batch_size: Batch size for inference
            max_length: Maximum sequence length
            confidence_threshold: Minimum confidence for entity extraction
            use_patterns: Whether to use regex patterns as fallback
        """
        self.model_name = model_name
        self.batch_size = batch_size
        self.max_length = max_length
        self.confidence_threshold = confidence_threshold
        self.use_patterns = use_patterns

        # Set device
        if device:
            self.device = device
        elif use_gpu and torch.cuda.is_available():
            self.device = "cuda"
        else:
            self.device = "cpu"

        # Initialize model
        self._ner_pipeline: Pipeline | None = None
        self._tokenizer = None
        self._model = None
        self._initialized = False

        # Compile regex patterns
        self._compiled_patterns: dict[EntityType, list[re.Pattern]] = {}
        for entity_type, patterns in self.ENTITY_PATTERNS.items():
            self._compiled_patterns[entity_type] = [re.compile(p, re.IGNORECASE) for p in patterns]

        logger.info(f"TransformerNER initialized with model: {model_name}, device: {self.device}")

    def _lazy_init(self):
        """Lazy initialization of the model."""
        if self._initialized:
            return

        try:
            config = self.MODEL_CONFIGS.get(self.model_name, self.MODEL_CONFIGS["bionlp"])

            logger.info(f"Loading NER model: {config['ner_model']}")

            self._ner_pipeline = pipeline(
                "ner",
                model=config["ner_model"],
                tokenizer=config["ner_model"],
                device=0 if self.device == "cuda" else -1,
                aggregation_strategy="simple",
            )

            self._initialized = True
            logger.info("NER model loaded successfully")

        except Exception as e:
            logger.warning(f"Failed to load transformer model: {e}. Using pattern-based fallback.")
            self._initialized = True  # Mark as initialized to avoid retry

    def extract_entities(self, text: str, context_window_size: int = 50) -> list[BiomedicalEntity]:
        """
        Extract biomedical entities from text.

        Args:
            text: Input text to process
            context_window_size: Size of context window around entities

        Returns:
            List of extracted biomedical entities
        """
        entities = []

        # Try transformer-based extraction
        self._lazy_init()

        if self._ner_pipeline:
            try:
                transformer_entities = self._extract_with_transformer(text, context_window_size)
                entities.extend(transformer_entities)
            except Exception as e:
                logger.warning(f"Transformer extraction failed: {e}")

        # Pattern-based extraction (fallback or supplement)
        if self.use_patterns:
            pattern_entities = self._extract_with_patterns(text, context_window_size)

            # Merge entities, avoiding duplicates
            existing_spans = {(e.start, e.end) for e in entities}
            for pe in pattern_entities:
                if (pe.start, pe.end) not in existing_spans:
                    entities.append(pe)

        # Sort by position
        entities.sort(key=lambda e: e.start)

        # Post-process entities
        entities = self._post_process_entities(entities, text)

        return entities

    def _extract_with_transformer(
        self, text: str, context_window_size: int
    ) -> list[BiomedicalEntity]:
        """Extract entities using transformer model."""
        entities = []

        # Handle long texts by chunking
        chunks = self._chunk_text(text)

        for chunk_start, chunk_text in chunks:
            try:
                results = self._ner_pipeline(chunk_text)

                for result in results:
                    if result.get("score", 0) < self.confidence_threshold:
                        continue

                    # Map entity type
                    entity_label = result.get("entity_group", result.get("entity", ""))
                    entity_type = self._map_entity_type(entity_label)

                    if entity_type is None:
                        continue

                    # Calculate absolute positions
                    start = chunk_start + result["start"]
                    end = chunk_start + result["end"]

                    # Extract context window
                    context_start = max(0, start - context_window_size)
                    context_end = min(len(text), end + context_window_size)
                    context = text[context_start:context_end]

                    entity = BiomedicalEntity(
                        text=result["word"].strip(),
                        entity_type=entity_type,
                        start=start,
                        end=end,
                        confidence=result["score"],
                        source_model=self.model_name,
                        context_window=context,
                        metadata={"raw_label": entity_label},
                    )
                    entities.append(entity)

            except Exception as e:
                logger.warning(f"Error processing chunk: {e}")

        return entities

    def _extract_with_patterns(self, text: str, context_window_size: int) -> list[BiomedicalEntity]:
        """Extract entities using regex patterns."""
        entities = []

        for entity_type, patterns in self._compiled_patterns.items():
            for pattern in patterns:
                for match in pattern.finditer(text):
                    start = match.start()
                    end = match.end()
                    matched_text = match.group()

                    # Skip very short matches
                    if len(matched_text) < 2:
                        continue

                    # Extract context window
                    context_start = max(0, start - context_window_size)
                    context_end = min(len(text), end + context_window_size)
                    context = text[context_start:context_end]

                    entity = BiomedicalEntity(
                        text=matched_text,
                        entity_type=entity_type,
                        start=start,
                        end=end,
                        confidence=0.7,  # Pattern-based confidence
                        source_model="pattern",
                        context_window=context,
                        metadata={"pattern": pattern.pattern},
                    )
                    entities.append(entity)

        return entities

    def _map_entity_type(self, label: str) -> EntityType | None:
        """Map model output label to EntityType."""
        config = self.MODEL_CONFIGS.get(self.model_name, {})
        entity_mapping = config.get("entity_mapping", {})

        # Check direct mapping
        if label in entity_mapping:
            return entity_mapping[label]

        # Standard mappings
        label_lower = label.lower()

        mappings = {
            "gene": EntityType.GENE,
            "protein": EntityType.PROTEIN,
            "disease": EntityType.DISEASE,
            "drug": EntityType.DRUG,
            "chemical": EntityType.CHEMICAL,
            "cell": EntityType.CELL_TYPE,
            "cell_type": EntityType.CELL_TYPE,
            "cell_line": EntityType.CELL_LINE,
            "organism": EntityType.ORGANISM,
            "species": EntityType.SPECIES,
            "dna": EntityType.DNA,
            "rna": EntityType.RNA,
            "mutation": EntityType.MUTATION,
            "pathway": EntityType.PATHWAY,
            "biomarker": EntityType.BIOMARKER,
        }

        for key, value in mappings.items():
            if key in label_lower:
                return value

        return None

    def _chunk_text(self, text: str) -> list[tuple[int, str]]:
        """Chunk text for processing long documents."""
        chunks = []

        if len(text) <= self.max_length:
            return [(0, text)]

        # Split by sentences/paragraphs
        sentences = re.split(r"(?<=[.!?])\s+", text)

        current_chunk = ""
        current_start = 0

        for sentence in sentences:
            if len(current_chunk) + len(sentence) <= self.max_length:
                current_chunk += sentence + " "
            else:
                if current_chunk:
                    chunks.append((current_start, current_chunk.strip()))
                current_start = text.find(sentence, current_start)
                current_chunk = sentence + " "

        if current_chunk:
            chunks.append((current_start, current_chunk.strip()))

        return chunks

    def _post_process_entities(
        self, entities: list[BiomedicalEntity], text: str
    ) -> list[BiomedicalEntity]:
        """Post-process extracted entities."""
        processed = []

        for entity in entities:
            # Clean entity text
            entity.text = entity.text.strip()

            # Skip empty or too short
            if len(entity.text) < 2:
                continue

            # Validate entity type based on context
            entity = self._validate_entity_type(entity, text)

            processed.append(entity)

        # Remove duplicates (same text and overlapping spans)
        return self._deduplicate_entities(processed)

    def _validate_entity_type(self, entity: BiomedicalEntity, text: str) -> BiomedicalEntity:
        """Validate and potentially correct entity type based on context."""
        context = entity.context_window.lower()
        entity_text = entity.text.lower()

        # ADC detection
        if any(adc in context for adc in ["antibody-drug", "conjugate", "adc", "payload"]):
            if any(
                suffix in entity_text
                for suffix in ["vedotin", "tuxetan", "ozogamicin", "mertansine", "deruxtecan"]
            ):
                entity.entity_type = EntityType.ADC

        # Biomarker detection
        if any(
            marker in context
            for marker in ["marker", "expression", "level", "positive", "negative", "status"]
        ):
            if entity.entity_type == EntityType.GENE or entity.entity_type == EntityType.PROTEIN:
                entity.entity_type = EntityType.BIOMARKER

        # Antigen detection
        if any(antigen in context for antigen in ["antigen", "target", "receptor", "cd"]):
            if entity.entity_type == EntityType.PROTEIN:
                entity.entity_type = EntityType.ANTIGEN

        return entity

    def _deduplicate_entities(self, entities: list[BiomedicalEntity]) -> list[BiomedicalEntity]:
        """Remove duplicate entities."""
        seen = set()
        unique = []

        for entity in entities:
            key = (entity.text.lower(), entity.entity_type, entity.start, entity.end)
            if key not in seen:
                seen.add(key)
                unique.append(entity)

        return unique

    def batch_extract(
        self, texts: list[str], context_window_size: int = 50
    ) -> list[list[BiomedicalEntity]]:
        """
        Extract entities from multiple texts in batch.

        Args:
            texts: List of input texts
            context_window_size: Size of context window

        Returns:
            List of entity lists for each input text
        """
        results = []

        for text in texts:
            entities = self.extract_entities(text, context_window_size)
            results.append(entities)

        return results


# Convenience function for quick extraction
@lru_cache(maxsize=1)
def get_default_ner() -> TransformerNER:
    """Get a cached default NER instance."""
    return TransformerNER()


def extract_entities(text: str) -> list[BiomedicalEntity]:
    """Quick entity extraction using default NER."""
    ner = get_default_ner()
    return ner.extract_entities(text)
