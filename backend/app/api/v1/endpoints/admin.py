"""Admin API: /api/v1/admin/*

Every endpoint requires an admin role (see core.deps) AND logs to the
append-only admin_audit_logs table. Admin pages must additionally send
X-Robots-Tag: noindex, nofollow (set in main.py for /api/v1/admin/* and
documented for the frontend).

Roles: super_admin, admin, support_viewer, subscription_manager,
operations_manager.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.deps import get_db, require_admin, require_admin_viewer, require_super_admin
from app.core.errors import AdminForbidden, NotFound
from app.core.rate_limit import rate_limit
from app.db.models import (
    AdminAuditLog,
    FeatureFlag,
    File,
    ProcessingJob,
    Role,
    Subscription,
    SubscriptionPlan,
    SystemSetting,
    UsageRecord,
    User,
    UserRole,
)
from app.db.models.enums import AccountStatus, JobStatus, SubscriptionStatus
from app.schemas.v1 import PageResponse

router = APIRouter()


def _now():
    return datetime.now(timezone.utc)


def audit(db: Session, *, admin: User, action: str, request: Request,
          target_type: str | None = None, target_id: str | None = None,
          old: dict | None = None, new: dict | None = None) -> None:
    db.add(
        AdminAuditLog(
            admin_user_id=admin.id,
            action=action,
            target_type=target_type,
            target_id=target_id,
            old_value=old or {},
            new_value=new or {},
            ip_address=request.client.host if request.client else None,
            user_agent=(request.headers.get("user-agent") or "")[:500],
        )
    )
    db.commit()


# ---------- Dashboard ----------
@router.get("/dashboard")
def dashboard(admin: User = Depends(require_admin_viewer), db: Session = Depends(get_db)):
    total_users = db.scalar(select(func.count()).select_from(User).where(User.deleted_at.is_(None)))
    active_users = db.scalar(select(func.count()).select_from(User).where(User.account_status == AccountStatus.ACTIVE))
    new_7d = db.scalar(select(func.count()).select_from(User).where(User.created_at >= _now() - timedelta(days=7)))
    subs_by_plan = db.execute(
        select(SubscriptionPlan.code, func.count()).join(Subscription, Subscription.plan_id == SubscriptionPlan.id)
        .where(Subscription.status.in_([SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING]))
        .group_by(SubscriptionPlan.code)
    ).all()
    jobs_by_tool = db.execute(select(ProcessingJob.tool_key, func.count()).group_by(ProcessingJob.tool_key)).all()
    jobs_by_status = db.execute(select(ProcessingJob.status, func.count()).group_by(ProcessingJob.status)).all()
    storage_bytes = db.scalar(select(func.coalesce(func.sum(File.size_bytes), 0)).where(File.deleted_at.is_(None)))
    recent_errors = db.scalar(
        select(func.count()).select_from(ProcessingJob).where(ProcessingJob.status == JobStatus.FAILED,
                                                              ProcessingJob.created_at >= _now() - timedelta(days=1))
    )
    return {
        "users": {"total": total_users, "active": active_users, "new_7d": new_7d},
        "subscriptions_by_plan": [{"plan": p, "count": c} for p, c in subs_by_plan],
        "jobs_by_tool": [{"tool": t, "count": c} for t, c in jobs_by_tool],
        "jobs_by_status": [{"status": s, "count": c} for s, c in jobs_by_status],
        "storage_bytes": storage_bytes,
        "failed_jobs_24h": recent_errors,
    }


# ---------- User management ----------
@router.get("/users", response_model=PageResponse)
def admin_list_users(
    admin: User = Depends(require_admin_viewer), db: Session = Depends(get_db),
    q: str | None = Query(default=None), limit: int = Query(default=20, le=100),
    cursor: str | None = Query(default=None),
):
    # Keyset pagination on (created_at DESC, id DESC). Cursor = "created_at_iso|id".
    query = select(User).where(User.deleted_at.is_(None))
    if q:
        query = query.where(User.normalized_email.contains(q.lower()))
    if cursor:
        try:
            ts_str, id_str = cursor.split("|", 1)
            cursor_ts = datetime.fromisoformat(ts_str)
            cursor_id = uuid.UUID(id_str)
            query = query.where(
                (User.created_at < cursor_ts)
                | ((User.created_at == cursor_ts) & (User.id < cursor_id))
            )
        except (ValueError, AttributeError):
            pass  # invalid cursor — start from the beginning
    query = query.order_by(User.created_at.desc(), User.id.desc()).limit(limit + 1)
    rows = list(db.scalars(query))
    next_cursor = None
    if len(rows) > limit:
        rows = rows[:limit]
        last = rows[-1]
        next_cursor = f"{last.created_at.isoformat()}|{last.id}"
    items = [
        {"id": str(u.id), "email": u.email, "display_name": u.display_name, "account_status": u.account_status,
         "email_verified": u.email_verified_at is not None, "created_at": u.created_at.isoformat(),
         "last_login_at": u.last_login_at.isoformat() if u.last_login_at else None}
        for u in rows
    ]
    return PageResponse(items=items, next_cursor=next_cursor)


@router.get("/users/{user_id}")
def admin_get_user(user_id: uuid.UUID, admin: User = Depends(require_admin_viewer), db: Session = Depends(get_db)):
    u = db.get(User, user_id)
    if not u:
        raise NotFound("User not found.")
    roles = [r.name for r in db.scalars(select(Role).join(UserRole, UserRole.role_id == Role.id).where(UserRole.user_id == u.id))]
    subs = db.scalars(select(Subscription).where(Subscription.user_id == u.id)).all()
    job_count = db.scalar(select(func.count()).select_from(ProcessingJob).where(ProcessingJob.owner_user_id == u.id))
    storage = db.scalar(select(func.coalesce(func.sum(File.size_bytes), 0)).where(File.owner_user_id == u.id, File.deleted_at.is_(None)))
    return {
        "id": str(u.id), "email": u.email, "display_name": u.display_name, "account_status": u.account_status,
        "email_verified": u.email_verified_at is not None, "locale": u.locale, "timezone": u.timezone,
        "created_at": u.created_at.isoformat(), "last_login_at": u.last_login_at.isoformat() if u.last_login_at else None,
        "roles": roles,
        "subscriptions": [{"id": str(s.id), "plan": s.plan.code, "status": s.status} for s in subs],
        "job_count": job_count, "storage_bytes": storage,
    }


@router.post("/users/{user_id}/suspend")
def admin_suspend_user(user_id: uuid.UUID, request: Request, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    u = db.get(User, user_id)
    if not u:
        raise NotFound("User not found.")
    if u.id == admin.id:
        raise AdminForbidden("You cannot suspend your own account.")
    old = {"account_status": u.account_status}
    u.account_status = AccountStatus.SUSPENDED
    audit(db, admin=admin, action="user.suspend", request=request, target_type="user", target_id=str(u.id), old=old, new={"account_status": "suspended"})
    return {"message": "User suspended."}


@router.post("/users/{user_id}/reactivate")
def admin_reactivate_user(user_id: uuid.UUID, request: Request, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    u = db.get(User, user_id)
    if not u:
        raise NotFound("User not found.")
    old = {"account_status": u.account_status}
    u.account_status = AccountStatus.ACTIVE
    audit(db, admin=admin, action="user.reactivate", request=request, target_type="user", target_id=str(u.id), old=old, new={"account_status": "active"})
    return {"message": "User reactivated."}


@router.post("/users/{user_id}/roles")
def admin_set_roles(user_id: uuid.UUID, body: dict, request: Request, admin: User = Depends(require_super_admin), db: Session = Depends(get_db)):
    """Replace the user's role set. Super-admin only. Body: {"roles": ["admin", ...]}"""
    u = db.get(User, user_id)
    if not u:
        raise NotFound("User not found.")
    wanted = set(body.get("roles", []))
    valid = {r.name for r in db.scalars(select(Role))}
    if not wanted.issubset(valid):
        raise NotFound(f"Unknown roles: {wanted - valid}")
    old_roles = [r.name for r in db.scalars(select(Role).join(UserRole, UserRole.role_id == Role.id).where(UserRole.user_id == u.id))]
    db.query(UserRole).filter(UserRole.user_id == u.id).delete()
    for name in wanted:
        role = db.scalar(select(Role).where(Role.name == name))
        db.add(UserRole(user_id=u.id, role_id=role.id, assigned_by=admin.id))
    audit(db, admin=admin, action="user.roles.set", request=request, target_type="user", target_id=str(u.id),
          old={"roles": old_roles}, new={"roles": sorted(wanted)})
    return {"message": "Roles updated.", "roles": sorted(wanted)}


