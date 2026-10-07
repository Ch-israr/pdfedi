"""Admin API: login + dashboard. Bearer-token protected."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db
from ..models import AdminUser, File, Job
from ..security import (
    create_admin_token,
    hash_password,
    require_admin,
    verify_legacy_sha256,
    verify_password,
)
from ..timeutil import utcnow_iso
from .public import file_to_dict, job_to_dict

router = APIRouter()


class LoginBody(BaseModel):
    username: str
    password: str


@router.post("/login")
def login(body: LoginBody, db: Session = Depends(get_db)):
    user = db.query(AdminUser).filter(AdminUser.username == body.username.strip()).first()
    ok = user is not None and verify_password(body.password, user.password_hash)
    if not ok and user is not None and verify_legacy_sha256(body.password, user.password_hash):
        # Transparent upgrade: legacy SHA-256 hash -> argon2 on first login.
        user.password_hash = hash_password(body.password)
        db.commit()
        ok = True
    if not ok or user is None:
        raise HTTPException(status_code=403, detail="Invalid credentials")
    return {"token": create_admin_token(user.username), "username": user.username}


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
