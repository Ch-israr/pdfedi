"""Versioned SQL migrations, applied at startup.

Each migration is (version, sql). Applied inside the migration runner which
records completed versions in schema_migrations — idempotent, safe to run
on every boot, works identically on SQLite and Turso.
"""
from __future__ import annotations

import logging

from sqlalchemy import text

from .models import Base
from .timeutil import utcnow_iso

log = logging.getLogger("pdfedi.migrate")

# Version 1: initial schema. Declared once here as raw SQL so both SQLite
# and Turso get byte-identical tables (no dialect DDL surprises).
MIGRATIONS: list[tuple[int, str]] = [
    (
        1,
        """
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
        """,
    ),
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
        for version, sql in sorted(MIGRATIONS):
            if version in done:
                continue
            log.info("applying migration %d", version)
            for stmt in _split_statements(sql):
                conn.execute(text(stmt))
            conn.execute(
                text("INSERT INTO schema_migrations (version, applied_at) VALUES (:v, :t)"),
                {"v": version, "t": utcnow_iso()},
            )
            applied.append(version)
    # Keep SQLAlchemy's metadata aware of the tables for the ORM.
    Base.metadata.create_all(engine, checkfirst=True)
    return applied
