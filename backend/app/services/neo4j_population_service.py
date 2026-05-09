"""
Neo4j Real-Time Population Service

Populates the Neo4j knowledge graph in real-time as biomedical discoveries are made.
Extracts entities and relationships from discovery pipeline outputs and builds
a rich biomedical knowledge graph with proper ontology types.

Features:
- Real-time entity and relationship extraction from discovery pipeline
- Batch upsert operations with MERGE semantics (idempotent)
- NLP-based entity extraction using regex patterns for biomedical entities
- Integration with entity_resolution module for canonical IDs
- Provenance tracking (discovery round, stage, timestamps)
- Confidence scoring on all nodes and relationships
- Incremental updates (never full rebuilds)
- Constraint and index management for performance
"""

from __future__ import annotations

import hashlib
import re
import time
from datetime import UTC, datetime
from typing import Any

from neo4j import AsyncDriver, AsyncGraphDatabase

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

ENTITY_TYPES: set[str] = {
    "Gene", "Protein", "Disease", "Drug", "Pathway", "ClinicalTrial",
    "Compound", "Metabolite", "CellType", "Tissue", "Organ",
    "Symptom", "Phenotype", "Biomarker", "Variant",
    "MolecularFunction", "BiologicalProcess", "CellularComponent",
}

RELATIONSHIP_TYPES: set[str] = {
    "TARGETS", "INHIBITS", "ACTIVATES", "REGULATES",
    "ASSOCIATED_WITH", "CAUSES", "TREATS", "PREVENTS",
    "PARTICIPATES_IN", "EXPRESSED_IN", "LOCATED_IN",
    "INTERACTS_WITH", "BINDS_TO", "PHOSPHORYLATES",
    "UPREGULATES", "DOWNREGULATES", "ENCODES",
    "VARIANT_OF", "SUBTYPE_OF", "PART_OF",
}

# ---------------------------------------------------------------------------
# Regex patterns for biomedical entity extraction
# ---------------------------------------------------------------------------

# Gene symbols: 2-6 uppercase letters optionally followed by a digit (BRCA1, TP53, EGFR, etc.)
_GENE_PATTERN = re.compile(
    r"\b([A-Z][A-Z0-9]{1,5}(?:-[A-Z0-9]{1,3})?)\b"
)

# Known gene names that are common in biomedical text (curated seed list)
_KNOWN_GENES: set[str] = {
    "BRCA1", "BRCA2", "TP53", "EGFR", "KRAS", "BRAF", "PIK3CA", "PTEN",
    "AKT1", "MTOR", "MYC", "RB1", "APC", "VEGF", "VEGFA", "HER2", "ERBB2",
    "ALK", "ROS1", "MET", "NRAS", "HRAS", "RAF1", "MEK1", "ERK1", "ERK2",
    "JAK2", "STAT3", "BCL2", "BAX", "CASP3", "CASP9", "TNF", "IL6", "IL1B",
    "TGFB1", "WNT1", "NOTCH1", "SHH", "CTNNB1", "CDH1", "CDK4", "CDK6",
    "CDKN2A", "RAS", "MAP2K1", "MAPK1", "FGFR1", "FGFR2", "FGFR3", "PDGFRA",
    "KIT", "FLT3", "ABL1", "BCR", "NPM1", "IDH1", "IDH2", "DNMT3A", "TET2",
    "WT1", "EZH2", "SUZ12", "ARID1A", "SMAD4", "VHL", "NF1", "NF2", "TSC1",
    "TSC2", "STK11", "CHEK2", "ATM", "ATR", "PALB2", "RAD51", "XRCC1",
    "MLH1", "MSH2", "MSH6", "PMS2", "POLE", "ACE2", "TMPRSS2", "APOE",
    "APP", "MAPT", "SNCA", "PARK2", "LRRK2", "GBA", "CFTR", "HTT", "FMR1",
    "DMD", "SOD1", "TARDBP", "FUS", "C9orf72", "SMN1", "SMN2", "HBB",
    "HBA1", "HBA2", "HEXA", "PAH", "GAA", "GLA", "IDUA", "SGSH",
    "PD1", "PDL1", "CTLA4", "CD274", "PDCD1", "LAG3", "TIM3", "TIGIT",
}

# Drug name patterns: capitalize first letter, may include hyphens
_DRUG_PATTERN = re.compile(
    r"\b([A-Z][a-z]{2,}(?:[-][a-z]+)*(?:ib|ab|mab|nib|lib|zib|rib|"
    r"tin|ine|ide|ole|one|ate|mus|zole|pine|pril|rtan|statin|"
    r"cillin|mycin|cycline|floxacin|prazole|lukast|setron|"
    r"sartan|dipine|olol|gliptin|tide|umab|izumab|ximab|"
    r"tuzumab|platin|taxel|rubicin|poside))\b"
)

# Disease patterns: words ending in common disease suffixes
_DISEASE_SUFFIXES = re.compile(
    r"\b([A-Z][a-z]+(?:\s[a-z]+)*\s?"
    r"(?:cancer|carcinoma|lymphoma|leukemia|melanoma|sarcoma|"
    r"disease|disorder|syndrome|deficiency|failure|"
    r"itis|osis|emia|opathy|penia|cytosis|plasia))\b",
    re.IGNORECASE,
)

# Pathway patterns
_PATHWAY_PATTERN = re.compile(
    r"\b([A-Z][A-Za-z0-9/\-]*\s(?:pathway|signaling|cascade|axis))\b",
    re.IGNORECASE,
)

# Clinical trial patterns (NCT numbers)
_CLINICAL_TRIAL_PATTERN = re.compile(r"\b(NCT\d{8})\b")

# Protein patterns (ending in -ase, -in, receptor, etc.)
_PROTEIN_PATTERN = re.compile(
    r"\b([A-Z][a-z]+(?:[-\s][a-z]+)*\s?"
    r"(?:kinase|phosphatase|ligase|protease|synthase|transferase|"
    r"polymerase|helicase|dehydrogenase|oxidase|reductase|"
    r"receptor|transporter|channel|pump|factor|globin|"
    r"antibody|immunoglobulin|integrin|cadherin|selectin))\b",
    re.IGNORECASE,
)

# Variant patterns (e.g., V600E, R132H, c.1234A>G, p.Arg132His)
_VARIANT_PATTERN = re.compile(
    r"\b([A-Z]\d{1,4}[A-Z])\b"  # simple e.g. V600E
    r"|\b(p\.[A-Z][a-z]{2}\d+[A-Z][a-z]{2})\b"  # HGVS protein
    r"|\b(c\.\d+[ACGT]>[ACGT])\b"  # HGVS coding DNA
)

