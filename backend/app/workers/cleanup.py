"""Automatic cleanup of expired temporary files.

Removes File rows whose retention_expires_at has passed AND whose storage
bytes are no longer referenced by any live file (dedup-aware).

Run periodically:
- Via Celery beat: pdfedi.cleanup_expired_files every hour
- Via cron: python -m app.workers.cleanup
- Via admin API: POST /api/v1/admin/maintenance/cleanup
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import func, select

from app.core.logging import get_logger
from app.db.models import File
from app.services.storage import get_storage

log = get_logger("pdfedi.cleanup")


def cleanup_expired_files(db, batch_size: int = 500) -> dict:
    """Delete expired files. Returns counts."""
    now = datetime.now(timezone.utc)
    expired = list(
        db.scalars(
            select(File)
            .where(File.retention_expires_at <= now, File.deleted_at.is_(None))
            .limit(batch_size)
        )
    )
    if not expired:
        return {"files_removed": 0, "bytes_freed": 0}

    storage = get_storage()
    removed = 0
    freed = 0
    for f in expired:
        # Dedup-aware: only delete storage bytes if no other live file references the key
        refs = db.scalar(
            select(func.count())
            .select_from(File)
            .where(
                File.internal_storage_key == f.internal_storage_key,
                File.deleted_at.is_(None),
                File.id != f.id,
            )
        )
        f.deleted_at = now
        removed += 1
        freed += f.size_bytes or 0
        if not refs:
            try:
                storage.delete(f.internal_storage_key)
            except Exception as e:
                log.warning("cleanup_storage_delete_failed", key=f.internal_storage_key[:40], error=str(e)[:100])
    db.commit()
    log.info("cleanup_expired_files", files_removed=removed, bytes_freed=freed)
    return {"files_removed": removed, "bytes_freed": freed}


if __name__ == "__main__":
    from app.db.session import _session_factory

    session = _session_factory()()
    try:
        result = cleanup_expired_files(session)
        print(result)
    finally:
        session.close()
