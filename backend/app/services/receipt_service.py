"""Receipt + invoice email dispatch.

Two functions, called from the Stripe webhook handler when
`invoice.paid` / `invoice.payment_failed` events arrive:

  • send_receipt(db, invoice_event)         — paid invoice
  • send_payment_failed(db, invoice_event)  — failed invoice

Both:
  • Resolve the humanovo user from invoice.customer (stripe_customer_id).
  • Dedupe via email_sends.dedup_key = `<user_id>:<template>:<invoice_id>`
    so retries / multiple webhook deliveries don't double-email.
  • Build a text + HTML email with amount, currency, period, and
    a link to the Stripe-hosted invoice PDF (hosted_invoice_url).
  • Best-effort: a send failure is logged + recorded with ok=False
    so the recovery cron can retry; the webhook handler still
    returns 200 so Stripe doesn't retry the webhook itself.
"""
from __future__ import annotations

import logging
from typing import Any
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


logger = logging.getLogger(__name__)


async def _resolve_user_email(
    db: AsyncSession, *, stripe_customer_id: str,
) -> tuple[UUID, str] | None:
    """Look up the humanovo user by stripe_customer_id. Returns
    (user_id, email) or None if no match."""
    row = (await db.execute(
        text(
            "SELECT id, email FROM users "
            "WHERE stripe_customer_id = :cid AND deleted_at IS NULL"
        ),
        {"cid": stripe_customer_id},
    )).first()
    if row is None:
        return None
    return row[0], row[1]


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


def _format_amount(amount_cents: int, currency: str) -> str:
    """`amount_paid` from Stripe is in the smallest currency unit
    (cents for USD). Render as $X.YZ for human display."""
    return f"${amount_cents / 100:.2f} {currency.upper()}"


async def _send(
    db: AsyncSession,
    *,
    user_id: UUID,
    user_email: str,
    template_key: str,
    dedup_key: str,
    subject: str,
    text_body: str,
    html_body: str,
) -> bool:
    """Idempotent send. Returns True if email_sends already has the
    dedup row (treated as success — don't retry), or the driver's
    real success/failure."""
    if await _has_already_sent(db, dedup_key=dedup_key):
        return True

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
            "receipt send_email raised user_id=%s template=%s: %s",
            user_id, template_key, e,
        )
        ok = False
    await _record_send(
        db,
        user_id=user_id, template_key=template_key,
        dedup_key=dedup_key, driver=driver_name, ok=ok,
    )
    return ok


async def send_receipt(
    db: AsyncSession,
    *,
    invoice: dict[str, Any],
) -> dict[str, Any]:
    """Dispatch a paid-invoice receipt. `invoice` is the
    invoice.paid event payload (data.object) from Stripe."""
    customer_id = invoice.get("customer")
    invoice_id = invoice.get("id") or ""
    if not customer_id or not invoice_id:
        return {"status": "skipped", "reason": "missing customer or invoice id"}

    resolved = await _resolve_user_email(db, stripe_customer_id=customer_id)
    if resolved is None:
        return {"status": "skipped", "reason": "no user for customer"}
    user_id, email = resolved

    amount_cents = int(invoice.get("amount_paid") or 0)
    currency = invoice.get("currency") or "usd"
    hosted_invoice_url = invoice.get("hosted_invoice_url") or ""
    period_start = invoice.get("period_start")
    period_end = invoice.get("period_end")

    amount_display = _format_amount(amount_cents, currency)
    text_body = (
        f"Thanks — your humanovo payment of {amount_display} has "
        f"been received.\n\n"
        f"Invoice: {invoice_id}\n"
        f"Period: {period_start} → {period_end}\n"
        + (f"\nDownload your invoice PDF here:\n{hosted_invoice_url}\n" if hosted_invoice_url else "")
        + "\nThanks for using humanovo.\n"
    )
    html_body = (
        "<div style='font-family:Inter,system-ui,sans-serif;"
        "max-width:560px;margin:0 auto'>"
        f"<h2 style='font-weight:600'>Payment received</h2>"
        f"<p>Thanks — your humanovo payment of <strong>{amount_display}</strong> has been received.</p>"
        f"<p><code>Invoice: {invoice_id}</code></p>"
        + (
            f'<p><a href="{hosted_invoice_url}">Download invoice PDF</a></p>'
            if hosted_invoice_url else ""
        )
        + "</div>"
    )

    dedup_key = f"{user_id}:receipt:{invoice_id}"
    ok = await _send(
        db,
        user_id=user_id, user_email=email,
        template_key="receipt.paid",
        dedup_key=dedup_key,
        subject=f"humanovo payment receipt — {amount_display}",
        text_body=text_body, html_body=html_body,
    )
    return {"status": "sent" if ok else "send_failed", "user_id": str(user_id)}


