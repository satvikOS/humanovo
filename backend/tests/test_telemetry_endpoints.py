"""Unit tests for /api/v1/telemetry endpoints.

Locks in the privacy contract:
  • Crash reports captured ALWAYS (no opt-in check)
  • Telemetry events captured ONLY when current_user.telemetry_opt_in=TRUE
  • Opted-out telemetry returns 202 silently (no insert, no error)
  • Anonymous telemetry rejected with 401
  • Oversized stack / context truncated, not 413'd (crash handler
    has no useful recovery from a 413)
  • Oversized telemetry payload IS 413'd (client should chunk)
"""
from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from app.api.v1.endpoints.telemetry import (
    CrashReport,
    EVENT_PAYLOAD_CAP_BYTES,
    STACK_CAP_BYTES,
    TelemetryEvent,
    post_crash_report,
    post_telemetry_event,
)


def _user(*, opt_in: bool = False):
    return SimpleNamespace(id=uuid4(), telemetry_opt_in=opt_in)


def _request(ip: str = "127.0.0.1"):
    req = SimpleNamespace()
    req.client = SimpleNamespace(host=ip)
    return req


def _db():
    db = MagicMock()
    db.execute = AsyncMock()
    db.commit = AsyncMock()
    return db


def _crash_payload(**overrides):
    base = dict(
        app_version="1.0.0",
        platform="windows-x64",
        origin="renderer",
        error_name="TypeError",
        error_message="undefined is not a function",
        stack_text="TypeError: ...\n  at foo (bar.js:1)\n",
        context={"last_route": "/dashboard"},
    )
    base.update(overrides)
    return CrashReport(**base)


@pytest.mark.asyncio
async def test_crash_report_captured_for_authenticated_user():
    db = _db()
    out = await post_crash_report(
        body=_crash_payload(),
        request=_request(),
        db=db,
        current_user=_user(),
    )
    assert out["status"] == "captured"
    db.execute.assert_called_once()
    db.commit.assert_called_once()


@pytest.mark.asyncio
async def test_crash_report_captured_for_unauthenticated_user():
    """Crashes during pre-login still post. user_id NULL in DB."""
    db = _db()
    out = await post_crash_report(
        body=_crash_payload(),
        request=_request(),
        db=db,
        current_user=None,
    )
    assert out["status"] == "captured"
    bound = db.execute.call_args.args[1]
    assert bound["uid"] is None


@pytest.mark.asyncio
async def test_crash_report_truncates_oversized_stack_silently():
    """A crash handler retrying because of a 413 would spin forever.
    Better: clip the stack and capture what we can."""
    db = _db()
    huge_stack = "x" * (STACK_CAP_BYTES * 2)
    await post_crash_report(
        body=_crash_payload(stack_text=huge_stack),
        request=_request(),
        db=db,
        current_user=_user(),
    )
    bound = db.execute.call_args.args[1]
    assert len(bound["stack"]) == STACK_CAP_BYTES


@pytest.mark.asyncio
async def test_crash_report_drops_oversized_context_to_truncated_marker():
    """Same rationale as stack — never 413 a crash. Context is
    replaced with a marker rather than partial-JSON corruption."""
    import json

    db = _db()
    huge_context = {"big": "x" * 50_000}
    await post_crash_report(
        body=_crash_payload(context=huge_context),
        request=_request(),
        db=db,
        current_user=_user(),
    )
    bound = db.execute.call_args.args[1]
    ctx = json.loads(bound["ctx"])
    assert ctx.get("_truncated") is True


@pytest.mark.asyncio
async def test_telemetry_event_dropped_when_opt_out():
    """The privacy contract: opt-out users emit but server silently
    drops. The 202 lets the client move on without retry."""
    db = _db()
    out = await post_telemetry_event(
        body=TelemetryEvent(kind="page_view", payload={"path": "/dashboard"}),
        db=db,
        current_user=_user(opt_in=False),
    )
    assert out["status"] == "dropped_opt_out"
    db.execute.assert_not_called()
    db.commit.assert_not_called()


@pytest.mark.asyncio
async def test_telemetry_event_captured_when_opt_in():
    db = _db()
    out = await post_telemetry_event(
        body=TelemetryEvent(
            kind="discovery_started", payload={"disease": "ovarian"},
            app_version="1.0.0", platform="windows-x64",
        ),
        db=db,
        current_user=_user(opt_in=True),
    )
    assert out["status"] == "captured"
    db.execute.assert_called_once()
    bound = db.execute.call_args.args[1]
    assert bound["kind"] == "discovery_started"


@pytest.mark.asyncio
async def test_telemetry_event_rejects_unauthenticated_with_401():
    from fastapi import HTTPException

    db = _db()
    with pytest.raises(HTTPException) as exc:
        await post_telemetry_event(
            body=TelemetryEvent(kind="x", payload={}),
            db=db,
            current_user=None,
        )
    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_telemetry_event_oversized_payload_returns_413():
    """Telemetry IS rate-limited size-wise — client should chunk.
    Distinct from the crash path where we don't 413 ever."""
    from fastapi import HTTPException

    db = _db()
    huge_payload = {"data": "x" * (EVENT_PAYLOAD_CAP_BYTES * 2)}
    with pytest.raises(HTTPException) as exc:
        await post_telemetry_event(
            body=TelemetryEvent(kind="big_event", payload=huge_payload),
            db=db,
            current_user=_user(opt_in=True),
        )
    assert exc.value.status_code == 413
