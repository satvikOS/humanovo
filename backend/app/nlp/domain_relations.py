"""
Domain-Specific Relation Encoding for Biomedical Knowledge

Encodes specialized biomedical domain relations:
- Drug–mechanism→Gene/Pathway
- Biomarker–modulates→Outcome
- ADC–targets→Antigen
- Gene–associates→Disease
- Mutation–confers→Resistance
- Drug–treats→Indication
- Protein–interacts→Protein

Provides:
- Semantic typing of relations
- Relation validation rules
- Ontology-aligned relation encoding
- Evidence-weighted relation scoring
"""

import logging
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any

from .relation_extractor import BiomedicalRelation, RelationType
from .transformer_ner import BiomedicalEntity, EntityType

logger = logging.getLogger(__name__)


class DomainRelationType(StrEnum):
    """Domain-specific relation types aligned with biomedical ontologies."""

    # Drug/Treatment Relations
    DRUG_TREATS_DISEASE = "drug_treats_disease"
    DRUG_MECHANISM_GENE = "drug_mechanism_gene"
    DRUG_MECHANISM_PATHWAY = "drug_mechanism_pathway"
    DRUG_TARGETS_PROTEIN = "drug_targets_protein"
    DRUG_INHIBITS_PROTEIN = "drug_inhibits_protein"
    DRUG_ACTIVATES_PATHWAY = "drug_activates_pathway"
    DRUG_METABOLIZED_BY = "drug_metabolized_by"
    DRUG_INTERACTS_DRUG = "drug_interacts_drug"

    # ADC-Specific Relations
    ADC_TARGETS_ANTIGEN = "adc_targets_antigen"
    ADC_DELIVERS_PAYLOAD = "adc_delivers_payload"
    ADC_LINKER_TYPE = "adc_linker_type"
    ADC_DAR = "adc_dar"  # Drug-to-antibody ratio

    # Biomarker Relations
    BIOMARKER_MODULATES_OUTCOME = "biomarker_modulates_outcome"
    BIOMARKER_PREDICTS_RESPONSE = "biomarker_predicts_response"
    BIOMARKER_INDICATES_DISEASE = "biomarker_indicates_disease"
    BIOMARKER_PROGNOSTIC_FOR = "biomarker_prognostic_for"
    BIOMARKER_DIAGNOSTIC_FOR = "biomarker_diagnostic_for"

    # Gene/Mutation Relations
    GENE_ASSOCIATES_DISEASE = "gene_associates_disease"
    GENE_ENCODES_PROTEIN = "gene_encodes_protein"
    GENE_REGULATES_GENE = "gene_regulates_gene"
    MUTATION_CAUSES_DISEASE = "mutation_causes_disease"
    MUTATION_CONFERS_RESISTANCE = "mutation_confers_resistance"
    MUTATION_AFFECTS_FUNCTION = "mutation_affects_function"

    # Protein Relations
    PROTEIN_INTERACTS_PROTEIN = "protein_interacts_protein"
    PROTEIN_PHOSPHORYLATES = "protein_phosphorylates"
    PROTEIN_ACTIVATES_PATHWAY = "protein_activates_pathway"
    PROTEIN_INHIBITS_PATHWAY = "protein_inhibits_pathway"

    # Pathway Relations
    PATHWAY_INVOLVED_IN_DISEASE = "pathway_involved_in_disease"
    PATHWAY_REGULATES_PROCESS = "pathway_regulates_process"

    # Clinical Relations
    OUTCOME_ASSOCIATED_WITH = "outcome_associated_with"
    RESISTANCE_TO_DRUG = "resistance_to_drug"
    SENSITIVITY_TO_DRUG = "sensitivity_to_drug"

    # Cell/Tissue Relations
    CELL_EXPRESSES_GENE = "cell_expresses_gene"
    CELL_EXPRESSES_PROTEIN = "cell_expresses_protein"
    TISSUE_AFFECTED_BY_DISEASE = "tissue_affected_by_disease"