# Relationship keyword mapping
_RELATIONSHIP_KEYWORDS: dict[str, list[str]] = {
    "TARGETS": ["targets", "target of", "targeted by"],
    "INHIBITS": ["inhibits", "inhibition of", "inhibited by", "blocks", "suppresses", "antagonizes"],
    "ACTIVATES": ["activates", "activation of", "activated by", "stimulates", "agonizes"],
    "REGULATES": ["regulates", "regulation of", "regulated by", "modulates", "controls"],
    "ASSOCIATED_WITH": ["associated with", "linked to", "correlated with", "implicated in"],
    "CAUSES": ["causes", "leads to", "results in", "induces", "triggers"],
    "TREATS": ["treats", "treatment for", "therapeutic for", "used to treat", "ameliorates"],
    "PREVENTS": ["prevents", "prevention of", "protective against", "prophylaxis"],
    "PARTICIPATES_IN": ["participates in", "involved in", "plays a role in", "contributes to"],
    "EXPRESSED_IN": ["expressed in", "expression in", "found in", "detected in"],
    "LOCATED_IN": ["located in", "localized to", "present in"],
    "INTERACTS_WITH": ["interacts with", "interaction with", "binds", "complexes with"],
    "BINDS_TO": ["binds to", "binding to", "affinity for", "ligand of"],
    "PHOSPHORYLATES": ["phosphorylates", "phosphorylation of"],
    "UPREGULATES": ["upregulates", "upregulation of", "increases expression of", "elevates"],
    "DOWNREGULATES": ["downregulates", "downregulation of", "decreases expression of", "reduces expression"],
    "ENCODES": ["encodes", "encoding", "codes for", "gene product"],
    "VARIANT_OF": ["variant of", "mutation in", "polymorphism of", "allele of"],
    "SUBTYPE_OF": ["subtype of", "subclass of", "type of", "form of"],
    "PART_OF": ["part of", "component of", "member of", "subunit of"],
}

# Build a flattened lookup: keyword phrase -> relationship type
_KEYWORD_TO_REL: dict[str, str] = {}
for rel_type, keywords in _RELATIONSHIP_KEYWORDS.items():
    for kw in keywords:
        _KEYWORD_TO_REL[kw] = rel_type

# Common stopwords to skip during gene-symbol matching (false positives)
_GENE_STOPWORDS: set[str] = {
    "THE", "AND", "FOR", "WITH", "NOT", "BUT", "ARE", "WAS", "HAS",
    "HAD", "CAN", "MAY", "ALL", "NEW", "OLD", "SET", "PUT", "GET",
    "RUN", "USE", "TWO", "RNA", "DNA", "ATP", "ADP", "GTP", "GDP",
    "NAD", "FAD", "COA", "PPI", "FDA", "NIH", "WHO", "CDC", "EMA",
    "IND", "NDA", "BLA", "ICH", "GMP", "GCP", "GLP", "IRB", "SAE",
    "BMI", "ECG", "EEG", "MRI", "PET", "ICU", "ERR", "END",
    "USA", "HIV", "HPV", "HCV", "HBV", "RSV", "CMV", "EBV",
}


def _generate_entity_id(entity_type: str, name: str) -> str:
    """Generate a deterministic entity ID from type and name."""
    content = f"{entity_type}:{name}".lower().strip()
    return hashlib.sha256(content.encode()).hexdigest()[:16]


def _utcnow_iso() -> str:
    """Return current UTC time as ISO 8601 string."""
    return datetime.now(UTC).isoformat()


# ---------------------------------------------------------------------------
# Neo4j Population Service
# ---------------------------------------------------------------------------

