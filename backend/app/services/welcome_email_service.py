"""Welcome email sent once when a user registers.

Goals for the message:
  • Confirm the account is live.
  • Anchor the 14-day trial window so the user knows what they have.
  • Two next-step links: dashboard + docs.

Idempotency: dedup_key = `<user_id>:welcome`. The signup endpoint
schedules this via BackgroundTasks, so a transient driver failure
just leaves email_sends.ok=False and the dedup row blocks future
retries — but the auth.create_user call already succeeded, so the
account is fine. We accept the trade-off: a one-shot welcome that
occasionally needs a manual re-send beats a retry storm that double-
mails a slow SMTP recovery.
"""
from __future__ import annotations

import logging
from typing import Any
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


logger = logging.getLogger(__name__)


TEMPLATE_KEY = "welcome.signup"


async def _has_already_sent(db: AsyncSession, *, dedup_key: str) -> bool:
    row = (await db.execute(
        text("SELECT 1 FROM email_sends WHERE dedup_key = :k LIMIT 1"),
        {"k": dedup_key},
    )).first()
    return row is not None


async def _record_send(
    db: AsyncSession,
    *,
    user_id: UUID | str,
    template_key: str,
    dedup_key: str,
    driver: str,
    ok: bool,
) -> None:
    await db.execute(
        text(
            """
            INSERT INTO email_sends
                (user_id, template_key, dedup_key, driver, ok)
            VALUES (:uid, :tpl, :dk, :drv, :ok)
            ON CONFLICT (dedup_key) DO NOTHING
            """
        ),
        {
            "uid": str(user_id),
            "tpl": template_key,
            "dk": dedup_key,
            "drv": driver,
            "ok": ok,
        },
    )


def _render(*, full_name: str | None, trial_days: int = 14) -> tuple[str, str, str]:
    """Returns (subject, text_body, html_body). Pure function — easy
    to unit-test the rendered content without touching the driver."""
    display_name = (full_name or "researcher").split()[0]
    subject = "Welcome to humanovo — your 14-day trial is live"

    text_body = (
        f"Hi {display_name},\n\n"
        f"Your humanovo account is ready. You're on a {trial_days}-day "
        "free trial — every feature is unlocked, no credit card needed.\n\n"
        "A few good first steps:\n\n"
        "  1. Open the dashboard: https://app.humanovo.net\n"
        "  2. Read the quick-start guide: https://humanovo.net/docs/quickstart\n"
        "  3. Bring in your first dataset: https://app.humanovo.net/data\n\n"
        "When the trial ends we'll send you a heads-up at day 11. No "
        "automatic charges — you choose whether to convert.\n\n"
        "Reply to this email anytime if you get stuck or want to share "
        "what you're working on.\n\n"
        "— the humanovo team\n"
    )
    html_body = (
        "<div style='font-family:Inter,system-ui,sans-serif;"
        "max-width:560px;margin:0 auto;color:#1a1a1a'>"
        f"<h2 style='font-weight:600'>Welcome to humanovo, {display_name}</h2>"
        f"<p>Your account is ready. You're on a <strong>{trial_days}-day "
        "free trial</strong> — every feature is unlocked, no credit card "
        "needed.</p>"
        "<p><strong>A few good first steps:</strong></p>"
        "<ol>"
        '<li><a href="https://app.humanovo.net">Open the dashboard</a></li>'
        '<li><a href="https://humanovo.net/docs/quickstart">Read the quick-start guide</a></li>'
        '<li><a href="https://app.humanovo.net/data">Bring in your first dataset</a></li>'
        "</ol>"
        "<p>We'll send a heads-up at day 11 before the trial ends — "
        "no automatic charges.</p>"
        "<p style='margin-top:24px;color:#555'>Reply anytime if you "
        "get stuck.<br/>— the humanovo team</p>"
        "</div>"
    )
    return subject, text_body, html_body


async def send_welcome_email(
    db: AsyncSession,
    *,
    user_id: UUID | str,
    user_email: str,
    full_name: str | None,
    trial_days: int = 14,
) -> dict[str, Any]:
    """Send the one-shot welcome. Returns {status, user_id}; never
    raises — a failure logs + marks ok=False in email_sends but does
    NOT propagate (the signup that scheduled us already succeeded)."""
    dedup_key = f"{user_id}:welcome"
    if await _has_already_sent(db, dedup_key=dedup_key):
        return {"status": "skipped_duplicate", "user_id": str(user_id)}

    subject, text_body, html_body = _render(
        full_name=full_name, trial_days=trial_days,
    )

    from app.services.email_service import get_email_driver
    driver = get_email_driver()
    driver_name = type(driver).__name__.replace("Driver", "").lower()
    try:
        ok = await driver.send_email(
            to=user_email, subject=subject,
            html=html_body, text=text_body,
        )
    except Exception as e:
        logger.warning(
            "welcome send_email raised user_id=%s: %s", user_id, e,
        )
        ok = False

    await _record_send(
        db,
        user_id=user_id, template_key=TEMPLATE_KEY,
        dedup_key=dedup_key, driver=driver_name, ok=ok,
    )
    await db.commit()
    return {
        "status": "sent" if ok else "send_failed",
        "user_id": str(user_id),
    }
