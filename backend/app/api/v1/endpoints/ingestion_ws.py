"""
Ingestion WebSocket Endpoints

Real-time updates for ingestion progress, agent status, and indexing events.
"""

import asyncio
import json
from datetime import datetime
from typing import Any
from uuid import UUID

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.core.logging import get_logger

logger = get_logger(__name__)
router = APIRouter()


class IngestionWSManager:
    """
    Manages WebSocket connections for ingestion updates.

    Handles:
    - Job-specific progress updates
    - Global ingestion events
    - Agent status changes
    - Indexing notifications
    """

    def __init__(self):
        # Active connections by channel
        self.job_connections: dict[UUID, set[WebSocket]] = {}
        self.global_connections: set[WebSocket] = set()
        self.agent_connections: dict[str, set[WebSocket]] = {}

        # Event buffers for replay
        self._event_buffer: dict[UUID, list[dict]] = {}
        self._max_buffer_size = 100

    async def connect_job(self, websocket: WebSocket, job_id: UUID) -> None:
        """Connect to a specific job's updates."""
        await websocket.accept()

        if job_id not in self.job_connections:
            self.job_connections[job_id] = set()

        self.job_connections[job_id].add(websocket)

        logger.info(
            "WebSocket connected to job",
            job_id=str(job_id),
            connections=len(self.job_connections[job_id]),
        )

        # Send connection confirmation
        await websocket.send_json(
            {
                "type": "connected",
                "job_id": str(job_id),
                "timestamp": datetime.utcnow().isoformat(),
            }
        )

        # Replay buffered events
        if job_id in self._event_buffer:
            for event in self._event_buffer[job_id]:
                await websocket.send_json(event)

    async def connect_global(self, websocket: WebSocket) -> None:
        """Connect to global ingestion updates."""
        await websocket.accept()
        self.global_connections.add(websocket)

        logger.info(
            "WebSocket connected to global",
            connections=len(self.global_connections),
        )

        await websocket.send_json(
            {
                "type": "connected",
                "channel": "global",
                "timestamp": datetime.utcnow().isoformat(),
            }
        )

    async def connect_agent(self, websocket: WebSocket, agent_type: str) -> None:
        """Connect to a specific agent's updates."""
        await websocket.accept()

        if agent_type not in self.agent_connections:
            self.agent_connections[agent_type] = set()

        self.agent_connections[agent_type].add(websocket)

        logger.info(
            "WebSocket connected to agent",
            agent_type=agent_type,
            connections=len(self.agent_connections[agent_type]),
        )

        await websocket.send_json(
            {
                "type": "connected",
                "agent_type": agent_type,
                "timestamp": datetime.utcnow().isoformat(),
            }
        )

    def disconnect_job(self, websocket: WebSocket, job_id: UUID) -> None:
        """Disconnect from a job's updates."""
        if job_id in self.job_connections:
            self.job_connections[job_id].discard(websocket)
            if not self.job_connections[job_id]:
                del self.job_connections[job_id]
        logger.info("WebSocket disconnected from job", job_id=str(job_id))

    def disconnect_global(self, websocket: WebSocket) -> None:
        """Disconnect from global updates."""
        self.global_connections.discard(websocket)
        logger.info("WebSocket disconnected from global")

    def disconnect_agent(self, websocket: WebSocket, agent_type: str) -> None:
        """Disconnect from an agent's updates."""
        if agent_type in self.agent_connections:
            self.agent_connections[agent_type].discard(websocket)
            if not self.agent_connections[agent_type]:
                del self.agent_connections[agent_type]
        logger.info("WebSocket disconnected from agent", agent_type=agent_type)

    async def broadcast_job_update(self, job_id: UUID, update: dict[str, Any]) -> None:
        """Broadcast update to all connections watching a job."""
        event = {
            "type": "job_update",
            "job_id": str(job_id),
            "timestamp": datetime.utcnow().isoformat(),
            **update,
        }

        # Buffer event
        if job_id not in self._event_buffer:
            self._event_buffer[job_id] = []
        self._event_buffer[job_id].append(event)
        if len(self._event_buffer[job_id]) > self._max_buffer_size:
            self._event_buffer[job_id].pop(0)

        # Send to job subscribers
        if job_id in self.job_connections:
            disconnected = []
            for ws in self.job_connections[job_id]:
                try:
                    await ws.send_json(event)
                except Exception:
                    disconnected.append(ws)

            for ws in disconnected:
                self.disconnect_job(ws, job_id)

        # Also send to global subscribers
        await self.broadcast_global(
            {
                "type": "job_progress",
                "job_id": str(job_id),
                **update,
            }
        )

    async def broadcast_global(self, update: dict[str, Any]) -> None:
        """Broadcast update to all global connections."""
        event = {
            "timestamp": datetime.utcnow().isoformat(),
            **update,
        }

        disconnected = []
        for ws in self.global_connections:
            try:
                await ws.send_json(event)
            except Exception:
                disconnected.append(ws)

        for ws in disconnected:
            self.disconnect_global(ws)

    async def broadcast_agent_update(self, agent_type: str, update: dict[str, Any]) -> None:
        """Broadcast update to connections watching an agent."""
        event = {
            "type": "agent_update",
            "agent_type": agent_type,
            "timestamp": datetime.utcnow().isoformat(),
            **update,
        }

        if agent_type in self.agent_connections:
            disconnected = []
            for ws in self.agent_connections[agent_type]:
                try:
                    await ws.send_json(event)
                except Exception:
                    disconnected.append(ws)

            for ws in disconnected:
                self.disconnect_agent(ws, agent_type)

    async def send_progress_update(
        self,
        job_id: UUID,
        status: str,
        progress: float,
        records_fetched: int,
        records_processed: int,
        records_indexed: int,
        current_source: str | None = None,
        message: str | None = None,
    ) -> None:
        """Send a structured progress update."""
        await self.broadcast_job_update(
            job_id,
            {
                "status": status,
                "progress": progress,
                "metrics": {
                    "records_fetched": records_fetched,
                    "records_processed": records_processed,
                    "records_indexed": records_indexed,
                },
                "current_source": current_source,
                "message": message,
            },
        )

    async def send_record_indexed(
        self,
        job_id: UUID,
        record_id: str,
        source_type: str,
        title: str | None = None,
    ) -> None:
        """Send notification when a record is indexed."""
        await self.broadcast_job_update(
            job_id,
            {
                "event": "record_indexed",
                "record_id": record_id,
                "source_type": source_type,
                "title": title,
            },
        )

    async def send_entity_extracted(
        self,
        job_id: UUID,
        entity_text: str,
        entity_type: str,
        confidence: float,
    ) -> None:
        """Send notification when an entity is extracted."""
        await self.broadcast_job_update(
            job_id,
            {
                "event": "entity_extracted",
                "entity": {
                    "text": entity_text,
                    "type": entity_type,
                    "confidence": confidence,
                },
            },
        )

    async def send_error(
        self,
        job_id: UUID,
        error: str,
        source: str | None = None,
        recoverable: bool = True,
    ) -> None:
        """Send error notification."""
        await self.broadcast_job_update(
            job_id,
            {
                "event": "error",
                "error": error,
                "source": source,
                "recoverable": recoverable,
            },
        )

    async def send_job_completed(
        self,
        job_id: UUID,
        metrics: dict[str, Any],
        duration_seconds: float,
    ) -> None:
        """Send job completion notification."""
        await self.broadcast_job_update(
            job_id,
            {
                "event": "completed",
                "status": "completed",
                "progress": 1.0,
                "metrics": metrics,
                "duration_seconds": duration_seconds,
            },
        )

        # Clean up buffer after a delay
        asyncio.create_task(self._cleanup_buffer(job_id, delay=300))

    async def _cleanup_buffer(self, job_id: UUID, delay: int = 300) -> None:
        """Clean up event buffer after delay."""
        await asyncio.sleep(delay)
        self._event_buffer.pop(job_id, None)

    def get_stats(self) -> dict[str, Any]:
        """Get connection statistics."""
        return {
            "global_connections": len(self.global_connections),
            "job_connections": {str(k): len(v) for k, v in self.job_connections.items()},
            "agent_connections": {k: len(v) for k, v in self.agent_connections.items()},
            "buffered_jobs": len(self._event_buffer),
        }


