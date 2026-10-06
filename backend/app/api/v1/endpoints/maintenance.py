"""Maintenance endpoints for scheduled cleanup.

Protected by CRON_SECRET (passed as Authorization: Bearer header).
Called by external scheduler (GitHub Actions) every 20 minutes.

Safety rules:
- Only deletes EXPIRED temporary data (older than 20 minutes)
- Never deletes active jobs (queued/processing)
- Never deletes user files (only temp files)
- Never deletes admin data
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.logging import get_logger
from app.db.models.files import File, ProcessingJob
from app.db.models.enums import JobStatus
from app.db.session import get_db

log = get_logger("pdfedi.maintenance")
settings = get_settings()
router = APIRouter(prefix="/maintenance", tags=["maintenance"])

# 20 minutes in seconds
CLEANUP_AGE_SECONDS = 20 * 60


def verify_cron_secret(authorization: str | None = Header(None)) -> None:
    """Verify the CRON_SECRET bearer token."""
    expected = settings.cron_secret
    if not expected:
        raise HTTPException(status_code=500, detail="CRON_SECRET not configured")
    
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid authorization")
    
    token = authorization[7:]  # Remove "Bearer " prefix
    if token != expected:
        raise HTTPException(status_code=403, detail="Invalid cron secret")


@router.post("/cleanup", dependencies=[Depends(verify_cron_secret)])
def cleanup_expired_data(db: Session = Depends(get_db)):
    """Delete expired files and old jobs.
    
    Files: deleted when retention_expires_at < now (2-hour TTL per approved plan).
    Jobs: deleted when completed/failed/cancelled and older than 2 hours.
    
    Called by external scheduler (Vercel Cron) every hour.
    Returns counts of deleted items.
    """
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    
    deleted_files = 0
    deleted_jobs = 0
    
    try:
        # 1. Delete expired files (retention TTL exceeded)
        expired_files = db.query(File).filter(
            and_(
                File.retention_expires_at.isnot(None),
                File.retention_expires_at < now,
                File.deleted_at.is_(None),
            )
        ).all()
        
        for f in expired_files:
            # Soft delete (keeps audit trail, storage cleanup separate)
            f.deleted_at = now
            deleted_files += 1
        
        # 2. Delete old terminal jobs (2+ hours old)
        cutoff = now - timedelta(hours=2)
        old_jobs = db.query(ProcessingJob).filter(
            and_(
                ProcessingJob.created_at < cutoff,
                ProcessingJob.status.in_([JobStatus.SUCCEEDED, JobStatus.FAILED, JobStatus.CANCELLED])
            )
        ).all()
        
        for job in old_jobs:
            db.delete(job)
            deleted_jobs += 1
        
        db.commit()
        
        log.info("cleanup_completed", deleted_files=deleted_files, deleted_jobs=deleted_jobs)
        return {
            "status": "ok",
            "deleted_files": deleted_files,
            "deleted_jobs": deleted_jobs,
        }
        
    except Exception as e:
        db.rollback()
        log.error("cleanup_failed", error=str(e)[:200])
        raise HTTPException(status_code=500, detail="Cleanup failed")
