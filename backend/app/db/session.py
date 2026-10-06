"""Database engine and session management.

- SQLite (local file) or Turso (hosted SQLite via HTTP API) for PDFEDI.
- ``DB_USE_NULL_POOL=true`` on serverless (Vercel): each invocation opens
  and closes its own connections.
- Engine creation is lazy so importing this module never requires a
  database driver to be installed.
"""
from __future__ import annotations

from collections.abc import Generator
from functools import lru_cache

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import NullPool

from app.core.config import get_settings

# Register the custom Turso HTTP dialect (pure Python, no native extensions)
try:
    from sqlalchemy.dialects import registry
    registry.register(
        "sqlite.tursohttp",
        "app.db.turso_dialect",
        "SQLiteDialect_tursohttp",
    )
except Exception:
    pass  # dialect registration is best-effort; falls back gracefully


@lru_cache
def get_engine() -> Engine:
    settings = get_settings()
    kwargs: dict = {}
    db_url = settings.effective_database_url
    is_tursohttp = "tursohttp" in db_url
    is_local_sqlite = db_url.startswith("sqlite:") and not is_tursohttp
    if settings.db_use_null_pool or db_url.startswith("sqlite"):
        kwargs["poolclass"] = NullPool
    else:
        kwargs.update(
            pool_size=settings.db_pool_size,
            max_overflow=settings.db_max_overflow,
            pool_pre_ping=True,
            pool_recycle=3600,
        )
    if is_local_sqlite:
        # Local SQLite file: allow use across FastAPI request threads.
        # NOT for tursohttp (HTTP API, doesn't accept this arg).
        kwargs["connect_args"] = {"check_same_thread": False}
    return create_engine(db_url, future=True, **kwargs)


@lru_cache
def _session_factory() -> sessionmaker:
    return sessionmaker(bind=get_engine(), autoflush=False, autocommit=False, expire_on_commit=False, class_=Session)


def get_db() -> Generator[Session, None, None]:
    db = _session_factory()()
    try:
        yield db
    finally:
        db.close()
