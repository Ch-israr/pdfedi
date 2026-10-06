"""Shared enums used across models."""
from __future__ import annotations

import enum


class AccountStatus(str, enum.Enum):
    PENDING_VERIFICATION = "pending_verification"
    ACTIVE = "active"
    SUSPENDED = "suspended"
    LOCKED = "locked"
    BANNED = "banned"
    DELETED = "deleted"


class SubscriptionStatus(str, enum.Enum):
    TRIALING = "trialing"
    ACTIVE = "active"
    PAST_DUE = "past_due"
    CANCELED = "canceled"
    EXPIRED = "expired"
    INCOMPLETE = "incomplete"


class PlanCategory(str, enum.Enum):
    FREE = "free"
    TRIAL = "trial"
    MONTHLY = "monthly"
    ANNUAL = "annual"
    BUSINESS = "business"
    ENTERPRISE = "enterprise"


class JobStatus(str, enum.Enum):
    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"
    EXPIRED = "expired"


class FileUploadStatus(str, enum.Enum):
    PENDING = "pending"
    VALIDATED = "validated"
    FAILED = "failed"
    EXPIRED = "expired"
    DELETED = "deleted"


class StorageClass(str, enum.Enum):
    INPUT = "input"
    OUTPUT = "output"
    TEMP = "temp"
    PREVIEW = "preview"
