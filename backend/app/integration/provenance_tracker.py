"""
Provenance Tracker

Tracks the complete lineage of data from ingestion agents through
processing pipelines to RAG storage. Provides audit trail and
traceability for all data transformations.
"""

import hashlib
import json
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any
from uuid import UUID, uuid4

from app.agents.ingestion.base import SourceType
from app.core.logging import get_logger

logger = get_logger(__name__)


class ProvenanceEventType(str, Enum):
    """Types of provenance events."""

    INGESTION = "ingestion"  # Initial data ingestion
    EXTRACTION = "extraction"  # Entity/relation extraction
    TRANSFORMATION = "transformation"  # Data transformation
    ENRICHMENT = "enrichment"  # Data enrichment
    INDEXING = "indexing"  # Vector/graph indexing
    RETRIEVAL = "retrieval"  # Data retrieval
    AGGREGATION = "aggregation"  # Data aggregation
    DERIVATION = "derivation"  # Derived data creation
    DELETION = "deletion"  # Data deletion
    UPDATE = "update"  # Data update


class DataQualityLevel(str, Enum):
    """Quality level of data."""

    HIGH = "high"  # Peer-reviewed, verified
    MEDIUM = "medium"  # Curated but not verified
    LOW = "low"  # Raw, unverified
    DERIVED = "derived"  # Computed/derived data


@dataclass
class ProvenanceEvent:
    """A single provenance event in the data lineage."""

    event_id: UUID
    event_type: ProvenanceEventType
    record_id: str
    source_type: SourceType
    timestamp: datetime
    agent_id: str | None = None
    operation: str = ""
    input_records: list[str] = field(default_factory=list)
    output_records: list[str] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)
    data_hash: str | None = None
    quality_level: DataQualityLevel = DataQualityLevel.MEDIUM
    confidence: float = 1.0

    def to_dict(self) -> dict[str, Any]:
        return {
            "event_id": str(self.event_id),
            "event_type": self.event_type.value,
            "record_id": self.record_id,
            "source_type": self.source_type.value,
            "timestamp": self.timestamp.isoformat(),
            "agent_id": self.agent_id,
            "operation": self.operation,
            "input_records": self.input_records,
            "output_records": self.output_records,
            "metadata": self.metadata,
            "data_hash": self.data_hash,
            "quality_level": self.quality_level.value,
            "confidence": self.confidence,
        }


@dataclass
class ProvenanceRecord:
    """Complete provenance record for a data item."""

    record_id: str
    source_type: SourceType
    original_source: str
    created_at: datetime
    last_updated: datetime
    events: list[ProvenanceEvent] = field(default_factory=list)
    lineage: list[str] = field(default_factory=list)  # Parent record IDs
    derived_records: list[str] = field(default_factory=list)
    quality_level: DataQualityLevel = DataQualityLevel.MEDIUM
    version: int = 1
    current_hash: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "record_id": self.record_id,
            "source_type": self.source_type.value,
            "original_source": self.original_source,
            "created_at": self.created_at.isoformat(),
            "last_updated": self.last_updated.isoformat(),
            "events": [e.to_dict() for e in self.events],
            "lineage": self.lineage,
            "derived_records": self.derived_records,
            "quality_level": self.quality_level.value,
            "version": self.version,
            "current_hash": self.current_hash,
            "metadata": self.metadata,
        }


@dataclass
class ProvenanceChain:
    """A chain of provenance from source to current state."""

    chain_id: UUID
    root_record_id: str
    leaf_record_id: str
    path: list[ProvenanceEvent]
    total_transformations: int
    earliest_timestamp: datetime
    latest_timestamp: datetime
    confidence: float  # Cumulative confidence

    def to_dict(self) -> dict[str, Any]:
        return {
            "chain_id": str(self.chain_id),
            "root_record_id": self.root_record_id,
            "leaf_record_id": self.leaf_record_id,
            "path": [e.to_dict() for e in self.path],
            "total_transformations": self.total_transformations,
            "earliest_timestamp": self.earliest_timestamp.isoformat(),
            "latest_timestamp": self.latest_timestamp.isoformat(),
            "confidence": self.confidence,
        }


