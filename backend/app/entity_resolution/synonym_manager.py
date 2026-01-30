"""
Synonym Management System

Manages synonyms for biomedical entities:
- Synonym normalization
- Abbreviation expansion
- Spelling variants
- Multi-language support
- Custom synonym dictionaries
"""

import logging
import re
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Set, Any, Tuple
from enum import Enum

logger = logging.getLogger(__name__)


class SynonymType(str, Enum):
    """Types of synonyms."""
    EXACT = "exact"  # Exact synonym
    RELATED = "related"  # Related term
    BROADER = "broader"  # More general term
    NARROWER = "narrower"  # More specific term
    ABBREVIATION = "abbreviation"
    ACRONYM = "acronym"
    SPELLING_VARIANT = "spelling_variant"
    BRAND_NAME = "brand_name"
    GENERIC_NAME = "generic_name"
    CHEMICAL_NAME = "chemical_name"
    INN = "inn"  # International Nonproprietary Name
    IUPAC = "iupac"
    FORMER_NAME = "former_name"
    DEPRECATED = "deprecated"


@dataclass
class SynonymEntry:
    """Represents a synonym entry."""
    term: str
    synonym_type: SynonymType
    source: Optional[str] = None
    language: str = "en"
    confidence: float = 1.0
    context: Optional[str] = None  # Domain context
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "term": self.term,
            "synonym_type": self.synonym_type.value,
            "source": self.source,
            "language": self.language,
            "confidence": self.confidence,
            "context": self.context,
            "metadata": self.metadata
        }


@dataclass
class SynonymCluster:
    """A cluster of synonymous terms."""
    canonical_term: str
    synonyms: List[SynonymEntry] = field(default_factory=list)
    entity_type: Optional[str] = None
    identifiers: Dict[str, str] = field(default_factory=dict)

    def get_all_terms(self) -> Set[str]:
        """Get all terms in cluster."""
        terms = {self.canonical_term}
        terms.update(s.term for s in self.synonyms)
        return terms

    def to_dict(self) -> Dict[str, Any]:
        return {
            "canonical_term": self.canonical_term,
            "synonyms": [s.to_dict() for s in self.synonyms],
            "entity_type": self.entity_type,
            "identifiers": self.identifiers,
            "all_terms": list(self.get_all_terms())
        }


