"""Admin API: login + dashboard. Cookie (httpOnly) or bearer-token protected."""
from __future__ import annotations

import time
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db
from ..models import AdminLoginAttempt, AdminUser, File, Job
from ..security import (
    ADMIN_COOKIE_NAME,
    create_admin_token,
    hash_password,
    require_admin,
    verify_legacy_sha256,
    verify_password,
)
from ..timeutil import utcnow_iso
from .public import file_to_dict, job_to_dict

router = APIRouter()

# --- Login rate limiting (in-memory, per-IP) ---
# 5 failed attempts per 15 minutes -> 429 until the window slides past.
LOGIN_MAX_ATTEMPTS = 5
LOGIN_WINDOW_SECONDS = 15 * 60
_failed_logins: dict[str, list[float]] = {}


def _client_ip(request: Request) -> str:
    # Behind Render's proxy the real client IP arrives via X-Forwarded-For.
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _prune(ip: str) -> list[float]:
    cutoff = time.monotonic() - LOGIN_WINDOW_SECONDS
    attempts = [t for t in _failed_logins.get(ip, []) if t > cutoff]
    if attempts:
        _failed_logins[ip] = attempts
    else:
        _failed_logins.pop(ip, None)
    return attempts


def _record_attempt(db: Session, username: str, ip: str, success: bool) -> None:
    from datetime import datetime, timedelta, timezone

    db.add(
        AdminLoginAttempt(
            id=uuid.uuid4().hex,
            username=username,
            ip=ip,
            success=success,
            created_at=utcnow_iso(),
        )
    )
    # 7-day retention for audit data, same as analytics.
    cutoff = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    db.query(AdminLoginAttempt).filter(AdminLoginAttempt.created_at < cutoff).delete()
    db.commit()


class LoginBody(BaseModel):
    username: str
    password: str


@router.post("/login")
def login(body: LoginBody, request: Request, response: Response, db: Session = Depends(get_db)):
    settings = get_settings()
    ip = _client_ip(request)
    if len(_prune(ip)) >= LOGIN_MAX_ATTEMPTS:
        raise HTTPException(
            status_code=429,
            detail="Too many failed login attempts. Try again in 15 minutes.",
        )
    username = body.username.strip()
    user = db.query(AdminUser).filter(AdminUser.username == username).first()
    ok = user is not None and verify_password(body.password, user.password_hash)
    if not ok and user is not None and verify_legacy_sha256(body.password, user.password_hash):
        # Transparent upgrade: legacy SHA-256 hash -> argon2 on first login.
        user.password_hash = hash_password(body.password)
        db.commit()
        ok = True
    _record_attempt(db, username, ip, ok)
    if not ok or user is None:
        _failed_logins.setdefault(ip, []).append(time.monotonic())
        raise HTTPException(status_code=403, detail="Invalid credentials")
    token = create_admin_token(user.username)
    # httpOnly cookie is the primary auth transport; the JSON token is kept
    # for backward compatibility during the transition. Secure is derived
    # from the request scheme so local HTTP dev still works.
    response.set_cookie(
        ADMIN_COOKIE_NAME,
        token,
        max_age=settings.jwt_expire_hours * 3600,
        httponly=True,
        secure=request.url.scheme == "https",
        samesite="lax",
        path="/",
    )
    return {"token": token, "username": user.username}


@router.post("/logout")
def logout(response: Response):
    response.delete_cookie(ADMIN_COOKIE_NAME, path="/")
    return {"logged_out": True}


@router.get("/login-attempts")
def login_attempts(
    limit: int = 50, admin: AdminUser = Depends(require_admin), db: Session = Depends(get_db)
):
    limit = max(1, min(limit, 200))
    rows = (
        db.query(AdminLoginAttempt)
        .order_by(AdminLoginAttempt.created_at.desc())
        .limit(limit)
        .all()
    )
    return [
        {
            "username": r.username,
            "ip": r.ip,
            "success": r.success,
            "created_at": r.created_at,
        }
        for r in rows
    ]