class ProvenanceStorage:
    """
    Abstract storage backend for provenance data.
    """

    async def save_record(self, record: ProvenanceRecord) -> None:
        raise NotImplementedError

    async def get_record(self, record_id: str) -> ProvenanceRecord | None:
        raise NotImplementedError

    async def save_event(self, event: ProvenanceEvent) -> None:
        raise NotImplementedError

    async def get_events(
        self,
        record_id: str,
        event_types: list[ProvenanceEventType] | None = None,
        limit: int = 100,
    ) -> list[ProvenanceEvent]:
        raise NotImplementedError

    async def get_lineage(self, record_id: str, depth: int = 10) -> list[ProvenanceRecord]:
        raise NotImplementedError

    async def get_derived(self, record_id: str, depth: int = 10) -> list[ProvenanceRecord]:
        raise NotImplementedError


class InMemoryProvenanceStorage(ProvenanceStorage):
    """In-memory provenance storage for development."""

    def __init__(self):
        self._records: dict[str, ProvenanceRecord] = {}
        self._events: dict[str, list[ProvenanceEvent]] = {}

    async def save_record(self, record: ProvenanceRecord) -> None:
        self._records[record.record_id] = record

    async def get_record(self, record_id: str) -> ProvenanceRecord | None:
        return self._records.get(record_id)

    async def save_event(self, event: ProvenanceEvent) -> None:
        if event.record_id not in self._events:
            self._events[event.record_id] = []
        self._events[event.record_id].append(event)

    async def get_events(
        self,
        record_id: str,
        event_types: list[ProvenanceEventType] | None = None,
        limit: int = 100,
    ) -> list[ProvenanceEvent]:
        events = self._events.get(record_id, [])

        if event_types:
            events = [e for e in events if e.event_type in event_types]

        events.sort(key=lambda e: e.timestamp, reverse=True)
        return events[:limit]

    async def get_lineage(self, record_id: str, depth: int = 10) -> list[ProvenanceRecord]:
        result = []
        visited = set()
        queue = [record_id]

        while queue and len(result) < depth:
            current_id = queue.pop(0)
            if current_id in visited:
                continue
            visited.add(current_id)

            record = self._records.get(current_id)
            if record:
                result.append(record)
                queue.extend(record.lineage)

        return result

    async def get_derived(self, record_id: str, depth: int = 10) -> list[ProvenanceRecord]:
        result = []
        visited = set()
        queue = [record_id]

        while queue and len(result) < depth:
            current_id = queue.pop(0)
            if current_id in visited:
                continue
            visited.add(current_id)

            record = self._records.get(current_id)
            if record:
                result.append(record)
                queue.extend(record.derived_records)

        return result


