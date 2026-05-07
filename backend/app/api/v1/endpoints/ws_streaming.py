"""
WebSocket Streaming for Discovery and Synthesis Runs.

Endpoints:
  ws://host/ws/discovery/{run_id}
  ws://host/ws/synthesis/{run_id}

Server -> Client events:
  stage_started, stage_completed, hypothesis_completed, round_completed,
  cost_update, run_completed, run_error, db_sweep

Client -> Server commands:
  cancel, ping
"""

import asyncio
import time
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import authenticate_websocket
from app.core.database import get_db
from app.core.logging import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/ws", tags=["websocket-streaming"])


class RunStreamManager:
    """Manages WebSocket connections for real-time discovery/synthesis streaming."""

    def __init__(self):
        self._connections: dict[str, list[WebSocket]] = {}
        self._cancel_flags: dict[str, bool] = {}
        self._last_activity: dict[str, float] = {}

    async def connect(self, run_id: str, websocket: WebSocket):
        """Accept and register a WebSocket connection for a run."""
        await websocket.accept()
        if run_id not in self._connections:
            self._connections[run_id] = []
        self._connections[run_id].append(websocket)
        self._last_activity[run_id] = time.time()
        logger.info(f"WebSocket connected for run {run_id} ({len(self._connections[run_id])} clients)")

    def disconnect(self, run_id: str, websocket: WebSocket):
        """Remove a WebSocket connection."""
        if run_id in self._connections:
            if websocket in self._connections[run_id]:
                self._connections[run_id].remove(websocket)
            if not self._connections[run_id]:
                del self._connections[run_id]
        logger.info(f"WebSocket disconnected for run {run_id}")

    async def broadcast(self, run_id: str, event: dict[str, Any]):
        """Broadcast an event to all clients connected to a run."""
        if run_id not in self._connections:
            return

        self._last_activity[run_id] = time.time()
        dead_connections = []

        for ws in self._connections[run_id]:
            try:
                await ws.send_json(event)
            except Exception:
                dead_connections.append(ws)

        for ws in dead_connections:
            self._connections[run_id].remove(ws)

    def request_cancel(self, run_id: str):
        """Set cancellation flag for a run."""
        self._cancel_flags[run_id] = True

    def is_cancelled(self, run_id: str) -> bool:
        """Check if a run has been cancelled via WebSocket."""
        return self._cancel_flags.get(run_id, False)

    def get_client_count(self, run_id: str) -> int:
        """Get number of connected clients for a run."""
        return len(self._connections.get(run_id, []))

    async def handle_client_message(self, run_id: str, data: dict[str, Any], websocket: WebSocket):
        """Handle a message from a client."""
        command = data.get("command", "")

        if command == "ping":
            await websocket.send_json({
                "event": "pong",
                "run_id": run_id,
                "timestamp": datetime.now(UTC).isoformat(),
            })
        elif command == "cancel":
            self.request_cancel(run_id)
            await self.broadcast(run_id, {
                "event": "run_cancelling",
                "run_id": run_id,
                "timestamp": datetime.now(UTC).isoformat(),
            })
            # Also cancel via the Platform API run tracker
            try:
                from app.api.v1.endpoints.platform_api import _active_discovery_runs
                run = _active_discovery_runs.get(run_id)
                if run:
                    orchestrator = run.get("orchestrator")
                    if orchestrator and hasattr(orchestrator, "stop"):
                        orchestrator.stop()
                        run["status"] = "cancelled"
            except Exception:
                pass

    def cleanup_idle(self, max_idle_seconds: int = 300):
        """Remove connections idle for too long."""
        now = time.time()
        idle_runs = [
            run_id for run_id, last in self._last_activity.items()
            if now - last > max_idle_seconds
        ]
        for run_id in idle_runs:
            if run_id in self._connections:
                del self._connections[run_id]
            if run_id in self._last_activity:
                del self._last_activity[run_id]
            if run_id in self._cancel_flags:
                del self._cancel_flags[run_id]


# Singleton
_stream_manager: RunStreamManager | None = None


def get_stream_manager() -> RunStreamManager:
    """Get the global stream manager singleton."""
    global _stream_manager
    if _stream_manager is None:
        _stream_manager = RunStreamManager()
    return _stream_manager


@router.websocket("/discovery/{run_id}")
async def discovery_ws(
    websocket: WebSocket,
    run_id: str,
    db: AsyncSession = Depends(get_db),
):
    """WebSocket endpoint for real-time discovery run updates."""
    user = await authenticate_websocket(websocket, db)
    if user is None:
        return
    manager = get_stream_manager()
    await manager.connect(run_id, websocket)

    try:
        while True:
            try:
                data = await asyncio.wait_for(websocket.receive_json(), timeout=300)
                await manager.handle_client_message(run_id, data, websocket)
            except TimeoutError:
                # Send keepalive ping
                try:
                    await websocket.send_json({
                        "event": "keepalive",
                        "run_id": run_id,
                        "timestamp": datetime.now(UTC).isoformat(),
                    })
                except Exception:
                    break
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.warning(f"WebSocket error for discovery run {run_id}: {e}")
    finally:
        manager.disconnect(run_id, websocket)


@router.websocket("/synthesis/{run_id}")
async def synthesis_ws(
    websocket: WebSocket,
    run_id: str,
    db: AsyncSession = Depends(get_db),
):
    """WebSocket endpoint for real-time synthesis run updates."""
    user = await authenticate_websocket(websocket, db)
    if user is None:
        return
    manager = get_stream_manager()
    await manager.connect(run_id, websocket)

    try:
        while True:
            try:
                data = await asyncio.wait_for(websocket.receive_json(), timeout=300)
                await manager.handle_client_message(run_id, data, websocket)
            except TimeoutError:
                try:
                    await websocket.send_json({
                        "event": "keepalive",
                        "run_id": run_id,
                        "timestamp": datetime.now(UTC).isoformat(),
                    })
                except Exception:
                    break
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.warning(f"WebSocket error for synthesis run {run_id}: {e}")
    finally:
        manager.disconnect(run_id, websocket)
