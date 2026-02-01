"""
Controlled Vocabulary Mapping

Maps entities to standardized controlled vocabularies:
- UMLS: Unified Medical Language System
- MeSH: Medical Subject Headings
- DrugBank: Comprehensive drug database
- UniProt: Protein sequence and annotation
- NCBI Gene: Gene database
- ChEBI: Chemical entities
- HGNC: Human gene nomenclature
- OMIM: Genetic diseases
- GO: Gene Ontology
- KEGG: Pathway database
"""

import logging
import re
from dataclasses import dataclass, field
from enum import Enum
from typing import Any

logger = logging.getLogger(__name__)


class VocabularySource(str, Enum):
    """Supported controlled vocabulary sources."""

    UMLS = "umls"
    MESH = "mesh"
    DRUGBANK = "drugbank"
    UNIPROT = "uniprot"
    NCBI_GENE = "ncbi_gene"
    CHEBI = "chebi"
    HGNC = "hgnc"
    OMIM = "omim"
    GO = "gene_ontology"
    KEGG = "kegg"
    CHEMBL = "chembl"
    PUBCHEM = "pubchem"
    RXNORM = "rxnorm"
    ICD10 = "icd10"
    ICD11 = "icd11"
    SNOMED = "snomed_ct"
    DOID = "disease_ontology"
    HP = "human_phenotype"
    MONDO = "mondo"
    NCIT = "nci_thesaurus"


@dataclass
class VocabularyEntry:
    """Represents an entry in a controlled vocabulary."""

    source: VocabularySource
    identifier: str
    name: str
    synonyms: list[str] = field(default_factory=list)
    definition: str | None = None
    semantic_types: list[str] = field(default_factory=list)
    cross_references: dict[str, list[str]] = field(default_factory=dict)
    hierarchy: list[str] = field(default_factory=list)  # Parent terms
    properties: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "source": self.source.value,
            "identifier": self.identifier,
            "name": self.name,
            "synonyms": self.synonyms,
            "definition": self.definition,
            "semantic_types": self.semantic_types,
            "cross_references": self.cross_references,
            "hierarchy": self.hierarchy,
            "properties": self.properties,
        }

    def get_full_id(self) -> str:
        """Get fully qualified ID."""
        return f"{self.source.value}:{self.identifier}"


@dataclass
class MappingResult:
    """Result of vocabulary mapping."""

    query: str
    entries: list[VocabularyEntry] = field(default_factory=list)
    best_match: VocabularyEntry | None = None
    confidence: float = 0.0
    match_type: str = "none"  # exact, synonym, fuzzy, semantic
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "query": self.query,
            "entries": [e.to_dict() for e in self.entries],
            "best_match": self.best_match.to_dict() if self.best_match else None,
            "confidence": self.confidence,
            "match_type": self.match_type,
            "metadata": self.metadata,
        }


