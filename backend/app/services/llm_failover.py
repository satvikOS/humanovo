"""
LLM provider failover primitive.

Existing discovery_orchestrator.py calls Bedrock + Azure deployments
directly; a 5xx from a single provider currently aborts the entire
pipeline run. This primitive wraps a list of provider attempts so a
caller can declare "Bedrock Opus first, fall back to Azure GPT-4o,
fall back to Azure o3-mini if both fail" without re-implementing the
retry + timing + telemetry boilerplate at every call site.

Designed as a *standalone* helper the orchestrator (and any new
endpoint that calls LLMs) opts into incrementally. Adoption looks
like:

    from app.services.llm_failover import call_with_failover, LLMAttempt

    response = await call_with_failover([
        LLMAttempt(
            label="bedrock-opus",
            invoke=lambda: orchestrator._invoke_bedrock(opus_id, prompt, sys, max_t, temp),
            timeout_s=20,
        ),
        LLMAttempt(
            label="azure-gpt-4o",
            invoke=lambda: orchestrator._azure_gpt4o_client.chat.completions.create(...),
            timeout_s=20,
        ),
    ])
    print(response.text, response.winning_label, response.attempts_tried)

Telemetry: every attempt's outcome (success / timeout / error) is
recorded into the response object so the caller can persist the
trail. The structured-log line emitted on failover surfaces in
CloudWatch / wherever the operator's log sink is.

Failure modes:
  * All attempts fail        → AllProvidersFailed exception with the
                               per-attempt errors enumerated.
  * Timeout on every attempt → AllProvidersFailed (timeouts count as
                               errors for this purpose).
  * Empty attempts list      → ValueError (programmer mistake).

Caller is responsible for dispatching the per-attempt callable —
this helper doesn't know how to invoke a Bedrock model vs an Azure
deployment, only how to sequence attempts. Keeps the primitive
provider-agnostic + test-friendly (the test mocks just two
callables, no SDK setup needed).
"""
from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import Awaitable, Callable

logger = logging.getLogger(__name__)


@dataclass
class LLMAttempt:
    """One attempt in the failover chain.

    `label` is a human-readable provider/model identifier surfaced in
    structured logs and the response object so the operator can tell
    which provider answered + which failed. `invoke` is a zero-arg
    callable returning a coroutine that resolves to the LLM's text
    response. `timeout_s` defaults to 30 s — Bedrock + Azure both
    typically respond in 1-15 s for non-streaming calls.
    """
    label: str
    invoke: Callable[[], Awaitable[str]]
    timeout_s: float = 30.0


@dataclass
class AttemptOutcome:
    """Per-attempt record persisted on the response."""
    label: str
    succeeded: bool
    duration_ms: int
    error: str | None = None


@dataclass
class FailoverResponse:
    """Result of `call_with_failover`. The text + which attempt won +
    the trail of every attempt (succeeded or not) so callers can
    persist the failover decision for cost / availability analytics."""
    text: str
    winning_label: str
    attempts_tried: int
    outcomes: list[AttemptOutcome] = field(default_factory=list)


class AllProvidersFailed(RuntimeError):
    """Raised when every attempt in the chain failed.

    The exception carries the full attempt log via `outcomes` so
    the caller can include all errors in the surfaced message
    (otherwise only the last error would be visible).
    """
    def __init__(self, outcomes: list[AttemptOutcome]):
        self.outcomes = outcomes
        # Compose a one-line summary of every attempt's failure.
        summary = "; ".join(f"{o.label}={o.error or 'unknown'}" for o in outcomes)
        super().__init__(f"All {len(outcomes)} LLM attempts failed: {summary}")


async def call_with_failover(attempts: list[LLMAttempt]) -> FailoverResponse:
    """Try each attempt in order, return the first one that succeeds.

    On success: returns `FailoverResponse(text, winning_label, ...)`
    with the outcome trail through the winning attempt (failed
    attempts before the winner are recorded; later attempts are
    not run).

    On all-failure: raises `AllProvidersFailed` with the full
    outcome trail.
    """
    if not attempts:
        raise ValueError("call_with_failover requires at least one attempt")

    outcomes: list[AttemptOutcome] = []
    for idx, attempt in enumerate(attempts):
        t0 = time.monotonic()
        try:
            text = await asyncio.wait_for(attempt.invoke(), timeout=attempt.timeout_s)
            duration_ms = int((time.monotonic() - t0) * 1000)
            outcomes.append(AttemptOutcome(
                label=attempt.label,
                succeeded=True,
                duration_ms=duration_ms,
            ))
            # Structured log on the failover decision — every time we
            # didn't pick the primary, that's a signal an operator
            # wants visible in the log sink.
            if idx > 0:
                logger.warning(
                    "llm_failover: primary failed, fell back to %s (after %d failed attempts)",
                    attempt.label, idx,
                )
            return FailoverResponse(
                text=text,
                winning_label=attempt.label,
                attempts_tried=idx + 1,
                outcomes=outcomes,
            )
        except asyncio.TimeoutError:
            duration_ms = int((time.monotonic() - t0) * 1000)
            outcomes.append(AttemptOutcome(
                label=attempt.label,
                succeeded=False,
                duration_ms=duration_ms,
                error=f"timeout after {attempt.timeout_s}s",
            ))
            logger.warning("llm_failover: %s timed out after %.1fs", attempt.label, attempt.timeout_s)
        except Exception as e:
            duration_ms = int((time.monotonic() - t0) * 1000)
            # Cap error text so a 10 KB stack trace doesn't pollute
            # downstream logging or the response object that bubbles
            # up to the user.
            err_text = str(e)[:500] or type(e).__name__
            outcomes.append(AttemptOutcome(
                label=attempt.label,
                succeeded=False,
                duration_ms=duration_ms,
                error=err_text,
            ))
            logger.warning("llm_failover: %s failed: %s", attempt.label, err_text)

    raise AllProvidersFailed(outcomes)
