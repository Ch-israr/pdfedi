"""Pydantic v2 request/response schemas for /api/v1.

Naming: <Resource><Action>Request / <Resource>Response.
All responses use the standard envelope via FastAPI directly (data at top
level); errors use the {"error": {...}} format from app.core.errors.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, EmailStr, Field, field_validator


# --- Auth ---
class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    first_name: str | None = Field(default=None, max_length=100)
    last_name: str | None = Field(default=None, max_length=100)

    @field_validator("password")
    @classmethod
    def _password_strength(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters.")
        if not any(c.isdigit() for c in v) or not any(c.isalpha() for c in v):
            raise ValueError("Password must contain letters and numbers.")
        return v


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)
    device_label: str | None = Field(default=None, max_length=200)


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int  # seconds until access token expiry


class RefreshRequest(BaseModel):
    refresh_token: str


class VerifyEmailRequest(BaseModel):
    token: str


class PasswordResetRequest(BaseModel):
    email: EmailStr


class PasswordResetConfirm(BaseModel):
    token: str
    new_password: str = Field(min_length=8, max_length=128)


class SessionResponse(BaseModel):
    id: uuid.UUID
    device_label: str | None
    ip_address: str | None
    issued_at: datetime
    last_used_at: datetime | None
    current: bool = False


# --- Account / users ---
class UserResponse(BaseModel):
    id: uuid.UUID
    email: str
    first_name: str | None
    last_name: str | None
    display_name: str | None
    account_status: str
    email_verified: bool
    locale: str
    timezone: str
    created_at: datetime
    roles: list[str] = []

    model_config = {"from_attributes": True}


class UpdateProfileRequest(BaseModel):
    first_name: str | None = Field(default=None, max_length=100)
    last_name: str | None = Field(default=None, max_length=100)
    display_name: str | None = Field(default=None, max_length=150)
    locale: str | None = Field(default=None, max_length=16)
    timezone: str | None = Field(default=None, max_length=64)


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=128)


# --- Plans / subscriptions ---
class PlanResponse(BaseModel):
    code: str
    name: str
    category: str
    billing_interval: str | None
    price_cents: int
    currency: str
    max_upload_mb: int
    max_pages_per_pdf: int
    max_jobs_per_day: int
    max_jobs_per_month: int
    enabled_tools: list[str]

    model_config = {"from_attributes": True}


class SubscriptionResponse(BaseModel):
    id: uuid.UUID
    plan: PlanResponse
    status: str
    current_period_start: datetime | None
    current_period_end: datetime | None
    cancel_at_period_end: bool

    model_config = {"from_attributes": True}


class UsageResponse(BaseModel):
    plan_code: str
    plan_name: str
    period: str
    jobs_this_month: int
    jobs_today: int
    pages_this_month: int
    ocr_pages_this_month: int
    limits: dict[str, Any]
    enabled_tools: list[str]


# --- Files ---
class FileResponse(BaseModel):
    id: uuid.UUID
    display_name: str
    content_type: str
    size_bytes: int
    page_count: int | None
    upload_status: str
    created_at: datetime

    model_config = {"from_attributes": True}


class UploadCompleteResponse(BaseModel):
    file: dict[str, Any]


# --- Tools ---
class ToolInfoResponse(BaseModel):
    key: str
    name: str
    description: str
    version: str
    accepted_types: list[str]
    min_inputs: int
    max_inputs: int
    entitled: bool
    config_schema: dict[str, Any]


# --- Jobs ---
class JobCreateRequest(BaseModel):
    tool_key: str
    file_ids: list[uuid.UUID] = Field(min_length=1, max_length=50)
    config: dict[str, Any] = Field(default_factory=dict)
    idempotency_key: str | None = Field(default=None, max_length=128)


class JobResponse(BaseModel):
    id: uuid.UUID
    tool_key: str
    tool_version: str
    status: str
    progress_percent: int
    error_code: str | None
    error_reference: str | None
    created_at: datetime | None
    started_at: datetime | None
    completed_at: datetime | None
    outputs: list[dict[str, Any]]


# --- Pagination ---
class PageResponse(BaseModel):
    items: list[Any]
    next_cursor: str | None = None
    total: int | None = None
