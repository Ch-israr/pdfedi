"""UTC timestamps as ISO-8601 strings.

Stored as TEXT on both SQLite and Turso: no dialect datetime handling,
no timezone ambiguity, lexicographic ordering == chronological ordering.
"""
from __future__ import annotations

from datetime import datetime, timezone


def utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    return datetime.fromisoformat(value)
