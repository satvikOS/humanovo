"""Crash reporter + opt-in telemetry ingestion endpoints.

Two surfaces the desktop app posts into:

  POST /api/v1/telemetry/crash
    Captured ALWAYS (crash = bug to fix, not usage stat). Bounded
    payload (8 KB max for stack + 16 KB for context JSON), schema-
    validated. Returns 201; the response body is empty so a slow
    network during a crash doesn't surface in the crash-handler's
    own retry loop.

  POST /api/v1/telemetry/event
    Captured ONLY when current_user.telemetry_opt_in is TRUE.
    Drops to 202 No Content silently when opt-out so the client
    doesn't need to know the user's flag — it just sends, server
    decides. Per-call rate-limited to prevent runaway emission.

Privacy commitment:
  • Telemetry events drop silently when telemetry_opt_in=FALSE.
  • Crash reports are kept (HIPAA-grade scrubbing happens client-
    side; the server enforces size caps but doesn't replicate the
    PII scrub).
  • Both tables prune after 90 days via a cron (follow-on).
"""
from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user
from app.core.database import get_db
from app.core.rate_limit import rate_limit
from app.models.user import User


logger = logging.getLogger(__name__)
router = APIRouter()


STACK_CAP_BYTES = 8 * 1024
CONTEXT_CAP_BYTES = 16 * 1024
EVENT_PAYLOAD_CAP_BYTES = 4 * 1024


class CrashReport(BaseModel):
    app_version: str = Field(max_length=32)
    platform: str = Field(max_length=32)
    origin: str = Field(max_length=32, description="renderer | native | background")
    error_name: str = Field(max_length=200)
    error_message: str = Field(max_length=2000)
    stack_text: str
    context: dict[str, Any] | None = None


class TelemetryEvent(BaseModel):
    kind: str = Field(max_length=64)
    payload: dict[str, Any] = Field(default_factory=dict)
    app_version: str | None = Field(default=None, max_length=32)
    platform: str | None = Field(default=None, max_length=32)


@router.post(
    "/telemetry/crash",
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(rate_limit("telemetry"))],
)
async def post_crash_report(
    body: CrashReport,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User | None = Depends(get_current_user),
) -> dict[str, Any]:
    """Capture an unhandled-exception / native-crash event.

    Authenticated when possible (attaches user_id) but NOT required —
    crashes during the pre-login flow still post. Size caps enforced
    on stack + context so a malicious client can't dump arbitrary
    state into our DB."""
    import json

    # Hard size cap on stack — clip silently rather than 413 so the
    # crash handler doesn't have a circular failure path.
    stack = body.stack_text[:STACK_CAP_BYTES]
    context_json = None
    if body.context is not None:
        ctx_str = json.dumps(body.context, default=str)
        if len(ctx_str) > CONTEXT_CAP_BYTES:
            # Drop context entirely rather than partial-corrupt JSON.
            context_json = {"_truncated": True, "_original_size_bytes": len(ctx_str)}
        else:
            context_json = body.context

    client_ip = request.client.host if request.client else None

    await db.execute(
        text(
            """
            INSERT INTO crash_reports
                (user_id, app_version, platform, origin,
                 error_name, error_message, stack_text, context, client_ip)
            VALUES
                (:uid, :ver, :plat, :origin,
                 :name, :msg, :stack, CAST(:ctx AS JSONB), :ip)
            """
        ),
        {
            "uid": str(current_user.id) if current_user else None,
            "ver": body.app_version,
            "plat": body.platform,
            "origin": body.origin,
            "name": body.error_name,
            "msg": body.error_message,
            "stack": stack,
            "ctx": json.dumps(context_json) if context_json else None,
            "ip": client_ip,
        },
    )
    await db.commit()
    logger.info(
        "crash_report origin=%s platform=%s version=%s error=%s",
        body.origin, body.platform, body.app_version, body.error_name,
    )
    return {"status": "captured"}


@router.post(
    "/telemetry/event",
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(rate_limit("telemetry"))],
)
async def post_telemetry_event(
    body: TelemetryEvent,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """Capture an opt-in usage telemetry event.

    Drops silently (returns 202 but doesn't persist) when the user
    has not opted in. Client doesn't need to check the flag — server
    is the single source of truth so toggling telemetry off takes
    effect on the NEXT event, no client restart needed.

    Auth is required (unlike crash reports) — anonymous telemetry
    would be untraceable to a user's opt-in flag, so we reject
    pre-login events at the schema layer."""
    if not current_user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required for telemetry events.",
        )

    if not bool(getattr(current_user, "telemetry_opt_in", False)):
        # Silent drop. The 202 status code conveys "I heard you,
        # I won't act on it" — semantically correct for opt-out.
        return {"status": "dropped_opt_out"}

    # Bound payload size — a misbehaving client emitting a large
    # blob shouldn't be able to bloat the table.
    import json
    payload_str = json.dumps(body.payload, default=str)
    if len(payload_str) > EVENT_PAYLOAD_CAP_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=(
                f"Telemetry payload exceeds {EVENT_PAYLOAD_CAP_BYTES} bytes. "
                f"Reduce or split into multiple events."
            ),
        )

    await db.execute(
        text(
            """
            INSERT INTO telemetry_events
                (user_id, kind, payload, app_version, platform)
            VALUES
                (:uid, :kind, CAST(:payload AS JSONB), :ver, :plat)
            """
        ),
        {
            "uid": str(current_user.id),
            "kind": body.kind,
            "payload": payload_str,
            "ver": body.app_version,
            "plat": body.platform,
        },
    )
    await db.commit()
    return {"status": "captured"}
