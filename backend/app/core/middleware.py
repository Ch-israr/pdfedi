"""HTTP middleware: security headers, correlation IDs, request size limits.

Security headers applied to every response:
- Strict-Transport-Security (HSTS)
- X-Content-Type-Options: nosniff
- Referrer-Policy
- Permissions-Policy (minimal)
- X-Frame-Options: DENY (API should never be framed)
- Content-Security-Policy is most relevant for the frontend; the API sets a
  restrictive default as defense in depth.
"""
from __future__ import annotations

import time

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.config import get_settings
from app.core.errors import AppException, ErrorCode
from app.core.logging import get_logger, set_request_id

log = get_logger("pdfedi.middleware")
settings = get_settings()

SECURITY_HEADERS = {
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
}


class SecurityMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        request_id = request.headers.get("X-Request-ID") or set_request_id()
        set_request_id(request_id)

        # Enforce a hard request-body ceiling (defense in depth; route-level
        # limits for uploads are stricter and plan-aware).
        max_bytes = settings.request_body_max_mb * 1024 * 1024
        clen = request.headers.get("content-length")
        if clen and clen.isdigit() and int(clen) > max_bytes:
            raise AppException(
                message=f"Request body exceeds {settings.request_body_max_mb} MB.",
            )

        start = time.perf_counter()
        try:
            response: Response = await call_next(request)
        except AppException as e:
            from app.main import _app_error_response  # deferred to avoid cycle

            response = _app_error_response(request, e)
        duration_ms = (time.perf_counter() - start) * 1000

        for k, v in SECURITY_HEADERS.items():
            response.headers.setdefault(k, v)
        response.headers["X-Request-ID"] = request_id

        log.info(
            "request",
            method=request.method,
            path=request.url.path,
            status=response.status_code,
            duration_ms=round(duration_ms, 1),
        )
        return response


def error_body(*, code: str, message: str, request_id: str, details: dict | None = None, retryable: bool = False) -> dict:
    return {
        "error": {
            "code": code or ErrorCode.INTERNAL_ERROR,
            "message": message,
            "details": details or {},
            "request_id": request_id,
            "retryable": retryable,
        }
    }
