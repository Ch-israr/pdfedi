"""Database models.

Deliberate simplifications vs. the previous codebase:
  * Every status/kind column is a plain String. The application converts to
    and from str-valued enums at the boundary, so no enum object ever reaches
    the DB driver (this kills the Turso enum-serialization bug class).
  * Timestamps are ISO-8601 strings (see timeutil).
  * files.storage_key is indexed, NOT unique — content-addressed dedup
    intentionally shares keys between identical uploads.
"""
from __future__ import annotations

import enum

from sqlalchemy import Index, String, Integer, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from .timeutil import utcnow_iso


class Base(DeclarativeBase):
    pass


# ---------------------------------------------------------------------------
# Enums — str-valued; always persist .value, never the member
# ---------------------------------------------------------------------------
class FileStatus(str, enum.Enum):
    UPLOADED = "uploaded"
    VALIDATED = "validated"
    FAILED = "failed"


class FileKind(str, enum.Enum):
    INPUT = "input"
    OUTPUT = "output"


class JobStatus(str, enum.Enum):
    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"


def enum_value(member: enum.Enum | str | None) -> str | None:
    return member.value if isinstance(member, enum.Enum) else member


# ---------------------------------------------------------------------------
# Tables
# ---------------------------------------------------------------------------
class File(Base):
    __tablename__ = "files"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    sha256: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    mime: Mapped[str] = mapped_column(String(100), nullable=False, default="")
    storage_key: Mapped[str] = mapped_column(String(255), nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False, default=FileKind.INPUT.value)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default=FileStatus.UPLOADED.value)
    page_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[str] = mapped_column(String(32), nullable=False, default=utcnow_iso)

    __table_args__ = (Index("ix_files_storage_key", "storage_key"),)


class Job(Base):
    __tablename__ = "jobs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    tool: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default=JobStatus.QUEUED.value)
    file_ids: Mapped[str] = mapped_column(Text, nullable=False, default="[]")  # JSON array
    options: Mapped[str] = mapped_column(Text, nullable=False, default="{}")   # JSON object
    output_file_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[str] = mapped_column(String(32), nullable=False, default=utcnow_iso)
    updated_at: Mapped[str] = mapped_column(String(32), nullable=False, default=utcnow_iso)


class AdminUser(Base):
    __tablename__ = "admin_users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    username: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)  # argon2
    created_at: Mapped[str] = mapped_column(String(32), nullable=False, default=utcnow_iso)


class Quota(Base):
    """Per-IP, per-tool, per-hour usage counters (survives restarts)."""
    __tablename__ = "quotas"

    id: Mapped[str] = mapped_column(String(128), primary_key=True)  # ip|tool|window_hour
    count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    window_start: Mapped[str] = mapped_column(String(32), nullable=False)
    updated_at: Mapped[str] = mapped_column(String(32), nullable=False, default=utcnow_iso)


class SchemaMigration(Base):
    __tablename__ = "schema_migrations"

    version: Mapped[int] = mapped_column(Integer, primary_key=True)
    applied_at: Mapped[str] = mapped_column(String(32), nullable=False, default=utcnow_iso)
