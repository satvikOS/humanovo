"""
Agent State Management and Checkpointing

Provides persistent state management, checkpointing, and recovery
capabilities for ingestion agents.
"""

import asyncio
import gzip
import hashlib
import json
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import Enum
from pathlib import Path
from typing import Any, Optional, TypeVar
from uuid import UUID, uuid4

from app.agents.ingestion.base import (
    IngestionMetrics,
    IngestionRecord,
    IngestionStatus,
    SourceType,
)
from app.core.logging import get_logger

logger = get_logger(__name__)

T = TypeVar("T")


class CheckpointType(str, Enum):
    """Types of checkpoints."""

    MANUAL = "manual"  # User-triggered checkpoint
    PERIODIC = "periodic"  # Scheduled checkpoint
    MILESTONE = "milestone"  # After significant progress
    ERROR = "error"  # Before error handling
    SHUTDOWN = "shutdown"  # During graceful shutdown


@dataclass
class Checkpoint:
    """A snapshot of agent state at a point in time."""

    checkpoint_id: UUID
    agent_id: UUID
    agent_type: SourceType
    checkpoint_type: CheckpointType
    timestamp: datetime
    state: dict[str, Any]
    metrics: dict[str, Any]
    processed_ids: list[str]
    cursor: str | None  # For pagination/resumption
    metadata: dict[str, Any] = field(default_factory=dict)
    compressed: bool = False
    checksum: str | None = None

    def to_dict(self) -> dict[str, Any]:
        """Convert checkpoint to dictionary."""
        return {
            "checkpoint_id": str(self.checkpoint_id),
            "agent_id": str(self.agent_id),
            "agent_type": self.agent_type.value,
            "checkpoint_type": self.checkpoint_type.value,
            "timestamp": self.timestamp.isoformat(),
            "state": self.state,
            "metrics": self.metrics,
            "processed_ids": self.processed_ids,
            "cursor": self.cursor,
            "metadata": self.metadata,
            "compressed": self.compressed,
            "checksum": self.checksum,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Checkpoint":
        """Create checkpoint from dictionary."""
        return cls(
            checkpoint_id=UUID(data["checkpoint_id"]),
            agent_id=UUID(data["agent_id"]),
            agent_type=SourceType(data["agent_type"]),
            checkpoint_type=CheckpointType(data["checkpoint_type"]),
            timestamp=datetime.fromisoformat(data["timestamp"]),
            state=data["state"],
            metrics=data["metrics"],
            processed_ids=data["processed_ids"],
            cursor=data.get("cursor"),
            metadata=data.get("metadata", {}),
            compressed=data.get("compressed", False),
            checksum=data.get("checksum"),
        )


@dataclass
class AgentStateSnapshot:
    """Complete state snapshot for an agent."""

    agent_id: UUID
    agent_type: SourceType
    status: IngestionStatus
    query: str
    config: dict[str, Any]
    metrics: IngestionMetrics
    records: list[IngestionRecord]
    processed_ids: set
    cursor: str | None
    error_count: int
    last_error: str | None
    started_at: datetime | None
    updated_at: datetime
    checkpoint_version: int = 1


class StateStorage:
    """
    Abstract storage backend for agent state.

    Implementations can use file system, Redis, PostgreSQL, etc.
    """

    async def save(self, key: str, data: bytes) -> None:
        raise NotImplementedError

    async def load(self, key: str) -> bytes | None:
        raise NotImplementedError

    async def delete(self, key: str) -> bool:
        raise NotImplementedError

    async def list_keys(self, prefix: str) -> list[str]:
        raise NotImplementedError

    async def exists(self, key: str) -> bool:
        raise NotImplementedError


class FileStateStorage(StateStorage):
    """File-based state storage."""

    def __init__(self, base_path: str = "/tmp/genup/checkpoints"):
        self.base_path = Path(base_path)
        self.base_path.mkdir(parents=True, exist_ok=True)

    def _key_to_path(self, key: str) -> Path:
        """Convert key to file path."""
        # Sanitize key
        safe_key = key.replace("/", "_").replace("\\", "_")
        return self.base_path / f"{safe_key}.ckpt"

    async def save(self, key: str, data: bytes) -> None:
        """Save data to file."""
        path = self._key_to_path(key)
        path.parent.mkdir(parents=True, exist_ok=True)

        # Write atomically using temp file
        temp_path = path.with_suffix(".tmp")
        with open(temp_path, "wb") as f:
            f.write(data)
        temp_path.rename(path)

    async def load(self, key: str) -> bytes | None:
        """Load data from file."""
        path = self._key_to_path(key)
        if not path.exists():
            return None
        with open(path, "rb") as f:
            return f.read()

    async def delete(self, key: str) -> bool:
        """Delete a file."""
        path = self._key_to_path(key)
        if path.exists():
            path.unlink()
            return True
        return False

    async def list_keys(self, prefix: str) -> list[str]:
        """List all keys with given prefix."""
        keys = []
        safe_prefix = prefix.replace("/", "_").replace("\\", "_")
        for path in self.base_path.glob(f"{safe_prefix}*.ckpt"):
            keys.append(path.stem)
        return keys

    async def exists(self, key: str) -> bool:
        """Check if key exists."""
        return self._key_to_path(key).exists()


class InMemoryStateStorage(StateStorage):
    """In-memory state storage for development/testing."""

    def __init__(self):
        self._storage: dict[str, bytes] = {}

    async def save(self, key: str, data: bytes) -> None:
        self._storage[key] = data

    async def load(self, key: str) -> bytes | None:
        return self._storage.get(key)

    async def delete(self, key: str) -> bool:
        if key in self._storage:
            del self._storage[key]
            return True
        return False

    async def list_keys(self, prefix: str) -> list[str]:
        return [k for k in self._storage.keys() if k.startswith(prefix)]

    async def exists(self, key: str) -> bool:
        return key in self._storage


class AgentStateManager:
    """
    Manages agent state persistence and checkpointing.

    Features:
    - Automatic periodic checkpointing
    - Milestone-based checkpointing
    - State compression
    - Integrity verification with checksums
    - Recovery from checkpoints
    - State versioning
    """

    def __init__(
        self,
        storage: StateStorage | None = None,
        checkpoint_interval_seconds: int = 60,
        max_checkpoints_per_agent: int = 5,
        compress_checkpoints: bool = True,
    ):
        """
        Initialize the state manager.

        Args:
            storage: Storage backend (defaults to file storage)
            checkpoint_interval_seconds: Interval for periodic checkpoints
            max_checkpoints_per_agent: Maximum checkpoints to keep per agent
            compress_checkpoints: Whether to compress checkpoint data
        """
        self.storage = storage or FileStateStorage()
        self.checkpoint_interval = checkpoint_interval_seconds
        self.max_checkpoints = max_checkpoints_per_agent
        self.compress = compress_checkpoints

        # Tracked agents
        self._agents: dict[UUID, AgentStateTracker] = {}

        # Checkpoint scheduling
        self._running = False
        self._checkpoint_task: asyncio.Task | None = None

        # State change listeners
        self._listeners: list[Callable[[UUID, dict[str, Any]], None]] = []

        self.logger = logger

    def track_agent(
        self,
        agent_id: UUID,
        agent_type: SourceType,
        initial_state: dict[str, Any] | None = None,
    ) -> "AgentStateTracker":
        """
        Start tracking an agent's state.

        Args:
            agent_id: Unique agent identifier
            agent_type: Type of ingestion agent
            initial_state: Initial state data

        Returns:
            State tracker for the agent
        """
        tracker = AgentStateTracker(
            agent_id=agent_id,
            agent_type=agent_type,
            manager=self,
            initial_state=initial_state,
        )
        self._agents[agent_id] = tracker

        self.logger.info(
            "Agent tracking started",
            agent_id=str(agent_id),
            agent_type=agent_type.value,
        )

        return tracker

    def untrack_agent(self, agent_id: UUID) -> None:
        """Stop tracking an agent."""
        if agent_id in self._agents:
            del self._agents[agent_id]
            self.logger.info("Agent tracking stopped", agent_id=str(agent_id))

    def get_tracker(self, agent_id: UUID) -> Optional["AgentStateTracker"]:
        """Get the state tracker for an agent."""
        return self._agents.get(agent_id)

    def add_listener(
        self,
        callback: Callable[[UUID, dict[str, Any]], None],
    ) -> None:
        """Add a state change listener."""
        self._listeners.append(callback)

    def _notify_listeners(self, agent_id: UUID, state: dict[str, Any]) -> None:
        """Notify all listeners of state change."""
        for listener in self._listeners:
            try:
                listener(agent_id, state)
            except Exception as e:
                self.logger.error("Listener error", error=str(e))

    def _compute_checksum(self, data: bytes) -> str:
        """Compute SHA-256 checksum of data."""
        return hashlib.sha256(data).hexdigest()

    def _serialize_checkpoint(self, checkpoint: Checkpoint) -> bytes:
        """Serialize checkpoint to bytes."""
        data = json.dumps(checkpoint.to_dict(), default=str).encode("utf-8")

        if self.compress:
            data = gzip.compress(data)

        return data

    def _deserialize_checkpoint(self, data: bytes) -> Checkpoint:
        """Deserialize checkpoint from bytes."""
        # Try decompression
        try:
            data = gzip.decompress(data)
        except gzip.BadGzipFile:
            pass  # Not compressed

        checkpoint_dict = json.loads(data.decode("utf-8"))
        return Checkpoint.from_dict(checkpoint_dict)

    async def create_checkpoint(
        self,
        agent_id: UUID,
        checkpoint_type: CheckpointType = CheckpointType.MANUAL,
        metadata: dict[str, Any] | None = None,
    ) -> Checkpoint | None:
        """
        Create a checkpoint for an agent.

        Args:
            agent_id: Agent to checkpoint
            checkpoint_type: Type of checkpoint
            metadata: Additional metadata

        Returns:
            Created checkpoint or None if agent not found
        """
        tracker = self._agents.get(agent_id)
        if not tracker:
            self.logger.warning("Agent not found for checkpoint", agent_id=str(agent_id))
            return None

        checkpoint = Checkpoint(
            checkpoint_id=uuid4(),
            agent_id=agent_id,
            agent_type=tracker.agent_type,
            checkpoint_type=checkpoint_type,
            timestamp=datetime.now(UTC),
            state=tracker.get_state(),
            metrics=tracker.get_metrics(),
            processed_ids=list(tracker.processed_ids),
            cursor=tracker.cursor,
            metadata=metadata or {},
            compressed=self.compress,
        )

        # Serialize and compute checksum
        data = self._serialize_checkpoint(checkpoint)
        checkpoint.checksum = self._compute_checksum(data)

        # Save to storage
        key = f"agent_{agent_id}_{checkpoint.checkpoint_id}"
        await self.storage.save(key, data)

        # Cleanup old checkpoints
        await self._cleanup_old_checkpoints(agent_id)

        self.logger.info(
            "Checkpoint created",
            agent_id=str(agent_id),
            checkpoint_id=str(checkpoint.checkpoint_id),
            checkpoint_type=checkpoint_type.value,
        )

        return checkpoint

    async def restore_checkpoint(
        self,
        agent_id: UUID,
        checkpoint_id: UUID | None = None,
    ) -> Checkpoint | None:
        """
        Restore an agent from a checkpoint.

        Args:
            agent_id: Agent to restore
            checkpoint_id: Specific checkpoint to restore (latest if None)

        Returns:
            Restored checkpoint or None if not found
        """
        if checkpoint_id:
            key = f"agent_{agent_id}_{checkpoint_id}"
            data = await self.storage.load(key)
        else:
            # Find latest checkpoint
            keys = await self.storage.list_keys(f"agent_{agent_id}_")
            if not keys:
                self.logger.warning("No checkpoints found", agent_id=str(agent_id))
                return None

            # Load all and find latest
            latest_checkpoint = None
            latest_time = datetime.min

            for key in keys:
                data = await self.storage.load(key)
                if data:
                    checkpoint = self._deserialize_checkpoint(data)
                    if checkpoint.timestamp > latest_time:
                        latest_time = checkpoint.timestamp
                        latest_checkpoint = checkpoint

            if not latest_checkpoint:
                return None

            # Verify checksum
            checkpoint_data = self._serialize_checkpoint(latest_checkpoint)
            expected_checksum = self._compute_checksum(checkpoint_data)
            if latest_checkpoint.checksum and latest_checkpoint.checksum != expected_checksum:
                self.logger.error(
                    "Checkpoint checksum mismatch",
                    checkpoint_id=str(latest_checkpoint.checkpoint_id),
                )

            return latest_checkpoint

        if not data:
            return None

        checkpoint = self._deserialize_checkpoint(data)

        # Restore tracker state
        if agent_id in self._agents:
            tracker = self._agents[agent_id]
            tracker.restore_from_checkpoint(checkpoint)
        else:
            # Create new tracker with checkpoint state
            tracker = AgentStateTracker(
                agent_id=agent_id,
                agent_type=checkpoint.agent_type,
                manager=self,
                initial_state=checkpoint.state,
            )
            tracker.restore_from_checkpoint(checkpoint)
            self._agents[agent_id] = tracker

        self.logger.info(
            "Checkpoint restored",
            agent_id=str(agent_id),
            checkpoint_id=str(checkpoint.checkpoint_id),
        )

        return checkpoint

    async def list_checkpoints(self, agent_id: UUID) -> list[dict[str, Any]]:
        """List all checkpoints for an agent."""
        keys = await self.storage.list_keys(f"agent_{agent_id}_")
        checkpoints = []

        for key in keys:
            data = await self.storage.load(key)
            if data:
                checkpoint = self._deserialize_checkpoint(data)
                checkpoints.append(
                    {
                        "checkpoint_id": str(checkpoint.checkpoint_id),
                        "checkpoint_type": checkpoint.checkpoint_type.value,
                        "timestamp": checkpoint.timestamp.isoformat(),
                        "cursor": checkpoint.cursor,
                        "processed_count": len(checkpoint.processed_ids),
                    }
                )

        # Sort by timestamp descending
        checkpoints.sort(key=lambda x: x["timestamp"], reverse=True)

        return checkpoints

    async def delete_checkpoint(self, agent_id: UUID, checkpoint_id: UUID) -> bool:
        """Delete a specific checkpoint."""
        key = f"agent_{agent_id}_{checkpoint_id}"
        return await self.storage.delete(key)

    async def _cleanup_old_checkpoints(self, agent_id: UUID) -> None:
        """Remove old checkpoints beyond the maximum limit."""
        keys = await self.storage.list_keys(f"agent_{agent_id}_")

        if len(keys) <= self.max_checkpoints:
            return

        # Load checkpoints to sort by timestamp
        checkpoints_with_keys = []
        for key in keys:
            data = await self.storage.load(key)
            if data:
                checkpoint = self._deserialize_checkpoint(data)
                checkpoints_with_keys.append((checkpoint.timestamp, key))

        # Sort by timestamp descending and remove oldest
        checkpoints_with_keys.sort(key=lambda x: x[0], reverse=True)

        for _, key in checkpoints_with_keys[self.max_checkpoints :]:
            await self.storage.delete(key)
            self.logger.debug("Old checkpoint deleted", key=key)

    async def start_periodic_checkpointing(self) -> None:
        """Start periodic checkpointing."""
        if self._running:
            return

        self._running = True
        self._checkpoint_task = asyncio.create_task(self._periodic_checkpoint_loop())
        self.logger.info(
            "Periodic checkpointing started",
            interval_seconds=self.checkpoint_interval,
        )

    async def stop_periodic_checkpointing(self) -> None:
        """Stop periodic checkpointing."""
        self._running = False
        if self._checkpoint_task:
            self._checkpoint_task.cancel()
            try:
                await self._checkpoint_task
            except asyncio.CancelledError:
                pass
        self.logger.info("Periodic checkpointing stopped")

    async def _periodic_checkpoint_loop(self) -> None:
        """Periodic checkpoint creation loop."""
        while self._running:
            try:
                await asyncio.sleep(self.checkpoint_interval)

                # Create checkpoints for all tracked agents
                for agent_id in list(self._agents.keys()):
                    tracker = self._agents.get(agent_id)
                    if tracker and tracker.should_checkpoint():
                        await self.create_checkpoint(
                            agent_id,
                            CheckpointType.PERIODIC,
                        )

            except asyncio.CancelledError:
                break
            except Exception as e:
                self.logger.error("Periodic checkpoint error", error=str(e))

    async def shutdown(self) -> None:
        """Graceful shutdown with final checkpoints."""
        self.logger.info("State manager shutting down")

        # Stop periodic checkpointing
        await self.stop_periodic_checkpointing()

        # Create shutdown checkpoints for all agents
        for agent_id in list(self._agents.keys()):
            try:
                await self.create_checkpoint(agent_id, CheckpointType.SHUTDOWN)
            except Exception as e:
                self.logger.error(
                    "Shutdown checkpoint failed",
                    agent_id=str(agent_id),
                    error=str(e),
                )


class AgentStateTracker:
    """
    Tracks state for a single agent.

    Provides transactional state updates and dirty tracking.
    """

    def __init__(
        self,
        agent_id: UUID,
        agent_type: SourceType,
        manager: AgentStateManager,
        initial_state: dict[str, Any] | None = None,
    ):
        self.agent_id = agent_id
        self.agent_type = agent_type
        self.manager = manager

        # State
        self._state: dict[str, Any] = initial_state or {}
        self._metrics: dict[str, Any] = {}
        self.processed_ids: set = set()
        self.cursor: str | None = None

        # Tracking
        self._dirty = False
        self._last_checkpoint_time: datetime | None = None
        self._changes_since_checkpoint = 0

        self.logger = logger

    def get_state(self) -> dict[str, Any]:
        """Get current state."""
        return self._state.copy()

    def get_metrics(self) -> dict[str, Any]:
        """Get current metrics."""
        return self._metrics.copy()

    def update_state(self, updates: dict[str, Any]) -> None:
        """Update state with new values."""
        self._state.update(updates)
        self._dirty = True
        self._changes_since_checkpoint += 1
        self.manager._notify_listeners(self.agent_id, self._state)

    def set_status(self, status: IngestionStatus) -> None:
        """Update agent status."""
        self._state["status"] = status.value
        self._dirty = True

    def update_metrics(self, metrics: dict[str, Any]) -> None:
        """Update metrics."""
        self._metrics.update(metrics)

    def mark_processed(self, record_id: str) -> None:
        """Mark a record as processed."""
        self.processed_ids.add(record_id)
        self._changes_since_checkpoint += 1

    def is_processed(self, record_id: str) -> bool:
        """Check if a record has been processed."""
        return record_id in self.processed_ids

    def update_cursor(self, cursor: str) -> None:
        """Update pagination cursor."""
        self.cursor = cursor
        self._dirty = True

    def should_checkpoint(self) -> bool:
        """Determine if a checkpoint should be created."""
        # Checkpoint if dirty and enough changes
        if not self._dirty:
            return False

        if self._changes_since_checkpoint >= 100:
            return True

        return False

    def restore_from_checkpoint(self, checkpoint: Checkpoint) -> None:
        """Restore state from a checkpoint."""
        self._state = checkpoint.state
        self._metrics = checkpoint.metrics
        self.processed_ids = set(checkpoint.processed_ids)
        self.cursor = checkpoint.cursor
        self._dirty = False
        self._changes_since_checkpoint = 0
        self._last_checkpoint_time = checkpoint.timestamp

        self.logger.info(
            "State restored from checkpoint",
            agent_id=str(self.agent_id),
            processed_count=len(self.processed_ids),
        )

    def checkpoint_completed(self) -> None:
        """Mark that a checkpoint was completed."""
        self._dirty = False
        self._changes_since_checkpoint = 0
        self._last_checkpoint_time = datetime.now(UTC)


class TransactionalStateUpdate:
    """
    Context manager for transactional state updates.

    Allows rollback if an error occurs during processing.
    """

    def __init__(self, tracker: AgentStateTracker):
        self.tracker = tracker
        self._original_state: dict[str, Any] = {}
        self._original_metrics: dict[str, Any] = {}
        self._original_processed: set = set()
        self._original_cursor: str | None = None

    async def __aenter__(self) -> "TransactionalStateUpdate":
        """Capture original state."""
        self._original_state = self.tracker.get_state()
        self._original_metrics = self.tracker.get_metrics()
        self._original_processed = self.tracker.processed_ids.copy()
        self._original_cursor = self.tracker.cursor
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb) -> bool:
        """Rollback on error."""
        if exc_type is not None:
            # Rollback
            self.tracker._state = self._original_state
            self.tracker._metrics = self._original_metrics
            self.tracker.processed_ids = self._original_processed
            self.tracker.cursor = self._original_cursor

            logger.warning(
                "State rolled back due to error",
                agent_id=str(self.tracker.agent_id),
                error=str(exc_val),
            )

        return False  # Don't suppress exceptions


# Global state manager instance
_state_manager: AgentStateManager | None = None


def get_state_manager() -> AgentStateManager:
    """Get the global state manager instance."""
    global _state_manager
    if _state_manager is None:
        _state_manager = AgentStateManager()
    return _state_manager


async def initialize_state_manager() -> AgentStateManager:
    """Initialize and start the state manager."""
    manager = get_state_manager()
    await manager.start_periodic_checkpointing()
    return manager


async def shutdown_state_manager() -> None:
    """Shutdown the state manager gracefully."""
    global _state_manager
    if _state_manager:
        await _state_manager.shutdown()
