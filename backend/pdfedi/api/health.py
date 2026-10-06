"""Health endpoints."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db
from ..storage import storage_dir

router = APIRouter()


@router.get("/live")
def live():
    settings = get_settings()
    return {"status": "ok", "service": "PDFEDI", "version": "2.0.0", "env": settings.env}


@router.get("/ready")
def ready(db: Session = Depends(get_db)):
    settings = get_settings()
    checks: dict[str, str] = {}
    try:
        db.execute(text("SELECT 1"))
        checks["database"] = "ok"
    except Exception as e:  # noqa: BLE001
        checks["database"] = f"error: {type(e).__name__}"
    checks["db_provider"] = settings.db_provider
    try:
        d = storage_dir()
        checks["storage"] = "ok" if d.is_dir() else "missing"
    except Exception as e:  # noqa: BLE001
        checks["storage"] = f"error: {type(e).__name__}"
    checks["redis"] = "disabled"
    ok = checks["database"] == "ok" and checks["storage"] == "ok"
    return {"status": "ok" if ok else "degraded", "checks": checks}
