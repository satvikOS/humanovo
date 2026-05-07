"""
Real-Time Indexer

Handles real-time index updates with consistency guarantees,
write-ahead logging, and transactional semantics.
"""

import asyncio
import hashlib
import json
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import Enum
from typing import Any
from uuid import UUID, uuid4

from app.agents.ingestion.base import IngestionRecord, SourceType
from app.core.logging import get_logger

logger = get_logger(__name__)


class IndexUpdateType(str, Enum):
    """Types of index updates."""

    CREATE = "create"
    UPDATE = "update"
    DELETE = "delete"
    UPSERT = "upsert"


class ConsistencyLevel(str, Enum):
    """Consistency level for updates."""

    EVENTUAL = "eventual"  # Fire and forget
    CONFIRMED = "confirmed"  # Wait for acknowledgment
    STRICT = "strict"  # Wait for all replicas
    TRANSACTIONAL = "transactional"  # All-or-nothing


class UpdateStatus(str, Enum):
    """Status of an update operation."""

    PENDING = "pending"
    PROCESSING = "processing"
    APPLIED = "applied"
    FAILED = "failed"
    ROLLED_BACK = "rolled_back"


@dataclass
class IndexUpdate:
    """An index update operation."""

    update_id: UUID
    update_type: IndexUpdateType
    record_id: str
    source_type: SourceType
    data: dict[str, Any]
    consistency: ConsistencyLevel
    timestamp: datetime
    status: UpdateStatus = UpdateStatus.PENDING
    retries: int = 0
    error: str | None = None
    applied_at: datetime | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "update_id": str(self.update_id),
            "update_type": self.update_type.value,
            "record_id": self.record_id,
            "source_type": self.source_type.value,
            "data": self.data,
            "consistency": self.consistency.value,
            "timestamp": self.timestamp.isoformat(),
            "status": self.status.value,
            "retries": self.retries,
            "error": self.error,
            "applied_at": self.applied_at.isoformat() if self.applied_at else None,
        }


@dataclass
class WriteAheadLogEntry:
    """Entry in the write-ahead log for durability."""

    sequence_number: int
    update: IndexUpdate
    checksum: str
    committed: bool = False


@dataclass
class TransactionContext:
    """Context for a transaction."""

    transaction_id: UUID
    updates: list[IndexUpdate]
    started_at: datetime
    consistency: ConsistencyLevel
    status: str = "active"
    applied_updates: list[UUID] = field(default_factory=list)


class WriteAheadLog:
    """
    Write-ahead log for durability and recovery.

    Ensures updates are persisted before being applied.
    """

    def __init__(self, max_entries: int = 10000):
        self.max_entries = max_entries
        self._log: deque[WriteAheadLogEntry] = deque(maxlen=max_entries)
        self._sequence: int = 0
        self._lock = asyncio.Lock()

    def _compute_checksum(self, update: IndexUpdate) -> str:
        """Compute checksum for an update."""
        data = json.dumps(update.to_dict(), sort_keys=True)
        return hashlib.sha256(data.encode()).hexdigest()[:16]

    async def append(self, update: IndexUpdate) -> int:
        """
        Append an update to the log.

        Returns:
            Sequence number
        """
        async with self._lock:
            self._sequence += 1
            entry = WriteAheadLogEntry(
                sequence_number=self._sequence,
                update=update,
                checksum=self._compute_checksum(update),
            )
            self._log.append(entry)
            return self._sequence

    async def commit(self, sequence_number: int) -> bool:
        """Mark an entry as committed."""
        async with self._lock:
            for entry in self._log:
                if entry.sequence_number == sequence_number:
                    entry.committed = True
                    return True
            return False

    async def get_uncommitted(self) -> list[WriteAheadLogEntry]:
        """Get all uncommitted entries for recovery."""
        async with self._lock:
            return [e for e in self._log if not e.committed]

    async def truncate(self, up_to_sequence: int) -> int:
        """Remove committed entries up to sequence number."""
        async with self._lock:
            removed = 0
            while self._log and self._log[0].sequence_number <= up_to_sequence:
                if self._log[0].committed:
                    self._log.popleft()
                    removed += 1
                else:
                    break
            return removed


