"""
Evidence Provenance Tracking

Tracks full provenance chain for evidence:
- Source origin
- Extraction method
- Processing history
- Confidence attribution
- Audit trail
"""

import hashlib
import logging
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import StrEnum
from typing import Any

logger = logging.getLogger(__name__)


class ProvenanceEventType(StrEnum):
    """Types of provenance events."""

    SOURCE_INGESTION = "source_ingestion"
    ENTITY_EXTRACTION = "entity_extraction"
    RELATION_EXTRACTION = "relation_extraction"
    ENTITY_RESOLUTION = "entity_resolution"
    DISAMBIGUATION = "disambiguation"
    SCORING = "scoring"
    VALIDATION = "validation"
    MANUAL_CURATION = "manual_curation"
    MERGE = "merge"
    UPDATE = "update"
    DEPRECATION = "deprecation"


@dataclass
class ProvenanceEvent:
    """A single provenance event."""

    event_id: str
    event_type: ProvenanceEventType
    timestamp: str
    agent: str  # System or user that performed the action
    action: str  # Description of what was done
    input_data: dict[str, Any] = field(default_factory=dict)
    output_data: dict[str, Any] = field(default_factory=dict)
    confidence_delta: float = 0.0  # Change in confidence
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "event_id": self.event_id,
            "event_type": self.event_type.value,
            "timestamp": self.timestamp,
            "agent": self.agent,
            "action": self.action,
            "input_data": self.input_data,
            "output_data": self.output_data,
            "confidence_delta": self.confidence_delta,
            "metadata": self.metadata,
        }


@dataclass
class SourceProvenance:
    """Provenance for a source document."""

    source_id: str
    source_type: str
    source_url: str | None = None
    ingestion_date: str = ""
    original_format: str = ""
    extraction_method: str = ""
    preprocessing_steps: list[str] = field(default_factory=list)
    quality_checks: dict[str, bool] = field(default_factory=dict)
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "source_id": self.source_id,
            "source_type": self.source_type,
            "source_url": self.source_url,
            "ingestion_date": self.ingestion_date,
            "original_format": self.original_format,
            "extraction_method": self.extraction_method,
            "preprocessing_steps": self.preprocessing_steps,
            "quality_checks": self.quality_checks,
            "metadata": self.metadata,
        }


@dataclass
class ProvenanceRecord:
    """Complete provenance record for an evidence item."""

    record_id: str
    entity_id: str
    created_at: str
    updated_at: str
    source_provenance: SourceProvenance | None = None
    events: list[ProvenanceEvent] = field(default_factory=list)
    contributing_sources: list[str] = field(default_factory=list)
    confidence_history: list[dict[str, Any]] = field(default_factory=list)
    current_confidence: float = 0.0
    is_validated: bool = False
    validators: list[str] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "record_id": self.record_id,
            "entity_id": self.entity_id,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "source_provenance": self.source_provenance.to_dict()
            if self.source_provenance
            else None,
            "events": [e.to_dict() for e in self.events],
            "contributing_sources": self.contributing_sources,
            "confidence_history": self.confidence_history,
            "current_confidence": self.current_confidence,
            "is_validated": self.is_validated,
            "validators": self.validators,
            "metadata": self.metadata,
        }

    def add_event(self, event: ProvenanceEvent):
        """Add an event to the provenance chain."""
        self.events.append(event)
        self.updated_at = datetime.now(UTC).isoformat()

        # Update confidence history
        if event.confidence_delta != 0:
            new_confidence = self.current_confidence + event.confidence_delta
            self.confidence_history.append(
                {
                    "timestamp": event.timestamp,
                    "event_id": event.event_id,
                    "old_confidence": self.current_confidence,
                    "new_confidence": new_confidence,
                    "delta": event.confidence_delta,
                }
            )
            self.current_confidence = max(0, min(1, new_confidence))

    def get_event_chain(self) -> list[str]:
        """Get event chain as readable summary."""
        return [f"{e.timestamp}: {e.event_type.value} by {e.agent}" for e in self.events]


