"""Dunning service — past_due subscription email cadence.

Surface: `run_dunning_cycle(db)` — meant to be called daily from a
cron / scheduled job. It:

  1. Finds users whose LATEST transition is `past_due` (i.e. they
     have NOT recovered to active or been canceled since).
  2. For each, computes days_since_lapse from `transition_at`.
  3. Dispatches the cadence email matching that day bucket via
     `email_service.send_email`, deduped via `email_sends` table.
  4. Returns a structured summary the cron logs.

Cadence:
  • Day 3  — first warning ("We couldn't process your last payment")
  • Day 7  — second warning ("Your access is about to be downgraded")
  • Day 14 — final notice ("Account downgraded today; one-click
              recovery link inside")

A user who recovers (latest transition becomes `active` / `trialing`
again) stops getting dunning emails automatically — the query no
longer returns them. A user who churns past day-14 likewise drops
out (their tier is now trial; latest transition is `canceled`).
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


logger = logging.getLogger(__name__)


# Day buckets → (template_key, subject line, body). Body is the
# minimal text version; HTML follows the same pattern. Operators can
# override the copy via a future templating layer; for now the
# fall-through default is good enough for paid launch.
CADENCE: list[tuple[int, str, str]] = [
    (3, "dunning.day_3",
     "We couldn't process your last humanovo payment"),
    (7, "dunning.day_7",
     "Your humanovo access will downgrade in 7 days"),
    (14, "dunning.day_14_final",
     "Final notice: humanovo subscription is being downgraded today"),
]


@dataclass
class DunningResult:
    users_evaluated: int
    emails_sent: int
    emails_skipped_already_sent: int
    emails_failed: int


def _bucket_for_days(days: int) -> tuple[str, str] | None:
    """Return (template_key, subject) for the day-bucket, or None
    if `days` doesn't match a cadence step (e.g. day 5 — between
    day-3 and day-7 — no email today)."""
    for day, key, subject in CADENCE:
        if days == day:
            return key, subject
    return None


def _email_body(template_key: str, user_email: str) -> tuple[str, str]:
    """Return (text, html). Minimal copy; operators can override via
    a future templating system without touching this module."""
    if template_key == "dunning.day_3":
        text_body = (
            "Hi,\n\n"
            "We couldn't process the last payment on your humanovo "
            "subscription. Most often this is a temporary card "
            "decline or an expired card on file.\n\n"
            "Update your billing details from your account:\n"
            "https://app.humanovo.net/account/billing\n\n"
            "If you've already updated your card, you can ignore "
            "this email — we'll retry the charge automatically.\n"
        )
    elif template_key == "dunning.day_7":
        text_body = (
            "Hi,\n\n"
            "It's been a week since the last payment on your "
            "humanovo subscription failed. To avoid losing access "
            "to your projects, please update your billing details "
            "in the next 7 days:\n\n"
            "https://app.humanovo.net/account/billing\n\n"
            "After day 14, the subscription will downgrade to the "
            "free tier and ongoing discovery runs will be paused.\n"
        )
    else:  # dunning.day_14_final
        text_body = (
            "Hi,\n\n"
            "Your humanovo subscription has been downgraded to the "
            "free tier today because the payment on file couldn't "
            "be processed.\n\n"
            "Your data is still here — to restore your tier and "
            "continue your discoveries, update your billing:\n\n"
            "https://app.humanovo.net/account/billing\n"
        )
    # HTML version: thin wrapper around the text. Operators wanting
    # branded HTML can override at the email service layer.
    html_body = (
        "<div style='font-family:Inter,system-ui,sans-serif;"
        "max-width:560px;margin:0 auto'>"
        f"<pre style='white-space:pre-wrap;font-family:inherit'>"
        f"{text_body}</pre>"
        "</div>"
    )
    return text_body, html_body


async def _has_already_sent(
    db: AsyncSession, *, dedup_key: str,
) -> bool:
    row = (await db.execute(
        text("SELECT 1 FROM email_sends WHERE dedup_key = :k LIMIT 1"),
        {"k": dedup_key},
    )).first()
    return row is not None


async def _record_send(
    db: AsyncSession,
    *,
    user_id: UUID,
    template_key: str,
    dedup_key: str,
    driver: str,
    ok: bool,
) -> None:
    """Idempotent insert. ON CONFLICT DO NOTHING on dedup_key so a
    race between two cron instances doesn't insert twice."""
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


async def run_dunning_cycle(db: AsyncSession) -> DunningResult:
    """Daily entry point. Iterates past_due users, fires the matching
    cadence email when one is due."""
    # CTE-style query: for each user, find their LATEST transition,
    # filter to those still in past_due. Joining `users` for email +
    # active flag (don't dunn disabled users).
    rows = (await db.execute(
        text(
            """
            WITH latest AS (
                SELECT DISTINCT ON (st.user_id)
                       st.user_id, st.to_status, st.transition_at
                FROM subscription_transitions st
                ORDER BY st.user_id, st.transition_at DESC
            )
            SELECT l.user_id, l.transition_at, u.email
            FROM latest l
            JOIN users u ON u.id = l.user_id
            WHERE l.to_status = 'past_due'
              AND u.is_active = TRUE
              AND u.deleted_at IS NULL
            """
        ),
    )).all()

    now = datetime.now(UTC)
    evaluated = 0
    sent = 0
    skipped = 0
    failed = 0

    # Import the driver lazily — keeps the dunning service runnable
    # in environments where the email driver isn't configured (CI
    # smoke, dev where SES isn't wired). The default log-only driver
    # always returns True.
    from app.services.email_service import get_email_driver
    driver = get_email_driver()
    driver_name = type(driver).__name__.replace("Driver", "").lower()

    for user_id, transition_at, email in rows:
        evaluated += 1
        days = (now - transition_at).days
        bucket = _bucket_for_days(days)
        if bucket is None:
            continue  # not a cadence-trigger day

        template_key, subject = bucket
        # dedup_key includes the lapse-date so a SECOND lapse for the
        # same user (after a recovery + re-lapse) gets a fresh email
        # cycle. transition_at.date() captures the day the lapse
        # began.
        lapse_date = transition_at.date().isoformat()
        dedup_key = f"{user_id}:{template_key}:{lapse_date}"

        if await _has_already_sent(db, dedup_key=dedup_key):
            skipped += 1
            continue

        text_body, html_body = _email_body(template_key, email)
        try:
            ok = await driver.send_email(
                to=email,
                subject=subject,
                html=html_body,
                text=text_body,
            )
            if ok:
                sent += 1
            else:
                failed += 1
        except Exception as e:
            logger.warning(
                "dunning send_email raised for user_id=%s template=%s: %s",
                user_id, template_key, e,
            )
            ok = False
            failed += 1

        # Record the attempt either way — a False record prevents
        # the cron from retrying every minute, and surfaces the
        # failed-send count in monitoring.
        await _record_send(
            db,
            user_id=user_id,
            template_key=template_key,
            dedup_key=dedup_key,
            driver=driver_name,
            ok=ok,
        )

    await db.commit()
    logger.info(
        "dunning cycle complete evaluated=%d sent=%d skipped=%d failed=%d",
        evaluated, sent, skipped, failed,
    )
    return DunningResult(
        users_evaluated=evaluated,
        emails_sent=sent,
        emails_skipped_already_sent=skipped,
        emails_failed=failed,
    )
