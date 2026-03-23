"""
PostgreSQL Provenance Storage Backend

Production-ready persistent storage for provenance data using PostgreSQL.
"""

from datetime import datetime
from typing import Any

from sqlalchemy import (
    Column,
    DateTime,
    Float,
    ForeignKey,
    Index,
    String,
    Text,
    and_,
    select,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import relationship

from app.agents.ingestion.base import SourceType
from app.core.database import Base, async_session_factory
from app.core.logging import get_logger
from app.integration.provenance_tracker import (
    DataQualityLevel,
    ProvenanceEvent,
    ProvenanceEventType,
    ProvenanceRecord,
    ProvenanceStorage,
)

logger = get_logger(__name__)


class ProvenanceRecordModel(Base):
    """SQLAlchemy model for provenance records."""

    __tablename__ = "provenance_records"

    record_id = Column(String(255), primary_key=True)
    source_type = Column(String(50), nullable=False, index=True)
    original_source = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False)
    last_updated = Column(DateTime(timezone=True), nullable=False)
    lineage = Column(ARRAY(String), default=list, nullable=False)
    derived_records = Column(ARRAY(String), default=list, nullable=False)
    quality_level = Column(String(20), default="medium", nullable=False)
    version = Column(Float, default=1, nullable=False)
    current_hash = Column(String(64), nullable=True)
    extra_metadata = Column("metadata", JSONB, default=dict, nullable=False)

    # Relationships
    events = relationship(
        "ProvenanceEventModel",
        back_populates="record",
        lazy="selectin",
        cascade="all, delete-orphan",
    )

    __table_args__ = (Index("ix_provenance_records_source_created", "source_type", "created_at"),)

    def to_domain(self) -> ProvenanceRecord:
        """Convert to domain object."""
        return ProvenanceRecord(
            record_id=self.record_id,
            source_type=SourceType(self.source_type),
            original_source=self.original_source,
            created_at=self.created_at,
            last_updated=self.last_updated,
            events=[e.to_domain() for e in (self.events or [])],
            lineage=list(self.lineage or []),
            derived_records=list(self.derived_records or []),
            quality_level=DataQualityLevel(self.quality_level),
            version=int(self.version),
            current_hash=self.current_hash,
            metadata=dict(self.extra_metadata or {}),
        )

    @classmethod
    def from_domain(cls, record: ProvenanceRecord) -> "ProvenanceRecordModel":
        """Create from domain object."""
        return cls(
            record_id=record.record_id,
            source_type=record.source_type.value,
            original_source=record.original_source,
            created_at=record.created_at,
            last_updated=record.last_updated,
            lineage=list(record.lineage),
            derived_records=list(record.derived_records),
            quality_level=record.quality_level.value,
            version=record.version,
            current_hash=record.current_hash,
            extra_metadata=record.metadata,
        )