@router.get("/audit-logs", response_model=PageResponse)
def admin_audit_logs(admin: User = Depends(require_admin_viewer), db: Session = Depends(get_db),
                     limit: int = Query(default=50, le=200)):
    rows = list(db.scalars(select(AdminAuditLog).order_by(AdminAuditLog.created_at.desc()).limit(limit)))
    return PageResponse(items=[{
        "id": str(a.id), "admin_user_id": str(a.admin_user_id), "action": a.action,
        "target_type": a.target_type, "target_id": a.target_id,
        "created_at": a.created_at.isoformat(), "ip_address": a.ip_address,
    } for a in rows])


# ---------- Subscription management ----------
@router.get("/plans")
def admin_list_plans(admin: User = Depends(require_admin_viewer), db: Session = Depends(get_db)):
    plans = db.scalars(select(SubscriptionPlan).order_by(SubscriptionPlan.price_cents)).all()
    return [{"id": str(p.id), "code": p.code, "name": p.name, "category": p.category, "active": p.active,
             "public": p.public, "price_cents": p.price_cents, "currency": p.currency,
             "enabled_tools": p.enabled_tools, "max_upload_mb": p.max_upload_mb,
             "max_pages_per_pdf": p.max_pages_per_pdf, "max_jobs_per_day": p.max_jobs_per_day,
             "max_jobs_per_month": p.max_jobs_per_month} for p in plans]


