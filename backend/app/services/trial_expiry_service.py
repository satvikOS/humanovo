"""Trial expiry service — 14-day free-trial cadence.

Surface: `run_trial_expiry_cycle(db)` — meant to run daily. It:

  1. Finds users whose `trial_ends_at` is in (3 days from now, OR
     past now() — i.e. either approaching or already expired).
  2. Day-3 warning email → "Your trial ends in 3 days; upgrade
     to keep your projects".
  3. Day-of expiry → flips tier to TRIAL (free), records a
     subscription_transition for audit chain, sends the "trial
     expired" email with upgrade CTA, nulls trial_ends_at so the
     cron doesn't re-fire next run.

Same email_sends dedup pattern as dunning (Phase 2.6). Dedup key
includes trial_ends_at date so a user who restarts a trial later
(operator override) gets a fresh email cycle.

Recovery semantics: a user who upgrades during their trial has
their `trial_ends_at` set to NULL by the Stripe checkout webhook
(checkout.session.completed → apply_checkout_completed, follow-on
to wire). They drop out of this cron's query.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


logger = logging.getLogger(__name__)


WARNING_DAYS_BEFORE = 3
EXPIRY_DOWNGRADE_TIER = "trial"  # match UserTier.TRIAL.value


@dataclass
class TrialExpiryResult:
    users_evaluated: int
    warnings_sent: int
    expirations_processed: int
    emails_skipped_already_sent: int
    emails_failed: int


async def _has_already_sent(db: AsyncSession, *, dedup_key: str) -> bool:
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


def _warning_email_body(user_email: str, days_remaining: int) -> tuple[str, str]:
    text_body = (
        "Hi,\n\n"
        f"Your humanovo trial ends in {days_remaining} days. After "
        "that, you'll be downgraded to the free tier with reduced "
        "monthly discovery limits.\n\n"
        "Upgrade now to keep your current tier and ongoing projects:\n\n"
        "https://app.humanovo.net/account/billing\n\n"
        "Your data stays — only the tier changes.\n"
    )
    html_body = (
        "<div style='font-family:Inter,system-ui,sans-serif;"
        "max-width:560px;margin:0 auto'>"
        f"<pre style='white-space:pre-wrap;font-family:inherit'>"
        f"{text_body}</pre>"
        "</div>"
    )
    return text_body, html_body


def _expired_email_body(user_email: str) -> tuple[str, str]:
    text_body = (
        "Hi,\n\n"
        "Your humanovo trial ended today. Your account has been "
        "downgraded to the free tier — your data and projects are "
        "all still here.\n\n"
        "To restore your tier, upgrade now:\n\n"
        "https://app.humanovo.net/account/billing\n"
    )
    html_body = (
        "<div style='font-family:Inter,system-ui,sans-serif;"
        "max-width:560px;margin:0 auto'>"
        f"<pre style='white-space:pre-wrap;font-family:inherit'>"
        f"{text_body}</pre>"
        "</div>"
    )
    return text_body, html_body


async def _send_one(
    db: AsyncSession,
    *,
    user_id: UUID,
    user_email: str,
    template_key: str,
    dedup_key: str,
    subject: str,
    text_body: str,
    html_body: str,
    driver_name: str,
    driver,
) -> bool:
    """Returns True if the email was sent successfully (or already
    sent — short-circuit OK). False on a real send failure."""
    if await _has_already_sent(db, dedup_key=dedup_key):
        return True  # treat as "already done"
    try:
        ok = await driver.send_email(
            to=user_email, subject=subject,
            html=html_body, text=text_body,
        )
    except Exception as e:
        logger.warning(
            "trial_expiry send_email raised user_id=%s template=%s: %s",
            user_id, template_key, e,
        )
        ok = False
    await _record_send(
        db,
        user_id=user_id, template_key=template_key,
        dedup_key=dedup_key, driver=driver_name, ok=ok,
    )
    return ok


async def run_trial_expiry_cycle(db: AsyncSession) -> TrialExpiryResult:
    """Daily entry. Two passes:

      1. Warning pass: users whose trial expires in
         WARNING_DAYS_BEFORE days (window: ±12 hours so the cron
         catches them whichever side of midnight today is on).
      2. Expiry pass: users whose trial has expired (trial_ends_at
         < now()) and is_active. Downgrade + email + null
         trial_ends_at."""
    now = datetime.now(UTC)
    evaluated = 0
    warnings = 0
    expired = 0
    skipped = 0
    failed = 0

    from app.services.email_service import get_email_driver
    driver = get_email_driver()
    driver_name = type(driver).__name__.replace("Driver", "").lower()

    # ─── Warning pass ───────────────────────────────────────
    warn_window_start = now + timedelta(days=WARNING_DAYS_BEFORE) - timedelta(hours=12)
    warn_window_end = now + timedelta(days=WARNING_DAYS_BEFORE) + timedelta(hours=12)
    warn_rows = (await db.execute(
        text(
            """
            SELECT id, email, trial_ends_at FROM users
            WHERE trial_ends_at IS NOT NULL
              AND trial_ends_at BETWEEN :start AND :end
              AND is_active = TRUE
              AND deleted_at IS NULL
            """
        ),
        {"start": warn_window_start, "end": warn_window_end},
    )).all()

    for user_id, email, trial_ends_at in warn_rows:
        evaluated += 1
        # dedup_key on trial_end_date so a re-issued trial doesn't
        # silently skip the warning.
        end_date = trial_ends_at.date().isoformat()
        dedup_key = f"{user_id}:trial.expiring:{end_date}"
        if await _has_already_sent(db, dedup_key=dedup_key):
            skipped += 1
            continue
        days_remaining = max(1, (trial_ends_at - now).days)
        text_body, html_body = _warning_email_body(email, days_remaining)
        ok = await _send_one(
            db,
            user_id=user_id, user_email=email,
            template_key="trial.expiring",
            dedup_key=dedup_key,
            subject=f"Your humanovo trial ends in {days_remaining} days",
            text_body=text_body, html_body=html_body,
            driver_name=driver_name, driver=driver,
        )
        if ok:
            warnings += 1
        else:
            failed += 1

    # ─── Expiry pass ────────────────────────────────────────
    expired_rows = (await db.execute(
        text(
            """
            SELECT id, email, trial_ends_at FROM users
            WHERE trial_ends_at IS NOT NULL
              AND trial_ends_at < :now
              AND is_active = TRUE
              AND deleted_at IS NULL
            """
        ),
        {"now": now},
    )).all()

    for user_id, email, trial_ends_at in expired_rows:
        evaluated += 1
        end_date = trial_ends_at.date().isoformat()
        dedup_key = f"{user_id}:trial.expired:{end_date}"

        # 1. Record subscription transition (audit chain).
        try:
            from app.services.subscription_state import record_transition
            await record_transition(
                db,
                user_id=user_id,
                from_status="trialing",
                to_status="trial_expired",
                from_tier=None,  # we don't read current tier here;
                                 # state machine will fall back gracefully
                to_tier=EXPIRY_DOWNGRADE_TIER,
                stripe_event_id="cron.trial_expiry",
                metadata={"trial_ended_at": trial_ends_at.isoformat()},
            )
        except Exception as e:
            logger.warning(
                "trial_expiry transition write failed user_id=%s: %s",
                user_id, e,
            )

        # 2. Flip tier → trial, null trial_ends_at so cron doesn't
        # re-fire next day.
        await db.execute(
            text(
                """
                UPDATE users
                SET tier = :new_tier,
                    trial_ends_at = NULL
                WHERE id = :uid
                """
            ),
            {"uid": str(user_id), "new_tier": EXPIRY_DOWNGRADE_TIER},
        )

        # 3. Send the expired email (idempotent on dedup_key).
        text_body, html_body = _expired_email_body(email)
        ok = await _send_one(
            db,
            user_id=user_id, user_email=email,
            template_key="trial.expired",
            dedup_key=dedup_key,
            subject="Your humanovo trial has ended",
            text_body=text_body, html_body=html_body,
            driver_name=driver_name, driver=driver,
        )
        if ok:
            expired += 1
        else:
            failed += 1

    await db.commit()
    logger.info(
        "trial expiry cycle complete evaluated=%d warnings=%d "
        "expired=%d skipped=%d failed=%d",
        evaluated, warnings, expired, skipped, failed,
    )
    return TrialExpiryResult(
        users_evaluated=evaluated,
        warnings_sent=warnings,
        expirations_processed=expired,
        emails_skipped_already_sent=skipped,
        emails_failed=failed,
    )
