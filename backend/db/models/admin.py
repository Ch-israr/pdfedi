"""Admin audit logs, feature flags, system settings, API keys."""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, String, Text
from app.db.base import JSONVariant as JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import GUID, Base, TimestampMixin, UUIDMixin, utcnow


class AdminAuditLog(UUIDMixin, Base):
    """Append-only record of privileged actions. Rows are never updated."""

    __tablename__ = "admin_audit_logs"

    admin_user_id: Mapped[uuid.UUID] = mapped_column(GUID(), ForeignKey("users.id", ondelete="SET NULL"), nullable=False, index=True)
    action: Mapped[str] = mapped_column(String(128), nullable=False, index=True)  # e.g. user.suspend
    target_type: Mapped[str | None] = mapped_column(String(64), index=True)
    target_id: Mapped[str | None] = mapped_column(String(128), index=True)
    old_value: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)  # safe summaries only
    new_value: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    ip_address: Mapped[str | None] = mapped_column(String(64))
    user_agent: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False, index=True)


class FeatureFlag(TimestampMixin, Base):
    __tablename__ = "feature_flags"

    key: Mapped[str] = mapped_column(String(128), primary_key=True)  # e.g. tool.ocr
    enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    config: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    updated_by: Mapped[uuid.UUID | None] = mapped_column(GUID(), ForeignKey("users.id", ondelete="SET NULL"))


class SystemSetting(TimestampMixin, Base):
    """Operational settings. NEVER store plaintext production secrets here."""

    __tablename__ = "system_settings"

    key: Mapped[str] = mapped_column(String(128), primary_key=True)
    value: Mapped[str] = mapped_column(Text, nullable=False)  # references/values, not secrets
    updated_by: Mapped[uuid.UUID | None] = mapped_column(GUID(), ForeignKey("users.id", ondelete="SET NULL"))


class ApiKey(UUIDMixin, TimestampMixin, Base):
    """Reserved for future developer/API access. Only the hash is stored."""

    __tablename__ = "api_keys"

    owner_user_id: Mapped[uuid.UUID] = mapped_column(GUID(), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    key_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    key_prefix: Mapped[str] = mapped_column(String(16), nullable=False)  # safe to display
    scopes: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    rate_limit_tier: Mapped[str] = mapped_column(String(32), default="standard", nullable=False)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


Index("ix_audit_admin_time", AdminAuditLog.admin_user_id, AdminAuditLog.created_at)
