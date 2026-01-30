"""
Canonical ID Management System

Manages canonical identifiers for biomedical entities:
- ID generation and assignment
- Cross-reference tracking
- Version management
- Namespace handling
"""

import logging
import hashlib
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from typing import Dict, List, Optional, Any, Set
from enum import Enum

logger = logging.getLogger(__name__)


class IDNamespace(str, Enum):
    """ID namespaces for different entity sources."""
    GENUP = "genup"  # Internal GenUp IDs
    UMLS = "umls"
    MESH = "mesh"
    DRUGBANK = "drugbank"
    UNIPROT = "uniprot"
    NCBI_GENE = "ncbi_gene"
    HGNC = "hgnc"
    CHEBI = "chebi"
    CHEMBL = "chembl"
    PUBCHEM = "pubchem"
    GO = "go"
    KEGG = "kegg"
    DOID = "doid"
    OMIM = "omim"
    RXNORM = "rxnorm"
    ICD10 = "icd10"
    SNOMED = "snomed"


@dataclass
class CanonicalID:
    """Represents a canonical identifier."""
    namespace: IDNamespace
    identifier: str
    version: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    status: str = "active"  # active, deprecated, merged
    merged_into: Optional[str] = None
    cross_references: Dict[str, List[str]] = field(default_factory=dict)
    metadata: Dict[str, Any] = field(default_factory=dict)

    def get_curie(self) -> str:
        """Get CURIE format (namespace:id)."""
        return f"{self.namespace.value}:{self.identifier}"

    def get_uri(self, base_url: str = "https://genup.io/entity") -> str:
        """Get URI format."""
        return f"{base_url}/{self.namespace.value}/{self.identifier}"

    def to_dict(self) -> Dict[str, Any]:
        return {
            "namespace": self.namespace.value,
            "identifier": self.identifier,
            "curie": self.get_curie(),
            "version": self.version,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "status": self.status,
            "merged_into": self.merged_into,
            "cross_references": self.cross_references,
            "metadata": self.metadata
        }

    def __hash__(self):
        return hash(self.get_curie())

    def __eq__(self, other):
        if isinstance(other, CanonicalID):
            return self.get_curie() == other.get_curie()
        return False


@dataclass
class IDMapping:
    """Mapping between external and canonical IDs."""
    external_namespace: str
    external_id: str
    canonical_id: CanonicalID
    confidence: float = 1.0
    mapping_source: str = ""
    mapping_date: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "external_namespace": self.external_namespace,
            "external_id": self.external_id,
            "canonical_id": self.canonical_id.to_dict(),
            "confidence": self.confidence,
            "mapping_source": self.mapping_source,
            "mapping_date": self.mapping_date,
            "metadata": self.metadata
        }


