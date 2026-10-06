"""Subscription plans, entitlements and quota enforcement.

The entitlement layer is the single source of truth for "what can this
user do right now". Every protected action resolves the user's effective
plan server-side; the client never supplies plan, quota or role.

Entitlement keys:
- ``tool.<key>``        -> "true"/"false" (tool access)
- ``limit.max_upload_mb`` -> int
- ``limit.max_pages``     -> int
- ``limit.max_jobs_day``  -> int
- ``limit.max_jobs_month``-> int
- ``limit.max_ocr_pages_month`` -> int
- ``limit.max_storage_mb``-> int
- ``limit.max_concurrent``-> int
- ``limit.priority``      -> int (lower = sooner)
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.errors import PlanLimitExceeded, QuotaExceeded, SubscriptionRequired, ToolNotEntitled
from app.core.logging import get_logger
from app.db.models import Entitlement, Subscription, SubscriptionPlan, UsageRecord, User
from app.db.models.enums import SubscriptionStatus

log = get_logger("pdfedi.subscriptions")

ACTIVE_STATUSES = {SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING}


def _now():
    return datetime.now(timezone.utc)


def current_period() -> str:
    return _now().strftime("%Y-%m")


def get_active_subscription(db: Session, user_id: uuid.UUID) -> Subscription | None:
    return db.scalar(
        select(Subscription)
        .where(Subscription.user_id == user_id, Subscription.status.in_(ACTIVE_STATUSES))
        .order_by(Subscription.created_at.desc())
    )


def get_effective_plan(db: Session, user_id: uuid.UUID) -> SubscriptionPlan:
    """Resolve the user's plan: active subscription, else the free plan."""
    sub = get_active_subscription(db, user_id)
    if sub:
        return sub.plan
    return get_free_plan(db)


def get_free_plan(db: Session) -> SubscriptionPlan:
    """Get the free plan for guest/anonymous users."""
    free = db.scalar(select(SubscriptionPlan).where(SubscriptionPlan.code == "free", SubscriptionPlan.active.is_(True)))
    if not free:
        raise SubscriptionRequired("No active subscription and no free plan configured.")
    return free


def entitlements_for_plan(plan: SubscriptionPlan) -> dict[str, str]:
    ent: dict[str, str] = {}
    for tool in plan.enabled_tools:
        ent[f"tool.{tool}"] = "true"
    ent["limit.max_upload_mb"] = str(plan.max_upload_mb)
    ent["limit.max_pages"] = str(plan.max_pages_per_pdf)
    ent["limit.max_jobs_day"] = str(plan.max_jobs_per_day)
    ent["limit.max_jobs_month"] = str(plan.max_jobs_per_month)
    ent["limit.max_ocr_pages_month"] = str(plan.max_ocr_pages_per_month)
    ent["limit.max_storage_mb"] = str(plan.max_storage_mb)
    ent["limit.max_concurrent"] = str(plan.max_concurrent_jobs)
    ent["limit.priority"] = str(plan.processing_priority)
    # Extra flexible limits from the JSONB column
    for k, v in (plan.limits or {}).items():
        ent[f"limit.{k}"] = json.dumps(v)
    return ent


def materialize_entitlements(db: Session, user: User, plan: SubscriptionPlan, subscription_id: uuid.UUID | None) -> None:
    """End-date old entitlements, write fresh ones. History is immutable."""
    now = _now()
    for e in db.scalars(select(Entitlement).where(Entitlement.user_id == user.id, Entitlement.active_until.is_(None))):
        e.active_until = now
    for key, value in entitlements_for_plan(plan).items():
        db.add(
            Entitlement(
                user_id=user.id,
                plan_id=plan.id,
                subscription_id=subscription_id,
                entitlement_key=key,
                entitlement_value=value,
                active_from=now,
            )
        )
    db.commit()


def check_tool_entitled(db: Session, user: User, tool_key: str) -> SubscriptionPlan:
    plan = get_effective_plan(db, user.id)
    if tool_key not in (plan.enabled_tools or []):
        raise ToolNotEntitled(f"The '{tool_key}' tool is not included in your plan.")
    return plan


def _usage_sum(db: Session, user_id: uuid.UUID, metric: str, period: str) -> int:
    return (
        db.scalar(
            select(func.coalesce(func.sum(UsageRecord.metric_value), 0)).where(
                UsageRecord.user_id == user_id,
                UsageRecord.metric_type == metric,
                UsageRecord.billing_period == period,
            )
        )
        or 0
    )


