"""Standard error format and application exceptions.

Every API error response looks like::

    {
      "error": {
        "code": "AUTH_INVALID_CREDENTIALS",
        "message": "Invalid email or password.",
        "details": {...},            # optional, field errors etc.
        "request_id": "req_...",
        "retryable": false
      }
    }

Internal diagnostic details (tracebacks, SQL, file paths) never leave the
server; they go to structured logs and the admin diagnostics view.
"""
from __future__ import annotations

from typing import Any


class ErrorCode:
    # Auth / sessions
    AUTH_INVALID_CREDENTIALS = "AUTH_INVALID_CREDENTIALS"
    AUTH_EMAIL_NOT_VERIFIED = "AUTH_EMAIL_NOT_VERIFIED"
    AUTH_ACCOUNT_LOCKED = "AUTH_ACCOUNT_LOCKED"
    AUTH_ACCOUNT_SUSPENDED = "AUTH_ACCOUNT_SUSPENDED"
    AUTH_TOKEN_EXPIRED = "AUTH_TOKEN_EXPIRED"
    AUTH_TOKEN_INVALID = "AUTH_TOKEN_INVALID"
    AUTH_TOKEN_REVOKED = "AUTH_TOKEN_REVOKED"
    AUTH_MFA_REQUIRED = "AUTH_MFA_REQUIRED"
    AUTH_MFA_INVALID = "AUTH_MFA_INVALID"
    AUTH_RATE_LIMITED = "AUTH_RATE_LIMITED"
    # Authorization
    FORBIDDEN = "FORBIDDEN"
    NOT_FOUND = "NOT_FOUND"
    # Validation
    VALIDATION_ERROR = "VALIDATION_ERROR"
    # Files / uploads
    FILE_TOO_LARGE = "FILE_TOO_LARGE"
    FILE_TYPE_NOT_ALLOWED = "FILE_TYPE_NOT_ALLOWED"
    FILE_SIGNATURE_MISMATCH = "FILE_SIGNATURE_MISMATCH"
    FILE_CORRUPT = "FILE_CORRUPT"
    FILE_ENCRYPTED = "FILE_ENCRYPTED"
    FILE_PAGE_LIMIT_EXCEEDED = "FILE_PAGE_LIMIT_EXCEEDED"
    FILE_NOT_FOUND = "FILE_NOT_FOUND"
    FILE_EXPIRED = "FILE_EXPIRED"
    # Jobs / tools
    TOOL_NOT_FOUND = "TOOL_NOT_FOUND"
    TOOL_DISABLED = "TOOL_DISABLED"
    TOOL_NOT_ENTITLED = "TOOL_NOT_ENTITLED"
    JOB_NOT_FOUND = "JOB_NOT_FOUND"
    JOB_CONFLICT = "JOB_CONFLICT"
    JOB_FAILED = "JOB_FAILED"
    JOB_CANCELLED = "JOB_CANCELLED"
    # Subscriptions / quotas
    QUOTA_EXCEEDED = "QUOTA_EXCEEDED"
    PLAN_LIMIT_EXCEEDED = "PLAN_LIMIT_EXCEEDED"
    SUBSCRIPTION_REQUIRED = "SUBSCRIPTION_REQUIRED"
    SUBSCRIPTION_INACTIVE = "SUBSCRIPTION_INACTIVE"
    # Rate limiting
    RATE_LIMITED = "RATE_LIMITED"
    # Admin
    ADMIN_FORBIDDEN = "ADMIN_FORBIDDEN"
    # System
    INTERNAL_ERROR = "INTERNAL_ERROR"
    SERVICE_UNAVAILABLE = "SERVICE_UNAVAILABLE"
    CONFLICT = "CONFLICT"
    IDEMPOTENCY_CONFLICT = "IDEMPOTENCY_CONFLICT"


class AppException(Exception):
    """Base for all expected application errors."""

    code: str = ErrorCode.INTERNAL_ERROR
    message: str = "An unexpected error occurred."
    http_status: int = 500
    retryable: bool = False
    # Internal diagnostic reference, set by handlers (never from user input)
    internal_ref: str | None = None

    def __init__(
        self,
        message: str | None = None,
        *,
        details: dict[str, Any] | None = None,
        retryable: bool | None = None,
    ) -> None:
        super().__init__(message or self.message)
        if message:
            self.message = message
        self.details = details or {}
        if retryable is not None:
            self.retryable = retryable


# --- Auth ---
class InvalidCredentials(AppException):
    code = ErrorCode.AUTH_INVALID_CREDENTIALS
    message = "Invalid email or password."
    http_status = 401


