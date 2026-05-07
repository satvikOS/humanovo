"""
Incremental Update Management

Handles incremental updates to literature data:
- Track changes since last update
- Efficient delta processing
- Conflict resolution
- Update scheduling
"""

import logging
from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import StrEnum
from typing import Any

from .snapshots import SnapshotManager
from .sources import LiteratureRecord, LiteratureSource

logger = logging.getLogger(__name__)


class UpdateType(StrEnum):
    """Types of updates."""

    FULL = "full"  # Complete refresh
    INCREMENTAL = "incremental"  # Only new/changed
    DELTA = "delta"  # Minimal changes


class ChangeType(StrEnum):
    """Types of changes."""

    ADDED = "added"
    MODIFIED = "modified"
    REMOVED = "removed"
    UNCHANGED = "unchanged"


@dataclass
class RecordChange:
    """A change to a record."""

    record_id: str
    change_type: ChangeType
    old_record: LiteratureRecord | None = None
    new_record: LiteratureRecord | None = None
    changed_fields: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "record_id": self.record_id,
            "change_type": self.change_type.value,
            "old_record": self.old_record.to_dict() if self.old_record else None,
            "new_record": self.new_record.to_dict() if self.new_record else None,
            "changed_fields": self.changed_fields,
        }


@dataclass
class UpdateResult:
    """Result of an update operation."""

    update_id: str
    update_type: UpdateType
    started_at: str
    completed_at: str | None = None
    success: bool = False
    total_records: int = 0
    added_count: int = 0
    modified_count: int = 0
    removed_count: int = 0
    unchanged_count: int = 0
    errors: list[str] = field(default_factory=list)
    changes: list[RecordChange] = field(default_factory=list)
    new_snapshot_id: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "update_id": self.update_id,
            "update_type": self.update_type.value,
            "started_at": self.started_at,
            "completed_at": self.completed_at,
            "success": self.success,
            "total_records": self.total_records,
            "added_count": self.added_count,
            "modified_count": self.modified_count,
            "removed_count": self.removed_count,
            "unchanged_count": self.unchanged_count,
            "errors": self.errors,
            "changes": [c.to_dict() for c in self.changes],
            "new_snapshot_id": self.new_snapshot_id,
            "metadata": self.metadata,
        }