@dataclass
class DomainRelation:
    """Represents a domain-specific biomedical relation."""

    source: BiomedicalEntity
    relation_type: DomainRelationType
    target: BiomedicalEntity
    confidence: float
    evidence_text: str
    evidence_weight: float = 1.0
    provenance: dict[str, Any] = field(default_factory=dict)
    ontology_mapping: str | None = None  # e.g., "RO:0002212" for RO ontology
    bidirectional: bool = False
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "source": self.source.to_dict(),
            "relation_type": self.relation_type.value,
            "target": self.target.to_dict(),
            "confidence": self.confidence,
            "evidence_text": self.evidence_text,
            "evidence_weight": self.evidence_weight,
            "provenance": self.provenance,
            "ontology_mapping": self.ontology_mapping,
            "bidirectional": self.bidirectional,
            "metadata": self.metadata,
        }

    def to_triple(self) -> tuple[str, str, str]:
        """Return as (source, relation, target) triple."""
        return (self.source.text, self.relation_type.value, self.target.text)

    def to_cypher(self) -> str:
        """Generate Cypher query for Neo4j."""
        source_type = self.source.entity_type.value.upper()
        target_type = self.target.entity_type.value.upper()
        rel_type = self.relation_type.value.upper().replace("-", "_")

        return f"""
        MERGE (s:{source_type} {{name: '{self.source.text}'}})
        MERGE (t:{target_type} {{name: '{self.target.text}'}})
        MERGE (s)-[r:{rel_type}]->(t)
        SET r.confidence = {self.confidence},
            r.evidence_weight = {self.evidence_weight}
        RETURN s, r, t
        """