class EmailNotVerified(AppException):
    code = ErrorCode.AUTH_EMAIL_NOT_VERIFIED
    message = "Please verify your email address before signing in."
    http_status = 403


class AccountLocked(AppException):
    code = ErrorCode.AUTH_ACCOUNT_LOCKED
    message = "This account is temporarily locked. Please try again later."
    http_status = 423


class AccountSuspended(AppException):
    code = ErrorCode.AUTH_ACCOUNT_SUSPENDED
    message = "This account has been suspended."
    http_status = 403


class AccountBanned(AppException):
    code = ErrorCode.AUTH_ACCOUNT_SUSPENDED
    message = "This account has been permanently blocked."
    http_status = 403


class AccountDeleted(AppException):
    code = ErrorCode.AUTH_ACCOUNT_SUSPENDED
    message = "This account no longer exists."
    http_status = 403


class TokenExpired(AppException):
    code = ErrorCode.AUTH_TOKEN_EXPIRED
    message = "Your session has expired. Please sign in again."
    http_status = 401


class TokenInvalid(AppException):
    code = ErrorCode.AUTH_TOKEN_INVALID
    message = "Invalid authentication token."
    http_status = 401


class TokenRevoked(AppException):
    code = ErrorCode.AUTH_TOKEN_REVOKED
    message = "This session has been revoked. Please sign in again."
    http_status = 401


# --- Authorization ---
class Forbidden(AppException):
    code = ErrorCode.FORBIDDEN
    message = "You do not have permission to perform this action."
    http_status = 403


class NotFound(AppException):
    code = ErrorCode.NOT_FOUND
    message = "The requested resource was not found."
    http_status = 404


class Conflict(AppException):
    code = ErrorCode.CONFLICT
    message = "The request conflicts with the current state."
    http_status = 409


# --- Files ---
class FileTooLarge(AppException):
    code = ErrorCode.FILE_TOO_LARGE
    message = "File exceeds the maximum allowed size for your plan."
    http_status = 413


class FileTypeNotAllowed(AppException):
    code = ErrorCode.FILE_TYPE_NOT_ALLOWED
    message = "This file type is not supported."
    http_status = 415


class FileSignatureMismatch(AppException):
    code = ErrorCode.FILE_SIGNATURE_MISMATCH
    message = "File content does not match its declared type."
    http_status = 422


class FileCorrupt(AppException):
    code = ErrorCode.FILE_CORRUPT
    message = "The file appears to be corrupted and could not be read."
    http_status = 422


class FileEncrypted(AppException):
    code = ErrorCode.FILE_ENCRYPTED
    message = "Password-protected PDFs require the password to be provided."
    http_status = 422


class FilePageLimit(AppException):
    code = ErrorCode.FILE_PAGE_LIMIT_EXCEEDED
    message = "PDF exceeds the maximum page count for your plan."
    http_status = 422


# --- Tools / jobs ---
class ToolNotFound(AppException):
    code = ErrorCode.TOOL_NOT_FOUND
    message = "Unknown tool."
    http_status = 404


class ToolDisabled(AppException):
    code = ErrorCode.TOOL_DISABLED
    message = "This tool is currently unavailable."
    http_status = 503


class ToolNotEntitled(AppException):
    code = ErrorCode.TOOL_NOT_ENTITLED
    message = "Your plan does not include this tool."
    http_status = 403


class JobNotFound(AppException):
    code = ErrorCode.JOB_NOT_FOUND
    message = "Job not found."
    http_status = 404


class JobFailed(AppException):
    code = ErrorCode.JOB_FAILED
    message = "Processing failed."
    http_status = 422


# --- Subscriptions / quotas ---
class QuotaExceeded(AppException):
    code = ErrorCode.QUOTA_EXCEEDED
    message = "You have reached your usage limit for this period."
    http_status = 429
    retryable = True


class PlanLimitExceeded(AppException):
    code = ErrorCode.PLAN_LIMIT_EXCEEDED
    message = "This exceeds a limit of your current plan."
    http_status = 403


class SubscriptionRequired(AppException):
    code = ErrorCode.SUBSCRIPTION_REQUIRED
    message = "An active subscription is required."
    http_status = 402


# --- Rate limiting ---
class RateLimited(AppException):
    code = ErrorCode.RATE_LIMITED
    message = "Too many requests. Please slow down and try again."
    http_status = 429
    retryable = True


# --- Admin ---
class AdminForbidden(AppException):
    code = ErrorCode.ADMIN_FORBIDDEN
    message = "Admin access required."
    http_status = 403