class ProvenanceTracker:
    """
    Tracks provenance for evidence items.

    Maintains:
    - Full audit trail
    - Confidence attribution
    - Source chain
    - Validation status
    """

    def __init__(self, system_agent: str = "genup_system", auto_hash: bool = True):
        """
        Initialize the provenance tracker.

        Args:
            system_agent: Default system agent name
            auto_hash: Auto-generate hashes for records
        """
        self.system_agent = system_agent
        self.auto_hash = auto_hash

        # Storage
        self._records: dict[str, ProvenanceRecord] = {}
        self._entity_to_record: dict[str, str] = {}

        logger.info("ProvenanceTracker initialized")

    def create_record(
        self,
        entity_id: str,
        source_provenance: SourceProvenance | None = None,
        initial_confidence: float = 0.5,
    ) -> ProvenanceRecord:
        """
        Create a new provenance record.

        Args:
            entity_id: ID of the entity/relation
            source_provenance: Source provenance info
            initial_confidence: Initial confidence score

        Returns:
            Created ProvenanceRecord
        """
        now = datetime.now(UTC).isoformat()

        record_id = self._generate_id(entity_id)

        record = ProvenanceRecord(
            record_id=record_id,
            entity_id=entity_id,
            created_at=now,
            updated_at=now,
            source_provenance=source_provenance,
            current_confidence=initial_confidence,
            confidence_history=[
                {
                    "timestamp": now,
                    "event_id": "initial",
                    "old_confidence": 0.0,
                    "new_confidence": initial_confidence,
                    "delta": initial_confidence,
                }
            ],
        )

        # Add creation event
        creation_event = ProvenanceEvent(
            event_id=self._generate_event_id(),
            event_type=ProvenanceEventType.SOURCE_INGESTION,
            timestamp=now,
            agent=self.system_agent,
            action="Created provenance record",
            metadata={"initial_confidence": initial_confidence},
        )
        record.events.append(creation_event)

        # Store
        self._records[record_id] = record
        self._entity_to_record[entity_id] = record_id

        return record

    def get_record(self, entity_id: str) -> ProvenanceRecord | None:
        """Get provenance record for an entity."""
        record_id = self._entity_to_record.get(entity_id)
        if record_id:
            return self._records.get(record_id)
        return None

    def add_event(
        self,
        entity_id: str,
        event_type: ProvenanceEventType,
        action: str,
        agent: str | None = None,
        confidence_delta: float = 0.0,
        input_data: dict | None = None,
        output_data: dict | None = None,
        metadata: dict | None = None,
    ) -> ProvenanceEvent | None:
        """
        Add an event to an entity's provenance.

        Args:
            entity_id: Entity ID
            event_type: Type of event
            action: Action description
            agent: Agent performing action
            confidence_delta: Change in confidence
            input_data: Input data
            output_data: Output data
            metadata: Additional metadata

        Returns:
            Created ProvenanceEvent or None
        """
        record = self.get_record(entity_id)
        if not record:
            logger.warning(f"No provenance record for entity: {entity_id}")
            return None

        event = ProvenanceEvent(
            event_id=self._generate_event_id(),
            event_type=event_type,
            timestamp=datetime.now(UTC).isoformat(),
            agent=agent or self.system_agent,
            action=action,
            input_data=input_data or {},
            output_data=output_data or {},
            confidence_delta=confidence_delta,
            metadata=metadata or {},
        )

        record.add_event(event)
        return event

    def record_extraction(
        self,
        entity_id: str,
        extraction_method: str,
        extracted_text: str,
        confidence: float,
        model_info: dict | None = None,
    ) -> ProvenanceEvent | None:
        """Record an extraction event."""
        return self.add_event(
            entity_id=entity_id,
            event_type=ProvenanceEventType.ENTITY_EXTRACTION,
            action=f"Extracted using {extraction_method}",
            confidence_delta=confidence - 0.5,  # Relative to baseline
            input_data={"text": extracted_text[:500]},
            output_data={"confidence": confidence},
            metadata={"extraction_method": extraction_method, "model_info": model_info},
        )

    def record_resolution(
        self,
        entity_id: str,
        original_mention: str,
        resolved_to: str,
        vocabulary_source: str,
        confidence: float,
    ) -> ProvenanceEvent | None:
        """Record an entity resolution event."""
        return self.add_event(
            entity_id=entity_id,
            event_type=ProvenanceEventType.ENTITY_RESOLUTION,
            action=f"Resolved to {resolved_to} via {vocabulary_source}",
            confidence_delta=confidence * 0.1,  # Small boost for resolution
            input_data={"original_mention": original_mention},
            output_data={"resolved_to": resolved_to, "vocabulary": vocabulary_source},
            metadata={"resolution_confidence": confidence},
        )

    def record_validation(
        self, entity_id: str, validator: str, is_valid: bool, comments: str | None = None
    ) -> ProvenanceEvent | None:
        """Record a validation event."""
        record = self.get_record(entity_id)
        if record:
            if is_valid:
                record.is_validated = True
                record.validators.append(validator)

        confidence_delta = 0.1 if is_valid else -0.2

        return self.add_event(
            entity_id=entity_id,
            event_type=ProvenanceEventType.VALIDATION,
            action=f"{'Validated' if is_valid else 'Invalidated'} by {validator}",
            agent=validator,
            confidence_delta=confidence_delta,
            output_data={"is_valid": is_valid, "comments": comments},
        )

    def record_merge(self, source_entity_id: str, target_entity_id: str, reason: str):
        """Record a merge event."""
        # Update source record
        self.add_event(
            entity_id=source_entity_id,
            event_type=ProvenanceEventType.MERGE,
            action=f"Merged into {target_entity_id}",
            metadata={"merged_into": target_entity_id, "reason": reason},
        )

        # Update target record
        target_record = self.get_record(target_entity_id)
        source_record = self.get_record(source_entity_id)

        if target_record and source_record:
            target_record.contributing_sources.extend(source_record.contributing_sources)
            target_record.contributing_sources.append(source_entity_id)

            self.add_event(
                entity_id=target_entity_id,
                event_type=ProvenanceEventType.MERGE,
                action=f"Received merge from {source_entity_id}",
                confidence_delta=0.05,  # Small boost for additional evidence
                metadata={"merged_from": source_entity_id, "reason": reason},
            )

    def add_contributing_source(self, entity_id: str, source_id: str):
        """Add a contributing source to an entity."""
        record = self.get_record(entity_id)
        if record and source_id not in record.contributing_sources:
            record.contributing_sources.append(source_id)

            self.add_event(
                entity_id=entity_id,
                event_type=ProvenanceEventType.UPDATE,
                action=f"Added contributing source: {source_id}",
                confidence_delta=0.02,  # Small boost per additional source
                metadata={"new_source": source_id},
            )

    def get_confidence_history(self, entity_id: str) -> list[dict[str, Any]]:
        """Get confidence history for an entity."""
        record = self.get_record(entity_id)
        if record:
            return record.confidence_history
        return []

    def get_audit_trail(self, entity_id: str) -> list[dict[str, Any]]:
        """Get full audit trail for an entity."""
        record = self.get_record(entity_id)
        if record:
            return [e.to_dict() for e in record.events]
        return []

    def export_provenance(self, entity_ids: list[str] | None = None) -> dict[str, Any]:
        """
        Export provenance records.

        Args:
            entity_ids: Specific entities to export (None = all)

        Returns:
            Export data
        """
        if entity_ids:
            records = [self.get_record(eid) for eid in entity_ids if self.get_record(eid)]
        else:
            records = list(self._records.values())

        return {
            "export_timestamp": datetime.now(UTC).isoformat(),
            "total_records": len(records),
            "records": [r.to_dict() for r in records],
        }

    def get_statistics(self) -> dict[str, Any]:
        """Get tracker statistics."""
        total_events = sum(len(r.events) for r in self._records.values())
        validated_count = sum(1 for r in self._records.values() if r.is_validated)

        return {
            "total_records": len(self._records),
            "total_events": total_events,
            "validated_count": validated_count,
            "validation_rate": validated_count / len(self._records) if self._records else 0,
            "average_events_per_record": total_events / len(self._records) if self._records else 0,
        }

    def _generate_id(self, entity_id: str) -> str:
        """Generate record ID."""
        if self.auto_hash:
            return hashlib.md5(f"{entity_id}_{datetime.now(UTC).isoformat()}".encode()).hexdigest()[
                :16
            ]
        return str(uuid.uuid4())[:16]

    def _generate_event_id(self) -> str:
        """Generate event ID."""
        return str(uuid.uuid4())[:12]


# Convenience functions
def create_provenance(entity_id: str, source_id: str | None = None) -> ProvenanceRecord:
    """Create provenance record using default tracker."""
    tracker = ProvenanceTracker()
    source_prov = None
    if source_id:
        source_prov = SourceProvenance(
            source_id=source_id, source_type="unknown", ingestion_date=datetime.now(UTC).isoformat()
        )
    return tracker.create_record(entity_id, source_prov)