class DomainRelationEncoder:
    """
    Encodes biomedical relations into domain-specific typed relations.

    Maps generic relations to ontology-aligned domain relations with:
    - Type validation
    - Semantic constraints
    - Evidence weighting
    - Ontology alignment
    """

    # Valid relation mappings: (subject_types, object_types) -> DomainRelationType
    RELATION_SCHEMA = {
        DomainRelationType.DRUG_TREATS_DISEASE: {
            "subject_types": {EntityType.DRUG, EntityType.ADC},
            "object_types": {EntityType.DISEASE},
            "source_relations": {RelationType.TREATS},
            "ontology": "RO:0002606",  # treats
            "bidirectional": False,
        },
        DomainRelationType.DRUG_MECHANISM_GENE: {
            "subject_types": {EntityType.DRUG},
            "object_types": {EntityType.GENE},
            "source_relations": {
                RelationType.MECHANISM,
                RelationType.TARGETS,
                RelationType.INHIBITS,
            },
            "ontology": "RO:0002434",  # interacts with
            "bidirectional": False,
        },
        DomainRelationType.DRUG_MECHANISM_PATHWAY: {
            "subject_types": {EntityType.DRUG},
            "object_types": {EntityType.PATHWAY},
            "source_relations": {
                RelationType.MECHANISM,
                RelationType.INHIBITS,
                RelationType.ACTIVATES,
            },
            "ontology": "RO:0002448",  # directly regulates activity of
            "bidirectional": False,
        },
        DomainRelationType.DRUG_TARGETS_PROTEIN: {
            "subject_types": {EntityType.DRUG},
            "object_types": {EntityType.PROTEIN, EntityType.ANTIGEN},
            "source_relations": {RelationType.TARGETS, RelationType.BINDS},
            "ontology": "RO:0002436",  # molecularly interacts with
            "bidirectional": False,
        },
        DomainRelationType.ADC_TARGETS_ANTIGEN: {
            "subject_types": {EntityType.ADC},
            "object_types": {EntityType.ANTIGEN, EntityType.PROTEIN},
            "source_relations": {RelationType.TARGETS, RelationType.BINDS},
            "ontology": "RO:0002436",
            "bidirectional": False,
        },
        DomainRelationType.BIOMARKER_MODULATES_OUTCOME: {
            "subject_types": {EntityType.BIOMARKER, EntityType.GENE, EntityType.PROTEIN},
            "object_types": {EntityType.DISEASE},
            "source_relations": {RelationType.MODULATES, RelationType.BIOMARKER_OF},
            "ontology": "RO:0002211",  # regulates
            "bidirectional": False,
        },
        DomainRelationType.BIOMARKER_PREDICTS_RESPONSE: {
            "subject_types": {EntityType.BIOMARKER, EntityType.GENE},
            "object_types": {EntityType.DRUG, EntityType.ADC},
            "source_relations": {RelationType.BIOMARKER_OF, RelationType.MODULATES},
            "ontology": None,
            "bidirectional": False,
        },
        DomainRelationType.GENE_ASSOCIATES_DISEASE: {
            "subject_types": {EntityType.GENE},
            "object_types": {EntityType.DISEASE},
            "source_relations": {RelationType.ASSOCIATES, RelationType.CAUSES},
            "ontology": "RO:0002200",  # has phenotype
            "bidirectional": False,
        },
        DomainRelationType.MUTATION_CONFERS_RESISTANCE: {
            "subject_types": {EntityType.MUTATION, EntityType.GENE},
            "object_types": {EntityType.DRUG, EntityType.ADC},
            "source_relations": {RelationType.RESISTANCE},
            "ontology": None,
            "bidirectional": False,
        },
        DomainRelationType.PROTEIN_INTERACTS_PROTEIN: {
            "subject_types": {EntityType.PROTEIN},
            "object_types": {EntityType.PROTEIN},
            "source_relations": {RelationType.INTERACTS, RelationType.BINDS},
            "ontology": "RO:0002436",
            "bidirectional": True,
        },
        DomainRelationType.CELL_EXPRESSES_GENE: {
            "subject_types": {EntityType.CELL_TYPE, EntityType.CELL_LINE},
            "object_types": {EntityType.GENE, EntityType.PROTEIN, EntityType.BIOMARKER},
            "source_relations": {RelationType.EXPRESSES},
            "ontology": "RO:0002292",  # expresses
            "bidirectional": False,
        },
        DomainRelationType.DRUG_INHIBITS_PROTEIN: {
            "subject_types": {EntityType.DRUG},
            "object_types": {EntityType.PROTEIN, EntityType.GENE},
            "source_relations": {RelationType.INHIBITS},
            "ontology": "RO:0002449",  # directly negatively regulates
            "bidirectional": False,
        },
        DomainRelationType.PATHWAY_INVOLVED_IN_DISEASE: {
            "subject_types": {EntityType.PATHWAY},
            "object_types": {EntityType.DISEASE},
            "source_relations": {RelationType.ASSOCIATES, RelationType.CAUSES},
            "ontology": "RO:0002331",  # involved in
            "bidirectional": False,
        },
    }

    # ADC-specific patterns
    ADC_PATTERNS = {
        "target_keywords": ["targets", "directed against", "binds to", "recognizes"],
        "payload_keywords": ["conjugated", "payload", "warhead", "cytotoxic agent"],
        "linker_keywords": ["linker", "cleavable", "non-cleavable", "peptide linker"],
    }

    # Evidence weight factors
    EVIDENCE_WEIGHTS = {
        "clinical_trial": 1.0,
        "meta_analysis": 0.95,
        "randomized_controlled": 0.9,
        "cohort_study": 0.75,
        "case_control": 0.7,
        "case_report": 0.5,
        "in_vitro": 0.4,
        "in_silico": 0.3,
        "expert_opinion": 0.25,
        "default": 0.5,
    }

    def __init__(
        self,
        confidence_threshold: float = 0.5,
        require_valid_schema: bool = True,
        include_ontology: bool = True,
    ):
        """
        Initialize the domain relation encoder.

        Args:
            confidence_threshold: Minimum confidence for relation encoding
            require_valid_schema: Only encode relations matching schema
            include_ontology: Include ontology mappings
        """
        self.confidence_threshold = confidence_threshold
        self.require_valid_schema = require_valid_schema
        self.include_ontology = include_ontology

        logger.info("DomainRelationEncoder initialized")

    def encode_relations(
        self, relations: list[BiomedicalRelation], evidence_context: str | None = None
    ) -> list[DomainRelation]:
        """
        Encode generic relations into domain-specific typed relations.

        Args:
            relations: List of extracted relations
            evidence_context: Optional context for evidence weighting

        Returns:
            List of domain-encoded relations
        """
        encoded = []

        for relation in relations:
            domain_rel = self._encode_single_relation(relation, evidence_context)
            if domain_rel:
                encoded.append(domain_rel)

        return encoded

    def _encode_single_relation(
        self, relation: BiomedicalRelation, evidence_context: str | None
    ) -> DomainRelation | None:
        """Encode a single relation."""
        # Find matching domain relation type
        domain_type = self._find_domain_type(relation)

        if domain_type is None:
            if self.require_valid_schema:
                return None
            # Fall back to generic mapping
            domain_type = self._generic_mapping(relation)

        if domain_type is None:
            return None

        # Get schema info
        schema = self.RELATION_SCHEMA.get(domain_type, {})

        # Calculate evidence weight
        evidence_weight = self._calculate_evidence_weight(relation.evidence_text, evidence_context)

        # Get ontology mapping
        ontology = schema.get("ontology") if self.include_ontology else None

        # Build provenance
        provenance = {
            "source_relation": relation.predicate.value,
            "source_model": relation.source_model,
            "assertion_type": relation.assertion_type,
            "evidence_text": relation.evidence_text[:500],  # Truncate
        }

        return DomainRelation(
            source=relation.subject,
            relation_type=domain_type,
            target=relation.object,
            confidence=relation.confidence,
            evidence_text=relation.evidence_text,
            evidence_weight=evidence_weight,
            provenance=provenance,
            ontology_mapping=ontology,
            bidirectional=schema.get("bidirectional", False),
            metadata={"original_predicate": relation.predicate.value},
        )

    def _find_domain_type(self, relation: BiomedicalRelation) -> DomainRelationType | None:
        """Find matching domain relation type for a relation."""
        subject_type = relation.subject.entity_type
        object_type = relation.object.entity_type
        predicate = relation.predicate

        for domain_type, schema in self.RELATION_SCHEMA.items():
            # Check type compatibility
            if subject_type not in schema["subject_types"]:
                continue
            if object_type not in schema["object_types"]:
                continue
            # Check predicate compatibility
            if predicate in schema["source_relations"]:
                return domain_type

        return None

    def _generic_mapping(self, relation: BiomedicalRelation) -> DomainRelationType | None:
        """Create generic domain mapping when no schema matches."""
        predicate = relation.predicate

        # Generic mappings based on predicate
        generic_map = {
            RelationType.TREATS: DomainRelationType.DRUG_TREATS_DISEASE,
            RelationType.TARGETS: DomainRelationType.DRUG_TARGETS_PROTEIN,
            RelationType.INHIBITS: DomainRelationType.DRUG_INHIBITS_PROTEIN,
            RelationType.INTERACTS: DomainRelationType.PROTEIN_INTERACTS_PROTEIN,
            RelationType.EXPRESSES: DomainRelationType.CELL_EXPRESSES_GENE,
            RelationType.RESISTANCE: DomainRelationType.MUTATION_CONFERS_RESISTANCE,
            RelationType.BIOMARKER_OF: DomainRelationType.BIOMARKER_MODULATES_OUTCOME,
        }

        return generic_map.get(predicate)

    def _calculate_evidence_weight(self, evidence_text: str, context: str | None) -> float:
        """Calculate evidence weight based on source quality."""
        text = (evidence_text + " " + (context or "")).lower()

        # Check for evidence type indicators
        if "meta-analysis" in text or "systematic review" in text:
            return self.EVIDENCE_WEIGHTS["meta_analysis"]
        elif "randomized" in text and "controlled" in text:
            return self.EVIDENCE_WEIGHTS["randomized_controlled"]
        elif "clinical trial" in text or "phase" in text:
            return self.EVIDENCE_WEIGHTS["clinical_trial"]
        elif "cohort" in text:
            return self.EVIDENCE_WEIGHTS["cohort_study"]
        elif "case-control" in text:
            return self.EVIDENCE_WEIGHTS["case_control"]
        elif "case report" in text:
            return self.EVIDENCE_WEIGHTS["case_report"]
        elif "in vitro" in text or "cell line" in text:
            return self.EVIDENCE_WEIGHTS["in_vitro"]
        elif "in silico" in text or "computational" in text:
            return self.EVIDENCE_WEIGHTS["in_silico"]

        return self.EVIDENCE_WEIGHTS["default"]

    def encode_adc_relations(
        self, text: str, entities: list[BiomedicalEntity]
    ) -> list[DomainRelation]:
        """
        Extract ADC-specific relations from text.

        Args:
            text: Input text
            entities: Extracted entities

        Returns:
            List of ADC-specific domain relations
        """
        relations = []
        text_lower = text.lower()

        # Find ADC entities
        adc_entities = [e for e in entities if e.entity_type == EntityType.ADC]
        antigen_entities = [
            e for e in entities if e.entity_type in {EntityType.ANTIGEN, EntityType.PROTEIN}
        ]

        # ADC-Antigen relations
        for adc in adc_entities:
            for antigen in antigen_entities:
                # Check for targeting keywords
                for keyword in self.ADC_PATTERNS["target_keywords"]:
                    if keyword in text_lower:
                        relation = DomainRelation(
                            source=adc,
                            relation_type=DomainRelationType.ADC_TARGETS_ANTIGEN,
                            target=antigen,
                            confidence=0.75,
                            evidence_text=text,
                            evidence_weight=0.7,
                            provenance={"extraction_method": "adc_pattern"},
                            ontology_mapping="RO:0002436",
                            bidirectional=False,
                        )
                        relations.append(relation)
                        break

        return relations

    def validate_relation(self, relation: DomainRelation) -> tuple[bool, list[str]]:
        """
        Validate a domain relation against schema.

        Args:
            relation: Relation to validate

        Returns:
            Tuple of (is_valid, list of issues)
        """
        issues = []
        schema = self.RELATION_SCHEMA.get(relation.relation_type)

        if schema is None:
            issues.append(f"Unknown relation type: {relation.relation_type}")
            return False, issues

        # Check subject type
        if relation.source.entity_type not in schema["subject_types"]:
            issues.append(
                f"Invalid subject type {relation.source.entity_type} "
                f"for relation {relation.relation_type}"
            )

        # Check object type
        if relation.target.entity_type not in schema["object_types"]:
            issues.append(
                f"Invalid object type {relation.target.entity_type} "
                f"for relation {relation.relation_type}"
            )

        # Check confidence
        if relation.confidence < self.confidence_threshold:
            issues.append(
                f"Confidence {relation.confidence} below threshold {self.confidence_threshold}"
            )

        return len(issues) == 0, issues

    def get_relation_statistics(self, relations: list[DomainRelation]) -> dict[str, Any]:
        """
        Calculate statistics for a set of relations.

        Args:
            relations: List of domain relations

        Returns:
            Dictionary with statistics
        """
        stats = {
            "total_relations": len(relations),
            "relation_types": {},
            "entity_types": {"subjects": {}, "objects": {}},
            "avg_confidence": 0.0,
            "avg_evidence_weight": 0.0,
            "bidirectional_count": 0,
            "ontology_mapped_count": 0,
        }

        if not relations:
            return stats

        confidences = []
        weights = []

        for rel in relations:
            # Count relation types
            rt = rel.relation_type.value
            stats["relation_types"][rt] = stats["relation_types"].get(rt, 0) + 1

            # Count entity types
            st = rel.source.entity_type.value
            ot = rel.target.entity_type.value
            stats["entity_types"]["subjects"][st] = stats["entity_types"]["subjects"].get(st, 0) + 1
            stats["entity_types"]["objects"][ot] = stats["entity_types"]["objects"].get(ot, 0) + 1

            # Collect metrics
            confidences.append(rel.confidence)
            weights.append(rel.evidence_weight)

            if rel.bidirectional:
                stats["bidirectional_count"] += 1
            if rel.ontology_mapping:
                stats["ontology_mapped_count"] += 1

        stats["avg_confidence"] = sum(confidences) / len(confidences)
        stats["avg_evidence_weight"] = sum(weights) / len(weights)

        return stats

    def export_to_rdf(self, relations: list[DomainRelation]) -> str:
        """
        Export relations to RDF/Turtle format.

        Args:
            relations: List of domain relations

        Returns:
            RDF Turtle string
        """
        lines = [
            "@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .",
            "@prefix obo: <http://purl.obolibrary.org/obo/> .",
            "@prefix genup: <http://genup.io/ontology/> .",
            "",
        ]

        for i, rel in enumerate(relations):
            source_id = f"genup:entity_{i}_s"
            target_id = f"genup:entity_{i}_t"

            # Source entity
            lines.append(f"{source_id} a genup:{rel.source.entity_type.value} ;")
            lines.append(f'    rdfs:label "{rel.source.text}" .')

            # Target entity
            lines.append(f"{target_id} a genup:{rel.target.entity_type.value} ;")
            lines.append(f'    rdfs:label "{rel.target.text}" .')

            # Relation
            predicate = f"genup:{rel.relation_type.value}"
            if rel.ontology_mapping:
                predicate = f"obo:{rel.ontology_mapping.replace(':', '_')}"

            lines.append(f"{source_id} {predicate} {target_id} .")
            lines.append("")

        return "\n".join(lines)


# Convenience function
def encode_relations(
    relations: list[BiomedicalRelation], evidence_context: str | None = None
) -> list[DomainRelation]:
    """Quick relation encoding using default encoder."""
    encoder = DomainRelationEncoder()
    return encoder.encode_relations(relations, evidence_context)
