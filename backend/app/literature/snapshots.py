"""
Data Snapshot Management

Manages versioned snapshots of literature data:
- Create snapshots at specific points in time
- Compare snapshots
- Restore from snapshots
- Track changes over time
"""

import gzip
import hashlib
import json
import logging
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

from .sources import LiteratureRecord

logger = logging.getLogger(__name__)


@dataclass
class SnapshotMetadata:
    """Metadata for a snapshot."""

    snapshot_id: str
    created_at: str
    description: str
    record_count: int
    source_types: list[str]
    query_info: dict[str, Any] = field(default_factory=dict)
    selection_criteria: dict[str, Any] = field(default_factory=dict)
    content_hash: str = ""
    parent_snapshot_id: str | None = None
    tags: list[str] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "snapshot_id": self.snapshot_id,
            "created_at": self.created_at,
            "description": self.description,
            "record_count": self.record_count,
            "source_types": self.source_types,
            "query_info": self.query_info,
            "selection_criteria": self.selection_criteria,
            "content_hash": self.content_hash,
            "parent_snapshot_id": self.parent_snapshot_id,
            "tags": self.tags,
            "metadata": self.metadata,
        }


@dataclass
class DataSnapshot:
    """A snapshot of literature data."""

    metadata: SnapshotMetadata
    records: list[LiteratureRecord] = field(default_factory=list)
    record_ids: set[str] = field(default_factory=set)

    def to_dict(self) -> dict[str, Any]:
        return {
            "metadata": self.metadata.to_dict(),
            "records": [r.to_dict() for r in self.records],
            "record_ids": list(self.record_ids),
        }

    def get_record(self, record_id: str) -> LiteratureRecord | None:
        """Get a specific record by ID."""
        for record in self.records:
            if record.record_id == record_id:
                return record
        return None


@dataclass
class SnapshotDiff:
    """Difference between two snapshots."""

    from_snapshot_id: str
    to_snapshot_id: str
    added_records: list[str]
    removed_records: list[str]
    modified_records: list[str]
    summary: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "from_snapshot_id": self.from_snapshot_id,
            "to_snapshot_id": self.to_snapshot_id,
            "added_records": self.added_records,
            "removed_records": self.removed_records,
            "modified_records": self.modified_records,
            "summary": self.summary,
        }


