"""
Graph Connector - Knowledge Graph Integration

Connects ingestion agents to the knowledge graph for entity and relationship
indexing, graph updates, and entity resolution.
"""

import asyncio
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any
from uuid import uuid4

from app.agents.ingestion.base import (
    IngestionRecord,
    SourceType,
)
from app.core.logging import get_logger

logger = get_logger(__name__)


class UpdateMode(str, Enum):
    """How to handle existing entities/relations."""

    CREATE_ONLY = "create_only"  # Only create new, skip existing
    UPDATE = "update"  # Update existing, create new
    MERGE = "merge"  # Merge properties with existing
    REPLACE = "replace"  # Replace existing completely


class ConflictResolution(str, Enum):
    """How to resolve conflicts between sources."""

    KEEP_EXISTING = "keep_existing"
    USE_NEW = "use_new"
    MERGE_PROPERTIES = "merge_properties"
    HIGHER_CONFIDENCE = "higher_confidence"
    MOST_RECENT = "most_recent"


@dataclass
class GraphUpdateConfig:
    """Configuration for knowledge graph updates."""

    update_mode: UpdateMode = UpdateMode.MERGE
    conflict_resolution: ConflictResolution = ConflictResolution.HIGHER_CONFIDENCE
    min_entity_confidence: float = 0.5
    min_relation_confidence: float = 0.6
    resolve_entities: bool = True
    create_source_edges: bool = True
    batch_size: int = 100
    max_retries: int = 3


@dataclass
class EntityUpdate:
    """An entity update operation."""

    entity_id: str
    entity_type: str
    canonical_name: str
    aliases: list[str] = field(default_factory=list)
    properties: dict[str, Any] = field(default_factory=dict)
    external_ids: dict[str, str] = field(default_factory=dict)
    confidence: float = 1.0
    source_id: str = ""
    source_type: SourceType = SourceType.PUBMED


@dataclass
class RelationUpdate:
    """A relation update operation."""

    source_entity_id: str
    target_entity_id: str
    relation_type: str
    properties: dict[str, Any] = field(default_factory=dict)
    confidence: float = 1.0
    evidence_text: str = ""
    source_id: str = ""
    source_type: SourceType = SourceType.PUBMED


@dataclass
class GraphUpdateResult:
    """Result of a graph update operation."""

    success: bool
    record_id: str
    entities_created: int
    entities_updated: int
    entities_merged: int
    relations_created: int
    relations_updated: int
    source_edges_created: int
    errors: list[str] = field(default_factory=list)
    duration_ms: float = 0.0