# Global manager instance
manager = IngestionWSManager()


@router.websocket("/jobs/{job_id}")
async def job_websocket(
    websocket: WebSocket,
    job_id: UUID,
) -> None:
    """
    WebSocket for tracking a specific ingestion job.

    Receives real-time updates on:
    - Job progress (records fetched, processed, indexed)
    - Current processing source
    - Extracted entities and relations
    - Errors and warnings
    - Completion status
    """
    await manager.connect_job(websocket, job_id)

    try:
        while True:
            # Receive messages from client
            data = await websocket.receive_text()
            message = json.loads(data)

            # Handle client messages
            if message.get("type") == "ping":
                await websocket.send_json(
                    {
                        "type": "pong",
                        "timestamp": datetime.utcnow().isoformat(),
                    }
                )
            elif message.get("type") == "subscribe_entities":
                # Client wants entity extraction updates
                pass  # Already included in job updates
            elif message.get("type") == "get_status":
                # Client requests current status
                from app.api.v1.endpoints.ingestion import _ingestion_jobs

                if job_id in _ingestion_jobs:
                    await websocket.send_json(
                        {
                            "type": "status",
                            "job": _ingestion_jobs[job_id],
                        }
                    )

    except WebSocketDisconnect:
        manager.disconnect_job(websocket, job_id)