class SnapshotManager:
    """
    Manages data snapshots for reproducibility.

    Features:
    - Create and store snapshots
    - Compare snapshots
    - Restore from snapshots
    - Track snapshot lineage
    """

    def __init__(
        self, storage_path: str | None = None, compress: bool = True, max_snapshots: int = 100
    ):
        """
        Initialize snapshot manager.

        Args:
            storage_path: Path for snapshot storage
            compress: Compress snapshots
            max_snapshots: Maximum snapshots to keep
        """
        self.storage_path = Path(storage_path) if storage_path else None
        self.compress = compress
        self.max_snapshots = max_snapshots

        # In-memory storage
        self._snapshots: dict[str, DataSnapshot] = {}
        self._metadata_index: dict[str, SnapshotMetadata] = {}
        self._timeline: list[str] = []  # Ordered list of snapshot IDs

        # Create storage directory if needed
        if self.storage_path:
            self.storage_path.mkdir(parents=True, exist_ok=True)

        logger.info(f"SnapshotManager initialized, storage: {storage_path}")

    def create_snapshot(
        self,
        records: list[LiteratureRecord],
        description: str,
        query_info: dict[str, Any] | None = None,
        selection_criteria: dict[str, Any] | None = None,
        parent_snapshot_id: str | None = None,
        tags: list[str] | None = None,
    ) -> DataSnapshot:
        """
        Create a new snapshot.

        Args:
            records: Records to snapshot
            description: Snapshot description
            query_info: Query parameters used
            selection_criteria: Selection criteria applied
            parent_snapshot_id: Parent snapshot (if incremental)
            tags: Tags for the snapshot

        Returns:
            Created DataSnapshot
        """
        now = datetime.utcnow().isoformat()

        # Generate snapshot ID
        content = json.dumps([r.record_id for r in records], sort_keys=True)
        content_hash = hashlib.sha256(content.encode()).hexdigest()
        snapshot_id = f"snap_{now[:10]}_{content_hash[:8]}"

        # Collect source types
        source_types = list(set(r.source_type.value for r in records))

        # Create metadata
        metadata = SnapshotMetadata(
            snapshot_id=snapshot_id,
            created_at=now,
            description=description,
            record_count=len(records),
            source_types=source_types,
            query_info=query_info or {},
            selection_criteria=selection_criteria or {},
            content_hash=content_hash,
            parent_snapshot_id=parent_snapshot_id,
            tags=tags or [],
        )

        # Create snapshot
        snapshot = DataSnapshot(
            metadata=metadata, records=records, record_ids={r.record_id for r in records}
        )

        # Store
        self._snapshots[snapshot_id] = snapshot
        self._metadata_index[snapshot_id] = metadata
        self._timeline.append(snapshot_id)

        # Persist if storage path is set
        if self.storage_path:
            self._save_snapshot(snapshot)

        # Cleanup old snapshots if needed
        self._cleanup_old_snapshots()

        logger.info(f"Created snapshot {snapshot_id} with {len(records)} records")

        return snapshot

    def get_snapshot(self, snapshot_id: str) -> DataSnapshot | None:
        """
        Get a snapshot by ID.

        Args:
            snapshot_id: Snapshot ID

        Returns:
            DataSnapshot or None
        """
        # Check in-memory first
        if snapshot_id in self._snapshots:
            return self._snapshots[snapshot_id]

        # Try to load from storage
        if self.storage_path:
            return self._load_snapshot(snapshot_id)

        return None

    def list_snapshots(
        self, tags: list[str] | None = None, limit: int = 50
    ) -> list[SnapshotMetadata]:
        """
        List available snapshots.

        Args:
            tags: Filter by tags
            limit: Maximum results

        Returns:
            List of SnapshotMetadata
        """
        metadata_list = list(self._metadata_index.values())

        # Filter by tags
        if tags:
            metadata_list = [m for m in metadata_list if any(t in m.tags for t in tags)]

        # Sort by creation time (newest first)
        metadata_list.sort(key=lambda m: m.created_at, reverse=True)

        return metadata_list[:limit]

    def compare_snapshots(self, from_snapshot_id: str, to_snapshot_id: str) -> SnapshotDiff | None:
        """
        Compare two snapshots.

        Args:
            from_snapshot_id: Earlier snapshot
            to_snapshot_id: Later snapshot

        Returns:
            SnapshotDiff or None
        """
        from_snap = self.get_snapshot(from_snapshot_id)
        to_snap = self.get_snapshot(to_snapshot_id)

        if not from_snap or not to_snap:
            logger.error("One or both snapshots not found")
            return None

        # Find differences
        added = to_snap.record_ids - from_snap.record_ids
        removed = from_snap.record_ids - to_snap.record_ids
        common = from_snap.record_ids & to_snap.record_ids

        # Check for modifications in common records
        modified = []
        for record_id in common:
            from_record = from_snap.get_record(record_id)
            to_record = to_snap.get_record(record_id)
            if from_record and to_record:
                if from_record.get_content_hash() != to_record.get_content_hash():
                    modified.append(record_id)

        summary = {
            "from_count": len(from_snap.records),
            "to_count": len(to_snap.records),
            "added_count": len(added),
            "removed_count": len(removed),
            "modified_count": len(modified),
            "unchanged_count": len(common) - len(modified),
        }

        return SnapshotDiff(
            from_snapshot_id=from_snapshot_id,
            to_snapshot_id=to_snapshot_id,
            added_records=list(added),
            removed_records=list(removed),
            modified_records=modified,
            summary=summary,
        )

    def get_latest_snapshot(self) -> DataSnapshot | None:
        """Get the most recent snapshot."""
        if not self._timeline:
            return None
        return self.get_snapshot(self._timeline[-1])

    def delete_snapshot(self, snapshot_id: str) -> bool:
        """
        Delete a snapshot.

        Args:
            snapshot_id: Snapshot ID

        Returns:
            True if deleted
        """
        if snapshot_id in self._snapshots:
            del self._snapshots[snapshot_id]

        if snapshot_id in self._metadata_index:
            del self._metadata_index[snapshot_id]

        if snapshot_id in self._timeline:
            self._timeline.remove(snapshot_id)

        # Remove from storage
        if self.storage_path:
            snapshot_file = self.storage_path / f"{snapshot_id}.snapshot"
            if snapshot_file.exists():
                snapshot_file.unlink()

        logger.info(f"Deleted snapshot {snapshot_id}")
        return True

    def get_snapshot_lineage(self, snapshot_id: str) -> list[SnapshotMetadata]:
        """
        Get lineage (ancestry) of a snapshot.

        Args:
            snapshot_id: Snapshot ID

        Returns:
            List of ancestor snapshots
        """
        lineage = []
        current_id = snapshot_id

        while current_id:
            metadata = self._metadata_index.get(current_id)
            if metadata:
                lineage.append(metadata)
                current_id = metadata.parent_snapshot_id
            else:
                break

        return lineage

    def _save_snapshot(self, snapshot: DataSnapshot):
        """Save snapshot to storage."""
        if not self.storage_path:
            return

        filename = f"{snapshot.metadata.snapshot_id}.snapshot"
        filepath = self.storage_path / filename

        data = snapshot.to_dict()

        if self.compress:
            with gzip.open(filepath, "wt", encoding="utf-8") as f:
                json.dump(data, f)
        else:
            with open(filepath, "w", encoding="utf-8") as f:
                json.dump(data, f)

    def _load_snapshot(self, snapshot_id: str) -> DataSnapshot | None:
        """Load snapshot from storage."""
        if not self.storage_path:
            return None

        filename = f"{snapshot_id}.snapshot"
        filepath = self.storage_path / filename

        if not filepath.exists():
            return None

        try:
            if self.compress:
                with gzip.open(filepath, "rt", encoding="utf-8") as f:
                    data = json.load(f)
            else:
                with open(filepath, encoding="utf-8") as f:
                    data = json.load(f)

            # Reconstruct snapshot
            metadata = SnapshotMetadata(**data["metadata"])
            records = [LiteratureRecord(**r) for r in data["records"]]

            snapshot = DataSnapshot(
                metadata=metadata, records=records, record_ids=set(data["record_ids"])
            )

            # Cache in memory
            self._snapshots[snapshot_id] = snapshot
            self._metadata_index[snapshot_id] = metadata

            return snapshot

        except Exception as e:
            logger.error(f"Failed to load snapshot {snapshot_id}: {e}")
            return None

    def _cleanup_old_snapshots(self):
        """Remove old snapshots if over limit."""
        while len(self._timeline) > self.max_snapshots:
            oldest_id = self._timeline.pop(0)
            self.delete_snapshot(oldest_id)

    def export_snapshot(self, snapshot_id: str, format: str = "json") -> str | None:
        """
        Export snapshot to string.

        Args:
            snapshot_id: Snapshot ID
            format: Export format (json, csv)

        Returns:
            Exported data string
        """
        snapshot = self.get_snapshot(snapshot_id)
        if not snapshot:
            return None

        if format == "json":
            return json.dumps(snapshot.to_dict(), indent=2)

        elif format == "csv":
            import csv
            import io

            output = io.StringIO()
            writer = csv.writer(output)

            # Header
            writer.writerow(
                [
                    "record_id",
                    "source_type",
                    "title",
                    "authors",
                    "publication_date",
                    "journal",
                    "pmid",
                    "doi",
                ]
            )

            # Data
            for record in snapshot.records:
                writer.writerow(
                    [
                        record.record_id,
                        record.source_type.value,
                        record.title,
                        "; ".join(record.authors),
                        record.publication_date,
                        record.journal,
                        record.pmid,
                        record.doi,
                    ]
                )

            return output.getvalue()

        return None

    def get_statistics(self) -> dict[str, Any]:
        """Get manager statistics."""
        return {
            "total_snapshots": len(self._metadata_index),
            "in_memory": len(self._snapshots),
            "total_records": sum(m.record_count for m in self._metadata_index.values()),
            "storage_path": str(self.storage_path) if self.storage_path else None,
            "max_snapshots": self.max_snapshots,
        }