async def send_payment_failed(
    db: AsyncSession,
    *,
    invoice: dict[str, Any],
) -> dict[str, Any]:
    """Dispatch a payment-failed notification. Lightweight first-
    touch — the full dunning cadence (Phase 2.6) fires from the
    subscription state machine when status flips past_due."""
    customer_id = invoice.get("customer")
    invoice_id = invoice.get("id") or ""
    if not customer_id or not invoice_id:
        return {"status": "skipped", "reason": "missing customer or invoice id"}

    resolved = await _resolve_user_email(db, stripe_customer_id=customer_id)
    if resolved is None:
        return {"status": "skipped", "reason": "no user for customer"}
    user_id, email = resolved

    amount_cents = int(invoice.get("amount_due") or 0)
    currency = invoice.get("currency") or "usd"
    hosted_invoice_url = invoice.get("hosted_invoice_url") or ""
    amount_display = _format_amount(amount_cents, currency)

    text_body = (
        f"We couldn't process your humanovo payment of {amount_display}.\n\n"
        "Most often this is a temporary card decline or an expired "
        "card on file. We'll automatically retry over the next few "
        "days; meanwhile, you can update your billing details here:\n\n"
        "https://app.humanovo.net/account/billing\n\n"
        + (f"View the failed invoice:\n{hosted_invoice_url}\n\n" if hosted_invoice_url else "")
        + "If you've already updated your card, you can ignore this "
          "email — our retry will pick up the new method.\n"
    )
    html_body = (
        "<div style='font-family:Inter,system-ui,sans-serif;"
        "max-width:560px;margin:0 auto'>"
        f"<h2 style='font-weight:600'>Payment failed</h2>"
        f"<p>We couldn't process your humanovo payment of <strong>{amount_display}</strong>.</p>"
        '<p><a href="https://app.humanovo.net/account/billing">Update billing details</a></p>'
        "</div>"
    )

    dedup_key = f"{user_id}:payment_failed:{invoice_id}"
    ok = await _send(
        db,
        user_id=user_id, user_email=email,
        template_key="receipt.failed",
        dedup_key=dedup_key,
        subject=f"humanovo payment of {amount_display} couldn't be processed",
        text_body=text_body, html_body=html_body,
    )
    return {"status": "sent" if ok else "send_failed", "user_id": str(user_id)}


async def reconcile_stripe_refund_event(
    db: AsyncSession,
    *,
    charge: dict[str, Any],
) -> dict[str, Any]:
    """Handle a Stripe `charge.refunded` webhook payload.

    The Stripe dashboard lets support staff issue refunds directly,
    bypassing our admin endpoint — when that happens we get the
    webhook but no refund_records row. This function backfills:
    for each refund in `charge.refunds.data`, if we don't already
    have a row with that stripe_refund_id, insert one (status =
    succeeded, reason = 'requested_by_customer', reason_text =
    'reconciled from Stripe dashboard') and fire the customer
    confirmation email so the cardholder still gets a heads-up.

    Dedup is on stripe_refund_id, which is unique per Stripe refund,
    so:
      • Refunds issued via our admin endpoint → already in
        refund_records with `issued_by_admin_id`; this function
        sees the existing row and skips both the INSERT and the
        email (send_refund_confirmation re-deduplicates on
        email_sends.dedup_key anyway, so even a missed skip here
        wouldn't double-email).
      • Refunds issued via Stripe dashboard → inserted here with
        `issued_by_admin_id = NULL` so reporting can split admin-
        UI vs Stripe-UI origin if needed.

    Best-effort: any per-refund error (e.g. unknown customer) is
    logged + counted but does NOT raise — the webhook handler must
    return 200 so Stripe doesn't retry forever.
    """
    charge_id = charge.get("id")
    customer_id = charge.get("customer")
    currency = (charge.get("currency") or "usd").lower()
    refunds_payload = (charge.get("refunds") or {}).get("data") or []
    if not refunds_payload:
        return {"status": "no_refunds", "charge_id": charge_id}

    # Resolve the user once — every refund on a single charge maps
    # to the same customer.
    user_row = None
    if customer_id:
        user_row = (await db.execute(
            text(
                "SELECT id, email FROM users "
                "WHERE stripe_customer_id = :cid AND deleted_at IS NULL"
            ),
            {"cid": customer_id},
        )).first()
    if user_row is None:
        # No matching user → can't anchor refund_records. Log and
        # skip; the Stripe-side state is still correct.
        logger.warning(
            "charge.refunded: no user for customer=%s (charge=%s, refunds=%d)",
            customer_id, charge_id, len(refunds_payload),
        )
        return {"status": "skipped_no_user", "charge_id": charge_id}
    user_id, user_email = user_row

    inserted = 0
    skipped = 0
    emailed = 0
    for refund in refunds_payload:
        refund_id = refund.get("id")
        if not refund_id:
            continue
        # Dedup by stripe_refund_id — admin-endpoint refunds already
        # have a row.
        existing = (await db.execute(
            text("SELECT 1 FROM refund_records WHERE stripe_refund_id = :rid LIMIT 1"),
            {"rid": refund_id},
        )).first()
        if existing:
            skipped += 1
            continue

        amount = int(refund.get("amount") or 0)
        await db.execute(
            text(
                """
                INSERT INTO refund_records
                    (user_id, issued_by_admin_id, stripe_invoice_id,
                     stripe_charge_id, stripe_refund_id, amount_cents,
                     currency, reason, reason_text, status, error_message)
                VALUES (:uid, NULL, :inv, :ch, :rid, :amt, :cur, :rsn,
                        :rsn_txt, :stat, NULL)
                """
            ),
            {
                "uid": str(user_id),
                # invoice id isn't on the charge object directly; we
                # store the charge id under stripe_charge_id and leave
                # invoice id blank (NOT NULL on the column → store the
                # charge id there too so the row is anchored to
                # *something*; reporting can recover the invoice via
                # Stripe API if needed).
                "inv": charge.get("invoice") or charge_id or "unknown",
                "ch": charge_id,
                "rid": refund_id,
                "amt": amount,
                "cur": currency,
                "rsn": "requested_by_customer",
                "rsn_txt": "reconciled from Stripe dashboard",
                "stat": refund.get("status") or "succeeded",
            },
        )
        inserted += 1

        # Customer-facing confirmation. Idempotent on email_sends
        # so a webhook retry won't double-mail.
        try:
            send_result = await send_refund_confirmation(
                db,
                user_id=user_id,
                user_email=user_email,
                invoice_id=charge.get("invoice") or charge_id or "unknown",
                refund_id=refund_id,
                amount_cents=amount,
                currency=currency,
            )
            if send_result.get("status") == "sent":
                emailed += 1
        except Exception as e:
            logger.warning(
                "reconcile_stripe_refund: confirmation email failed for refund=%s: %s",
                refund_id, e,
            )

    return {
        "status": "ok",
        "charge_id": charge_id,
        "user_id": str(user_id),
        "inserted": inserted,
        "skipped_existing": skipped,
        "emailed": emailed,
    }


