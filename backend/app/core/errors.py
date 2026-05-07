"""
Centralized error-response helpers.

Endpoint exception handlers should NEVER pass `str(exc)` into the client
response — provider names, model names, internal stage names, stack
traces, and infra details routinely surface in those messages and
constitute IP / security leakage. Use `safe_error()` instead: it logs
the full exception server-side and returns a stable, opaque code that
the frontend (or downstream client) can branch on without knowing
anything about the internals.

Public catalogue of error codes is documented in CLIENT_API.md (TBA).
"""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import HTTPException

from app.core.logging import get_logger

logger = get_logger(__name__)


# Stable, client-facing error codes. Keep this list small and meaningful;
# every code is part of the public API contract.
class ErrorCode:
    INTERNAL = "internal_error"
    NOT_FOUND = "not_found"
    UNAUTHORIZED = "unauthorized"
    FORBIDDEN = "forbidden"
    BAD_REQUEST = "bad_request"
    RATE_LIMITED = "rate_limited"
    UPSTREAM_UNAVAILABLE = "upstream_unavailable"
    PIPELINE_FAILED = "pipeline_failed"
    VALIDATION_FAILED = "validation_failed"


# Default user-facing message per code. Deliberately generic — no infra,
# no model names, no stack traces.
_DEFAULT_MESSAGES: dict[str, str] = {
    ErrorCode.INTERNAL: "An unexpected error occurred. Please try again or contact support.",
    ErrorCode.NOT_FOUND: "The requested resource was not found.",
    ErrorCode.UNAUTHORIZED: "Authentication required.",
    ErrorCode.FORBIDDEN: "You do not have permission to access this resource.",
    ErrorCode.BAD_REQUEST: "The request was malformed or missing required fields.",
    ErrorCode.RATE_LIMITED: "Too many requests. Please slow down.",
    ErrorCode.UPSTREAM_UNAVAILABLE: "A required service is temporarily unavailable. Please retry shortly.",
    ErrorCode.PIPELINE_FAILED: "The discovery pipeline encountered an error. Your request was logged for review.",
    ErrorCode.VALIDATION_FAILED: "The provided input did not pass validation.",
}

_DEFAULT_HTTP_STATUS: dict[str, int] = {
    ErrorCode.INTERNAL: 500,
    ErrorCode.NOT_FOUND: 404,
    ErrorCode.UNAUTHORIZED: 401,
    ErrorCode.FORBIDDEN: 403,
    ErrorCode.BAD_REQUEST: 400,
    ErrorCode.RATE_LIMITED: 429,
    ErrorCode.UPSTREAM_UNAVAILABLE: 503,
    ErrorCode.PIPELINE_FAILED: 500,
    ErrorCode.VALIDATION_FAILED: 422,
}


def safe_error(
    exc: BaseException,
    *,
    code: str = ErrorCode.INTERNAL,
    status_code: int | None = None,
    user_message: str | None = None,
    log_context: dict[str, Any] | None = None,
) -> HTTPException:
    """Convert an exception into a sanitized FastAPI HTTPException.

    The full exception (with type, str, and structured context) is
    written to the server-side log under a unique trace_id. The trace_id
    is included in the response detail so that support can cross-reference
    a user-reported issue with the actual error without exposing it
    inline.

    Args:
        exc: the caught exception
        code: stable client-facing code (see ErrorCode constants)
        status_code: override the default HTTP status for the code
        user_message: override the default user-facing message
        log_context: extra fields for the server-side log entry

    Example:
        try:
            ...
        except Exception as exc:
            raise safe_error(exc, code=ErrorCode.PIPELINE_FAILED,
                             log_context={"disease": disease})
    """
    trace_id = uuid.uuid4().hex
    status = status_code or _DEFAULT_HTTP_STATUS.get(code, 500)
    message = user_message or _DEFAULT_MESSAGES.get(code, _DEFAULT_MESSAGES[ErrorCode.INTERNAL])

    context = dict(log_context or {})
    context.update(
        trace_id=trace_id,
        error_code=code,
        exception_type=type(exc).__name__,
    )
    # `str(exc)` may contain provider/model names — only log it; never
    # propagate it to the client response.
    logger.exception("request failed", **context)

    return HTTPException(
        status_code=status,
        detail={
            "code": code,
            "message": message,
            "trace_id": trace_id,
        },
    )