class SynonymManager:
    """
    Manages synonyms for biomedical entities.

    Provides:
    - Synonym lookup and expansion
    - Abbreviation handling
    - Normalization rules
    - Cluster management
    """

    # Common biomedical abbreviations
    ABBREVIATIONS = {
        # Genes
        "BRCA1": ["Breast Cancer 1", "breast cancer gene 1"],
        "BRCA2": ["Breast Cancer 2", "breast cancer gene 2"],
        "TP53": ["tumor protein p53", "p53", "tumour protein p53"],
        "EGFR": ["Epidermal Growth Factor Receptor", "ErbB-1", "HER1"],
        "HER2": ["Human Epidermal Growth Factor Receptor 2", "ERBB2", "neu"],
        "KRAS": ["Kirsten Rat Sarcoma", "K-RAS", "Ki-ras"],
        "BRAF": ["B-Raf Proto-Oncogene", "B-RAF"],
        "ALK": ["Anaplastic Lymphoma Kinase"],
        "ROS1": ["ROS Proto-Oncogene 1"],
        "MET": ["Mesenchymal Epithelial Transition factor"],

        # Drugs
        "ADC": ["Antibody-Drug Conjugate", "antibody drug conjugate"],
        "mAb": ["monoclonal antibody", "MAb", "MoAb"],
        "TKI": ["Tyrosine Kinase Inhibitor", "tyrosine kinase inhibitors"],
        "PD-1": ["Programmed Death 1", "PD1", "PDCD1"],
        "PD-L1": ["Programmed Death Ligand 1", "PDL1", "CD274"],
        "CTLA-4": ["Cytotoxic T-Lymphocyte Antigen 4", "CTLA4", "CD152"],

        # Diseases
        "NSCLC": ["Non-Small Cell Lung Cancer", "non-small cell lung carcinoma"],
        "SCLC": ["Small Cell Lung Cancer", "small cell lung carcinoma"],
        "TNBC": ["Triple-Negative Breast Cancer", "triple negative breast cancer"],
        "CRC": ["Colorectal Cancer", "colorectal carcinoma"],
        "RCC": ["Renal Cell Carcinoma", "renal cell cancer"],
        "HCC": ["Hepatocellular Carcinoma", "liver cancer"],
        "AML": ["Acute Myeloid Leukemia", "acute myelogenous leukemia"],
        "CML": ["Chronic Myeloid Leukemia", "chronic myelogenous leukemia"],
        "ALL": ["Acute Lymphoblastic Leukemia", "acute lymphocytic leukemia"],
        "NHL": ["Non-Hodgkin Lymphoma", "non-Hodgkin's lymphoma"],
        "DLBCL": ["Diffuse Large B-Cell Lymphoma"],

        # Clinical terms
        "OS": ["Overall Survival"],
        "PFS": ["Progression-Free Survival"],
        "ORR": ["Objective Response Rate", "overall response rate"],
        "DOR": ["Duration of Response"],
        "DCR": ["Disease Control Rate"],
        "CR": ["Complete Response", "complete remission"],
        "PR": ["Partial Response", "partial remission"],
        "SD": ["Stable Disease"],
        "PD": ["Progressive Disease", "disease progression"],
        "AE": ["Adverse Event", "adverse effect"],
        "SAE": ["Serious Adverse Event"],
        "DLT": ["Dose-Limiting Toxicity"],
        "MTD": ["Maximum Tolerated Dose"],
        "RP2D": ["Recommended Phase 2 Dose"],

        # Pathways
        "PI3K": ["Phosphatidylinositol 3-Kinase", "PI3-K", "phosphoinositide 3-kinase"],
        "mTOR": ["Mammalian Target of Rapamycin", "mechanistic target of rapamycin"],
        "MAPK": ["Mitogen-Activated Protein Kinase", "MAP kinase"],
        "ERK": ["Extracellular Signal-Regulated Kinase"],
        "MEK": ["MAPK/ERK Kinase", "MAP2K"],
        "RAF": ["Rapidly Accelerated Fibrosarcoma"],
        "RAS": ["Rat Sarcoma"],

        # Biomarkers
        "IHC": ["Immunohistochemistry"],
        "FISH": ["Fluorescence In Situ Hybridization"],
        "NGS": ["Next-Generation Sequencing", "next gen sequencing"],
        "PCR": ["Polymerase Chain Reaction"],
        "qPCR": ["Quantitative PCR", "real-time PCR"],
        "TMB": ["Tumor Mutational Burden"],
        "MSI": ["Microsatellite Instability"],
        "MSI-H": ["Microsatellite Instability-High"],
        "MSS": ["Microsatellite Stable"],
    }

    # Spelling variants and normalization rules
    NORMALIZATION_RULES = [
        # British/American spelling
        (r'tumour', 'tumor'),
        (r'colour', 'color'),
        (r'haemoglobin', 'hemoglobin'),
        (r'oestrogen', 'estrogen'),
        (r'leukaemia', 'leukemia'),
        (r'anaemia', 'anemia'),
        (r'paediatric', 'pediatric'),
        (r'foetus', 'fetus'),
        (r'coeliac', 'celiac'),
        (r'diarrhoea', 'diarrhea'),
        (r'oedema', 'edema'),
        (r'behaviour', 'behavior'),
        (r'favour', 'favor'),
        (r'honour', 'honor'),
        (r'defence', 'defense'),
        (r'licence', 'license'),
        (r'practise', 'practice'),
        (r'analyse', 'analyze'),
        (r'catalyse', 'catalyze'),
        (r'organise', 'organize'),
        (r'recognise', 'recognize'),
        (r'metre', 'meter'),
        (r'litre', 'liter'),
        (r'centre', 'center'),
        (r'fibre', 'fiber'),

        # Common variations
        (r'non-small[\s-]?cell', 'non-small cell'),
        (r'non[\s-]?hodgkin', 'non-hodgkin'),
        (r'anti[\s-]?body', 'antibody'),
        (r'intra[\s-]?venous', 'intravenous'),
        (r'sub[\s-]?cutaneous', 'subcutaneous'),
        (r'immuno[\s-]?therapy', 'immunotherapy'),
        (r'chemo[\s-]?therapy', 'chemotherapy'),
        (r'radio[\s-]?therapy', 'radiotherapy'),

        # Greek letters
        (r'α', 'alpha'),
        (r'β', 'beta'),
        (r'γ', 'gamma'),
        (r'δ', 'delta'),
        (r'κ', 'kappa'),
    ]

    def __init__(
        self,
        custom_synonyms: Optional[Dict[str, List[str]]] = None,
        enable_normalization: bool = True,
        case_sensitive: bool = False
    ):
        """
        Initialize the synonym manager.

        Args:
            custom_synonyms: Custom synonym dictionary
            enable_normalization: Enable spelling normalization
            case_sensitive: Case-sensitive matching
        """
        self.enable_normalization = enable_normalization
        self.case_sensitive = case_sensitive

        # Build synonym index
        self._synonym_to_canonical: Dict[str, str] = {}
        self._canonical_to_synonyms: Dict[str, Set[str]] = {}
        self._clusters: Dict[str, SynonymCluster] = {}

        # Load built-in abbreviations
        self._load_abbreviations()

        # Load custom synonyms
        if custom_synonyms:
            self._load_custom_synonyms(custom_synonyms)

        # Compile normalization patterns
        self._normalization_patterns = [
            (re.compile(pattern, re.IGNORECASE), replacement)
            for pattern, replacement in self.NORMALIZATION_RULES
        ]

        logger.info(f"SynonymManager initialized with {len(self._synonym_to_canonical)} mappings")

    def _load_abbreviations(self):
        """Load built-in abbreviations into index."""
        for abbrev, expansions in self.ABBREVIATIONS.items():
            # Abbreviation is canonical
            canonical = abbrev if self.case_sensitive else abbrev.lower()
            self._canonical_to_synonyms[canonical] = set()

            # Map abbreviation to itself
            self._synonym_to_canonical[canonical] = canonical

            # Map each expansion to canonical
            for expansion in expansions:
                exp_key = expansion if self.case_sensitive else expansion.lower()
                self._synonym_to_canonical[exp_key] = canonical
                self._canonical_to_synonyms[canonical].add(exp_key)

    def _load_custom_synonyms(self, synonyms: Dict[str, List[str]]):
        """Load custom synonyms."""
        for canonical, syn_list in synonyms.items():
            can_key = canonical if self.case_sensitive else canonical.lower()
            if can_key not in self._canonical_to_synonyms:
                self._canonical_to_synonyms[can_key] = set()

            self._synonym_to_canonical[can_key] = can_key

            for syn in syn_list:
                syn_key = syn if self.case_sensitive else syn.lower()
                self._synonym_to_canonical[syn_key] = can_key
                self._canonical_to_synonyms[can_key].add(syn_key)

    def normalize(self, text: str) -> str:
        """
        Normalize text using spelling rules.

        Args:
            text: Text to normalize

        Returns:
            Normalized text
        """
        if not self.enable_normalization:
            return text

        result = text
        for pattern, replacement in self._normalization_patterns:
            result = pattern.sub(replacement, result)

        return result

    def get_canonical(self, term: str) -> Optional[str]:
        """
        Get canonical form of a term.

        Args:
            term: Term to look up

        Returns:
            Canonical form or None
        """
        key = term if self.case_sensitive else term.lower()

        # Try direct lookup
        if key in self._synonym_to_canonical:
            return self._synonym_to_canonical[key]

        # Try normalized form
        if self.enable_normalization:
            normalized = self.normalize(key)
            if normalized in self._synonym_to_canonical:
                return self._synonym_to_canonical[normalized]

        return None

    def get_synonyms(
        self,
        term: str,
        include_types: Optional[List[SynonymType]] = None
    ) -> Set[str]:
        """
        Get all synonyms for a term.

        Args:
            term: Term to get synonyms for
            include_types: Filter by synonym types

        Returns:
            Set of synonyms
        """
        canonical = self.get_canonical(term)
        if canonical is None:
            return set()

        synonyms = self._canonical_to_synonyms.get(canonical, set()).copy()
        synonyms.add(canonical)

        return synonyms

    def expand_query(self, query: str) -> List[str]:
        """
        Expand a query with synonyms.

        Args:
            query: Query to expand

        Returns:
            List of query variations
        """
        variations = [query]

        # Add normalized form
        if self.enable_normalization:
            normalized = self.normalize(query)
            if normalized != query:
                variations.append(normalized)

        # Add synonyms
        for word in query.split():
            synonyms = self.get_synonyms(word)
            for syn in synonyms:
                if syn not in variations:
                    expanded = query.replace(word, syn)
                    variations.append(expanded)

        return list(set(variations))

    def add_synonym(
        self,
        canonical: str,
        synonym: str,
        synonym_type: SynonymType = SynonymType.EXACT
    ):
        """
        Add a synonym mapping.

        Args:
            canonical: Canonical term
            synonym: Synonym to add
            synonym_type: Type of synonym
        """
        can_key = canonical if self.case_sensitive else canonical.lower()
        syn_key = synonym if self.case_sensitive else synonym.lower()

        # Initialize if needed
        if can_key not in self._canonical_to_synonyms:
            self._canonical_to_synonyms[can_key] = set()
            self._synonym_to_canonical[can_key] = can_key

        # Add mapping
        self._synonym_to_canonical[syn_key] = can_key
        self._canonical_to_synonyms[can_key].add(syn_key)

    def create_cluster(
        self,
        canonical: str,
        synonyms: List[SynonymEntry],
        entity_type: Optional[str] = None,
        identifiers: Optional[Dict[str, str]] = None
    ) -> SynonymCluster:
        """
        Create a synonym cluster.

        Args:
            canonical: Canonical term
            synonyms: List of synonym entries
            entity_type: Entity type
            identifiers: External identifiers

        Returns:
            Created SynonymCluster
        """
        cluster = SynonymCluster(
            canonical_term=canonical,
            synonyms=synonyms,
            entity_type=entity_type,
            identifiers=identifiers or {}
        )

        # Index the cluster
        can_key = canonical if self.case_sensitive else canonical.lower()
        self._clusters[can_key] = cluster

        # Update mappings
        for syn_entry in synonyms:
            self.add_synonym(canonical, syn_entry.term, syn_entry.synonym_type)

        return cluster

    def get_cluster(self, term: str) -> Optional[SynonymCluster]:
        """
        Get the synonym cluster for a term.

        Args:
            term: Term to look up

        Returns:
            SynonymCluster or None
        """
        canonical = self.get_canonical(term)
        if canonical is None:
            return None

        return self._clusters.get(canonical)

    def are_synonymous(self, term1: str, term2: str) -> bool:
        """
        Check if two terms are synonymous.

        Args:
            term1: First term
            term2: Second term

        Returns:
            True if synonymous
        """
        canonical1 = self.get_canonical(term1)
        canonical2 = self.get_canonical(term2)

        if canonical1 is None or canonical2 is None:
            return False

        return canonical1 == canonical2

    def detect_abbreviation(self, text: str) -> List[Tuple[str, str]]:
        """
        Detect abbreviations in text.

        Args:
            text: Text to search

        Returns:
            List of (abbreviation, position) tuples
        """
        found = []

        for abbrev in self.ABBREVIATIONS.keys():
            pattern = re.compile(r'\b' + re.escape(abbrev) + r'\b', re.IGNORECASE)
            for match in pattern.finditer(text):
                found.append((match.group(), match.start()))

        return found

    def expand_abbreviations(self, text: str) -> str:
        """
        Expand abbreviations in text.

        Args:
            text: Text with abbreviations

        Returns:
            Text with expansions
        """
        result = text

        for abbrev, expansions in self.ABBREVIATIONS.items():
            pattern = re.compile(r'\b' + re.escape(abbrev) + r'\b')
            # Replace with first expansion
            if expansions:
                replacement = f"{abbrev} ({expansions[0]})"
                result = pattern.sub(replacement, result, count=1)

        return result

    def get_statistics(self) -> Dict[str, Any]:
        """Get manager statistics."""
        return {
            "total_mappings": len(self._synonym_to_canonical),
            "total_canonical_terms": len(self._canonical_to_synonyms),
            "total_clusters": len(self._clusters),
            "builtin_abbreviations": len(self.ABBREVIATIONS),
            "normalization_enabled": self.enable_normalization,
            "normalization_rules": len(self.NORMALIZATION_RULES)
        }


# Convenience functions
def get_canonical(term: str) -> Optional[str]:
    """Get canonical form using default manager."""
    manager = SynonymManager()
    return manager.get_canonical(term)


def get_synonyms(term: str) -> Set[str]:
    """Get synonyms using default manager."""
    manager = SynonymManager()
    return manager.get_synonyms(term)


def normalize_text(text: str) -> str:
    """Normalize text using default manager."""
    manager = SynonymManager()
    return manager.normalize(text)
