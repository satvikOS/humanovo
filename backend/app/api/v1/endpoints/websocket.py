"""
WebSocket API Endpoints

Real-time communication for live updates on agents, simulations, and more.
"""

import json
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import authenticate_websocket
from app.core.database import get_db
from app.core.logging import get_logger

logger = get_logger(__name__)
router = APIRouter()


class ConnectionManager:
    """Manages WebSocket connections and message broadcasting."""

    def __init__(self):
        # Active connections by channel
        self.active_connections: dict[str, set[WebSocket]] = {}
        # Connection metadata
        self.connection_metadata: dict[WebSocket, dict[str, Any]] = {}

    async def connect(
        self,
        websocket: WebSocket,
        channel: str,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        """Accept a new WebSocket connection."""
        await websocket.accept()

        if channel not in self.active_connections:
            self.active_connections[channel] = set()

        self.active_connections[channel].add(websocket)
        self.connection_metadata[websocket] = metadata or {}

        logger.info(
            "WebSocket connected",
            channel=channel,
            total_connections=len(self.active_connections[channel]),
        )

    def disconnect(self, websocket: WebSocket, channel: str) -> None:
        """Remove a WebSocket connection."""
        if channel in self.active_connections:
            self.active_connections[channel].discard(websocket)

            if not self.active_connections[channel]:
                del self.active_connections[channel]

        self.connection_metadata.pop(websocket, None)

        logger.info("WebSocket disconnected", channel=channel)

    async def send_personal(self, websocket: WebSocket, message: dict[str, Any]) -> None:
        """Send a message to a specific connection."""
        try:
            await websocket.send_json(message)
        except Exception as e:
            logger.error("Failed to send message", error=str(e))

    async def broadcast(self, channel: str, message: dict[str, Any]) -> None:
        """Broadcast a message to all connections in a channel."""
        if channel not in self.active_connections:
            return

        disconnected = []
        for connection in self.active_connections[channel]:
            try:
                await connection.send_json(message)
            except Exception:
                disconnected.append(connection)

        # Clean up disconnected clients
        for conn in disconnected:
            self.disconnect(conn, channel)

    def get_channel_count(self, channel: str) -> int:
        """Get number of connections in a channel."""
        return len(self.active_connections.get(channel, set()))


# Global connection manager
manager = ConnectionManager()


class WSMessage(BaseModel):
    """WebSocket message format."""

    type: str
    payload: dict[str, Any]
    timestamp: datetime = None

    def __init__(self, **data):
        if "timestamp" not in data:
            data["timestamp"] = datetime.now(UTC)
        super().__init__(**data)


@router.websocket("/projects/{project_id}")
async def project_websocket(
    websocket: WebSocket,
    project_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> None:
    """WebSocket for project-level updates.

    Receives updates about:
    - New hypotheses generated
    - New evidence discovered
    - Agent task progress
    - Simulation progress
    """
    user = await authenticate_websocket(websocket, db)
    if user is None:
        return
    channel = f"project:{project_id}"
    await manager.connect(websocket, channel, {"project_id": str(project_id), "user_id": str(user.id)})

    try:
        # Send connection confirmation
        await manager.send_personal(
            websocket,
            WSMessage(
                type="connected",
                payload={"channel": channel, "project_id": str(project_id)},
            ).model_dump(mode="json"),
        )

        while True:
            # Receive messages from client
            data = await websocket.receive_text()
            message = json.loads(data)

            # Handle client messages
            if message.get("type") == "ping":
                await manager.send_personal(
                    websocket,
                    WSMessage(type="pong", payload={}).model_dump(mode="json"),
                )
            elif message.get("type") == "subscribe":
                # Handle additional subscriptions within project
                sub_channel = message.get("payload", {}).get("channel")
                logger.info("Client subscribed to sub-channel", sub_channel=sub_channel)

    except WebSocketDisconnect:
        manager.disconnect(websocket, channel)


@router.websocket("/tasks/{task_id}")
async def task_websocket(
    websocket: WebSocket,
    task_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> None:
    """WebSocket for tracking a specific agent task.

    Receives real-time updates on:
    - Task progress
    - Agent steps and actions
    - Intermediate results
    - Completion or failure
    """
    user = await authenticate_websocket(websocket, db)
    if user is None:
        return
    channel = f"task:{task_id}"
    await manager.connect(websocket, channel, {"task_id": str(task_id), "user_id": str(user.id)})

    try:
        await manager.send_personal(
            websocket,
            WSMessage(
                type="connected",
                payload={"channel": channel, "task_id": str(task_id)},
            ).model_dump(mode="json"),
        )

        while True:
            data = await websocket.receive_text()
            message = json.loads(data)

            if message.get("type") == "ping":
                await manager.send_personal(
                    websocket,
                    WSMessage(type="pong", payload={}).model_dump(mode="json"),
                )

    except WebSocketDisconnect:
        manager.disconnect(websocket, channel)


@router.websocket("/simulations/{simulation_id}")
async def simulation_websocket(
    websocket: WebSocket,
    simulation_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> None:
    """WebSocket for tracking simulation progress.

    Receives real-time updates on:
    - Iteration progress
    - Intermediate statistics
    - Completion or failure
    """
    user = await authenticate_websocket(websocket, db)
    if user is None:
        return
    channel = f"simulation:{simulation_id}"
    await manager.connect(websocket, channel, {"simulation_id": str(simulation_id), "user_id": str(user.id)})

    try:
        await manager.send_personal(
            websocket,
            WSMessage(
                type="connected",
                payload={"channel": channel, "simulation_id": str(simulation_id)},
            ).model_dump(mode="json"),
        )

        while True:
            data = await websocket.receive_text()
            message = json.loads(data)

            if message.get("type") == "ping":
                await manager.send_personal(
                    websocket,
                    WSMessage(type="pong", payload={}).model_dump(mode="json"),
                )

    except WebSocketDisconnect:
        manager.disconnect(websocket, channel)


@router.websocket("/global")
async def global_websocket(
    websocket: WebSocket,
    db: AsyncSession = Depends(get_db),
) -> None:
    """WebSocket for global system updates.

    Receives updates about:
    - System status
    - Ingestion pipeline progress
    - Knowledge graph updates
    """
    user = await authenticate_websocket(websocket, db)
    if user is None:
        return
    channel = "global"
    await manager.connect(websocket, channel, {"user_id": str(user.id)})

    try:
        await manager.send_personal(
            websocket,
            WSMessage(
                type="connected",
                payload={"channel": channel},
            ).model_dump(mode="json"),
        )

        while True:
            data = await websocket.receive_text()
            message = json.loads(data)

            if message.get("type") == "ping":
                await manager.send_personal(
                    websocket,
                    WSMessage(type="pong", payload={}).model_dump(mode="json"),
                )

    except WebSocketDisconnect:
        manager.disconnect(websocket, channel)


# Helper functions for broadcasting from other modules


async def broadcast_task_update(task_id: UUID, update: dict[str, Any]) -> None:
    """Broadcast an update for a specific task."""
    channel = f"task:{task_id}"
    await manager.broadcast(
        channel,
        WSMessage(type="task_update", payload=update).model_dump(mode="json"),
    )


async def broadcast_simulation_update(simulation_id: UUID, update: dict[str, Any]) -> None:
    """Broadcast an update for a specific simulation."""
    channel = f"simulation:{simulation_id}"
    await manager.broadcast(
        channel,
        WSMessage(type="simulation_update", payload=update).model_dump(mode="json"),
    )


async def broadcast_project_update(project_id: UUID, update: dict[str, Any]) -> None:
    """Broadcast an update for a specific project."""
    channel = f"project:{project_id}"
    await manager.broadcast(
        channel,
        WSMessage(type="project_update", payload=update).model_dump(mode="json"),
    )


async def broadcast_global_update(update: dict[str, Any]) -> None:
    """Broadcast a global system update."""
    await manager.broadcast(
        "global",
        WSMessage(type="global_update", payload=update).model_dump(mode="json"),
    )
