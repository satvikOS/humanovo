"""
In-process per-IP token-bucket rate limiter for FastAPI dependencies.

Stage 5 of `docs/planning/PATH_TO_100_PERCENT.md`. The motivating threat
is not a DDoS — CloudFront / AWS WAF in front of the backend handles
volumetric attacks well before they reach the FastAPI app. The
motivating threat is a *focused* misuse: an admin endpoint accidentally
callable in a way that triggers expensive work (a runaway seed loop,
a parity-check storm, etc.) because someone forgot ADMIN_REQUIRED on a
new route.

Design choices:

  * **In-process, not Redis-backed.** Backend runs as 1-2 ECS tasks in
    production; per-task rate limiting is good enough for admin
    surfaces that should see ~tens of requests per minute, not
    thousands. A Redis-backed version is a worthwhile follow-up when
    a route benefits from cross-task accounting; until then the
    operational simplicity wins.

  * **Token bucket, not sliding window.** Burst tolerance matters
    more than long-window smoothing for admin work — a contributor
    pulling /admin/kg-parity 5 times in 10 seconds while debugging
    is normal; we just don't want 500 in 10 seconds.

  * **Per-IP keying.** ADMIN_REQUIRED already binds the auth caller;
    layering per-IP on top means a stolen admin token still hits the
    bucket from whatever IP it's coming from.

  * **429 response with `Retry-After`** so well-behaved clients back
    off; the value is the time until the next token regenerates.

Usage:

    from fastapi import Depends
    from app.core.rate_limit import rate_limit

    @router.post("/seed-kg", dependencies=[Depends(rate_limit("admin"))])
    async def seed_kg(...): ...

    # Or apply to the whole admin router:
    router = APIRouter(dependencies=[*ADMIN_REQUIRED, Depends(rate_limit("admin"))])

Thread safety: each bucket is mutated via a stdlib `threading.Lock` so
the request handler doesn't need to coordinate. FastAPI's async handlers
hop the GIL anyway; the lock is microseconds.
"""

from __future__ import annotations

import threading
import time
from collections.abc import Callable

from fastapi import HTTPException, Request, status


# Tunable per-bucket-name. Add a new entry when defining a new bucket
# rather than passing config through the dependency call site, so all
# rate-limit policies live in one place.
_DEFAULT_BUCKETS: dict[str, tuple[float, float]] = {
    # name → (capacity, refill_rate_per_second)
    # admin bucket: 30 capacity, 0.5 r/s → ≤ 30 in any 60-second window,
    # but bursts up to 30 are fine (token-bucket semantics). Catches
    # runaway loops without obstructing interactive admin use.
    "admin": (30.0, 0.5),
    # auth: login / signup / password-reset. Tight enough to blunt
    # credential-stuffing from a single IP, loose enough for a human
    # fat-fingering a password (burst 10, ~6/min sustained).
    "auth": (10.0, 0.1),
    # user: ordinary authenticated interactive actions. Generous —
    # the auth caller is already bound; this only catches a runaway
    # client loop (burst 60, 1/s sustained).
    "user": (60.0, 1.0),
    # public: unauthenticated public endpoints. Same shape as `user`;
    # WAF/CloudFront handles volumetric abuse upstream.
    "public": (60.0, 1.0),
    # metrics: Prometheus scrape endpoint — scraped on a fixed interval,
    # so a steady allowance with burst headroom for scaled-out scrapers.
    "metrics": (60.0, 1.0),
    # telemetry: crash-report / telemetry ingestion. Clients batch and
    # may burst after an offline period.
    "telemetry": (60.0, 1.0),
    # account_export: GDPR data export — expensive, intentionally rare.
    "account_export": (5.0, 0.05),
    # account_delete: GDPR account deletion — destructive, intentionally
    # rare.
    "account_delete": (5.0, 0.05),
}


class _Bucket:
    """One token bucket per (bucket_name, ip) key."""

    __slots__ = ("tokens", "last_refill", "_lock")

    def __init__(self, capacity: float) -> None:
        self.tokens = capacity
        self.last_refill = time.monotonic()
        self._lock = threading.Lock()

    def take(self, capacity: float, refill_rate: float) -> float:
        """Try to consume one token. Return wait_seconds (0 if granted,
        > 0 if denied — the caller surfaces this as Retry-After)."""
        with self._lock:
            now = time.monotonic()
            elapsed = now - self.last_refill
            self.last_refill = now
            self.tokens = min(capacity, self.tokens + elapsed * refill_rate)
            if self.tokens >= 1.0:
                self.tokens -= 1.0
                return 0.0
            # Fractional token still missing — when does the next full
            # token arrive? `(1 - tokens) / refill_rate` seconds.
            need = 1.0 - self.tokens
            return need / refill_rate if refill_rate > 0 else 60.0


# Global registry — keyed by (bucket_name, client_ip).
_REGISTRY: dict[tuple[str, str], _Bucket] = {}
_REGISTRY_LOCK = threading.Lock()


def _client_ip(request: Request) -> str:
    """Best-effort client IP. Behind CloudFront the trusted header is
    `CloudFront-Viewer-Address` (the IP-only variant is preferred);
    behind a generic proxy `X-Forwarded-For` is the fallback. Strips
    port if present.
    """
    cf = request.headers.get("cloudfront-viewer-address")
    if cf:
        # Format: "ip:port" — split off port.
        return cf.split(":", 1)[0]
    xff = request.headers.get("x-forwarded-for")
    if xff:
        # First entry is the original client; subsequent are proxies.
        return xff.split(",", 1)[0].strip()
    return request.client.host if request.client else "unknown"


def rate_limit(bucket: str) -> Callable[[Request], None]:
    """FastAPI dependency factory for a named bucket.

    Raises HTTPException 429 with a Retry-After header when the bucket
    is empty for the calling client.
    """
    if bucket not in _DEFAULT_BUCKETS:
        raise ValueError(
            f"Unknown rate-limit bucket {bucket!r}. "
            f"Add it to _DEFAULT_BUCKETS in app/core/rate_limit.py."
        )

    capacity, refill_rate = _DEFAULT_BUCKETS[bucket]

    def _check(request: Request) -> None:
        ip = _client_ip(request)
        key = (bucket, ip)
        with _REGISTRY_LOCK:
            b = _REGISTRY.get(key)
            if b is None:
                b = _Bucket(capacity)
                _REGISTRY[key] = b
        wait = b.take(capacity, refill_rate)
        if wait > 0:
            retry_after = max(1, int(wait + 0.5))
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Rate limit exceeded for bucket {bucket!r}",
                headers={"Retry-After": str(retry_after)},
            )

    return _check