def check_job_quota(db: Session, user: User, plan: SubscriptionPlan) -> None:
    """Enforce per-day and per-month job quotas before a job is queued."""
    period_month = current_period()
    today = _now().date().isoformat()
    day_count = _usage_sum(db, user.id, f"job_day:{today}", period_month)
    month_count = _usage_sum(db, user.id, "job", period_month)
    if day_count >= plan.max_jobs_per_day:
        raise QuotaExceeded(f"Daily job limit reached ({plan.max_jobs_per_day}). Try again tomorrow.")
    if month_count >= plan.max_jobs_per_month:
        raise QuotaExceeded(f"Monthly job limit reached ({plan.max_jobs_per_month}).")


def record_usage(
    db: Session,
    *,
    user_id: uuid.UUID,
    metric_type: str,
    metric_value: int = 1,
    job_id: uuid.UUID | None = None,
    subscription_id: uuid.UUID | None = None,
    meta: dict | None = None,
) -> None:
    period = current_period()
    db.add(
        UsageRecord(
            user_id=user_id,
            subscription_id=subscription_id,
            job_id=job_id,
            metric_type=metric_type,
            metric_value=metric_value,
            billing_period=period,
            recorded_at=_now(),
            meta=meta or {},
        )
    )
    # Also track a per-day job counter for daily quotas
    if metric_type == "job":
        db.add(
            UsageRecord(
                user_id=user_id,
                subscription_id=subscription_id,
                job_id=job_id,
                metric_type=f"job_day:{_now().date().isoformat()}",
                metric_value=metric_value,
                billing_period=period,
                recorded_at=_now(),
                meta=meta or {},
            )
        )


def usage_summary(db: Session, user: User) -> dict:
    plan = get_effective_plan(db, user.id)
    period = current_period()
    return {
        "plan_code": plan.code,
        "plan_name": plan.name,
        "period": period,
        "jobs_this_month": _usage_sum(db, user.id, "job", period),
        "jobs_today": _usage_sum(db, user.id, f"job_day:{_now().date().isoformat()}", period),
        "pages_this_month": _usage_sum(db, user.id, "page", period),
        "ocr_pages_this_month": _usage_sum(db, user.id, "ocr_page", period),
        "limits": {
            "max_jobs_day": plan.max_jobs_per_day,
            "max_jobs_month": plan.max_jobs_per_month,
            "max_upload_mb": plan.max_upload_mb,
            "max_pages_per_pdf": plan.max_pages_per_pdf,
            "max_ocr_pages_month": plan.max_ocr_pages_per_month,
            "max_storage_mb": plan.max_storage_mb,
        },
        "enabled_tools": plan.enabled_tools,
    }


def ensure_default_plans(db: Session) -> None:
    """Seed the free/pro plans if none exist. Idempotent."""
    if db.scalar(select(SubscriptionPlan).where(SubscriptionPlan.code == "free")):
        return
    free = SubscriptionPlan(
        code="free",
        name="Free",
        category="free",
        billing_interval="none",
        price_cents=0,
        currency="USD",
        active=True,
        public=True,
        enabled_tools=["merge", "split", "metadata", "extract_text", "thumbnails"],
        max_upload_mb=25,
        max_pages_per_pdf=200,
        max_jobs_per_day=10,
        max_jobs_per_month=100,
        max_ocr_pages_per_month=0,
        max_storage_mb=500,
        max_concurrent_jobs=1,
    )
    pro = SubscriptionPlan(
        code="pro_monthly",
        name="Pro Monthly",
        category="monthly",
        billing_interval="monthly",
        price_cents=1200,
        currency="USD",
        active=True,
        public=True,
        enabled_tools=[
            "merge", "split", "reorder_pages", "rotate_pages", "delete_pages",
            "extract_text", "thumbnails", "ocr", "watermark", "password_protect",
            "images_to_pdf", "pdf_to_images", "compress", "metadata",
        ],
        max_upload_mb=200,
        max_pages_per_pdf=2000,
        max_jobs_per_day=200,
        max_jobs_per_month=2000,
        max_ocr_pages_per_month=500,
        max_storage_mb=10240,
        max_concurrent_jobs=4,
        processing_priority=2,
    )
    db.add_all([free, pro])
    db.commit()
    log.info("default_plans_seeded")