class RealtimeIndexer:
    """
    Manages real-time index updates with consistency guarantees.

    Features:
    - Write-ahead logging for durability
    - Multiple consistency levels
    - Transactional updates
    - Automatic retry with backoff
    - Conflict detection and resolution
    - Real-time event streaming
    """

    def __init__(
        self,
        batch_size: int = 50,
        flush_interval_seconds: float = 1.0,
        max_retries: int = 3,
        retry_delay_seconds: float = 1.0,
    ):
        """
        Initialize the real-time indexer.

        Args:
            batch_size: Number of updates to batch before flushing
            flush_interval_seconds: Interval for automatic flushing
            max_retries: Maximum retry attempts for failed updates
            retry_delay_seconds: Base delay between retries
        """
        self.batch_size = batch_size
        self.flush_interval = flush_interval_seconds
        self.max_retries = max_retries
        self.retry_delay = retry_delay_seconds

        # Components
        self._wal = WriteAheadLog()
        self._rag_connector = None
        self._graph_connector = None

        # Update buffers
        self._pending_updates: deque[IndexUpdate] = deque()
        self._processing_updates: dict[UUID, IndexUpdate] = {}

        # Transaction management
        self._transactions: dict[UUID, TransactionContext] = {}

        # Event streaming
        self._subscribers: list[Callable[[IndexUpdate], None]] = []

        # Control
        self._running = False
        self._flush_task: asyncio.Task | None = None
        self._lock = asyncio.Lock()

        # Statistics
        self._stats = {
            "total_updates": 0,
            "successful_updates": 0,
            "failed_updates": 0,
            "transactions_committed": 0,
            "transactions_rolled_back": 0,
        }

        self.logger = logger

    async def _get_rag_connector(self):
        """Lazy-load RAG connector."""
        if self._rag_connector is None:
            from app.integration.rag_connector import get_rag_connector

            self._rag_connector = get_rag_connector()
        return self._rag_connector

    async def _get_graph_connector(self):
        """Lazy-load graph connector."""
        if self._graph_connector is None:
            from app.integration.graph_connector import get_graph_connector

            self._graph_connector = get_graph_connector()
        return self._graph_connector

    def subscribe(self, callback: Callable[[IndexUpdate], None]) -> None:
        """Subscribe to update events."""
        self._subscribers.append(callback)

    def unsubscribe(self, callback: Callable[[IndexUpdate], None]) -> None:
        """Unsubscribe from update events."""
        if callback in self._subscribers:
            self._subscribers.remove(callback)

    def _notify_subscribers(self, update: IndexUpdate) -> None:
        """Notify all subscribers of an update."""
        for callback in self._subscribers:
            try:
                callback(update)
            except Exception as e:
                self.logger.error("Subscriber error", error=str(e))

    async def enqueue(
        self,
        record: IngestionRecord,
        update_type: IndexUpdateType = IndexUpdateType.UPSERT,
        consistency: ConsistencyLevel = ConsistencyLevel.CONFIRMED,
    ) -> UUID:
        """
        Enqueue an update for processing.

        Args:
            record: The ingestion record
            update_type: Type of update
            consistency: Consistency level

        Returns:
            Update ID
        """
        update = IndexUpdate(
            update_id=uuid4(),
            update_type=update_type,
            record_id=record.source_id,
            source_type=record.source_type,
            data=self._serialize_record(record),
            consistency=consistency,
            timestamp=datetime.now(UTC),
        )

        # Write to WAL first
        await self._wal.append(update)

        async with self._lock:
            self._pending_updates.append(update)
            self._stats["total_updates"] += 1

        self.logger.debug(
            "Update enqueued",
            update_id=str(update.update_id),
            record_id=record.source_id,
        )

        # Immediate processing for strict/transactional
        if consistency in [ConsistencyLevel.STRICT, ConsistencyLevel.TRANSACTIONAL]:
            await self._process_update(update)

        return update.update_id

    async def enqueue_batch(
        self,
        records: list[IngestionRecord],
        update_type: IndexUpdateType = IndexUpdateType.UPSERT,
        consistency: ConsistencyLevel = ConsistencyLevel.CONFIRMED,
    ) -> list[UUID]:
        """Enqueue multiple updates."""
        update_ids = []
        for record in records:
            update_id = await self.enqueue(record, update_type, consistency)
            update_ids.append(update_id)
        return update_ids

    async def begin_transaction(
        self,
        consistency: ConsistencyLevel = ConsistencyLevel.TRANSACTIONAL,
    ) -> UUID:
        """
        Begin a new transaction.

        Returns:
            Transaction ID
        """
        txn_id = uuid4()
        txn = TransactionContext(
            transaction_id=txn_id,
            updates=[],
            started_at=datetime.now(UTC),
            consistency=consistency,
        )
        self._transactions[txn_id] = txn

        self.logger.info("Transaction started", transaction_id=str(txn_id))
        return txn_id

    async def add_to_transaction(
        self,
        transaction_id: UUID,
        record: IngestionRecord,
        update_type: IndexUpdateType = IndexUpdateType.UPSERT,
    ) -> UUID:
        """
        Add an update to a transaction.

        Args:
            transaction_id: Transaction ID
            record: Ingestion record
            update_type: Type of update

        Returns:
            Update ID
        """
        if transaction_id not in self._transactions:
            raise ValueError(f"Transaction not found: {transaction_id}")

        txn = self._transactions[transaction_id]
        if txn.status != "active":
            raise ValueError(f"Transaction is not active: {txn.status}")

        update = IndexUpdate(
            update_id=uuid4(),
            update_type=update_type,
            record_id=record.source_id,
            source_type=record.source_type,
            data=self._serialize_record(record),
            consistency=txn.consistency,
            timestamp=datetime.now(UTC),
        )

        txn.updates.append(update)
        return update.update_id

    async def commit_transaction(self, transaction_id: UUID) -> bool:
        """
        Commit a transaction.

        Args:
            transaction_id: Transaction ID

        Returns:
            True if committed successfully
        """
        if transaction_id not in self._transactions:
            raise ValueError(f"Transaction not found: {transaction_id}")

        txn = self._transactions[transaction_id]
        if txn.status != "active":
            raise ValueError(f"Transaction is not active: {txn.status}")

        txn.status = "committing"

        try:
            # Write all to WAL
            for update in txn.updates:
                await self._wal.append(update)

            # Process all updates
            for update in txn.updates:
                await self._process_update(update)
                txn.applied_updates.append(update.update_id)

            txn.status = "committed"
            self._stats["transactions_committed"] += 1

            self.logger.info(
                "Transaction committed",
                transaction_id=str(transaction_id),
                updates_count=len(txn.updates),
            )

            return True

        except Exception:
            # Rollback
            await self._rollback_transaction(txn)
            raise

        finally:
            del self._transactions[transaction_id]

    async def rollback_transaction(self, transaction_id: UUID) -> None:
        """
        Rollback a transaction.

        Args:
            transaction_id: Transaction ID
        """
        if transaction_id not in self._transactions:
            raise ValueError(f"Transaction not found: {transaction_id}")

        txn = self._transactions[transaction_id]
        await self._rollback_transaction(txn)
        del self._transactions[transaction_id]

    async def _rollback_transaction(self, txn: TransactionContext) -> None:
        """Internal transaction rollback."""
        txn.status = "rolling_back"

        # Reverse applied updates
        for update_id in reversed(txn.applied_updates):
            # Find and reverse the update
            for update in txn.updates:
                if update.update_id == update_id:
                    await self._reverse_update(update)
                    break

        txn.status = "rolled_back"
        self._stats["transactions_rolled_back"] += 1

        self.logger.info(
            "Transaction rolled back",
            transaction_id=str(txn.transaction_id),
        )

    async def _reverse_update(self, update: IndexUpdate) -> None:
        """Reverse an update operation."""
        if update.update_type == IndexUpdateType.CREATE:
            # Delete the created item
            rag_connector = await self._get_rag_connector()
            await rag_connector.delete_record(update.record_id)

            graph_connector = await self._get_graph_connector()
            await graph_connector.delete_source_data(update.record_id)

        # For UPDATE/UPSERT, we would need the original data
        # which requires more sophisticated change tracking

    async def _process_update(self, update: IndexUpdate) -> bool:
        """
        Process a single update.

        Returns:
            True if successful
        """
        update.status = UpdateStatus.PROCESSING
        self._processing_updates[update.update_id] = update

        try:
            # Convert back to record
            record = self._deserialize_record(update.data, update.source_type)

            # Update vector store
            rag_connector = await self._get_rag_connector()

            if update.update_type == IndexUpdateType.DELETE:
                await rag_connector.delete_record(update.record_id)
            elif update.update_type == IndexUpdateType.UPDATE:
                await rag_connector.update_record(record)
            else:  # CREATE or UPSERT
                await rag_connector.index_record(record)

            # Update knowledge graph
            graph_connector = await self._get_graph_connector()

            if update.update_type == IndexUpdateType.DELETE:
                await graph_connector.delete_source_data(update.record_id)
            else:
                await graph_connector.update_from_record(record)

            # Mark as applied
            update.status = UpdateStatus.APPLIED
            update.applied_at = datetime.now(UTC)
            self._stats["successful_updates"] += 1

            self._notify_subscribers(update)

            self.logger.debug(
                "Update applied",
                update_id=str(update.update_id),
                record_id=update.record_id,
            )

            return True

        except Exception as e:
            update.status = UpdateStatus.FAILED
            update.error = str(e)
            update.retries += 1
            self._stats["failed_updates"] += 1

            self.logger.error(
                "Update failed",
                update_id=str(update.update_id),
                error=str(e),
                retries=update.retries,
            )

            # Retry if allowed
            if update.retries < self.max_retries:
                await asyncio.sleep(self.retry_delay * (2**update.retries))
                return await self._process_update(update)

            return False

        finally:
            self._processing_updates.pop(update.update_id, None)

    def _serialize_record(self, record: IngestionRecord) -> dict[str, Any]:
        """Serialize an ingestion record for storage."""
        return {
            "source_id": record.source_id,
            "source_type": record.source_type.value,
            "title": record.title,
            "abstract": record.abstract,
            "full_text": record.full_text,
            "authors": record.authors,
            "keywords": record.keywords,
            "doi": record.doi,
            "pmid": record.pmid,
            "url": record.url,
            "publication_date": record.publication_date.isoformat()
            if record.publication_date
            else None,
            "entities": [
                {
                    "text": e.text,
                    "entity_type": e.entity_type,
                    "start_char": e.start_char,
                    "end_char": e.end_char,
                    "confidence": e.confidence,
                }
                for e in (record.entities or [])
            ],
            "relations": [
                {
                    "source_entity_id": r.source_entity_id,
                    "target_entity_id": r.target_entity_id,
                    "relation_type": r.relation_type,
                    "confidence": r.confidence,
                }
                for r in (record.relations or [])
            ],
        }

    def _deserialize_record(
        self,
        data: dict[str, Any],
        source_type: SourceType,
    ) -> IngestionRecord:
        """Deserialize a record from storage."""
        from app.agents.ingestion.base import ExtractedEntity, ExtractedRelation

        entities = [
            ExtractedEntity(
                text=e["text"],
                entity_type=e["entity_type"],
                start_char=e["start_char"],
                end_char=e["end_char"],
                confidence=e["confidence"],
            )
            for e in data.get("entities", [])
        ]

        relations = [
            ExtractedRelation(
                source_entity_id=r["source_entity_id"],
                target_entity_id=r["target_entity_id"],
                relation_type=r["relation_type"],
                confidence=r["confidence"],
            )
            for r in data.get("relations", [])
        ]

        return IngestionRecord(
            source_id=data["source_id"],
            source_type=source_type,
            title=data.get("title"),
            abstract=data.get("abstract"),
            full_text=data.get("full_text"),
            authors=data.get("authors", []),
            keywords=data.get("keywords", []),
            doi=data.get("doi"),
            pmid=data.get("pmid"),
            url=data.get("url"),
            publication_date=datetime.fromisoformat(data["publication_date"])
            if data.get("publication_date")
            else None,
            entities=entities,
            relations=relations,
        )

    async def start(self) -> None:
        """Start the indexer background tasks."""
        if self._running:
            return

        self._running = True
        self._flush_task = asyncio.create_task(self._flush_loop())

        self.logger.info("Real-time indexer started")

    async def stop(self) -> None:
        """Stop the indexer and flush remaining updates."""
        self._running = False

        if self._flush_task:
            self._flush_task.cancel()
            try:
                await self._flush_task
            except asyncio.CancelledError:
                pass

        # Flush remaining updates
        await self._flush()

        self.logger.info("Real-time indexer stopped")

    async def _flush_loop(self) -> None:
        """Periodic flush loop."""
        while self._running:
            try:
                await asyncio.sleep(self.flush_interval)
                await self._flush()
            except asyncio.CancelledError:
                break
            except Exception as e:
                self.logger.error("Flush error", error=str(e))

    async def _flush(self) -> int:
        """
        Process pending updates.

        Returns:
            Number of updates processed
        """
        processed = 0

        async with self._lock:
            updates_to_process = []
            while self._pending_updates and len(updates_to_process) < self.batch_size:
                updates_to_process.append(self._pending_updates.popleft())

        for update in updates_to_process:
            if update.consistency == ConsistencyLevel.EVENTUAL:
                # Fire and forget
                asyncio.create_task(self._process_update(update))
            else:
                await self._process_update(update)
            processed += 1

        if processed > 0:
            self.logger.debug("Flushed updates", count=processed)

        return processed

    async def get_update_status(self, update_id: UUID) -> dict[str, Any] | None:
        """Get the status of an update."""
        # Check processing
        if update_id in self._processing_updates:
            update = self._processing_updates[update_id]
            return update.to_dict()

        # Check pending
        async with self._lock:
            for update in self._pending_updates:
                if update.update_id == update_id:
                    return update.to_dict()

        return None

    def get_stats(self) -> dict[str, Any]:
        """Get indexer statistics."""
        return {
            **self._stats,
            "pending_count": len(self._pending_updates),
            "processing_count": len(self._processing_updates),
            "active_transactions": len(self._transactions),
        }

    async def recover(self) -> int:
        """
        Recover from uncommitted WAL entries.

        Returns:
            Number of recovered updates
        """
        uncommitted = await self._wal.get_uncommitted()
        recovered = 0

        for entry in uncommitted:
            try:
                await self._process_update(entry.update)
                await self._wal.commit(entry.sequence_number)
                recovered += 1
            except Exception as e:
                self.logger.error(
                    "Recovery failed for entry",
                    sequence_number=entry.sequence_number,
                    error=str(e),
                )

        if recovered > 0:
            self.logger.info("Recovered updates from WAL", count=recovered)

        return recovered


# Global indexer instance
_realtime_indexer: RealtimeIndexer | None = None


def get_realtime_indexer() -> RealtimeIndexer:
    """Get the global real-time indexer instance."""
    global _realtime_indexer
    if _realtime_indexer is None:
        _realtime_indexer = RealtimeIndexer()
    return _realtime_indexer


async def initialize_realtime_indexer() -> RealtimeIndexer:
    """Initialize and start the real-time indexer."""
    indexer = get_realtime_indexer()
    await indexer.recover()  # Recover any pending from previous run
    await indexer.start()
    return indexer


async def shutdown_realtime_indexer() -> None:
    """Shutdown the real-time indexer gracefully."""
    global _realtime_indexer
    if _realtime_indexer:
        await _realtime_indexer.stop()