@router.websocket("/global")
async def global_ingestion_websocket(
    websocket: WebSocket,
) -> None:
    """
    WebSocket for global ingestion updates.

    Receives updates on:
    - All active ingestion jobs
    - System-wide indexing events
    - Agent status changes
    - Queue statistics
    """
    await manager.connect_global(websocket)

    try:
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)

            if message.get("type") == "ping":
                await websocket.send_json(
                    {
                        "type": "pong",
                        "timestamp": datetime.utcnow().isoformat(),
                    }
                )
            elif message.get("type") == "get_stats":
                from app.api.v1.endpoints.ingestion import _ingestion_jobs

                running_jobs = [j for j in _ingestion_jobs.values() if j["status"] == "running"]

                await websocket.send_json(
                    {
                        "type": "stats",
                        "active_jobs": len(running_jobs),
                        "connection_stats": manager.get_stats(),
                    }
                )

    except WebSocketDisconnect:
        manager.disconnect_global(websocket)


@router.websocket("/agents/{agent_type}")
async def agent_websocket(
    websocket: WebSocket,
    agent_type: str,
) -> None:
    """
    WebSocket for tracking a specific agent type.

    Receives updates on:
    - Agent status changes
    - Processing events
    - Rate limit status
    - Error counts
    """
    await manager.connect_agent(websocket, agent_type)

    try:
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)

            if message.get("type") == "ping":
                await websocket.send_json(
                    {
                        "type": "pong",
                        "timestamp": datetime.utcnow().isoformat(),
                    }
                )

    except WebSocketDisconnect:
        manager.disconnect_agent(websocket, agent_type)


# Helper functions for broadcasting from other modules


async def broadcast_ingestion_progress(
    job_id: UUID,
    status: str,
    progress: float,
    metrics: dict[str, int],
    current_source: str | None = None,
) -> None:
    """Broadcast ingestion progress update."""
    await manager.send_progress_update(
        job_id=job_id,
        status=status,
        progress=progress,
        records_fetched=metrics.get("records_fetched", 0),
        records_processed=metrics.get("records_processed", 0),
        records_indexed=metrics.get("records_indexed", 0),
        current_source=current_source,
    )


async def broadcast_ingestion_complete(
    job_id: UUID,
    metrics: dict[str, Any],
    duration_seconds: float,
) -> None:
    """Broadcast ingestion completion."""
    await manager.send_job_completed(job_id, metrics, duration_seconds)


async def broadcast_ingestion_error(
    job_id: UUID,
    error: str,
    source: str | None = None,
) -> None:
    """Broadcast ingestion error."""
    await manager.send_error(job_id, error, source)


async def broadcast_agent_status_change(
    agent_type: str,
    status: str,
    details: dict[str, Any] | None = None,
) -> None:
    """Broadcast agent status change."""
    await manager.broadcast_agent_update(
        agent_type,
        {
            "status": status,
            "details": details or {},
        },
    )


def get_ws_manager() -> IngestionWSManager:
    """Get the global WebSocket manager."""
    return manager
