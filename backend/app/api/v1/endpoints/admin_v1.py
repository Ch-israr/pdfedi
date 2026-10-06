"""Admin API v1 (rebuild).

Public users have NO auth. This is the SEPARATE admin system.
All endpoints require admin JWT (see app.core.admin_auth).

v1 endpoints:
- POST /admin/login          admin login (username/password)
- POST /admin/logout         admin logout
- GET  /admin/dashboard     overview metrics
- GET  /admin/traffic       request/traffic log
- GET  /admin/files         uploaded files
- GET  /admin/jobs          processing jobs
- GET  /admin/logs          raw log view
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Query, Request, Response
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.admin_auth import (
    _get_admin_credentials,
    create_admin_token,
    get_current_admin,
    verify_admin_password,
)
from app.core.deps import get_db
from app.core.errors import AdminForbidden
from app.db.models import File, ProcessingJob
from app.db.models.enums import JobStatus

router = APIRouter()


class AdminLoginRequest(BaseModel):
    username: str
    password: str


class AdminLoginResponse(BaseModel):
    token: str
    expires_in: int = 86400


@router.post("/login", response_model=AdminLoginResponse)
def admin_login(body: AdminLoginRequest, response: Response):
    """Admin login. Sets HttpOnly cookie + returns token."""
    username, pwd_hash = _get_admin_credentials()

    if body.username != username or not verify_admin_password(body.password, pwd_hash):
        raise AdminForbidden("Invalid credentials.")

    token = create_admin_token(body.username)

    # HttpOnly cookie for browser admin UI
    response.set_cookie(
        key="admin_token",
        value=token,
        httponly=True,
        secure=True,
        samesite="strict",
        max_age=86400,
        path="/",
    )

    return AdminLoginResponse(token=token)


@router.post("/logout")
def admin_logout(response: Response, admin: dict = Depends(get_current_admin)):
    """Admin logout. Clears cookie."""
    response.delete_cookie(key="admin_token", path="/")
    return {"status": "ok"}


@router.get("/dashboard")
def dashboard(
    admin: dict = Depends(get_current_admin),
    db: Session = Depends(get_db),
    hours: int = Query(default=24, le=168),
):
    """Overview metrics for the admin dashboard."""
    since = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=hours)

    total_files = db.scalar(
        select(func.count()).select_from(File).where(File.created_at >= since)
    ) or 0

    total_jobs = db.scalar(
        select(func.count()).select_from(ProcessingJob).where(ProcessingJob.created_at >= since)
    ) or 0

    completed_jobs = db.scalar(
        select(func.count()).select_from(ProcessingJob).where(
            ProcessingJob.created_at >= since,
            ProcessingJob.status == JobStatus.SUCCEEDED,
        )
    ) or 0

    failed_jobs = db.scalar(
        select(func.count()).select_from(ProcessingJob).where(
            ProcessingJob.created_at >= since,
            ProcessingJob.status == JobStatus.FAILED,
        )
    ) or 0

    total_bytes = db.scalar(
        select(func.sum(File.size_bytes)).select_from(File).where(File.created_at >= since)
    ) or 0

    return {
        "period_hours": hours,
        "files_uploaded": total_files,
        "jobs_created": total_jobs,
        "jobs_completed": completed_jobs,
        "jobs_failed": failed_jobs,
        "success_rate": round(completed_jobs / total_jobs * 100, 1) if total_jobs else 0,
        "bytes_uploaded": total_bytes,
        "mb_uploaded": round(total_bytes / 1024 / 1024, 2),
    }


@router.get("/files")
def list_files_admin(
    admin: dict = Depends(get_current_admin),
    db: Session = Depends(get_db),
    limit: int = Query(default=50, le=200),
    offset: int = Query(default=0, ge=0),
):
    """List uploaded files (admin view)."""
    files = (
        db.query(File)
        .order_by(File.created_at.desc())
        .limit(limit)
        .offset(offset)
        .all()
    )
    return {
        "files": [
            {
                "id": str(f.id),
                "filename": f.display_name,
                "size_bytes": f.size_bytes,
                "content_type": f.content_type,
                "page_count": f.page_count,
                "created_at": f.created_at.isoformat() if f.created_at else None,
                "expires_at": f.retention_expires_at.isoformat() if f.retention_expires_at else None,
                "deleted": f.deleted_at is not None,
            }
            for f in files
        ],
        "limit": limit,
        "offset": offset,
    }


@router.get("/jobs")
def list_jobs_admin(
    admin: dict = Depends(get_current_admin),
    db: Session = Depends(get_db),
    status: Optional[str] = Query(default=None),
    limit: int = Query(default=50, le=200),
    offset: int = Query(default=0, ge=0),
):
    """List processing jobs (admin view)."""
    q = db.query(ProcessingJob).order_by(ProcessingJob.created_at.desc())
    if status:
        q = q.filter(ProcessingJob.status == status)
    jobs = q.limit(limit).offset(offset).all()

    return {
        "jobs": [
            {
                "id": str(j.id),
                "tool_key": j.tool_key,
                "status": j.status.value if hasattr(j.status, 'value') else str(j.status),
                "created_at": j.created_at.isoformat() if j.created_at else None,
                "started_at": j.started_at.isoformat() if j.started_at else None,
                "finished_at": j.finished_at.isoformat() if j.finished_at else None,
                "error": j.error_message,
            }
            for j in jobs
        ],
        "limit": limit,
        "offset": offset,
    }


@router.get("/logs")
def raw_logs(
    admin: dict = Depends(get_current_admin),
    # In v1, logs come from the logging system; this is a placeholder
    # for the log-viewer UI. Real implementation streams from log drain.
    limit: int = Query(default=100, le=1000),
):
    """Raw log view (v1 placeholder — wire to log drain in production)."""
    return {
        "message": "Connect a log drain (Datadog/S3/Sentry) for production log viewing.",
        "limit": limit,
        "logs": [],
    }