@router.get("/analytics/export")
def export_analytics(
    table: str = Query("visits", pattern="^(visits|bots|logins|jobs)$"),
    db: Session = Depends(get_db),
    _admin=Depends(require_admin),
):
    """Download analytics data as CSV (7-day retention window)."""
    import csv
    import io
    from datetime import datetime, timedelta, timezone

    from fastapi.responses import StreamingResponse

    from ..models import AdminLoginAttempt, BotVisit, Job, Visit

    cutoff = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    buf = io.StringIO()
    w = csv.writer(buf)

    if table == "visits":
        w.writerow(["created_at", "ip_truncated", "country", "city", "device", "browser", "source", "path"])
        for v in db.query(Visit).filter(Visit.created_at >= cutoff).order_by(Visit.created_at.desc()).all():
            w.writerow([v.created_at, v.ip_trunc, v.country, v.city, v.device, v.browser, v.source, v.path])
    elif table == "bots":
        w.writerow(["created_at", "bot_name", "country", "path"])
        for b in db.query(BotVisit).filter(BotVisit.created_at >= cutoff).order_by(BotVisit.created_at.desc()).all():
            w.writerow([b.created_at, b.name, b.country, b.path])
    elif table == "logins":
        w.writerow(["created_at", "username", "success"])
        for a in db.query(AdminLoginAttempt).filter(AdminLoginAttempt.created_at >= cutoff).order_by(AdminLoginAttempt.created_at.desc()).all():
            w.writerow([a.created_at, a.username, a.success])
    else:  # jobs
        w.writerow(["created_at", "tool", "status", "error"])
        for j in db.query(Job).filter(Job.created_at >= cutoff).order_by(Job.created_at.desc()).all():
            w.writerow([j.created_at, j.tool, j.status, (j.error or "")[:200]])

    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=pdfedi-{table}-7d.csv"},
    )


@router.get("/analytics")
def analytics(
    days: int = 30, admin: AdminUser = Depends(require_admin), db: Session = Depends(get_db)
):
    from ..analytics import get_analytics

    days = max(1, min(days, 90))
    return get_analytics(db, days=days)


@router.get("/dashboard")
def dashboard(admin: AdminUser = Depends(require_admin), db: Session = Depends(get_db)):
    total_files = db.query(func.count(File.id)).scalar() or 0
    total_jobs = db.query(func.count(Job.id)).scalar() or 0
    jobs_by_status: dict[str, int] = {}
    for status, count in db.query(Job.status, func.count(Job.id)).group_by(Job.status).all():
        jobs_by_status[status] = count
    jobs_by_tool: dict[str, int] = {}
    for tool, count in db.query(Job.tool, func.count(Job.id)).group_by(Job.tool).all():
        jobs_by_tool[tool] = count
    recent_jobs = (
        db.query(Job).order_by(Job.created_at.desc()).limit(10).all()
    )
    return {
        "totals": {"files": total_files, "jobs": total_jobs},
        "jobs_by_status": jobs_by_status,
        "jobs_by_tool": jobs_by_tool,
        "recent_jobs": [job_to_dict(j) for j in recent_jobs],
    }


@router.get("/files")
def list_files(limit: int = 50, admin: AdminUser = Depends(require_admin), db: Session = Depends(get_db)):
    limit = max(1, min(limit, 200))
    files = db.query(File).order_by(File.created_at.desc()).limit(limit).all()
    return [file_to_dict(f) for f in files]


@router.get("/jobs")
def list_jobs(
    limit: int = 50,
    status: str | None = None,
    admin: AdminUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    limit = max(1, min(limit, 200))
    q = db.query(Job).order_by(Job.created_at.desc())
    if status:
        q = q.filter(Job.status == status)
    return [job_to_dict(j) for j in q.limit(limit).all()]


class PasswordChange(BaseModel):
    new_password: str


@router.post("/change-password")
def change_password(
    body: PasswordChange, admin: AdminUser = Depends(require_admin), db: Session = Depends(get_db)
):
    if len(body.new_password) < 12:
        raise HTTPException(status_code=422, detail="Password must be at least 12 characters")
    admin.password_hash = hash_password(body.new_password)
    db.commit()
    return {"changed": True}


def ensure_admin_seed(db: Session) -> None:
    """Create the admin user on first boot; handle password resets.

    If ADMIN_PASSWORD (plaintext) is set, it takes precedence: the admin
    user's password is (re)set to its argon2 hash. This is the supported
    recovery path when the password is lost — set the var, deploy, log
    in, then REMOVE the var. A warning is logged while it is set.
    """
    import logging

    log = logging.getLogger("pdfedi.admin")
    settings = get_settings()
    username = settings.admin_username

    if settings.admin_password:
        user = db.query(AdminUser).filter(AdminUser.username == username).first()
        new_hash = hash_password(settings.admin_password)
        if user is None:
            user = AdminUser(
                id=uuid.uuid4().hex,
                username=username,
                password_hash=new_hash,
                created_at=utcnow_iso(),
            )
            db.add(user)
        else:
            user.password_hash = new_hash
        db.commit()
        log.warning("admin password was (re)set from ADMIN_PASSWORD env var — remove the var")
        return

    if not settings.admin_password_hash:
        return
    existing = db.query(AdminUser).filter(AdminUser.username == username).first()
    if existing is not None:
        return
    # Accept argon2 hashes; also accept legacy SHA-256 hex during migration
    # (the user will change the password after first login).
    db.add(AdminUser(
        id=uuid.uuid4().hex,
        username=username,
        password_hash=settings.admin_password_hash,
        created_at=utcnow_iso(),
    ))
    db.commit()
