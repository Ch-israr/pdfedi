"""Versioned migrations, applied at startup.

Each migration is (version, sql | callable). Applied inside the migration
runner which records completed versions in schema_migrations — idempotent,
safe to run on every boot, works identically on SQLite and Turso.
"""
from __future__ import annotations

import logging
from typing import Any, Callable

from sqlalchemy import text

from .models import Base
from .timeutil import utcnow_iso

log = logging.getLogger("pdfedi.migrate")

# Version 1: initial schema. Declared once here as raw SQL so both SQLite
# and Turso get byte-identical tables (no dialect DDL surprises).
V1_SQL = """
CREATE TABLE IF NOT EXISTS files (
    id VARCHAR(36) PRIMARY KEY,
    sha256 VARCHAR(64) NOT NULL,
    filename VARCHAR(255) NOT NULL,
    size_bytes INTEGER NOT NULL,
    mime VARCHAR(100) NOT NULL DEFAULT '',
    storage_key VARCHAR(255) NOT NULL,
    kind VARCHAR(16) NOT NULL DEFAULT 'input',
    status VARCHAR(16) NOT NULL DEFAULT 'uploaded',
    page_count INTEGER,
    created_at VARCHAR(32) NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_files_sha256 ON files (sha256);
CREATE INDEX IF NOT EXISTS ix_files_storage_key ON files (storage_key);
CREATE TABLE IF NOT EXISTS jobs (
    id VARCHAR(36) PRIMARY KEY,
    tool VARCHAR(64) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'queued',
    file_ids TEXT NOT NULL DEFAULT '[]',
    options TEXT NOT NULL DEFAULT '{}',
    output_file_id VARCHAR(36),
    error TEXT,
    created_at VARCHAR(32) NOT NULL,
    updated_at VARCHAR(32) NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_jobs_tool ON jobs (tool);
CREATE TABLE IF NOT EXISTS admin_users (
    id VARCHAR(36) PRIMARY KEY,
    username VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    created_at VARCHAR(32) NOT NULL
);
CREATE TABLE IF NOT EXISTS quotas (
    id VARCHAR(128) PRIMARY KEY,
    count INTEGER NOT NULL DEFAULT 0,
    window_start VARCHAR(32) NOT NULL,
    updated_at VARCHAR(32) NOT NULL
);
CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at VARCHAR(32) NOT NULL
);
"""

# Tables owned by the v2 schema, with the columns each must have. A table
# with the right name but wrong columns is a legacy leftover and is dropped.
V2_TABLES: dict[str, set[str]] = {
    "files": {"id", "sha256", "filename", "size_bytes", "mime", "storage_key",
              "kind", "status", "page_count", "created_at"},
    "jobs": {"id", "tool", "status", "file_ids", "options", "output_file_id",
             "error", "created_at", "updated_at"},
    "admin_users": {"id", "username", "password_hash", "created_at"},
    "quotas": {"id", "count", "window_start", "updated_at"},
    "schema_migrations": {"version", "applied_at"},
}


def _table_columns(conn, table: str) -> set[str]:
    try:
        return {row[1] for row in conn.execute(text(f"PRAGMA table_info({table})")).all()}
    except Exception:
        return set()


def _migrate_v1_initial_schema(conn) -> None:
    """Create the v2 schema, replacing any legacy tables.

    The previous codebase created ~20 tables (users, processing_jobs,
    subscriptions, …) with incompatible columns — e.g. its `files` table
    has a different shape than v2's, so plain CREATE TABLE IF NOT EXISTS
    would leave a broken schema behind. The cleanup runs FIRST so the
    DDL below always applies to a clean database.

    All legacy data is pre-launch test data; the only record worth keeping
    is the admin user, which is preserved here (and would otherwise be
    re-seeded from ADMIN_PASSWORD_HASH anyway).
    """
    existing = {
        row[0]
        for row in conn.execute(text(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        )).all()
    }
    admin_row = None
    if "users" in existing:
        try:
            admin_row = conn.execute(text(
                "SELECT email, password_hash FROM users WHERE email = 'admin@pdfedi.com' LIMIT 1"
            )).first()
        except Exception:
            admin_row = None

    for table in sorted(existing - set(V2_TABLES) - {"schema_migrations"}):
        log.info("dropping legacy table %s", table)
        conn.execute(text(f'DROP TABLE "{table}"'))
    for table, expected in V2_TABLES.items():
        if table in existing and not expected.issubset(_table_columns(conn, table)):
            log.info("dropping legacy-shaped table %s", table)
            conn.execute(text(f'DROP TABLE "{table}"'))

    for stmt in _split_statements(V1_SQL):
        conn.execute(text(stmt))

    if admin_row:
        email, password_hash = admin_row[0], admin_row[1]
        already = conn.execute(
            text("SELECT id FROM admin_users WHERE username = :u"), {"u": email}
        ).first()
        if not already:
            import uuid
            conn.execute(
                text("INSERT INTO admin_users (id, username, password_hash, created_at)"
                     " VALUES (:i, :u, :p, :t)"),
                {"i": uuid.uuid4().hex, "u": email, "p": password_hash, "t": utcnow_iso()},
            )
            log.info("preserved admin user from legacy schema")


MigrationBody = str | Callable[[Any], None]

MIGRATIONS: list[tuple[int, MigrationBody]] = [
    (1, _migrate_v1_initial_schema),
]


def _split_statements(sql: str) -> list[str]:
    return [s.strip() for s in sql.split(";") if s.strip()]


def run_migrations(engine) -> list[int]:
    """Apply pending migrations. Returns the list of versions applied."""
    applied: list[int] = []
    with engine.begin() as conn:
        # Ensure the bookkeeping table exists even before migration 1.
        conn.execute(text(
            "CREATE TABLE IF NOT EXISTS schema_migrations "
            "(version INTEGER PRIMARY KEY, applied_at VARCHAR(32) NOT NULL)"
        ))
        done = {row[0] for row in conn.execute(text("SELECT version FROM schema_migrations")).all()}
        for version, body in sorted(MIGRATIONS, key=lambda m: m[0]):
            if version in done:
                continue
            log.info("applying migration %d", version)
            if callable(body):
                body(conn)
            else:
                for stmt in _split_statements(body):
                    conn.execute(text(stmt))
            conn.execute(
                text("INSERT INTO schema_migrations (version, applied_at) VALUES (:v, :t)"),
                {"v": version, "t": utcnow_iso()},
            )
            applied.append(version)
    # Keep SQLAlchemy's metadata aware of the tables for the ORM.
    Base.metadata.create_all(engine, checkfirst=True)
    return applied
