"""Admin billing operations — issue refunds, list refund history.

Closes the billing-operations loop alongside the user-facing
endpoints in account_billing.py (cancel-subscription + list-invoices):

  POST /admin/billing/refund/{invoice_id}
    Issue a full or partial refund against a Stripe invoice. Stores
    a refund_records row regardless of Stripe outcome so the audit
    trail captures failures too. Writes to the Merkle-chained audit
    log so the action is attributable to the admin who hit the
    endpoint. Reason MUST come from a fixed allowlist — Stripe's
    standard values (duplicate / fraudulent / requested_by_customer)
    plus `other` for ad-hoc cases that the operator describes in
    reason_text. Both Stripe and our reporting need a categorical
    field, so we don't free-form this.

  GET /admin/billing/refunds
    Paginated history of refund_records, newest first. Includes
    failed attempts so ops can spot patterns (e.g. a flurry of
    `charge_not_refundable` errors signals a Stripe-mode mismatch).
"""
from __future__ import annotations

import logging
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import ADMIN_REQUIRED, get_current_user
from app.core.config import settings
from app.core.database import get_db
from app.core.rate_limit import rate_limit
from app.models.user import User


logger = logging.getLogger(__name__)
router = APIRouter(dependencies=[*ADMIN_REQUIRED, Depends(rate_limit("admin"))])


# Stripe's documented refund reasons + `other` for ad-hoc cases.
# Keep in sync with the column constraint in scripts that audit
# the refund_records table.
VALID_REFUND_REASONS = {
    "duplicate",
    "fraudulent",
    "requested_by_customer",
    "other",
}


class RefundRequest(BaseModel):
    amount_cents: int | None = Field(
        default=None,
        ge=1,
        description=(
            "Partial-refund amount in cents. Omit (or null) to refund "
            "the invoice's full amount_paid. Cannot exceed amount_paid; "
            "Stripe will reject if it does."
        ),
    )
    reason: str = Field(
        description=(
            "One of: duplicate | fraudulent | requested_by_customer | other"
        ),
    )
    reason_text: str | None = Field(
        default=None,
        max_length=2000,
        description="Free-form amplification — required when reason=other.",
    )


def _stripe_api_key() -> str | None:
    skey = getattr(settings, "STRIPE_SECRET_KEY", None)
    if hasattr(skey, "get_secret_value"):
        return skey.get_secret_value()
    return skey if isinstance(skey, str) else None


async def _audit_refund(
    db: AsyncSession,
    *,
    actor: User,
    target_user_id: str,
    invoice_id: str,
    amount_cents: int,
    status_value: str,
    reason: str,
    refund_id: str | None,
) -> None:
    """Best-effort audit-chain write. Mirrors the pattern in
    admin_users._audit — a failed audit logs a warning but does NOT
    roll back the refund itself, since the refund row in
    refund_records is the durable record of what happened."""
    try:
        from app.services.audit_service import (
            AuditContext,
            AuditEventType,
            AuditSeverity,
            get_audit_service,
        )
        audit = get_audit_service()
        await audit.record(
            db=db,
            # No dedicated billing event type in the current enum.
            # DATA_WRITE is the closest semantic fit — the refund is a
            # state-changing write that an admin performed on behalf
            # of a user. Action string disambiguates for log search.
            event_type=AuditEventType.DATA_WRITE,
            action="admin.billing.refund.create",
            context=AuditContext(user_id=str(actor.id)),
            severity=AuditSeverity.NOTICE,
            resource_type="stripe_refund",
            resource_id=refund_id or invoice_id,
            details={
                "target_user_id": target_user_id,
                "invoice_id": invoice_id,
                "amount_cents": amount_cents,
                "reason": reason,
                "status": status_value,
            },
        )
    except Exception as e:
        logger.warning("admin_billing.refund audit write failed: %s", e)


