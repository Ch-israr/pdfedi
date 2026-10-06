"""Database engine and session management.

SQLite locally; Turso (via the pure-Python tursohttp dialect) when
DB_PROVIDER=turso. One engine per process, NullPool for Turso (HTTP is
stateless — connections are just host+token), default pool for SQLite.
"""
from __future__ import annotations

from sqlalchemy import create_engine
from sqlalchemy.dialects import registry as dialect_registry
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import NullPool

from . import turso as turso_dialect  # noqa: F401  (module must be importable)
from .config import get_settings

# Register the custom Turso HTTP dialect (pure Python, no native extensions).
dialect_registry.register("tursohttp", "pdfedi.turso", "Dialect_tursohttp")


def build_database_url() -> str:
    settings = get_settings()
    if settings.db_provider == "turso":
        host = settings.turso_database_url.replace("libsql://", "").rstrip("/")
        token = settings.turso_auth_token
        return f"tursohttp://{host}?authToken={token}"
    return "sqlite:///./pdfedi.db"


def create_app_engine():
    url = build_database_url()
    if url.startswith("tursohttp://"):
        return create_engine(url, poolclass=NullPool, future=True)
    return create_engine(url, connect_args={"check_same_thread": False}, future=True)


engine = create_app_engine()
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


def get_db():
    """FastAPI dependency: request-scoped session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