class Neo4jPopulationService:
    """Real-time Neo4j knowledge graph population service.

    Extracts entities and relationships from discovery pipeline outputs and
    populates Neo4j incrementally using MERGE semantics (idempotent).

    All nodes carry:
        - entity_id (deterministic hash)
        - name, entity_type, aliases
        - confidence, source_stage, source_round, provenance
        - created_at, updated_at

    All relationships carry:
        - confidence, evidence_count
        - source_stage, source_round, provenance
        - created_at, updated_at
    """

    def __init__(self) -> None:
        self._driver: AsyncDriver | None = None
        self._initialized: bool = False
        self._entity_resolver: Any = None  # lazy-loaded EntityResolver

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    async def initialize(self) -> None:
        """Initialize the Neo4j async driver and create indexes/constraints."""
        if self._initialized:
            return

        logger.info(
            "Initializing Neo4jPopulationService",
            uri=settings.NEO4J_URI,
            user=settings.NEO4J_USER,
        )

        try:
            self._driver = AsyncGraphDatabase.driver(
                settings.NEO4J_URI,
                auth=(settings.NEO4J_USER, settings.neo4j_password_value),
                max_connection_pool_size=50,
                connection_acquisition_timeout=30,
            )

            # Verify connectivity
            async with self._driver.session() as session:
                await session.run("RETURN 1")

            logger.info("Neo4j connection established")

            # Create indexes and constraints
            await self.create_indexes()

            self._initialized = True
            logger.info("Neo4jPopulationService initialized")

        except Exception as exc:
            logger.error("Failed to initialize Neo4jPopulationService", error=str(exc))
            raise

    async def close(self) -> None:
        """Close the Neo4j driver and release resources."""
        if self._driver:
            await self._driver.close()
            self._driver = None
            self._initialized = False
            logger.info("Neo4jPopulationService closed")

    def _ensure_initialized(self) -> None:
        """Raise if service is not initialized."""
        if not self._initialized or self._driver is None:
            raise RuntimeError(
                "Neo4jPopulationService is not initialized. Call initialize() first."
            )

    def _get_entity_resolver(self) -> Any:
        """Lazy-load the entity resolver to avoid import-time overhead."""
        if self._entity_resolver is None:
            try:
                from app.entity_resolution.resolver import create_resolver
                self._entity_resolver = create_resolver(preset="default")
            except Exception as exc:
                logger.warning(
                    "Could not load EntityResolver, proceeding without resolution",
                    error=str(exc),
                )
        return self._entity_resolver

    # ------------------------------------------------------------------
    # Index and constraint management
    # ------------------------------------------------------------------

    async def create_indexes(self) -> None:
        """Create Neo4j indexes and constraints for all entity types.

        Uses uniqueness constraints on (entity_type, entity_id) pairs and
        full-text indexes on entity names for search.
        """
        self._ensure_initialized()
        assert self._driver is not None

        async with self._driver.session() as session:
            # Per-label uniqueness constraint on entity_id
            for entity_type in ENTITY_TYPES:
                try:
                    await session.run(
                        f"CREATE CONSTRAINT IF NOT EXISTS "
                        f"FOR (n:{entity_type}) REQUIRE n.entity_id IS UNIQUE"
                    )
                except Exception as exc:
                    logger.debug(
                        "Constraint creation skipped",
                        entity_type=entity_type,
                        error=str(exc),
                    )

            # Composite index on name for fast lookup
            for entity_type in ENTITY_TYPES:
                try:
                    await session.run(
                        f"CREATE INDEX IF NOT EXISTS "
                        f"FOR (n:{entity_type}) ON (n.name)"
                    )
                except Exception as exc:
                    logger.debug(
                        "Index creation skipped",
                        entity_type=entity_type,
                        error=str(exc),
                    )

            # Index on updated_at for temporal queries
            for entity_type in ENTITY_TYPES:
                try:
                    await session.run(
                        f"CREATE INDEX IF NOT EXISTS "
                        f"FOR (n:{entity_type}) ON (n.updated_at)"
                    )
                except Exception as exc:
                    logger.debug(
                        "Timestamp index skipped",
                        entity_type=entity_type,
                        error=str(exc),
                    )

            logger.info("Neo4j indexes and constraints created")

    # ------------------------------------------------------------------
    # Entity upsert
    # ------------------------------------------------------------------

    # ── A3 Phase 2 — dual-write helpers ──────────────────────────────
    # Mirror each successful Neo4j write to the Postgres-backed
    # PostgresGraphStore so the new tables catch up. Postgres failures
    # log at warning and DO NOT fail the orchestrator's bulk-ingest —
    # Neo4j stays authoritative through Phase 2.

    async def _mirror_entity_dual_write(
        self,
        *,
        entity_id: str,
        canonical_name: str,
        entity_type: str,
        description: str,
        aliases: list[str],
        canonical_id_str: str,
        confidence: float,
        evidence_count: int,
    ) -> None:
        if not getattr(settings, "KG_DUAL_WRITE", False):
            return
        try:
            from app.knowledge.graph_store import Entity
            from app.knowledge.postgres_graph_store import (
                get_postgres_graph_store,
            )
            ent = Entity(
                id=entity_id,
                name=canonical_name,
                entity_type=entity_type,
                aliases=list(aliases or []),
                description=description or None,
                external_ids=(
                    {"canonical_id": canonical_id_str} if canonical_id_str else {}
                ),
                properties={"confidence": confidence},
                source_count=evidence_count,
            )
            await get_postgres_graph_store().add_entity(ent)
        except Exception as exc:
            logger.warning(
                "kg_dual_write.entity_failed",
                extra={
                    "event": "kg_dual_write.entity_failed",
                    "entity_id": entity_id,
                    "error": str(exc),
                },
            )

    async def _mirror_relationship_dual_write(
        self,
        *,
        source_id: str,
        target_id: str,
        rel_type: str,
        confidence: float,
        evidence_count: int,
        source_name: str = "",
        target_name: str = "",
        evidence_text: str = "",
    ) -> None:
        if not getattr(settings, "KG_DUAL_WRITE", False):
            return
        try:
            from app.knowledge.graph_store import Relation
            from app.knowledge.postgres_graph_store import (
                get_postgres_graph_store,
            )
            rel = Relation(
                # Deterministic edge id = hash(src|type|tgt) so re-runs
                # of the dual-write or the backfill land on the same
                # Postgres edge row (the store hashes non-UUID ids
                # through UUID5 to a stable row uuid).
                id=f"{source_id}|{rel_type}|{target_id}",
                source_id=source_id,
                source_name=source_name,
                source_type="",
                target_id=target_id,
                target_name=target_name,
                target_type="",
                relation_type=rel_type,
                confidence=confidence,
                evidence_count=evidence_count,
                source_references=[evidence_text] if evidence_text else [],
            )
            await get_postgres_graph_store().add_relation(rel)
        except Exception as exc:
            logger.warning(
                "kg_dual_write.relation_failed",
                extra={
                    "event": "kg_dual_write.relation_failed",
                    "source_id": source_id,
                    "target_id": target_id,
                    "rel_type": rel_type,
                    "error": str(exc),
                },
            )

    async def upsert_entity(
        self,
        entity_type: str,
        name: str,
        properties: dict[str, Any] | None = None,
    ) -> str:
        """Upsert a single entity node using MERGE.

        Args:
            entity_type: One of ENTITY_TYPES (e.g. "Gene", "Drug").
            name: Display name of the entity.
            properties: Extra properties (confidence, source_stage, etc.).

        Returns:
            The deterministic entity_id.
        """
        self._ensure_initialized()
        assert self._driver is not None

        if entity_type not in ENTITY_TYPES:
            logger.warning("Unknown entity type, defaulting to label", entity_type=entity_type)

        properties = properties or {}
        entity_id = _generate_entity_id(entity_type, name)
        now = _utcnow_iso()

        # Resolve canonical info if resolver is available
        canonical_name = name
        canonical_id_str: str | None = None
        resolver = self._get_entity_resolver()
        if resolver is not None:
            try:
                resolved = resolver.resolve(name, entity_type=entity_type)
                if resolved and resolved.canonical_name:
                    canonical_name = resolved.canonical_name
                if resolved and resolved.canonical_id:
                    canonical_id_str = resolved.canonical_id.get_curie()
            except Exception:
                pass  # resolver failures are non-fatal

        props = {
            "entity_id": entity_id,
            "name": canonical_name,
            "original_name": name,
            "entity_type": entity_type,
            "canonical_id": canonical_id_str or "",
            "confidence": float(properties.get("confidence", 0.5)),
            "source_stage": str(properties.get("source_stage", "")),
            "source_round": str(properties.get("source_round", "")),
            "provenance": str(properties.get("provenance", "")),
            "disease_context": str(properties.get("disease_context", "")),
            "description": str(properties.get("description", "")),
            "aliases": properties.get("aliases", []),
            "evidence_count": int(properties.get("evidence_count", 1)),
            "updated_at": now,
        }

        # Use a sanitised label (alphanumeric only, fallback to Entity)
        safe_label = re.sub(r"[^A-Za-z0-9]", "", entity_type) or "Entity"

        query = f"""
        MERGE (n:{safe_label} {{entity_id: $entity_id}})
        ON CREATE SET
            n.name = $name,
            n.original_name = $original_name,
            n.entity_type = $entity_type,
            n.canonical_id = $canonical_id,
            n.confidence = $confidence,
            n.source_stage = $source_stage,
            n.source_round = $source_round,
            n.provenance = $provenance,
            n.disease_context = $disease_context,
            n.description = $description,
            n.aliases = $aliases,
            n.evidence_count = $evidence_count,
            n.created_at = $updated_at,
            n.updated_at = $updated_at
        ON MATCH SET
            n.confidence = CASE WHEN n.confidence < $confidence THEN $confidence ELSE n.confidence END,
            n.evidence_count = n.evidence_count + 1,
            n.updated_at = $updated_at,
            n.source_stage = CASE WHEN $source_stage <> '' THEN $source_stage ELSE n.source_stage END,
            n.source_round = CASE WHEN $source_round <> '' THEN $source_round ELSE n.source_round END,
            n.description = CASE WHEN $description <> '' THEN $description ELSE n.description END
        RETURN n.entity_id AS entity_id
        """

        async with self._driver.session() as session:
            result = await session.run(query, **props)
            record = await result.single()
            stored_id = record["entity_id"] if record else entity_id

        # A3 Phase 2 — Postgres mirror after Neo4j commits. Best-effort.
        await self._mirror_entity_dual_write(
            entity_id=stored_id,
            canonical_name=props["name"],
            entity_type=entity_type,
            description=props["description"],
            aliases=list(props.get("aliases") or []),
            canonical_id_str=props["canonical_id"],
            confidence=props["confidence"],
            evidence_count=props["evidence_count"],
        )
        return stored_id

    async def upsert_entities_batch(
        self,
        entities: list[dict[str, Any]],
    ) -> list[str]:
        """Upsert multiple entities in a single transaction.

        Each dict must contain at least ``entity_type`` and ``name``.
        Optional keys: ``properties`` (dict of extra properties).

        Returns:
            List of entity_id strings.
        """
        self._ensure_initialized()
        assert self._driver is not None

        if not entities:
            return []

        ids: list[str] = []
        now = _utcnow_iso()
        resolver = self._get_entity_resolver()

        # Prepare rows grouped by entity_type for efficient batching
        rows_by_type: dict[str, list[dict[str, Any]]] = {}
        for ent in entities:
            etype = ent.get("entity_type", "Entity")
            name = ent.get("name", "")
            if not name:
                continue
            props = ent.get("properties", {})
            entity_id = _generate_entity_id(etype, name)

            canonical_name = name
            canonical_id_str = ""
            if resolver is not None:
                try:
                    resolved = resolver.resolve(name, entity_type=etype)
                    if resolved and resolved.canonical_name:
                        canonical_name = resolved.canonical_name
                    if resolved and resolved.canonical_id:
                        canonical_id_str = resolved.canonical_id.get_curie()
                except Exception as exc:
                    # best-effort: name remains uncanonicalised; surface resolver issues
                    logger.warning(
                        "kg.entity_resolver_failed: name=%s type=%s error=%s",
                        name,
                        etype,
                        exc,
                    )

            row = {
                "entity_id": entity_id,
                "name": canonical_name,
                "original_name": name,
                "entity_type": etype,
                "canonical_id": canonical_id_str,
                "confidence": float(props.get("confidence", 0.5)),
                "source_stage": str(props.get("source_stage", "")),
                "source_round": str(props.get("source_round", "")),
                "provenance": str(props.get("provenance", "")),
                "disease_context": str(props.get("disease_context", "")),
                "description": str(props.get("description", "")),
                "aliases": props.get("aliases", []),
                "evidence_count": int(props.get("evidence_count", 1)),
                "updated_at": now,
            }

            safe_label = re.sub(r"[^A-Za-z0-9]", "", etype) or "Entity"
            rows_by_type.setdefault(safe_label, []).append(row)
            ids.append(entity_id)

        async with self._driver.session() as session:
            async with await session.begin_transaction() as tx:
                for label, rows in rows_by_type.items():
                    query = f"""
                    UNWIND $rows AS row
                    MERGE (n:{label} {{entity_id: row.entity_id}})
                    ON CREATE SET
                        n.name = row.name,
                        n.original_name = row.original_name,
                        n.entity_type = row.entity_type,
                        n.canonical_id = row.canonical_id,
                        n.confidence = row.confidence,
                        n.source_stage = row.source_stage,
                        n.source_round = row.source_round,
                        n.provenance = row.provenance,
                        n.disease_context = row.disease_context,
                        n.description = row.description,
                        n.aliases = row.aliases,
                        n.evidence_count = row.evidence_count,
                        n.created_at = row.updated_at,
                        n.updated_at = row.updated_at
                    ON MATCH SET
                        n.confidence = CASE WHEN n.confidence < row.confidence
                                       THEN row.confidence ELSE n.confidence END,
                        n.evidence_count = n.evidence_count + 1,
                        n.updated_at = row.updated_at
                    """
                    await tx.run(query, rows=rows)
                await tx.commit()

        # A3 Phase 2 — mirror every row we just persisted to Postgres.
        # Iteration order matches `ids` because we appended to both
        # sides in lockstep above. Best-effort per row; one failure
        # doesn't stop the rest.
        if getattr(settings, "KG_DUAL_WRITE", False):
            for label_rows in rows_by_type.values():
                for row in label_rows:
                    await self._mirror_entity_dual_write(
                        entity_id=row["entity_id"],
                        canonical_name=row["name"],
                        entity_type=row["entity_type"],
                        description=row["description"],
                        aliases=list(row.get("aliases") or []),
                        canonical_id_str=row["canonical_id"],
                        confidence=row["confidence"],
                        evidence_count=row["evidence_count"],
                    )

        logger.info("Batch upserted entities", count=len(ids))
        return ids

    # ------------------------------------------------------------------
    # Relationship upsert
    # ------------------------------------------------------------------

    async def upsert_relationship(
        self,
        source: str,
        target: str,
        rel_type: str,
        properties: dict[str, Any] | None = None,
    ) -> None:
        """Upsert a relationship between two entities (matched by name).

        Uses MERGE on source/target entity_id pairs. Relationship type must
        be one of RELATIONSHIP_TYPES.

        Args:
            source: Name of the source entity.
            target: Name of the target entity.
            rel_type: Relationship type (e.g. "TARGETS").
            properties: Extra relationship properties.
        """
        self._ensure_initialized()
        assert self._driver is not None

        rel_type = rel_type.upper().replace(" ", "_")
        if rel_type not in RELATIONSHIP_TYPES:
            logger.warning("Unknown relationship type, using ASSOCIATED_WITH", rel_type=rel_type)
            rel_type = "ASSOCIATED_WITH"

        properties = properties or {}
        now = _utcnow_iso()

        source_type = properties.pop("source_type", "Entity")
        target_type = properties.pop("target_type", "Entity")

        source_id = _generate_entity_id(source_type, source)
        target_id = _generate_entity_id(target_type, target)

        props = {
            "source_id": source_id,
            "target_id": target_id,
            "confidence": float(properties.get("confidence", 0.5)),
            "evidence_count": int(properties.get("evidence_count", 1)),
            "source_stage": str(properties.get("source_stage", "")),
            "source_round": str(properties.get("source_round", "")),
            "provenance": str(properties.get("provenance", "")),
            "evidence_text": str(properties.get("evidence_text", "")),
            "updated_at": now,
        }

        # We match on entity_id across any label
        query = f"""
        MATCH (s {{entity_id: $source_id}})
        MATCH (t {{entity_id: $target_id}})
        MERGE (s)-[r:{rel_type}]->(t)
        ON CREATE SET
            r.confidence = $confidence,
            r.evidence_count = $evidence_count,
            r.source_stage = $source_stage,
            r.source_round = $source_round,
            r.provenance = $provenance,
            r.evidence_text = $evidence_text,
            r.created_at = $updated_at,
            r.updated_at = $updated_at
        ON MATCH SET
            r.confidence = CASE WHEN r.confidence < $confidence
                           THEN $confidence ELSE r.confidence END,
            r.evidence_count = r.evidence_count + 1,
            r.updated_at = $updated_at,
            r.evidence_text = CASE WHEN $evidence_text <> ''
                              THEN $evidence_text ELSE r.evidence_text END
        """

        async with self._driver.session() as session:
            await session.run(query, **props)

        # A3 Phase 2 — Postgres mirror after Neo4j commits. Best-effort.
        await self._mirror_relationship_dual_write(
            source_id=props["source_id"],
            target_id=props["target_id"],
            rel_type=rel_type,
            confidence=props["confidence"],
            evidence_count=props["evidence_count"],
            source_name=source,
            target_name=target,
            evidence_text=props["evidence_text"],
        )

    async def upsert_relationships_batch(
        self,
        relationships: list[dict[str, Any]],
    ) -> None:
        """Upsert multiple relationships in a single transaction.

        Each dict must contain: ``source``, ``target``, ``rel_type``.
        Optional: ``properties`` dict.
        """
        self._ensure_initialized()
        assert self._driver is not None

        if not relationships:
            return

        now = _utcnow_iso()

        # Group by rel_type for efficient batching
        rows_by_rel: dict[str, list[dict[str, Any]]] = {}
        for rel in relationships:
            rt = rel.get("rel_type", "ASSOCIATED_WITH").upper().replace(" ", "_")
            if rt not in RELATIONSHIP_TYPES:
                rt = "ASSOCIATED_WITH"
            props = rel.get("properties", {})

            source_type = props.get("source_type", "Entity")
            target_type = props.get("target_type", "Entity")

            row = {
                "source_id": _generate_entity_id(source_type, rel.get("source", "")),
                "target_id": _generate_entity_id(target_type, rel.get("target", "")),
                "confidence": float(props.get("confidence", 0.5)),
                "evidence_count": int(props.get("evidence_count", 1)),
                "source_stage": str(props.get("source_stage", "")),
                "source_round": str(props.get("source_round", "")),
                "provenance": str(props.get("provenance", "")),
                "evidence_text": str(props.get("evidence_text", "")),
                "updated_at": now,
            }
            rows_by_rel.setdefault(rt, []).append(row)

        async with self._driver.session() as session:
            async with await session.begin_transaction() as tx:
                for rt, rows in rows_by_rel.items():
                    query = f"""
                    UNWIND $rows AS row
                    MATCH (s {{entity_id: row.source_id}})
                    MATCH (t {{entity_id: row.target_id}})
                    MERGE (s)-[r:{rt}]->(t)
                    ON CREATE SET
                        r.confidence = row.confidence,
                        r.evidence_count = row.evidence_count,
                        r.source_stage = row.source_stage,
                        r.source_round = row.source_round,
                        r.provenance = row.provenance,
                        r.evidence_text = row.evidence_text,
                        r.created_at = row.updated_at,
                        r.updated_at = row.updated_at
                    ON MATCH SET
                        r.confidence = CASE WHEN r.confidence < row.confidence
                                       THEN row.confidence ELSE r.confidence END,
                        r.evidence_count = r.evidence_count + 1,
                        r.updated_at = row.updated_at
                    """
                    await tx.run(query, rows=rows)
                await tx.commit()

        # A3 Phase 2 — mirror to Postgres. Best-effort per row.
        if getattr(settings, "KG_DUAL_WRITE", False):
            for rt, rows in rows_by_rel.items():
                # `relationships` is the input list; we don't have the
                # raw `source` / `target` names per row here, so fall
                # back to the entity_id strings — those are the rows'
                # FK source for Postgres anyway.
                for row in rows:
                    await self._mirror_relationship_dual_write(
                        source_id=row["source_id"],
                        target_id=row["target_id"],
                        rel_type=rt,
                        confidence=row["confidence"],
                        evidence_count=row["evidence_count"],
                        source_name="",
                        target_name="",
                        evidence_text=row["evidence_text"],
                    )

        logger.info("Batch upserted relationships", count=len(relationships))

    # ------------------------------------------------------------------
    # NLP entity extraction
    # ------------------------------------------------------------------

    async def extract_entities(self, text: str) -> list[dict[str, Any]]:
        """Extract biomedical entities from free text using pattern matching.

        Returns a list of dicts with keys: name, entity_type, confidence, start, end.
        """
        if not text:
            return []

        entities: list[dict[str, Any]] = []
        seen: set[str] = set()  # (name_lower, type) pairs to deduplicate

        def _add(name: str, etype: str, confidence: float, start: int, end: int) -> None:
            key = (name.lower(), etype)
            if key not in seen:
                seen.add(key)
                entities.append({
                    "name": name,
                    "entity_type": etype,
                    "confidence": confidence,
                    "start": start,
                    "end": end,
                })

        # Genes (known gene set)
        for m in _GENE_PATTERN.finditer(text):
            symbol = m.group(1)
            if symbol in _KNOWN_GENES:
                _add(symbol, "Gene", 0.95, m.start(), m.end())
            elif symbol not in _GENE_STOPWORDS and len(symbol) >= 3:
                # Potential gene, lower confidence
                _add(symbol, "Gene", 0.4, m.start(), m.end())

        # Drugs
        for m in _DRUG_PATTERN.finditer(text):
            _add(m.group(0), "Drug", 0.85, m.start(), m.end())

        # Diseases
        for m in _DISEASE_SUFFIXES.finditer(text):
            name = m.group(0).strip()
            if len(name) > 4:
                _add(name, "Disease", 0.8, m.start(), m.end())

        # Pathways
        for m in _PATHWAY_PATTERN.finditer(text):
            _add(m.group(0).strip(), "Pathway", 0.75, m.start(), m.end())

        # Clinical trials
        for m in _CLINICAL_TRIAL_PATTERN.finditer(text):
            _add(m.group(1), "ClinicalTrial", 0.99, m.start(), m.end())

        # Proteins
        for m in _PROTEIN_PATTERN.finditer(text):
            _add(m.group(0).strip(), "Protein", 0.7, m.start(), m.end())

        # Variants
        for m in _VARIANT_PATTERN.finditer(text):
            variant_str = m.group(0)
            if variant_str:
                _add(variant_str, "Variant", 0.9, m.start(), m.end())

        # Sort by position
        entities.sort(key=lambda e: e["start"])
        return entities

    async def extract_relationships(
        self,
        text: str,
        entities: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        """Extract relationships between entities from text.

        Uses keyword-based heuristic: for each pair of entities that appear
        close together (within 300 characters), check if a relationship
        keyword appears between them.

        Returns list of dicts: source, target, rel_type, confidence, evidence_text.
        """
        if not text or len(entities) < 2:
            return []

        relationships: list[dict[str, Any]] = []
        text_lower = text.lower()

        # Build sorted entity positions
        positioned = sorted(entities, key=lambda e: e.get("start", 0))

        for i, ent_a in enumerate(positioned):
            for j in range(i + 1, len(positioned)):
                ent_b = positioned[j]

                start_a = ent_a.get("end", 0)
                start_b = ent_b.get("start", 0)

                # Only consider entities within 300 chars of each other
                if start_b - start_a > 300:
                    break

                between = text_lower[start_a:start_b]

                # Check for relationship keywords in between text
                best_rel: str | None = None
                best_confidence = 0.0

                for keyword, rel_type in _KEYWORD_TO_REL.items():
                    if keyword in between:
                        # Confidence based on proximity (closer = higher)
                        distance = start_b - start_a
                        proximity_bonus = max(0, 1.0 - distance / 300.0) * 0.3
                        conf = 0.5 + proximity_bonus
                        if conf > best_confidence:
                            best_confidence = conf
                            best_rel = rel_type

                if best_rel:
                    evidence_start = max(0, ent_a.get("start", 0) - 20)
                    evidence_end = min(len(text), ent_b.get("end", 0) + 20)

                    relationships.append({
                        "source": ent_a["name"],
                        "target": ent_b["name"],
                        "rel_type": best_rel,
                        "confidence": round(best_confidence, 3),
                        "evidence_text": text[evidence_start:evidence_end],
                        "properties": {
                            "source_type": ent_a["entity_type"],
                            "target_type": ent_b["entity_type"],
                            "confidence": round(best_confidence, 3),
                        },
                    })

        return relationships

    # ------------------------------------------------------------------
    # Discovery pipeline integration
    # ------------------------------------------------------------------

    async def extract_and_populate_from_hypothesis(
        self,
        hypothesis: dict[str, Any],
    ) -> dict[str, Any]:
        """Extract entities/relationships from a hypothesis and populate Neo4j.

        Args:
            hypothesis: Dict with keys like 'title', 'description', 'mechanism',
                        'targets', 'disease', 'confidence', 'round', etc.

        Returns:
            Summary dict with counts of entities and relationships created.
        """
        self._ensure_initialized()
        start_ts = time.monotonic()

        text_parts = [
            hypothesis.get("title", ""),
            hypothesis.get("description", ""),
            hypothesis.get("mechanism", ""),
            hypothesis.get("rationale", ""),
            hypothesis.get("evidence_summary", ""),
        ]
        combined_text = " ".join(part for part in text_parts if part)

        disease = hypothesis.get("disease", "")
        round_id = str(hypothesis.get("round", hypothesis.get("round_id", "")))
        confidence = float(hypothesis.get("confidence", 0.5))

        # Extract entities
        entities = await self.extract_entities(combined_text)

        # Ensure the disease itself is an entity
        if disease:
            disease_present = any(
                e["name"].lower() == disease.lower() and e["entity_type"] == "Disease"
                for e in entities
            )
            if not disease_present:
                entities.append({
                    "name": disease,
                    "entity_type": "Disease",
                    "confidence": 0.95,
                    "start": 0,
                    "end": 0,
                })

        # Add explicit targets from hypothesis
        for target in hypothesis.get("targets", []):
            if isinstance(target, str) and target:
                target_present = any(e["name"].lower() == target.lower() for e in entities)
                if not target_present:
                    entities.append({
                        "name": target,
                        "entity_type": "Gene",  # most targets are genes/proteins
                        "confidence": 0.9,
                        "start": 0,
                        "end": 0,
                    })

        # Build entity dicts for batch upsert
        entity_dicts = [
            {
                "entity_type": e["entity_type"],
                "name": e["name"],
                "properties": {
                    "confidence": e.get("confidence", 0.5),
                    "source_stage": "hypothesis",
                    "source_round": round_id,
                    "disease_context": disease,
                    "provenance": f"hypothesis:{hypothesis.get('id', '')}",
                },
            }
            for e in entities
        ]

        entity_ids = await self.upsert_entities_batch(entity_dicts)

        # Extract relationships from text
        relationships = await self.extract_relationships(combined_text, entities)

        # Add explicit disease-target relationships
        if disease:
            for target in hypothesis.get("targets", []):
                if isinstance(target, str) and target:
                    relationships.append({
                        "source": target,
                        "target": disease,
                        "rel_type": "ASSOCIATED_WITH",
                        "confidence": confidence,
                        "properties": {
                            "source_type": "Gene",
                            "target_type": "Disease",
                            "confidence": confidence,
                            "source_stage": "hypothesis",
                            "source_round": round_id,
                            "provenance": f"hypothesis:{hypothesis.get('id', '')}",
                        },
                    })

        # Add drug-disease TREATS relationships from hypothesis
        drug_entities = [e for e in entities if e["entity_type"] == "Drug"]
        if disease and drug_entities:
            for drug in drug_entities:
                relationships.append({
                    "source": drug["name"],
                    "target": disease,
                    "rel_type": "TREATS",
                    "confidence": confidence * 0.8,
                    "properties": {
                        "source_type": "Drug",
                        "target_type": "Disease",
                        "confidence": confidence * 0.8,
                        "source_stage": "hypothesis",
                        "source_round": round_id,
                        "provenance": f"hypothesis:{hypothesis.get('id', '')}",
                    },
                })

        # Enrich relationship properties
        for rel in relationships:
            rel_props = rel.setdefault("properties", {})
            rel_props.setdefault("source_stage", "hypothesis")
            rel_props.setdefault("source_round", round_id)
            rel_props.setdefault("provenance", f"hypothesis:{hypothesis.get('id', '')}")

        await self.upsert_relationships_batch(relationships)

        elapsed = time.monotonic() - start_ts
        summary = {
            "entities_upserted": len(entity_ids),
            "relationships_upserted": len(relationships),
            "disease": disease,
            "round": round_id,
            "elapsed_seconds": round(elapsed, 3),
        }
        logger.info("Populated from hypothesis", **summary)
        return summary

    async def extract_and_populate_from_evidence(
        self,
        evidence: dict[str, Any],
    ) -> dict[str, Any]:
        """Extract entities/relationships from evidence and populate Neo4j.

        Args:
            evidence: Dict with keys like 'content', 'source', 'source_type',
                      'relevance_score', 'disease', etc.

        Returns:
            Summary dict.
        """
        self._ensure_initialized()
        start_ts = time.monotonic()

        content = evidence.get("content", "")
        disease = evidence.get("disease", "")
        source_ref = evidence.get("source", "")
        source_type = evidence.get("source_type", "unknown")

        entities = await self.extract_entities(content)

        if disease:
            disease_present = any(
                e["name"].lower() == disease.lower() and e["entity_type"] == "Disease"
                for e in entities
            )
            if not disease_present:
                entities.append({
                    "name": disease,
                    "entity_type": "Disease",
                    "confidence": 0.95,
                    "start": 0,
                    "end": 0,
                })

        provenance = f"evidence:{source_type}:{source_ref}"
        entity_dicts = [
            {
                "entity_type": e["entity_type"],
                "name": e["name"],
                "properties": {
                    "confidence": e.get("confidence", 0.5),
                    "source_stage": "evidence",
                    "disease_context": disease,
                    "provenance": provenance,
                },
            }
            for e in entities
        ]

        entity_ids = await self.upsert_entities_batch(entity_dicts)

        relationships = await self.extract_relationships(content, entities)
        for rel in relationships:
            rel_props = rel.setdefault("properties", {})
            rel_props.setdefault("source_stage", "evidence")
            rel_props.setdefault("provenance", provenance)

        await self.upsert_relationships_batch(relationships)

        elapsed = time.monotonic() - start_ts
        summary = {
            "entities_upserted": len(entity_ids),
            "relationships_upserted": len(relationships),
            "disease": disease,
            "source_type": source_type,
            "elapsed_seconds": round(elapsed, 3),
        }
        logger.info("Populated from evidence", **summary)
        return summary

    async def extract_and_populate_from_stage_output(
        self,
        stage_name: str,
        output: str,
        disease: str,
    ) -> dict[str, Any]:
        """Extract entities/relationships from a pipeline stage output.

        This is the general-purpose entry point for any discovery pipeline
        stage (exploration, analysis, synthesis, critique, etc.).

        Args:
            stage_name: Pipeline stage identifier (e.g. "exploration", "synthesis").
            output: Raw text output from the stage.
            disease: Disease context.

        Returns:
            Summary dict.
        """
        self._ensure_initialized()
        start_ts = time.monotonic()

        entities = await self.extract_entities(output)

        if disease:
            disease_present = any(
                e["name"].lower() == disease.lower() and e["entity_type"] == "Disease"
                for e in entities
            )
            if not disease_present:
                entities.append({
                    "name": disease,
                    "entity_type": "Disease",
                    "confidence": 0.95,
                    "start": 0,
                    "end": 0,
                })

        provenance = f"stage:{stage_name}"
        entity_dicts = [
            {
                "entity_type": e["entity_type"],
                "name": e["name"],
                "properties": {
                    "confidence": e.get("confidence", 0.5),
                    "source_stage": stage_name,
                    "disease_context": disease,
                    "provenance": provenance,
                },
            }
            for e in entities
        ]

        entity_ids = await self.upsert_entities_batch(entity_dicts)

        relationships = await self.extract_relationships(output, entities)
        for rel in relationships:
            rel_props = rel.setdefault("properties", {})
            rel_props.setdefault("source_stage", stage_name)
            rel_props.setdefault("provenance", provenance)

        await self.upsert_relationships_batch(relationships)

        elapsed = time.monotonic() - start_ts
        summary = {
            "entities_upserted": len(entity_ids),
            "relationships_upserted": len(relationships),
            "stage": stage_name,
            "disease": disease,
            "elapsed_seconds": round(elapsed, 3),
        }
        logger.info("Populated from stage output", **summary)
        return summary

    # ------------------------------------------------------------------
    # Query helpers
    # ------------------------------------------------------------------

    async def get_disease_subgraph(
        self,
        disease: str,
        depth: int = 2,
    ) -> dict[str, Any]:
        """Retrieve the subgraph around a disease entity.

        Returns nodes and edges up to ``depth`` hops from the disease node.
        """
        self._ensure_initialized()
        assert self._driver is not None

        disease_id = _generate_entity_id("Disease", disease)

        query = f"""
        MATCH path = (d:Disease {{entity_id: $disease_id}})-[*1..{min(depth, 5)}]-(n)
        WITH d, n, relationships(path) AS rels, path
        LIMIT 500
        RETURN
            d AS disease_node,
            collect(DISTINCT {{
                entity_id: n.entity_id,
                name: n.name,
                entity_type: n.entity_type,
                confidence: n.confidence
            }}) AS neighbors,
            [r IN rels |
                {{
                    type: type(r),
                    confidence: r.confidence,
                    evidence_count: r.evidence_count
                }}
            ] AS edges
        """

        nodes: list[dict[str, Any]] = []
        edges: list[dict[str, Any]] = []

        async with self._driver.session() as session:
            result = await session.run(query, disease_id=disease_id)
            async for record in result:
                d_node = record["disease_node"]
                if d_node:
                    nodes.append({
                        "entity_id": d_node.get("entity_id", ""),
                        "name": d_node.get("name", disease),
                        "entity_type": "Disease",
                        "confidence": d_node.get("confidence", 0),
                    })

                for neighbor in record.get("neighbors", []):
                    if neighbor and neighbor.get("entity_id"):
                        nodes.append(dict(neighbor))

                for edge in record.get("edges", []):
                    if edge:
                        edges.append(dict(edge))

        # Deduplicate nodes
        seen_ids: set[str] = set()
        unique_nodes = []
        for node in nodes:
            nid = node.get("entity_id", "")
            if nid and nid not in seen_ids:
                seen_ids.add(nid)
                unique_nodes.append(node)

        return {
            "disease": disease,
            "depth": depth,
            "nodes": unique_nodes,
            "edges": edges,
            "node_count": len(unique_nodes),
            "edge_count": len(edges),
        }

    async def get_entity_neighborhood(
        self,
        entity_name: str,
        depth: int = 1,
    ) -> dict[str, Any]:
        """Retrieve the neighborhood around any entity by name.

        Searches across all entity types.
        """
        self._ensure_initialized()
        assert self._driver is not None

        query = f"""
        MATCH (center {{name: $name}})
        WITH center LIMIT 1
        OPTIONAL MATCH path = (center)-[*1..{min(depth, 4)}]-(neighbor)
        WITH center, neighbor, relationships(path) AS rels
        LIMIT 200
        RETURN
            center.entity_id AS center_id,
            center.name AS center_name,
            center.entity_type AS center_type,
            collect(DISTINCT {{
                entity_id: neighbor.entity_id,
                name: neighbor.name,
                entity_type: neighbor.entity_type,
                confidence: neighbor.confidence
            }}) AS neighbors,
            [r IN rels |
                {{
                    type: type(r),
                    confidence: r.confidence,
                    evidence_count: r.evidence_count
                }}
            ] AS edges
        """

        async with self._driver.session() as session:
            result = await session.run(query, name=entity_name)
            record = await result.single()

            if not record or not record["center_id"]:
                return {
                    "entity": entity_name,
                    "found": False,
                    "nodes": [],
                    "edges": [],
                    "node_count": 0,
                    "edge_count": 0,
                }

            center_node = {
                "entity_id": record["center_id"],
                "name": record["center_name"],
                "entity_type": record["center_type"],
            }

            neighbors = [
                dict(n) for n in record.get("neighbors", [])
                if n and n.get("entity_id")
            ]
            edges = [dict(e) for e in record.get("edges", []) if e]

            return {
                "entity": entity_name,
                "found": True,
                "center": center_node,
                "nodes": [center_node] + neighbors,
                "edges": edges,
                "depth": depth,
                "node_count": 1 + len(neighbors),
                "edge_count": len(edges),
            }

    async def find_paths(
        self,
        source: str,
        target: str,
        max_depth: int = 4,
    ) -> list[dict[str, Any]]:
        """Find shortest paths between two entities by name.

        Returns up to 5 shortest paths with full node/edge detail.
        """
        self._ensure_initialized()
        assert self._driver is not None

        query = f"""
        MATCH (s {{name: $source}})
        WITH s LIMIT 1
        MATCH (t {{name: $target}})
        WITH s, t LIMIT 1
        MATCH path = shortestPath((s)-[*1..{min(max_depth, 8)}]-(t))
        WITH path, s, t,
             reduce(c = 1.0, r IN relationships(path) |
                c * coalesce(r.confidence, 0.5)) AS path_confidence
        ORDER BY path_confidence DESC
        LIMIT 5
        RETURN
            [n IN nodes(path) | {{
                entity_id: n.entity_id,
                name: n.name,
                entity_type: n.entity_type
            }}] AS path_nodes,
            [r IN relationships(path) | {{
                type: type(r),
                confidence: r.confidence,
                evidence_count: r.evidence_count
            }}] AS path_edges,
            length(path) AS path_length,
            path_confidence
        """

        paths: list[dict[str, Any]] = []

        async with self._driver.session() as session:
            result = await session.run(query, source=source, target=target)
            async for record in result:
                paths.append({
                    "nodes": [dict(n) for n in record["path_nodes"] if n],
                    "edges": [dict(e) for e in record["path_edges"] if e],
                    "length": record["path_length"],
                    "confidence": record["path_confidence"],
                })

        return paths

    async def get_statistics(self) -> dict[str, Any]:
        """Get knowledge graph statistics: node counts, edge counts, types."""
        self._ensure_initialized()
        assert self._driver is not None

        stats: dict[str, Any] = {}

        async with self._driver.session() as session:
            # Total node count
            result = await session.run("MATCH (n) RETURN count(n) AS cnt")
            record = await result.single()
            stats["total_nodes"] = record["cnt"] if record else 0

            # Total relationship count
            result = await session.run("MATCH ()-[r]->() RETURN count(r) AS cnt")
            record = await result.single()
            stats["total_relationships"] = record["cnt"] if record else 0

            # Node counts per label
            result = await session.run(
                "CALL db.labels() YIELD label "
                "CALL { WITH label "
                "  CALL db.stats.retrieve('GRAPH COUNTS') YIELD data "
                "  RETURN 0 AS cnt "
                "} "
                "RETURN label, cnt"
            )
            # Fallback: count per known entity type
            entity_counts: dict[str, int] = {}
            for etype in ENTITY_TYPES:
                try:
                    r = await session.run(
                        f"MATCH (n:{etype}) RETURN count(n) AS cnt"
                    )
                    rec = await r.single()
                    count = rec["cnt"] if rec else 0
                    if count > 0:
                        entity_counts[etype] = count
                except Exception as exc:
                    # best-effort: missing label or perms; report partial counts
                    logger.warning("kg.stats.entity_count_failed: type=%s error=%s", etype, exc)
            stats["entity_counts"] = entity_counts

            # Relationship type counts
            rel_counts: dict[str, int] = {}
            try:
                result = await session.run(
                    "MATCH ()-[r]->() "
                    "RETURN type(r) AS rel_type, count(r) AS cnt "
                    "ORDER BY cnt DESC"
                )
                async for record in result:
                    rel_counts[record["rel_type"]] = record["cnt"]
            except Exception as exc:
                # best-effort: stats endpoint should still return entity counts even if rel query fails
                logger.warning("kg.stats.relationship_counts_failed: %s", exc)
            stats["relationship_counts"] = rel_counts

            # Average confidence
            try:
                result = await session.run(
                    "MATCH (n) WHERE n.confidence IS NOT NULL "
                    "RETURN avg(n.confidence) AS avg_conf, "
                    "       min(n.confidence) AS min_conf, "
                    "       max(n.confidence) AS max_conf"
                )
                record = await result.single()
                if record:
                    stats["confidence"] = {
                        "avg": round(record["avg_conf"] or 0, 4),
                        "min": round(record["min_conf"] or 0, 4),
                        "max": round(record["max_conf"] or 0, 4),
                    }
            except Exception as exc:
                # best-effort: confidence aggregate is optional in the stats payload
                logger.warning("kg.stats.confidence_aggregate_failed: %s", exc)

            stats["timestamp"] = _utcnow_iso()

        return stats

    # ------------------------------------------------------------------
    # Maintenance
    # ------------------------------------------------------------------

    async def merge_duplicate_entities(self) -> int:
        """Merge entities that share the same canonical_id.

        For each group of nodes with the same canonical_id, keeps the one
        with the highest confidence and merges evidence counts.

        Returns:
            Number of duplicates merged.
        """
        self._ensure_initialized()
        assert self._driver is not None

        query = """
        MATCH (n)
        WHERE n.canonical_id IS NOT NULL AND n.canonical_id <> ''
        WITH n.canonical_id AS cid, collect(n) AS nodes
        WHERE size(nodes) > 1
        RETURN cid, [node IN nodes | {
            id: elementId(node),
            entity_id: node.entity_id,
            name: node.name,
            confidence: node.confidence,
            evidence_count: node.evidence_count
        }] AS node_list
        """

        merged_count = 0

        async with self._driver.session() as session:
            result = await session.run(query)
            groups = [record async for record in result]

        # Process each duplicate group
        for group in groups:
            node_list = group["node_list"]
            if len(node_list) < 2:
                continue

            # Pick the node with highest confidence as the keeper
            sorted_nodes = sorted(
                node_list, key=lambda n: (n.get("confidence", 0)), reverse=True
            )
            keeper = sorted_nodes[0]
            duplicates = sorted_nodes[1:]

            async with self._driver.session() as session:
                for dup in duplicates:
                    # Transfer relationships from duplicate to keeper
                    transfer_query = """
                    MATCH (dup) WHERE elementId(dup) = $dup_id
                    MATCH (keeper) WHERE elementId(keeper) = $keeper_id
                    OPTIONAL MATCH (dup)-[r_out]->(target)
                    WHERE target <> keeper
                    WITH dup, keeper, collect({rel: r_out, target: target}) AS outgoing
                    UNWIND outgoing AS out_rel
                    WITH dup, keeper, out_rel
                    WHERE out_rel.rel IS NOT NULL
                    CALL {
                        WITH keeper, out_rel
                        WITH keeper, out_rel.target AS target, type(out_rel.rel) AS rtype
                        // Cannot use dynamic rel type in pure Cypher; mark for manual transfer
                        RETURN 1 AS done
                    }
                    RETURN count(*) AS transferred
                    """

                    # Simpler approach: just aggregate evidence_count into keeper and delete dups
                    merge_query = """
                    MATCH (keeper) WHERE elementId(keeper) = $keeper_id
                    MATCH (dup) WHERE elementId(dup) = $dup_id
                    SET keeper.evidence_count = keeper.evidence_count +
                        coalesce(dup.evidence_count, 0),
                        keeper.updated_at = $now
                    WITH dup
                    DETACH DELETE dup
                    """
                    try:
                        await session.run(
                            merge_query,
                            keeper_id=keeper["id"],
                            dup_id=dup["id"],
                            now=_utcnow_iso(),
                        )
                        merged_count += 1
                    except Exception as exc:
                        logger.warning(
                            "Failed to merge duplicate",
                            keeper=keeper.get("name"),
                            dup=dup.get("name"),
                            error=str(exc),
                        )

        logger.info("Merged duplicate entities", merged_count=merged_count)
        return merged_count

    async def update_confidence_scores(self) -> None:
        """Recalculate confidence scores based on evidence counts.

        Nodes with more evidence get a confidence boost (capped at 1.0).
        Relationships aggregate confidence from connected nodes.
        """
        self._ensure_initialized()
        assert self._driver is not None

        async with self._driver.session() as session:
            # Update node confidence: base_confidence + log(evidence_count) * 0.1, capped at 1.0
            await session.run("""
                MATCH (n)
                WHERE n.evidence_count IS NOT NULL AND n.confidence IS NOT NULL
                SET n.confidence = CASE
                    WHEN n.confidence + (log(toFloat(n.evidence_count) + 1.0) * 0.05) > 1.0
                    THEN 1.0
                    ELSE n.confidence + (log(toFloat(n.evidence_count) + 1.0) * 0.05)
                END,
                n.updated_at = $now
            """, now=_utcnow_iso())

            # Update relationship confidence based on endpoint confidence
            await session.run("""
                MATCH (s)-[r]->(t)
                WHERE s.confidence IS NOT NULL AND t.confidence IS NOT NULL
                      AND r.confidence IS NOT NULL
                WITH r, (s.confidence + t.confidence) / 2.0 AS avg_node_conf
                SET r.confidence = CASE
                    WHEN (r.confidence + avg_node_conf) / 2.0 > 1.0 THEN 1.0
                    ELSE (r.confidence + avg_node_conf) / 2.0
                END,
                r.updated_at = $now
            """, now=_utcnow_iso())

        logger.info("Updated confidence scores")


# ---------------------------------------------------------------------------
# Module-level singleton and convenience functions
# ---------------------------------------------------------------------------

_service: Neo4jPopulationService | None = None


async def init_neo4j_population_service() -> Neo4jPopulationService:
    """Initialize and return the global Neo4jPopulationService singleton."""
    global _service
    if _service is None:
        _service = Neo4jPopulationService()
        await _service.initialize()
    return _service


def get_neo4j_population_service() -> Neo4jPopulationService:
    """Get the global Neo4jPopulationService singleton.

    Raises RuntimeError if not initialized.
    """
    if _service is None:
        raise RuntimeError(
            "Neo4jPopulationService not initialized. Call init_neo4j_population_service() first."
        )
    return _service


async def close_neo4j_population_service() -> None:
    """Close the global Neo4jPopulationService singleton."""
    global _service
    if _service is not None:
        await _service.close()
        _service = None
