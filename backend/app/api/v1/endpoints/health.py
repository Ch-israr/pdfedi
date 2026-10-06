"""Health endpoints: liveness, readiness, dependency checks.

- GET /api/v1/health/live  -> process is alive (no dependencies)
- GET /api/v1/health/ready -> dependencies reachable (db, redis, storage)
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.deps import get_db

router = APIRouter()
settings = get_settings()


@router.get("/live")
def live():
    return {"status": "ok", "service": settings.app_name, "version": settings.app_version}


@router.get("/ready")
def ready(db: Session = Depends(get_db)):
    checks: dict[str, str] = {}
    try:
        db.execute(text("SELECT 1"))
        checks["database"] = "ok"
        # Debug: indicate which backend is in use (no credentials leaked)
        db_url = settings.effective_database_url
        if "tursohttp" in db_url:
            checks["db_backend"] = "turso"
        elif db_url.startswith("sqlite"):
            checks["db_backend"] = "sqlite-local"
        else:
            checks["db_backend"] = "unknown"
        checks["db_provider_setting"] = settings.db_provider
    except Exception as e:
        checks["database"] = f"error: {type(e).__name__}"
    if settings.redis_enabled:
        try:
            import redis as redis_lib

            r = redis_lib.from_url(settings.redis_url, socket_connect_timeout=2)
            r.ping()
            checks["redis"] = "ok"
        except Exception as e:
            checks["redis"] = f"error: {type(e).__name__}"
    else:
        checks["redis"] = "disabled"
    try:
        from app.services.storage import get_storage

        get_storage()  # constructor validates config
        checks["storage"] = "ok"
    except Exception as e:
        checks["storage"] = f"error: {type(e).__name__}"

    ok = all(v == "ok" or v == "disabled" for v in checks.values())
    return {"status": "ok" if ok else "degraded", "checks": checks}
