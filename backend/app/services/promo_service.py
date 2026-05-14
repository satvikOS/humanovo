"""Promo code service — validation + redemption.

Three code kinds:
  • percent_off — applied via Stripe Coupon on the next checkout.
                  Value 1-100.
  • fixed_cents_off — same, fixed dollar discount. Value > 0 cents.
  • trial_extension — extends users.trial_ends_at by N days.
                       Doesn't touch Stripe.

Validation is comprehensive: case-insensitive code lookup, expiry
check, max_redemptions cap, per-user dedup, optional email-domain
restriction (`min_email_domain` is the only acceptable suffix, e.g.
`@university.edu`).

Trial extension is applied directly (DB write). Percent / fixed
discounts are returned as a `coupon_id` Stripe Coupon string the
desktop UI passes into the next Stripe Checkout — actual application
happens at billing time, not redemption time.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


logger = logging.getLogger(__name__)


VALID_KINDS = {"percent_off", "fixed_cents_off", "trial_extension"}


@dataclass
class PromoLookup:
    """Result of a `lookup` — describes the code without committing
    a redemption. Used by /preview-code to show the user what the
    discount would look like before they click Apply."""
    id: UUID
    code: str
    kind: str
    value: int
    description: str | None
    expires_at: datetime | None


@dataclass
class RedemptionResult:
    """Returned from `redeem` on success."""
    code: str
    kind: str
    value: int
    # For trial_extension: the new trial_ends_at after the bump.
    new_trial_ends_at: datetime | None = None
    # For percent_off / fixed_cents_off: Stripe Coupon ID the desktop
    # UI passes to the next Checkout. None until the Stripe Coupon
    # API integration lands (Phase 3.4 follow-on); for now the UI
    # surfaces "discount applied — proceed to checkout to claim".
    stripe_coupon_id: str | None = None


class PromoError(Exception):
    """Generic redemption-blocked error. Carries a single-sentence
    user-facing message; the endpoint maps to 400."""


async def lookup_code(db: AsyncSession, *, code: str) -> PromoLookup | None:
    """Find a non-revoked, non-expired code by name (case-insensitive).
    Returns None if not found / revoked / expired."""
    row = (await db.execute(
        text(
            """
            SELECT id, code, kind, value, description, expires_at,
                   max_redemptions, min_email_domain, revoked_at
            FROM promo_codes
            WHERE UPPER(code) = UPPER(:code)
            """
        ),
        {"code": code.strip()},
    )).first()
    if row is None:
        return None
    if row[8] is not None:  # revoked_at
        return None
    if row[5] is not None and row[5] < datetime.now(UTC):  # expires_at
        return None
    return PromoLookup(
        id=row[0],
        code=row[1],
        kind=row[2],
        value=row[3],
        description=row[4],
        expires_at=row[5],
    )


async def _check_redemption_cap(
    db: AsyncSession, *, promo_code_id: UUID, max_redemptions: int | None,
) -> bool:
    """Return True if redemption capacity remains, False if the
    code has been fully claimed."""
    if max_redemptions is None:
        return True
    row = (await db.execute(
        text(
            "SELECT COUNT(*) FROM promo_redemptions "
            "WHERE promo_code_id = :pid"
        ),
        {"pid": str(promo_code_id)},
    )).first()
    used = int(row[0]) if row else 0
    return used < max_redemptions


async def redeem(
    db: AsyncSession,
    *,
    code: str,
    user_id: UUID,
    user_email: str,
    user_trial_ends_at: datetime | None,
) -> RedemptionResult:
    """Validate + commit a redemption. Raises PromoError with a
    user-facing message on any failure (unknown code, expired,
    revoked, capped, domain-mismatch, already-redeemed)."""
    row = (await db.execute(
        text(
            """
            SELECT id, code, kind, value, description, expires_at,
                   max_redemptions, min_email_domain, revoked_at
            FROM promo_codes
            WHERE UPPER(code) = UPPER(:code)
            """
        ),
        {"code": code.strip()},
    )).first()
    if row is None:
        raise PromoError("Unknown promo code.")
    pid, code_canonical, kind, value, _desc, expires_at, max_r, min_dom, revoked = row
    if revoked is not None:
        raise PromoError("This promo code has been revoked.")
    if expires_at is not None and expires_at < datetime.now(UTC):
        raise PromoError("This promo code has expired.")
    if min_dom and not user_email.lower().endswith(min_dom.lower()):
        raise PromoError(
            f"This promo code is restricted to {min_dom} email addresses."
        )
    if not await _check_redemption_cap(db, promo_code_id=pid, max_redemptions=max_r):
        raise PromoError("This promo code has reached its redemption limit.")

    # Per-user dedup via UNIQUE constraint. ON CONFLICT DO NOTHING +
    # RETURNING gives us the same atomic check + write in one round trip.
    redemption = (await db.execute(
        text(
            """
            INSERT INTO promo_redemptions (promo_code_id, user_id)
            VALUES (:pid, :uid)
            ON CONFLICT (promo_code_id, user_id) DO NOTHING
            RETURNING id
            """
        ),
        {"pid": str(pid), "uid": str(user_id)},
    )).scalar_one_or_none()
    if redemption is None:
        raise PromoError("You've already redeemed this promo code.")

    result = RedemptionResult(code=code_canonical, kind=kind, value=value)

    # Apply the actual benefit.
    if kind == "trial_extension":
        from app.models.user import User
        # Extend the trial. If user has no trial OR existing trial
        # ends in the past, base off now(); otherwise extend the
        # existing end.
        now = datetime.now(UTC)
        base = user_trial_ends_at if (
            user_trial_ends_at and user_trial_ends_at > now
        ) else now
        new_end = base + timedelta(days=value)
        await db.execute(
            text("UPDATE users SET trial_ends_at = :end WHERE id = :uid"),
            {"end": new_end, "uid": str(user_id)},
        )
        result.new_trial_ends_at = new_end
    # percent_off + fixed_cents_off: the Stripe Coupon integration
    # is Phase 3.4 follow-on. For now the redemption is recorded
    # and the UI tells the user "apply at next checkout" — the
    # admin dashboard can manually issue the coupon out-of-band.

    await db.commit()
    logger.info(
        "promo redeemed code=%s kind=%s value=%d user_id=%s",
        code_canonical, kind, value, user_id,
    )
    return result


async def create_promo_code(
    db: AsyncSession,
    *,
    code: str,
    kind: str,
    value: int,
    description: str | None = None,
    expires_at: datetime | None = None,
    max_redemptions: int | None = None,
    min_email_domain: str | None = None,
    created_by_user_id: UUID,
) -> UUID:
    """Admin-only mint. Returns the new code's id."""
    if kind not in VALID_KINDS:
        raise PromoError(f"Invalid kind. Must be one of: {sorted(VALID_KINDS)}.")
    if value <= 0:
        raise PromoError("Value must be a positive integer.")
    if kind == "percent_off" and value > 100:
        raise PromoError("percent_off value must be ≤ 100.")
    if min_email_domain and not min_email_domain.startswith("@"):
        raise PromoError("min_email_domain must start with '@', e.g. '@university.edu'.")

    row = (await db.execute(
        text(
            """
            INSERT INTO promo_codes
                (code, kind, value, description, expires_at,
                 max_redemptions, min_email_domain, created_by_user_id)
            VALUES (:code, :kind, :value, :desc, :exp, :maxr, :dom, :creator)
            RETURNING id
            """
        ),
        {
            "code": code.strip().upper(),
            "kind": kind,
            "value": value,
            "desc": description,
            "exp": expires_at,
            "maxr": max_redemptions,
            "dom": min_email_domain,
            "creator": str(created_by_user_id),
        },
    )).first()
    await db.commit()
    return row[0]