class VocabularyMapper:
    """
    Maps entity mentions to controlled vocabulary entries.

    Provides:
    - Multi-source vocabulary lookup
    - Fuzzy matching for variations
    - Synonym expansion
    - Cross-reference resolution
    """

    # Vocabulary-specific ID patterns
    ID_PATTERNS = {
        VocabularySource.UMLS: r"^C\d{7}$",
        VocabularySource.MESH: r"^D\d{6,9}$|^C\d{6,9}$",
        VocabularySource.DRUGBANK: r"^DB\d{5}$",
        VocabularySource.UNIPROT: r"^[OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9]([A-Z][A-Z0-9]{2}[0-9]){1,2}$",
        VocabularySource.NCBI_GENE: r"^\d+$",
        VocabularySource.CHEBI: r"^CHEBI:\d+$",
        VocabularySource.HGNC: r"^HGNC:\d+$",
        VocabularySource.OMIM: r"^\d{6}$",
        VocabularySource.GO: r"^GO:\d{7}$",
        VocabularySource.KEGG: r"^hsa:\d+$|^[a-z]{3,4}\d{5}$",
        VocabularySource.CHEMBL: r"^CHEMBL\d+$",
        VocabularySource.PUBCHEM: r"^CID:\d+$|^\d+$",
        VocabularySource.RXNORM: r"^\d+$",
        VocabularySource.ICD10: r"^[A-Z]\d{2}(\.\d+)?$",
        VocabularySource.SNOMED: r"^\d{6,18}$",
        VocabularySource.DOID: r"^DOID:\d+$",
        VocabularySource.HP: r"^HP:\d{7}$",
        VocabularySource.MONDO: r"^MONDO:\d{7}$",
    }

    # Built-in vocabulary data (subset for demo - in production, load from DB/API)
    BUILTIN_VOCABULARIES = {
        # Genes
        "BRCA1": VocabularyEntry(
            source=VocabularySource.HGNC,
            identifier="HGNC:1100",
            name="BRCA1 DNA repair associated",
            synonyms=["BRCA1", "IRIS", "PSCP", "BRCAI", "BRCC1", "FANCS", "RNF53", "BROVCA1"],
            semantic_types=["gene"],
            cross_references={"ncbi_gene": ["672"], "uniprot": ["P38398"], "omim": ["113705"]},
        ),
        "BRCA2": VocabularyEntry(
            source=VocabularySource.HGNC,
            identifier="HGNC:1101",
            name="BRCA2 DNA repair associated",
            synonyms=["BRCA2", "FACD", "FAD", "FAD1", "FANCD", "FANCD1", "BRCC2", "BROVCA2"],
            semantic_types=["gene"],
            cross_references={"ncbi_gene": ["675"], "uniprot": ["P51587"], "omim": ["600185"]},
        ),
        "TP53": VocabularyEntry(
            source=VocabularySource.HGNC,
            identifier="HGNC:11998",
            name="tumor protein p53",
            synonyms=["TP53", "p53", "LFS1", "TRP53", "BCC7"],
            semantic_types=["gene", "tumor_suppressor"],
            cross_references={"ncbi_gene": ["7157"], "uniprot": ["P04637"], "omim": ["191170"]},
        ),
        "EGFR": VocabularyEntry(
            source=VocabularySource.HGNC,
            identifier="HGNC:3236",
            name="epidermal growth factor receptor",
            synonyms=["EGFR", "ERBB", "ERBB1", "HER1", "mENA", "NISBD2", "PIG61"],
            semantic_types=["gene", "receptor", "kinase"],
            cross_references={"ncbi_gene": ["1956"], "uniprot": ["P00533"], "omim": ["131550"]},
        ),
        "HER2": VocabularyEntry(
            source=VocabularySource.HGNC,
            identifier="HGNC:3430",
            name="erb-b2 receptor tyrosine kinase 2",
            synonyms=["HER2", "ERBB2", "NEU", "NGL", "HER-2", "HER-2/neu", "CD340", "MLN19"],
            semantic_types=["gene", "receptor", "kinase", "biomarker"],
            cross_references={"ncbi_gene": ["2064"], "uniprot": ["P04626"], "omim": ["164870"]},
        ),
        "KRAS": VocabularyEntry(
            source=VocabularySource.HGNC,
            identifier="HGNC:6407",
            name="KRAS proto-oncogene, GTPase",
            synonyms=["KRAS", "K-RAS", "KRAS2", "RASK2", "Ki-ras", "c-K-ras"],
            semantic_types=["gene", "oncogene"],
            cross_references={"ncbi_gene": ["3845"], "uniprot": ["P01116"], "omim": ["190070"]},
        ),
        # Drugs
        "TRASTUZUMAB": VocabularyEntry(
            source=VocabularySource.DRUGBANK,
            identifier="DB00072",
            name="Trastuzumab",
            synonyms=["Herceptin", "trastuzumab", "humanized anti-HER2"],
            semantic_types=["drug", "monoclonal_antibody"],
            cross_references={"chembl": ["CHEMBL1201585"], "rxnorm": ["224905"]},
            properties={"mechanism": "HER2 inhibitor", "indication": "HER2-positive breast cancer"},
        ),
        "IMATINIB": VocabularyEntry(
            source=VocabularySource.DRUGBANK,
            identifier="DB00619",
            name="Imatinib",
            synonyms=["Gleevec", "Glivec", "imatinib mesylate", "STI571"],
            semantic_types=["drug", "tyrosine_kinase_inhibitor"],
            cross_references={"chembl": ["CHEMBL941"], "pubchem": ["5291"]},
            properties={
                "mechanism": "BCR-ABL tyrosine kinase inhibitor",
                "indication": "Chronic myeloid leukemia",
            },
        ),
        "PEMBROLIZUMAB": VocabularyEntry(
            source=VocabularySource.DRUGBANK,
            identifier="DB09037",
            name="Pembrolizumab",
            synonyms=["Keytruda", "lambrolizumab", "MK-3475"],
            semantic_types=["drug", "monoclonal_antibody", "checkpoint_inhibitor"],
            cross_references={"chembl": ["CHEMBL2007641"], "rxnorm": ["1547220"]},
            properties={"mechanism": "PD-1 inhibitor", "indication": "Multiple cancers"},
        ),
        # ADCs
        "TRASTUZUMAB_DERUXTECAN": VocabularyEntry(
            source=VocabularySource.DRUGBANK,
            identifier="DB15041",
            name="Trastuzumab deruxtecan",
            synonyms=["Enhertu", "T-DXd", "DS-8201a", "fam-trastuzumab deruxtecan"],
            semantic_types=["drug", "adc", "antibody_drug_conjugate"],
            cross_references={"chembl": ["CHEMBL4297411"]},
            properties={
                "mechanism": "HER2-targeted ADC",
                "target": "HER2",
                "payload": "deruxtecan (DXd)",
                "dar": "8",
            },
        ),
        "ENFORTUMAB_VEDOTIN": VocabularyEntry(
            source=VocabularySource.DRUGBANK,
            identifier="DB15045",
            name="Enfortumab vedotin",
            synonyms=["Padcev", "EV", "ASG-22ME"],
            semantic_types=["drug", "adc", "antibody_drug_conjugate"],
            cross_references={},
            properties={
                "mechanism": "Nectin-4-targeted ADC",
                "target": "Nectin-4",
                "payload": "MMAE",
            },
        ),
        # Diseases
        "BREAST_CANCER": VocabularyEntry(
            source=VocabularySource.MESH,
            identifier="D001943",
            name="Breast Neoplasms",
            synonyms=["breast cancer", "breast carcinoma", "mammary cancer", "breast tumor"],
            semantic_types=["disease", "neoplasm"],
            cross_references={"doid": ["DOID:1612"], "icd10": ["C50"], "omim": ["114480"]},
        ),
        "LUNG_CANCER": VocabularyEntry(
            source=VocabularySource.MESH,
            identifier="D008175",
            name="Lung Neoplasms",
            synonyms=["lung cancer", "pulmonary cancer", "lung carcinoma", "NSCLC", "SCLC"],
            semantic_types=["disease", "neoplasm"],
            cross_references={"doid": ["DOID:1324"], "icd10": ["C34"]},
        ),
        "COLORECTAL_CANCER": VocabularyEntry(
            source=VocabularySource.MESH,
            identifier="D015179",
            name="Colorectal Neoplasms",
            synonyms=["colorectal cancer", "CRC", "colon cancer", "rectal cancer"],
            semantic_types=["disease", "neoplasm"],
            cross_references={"doid": ["DOID:9256"], "icd10": ["C18", "C19", "C20"]},
        ),
        # Pathways
        "PI3K_AKT": VocabularyEntry(
            source=VocabularySource.KEGG,
            identifier="hsa04151",
            name="PI3K-Akt signaling pathway",
            synonyms=["PI3K/AKT pathway", "PI3K-AKT-mTOR", "phosphatidylinositol 3-kinase"],
            semantic_types=["pathway", "signaling"],
            cross_references={"go": ["GO:0043491"]},
        ),
        "MAPK": VocabularyEntry(
            source=VocabularySource.KEGG,
            identifier="hsa04010",
            name="MAPK signaling pathway",
            synonyms=[
                "MAPK pathway",
                "RAS-MAPK",
                "ERK pathway",
                "mitogen-activated protein kinase",
            ],
            semantic_types=["pathway", "signaling"],
            cross_references={"go": ["GO:0000165"]},
        ),
        # Proteins/Biomarkers
        "PD_L1": VocabularyEntry(
            source=VocabularySource.HGNC,
            identifier="HGNC:17635",
            name="CD274 molecule",
            synonyms=["PD-L1", "PDL1", "CD274", "B7-H1", "PDCD1LG1"],
            semantic_types=["protein", "biomarker", "immune_checkpoint"],
            cross_references={"ncbi_gene": ["29126"], "uniprot": ["Q9NZQ7"]},
        ),
        "CD19": VocabularyEntry(
            source=VocabularySource.HGNC,
            identifier="HGNC:1633",
            name="CD19 molecule",
            synonyms=["CD19", "B4", "CVID3"],
            semantic_types=["protein", "antigen", "b_cell_marker"],
            cross_references={"ncbi_gene": ["930"], "uniprot": ["P15391"]},
        ),
    }

    def __init__(
        self,
        enabled_sources: list[VocabularySource] | None = None,
        use_fuzzy_matching: bool = True,
        fuzzy_threshold: float = 0.8,
        expand_synonyms: bool = True,
        resolve_cross_refs: bool = True,
    ):
        """
        Initialize the vocabulary mapper.

        Args:
            enabled_sources: List of vocabulary sources to use
            use_fuzzy_matching: Enable fuzzy matching for variations
            fuzzy_threshold: Minimum similarity for fuzzy matches
            expand_synonyms: Expand to all synonyms
            resolve_cross_refs: Resolve cross-references
        """
        self.enabled_sources = enabled_sources or list(VocabularySource)
        self.use_fuzzy_matching = use_fuzzy_matching
        self.fuzzy_threshold = fuzzy_threshold
        self.expand_synonyms = expand_synonyms
        self.resolve_cross_refs = resolve_cross_refs

        # Build lookup indices
        self._name_index: dict[str, list[VocabularyEntry]] = {}
        self._id_index: dict[str, VocabularyEntry] = {}
        self._build_indices()

        logger.info(f"VocabularyMapper initialized with {len(self._name_index)} entries")

    def _build_indices(self):
        """Build lookup indices from vocabulary data."""
        for key, entry in self.BUILTIN_VOCABULARIES.items():
            # Index by ID
            full_id = entry.get_full_id()
            self._id_index[full_id] = entry
            self._id_index[entry.identifier] = entry

            # Index by name (lowercase)
            name_lower = entry.name.lower()
            if name_lower not in self._name_index:
                self._name_index[name_lower] = []
            self._name_index[name_lower].append(entry)

            # Index by synonyms
            for synonym in entry.synonyms:
                syn_lower = synonym.lower()
                if syn_lower not in self._name_index:
                    self._name_index[syn_lower] = []
                if entry not in self._name_index[syn_lower]:
                    self._name_index[syn_lower].append(entry)

    def map_entity(
        self,
        query: str,
        entity_type: str | None = None,
        preferred_source: VocabularySource | None = None,
    ) -> MappingResult:
        """
        Map an entity mention to controlled vocabulary.

        Args:
            query: Entity text to map
            entity_type: Optional entity type hint
            preferred_source: Preferred vocabulary source

        Returns:
            MappingResult with matched entries
        """
        query_lower = query.lower().strip()
        result = MappingResult(query=query)

        # Step 1: Exact match
        if query_lower in self._name_index:
            result.entries = self._name_index[query_lower].copy()
            result.match_type = "exact"
            result.confidence = 1.0

        # Step 2: Try ID match
        if not result.entries and query in self._id_index:
            result.entries = [self._id_index[query]]
            result.match_type = "identifier"
            result.confidence = 1.0

        # Step 3: Fuzzy matching
        if not result.entries and self.use_fuzzy_matching:
            fuzzy_matches = self._fuzzy_match(query_lower)
            if fuzzy_matches:
                result.entries = [m[0] for m in fuzzy_matches]
                result.match_type = "fuzzy"
                result.confidence = fuzzy_matches[0][1]

        # Step 4: Partial match
        if not result.entries:
            partial_matches = self._partial_match(query_lower)
            if partial_matches:
                result.entries = partial_matches
                result.match_type = "partial"
                result.confidence = 0.6

        # Filter by entity type if provided
        if entity_type and result.entries:
            result.entries = [
                e
                for e in result.entries
                if entity_type.lower() in [st.lower() for st in e.semantic_types]
            ]

        # Filter by preferred source
        if preferred_source and result.entries:
            source_matches = [e for e in result.entries if e.source == preferred_source]
            if source_matches:
                result.entries = source_matches

        # Select best match
        if result.entries:
            result.best_match = self._select_best_match(result.entries, query, preferred_source)

        return result

    def _fuzzy_match(self, query: str) -> list[tuple]:
        """Find fuzzy matches for query."""
        matches = []

        for name, entries in self._name_index.items():
            similarity = self._calculate_similarity(query, name)
            if similarity >= self.fuzzy_threshold:
                for entry in entries:
                    matches.append((entry, similarity))

        # Sort by similarity
        matches.sort(key=lambda x: x[1], reverse=True)
        return matches[:10]

    def _partial_match(self, query: str) -> list[VocabularyEntry]:
        """Find partial matches for query."""
        matches = []

        for name, entries in self._name_index.items():
            if query in name or name in query:
                matches.extend(entries)

        return list(set(matches))

    def _calculate_similarity(self, s1: str, s2: str) -> float:
        """Calculate string similarity using Levenshtein ratio."""
        if s1 == s2:
            return 1.0

        len1, len2 = len(s1), len(s2)
        if len1 == 0 or len2 == 0:
            return 0.0

        # Simple ratio based on common characters
        common = sum(1 for c in s1 if c in s2)
        return (2.0 * common) / (len1 + len2)

    def _select_best_match(
        self, entries: list[VocabularyEntry], query: str, preferred_source: VocabularySource | None
    ) -> VocabularyEntry:
        """Select the best matching entry."""
        if len(entries) == 1:
            return entries[0]

        # Score each entry
        scored = []
        for entry in entries:
            score = 0.0

            # Exact name match bonus
            if entry.name.lower() == query.lower():
                score += 10

            # Preferred source bonus
            if preferred_source and entry.source == preferred_source:
                score += 5

            # More cross-references = better characterized
            score += len(entry.cross_references) * 0.5

            # More synonyms = more established
            score += len(entry.synonyms) * 0.2

            scored.append((entry, score))

        scored.sort(key=lambda x: x[1], reverse=True)
        return scored[0][0]

    def batch_map(
        self, queries: list[str], entity_types: list[str] | None = None
    ) -> list[MappingResult]:
        """
        Map multiple entities.

        Args:
            queries: List of entity texts
            entity_types: Optional list of entity types

        Returns:
            List of MappingResults
        """
        results = []
        entity_types = entity_types or [None] * len(queries)

        for query, etype in zip(queries, entity_types):
            result = self.map_entity(query, etype)
            results.append(result)

        return results

    def get_cross_references(
        self, entry: VocabularyEntry, target_source: VocabularySource | None = None
    ) -> dict[str, list[str]]:
        """
        Get cross-references for an entry.

        Args:
            entry: Vocabulary entry
            target_source: Specific source to get refs for

        Returns:
            Dictionary of cross-references
        """
        if target_source:
            source_key = target_source.value
            return {source_key: entry.cross_references.get(source_key, [])}

        return entry.cross_references

    def get_all_synonyms(self, entry: VocabularyEntry) -> set[str]:
        """Get all synonyms including cross-reference names."""
        synonyms = set(entry.synonyms)
        synonyms.add(entry.name)

        # Add names from cross-referenced entries
        if self.resolve_cross_refs:
            for source, ids in entry.cross_references.items():
                for ref_id in ids:
                    if ref_id in self._id_index:
                        ref_entry = self._id_index[ref_id]
                        synonyms.add(ref_entry.name)
                        synonyms.update(ref_entry.synonyms)

        return synonyms

    def validate_id(self, identifier: str, source: VocabularySource) -> bool:
        """
        Validate an identifier format for a vocabulary source.

        Args:
            identifier: ID to validate
            source: Vocabulary source

        Returns:
            True if valid format
        """
        pattern = self.ID_PATTERNS.get(source)
        if pattern:
            return bool(re.match(pattern, identifier))
        return True  # No pattern defined

    def get_statistics(self) -> dict[str, Any]:
        """Get mapper statistics."""
        source_counts = {}
        for entry in self.BUILTIN_VOCABULARIES.values():
            source = entry.source.value
            source_counts[source] = source_counts.get(source, 0) + 1

        return {
            "total_entries": len(self.BUILTIN_VOCABULARIES),
            "total_names": len(self._name_index),
            "entries_by_source": source_counts,
            "enabled_sources": [s.value for s in self.enabled_sources],
        }


# Convenience function
def map_entity(query: str, entity_type: str | None = None) -> MappingResult:
    """Quick entity mapping using default mapper."""
    mapper = VocabularyMapper()
    return mapper.map_entity(query, entity_type)