class CanonicalIDManager:
    """
    Manages canonical identifiers for entities.

    Provides:
    - ID generation and assignment
    - Cross-reference resolution
    - ID versioning
    - Namespace management
    """

    # Namespace prefixes for URL generation
    NAMESPACE_URLS = {
        IDNamespace.UMLS: "https://uts.nlm.nih.gov/uts/umls/concept",
        IDNamespace.MESH: "https://meshb.nlm.nih.gov/record/ui",
        IDNamespace.DRUGBANK: "https://go.drugbank.com/drugs",
        IDNamespace.UNIPROT: "https://www.uniprot.org/uniprotkb",
        IDNamespace.NCBI_GENE: "https://www.ncbi.nlm.nih.gov/gene",
        IDNamespace.HGNC: "https://www.genenames.org/data/gene-symbol-report/#!/hgnc_id",
        IDNamespace.CHEBI: "https://www.ebi.ac.uk/chebi/searchId.do?chebiId",
        IDNamespace.CHEMBL: "https://www.ebi.ac.uk/chembl/compound_report_card",
        IDNamespace.PUBCHEM: "https://pubchem.ncbi.nlm.nih.gov/compound",
        IDNamespace.GO: "http://amigo.geneontology.org/amigo/term",
        IDNamespace.KEGG: "https://www.genome.jp/entry",
        IDNamespace.DOID: "https://www.disease-ontology.org/?id",
        IDNamespace.OMIM: "https://www.omim.org/entry",
    }

    def __init__(
        self,
        default_namespace: IDNamespace = IDNamespace.GENUP,
        enable_versioning: bool = True
    ):
        """
        Initialize the canonical ID manager.

        Args:
            default_namespace: Default namespace for new IDs
            enable_versioning: Enable ID versioning
        """
        self.default_namespace = default_namespace
        self.enable_versioning = enable_versioning

        # ID storage
        self._ids: Dict[str, CanonicalID] = {}  # curie -> CanonicalID
        self._mappings: Dict[str, List[IDMapping]] = {}  # external -> mappings
        self._reverse_mappings: Dict[str, Set[str]] = {}  # canonical -> externals

        logger.info(f"CanonicalIDManager initialized, default namespace: {default_namespace}")

    def generate_id(
        self,
        entity_name: str,
        entity_type: str,
        namespace: Optional[IDNamespace] = None,
        metadata: Optional[Dict[str, Any]] = None
    ) -> CanonicalID:
        """
        Generate a new canonical ID.

        Args:
            entity_name: Name of the entity
            entity_type: Type of the entity
            namespace: Namespace for the ID
            metadata: Additional metadata

        Returns:
            Generated CanonicalID
        """
        namespace = namespace or self.default_namespace
        now = datetime.utcnow().isoformat()

        # Generate unique identifier
        if namespace == IDNamespace.GENUP:
            # Use content-based hash for GenUp IDs
            content = f"{entity_name}:{entity_type}".lower()
            hash_id = hashlib.sha256(content.encode()).hexdigest()[:12]
            identifier = f"GU{hash_id.upper()}"
        else:
            # Use UUID for other namespaces
            identifier = str(uuid.uuid4())[:12].upper()

        canonical_id = CanonicalID(
            namespace=namespace,
            identifier=identifier,
            version="1.0" if self.enable_versioning else None,
            created_at=now,
            updated_at=now,
            status="active",
            metadata=metadata or {
                "entity_name": entity_name,
                "entity_type": entity_type
            }
        )

        # Store
        curie = canonical_id.get_curie()
        self._ids[curie] = canonical_id

        return canonical_id

    def register_external_id(
        self,
        external_namespace: str,
        external_id: str,
        canonical_id: Optional[CanonicalID] = None,
        entity_name: Optional[str] = None,
        entity_type: Optional[str] = None,
        confidence: float = 1.0,
        source: str = ""
    ) -> CanonicalID:
        """
        Register an external ID and map to canonical.

        Args:
            external_namespace: External namespace
            external_id: External identifier
            canonical_id: Existing canonical ID to map to
            entity_name: Entity name (if creating new)
            entity_type: Entity type (if creating new)
            confidence: Mapping confidence
            source: Mapping source

        Returns:
            The canonical ID
        """
        # Generate canonical if not provided
        if canonical_id is None:
            if entity_name is None:
                entity_name = external_id
            if entity_type is None:
                entity_type = "unknown"
            canonical_id = self.generate_id(entity_name, entity_type)

        # Create mapping
        mapping = IDMapping(
            external_namespace=external_namespace,
            external_id=external_id,
            canonical_id=canonical_id,
            confidence=confidence,
            mapping_source=source,
            mapping_date=datetime.utcnow().isoformat()
        )

        # Store mapping
        external_key = f"{external_namespace}:{external_id}"
        if external_key not in self._mappings:
            self._mappings[external_key] = []
        self._mappings[external_key].append(mapping)

        # Store reverse mapping
        curie = canonical_id.get_curie()
        if curie not in self._reverse_mappings:
            self._reverse_mappings[curie] = set()
        self._reverse_mappings[curie].add(external_key)

        # Update canonical ID cross-references
        if external_namespace not in canonical_id.cross_references:
            canonical_id.cross_references[external_namespace] = []
        if external_id not in canonical_id.cross_references[external_namespace]:
            canonical_id.cross_references[external_namespace].append(external_id)

        return canonical_id

    def get_canonical(
        self,
        external_namespace: str,
        external_id: str
    ) -> Optional[CanonicalID]:
        """
        Get canonical ID for an external ID.

        Args:
            external_namespace: External namespace
            external_id: External identifier

        Returns:
            CanonicalID or None
        """
        key = f"{external_namespace}:{external_id}"
        mappings = self._mappings.get(key, [])

        if not mappings:
            return None

        # Return highest confidence mapping
        best = max(mappings, key=lambda m: m.confidence)
        return best.canonical_id

    def get_by_curie(self, curie: str) -> Optional[CanonicalID]:
        """
        Get canonical ID by CURIE.

        Args:
            curie: CURIE string (namespace:id)

        Returns:
            CanonicalID or None
        """
        return self._ids.get(curie)

    def get_cross_references(
        self,
        canonical_id: CanonicalID
    ) -> Dict[str, List[str]]:
        """
        Get all cross-references for a canonical ID.

        Args:
            canonical_id: The canonical ID

        Returns:
            Dictionary of namespace -> IDs
        """
        curie = canonical_id.get_curie()
        external_keys = self._reverse_mappings.get(curie, set())

        refs: Dict[str, List[str]] = {}
        for key in external_keys:
            namespace, ext_id = key.split(":", 1)
            if namespace not in refs:
                refs[namespace] = []
            refs[namespace].append(ext_id)

        return refs

    def merge_ids(
        self,
        source_id: CanonicalID,
        target_id: CanonicalID,
        reason: str = ""
    ):
        """
        Merge one canonical ID into another.

        Args:
            source_id: ID to deprecate
            target_id: ID to merge into
            reason: Reason for merge
        """
        source_curie = source_id.get_curie()
        target_curie = target_id.get_curie()

        # Update source ID
        source_id.status = "merged"
        source_id.merged_into = target_curie
        source_id.updated_at = datetime.utcnow().isoformat()
        source_id.metadata["merge_reason"] = reason

        # Transfer cross-references
        for namespace, ids in source_id.cross_references.items():
            if namespace not in target_id.cross_references:
                target_id.cross_references[namespace] = []
            target_id.cross_references[namespace].extend(ids)

        # Update mappings to point to target
        source_externals = self._reverse_mappings.get(source_curie, set())
        for external_key in source_externals:
            mappings = self._mappings.get(external_key, [])
            for mapping in mappings:
                if mapping.canonical_id == source_id:
                    mapping.canonical_id = target_id
                    mapping.metadata["merged_from"] = source_curie

        # Update reverse mappings
        if source_curie in self._reverse_mappings:
            if target_curie not in self._reverse_mappings:
                self._reverse_mappings[target_curie] = set()
            self._reverse_mappings[target_curie].update(
                self._reverse_mappings[source_curie]
            )

        logger.info(f"Merged {source_curie} into {target_curie}")

    def deprecate_id(
        self,
        canonical_id: CanonicalID,
        reason: str = ""
    ):
        """
        Deprecate a canonical ID.

        Args:
            canonical_id: ID to deprecate
            reason: Reason for deprecation
        """
        canonical_id.status = "deprecated"
        canonical_id.updated_at = datetime.utcnow().isoformat()
        canonical_id.metadata["deprecation_reason"] = reason

    def get_external_url(
        self,
        namespace: IDNamespace,
        identifier: str
    ) -> Optional[str]:
        """
        Get external URL for an ID.

        Args:
            namespace: ID namespace
            identifier: Identifier

        Returns:
            URL or None
        """
        base_url = self.NAMESPACE_URLS.get(namespace)
        if base_url:
            return f"{base_url}/{identifier}"
        return None

    def normalize_id(
        self,
        raw_id: str
    ) -> Optional[tuple]:
        """
        Normalize a raw ID string to (namespace, id).

        Args:
            raw_id: Raw ID string

        Returns:
            Tuple of (namespace, id) or None
        """
        # Handle CURIE format
        if ":" in raw_id:
            parts = raw_id.split(":", 1)
            if len(parts) == 2:
                namespace_str, identifier = parts
                try:
                    namespace = IDNamespace(namespace_str.lower())
                    return (namespace, identifier)
                except ValueError:
                    # Unknown namespace, return as-is
                    return (namespace_str, identifier)

        # Handle URL format
        for namespace, base_url in self.NAMESPACE_URLS.items():
            if base_url in raw_id:
                identifier = raw_id.replace(base_url, "").strip("/")
                return (namespace, identifier)

        return None

    def batch_resolve(
        self,
        ids: List[str]
    ) -> Dict[str, Optional[CanonicalID]]:
        """
        Resolve multiple IDs to canonical IDs.

        Args:
            ids: List of IDs (CURIEs or raw)

        Returns:
            Dictionary of input -> CanonicalID
        """
        results = {}

        for raw_id in ids:
            normalized = self.normalize_id(raw_id)
            if normalized:
                namespace, identifier = normalized
                if isinstance(namespace, IDNamespace):
                    canonical = self.get_canonical(namespace.value, identifier)
                else:
                    canonical = self.get_canonical(namespace, identifier)
                results[raw_id] = canonical
            else:
                results[raw_id] = None

        return results

    def get_statistics(self) -> Dict[str, Any]:
        """Get manager statistics."""
        namespace_counts = {}
        status_counts = {"active": 0, "deprecated": 0, "merged": 0}

        for canonical_id in self._ids.values():
            ns = canonical_id.namespace.value
            namespace_counts[ns] = namespace_counts.get(ns, 0) + 1
            status_counts[canonical_id.status] = status_counts.get(canonical_id.status, 0) + 1

        return {
            "total_canonical_ids": len(self._ids),
            "total_mappings": sum(len(m) for m in self._mappings.values()),
            "ids_by_namespace": namespace_counts,
            "ids_by_status": status_counts,
            "external_namespaces": len(set(
                k.split(":")[0] for k in self._mappings.keys()
            ))
        }

    def export_mappings(self) -> List[Dict[str, Any]]:
        """Export all mappings."""
        mappings = []
        for mapping_list in self._mappings.values():
            for mapping in mapping_list:
                mappings.append(mapping.to_dict())
        return mappings


# Convenience functions
def generate_canonical_id(
    entity_name: str,
    entity_type: str
) -> CanonicalID:
    """Generate a canonical ID using default manager."""
    manager = CanonicalIDManager()
    return manager.generate_id(entity_name, entity_type)


def resolve_to_canonical(raw_id: str) -> Optional[CanonicalID]:
    """Resolve an ID to canonical using default manager."""
    manager = CanonicalIDManager()
    normalized = manager.normalize_id(raw_id)
    if normalized:
        namespace, identifier = normalized
        if isinstance(namespace, IDNamespace):
            return manager.get_canonical(namespace.value, identifier)
    return None
