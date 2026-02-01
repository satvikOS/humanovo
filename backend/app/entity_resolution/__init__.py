"""
Entity Resolution and Vocabulary Mapping System

Provides standardized entity normalization to controlled vocabularies:
- UMLS (Unified Medical Language System)
- MeSH (Medical Subject Headings)
- DrugBank (Drug Database)
- UniProt (Protein Database)
- NCBI Gene
- ChEBI (Chemical Entities of Biological Interest)
- HGNC (Human Gene Nomenclature)
- OMIM (Online Mendelian Inheritance in Man)

Features:
- Synonym management
- Disambiguation algorithms
- Canonical ID assignment
- Cross-reference resolution
"""

from .canonical_ids import CanonicalID, CanonicalIDManager
from .disambiguation import DisambiguationResult, Disambiguator
from .resolver import EntityResolver, ResolutionResult, ResolvedEntity
from .synonym_manager import SynonymEntry, SynonymManager
from .vocabulary_mapper import VocabularyMapper, VocabularySource

__all__ = [
    "EntityResolver",
    "ResolvedEntity",
    "ResolutionResult",
    "VocabularyMapper",
    "VocabularySource",
    "SynonymManager",
    "SynonymEntry",
    "Disambiguator",
    "DisambiguationResult",
    "CanonicalIDManager",
    "CanonicalID",
]
