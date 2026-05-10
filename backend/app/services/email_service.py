"""Email delivery service — adapter pattern.

Three drivers, selected via `settings.EMAIL_DRIVER`:

  • `log` (default for dev/CI) — writes the message to the logger
    at INFO. Useful for local dev where SES isn't wired but the
    flow needs to round-trip a token via the logs.

  • `ses` — AWS Simple Email Service. Production default once the
    AWS Secrets bootstrap (USER BLOCKER #3) is dispatched and the
    SES sending domain is verified.

  • `smtp` — generic SMTP fallback. For institutional deployments
    where AWS SES isn't an option (no internet egress, on-prem,
    etc.). Reads SMTP_HOST/PORT/USER/PASSWORD from settings.

The driver interface is `async send_email(to, subject, html, text)
-> bool`. Drivers swallow transient failures + return False so a
calling endpoint can decide whether to retry; do NOT raise — email
delivery is best-effort, never load-bearing for a request.
"""
from __future__ import annotations

import logging
from typing import Protocol


logger = logging.getLogger(__name__)


class EmailDriver(Protocol):
    async def send_email(
        self,
        *,
        to: str,
        subject: str,
        html: str,
        text: str,
    ) -> bool:
        ...


class LogOnlyDriver:
    """Default driver — logs and returns True. Useful for dev / CI
    where a real send isn't wanted but the flow still needs to
    exercise. The `[email-stub]` marker makes log-grep trivial."""

    async def send_email(
        self,
        *,
        to: str,
        subject: str,
        html: str,
        text: str,
    ) -> bool:
        logger.info(
            "[email-stub] to=%s subject=%s text_len=%d html_len=%d",
            to, subject, len(text), len(html),
        )
        # Surface the text body so tests can assert on it without
        # standing up a real SMTP server.
        logger.info("[email-stub-body] %s", text[:400])
        return True


class SESDriver:
    """AWS SES driver. Lazy-imports boto3 so the module loads cleanly
    even if AWS deps aren't installed (dev / CI)."""

    def __init__(self, region: str, from_address: str) -> None:
        self.region = region
        self.from_address = from_address
        self._client = None

    def _get_client(self):
        if self._client is None:
            import boto3  # type: ignore
            self._client = boto3.client("ses", region_name=self.region)
        return self._client

    async def send_email(
        self,
        *,
        to: str,
        subject: str,
        html: str,
        text: str,
    ) -> bool:
        try:
            client = self._get_client()
            client.send_email(
                Source=self.from_address,
                Destination={"ToAddresses": [to]},
                Message={
                    "Subject": {"Data": subject, "Charset": "UTF-8"},
                    "Body": {
                        "Html": {"Data": html, "Charset": "UTF-8"},
                        "Text": {"Data": text, "Charset": "UTF-8"},
                    },
                },
            )
            return True
        except Exception as e:
            logger.warning("ses send_email failed to=%s: %s", to, e)
            return False


class SMTPDriver:
    """Generic SMTP driver. Useful for institutional deployments
    where SES isn't an option."""

    def __init__(
        self,
        *,
        host: str,
        port: int,
        username: str | None,
        password: str | None,
        from_address: str,
        use_tls: bool = True,
    ) -> None:
        self.host = host
        self.port = port
        self.username = username
        self.password = password
        self.from_address = from_address
        self.use_tls = use_tls

    async def send_email(
        self,
        *,
        to: str,
        subject: str,
        html: str,
        text: str,
    ) -> bool:
        # smtplib is sync; run the connection in a worker thread so
        # the FastAPI event loop isn't blocked. aiosmtplib is the
        # right long-term answer but adds a dep we don't need yet.
        import asyncio
        from email.mime.multipart import MIMEMultipart
        from email.mime.text import MIMEText
        from smtplib import SMTP, SMTP_SSL

        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = self.from_address
        msg["To"] = to
        msg.attach(MIMEText(text, "plain", "utf-8"))
        msg.attach(MIMEText(html, "html", "utf-8"))

        def _send_sync() -> bool:
            try:
                cls = SMTP_SSL if self.port == 465 else SMTP
                with cls(self.host, self.port, timeout=15) as smtp:
                    if self.use_tls and self.port != 465:
                        smtp.starttls()
                    if self.username and self.password:
                        smtp.login(self.username, self.password)
                    smtp.sendmail(self.from_address, [to], msg.as_string())
                return True
            except Exception as e:
                logger.warning("smtp send_email failed to=%s: %s", to, e)
                return False

        return await asyncio.get_event_loop().run_in_executor(None, _send_sync)


# ─── Driver resolution ─────────────────────────────────────────


_driver_instance: EmailDriver | None = None


def get_email_driver() -> EmailDriver:
    """Lazy singleton — picks the driver based on settings on first
    call, then reuses the same instance for the process lifetime."""
    global _driver_instance
    if _driver_instance is not None:
        return _driver_instance

    from app.core.config import settings

    name = (getattr(settings, "EMAIL_DRIVER", None) or "log").lower()

    if name == "ses":
        from_addr = getattr(settings, "EMAIL_FROM_ADDRESS", "no-reply@humanovo.net")
        region = getattr(settings, "AWS_REGION", "us-east-1")
        _driver_instance = SESDriver(region=region, from_address=from_addr)
    elif name == "smtp":
        smtp_pw = getattr(settings, "smtp_password_value", None)
        _driver_instance = SMTPDriver(
            host=getattr(settings, "SMTP_HOST", "localhost"),
            port=int(getattr(settings, "SMTP_PORT", 587)),
            username=getattr(settings, "SMTP_USERNAME", None),
            password=smtp_pw,
            from_address=getattr(settings, "EMAIL_FROM_ADDRESS", "no-reply@humanovo.net"),
            use_tls=bool(getattr(settings, "SMTP_USE_TLS", True)),
        )
    else:
        _driver_instance = LogOnlyDriver()

    return _driver_instance


async def send_email(
    *,
    to: str,
    subject: str,
    html: str,
    text: str,
) -> bool:
    """Module-level convenience: forwards to the resolved driver."""
    return await get_email_driver().send_email(
        to=to, subject=subject, html=html, text=text,
    )