class UpdateManager:
    """
    Manages incremental updates to literature data.

    Features:
    - Detect new/modified/removed records
    - Efficient delta processing
    - Automatic snapshot creation
    - Update history tracking
    """

    def __init__(
        self,
        snapshot_manager: SnapshotManager | None = None,
        auto_snapshot: bool = True,
        track_history: bool = True,
    ):
        """
        Initialize update manager.

        Args:
            snapshot_manager: Snapshot manager for versioning
            auto_snapshot: Auto-create snapshots after updates
            track_history: Track update history
        """
        self.snapshot_manager = snapshot_manager or SnapshotManager()
        self.auto_snapshot = auto_snapshot
        self.track_history = track_history

        # Update tracking
        self._update_history: list[UpdateResult] = []
        self._last_update: datetime | None = None
        self._current_records: dict[str, LiteratureRecord] = {}

        logger.info("UpdateManager initialized")

    async def run_update(
        self,
        source: LiteratureSource,
        query: str,
        update_type: UpdateType = UpdateType.INCREMENTAL,
        max_records: int = 1000,
        date_from: datetime | None = None,
    ) -> UpdateResult:
        """
        Run an update from a source.

        Args:
            source: Literature source
            query: Search query
            update_type: Type of update
            max_records: Maximum records to fetch
            date_from: Start date for incremental

        Returns:
            UpdateResult
        """
        import hashlib

        update_id = f"update_{datetime.now(UTC).strftime('%Y%m%d_%H%M%S')}_{hashlib.md5(query.encode()).hexdigest()[:6]}"

        result = UpdateResult(
            update_id=update_id, update_type=update_type, started_at=datetime.now(UTC).isoformat()
        )

        try:
            # Fetch new records
            if update_type == UpdateType.INCREMENTAL and self._last_update:
                date_from = date_from or self._last_update

            new_records = await source.search(
                query=query,
                max_results=max_records,
                date_from=date_from.date() if date_from else None,
            )

            result.total_records = len(new_records)

            # Calculate changes
            changes = self._calculate_changes(new_records, update_type)
            result.changes = changes

            # Count change types
            for change in changes:
                if change.change_type == ChangeType.ADDED:
                    result.added_count += 1
                elif change.change_type == ChangeType.MODIFIED:
                    result.modified_count += 1
                elif change.change_type == ChangeType.REMOVED:
                    result.removed_count += 1
                else:
                    result.unchanged_count += 1

            # Apply changes
            self._apply_changes(changes)

            # Create snapshot if configured
            if self.auto_snapshot:
                all_records = list(self._current_records.values())
                snapshot = self.snapshot_manager.create_snapshot(
                    records=all_records,
                    description=f"Update {update_id}: {query}",
                    query_info={
                        "query": query,
                        "source": source.source_type.value,
                        "update_type": update_type.value,
                    },
                )
                result.new_snapshot_id = snapshot.metadata.snapshot_id

            result.success = True
            result.completed_at = datetime.now(UTC).isoformat()
            self._last_update = datetime.now(UTC)

        except Exception as e:
            logger.error(f"Update failed: {e}")
            result.errors.append(str(e))
            result.completed_at = datetime.now(UTC).isoformat()

        # Track history
        if self.track_history:
            self._update_history.append(result)

        return result

    def _calculate_changes(
        self, new_records: list[LiteratureRecord], update_type: UpdateType
    ) -> list[RecordChange]:
        """Calculate changes between current and new records."""
        changes = []
        new_ids = {r.record_id for r in new_records}
        new_map = {r.record_id: r for r in new_records}
        current_ids = set(self._current_records.keys())

        # Added records
        for record_id in new_ids - current_ids:
            changes.append(
                RecordChange(
                    record_id=record_id, change_type=ChangeType.ADDED, new_record=new_map[record_id]
                )
            )

        # Removed records (only for full updates)
        if update_type == UpdateType.FULL:
            for record_id in current_ids - new_ids:
                changes.append(
                    RecordChange(
                        record_id=record_id,
                        change_type=ChangeType.REMOVED,
                        old_record=self._current_records[record_id],
                    )
                )

        # Modified records
        for record_id in new_ids & current_ids:
            old_record = self._current_records[record_id]
            new_record = new_map[record_id]

            if old_record.get_content_hash() != new_record.get_content_hash():
                changed_fields = self._find_changed_fields(old_record, new_record)
                changes.append(
                    RecordChange(
                        record_id=record_id,
                        change_type=ChangeType.MODIFIED,
                        old_record=old_record,
                        new_record=new_record,
                        changed_fields=changed_fields,
                    )
                )
            else:
                changes.append(RecordChange(record_id=record_id, change_type=ChangeType.UNCHANGED))

        return changes

    def _find_changed_fields(self, old: LiteratureRecord, new: LiteratureRecord) -> list[str]:
        """Find which fields changed between records."""
        changed = []
        fields = ["title", "abstract", "authors", "keywords", "citations"]

        for field_name in fields:
            if getattr(old, field_name, None) != getattr(new, field_name, None):
                changed.append(field_name)

        return changed

    def _apply_changes(self, changes: list[RecordChange]):
        """Apply changes to current records."""
        for change in changes:
            if change.change_type == ChangeType.ADDED:
                if change.new_record:
                    self._current_records[change.record_id] = change.new_record
            elif change.change_type == ChangeType.MODIFIED:
                if change.new_record:
                    self._current_records[change.record_id] = change.new_record
            elif change.change_type == ChangeType.REMOVED:
                self._current_records.pop(change.record_id, None)

    def get_current_records(self) -> list[LiteratureRecord]:
        """Get all current records."""
        return list(self._current_records.values())

    def get_update_history(self, limit: int = 10) -> list[UpdateResult]:
        """Get recent update history."""
        return self._update_history[-limit:]

    def restore_from_snapshot(self, snapshot_id: str) -> bool:
        """
        Restore state from a snapshot.

        Args:
            snapshot_id: Snapshot to restore

        Returns:
            True if successful
        """
        snapshot = self.snapshot_manager.get_snapshot(snapshot_id)
        if not snapshot:
            return False

        self._current_records = {r.record_id: r for r in snapshot.records}

        logger.info(f"Restored {len(self._current_records)} records from {snapshot_id}")
        return True

    def get_statistics(self) -> dict[str, Any]:
        """Get manager statistics."""
        return {
            "current_record_count": len(self._current_records),
            "last_update": self._last_update.isoformat() if self._last_update else None,
            "update_count": len(self._update_history),
            "auto_snapshot": self.auto_snapshot,
        }
