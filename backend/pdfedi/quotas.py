"""Per-IP, per-tool hourly quotas — DB-backed so they survive restarts.

Default policy: QUOTA_PER_HOUR successful processing actions per tool,
per client IP, per rolling 1-hour window. Counts only successful jobs.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from .config import get_settings
from .models import Quota
from .timeutil import utcnow_iso


def _window_start(now: datetime) -> datetime:
    return now.replace(minute=0, second=0, microsecond=0)


def _quota_id(ip: str, tool: str, window: datetime) -> str:
    return f"{ip}|{tool}|{window.strftime('%Y%m%d%H')}"


def check_quota(db: Session, ip: str, tool: str) -> tuple[bool, int, int]:
    """Return (allowed, used, limit) for this IP+tool in the current hour."""
    settings = get_settings()
    limit = settings.quota_per_hour
    window = _window_start(datetime.now(timezone.utc))
    row = db.query(Quota).filter(Quota.id == _quota_id(ip, tool, window)).first()
    used = row.count if row else 0
    return used < limit, used, limit


def record_success(db: Session, ip: str, tool: str) -> int:
    """Increment the success counter. Returns the new count."""
    now = datetime.now(timezone.utc)
    window = _window_start(now)
    qid = _quota_id(ip, tool, window)
    row = db.query(Quota).filter(Quota.id == qid).first()
    if row is None:
        row = Quota(id=qid, count=0, window_start=window.isoformat(), updated_at=utcnow_iso())
        db.add(row)
    row.count += 1
    row.updated_at = utcnow_iso()
    db.commit()
    _prune_old(db, now)
    return row.count


def _prune_old(db: Session, now: datetime) -> None:
    """Delete quota rows older than 2 hours (keeps the table tiny)."""
    cutoff = (now - timedelta(hours=2)).isoformat()
    db.query(Quota).filter(Quota.window_start < cutoff).delete()
    db.commit()