class GraphConnector:
    """
    Connects ingestion agents to the knowledge graph.

    Responsibilities:
    - Entity extraction and normalization
    - Entity resolution and deduplication
    - Relation extraction and linking
    - Source provenance tracking
    - Incremental graph updates
    """

    def __init__(
        self,
        config: GraphUpdateConfig | None = None,
    ):
        """
        Initialize the graph connector.

        Args:
            config: Update configuration
        """
        self.config = config or GraphUpdateConfig()

        # Lazy-loaded components
        self._graph_store = None
        self._entity_resolver = None
        self._nlp_pipeline = None

        # Callbacks
        self._on_updated: list[Callable[[GraphUpdateResult], None]] = []

        # Cache for entity resolution
        self._entity_cache: dict[str, str] = {}  # normalized_name -> entity_id

        # Statistics
        self._stats = {
            "total_entities_created": 0,
            "total_relations_created": 0,
            "total_updates": 0,
            "last_updated_at": None,
        }

        self.logger = logger

    async def _get_graph_store(self):
        """Lazy-load the graph store."""
        if self._graph_store is None:
            from app.knowledge.graph_store import GraphStore

            self._graph_store = GraphStore()

        return self._graph_store

    async def _get_entity_resolver(self):
        """Lazy-load the entity resolver."""
        if self._entity_resolver is None:
            from app.entity_resolution.resolver import EntityResolver

            self._entity_resolver = EntityResolver()

        return self._entity_resolver

    async def _get_nlp_pipeline(self):
        """Lazy-load the NLP pipeline."""
        if self._nlp_pipeline is None:
            from app.nlp.pipeline import NLPPipeline

            self._nlp_pipeline = NLPPipeline()

        return self._nlp_pipeline

    def add_callback(
        self,
        callback: Callable[[GraphUpdateResult], None],
    ) -> None:
        """Add a callback for update events."""
        self._on_updated.append(callback)

    def _notify_callbacks(self, result: GraphUpdateResult) -> None:
        """Notify all callbacks of update result."""
        for callback in self._on_updated:
            try:
                callback(result)
            except Exception as e:
                self.logger.error("Callback error", error=str(e))

    async def update_from_record(
        self,
        record: IngestionRecord,
        config: GraphUpdateConfig | None = None,
    ) -> GraphUpdateResult:
        """
        Update the knowledge graph from an ingestion record.

        Args:
            record: The ingestion record
            config: Optional override configuration

        Returns:
            Update result
        """
        cfg = config or self.config
        start_time = datetime.now(timezone.utc)

        result = GraphUpdateResult(
            success=True,
            record_id=record.source_id,
            entities_created=0,
            entities_updated=0,
            entities_merged=0,
            relations_created=0,
            relations_updated=0,
            source_edges_created=0,
        )

        try:
            graph_store = await self._get_graph_store()

            # Process entities
            entity_updates = self._prepare_entity_updates(record)
            entity_id_map = {}  # original_id -> graph_id

            for entity_update in entity_updates:
                if entity_update.confidence < cfg.min_entity_confidence:
                    continue

                try:
                    graph_id = await self._process_entity(
                        entity_update,
                        graph_store,
                        cfg,
                    )
                    entity_id_map[entity_update.entity_id] = graph_id

                    if graph_id.startswith("new_"):
                        result.entities_created += 1
                    elif cfg.update_mode == UpdateMode.MERGE:
                        result.entities_merged += 1
                    else:
                        result.entities_updated += 1

                except Exception as e:
                    result.errors.append(f"Entity error: {str(e)}")

            # Process relations
            relation_updates = self._prepare_relation_updates(record, entity_id_map)

            for relation_update in relation_updates:
                if relation_update.confidence < cfg.min_relation_confidence:
                    continue

                try:
                    created = await self._process_relation(
                        relation_update,
                        graph_store,
                        cfg,
                    )

                    if created:
                        result.relations_created += 1
                    else:
                        result.relations_updated += 1

                except Exception as e:
                    result.errors.append(f"Relation error: {str(e)}")

            # Create source edges
            if cfg.create_source_edges:
                source_edges = await self._create_source_edges(
                    record,
                    entity_id_map,
                    graph_store,
                )
                result.source_edges_created = source_edges

            # Calculate duration
            result.duration_ms = (datetime.now(timezone.utc) - start_time).total_seconds() * 1000

            # Update stats
            self._stats["total_entities_created"] += result.entities_created
            self._stats["total_relations_created"] += result.relations_created
            self._stats["total_updates"] += 1
            self._stats["last_updated_at"] = datetime.now(timezone.utc)

            if result.errors:
                result.success = (
                    len(result.errors) < (len(entity_updates) + len(relation_updates)) / 2
                )

            self.logger.info(
                "Graph updated from record",
                record_id=record.source_id,
                entities_created=result.entities_created,
                relations_created=result.relations_created,
                duration_ms=round(result.duration_ms, 2),
            )

            self._notify_callbacks(result)
            return result

        except Exception as e:
            result.success = False
            result.errors.append(str(e))
            result.duration_ms = (datetime.now(timezone.utc) - start_time).total_seconds() * 1000

            self.logger.error(
                "Graph update failed",
                record_id=record.source_id,
                error=str(e),
            )

            self._notify_callbacks(result)
            return result

    def _prepare_entity_updates(
        self,
        record: IngestionRecord,
    ) -> list[EntityUpdate]:
        """Prepare entity updates from a record."""
        updates = []

        if not record.entities:
            return updates

        for entity in record.entities:
            update = EntityUpdate(
                entity_id=entity.entity_id or str(uuid4()),
                entity_type=entity.entity_type,
                canonical_name=entity.text,
                aliases=entity.aliases if hasattr(entity, "aliases") else [],
                properties={
                    "start_char": entity.start_char,
                    "end_char": entity.end_char,
                    "context": entity.context[:500] if entity.context else "",
                },
                external_ids=entity.external_ids if hasattr(entity, "external_ids") else {},
                confidence=entity.confidence,
                source_id=record.source_id,
                source_type=record.source_type,
            )
            updates.append(update)

        return updates

    def _prepare_relation_updates(
        self,
        record: IngestionRecord,
        entity_id_map: dict[str, str],
    ) -> list[RelationUpdate]:
        """Prepare relation updates from a record."""
        updates = []

        if not record.relations:
            return updates

        for relation in record.relations:
            # Map entity IDs
            source_id = entity_id_map.get(
                relation.source_entity_id,
                relation.source_entity_id,
            )
            target_id = entity_id_map.get(
                relation.target_entity_id,
                relation.target_entity_id,
            )

            update = RelationUpdate(
                source_entity_id=source_id,
                target_entity_id=target_id,
                relation_type=relation.relation_type,
                properties={
                    "evidence_text": relation.evidence_text[:500] if relation.evidence_text else "",
                },
                confidence=relation.confidence,
                evidence_text=relation.evidence_text or "",
                source_id=record.source_id,
                source_type=record.source_type,
            )
            updates.append(update)

        return updates

    async def _process_entity(
        self,
        update: EntityUpdate,
        graph_store,
        config: GraphUpdateConfig,
    ) -> str:
        """Process a single entity update and return graph ID."""
        # Try to resolve to existing entity
        if config.resolve_entities:
            existing_id = await self._resolve_entity(update)
            if existing_id:
                # Update existing entity
                await self._update_existing_entity(
                    existing_id,
                    update,
                    graph_store,
                    config,
                )
                return existing_id

        # Create new entity
        entity_id = await graph_store.add_entity(
            entity_type=update.entity_type,
            name=update.canonical_name,
            aliases=update.aliases,
            properties=update.properties,
            external_ids=update.external_ids,
            confidence=update.confidence,
        )

        # Cache for future resolution
        normalized = update.canonical_name.lower().strip()
        self._entity_cache[normalized] = entity_id

        return f"new_{entity_id}"

    async def _resolve_entity(
        self,
        update: EntityUpdate,
    ) -> str | None:
        """Attempt to resolve entity to existing graph entity."""
        # Check cache first
        normalized = update.canonical_name.lower().strip()
        if normalized in self._entity_cache:
            return self._entity_cache[normalized]

        # Check external IDs
        if update.external_ids:
            graph_store = await self._get_graph_store()
            for id_type, id_value in update.external_ids.items():
                existing = await graph_store.find_by_external_id(id_type, id_value)
                if existing:
                    self._entity_cache[normalized] = existing
                    return existing

        # Try entity resolution service
        try:
            resolver = await self._get_entity_resolver()
            resolved = await resolver.resolve(
                text=update.canonical_name,
                entity_type=update.entity_type,
            )
            if resolved and resolved.canonical_id:
                self._entity_cache[normalized] = resolved.canonical_id
                return resolved.canonical_id
        except Exception as e:
            self.logger.debug("Entity resolution failed", error=str(e))

        return None

    async def _update_existing_entity(
        self,
        entity_id: str,
        update: EntityUpdate,
        graph_store,
        config: GraphUpdateConfig,
    ) -> None:
        """Update an existing entity."""
        if config.update_mode == UpdateMode.CREATE_ONLY:
            return

        existing = await graph_store.get_entity(entity_id)
        if not existing:
            return

        if config.update_mode == UpdateMode.REPLACE:
            await graph_store.update_entity(
                entity_id=entity_id,
                properties=update.properties,
                aliases=update.aliases,
            )

        elif config.update_mode in [UpdateMode.UPDATE, UpdateMode.MERGE]:
            # Merge properties
            merged_props = {**existing.get("properties", {}), **update.properties}

            # Merge aliases
            existing_aliases = set(existing.get("aliases", []))
            merged_aliases = list(existing_aliases | set(update.aliases))

            await graph_store.update_entity(
                entity_id=entity_id,
                properties=merged_props,
                aliases=merged_aliases,
            )

    async def _process_relation(
        self,
        update: RelationUpdate,
        graph_store,
        config: GraphUpdateConfig,
    ) -> bool:
        """Process a single relation update. Returns True if created, False if updated."""
        # Check if relation exists
        existing = await graph_store.find_relation(
            source_id=update.source_entity_id,
            target_id=update.target_entity_id,
            relation_type=update.relation_type,
        )

        if existing:
            if config.update_mode == UpdateMode.CREATE_ONLY:
                return False

            # Resolve conflict
            should_update = self._resolve_conflict(
                existing,
                update,
                config.conflict_resolution,
            )

            if should_update:
                await graph_store.update_relation(
                    relation_id=existing["id"],
                    properties=update.properties,
                    confidence=update.confidence,
                )

            return False

        # Create new relation
        await graph_store.add_relation(
            source_id=update.source_entity_id,
            target_id=update.target_entity_id,
            relation_type=update.relation_type,
            properties=update.properties,
            confidence=update.confidence,
        )

        return True

    def _resolve_conflict(
        self,
        existing: dict[str, Any],
        update: RelationUpdate,
        resolution: ConflictResolution,
    ) -> bool:
        """Resolve conflict between existing and new data. Returns True if should update."""
        if resolution == ConflictResolution.KEEP_EXISTING:
            return False

        if resolution == ConflictResolution.USE_NEW:
            return True

        if resolution == ConflictResolution.HIGHER_CONFIDENCE:
            existing_conf = existing.get("confidence", 0.5)
            return update.confidence > existing_conf

        if resolution == ConflictResolution.MOST_RECENT:
            # Always use new data
            return True

        if resolution == ConflictResolution.MERGE_PROPERTIES:
            return True

        return False

    async def _create_source_edges(
        self,
        record: IngestionRecord,
        entity_id_map: dict[str, str],
        graph_store,
    ) -> int:
        """Create edges linking entities to their source document."""
        created = 0

        # Create source node if needed
        source_node_id = await graph_store.get_or_create_source_node(
            source_id=record.source_id,
            source_type=record.source_type.value,
            title=record.title or "",
            url=record.url or "",
            date=record.publication_date.isoformat() if record.publication_date else "",
        )

        # Link entities to source
        for original_id, graph_id in entity_id_map.items():
            # Remove "new_" prefix if present
            clean_id = graph_id.replace("new_", "")

            try:
                await graph_store.add_relation(
                    source_id=clean_id,
                    target_id=source_node_id,
                    relation_type="MENTIONED_IN",
                    properties={
                        "source_type": record.source_type.value,
                        "extracted_at": datetime.now(timezone.utc).isoformat(),
                    },
                    confidence=1.0,
                )
                created += 1
            except Exception as e:
                self.logger.debug("Failed to create source edge", error=str(e))

        return created

    async def update_batch(
        self,
        records: list[IngestionRecord],
        config: GraphUpdateConfig | None = None,
        progress_callback: Callable[[int, int], None] | None = None,
    ) -> list[GraphUpdateResult]:
        """
        Update graph from a batch of records.

        Args:
            records: List of records
            config: Optional override configuration
            progress_callback: Optional progress callback

        Returns:
            List of update results
        """
        results = []
        total = len(records)

        for i, record in enumerate(records):
            result = await self.update_from_record(record, config)
            results.append(result)

            if progress_callback:
                progress_callback(i + 1, total)

        return results

    async def update_batch_parallel(
        self,
        records: list[IngestionRecord],
        config: GraphUpdateConfig | None = None,
        max_concurrent: int = 3,
    ) -> list[GraphUpdateResult]:
        """
        Update graph from records in parallel.

        Args:
            records: List of records
            config: Optional override configuration
            max_concurrent: Maximum concurrent updates

        Returns:
            List of update results
        """
        semaphore = asyncio.Semaphore(max_concurrent)

        async def update_with_semaphore(record: IngestionRecord) -> GraphUpdateResult:
            async with semaphore:
                return await self.update_from_record(record, config)

        tasks = [update_with_semaphore(record) for record in records]
        return await asyncio.gather(*tasks)

    async def delete_source_data(self, source_id: str) -> dict[str, int]:
        """
        Delete all graph data from a specific source.

        Args:
            source_id: Source document ID

        Returns:
            Counts of deleted entities and relations
        """
        graph_store = await self._get_graph_store()

        deleted = await graph_store.delete_by_source(source_id)

        self.logger.info(
            "Source data deleted from graph",
            source_id=source_id,
            entities_deleted=deleted.get("entities", 0),
            relations_deleted=deleted.get("relations", 0),
        )

        return deleted

    def get_stats(self) -> dict[str, Any]:
        """Get update statistics."""
        return {
            **self._stats,
            "last_updated_at": self._stats["last_updated_at"].isoformat()
            if self._stats["last_updated_at"]
            else None,
            "entity_cache_size": len(self._entity_cache),
        }

    async def health_check(self) -> dict[str, Any]:
        """Check connector health."""
        health = {
            "status": "healthy",
            "components": {},
        }

        try:
            graph_store = await self._get_graph_store()
            await graph_store.health_check()
            health["components"]["graph_store"] = "healthy"
        except Exception as e:
            health["status"] = "degraded"
            health["components"]["graph_store"] = f"unhealthy: {str(e)}"

        return health

    def clear_cache(self) -> None:
        """Clear entity resolution cache."""
        self._entity_cache.clear()
        self.logger.info("Entity cache cleared")


# Global connector instance
_graph_connector: GraphConnector | None = None


def get_graph_connector(config: GraphUpdateConfig | None = None) -> GraphConnector:
    """Get the global graph connector instance."""
    global _graph_connector
    if _graph_connector is None:
        _graph_connector = GraphConnector(config=config)
    return _graph_connector


async def update_graph_from_records(
    records: list[IngestionRecord],
    parallel: bool = True,
    max_concurrent: int = 3,
) -> list[GraphUpdateResult]:
    """
    Convenience function to update graph from records.

    Args:
        records: Records to process
        parallel: Whether to process in parallel
        max_concurrent: Maximum concurrent operations

    Returns:
        List of update results
    """
    connector = get_graph_connector()

    if parallel:
        return await connector.update_batch_parallel(
            records,
            max_concurrent=max_concurrent,
        )
    else:
        return await connector.update_batch(records)