@router.post("/admin/billing/refund/{invoice_id}")
async def issue_refund(
    invoice_id: str,
    body: RefundRequest,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(get_current_user),
) -> dict[str, Any]:
    """Issue a refund against a Stripe invoice.

    Flow:
      1. Validate reason against the allowlist (and require reason_text
         when reason=other).
      2. Look up the invoice in Stripe to resolve customer + charge.
      3. Find the user behind that customer in our DB.
      4. Call Stripe Refund.create with charge + amount + reason.
      5. Record the outcome in refund_records (succeeded / failed),
         capturing the Stripe refund id when present, otherwise the
         error message — both states need to be inspectable later.
      6. Write a Merkle-chain audit entry.

    Failure modes are explicitly enumerated so the admin UI can
    show a useful message rather than a generic 500:
      • Invalid reason → 400
      • Stripe not configured → 503
      • Invoice not found OR no matching user → 404
      • Stripe-side refund rejection → 200 with status='failed' in
        the response (the row is still recorded — this is how ops
        finds bad invoices to investigate manually).
    """
    if body.reason not in VALID_REFUND_REASONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"reason must be one of: {sorted(VALID_REFUND_REASONS)}.",
        )
    if body.reason == "other" and not (body.reason_text and body.reason_text.strip()):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="reason_text is required when reason='other'.",
        )

    api_key = _stripe_api_key()
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Billing service is not configured.",
        )

    import stripe  # type: ignore

    stripe.api_key = api_key

    # Resolve the invoice → customer + charge.
    try:
        invoice = stripe.Invoice.retrieve(invoice_id)
    except Exception as e:
        logger.warning(
            "stripe.Invoice.retrieve failed invoice_id=%s: %s", invoice_id, e
        )
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Invoice not found: {invoice_id}",
        ) from None

    customer_id = getattr(invoice, "customer", None)
    charge_id = getattr(invoice, "charge", None)
    invoice_amount_paid = int(getattr(invoice, "amount_paid", 0) or 0)
    invoice_currency = getattr(invoice, "currency", "usd")

    if not customer_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Invoice has no customer attached.",
        )
    if not charge_id:
        # Invoices paid via Stripe-side credit / out-of-band methods
        # have no charge; the Stripe API requires either charge or
        # payment_intent. We bail rather than guess.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Invoice is not refundable (no associated charge).",
        )

    # Resolve the user behind that customer so the refund_records row
    # is anchored to a real account.
    user_q = await db.execute(
        select(User.id).where(User.stripe_customer_id == customer_id)
    )
    row = user_q.first()
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=(
                f"No user matches stripe_customer_id={customer_id}. "
                "Refund not issued — investigate the customer / DB "
                "drift before retrying."
            ),
        )
    target_user_id = str(row[0])

    amount = body.amount_cents if body.amount_cents is not None else invoice_amount_paid
    if amount <= 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Refund amount must be > 0.",
        )
    if amount > invoice_amount_paid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Refund amount {amount} exceeds invoice amount_paid "
                f"{invoice_amount_paid}."
            ),
        )

    # Stripe's `reason` only accepts the three documented values —
    # `other` would 400. Map our 'other' to Stripe's
    # 'requested_by_customer' since that's the closest semantic fit
    # (the operator chose a custom reason for one of their customers);
    # the real categorization lives in our refund_records.reason
    # column where the full enum + reason_text survives.
    stripe_reason = (
        body.reason if body.reason != "other" else "requested_by_customer"
    )

    refund_id: str | None = None
    error_message: str | None = None
    refund_status = "failed"
    try:
        refund = stripe.Refund.create(
            charge=charge_id,
            amount=amount,
            reason=stripe_reason,
            metadata={
                "issued_by_admin_id": str(actor.id),
                "humanovo_reason": body.reason,
            },
        )
        refund_id = getattr(refund, "id", None)
        refund_status = getattr(refund, "status", "pending") or "pending"
    except Exception as e:
        # Stripe's library raises CardError, InvalidRequestError, etc.
        # We swallow and record so the refund_records row captures
        # the failure — admin sees a structured response and can
        # decide what to do, instead of a 500.
        error_message = f"{type(e).__name__}: {e}"
        logger.warning(
            "stripe.Refund.create failed invoice=%s charge=%s: %s",
            invoice_id, charge_id, e,
        )

    # Always write the refund row — success or failure both need a
    # paper trail.
    await db.execute(
        text(
            """
            INSERT INTO refund_records
                (user_id, issued_by_admin_id, stripe_invoice_id,
                 stripe_charge_id, stripe_refund_id, amount_cents,
                 currency, reason, reason_text, status, error_message)
            VALUES (:uid, :aid, :inv, :ch, :rid, :amt, :cur, :rsn,
                    :rsn_txt, :stat, :err)
            """
        ),
        {
            "uid": target_user_id,
            "aid": str(actor.id),
            "inv": invoice_id,
            "ch": charge_id,
            "rid": refund_id,
            "amt": amount,
            "cur": invoice_currency,
            "rsn": body.reason,
            "rsn_txt": body.reason_text,
            "stat": refund_status,
            "err": error_message,
        },
    )
    await db.commit()

    await _audit_refund(
        db,
        actor=actor,
        target_user_id=target_user_id,
        invoice_id=invoice_id,
        amount_cents=amount,
        status_value=refund_status,
        reason=body.reason,
        refund_id=refund_id,
    )

    return {
        "invoice_id": invoice_id,
        "refund_id": refund_id,
        "status": refund_status,
        "amount_cents": amount,
        "currency": invoice_currency,
        "error_message": error_message,
    }


@router.get("/admin/billing/refunds")
async def list_refunds(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    status_filter: str | None = Query(
        default=None,
        description="Optional: succeeded | pending | failed",
    ),
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(get_current_user),
) -> dict[str, Any]:
    """Paginated refund history, newest first. status_filter narrows to
    a single status when ops is investigating a pattern (most useful
    with status=failed)."""
    if status_filter and status_filter not in {"succeeded", "pending", "failed"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="status_filter must be one of: succeeded, pending, failed.",
        )

    where_clause = ""
    params: dict[str, Any] = {"lim": limit, "off": offset}
    if status_filter:
        where_clause = "WHERE status = :status_filter"
        params["status_filter"] = status_filter

    result = await db.execute(
        text(
            f"""
            SELECT id, user_id, issued_by_admin_id, stripe_invoice_id,
                   stripe_charge_id, stripe_refund_id, amount_cents,
                   currency, reason, reason_text, status, error_message,
                   created_at
            FROM refund_records
            {where_clause}
            ORDER BY created_at DESC
            LIMIT :lim OFFSET :off
            """
        ),
        params,
    )
    refunds = [
        {
            "id": str(r[0]),
            "user_id": str(r[1]),
            "issued_by_admin_id": str(r[2]) if r[2] else None,
            "stripe_invoice_id": r[3],
            "stripe_charge_id": r[4],
            "stripe_refund_id": r[5],
            "amount_cents": r[6],
            "currency": r[7],
            "reason": r[8],
            "reason_text": r[9],
            "status": r[10],
            "error_message": r[11],
            "created_at": r[12].isoformat() if r[12] else None,
        }
        for r in result.fetchall()
    ]

    return {"refunds": refunds, "count": len(refunds)}