class ProvenanceEventModel(Base):
    """SQLAlchemy model for provenance events."""

    __tablename__ = "provenance_events"

    event_id = Column(PGUUID(as_uuid=True), primary_key=True)
    event_type = Column(String(50), nullable=False, index=True)
    record_id = Column(
        String(255),
        ForeignKey("provenance_records.record_id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    source_type = Column(String(50), nullable=False)
    timestamp = Column(DateTime(timezone=True), nullable=False, index=True)
    agent_id = Column(String(100), nullable=True, index=True)
    operation = Column(String(100), default="", nullable=False)
    input_records = Column(ARRAY(String), default=list, nullable=False)
    output_records = Column(ARRAY(String), default=list, nullable=False)
    extra_metadata = Column("metadata", JSONB, default=dict, nullable=False)
    data_hash = Column(String(64), nullable=True)
    quality_level = Column(String(20), default="medium", nullable=False)
    confidence = Column(Float, default=1.0, nullable=False)

    # Relationships
    record = relationship("ProvenanceRecordModel", back_populates="events")

    __table_args__ = (
        Index("ix_provenance_events_record_timestamp", "record_id", "timestamp"),
        Index("ix_provenance_events_type_timestamp", "event_type", "timestamp"),
    )

    def to_domain(self) -> ProvenanceEvent:
        """Convert to domain object."""
        return ProvenanceEvent(
            event_id=self.event_id,
            event_type=ProvenanceEventType(self.event_type),
            record_id=self.record_id,
            source_type=SourceType(self.source_type),
            timestamp=self.timestamp,
            agent_id=self.agent_id,
            operation=self.operation,
            input_records=list(self.input_records or []),
            output_records=list(self.output_records or []),
            metadata=dict(self.extra_metadata or {}),
            data_hash=self.data_hash,
            quality_level=DataQualityLevel(self.quality_level),
            confidence=self.confidence,
        )

    @classmethod
    def from_domain(cls, event: ProvenanceEvent) -> "ProvenanceEventModel":
        """Create from domain object."""
        return cls(
            event_id=event.event_id,
            event_type=event.event_type.value,
            record_id=event.record_id,
            source_type=event.source_type.value,
            timestamp=event.timestamp,
            agent_id=event.agent_id,
            operation=event.operation,
            input_records=list(event.input_records),
            output_records=list(event.output_records),
            extra_metadata=event.metadata,
            data_hash=event.data_hash,
            quality_level=event.quality_level.value,
            confidence=event.confidence,
        )


class PostgresProvenanceStorage(ProvenanceStorage):
    """
    PostgreSQL-based provenance storage.

    Provides persistent, queryable storage for provenance records and events
    with full ACID compliance and indexing for efficient retrieval.
    """

    def __init__(self, session_factory=None):
        """
        Initialize PostgreSQL storage.

        Args:
            session_factory: SQLAlchemy async session factory (uses default if None)
        """
        self.session_factory = session_factory or async_session_factory
        self.logger = logger

    async def _get_session(self) -> AsyncSession:
        """Get a database session."""
        return self.session_factory()

    async def save_record(self, record: ProvenanceRecord) -> None:
        """Save a provenance record to the database."""
        async with self.session_factory() as session:
            async with session.begin():
                # Check if record exists
                existing = await session.get(ProvenanceRecordModel, record.record_id)

                if existing:
                    # Update existing record
                    existing.source_type = record.source_type.value
                    existing.original_source = record.original_source
                    existing.last_updated = record.last_updated
                    existing.lineage = list(record.lineage)
                    existing.derived_records = list(record.derived_records)
                    existing.quality_level = record.quality_level.value
                    existing.version = record.version
                    existing.current_hash = record.current_hash
                    existing.extra_metadata = record.metadata
                else:
                    # Create new record
                    model = ProvenanceRecordModel.from_domain(record)
                    session.add(model)

            self.logger.debug(
                "Provenance record saved",
                record_id=record.record_id,
            )

    async def get_record(self, record_id: str) -> ProvenanceRecord | None:
        """Retrieve a provenance record by ID."""
        async with self.session_factory() as session:
            model = await session.get(ProvenanceRecordModel, record_id)

            if model:
                return model.to_domain()

            return None

    async def save_event(self, event: ProvenanceEvent) -> None:
        """Save a provenance event to the database."""
        async with self.session_factory() as session:
            async with session.begin():
                # Check if event exists
                existing = await session.get(ProvenanceEventModel, event.event_id)

                if not existing:
                    model = ProvenanceEventModel.from_domain(event)
                    session.add(model)

            self.logger.debug(
                "Provenance event saved",
                event_id=str(event.event_id),
                event_type=event.event_type.value,
            )

    async def get_events(
        self,
        record_id: str,
        event_types: list[ProvenanceEventType] | None = None,
        limit: int = 100,
    ) -> list[ProvenanceEvent]:
        """Retrieve events for a record with optional filtering."""
        async with self.session_factory() as session:
            query = select(ProvenanceEventModel).where(ProvenanceEventModel.record_id == record_id)

            if event_types:
                type_values = [t.value for t in event_types]
                query = query.where(ProvenanceEventModel.event_type.in_(type_values))

            query = query.order_by(ProvenanceEventModel.timestamp.desc()).limit(limit)

            result = await session.execute(query)
            models = result.scalars().all()

            return [m.to_domain() for m in models]

    async def get_lineage(
        self,
        record_id: str,
        depth: int = 10,
    ) -> list[ProvenanceRecord]:
        """
        Get the lineage (ancestors) of a record.

        Uses iterative BFS to traverse the lineage graph up to the specified depth.
        """
        async with self.session_factory() as session:
            result = []
            visited = set()
            queue = [record_id]
            current_depth = 0

            while queue and current_depth < depth:
                current_id = queue.pop(0)

                if current_id in visited:
                    continue

                visited.add(current_id)

                model = await session.get(ProvenanceRecordModel, current_id)
                if model:
                    record = model.to_domain()
                    result.append(record)

                    # Add parent records to queue
                    for parent_id in record.lineage:
                        if parent_id not in visited:
                            queue.append(parent_id)

                current_depth += 1

            return result

    async def get_derived(
        self,
        record_id: str,
        depth: int = 10,
    ) -> list[ProvenanceRecord]:
        """
        Get all records derived from this record.

        Uses iterative BFS to traverse the derivation graph down to the specified depth.
        """
        async with self.session_factory() as session:
            result = []
            visited = set()
            queue = [record_id]
            current_depth = 0

            while queue and current_depth < depth:
                current_id = queue.pop(0)

                if current_id in visited:
                    continue

                visited.add(current_id)

                model = await session.get(ProvenanceRecordModel, current_id)
                if model:
                    record = model.to_domain()
                    result.append(record)

                    # Add derived records to queue
                    for derived_id in record.derived_records:
                        if derived_id not in visited:
                            queue.append(derived_id)

                current_depth += 1

            return result

    async def delete_record(self, record_id: str) -> bool:
        """Delete a provenance record and its events."""
        async with self.session_factory() as session:
            async with session.begin():
                model = await session.get(ProvenanceRecordModel, record_id)
                if model:
                    await session.delete(model)
                    self.logger.info(
                        "Provenance record deleted",
                        record_id=record_id,
                    )
                    return True
                return False

    async def query_records(
        self,
        source_type: SourceType | None = None,
        quality_level: DataQualityLevel | None = None,
        created_after: datetime | None = None,
        created_before: datetime | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[ProvenanceRecord]:
        """Query records with various filters."""
        async with self.session_factory() as session:
            query = select(ProvenanceRecordModel)

            conditions = []
            if source_type:
                conditions.append(ProvenanceRecordModel.source_type == source_type.value)
            if quality_level:
                conditions.append(ProvenanceRecordModel.quality_level == quality_level.value)
            if created_after:
                conditions.append(ProvenanceRecordModel.created_at >= created_after)
            if created_before:
                conditions.append(ProvenanceRecordModel.created_at <= created_before)

            if conditions:
                query = query.where(and_(*conditions))

            query = (
                query.order_by(ProvenanceRecordModel.created_at.desc()).limit(limit).offset(offset)
            )

            result = await session.execute(query)
            models = result.scalars().all()

            return [m.to_domain() for m in models]

    async def query_events(
        self,
        event_type: ProvenanceEventType | None = None,
        agent_id: str | None = None,
        timestamp_after: datetime | None = None,
        timestamp_before: datetime | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[ProvenanceEvent]:
        """Query events with various filters."""
        async with self.session_factory() as session:
            query = select(ProvenanceEventModel)

            conditions = []
            if event_type:
                conditions.append(ProvenanceEventModel.event_type == event_type.value)
            if agent_id:
                conditions.append(ProvenanceEventModel.agent_id == agent_id)
            if timestamp_after:
                conditions.append(ProvenanceEventModel.timestamp >= timestamp_after)
            if timestamp_before:
                conditions.append(ProvenanceEventModel.timestamp <= timestamp_before)

            if conditions:
                query = query.where(and_(*conditions))

            query = (
                query.order_by(ProvenanceEventModel.timestamp.desc()).limit(limit).offset(offset)
            )

            result = await session.execute(query)
            models = result.scalars().all()

            return [m.to_domain() for m in models]

    async def get_stats(self) -> dict[str, Any]:
        """Get storage statistics."""
        async with self.session_factory() as session:
            # Count records
            record_count_result = await session.execute(select(ProvenanceRecordModel).count())
            record_count = record_count_result.scalar() or 0

            # Count events
            event_count_result = await session.execute(select(ProvenanceEventModel).count())
            event_count = event_count_result.scalar() or 0

            # Events by type
            events_by_type = {}
            for event_type in ProvenanceEventType:
                type_count_result = await session.execute(
                    select(ProvenanceEventModel)
                    .where(ProvenanceEventModel.event_type == event_type.value)
                    .count()
                )
                events_by_type[event_type.value] = type_count_result.scalar() or 0

            return {
                "total_records": record_count,
                "total_events": event_count,
                "events_by_type": events_by_type,
            }


def get_postgres_provenance_storage() -> PostgresProvenanceStorage:
    """Factory function for PostgreSQL provenance storage."""
    return PostgresProvenanceStorage()