async def send_refund_confirmation(
    db: AsyncSession,
    *,
    user_id: UUID | str,
    user_email: str,
    invoice_id: str,
    refund_id: str,
    amount_cents: int,
    currency: str = "usd",
) -> dict[str, Any]:
    """Dispatch a refund-confirmation email when our admin endpoint
    has successfully issued a Stripe refund. Called from
    admin_billing.issue_refund after Stripe returns status=succeeded.

    Why this email matters: the customer's card statement won't
    reflect the credit for 5–10 business days. A silent refund is a
    common driver of "is this fraud?" support tickets. Naming the
    amount + invoice + ETA up-front is cheap and removes the
    ambiguity.

    Dedup key: `<user_id>:refund:<refund_id>` — the Stripe refund id
    is unique-per-refund, so two admin clicks on the same invoice
    (= two refunds) each get their own email; a webhook retry for the
    same refund does not."""
    if not refund_id:
        # Defensive: caller should have status='succeeded' before
        # invoking us, which implies refund_id was returned. Bail
        # silently rather than emailing with a placeholder.
        return {"status": "skipped", "reason": "missing refund_id"}

    amount_display = _format_amount(amount_cents, currency)
    text_body = (
        f"We've issued a refund of {amount_display} against your "
        f"humanovo invoice {invoice_id}.\n\n"
        "The credit should appear on the card you paid with within "
        "5–10 business days, depending on your bank.\n\n"
        "Reference (if you need it for your records):\n"
        f"  Refund id: {refund_id}\n"
        f"  Invoice id: {invoice_id}\n\n"
        "If you don't see the credit after 10 business days, or if "
        "this refund was unexpected, reply to this email and we'll "
        "investigate right away.\n\n"
        "— the humanovo team\n"
    )
    html_body = (
        "<div style='font-family:Inter,system-ui,sans-serif;"
        "max-width:560px;margin:0 auto;color:#1a1a1a'>"
        f"<h2 style='font-weight:600'>Refund issued</h2>"
        f"<p>We've issued a refund of <strong>{amount_display}</strong> "
        f"against your humanovo invoice <code>{invoice_id}</code>.</p>"
        "<p>The credit should appear on the card you paid with within "
        "<strong>5–10 business days</strong>, depending on your bank.</p>"
        "<p style='color:#555'>Reference (for your records):<br/>"
        f"Refund id: <code>{refund_id}</code><br/>"
        f"Invoice id: <code>{invoice_id}</code></p>"
        "<p>If you don't see the credit after 10 business days, or "
        "if this refund was unexpected, reply to this email and we'll "
        "investigate right away.</p>"
        "<p style='margin-top:24px;color:#555'>— the humanovo team</p>"
        "</div>"
    )

    dedup_key = f"{user_id}:refund:{refund_id}"
    ok = await _send(
        db,
        user_id=user_id, user_email=user_email,
        template_key="refund.confirmation",
        dedup_key=dedup_key,
        subject=f"humanovo refund issued — {amount_display}",
        text_body=text_body, html_body=html_body,
    )
    return {"status": "sent" if ok else "send_failed", "user_id": str(user_id)}
