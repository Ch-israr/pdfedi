"""Plans, subscriptions and entitlements.

The entitlement model is the single source of truth for "what can this user
do". Plans define limits; subscriptions bind a user to a plan over time;
entitlements materialize the effective rights. The API never trusts a plan
or quota value supplied by the client.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Numeric, String, Text
from app.db.base import JSONVariant as JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import GUID, Base, TimestampMixin, UUIDMixin
from app.db.models.enums import PlanCategory, SubscriptionStatus


class SubscriptionPlan(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "subscription_plans"

    code: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)  # free, pro_monthly...
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    category: Mapped[PlanCategory] = mapped_column(String(32), nullable=False, index=True)
    billing_interval: Mapped[str | None] = mapped_column(String(32))  # monthly, annual, one_time, none
    price_cents: Mapped[int] = mapped_column(default=0, nullable=False)
    currency: Mapped[str] = mapped_column(String(8), default="USD", nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    public: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    # Flexible limits live in JSONB; core hot-path limits are columns.
    limits: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    enabled_tools: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    max_upload_mb: Mapped[int] = mapped_column(default=25, nullable=False)
    max_pages_per_pdf: Mapped[int] = mapped_column(default=200, nullable=False)
    max_jobs_per_day: Mapped[int] = mapped_column(default=10, nullable=False)
    max_jobs_per_month: Mapped[int] = mapped_column(default=100, nullable=False)
    max_ocr_pages_per_month: Mapped[int] = mapped_column(default=0, nullable=False)
    max_storage_mb: Mapped[int] = mapped_column(default=500, nullable=False)
    retention_inputs_days: Mapped[int] = mapped_column(default=7, nullable=False)
    retention_outputs_days: Mapped[int] = mapped_column(default=30, nullable=False)
    processing_priority: Mapped[int] = mapped_column(default=5, nullable=False)  # lower = sooner
    max_concurrent_jobs: Mapped[int] = mapped_column(default=1, nullable=False)

    subscriptions: Mapped[list["Subscription"]] = relationship(back_populates="plan")


class Subscription(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "subscriptions"

    user_id: Mapped[uuid.UUID] = mapped_column(GUID(), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    plan_id: Mapped[uuid.UUID] = mapped_column(GUID(), ForeignKey("subscription_plans.id"), nullable=False)
    provider: Mapped[str] = mapped_column(String(32), default="manual", nullable=False)  # manual|stripe|apple|google
    provider_customer_id: Mapped[str | None] = mapped_column(String(128))
    provider_subscription_id: Mapped[str | None] = mapped_column(String(128), index=True)
    status: Mapped[SubscriptionStatus] = mapped_column(String(32), default=SubscriptionStatus.ACTIVE, nullable=False, index=True)
    current_period_start: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    current_period_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    trial_start: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    trial_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    cancel_at_period_end: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    user: Mapped["User"] = relationship(back_populates="subscriptions")
    plan: Mapped[SubscriptionPlan] = relationship(back_populates="subscriptions")


class Entitlement(UUIDMixin, TimestampMixin, Base):
    """Materialized effective right for a user over a time range.

    Written by the subscription service whenever a subscription changes;
    history is immutable (old rows are end-dated, never updated).
    """

    __tablename__ = "entitlements"

    user_id: Mapped[uuid.UUID] = mapped_column(GUID(), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    plan_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), ForeignKey("subscription_plans.id"))
    subscription_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), ForeignKey("subscriptions.id"))
    entitlement_key: Mapped[str] = mapped_column(String(128), nullable=False, index=True)  # e.g. tool.ocr
    entitlement_value: Mapped[str] = mapped_column(Text, nullable=False)  # JSON-encoded value
    active_from: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    active_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


Index("ix_entitlements_user_key", Entitlement.user_id, Entitlement.entitlement_key)
