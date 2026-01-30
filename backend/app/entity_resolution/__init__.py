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

from .resolver import EntityResolver, ResolvedEntity, ResolutionResult
from .vocabulary_mapper import VocabularyMapper, VocabularySource
from .synonym_manager import SynonymManager, SynonymEntry
from .disambiguation import Disambiguator, DisambiguationResult
from .canonical_ids import CanonicalIDManager, CanonicalID

__all__ = [
    'EntityResolver',
    'ResolvedEntity',
    'ResolutionResult',
    'VocabularyMapper',
    'VocabularySource',
    'SynonymManager',
    'SynonymEntry',
    'Disambiguator',
    'DisambiguationResult',
    'CanonicalIDManager',
    'CanonicalID',
]