@router.post("/plans")
def admin_create_plan(body: dict, request: Request, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    """Create or update a plan by code. Audited."""
    code = body.get("code")
    if not code:
        raise NotFound("Plan code is required.")
    plan = db.scalar(select(SubscriptionPlan).where(SubscriptionPlan.code == code))
    if not plan:
        plan = SubscriptionPlan(code=code)
        db.add(plan)
    for field in ("name", "category", "billing_interval", "price_cents", "currency", "active", "public",
                  "enabled_tools", "limits", "max_upload_mb", "max_pages_per_pdf", "max_jobs_per_day",
                  "max_jobs_per_month", "max_ocr_pages_per_month", "max_storage_mb",
                  "retention_inputs_days", "retention_outputs_days", "processing_priority", "max_concurrent_jobs"):
        if field in body:
            setattr(plan, field, body[field])
    db.commit()
    # Invalidate cached plans so pricing pages reflect changes immediately
    from app.services import cache as cache_service
    cache_service.delete("plan", "list_public")
    cache_service.delete("plan", code)
    audit(db, admin=admin, action="plan.upsert", request=request, target_type="plan", target_id=code, new={"code": code})
    return {"message": "Plan saved.", "code": code}


@router.post("/users/{user_id}/subscription")
def admin_assign_subscription(user_id: uuid.UUID, body: dict, request: Request,
                              admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    """Assign/override a user's plan. Body: {"plan_code": "pro_monthly"}. Audited."""
    from app.services import subscription_service

    u = db.get(User, user_id)
    plan = db.scalar(select(SubscriptionPlan).where(SubscriptionPlan.code == body.get("plan_code")))
    if not u or not plan:
        raise NotFound("User or plan not found.")
    # End-date current subscriptions
    for s in db.scalars(select(Subscription).where(Subscription.user_id == u.id, Subscription.status.in_(
            [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING]))):
        s.status = SubscriptionStatus.CANCELED
    sub = Subscription(user_id=u.id, plan_id=plan.id, provider="manual", status=SubscriptionStatus.ACTIVE)
    db.add(sub)
    db.flush()
    subscription_service.materialize_entitlements(db, u, plan, sub.id)
    audit(db, admin=admin, action="subscription.assign", request=request, target_type="user",
          target_id=str(u.id), new={"plan_code": plan.code, "subscription_id": str(sub.id)})
    return {"message": f"Plan '{plan.code}' assigned.", "subscription_id": str(sub.id)}


@router.post("/users/{user_id}/subscription/cancel")
def admin_cancel_subscription(user_id: uuid.UUID, request: Request,
                              admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    """Cancel a user's active subscription (end it immediately). Audited."""
    from app.services import subscription_service

    u = db.get(User, user_id)
    if not u:
        raise NotFound("User not found.")
    cancelled = 0
    for s in db.scalars(select(Subscription).where(Subscription.user_id == u.id, Subscription.status.in_(
            [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING]))):
        old = {"status": s.status}
        s.status = SubscriptionStatus.CANCELED
        cancelled += 1
    if not cancelled:
        raise NotFound("No active subscription to cancel.")
    # Clear cached subscription so entitlement checks refresh immediately
    from app.services import cache as cache_service
    cache_service.invalidate_user(str(u.id))
    audit(db, admin=admin, action="subscription.cancel", request=request, target_type="user",
          target_id=str(u.id), old={"cancelled_count": 0}, new={"cancelled_count": cancelled})
    return {"message": f"Cancelled {cancelled} subscription(s). User falls back to free plan."}


@router.post("/users/{user_id}/block")
def admin_block_user(user_id: uuid.UUID, body: dict, request: Request,
                     admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    """Permanently block/ban a user. Body: {"reason": "..."}. Audited. Blocked users cannot log in."""
    u = db.get(User, user_id)
    if not u:
        raise NotFound("User not found.")
    if u.id == admin.id:
        raise AdminForbidden("You cannot block your own account.")
    old = {"account_status": u.account_status}
    u.account_status = AccountStatus.BANNED
    # Revoke all sessions so the blocked user is signed out everywhere
    from app.services import auth_service
    auth_service.logout_all(db, u.id)
    from app.services import cache as cache_service
    cache_service.invalidate_user(str(u.id))
    audit(db, admin=admin, action="user.block", request=request, target_type="user",
          target_id=str(u.id), old=old,
          new={"account_status": "banned", "reason": body.get("reason", "")})
    return {"message": "User permanently blocked. All sessions revoked."}


@router.post("/users/{user_id}/unblock")
def admin_unblock_user(user_id: uuid.UUID, request: Request,
                       admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    """Unblock a previously blocked/banned user (restores to active). Audited."""
    u = db.get(User, user_id)
    if not u:
        raise NotFound("User not found.")
    if u.account_status != AccountStatus.BANNED:
        raise NotFound("User is not blocked.")
    old = {"account_status": u.account_status}
    u.account_status = AccountStatus.ACTIVE
    from app.services import cache as cache_service
    cache_service.invalidate_user(str(u.id))
    audit(db, admin=admin, action="user.unblock", request=request, target_type="user",
          target_id=str(u.id), old=old, new={"account_status": "active"})
    return {"message": "User unblocked and reactivated."}


@router.delete("/users/{user_id}")
def admin_delete_user(user_id: uuid.UUID, request: Request,
                      admin: User = Depends(require_super_admin), db: Session = Depends(get_db)):
    """Soft-delete a user account (DELETED status). Super-admin only. Audited.
    Deleted users cannot log in or use the service. Data is retained for audit."""
    u = db.get(User, user_id)
    if not u:
        raise NotFound("User not found.")
    if u.id == admin.id:
        raise AdminForbidden("You cannot delete your own account.")
    old = {"account_status": u.account_status}
    u.account_status = AccountStatus.DELETED
    # Revoke all sessions
    from app.services import auth_service
    auth_service.logout_all(db, u.id)
    # Cancel active subscriptions
    for s in db.scalars(select(Subscription).where(Subscription.user_id == u.id, Subscription.status.in_(
            [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING]))):
        s.status = SubscriptionStatus.CANCELED
    from app.services import cache as cache_service
    cache_service.invalidate_user(str(u.id))
    audit(db, admin=admin, action="user.delete", request=request, target_type="user",
          target_id=str(u.id), old=old, new={"account_status": "deleted"})
    return {"message": "User account removed (soft-deleted). Sessions revoked, subscriptions cancelled."}


# ---------- Files & jobs ----------
@router.get("/jobs", response_model=PageResponse)
def admin_list_jobs(admin: User = Depends(require_admin_viewer), db: Session = Depends(get_db),
                    status: str | None = Query(default=None), tool: str | None = Query(default=None),
                    limit: int = Query(default=50, le=200)):
    q = select(ProcessingJob).order_by(ProcessingJob.created_at.desc()).limit(limit)
    if status:
        q = q.where(ProcessingJob.status == status)
    if tool:
        q = q.where(ProcessingJob.tool_key == tool)
    rows = list(db.scalars(q))
    from app.services import job_service

    return PageResponse(items=[job_service.job_to_public_dict(j) for j in rows])


@router.get("/files", response_model=PageResponse)
def admin_list_files(admin: User = Depends(require_admin_viewer), db: Session = Depends(get_db),
                     limit: int = Query(default=50, le=200)):
    rows = list(db.scalars(select(File).order_by(File.created_at.desc()).limit(limit)))
    return PageResponse(items=[{
        "id": str(f.id), "owner_user_id": str(f.owner_user_id), "display_name": f.safe_display_name,
        "size_bytes": f.size_bytes, "page_count": f.page_count, "upload_status": f.upload_status,
        "storage_class": f.storage_class, "created_at": f.created_at.isoformat(),
        # internal_storage_key deliberately omitted
    } for f in rows])


# ---------- Feature flags & settings ----------
@router.get("/feature-flags")
def admin_list_flags(admin: User = Depends(require_admin_viewer), db: Session = Depends(get_db)):
    return [{"key": f.key, "enabled": f.enabled, "config": f.config} for f in db.scalars(select(FeatureFlag))]


@router.post("/feature-flags/{key}")
def admin_set_flag(key: str, body: dict, request: Request, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    flag = db.get(FeatureFlag, key)
    if not flag:
        flag = FeatureFlag(key=key)
        db.add(flag)
    old = {"enabled": flag.enabled}
    flag.enabled = bool(body.get("enabled", False))
    if "config" in body:
        flag.config = body["config"]
    flag.updated_by = admin.id
    db.commit()
    audit(db, admin=admin, action="feature_flag.set", request=request, target_type="feature_flag",
          target_id=key, old=old, new={"enabled": flag.enabled})
    return {"key": key, "enabled": flag.enabled}


@router.get("/settings")
def admin_list_settings(admin: User = Depends(require_admin_viewer), db: Session = Depends(get_db)):
    return [{"key": s.key, "value": s.value} for s in db.scalars(select(SystemSetting))]


@router.post("/settings/{key}")
def admin_set_setting(key: str, body: dict, request: Request, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    if "secret" in key.lower() or "password" in key.lower() or "token" in key.lower():
        raise AdminForbidden("Secrets cannot be stored via system settings.")
    setting = db.get(SystemSetting, key)
    if not setting:
        setting = SystemSetting(key=key, value="")
        db.add(setting)
    old = {"value": setting.value[:100]}
    setting.value = str(body.get("value", ""))
    setting.updated_by = admin.id
    db.commit()
    audit(db, admin=admin, action="setting.set", request=request, target_type="setting", target_id=key, old=old)
    return {"key": key}


# ---------- Analytics ----------
@router.get("/analytics/usage")
def admin_analytics(admin: User = Depends(require_admin_viewer), db: Session = Depends(get_db),
                    days: int = Query(default=30, le=365)):
    since = _now() - timedelta(days=days)
    regs = db.scalar(select(func.count()).select_from(User).where(User.created_at >= since))
    jobs = db.execute(
        select(ProcessingJob.tool_key, ProcessingJob.status, func.count())
        .where(ProcessingJob.created_at >= since).group_by(ProcessingJob.tool_key, ProcessingJob.status)
    ).all()
    return {
        "days": days,
        "registrations": regs,
        "jobs": [{"tool": t, "status": s, "count": c} for t, s, c in jobs],
    }


# NOTE: Google Sheets sync was removed 2026-10-06 (privacy liability + NameError crash).
# The sheets_sync.py service and SHEETS_* config have been deleted.