class ProvenanceTracker:
    """
    Tracks complete data provenance from ingestion to retrieval.

    Features:
    - Full data lineage tracking
    - Event-based provenance recording
    - Data quality assessment
    - Confidence propagation
    - Chain-of-custody verification
    - Audit trail generation
    """

    def __init__(
        self,
        storage: ProvenanceStorage | None = None,
        auto_record: bool = True,
    ):
        """
        Initialize the provenance tracker.

        Args:
            storage: Storage backend
            auto_record: Whether to automatically record events
        """
        self.storage = storage or InMemoryProvenanceStorage()
        self.auto_record = auto_record

        # Event listeners
        self._listeners: list[Callable[[ProvenanceEvent], None]] = []

        # Statistics
        self._stats = {
            "total_events": 0,
            "total_records": 0,
            "events_by_type": {t.value: 0 for t in ProvenanceEventType},
        }

        self.logger = logger

    def add_listener(
        self,
        callback: Callable[[ProvenanceEvent], None],
    ) -> None:
        """Add an event listener."""
        self._listeners.append(callback)

    def _notify_listeners(self, event: ProvenanceEvent) -> None:
        """Notify all listeners of an event."""
        for listener in self._listeners:
            try:
                listener(event)
            except Exception as e:
                self.logger.error("Listener error", error=str(e))

    def _compute_hash(self, data: Any) -> str:
        """Compute hash of data for integrity verification."""
        if isinstance(data, (dict, list)):
            data = json.dumps(data, sort_keys=True, default=str)
        return hashlib.sha256(str(data).encode()).hexdigest()

    async def record_ingestion(
        self,
        record_id: str,
        source_type: SourceType,
        original_source: str,
        agent_id: str,
        data: Any,
        metadata: dict[str, Any] | None = None,
        quality_level: DataQualityLevel = DataQualityLevel.MEDIUM,
    ) -> ProvenanceRecord:
        """
        Record initial data ingestion.

        Args:
            record_id: ID of the ingested record
            source_type: Type of data source
            original_source: Original source URL/identifier
            agent_id: ID of the ingestion agent
            data: The ingested data
            metadata: Additional metadata
            quality_level: Quality level of the data

        Returns:
            Created provenance record
        """
        now = datetime.utcnow()
        data_hash = self._compute_hash(data)

        # Create provenance record
        prov_record = ProvenanceRecord(
            record_id=record_id,
            source_type=source_type,
            original_source=original_source,
            created_at=now,
            last_updated=now,
            quality_level=quality_level,
            current_hash=data_hash,
            metadata=metadata or {},
        )

        # Create ingestion event
        event = ProvenanceEvent(
            event_id=uuid4(),
            event_type=ProvenanceEventType.INGESTION,
            record_id=record_id,
            source_type=source_type,
            timestamp=now,
            agent_id=agent_id,
            operation="ingest",
            output_records=[record_id],
            metadata={
                "original_source": original_source,
                **(metadata or {}),
            },
            data_hash=data_hash,
            quality_level=quality_level,
        )

        prov_record.events.append(event)

        # Persist
        await self.storage.save_record(prov_record)
        await self.storage.save_event(event)

        # Update stats
        self._stats["total_events"] += 1
        self._stats["total_records"] += 1
        self._stats["events_by_type"]["ingestion"] += 1

        self._notify_listeners(event)

        self.logger.debug(
            "Recorded ingestion",
            record_id=record_id,
            source=original_source,
        )

        return prov_record

    async def record_extraction(
        self,
        record_id: str,
        source_type: SourceType,
        agent_id: str,
        extracted_items: list[dict[str, Any]],
        extraction_type: str,
        confidence: float = 1.0,
        metadata: dict[str, Any] | None = None,
    ) -> ProvenanceEvent:
        """
        Record an extraction event (entities, relations, etc.).

        Args:
            record_id: ID of the source record
            source_type: Type of data source
            agent_id: ID of the extraction agent
            extracted_items: List of extracted items
            extraction_type: Type of extraction (entity, relation, etc.)
            confidence: Confidence in the extraction
            metadata: Additional metadata

        Returns:
            Created event
        """
        event = ProvenanceEvent(
            event_id=uuid4(),
            event_type=ProvenanceEventType.EXTRACTION,
            record_id=record_id,
            source_type=source_type,
            timestamp=datetime.utcnow(),
            agent_id=agent_id,
            operation=f"extract_{extraction_type}",
            input_records=[record_id],
            output_records=[
                f"{record_id}_{extraction_type}_{i}" for i in range(len(extracted_items))
            ],
            metadata={
                "extraction_type": extraction_type,
                "item_count": len(extracted_items),
                **(metadata or {}),
            },
            confidence=confidence,
        )

        await self.storage.save_event(event)

        # Update provenance record
        prov_record = await self.storage.get_record(record_id)
        if prov_record:
            prov_record.events.append(event)
            prov_record.last_updated = event.timestamp
            await self.storage.save_record(prov_record)

        self._stats["total_events"] += 1
        self._stats["events_by_type"]["extraction"] += 1

        self._notify_listeners(event)

        return event

    async def record_transformation(
        self,
        input_record_ids: list[str],
        output_record_id: str,
        source_type: SourceType,
        transformation_type: str,
        agent_id: str | None = None,
        confidence: float = 1.0,
        metadata: dict[str, Any] | None = None,
    ) -> ProvenanceEvent:
        """
        Record a data transformation.

        Args:
            input_record_ids: IDs of input records
            output_record_id: ID of output record
            source_type: Type of data source
            transformation_type: Type of transformation
            agent_id: ID of the transforming agent
            confidence: Confidence in the transformation
            metadata: Additional metadata

        Returns:
            Created event
        """
        event = ProvenanceEvent(
            event_id=uuid4(),
            event_type=ProvenanceEventType.TRANSFORMATION,
            record_id=output_record_id,
            source_type=source_type,
            timestamp=datetime.utcnow(),
            agent_id=agent_id,
            operation=transformation_type,
            input_records=input_record_ids,
            output_records=[output_record_id],
            metadata=metadata or {},
            confidence=confidence,
        )

        await self.storage.save_event(event)

        # Create/update provenance record for output
        prov_record = await self.storage.get_record(output_record_id)
        if not prov_record:
            prov_record = ProvenanceRecord(
                record_id=output_record_id,
                source_type=source_type,
                original_source="derived",
                created_at=event.timestamp,
                last_updated=event.timestamp,
                lineage=input_record_ids,
                quality_level=DataQualityLevel.DERIVED,
            )

        prov_record.events.append(event)
        prov_record.last_updated = event.timestamp

        # Update lineage
        for input_id in input_record_ids:
            if input_id not in prov_record.lineage:
                prov_record.lineage.append(input_id)

            # Update input records' derived lists
            input_record = await self.storage.get_record(input_id)
            if input_record and output_record_id not in input_record.derived_records:
                input_record.derived_records.append(output_record_id)
                await self.storage.save_record(input_record)

        await self.storage.save_record(prov_record)

        self._stats["total_events"] += 1
        self._stats["events_by_type"]["transformation"] += 1

        self._notify_listeners(event)

        return event

    async def record_indexing(
        self,
        record_id: str,
        source_type: SourceType,
        index_type: str,
        indexed_items: int,
        metadata: dict[str, Any] | None = None,
    ) -> ProvenanceEvent:
        """
        Record an indexing event.

        Args:
            record_id: ID of the indexed record
            source_type: Type of data source
            index_type: Type of index (vector, graph, etc.)
            indexed_items: Number of items indexed
            metadata: Additional metadata

        Returns:
            Created event
        """
        event = ProvenanceEvent(
            event_id=uuid4(),
            event_type=ProvenanceEventType.INDEXING,
            record_id=record_id,
            source_type=source_type,
            timestamp=datetime.utcnow(),
            operation=f"index_{index_type}",
            input_records=[record_id],
            metadata={
                "index_type": index_type,
                "indexed_items": indexed_items,
                **(metadata or {}),
            },
        )

        await self.storage.save_event(event)

        # Update provenance record
        prov_record = await self.storage.get_record(record_id)
        if prov_record:
            prov_record.events.append(event)
            prov_record.last_updated = event.timestamp
            await self.storage.save_record(prov_record)

        self._stats["total_events"] += 1
        self._stats["events_by_type"]["indexing"] += 1

        self._notify_listeners(event)

        return event

    async def record_retrieval(
        self,
        record_id: str,
        source_type: SourceType,
        query: str,
        retrieval_method: str,
        confidence: float = 1.0,
        metadata: dict[str, Any] | None = None,
    ) -> ProvenanceEvent:
        """
        Record a retrieval event.

        Args:
            record_id: ID of the retrieved record
            source_type: Type of data source
            query: Query that retrieved this record
            retrieval_method: Method used for retrieval
            confidence: Confidence/relevance score
            metadata: Additional metadata

        Returns:
            Created event
        """
        event = ProvenanceEvent(
            event_id=uuid4(),
            event_type=ProvenanceEventType.RETRIEVAL,
            record_id=record_id,
            source_type=source_type,
            timestamp=datetime.utcnow(),
            operation=retrieval_method,
            output_records=[record_id],
            metadata={
                "query": query[:200],  # Truncate long queries
                "retrieval_method": retrieval_method,
                **(metadata or {}),
            },
            confidence=confidence,
        )

        await self.storage.save_event(event)

        self._stats["total_events"] += 1
        self._stats["events_by_type"]["retrieval"] += 1

        self._notify_listeners(event)

        return event

    async def get_provenance(self, record_id: str) -> ProvenanceRecord | None:
        """Get full provenance record for a data item."""
        return await self.storage.get_record(record_id)

    async def get_events(
        self,
        record_id: str,
        event_types: list[ProvenanceEventType] | None = None,
        limit: int = 100,
    ) -> list[ProvenanceEvent]:
        """Get events for a record."""
        return await self.storage.get_events(record_id, event_types, limit)

    async def get_lineage(
        self,
        record_id: str,
        depth: int = 10,
    ) -> list[ProvenanceRecord]:
        """Get complete lineage (ancestors) of a record."""
        return await self.storage.get_lineage(record_id, depth)

    async def get_derived(
        self,
        record_id: str,
        depth: int = 10,
    ) -> list[ProvenanceRecord]:
        """Get all records derived from this record."""
        return await self.storage.get_derived(record_id, depth)

    async def build_provenance_chain(
        self,
        record_id: str,
    ) -> ProvenanceChain:
        """
        Build complete provenance chain from source to current state.

        Args:
            record_id: ID of the record

        Returns:
            Complete provenance chain
        """
        lineage = await self.get_lineage(record_id)

        if not lineage:
            # Single record, no lineage
            record = await self.storage.get_record(record_id)
            events = record.events if record else []

            return ProvenanceChain(
                chain_id=uuid4(),
                root_record_id=record_id,
                leaf_record_id=record_id,
                path=events,
                total_transformations=0,
                earliest_timestamp=events[0].timestamp if events else datetime.utcnow(),
                latest_timestamp=events[-1].timestamp if events else datetime.utcnow(),
                confidence=1.0,
            )

        # Build path from root to leaf
        path = []
        root_id = lineage[-1].record_id if lineage else record_id

        for record in reversed(lineage):
            path.extend(record.events)

        # Calculate cumulative confidence
        cumulative_confidence = 1.0
        for event in path:
            cumulative_confidence *= event.confidence

        # Count transformations
        transformations = sum(1 for e in path if e.event_type == ProvenanceEventType.TRANSFORMATION)

        return ProvenanceChain(
            chain_id=uuid4(),
            root_record_id=root_id,
            leaf_record_id=record_id,
            path=path,
            total_transformations=transformations,
            earliest_timestamp=path[0].timestamp if path else datetime.utcnow(),
            latest_timestamp=path[-1].timestamp if path else datetime.utcnow(),
            confidence=cumulative_confidence,
        )

    async def verify_integrity(self, record_id: str, data: Any) -> dict[str, Any]:
        """
        Verify data integrity against recorded provenance.

        Args:
            record_id: ID of the record
            data: Current data to verify

        Returns:
            Verification result
        """
        prov_record = await self.storage.get_record(record_id)

        if not prov_record:
            return {
                "verified": False,
                "error": "No provenance record found",
            }

        current_hash = self._compute_hash(data)

        if prov_record.current_hash and prov_record.current_hash != current_hash:
            return {
                "verified": False,
                "error": "Data hash mismatch",
                "expected_hash": prov_record.current_hash,
                "actual_hash": current_hash,
            }

        return {
            "verified": True,
            "record_id": record_id,
            "version": prov_record.version,
            "quality_level": prov_record.quality_level.value,
            "events_count": len(prov_record.events),
        }

    async def generate_audit_trail(
        self,
        record_id: str,
        start_date: datetime | None = None,
        end_date: datetime | None = None,
    ) -> list[dict[str, Any]]:
        """
        Generate audit trail for a record.

        Args:
            record_id: ID of the record
            start_date: Start of audit period
            end_date: End of audit period

        Returns:
            Audit trail entries
        """
        events = await self.storage.get_events(record_id, limit=1000)

        # Filter by date if specified
        if start_date:
            events = [e for e in events if e.timestamp >= start_date]
        if end_date:
            events = [e for e in events if e.timestamp <= end_date]

        # Format as audit trail
        trail = []
        for event in events:
            trail.append(
                {
                    "timestamp": event.timestamp.isoformat(),
                    "event_type": event.event_type.value,
                    "operation": event.operation,
                    "agent_id": event.agent_id,
                    "confidence": event.confidence,
                    "metadata": event.metadata,
                }
            )

        return trail

    def get_stats(self) -> dict[str, Any]:
        """Get tracker statistics."""
        return self._stats.copy()


# Global tracker instance
_provenance_tracker: ProvenanceTracker | None = None


def get_provenance_tracker() -> ProvenanceTracker:
    """Get the global provenance tracker instance."""
    global _provenance_tracker
    if _provenance_tracker is None:
        _provenance_tracker = ProvenanceTracker()
    return _provenance_tracker
