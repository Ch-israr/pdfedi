"""One-time schema repairs for SQLite/Turso databases.

These run idempotently at startup (see main.py lifespan). Each repair
detects the legacy schema first and is a no-op when the schema is already
correct. All statements used are supported by both SQLite and libsql/Turso.
"""
from __future__ import annotations

import re

from sqlalchemy import text
from sqlalchemy.engine import Engine

from app.core.logging import get_logger

log = get_logger("pdfedi.db.repairs")


def repair_files_storage_key_unique(engine: Engine) -> bool:
    """Drop the legacy UNIQUE on files.internal_storage_key.

    The column was briefly created UNIQUE, which breaks the deliberate
    SHA-256 dedup (multiple file rows share one storage key; deletion is
    ref-counted). SQLite implements a column UNIQUE as an internal
    auto-index that cannot be dropped, so the table is rebuilt from the
    current model DDL when the legacy schema is detected. Returns True
    when a rebuild was performed.
    """
    from sqlalchemy.schema import CreateTable

    from app.db.models.files import File

    with engine.begin() as conn:
        table_sql: str | None = conn.execute(
            text("SELECT sql FROM sqlite_master WHERE type='table' AND name='files'")
        ).scalar()
        if not table_sql or "internal_storage_key" not in table_sql:
            return False
        legacy = bool(
            re.search(r"internal_storage_key[^,]*UNIQUE", table_sql, re.IGNORECASE)
            or re.search(r"UNIQUE\s*\([^)]*internal_storage_key", table_sql, re.IGNORECASE)
        )
        if not legacy:
            return False

        log.warning("repair_files_storage_key_unique_start")
        ddl = str(CreateTable(File.__table__).compile(engine))
        if "CREATE TABLE files" not in ddl:
            raise RuntimeError("unexpected files DDL rendering")
        ddl_new = ddl.replace("CREATE TABLE files", "CREATE TABLE files_new", 1)
        cols = ", ".join(c.name for c in File.__table__.columns)

        conn.execute(text("PRAGMA foreign_keys=OFF"))
        try:
            conn.execute(text(ddl_new))
            conn.execute(text(f"INSERT INTO files_new ({cols}) SELECT {cols} FROM files"))
            conn.execute(text("DROP TABLE files"))
            conn.execute(text("ALTER TABLE files_new RENAME TO files"))
            for idx in File.__table__.indexes:
                icols = ", ".join(c.name for c in idx.columns)
                uniq = "UNIQUE " if idx.unique else ""
                conn.execute(
                    text(f"CREATE {uniq}INDEX IF NOT EXISTS {idx.name} ON files ({icols})")
                )
        finally:
            conn.execute(text("PRAGMA foreign_keys=ON"))
        log.warning("repair_files_storage_key_unique_done")
        return True
