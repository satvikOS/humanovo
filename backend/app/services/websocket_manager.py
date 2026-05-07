"""
WebSocket Connection Manager for live pipeline streaming.

Manages WebSocket connections for discovery and synthesis runs.
Handles client connect/disconnect/reconnect with event replay.
"""

import asyncio
import json
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from fastapi import WebSocket, WebSocketDisconnect

from app.core.logging import get_logger

logger = get_logger(__name__)


class DiscoveryConnectionManager:
    """Manages active WebSocket connections for pipeline runs."""

    def __init__(self):
        self._connections: dict[str, WebSocket] = {}  # run_id -> WebSocket
        self._event_logs: dict[str, list[dict]] = {}  # run_id -> list of events (for replay)

    async def connect(self, run_id: str, websocket: WebSocket):
        """Accept a WebSocket connection for a run."""
        await websocket.accept()
        self._connections[run_id] = websocket
        if run_id not in self._event_logs:
            self._event_logs[run_id] = []
        # Replay missed events
        for event in self._event_logs[run_id]:
            try:
                await websocket.send_json(event)
            except Exception:
                break
        logger.info(f"WebSocket connected for run {run_id}")

    async def disconnect(self, run_id: str):
        """Remove a WebSocket connection."""
        self._connections.pop(run_id, None)
        logger.info(f"WebSocket disconnected for run {run_id}")

    async def send_event(self, run_id: str, event: dict):
        """Send an event to the connected client and log it for replay."""
        event["timestamp"] = datetime.now(timezone.utc).isoformat()
        # Always log for replay
        if run_id not in self._event_logs:
            self._event_logs[run_id] = []
        self._event_logs[run_id].append(event)
        # Send if connected
        ws = self._connections.get(run_id)
        if ws:
            try:
                await ws.send_json(event)
            except Exception as e:
                logger.warning(f"Failed to send WS event for {run_id}: {e}")
                self._connections.pop(run_id, None)

    async def send_stage_started(self, run_id: str, stage: str, model: str):
        await self.send_event(run_id, {
            "event": "stage_started", "stage": stage, "model": model
        })

    async def send_stage_completed(self, run_id: str, stage: str, duration_seconds: float,
                                     tokens_in: int, tokens_out: int, cost_cents: int,
                                     grounding_ratio: float = 0.0):
        await self.send_event(run_id, {
            "event": "stage_completed", "stage": stage,
            "duration_seconds": duration_seconds, "tokens_in": tokens_in,
            "tokens_out": tokens_out, "cost_cents": cost_cents,
            "grounding_ratio": grounding_ratio
        })

    async def send_hypothesis_completed(self, run_id: str, hypothesis_index: int,
                                          round_num: int, title: str, confidence_score: float):
        await self.send_event(run_id, {
            "event": "hypothesis_completed", "hypothesis_index": hypothesis_index,
            "round": round_num, "title": title, "confidence_score": confidence_score
        })

    async def send_round_completed(self, run_id: str, round_num: int, hypotheses_in_round: int):
        await self.send_event(run_id, {
            "event": "round_completed", "round": round_num,
            "hypotheses_in_round": hypotheses_in_round
        })

    async def send_cost_update(self, run_id: str, total_cost_cents: int, elapsed_seconds: float):
        await self.send_event(run_id, {
            "event": "cost_update", "total_cost_cents": total_cost_cents,
            "elapsed_seconds": elapsed_seconds
        })

    async def send_run_completed(self, run_id: str, total_hypotheses: int,
                                   best_hypothesis_id: str | None, total_cost_cents: int):
        await self.send_event(run_id, {
            "event": "run_completed", "total_hypotheses": total_hypotheses,
            "best_hypothesis_id": best_hypothesis_id,
            "total_cost_cents": total_cost_cents
        })

    async def send_run_error(self, run_id: str, error: str, recoverable: bool = False):
        await self.send_event(run_id, {
            "event": "run_error", "error": error, "recoverable": recoverable
        })

    async def handle_client_command(self, run_id: str, data: dict) -> str | None:
        """Handle a command from the client."""
        command = data.get("command")
        if command == "cancel":
            return "cancel"
        elif command == "ping":
            ws = self._connections.get(run_id)
            if ws:
                try:
                    await ws.send_json({"event": "pong", "timestamp": datetime.now(timezone.utc).isoformat()})
                except Exception:
                    pass
        return None

    def cleanup_run(self, run_id: str):
        """Remove all data for a completed run."""
        self._connections.pop(run_id, None)
        self._event_logs.pop(run_id, None)


# Global singleton
ws_manager = DiscoveryConnectionManager()
