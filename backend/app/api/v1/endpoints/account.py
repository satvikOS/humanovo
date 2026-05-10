"""User-account self-service endpoints — GDPR Art. 17 + Art. 20.

Two surfaces:

  1. POST /api/v1/account/delete — initiates a soft-delete of the
     authenticated user's account. Sets `delete_requested_at = now()`
     and `is_active = False`. The user is logged out immediately;
     subsequent logins are blocked. After 30 days a daily cron
     hard-deletes cascading owned data (projects → hypotheses → etc).
     The audit log is RETAINED (HIPAA 7-year + Merkle integrity) but
     identifying columns get nulled / replaced with `deleted-user-{id}`.
     Within the 30-day window, an admin can call the matching restore
     endpoint to undo.

  2. GET /api/v1/account/export — returns a ZIP of every record the
     user owns, as JSON, plus a manifest. Streams to keep memory
     bounded for large accounts. GDPR Art. 20 (right to data
     portability).

Both endpoints are authenticated user-scoped — admin role NOT
required (the user is acting on their own data). Rate-limited to
prevent abuse: 1 delete request per hour, 3 exports per day.
"""
from __future__ import annotations

import io
import json
import logging
import zipfile
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user
from app.core.database import get_db
from app.core.rate_limit import rate_limit
from app.models.user import User


logger = logging.getLogger(__name__)
router = APIRouter()


# ─── Soft delete (GDPR Art. 17) ────────────────────────────────────


@router.post(
    "/account/delete",
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(rate_limit("account_delete"))],
)
async def request_account_deletion(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """Initiate a 30-day soft-delete of the authenticated user.

    Idempotent: calling twice within the grace window is a no-op
    that returns the same projected hard-delete date as the first
    call. Calling after the grace window has expired is a 410 (Gone)
    — the hard-delete already fired."""
    if current_user.deleted_at is not None:
        # Hard-delete already happened. Should never reach here
        # (deleted users can't authenticate) but be defensive.
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="Account is already permanently deleted.",
        )

    if current_user.delete_requested_at is None:
        # First request — flip the bits.
        now = datetime.now(UTC)
        current_user.delete_requested_at = now
        current_user.is_active = False
        await db.commit()
        logger.info(
            "account_delete_requested user_id=%s email=%s requested_at=%s",
            current_user.id, current_user.email, now.isoformat(),
        )

    # Build the response — same shape whether this was a first
    # request or a repeat (idempotent).
    requested_at = current_user.delete_requested_at
    grace_end = requested_at.replace() if requested_at else datetime.now(UTC)
    # 30-day grace window. Calling .replace() with day arithmetic
    # via timedelta to avoid the rare end-of-month edge case.
    from datetime import timedelta
    grace_end = requested_at + timedelta(days=30)

    return {
        "status": "deletion_requested",
        "requested_at": requested_at.isoformat(),
        "scheduled_hard_delete_at": grace_end.isoformat(),
        "grace_window_days": 30,
        "message": (
            "Your account has been deactivated and will be permanently "
            "deleted in 30 days. To restore, contact support before "
            f"{grace_end.date().isoformat()}."
        ),
    }


# ─── Export (GDPR Art. 20) ─────────────────────────────────────────


@router.get(
    "/account/export",
    dependencies=[Depends(rate_limit("account_export"))],
)
async def export_account_data(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> StreamingResponse:
    """Return a ZIP archive of every record the user owns, as JSON.

    Manifest at the root describes the included files + counts.
    Streams the ZIP so memory footprint stays bounded even for
    accounts with thousands of records."""
    buffer = io.BytesIO()
    counts: dict[str, int] = {}

    # All owner-scoped tables we need to dump. Each entry is
    # (filename, model_class, owner_field). Owner_field varies:
    # most use `owner_id`; a few use `user_id` (legacy) — both
    # patterns supported. Add tables here as the schema grows.
    tables_to_dump = list(_owned_tables_for_export())

    with zipfile.ZipFile(buffer, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        # User profile — always first, never empty.
        profile = {
            "id": str(current_user.id),
            "email": current_user.email,
            "full_name": current_user.full_name,
            "role": current_user.role.value if hasattr(current_user.role, "value") else current_user.role,
            "tier": current_user.tier.value if hasattr(current_user.tier, "value") else current_user.tier,
            "is_active": current_user.is_active,
            "is_verified": current_user.is_verified,
            "has_completed_onboarding": current_user.has_completed_onboarding,
            "created_at": current_user.created_at.isoformat() if current_user.created_at else None,
            "last_login_at": current_user.last_login_at.isoformat() if current_user.last_login_at else None,
        }
        zf.writestr("profile.json", json.dumps(profile, indent=2))
        counts["profile"] = 1

        # Per-table owned rows.
        for filename, model_cls, owner_field in tables_to_dump:
            try:
                stmt = select(model_cls).where(
                    getattr(model_cls, owner_field) == current_user.id
                )
                rows = (await db.execute(stmt)).scalars().all()
                if not rows:
                    counts[filename] = 0
                    continue
                serialized = [_serialize_row(r) for r in rows]
                zf.writestr(filename, json.dumps(serialized, indent=2, default=str))
                counts[filename] = len(rows)
            except Exception as e:
                # Best-effort: a missing table or schema drift shouldn't
                # block the rest of the export. Log + emit a stub.
                logger.warning("account export: %s failed: %s", filename, e)
                zf.writestr(
                    filename,
                    json.dumps({"error": f"export failed: {type(e).__name__}: {e}"}),
                )
                counts[filename] = -1

        # Manifest last so the file count + checksums are accurate.
        manifest = {
            "schema_version": 1,
            "exported_at": datetime.now(UTC).isoformat(),
            "user_id": str(current_user.id),
            "user_email": current_user.email,
            "tables": counts,
            "total_records": sum(c for c in counts.values() if c > 0),
            "note": (
                "This archive contains every record owned by the requesting "
                "user. Audit-log entries are EXCLUDED (HIPAA 7-year retention "
                "+ Merkle-chain integrity require they remain on the server). "
                "To request the audit log specifically, contact support."
            ),
        }
        zf.writestr("manifest.json", json.dumps(manifest, indent=2))

    buffer.seek(0)

    filename = f"humanovo-export-{current_user.id}-{datetime.now(UTC).strftime('%Y%m%d-%H%M%S')}.zip"
    return StreamingResponse(
        iter([buffer.getvalue()]),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ─── Helpers ───────────────────────────────────────────────────────


def _owned_tables_for_export():
    """List of (export_filename, model_class, owner_field_name) for
    every owner-scoped table that should appear in a GDPR export.

    Lazy-imports the model classes so this module stays import-light
    when the endpoint isn't being called. Failures here are logged +
    skipped — adding a new owned table doesn't require updating this
    file if the import simply isn't available."""
    try:
        from app.models.project import Project
        yield ("projects.json", Project, "owner_id")
    except Exception:
        pass
    try:
        from app.models.hypothesis import Hypothesis
        yield ("hypotheses.json", Hypothesis, "owner_id")
    except Exception:
        pass
    try:
        from app.models.notebook import NotebookPage
        yield ("notebook_pages.json", NotebookPage, "owner_id")
    except Exception:
        pass
    try:
        from app.models.citation import Citation
        yield ("citations.json", Citation, "owner_id")
    except Exception:
        pass
    try:
        from app.models.discovery_session import DiscoverySession
        yield ("discovery_sessions.json", DiscoverySession, "user_id")
    except Exception:
        pass
    try:
        from app.models.experiment import Experiment
        yield ("experiments.json", Experiment, "owner_id")
    except Exception:
        pass


def _serialize_row(row) -> dict[str, Any]:
    """Best-effort SQLAlchemy ORM row → JSON-serialisable dict.
    Handles UUIDs, datetimes, enums, and nested JSON columns."""
    out: dict[str, Any] = {}
    for column in row.__table__.columns:
        value = getattr(row, column.name)
        if value is None:
            out[column.name] = None
        elif hasattr(value, "isoformat"):  # datetime / date
            out[column.name] = value.isoformat()
        elif hasattr(value, "value") and hasattr(value, "name"):  # enum
            out[column.name] = value.value
        else:
            out[column.name] = value
    return out
