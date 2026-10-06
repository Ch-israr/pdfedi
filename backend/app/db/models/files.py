"""Files, processing jobs, job inputs/outputs and usage records.

Privacy rule: raw PDF bytes are NEVER stored in PostgreSQL — only metadata.
File bytes live in private object storage under server-generated keys.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, Index, Integer, String, Text
from app.db.base import JSONVariant as JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import GUID, Base, SoftDeleteMixin, TimestampMixin, UUIDMixin
from app.db.models.enums import FileUploadStatus, JobStatus, StorageClass


class File(UUIDMixin, TimestampMixin, SoftDeleteMixin, Base):
    __tablename__ = "files"

    owner_user_id: Mapped[uuid.UUID] = mapped_column(GUID(), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    original_filename: Mapped[str] = mapped_column(String(512), nullable=False)
    safe_display_name: Mapped[str] = mapped_column(String(512), nullable=False)
    internal_storage_key: Mapped[str] = mapped_column(String(1024), index=True, nullable=False)
    detected_content_type: Mapped[str] = mapped_column(String(128), nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    page_count: Mapped[int | None] = mapped_column(Integer)
    encrypted_pdf: Mapped[bool] = mapped_column(default=False, nullable=False)
    upload_status: Mapped[FileUploadStatus] = mapped_column(String(32), default=FileUploadStatus.PENDING, nullable=False)
    storage_class: Mapped[StorageClass] = mapped_column(String(32), default=StorageClass.INPUT, nullable=False)
    retention_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    validation_report: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)

    inputs: Mapped[list["JobInput"]] = relationship(back_populates="file")
    outputs: Mapped[list["JobOutput"]] = relationship(back_populates="file")


class ProcessingJob(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "processing_jobs"

    owner_user_id: Mapped[uuid.UUID] = mapped_column(GUID(), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    tool_key: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    tool_version: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[JobStatus] = mapped_column(String(32), default=JobStatus.QUEUED, nullable=False, index=True)
    priority: Mapped[int] = mapped_column(default=5, nullable=False)
    configuration: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    queue_task_id: Mapped[str | None] = mapped_column(String(128), index=True)
    idempotency_key: Mapped[str | None] = mapped_column(String(128), index=True)
    retry_count: Mapped[int] = mapped_column(default=0, nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    error_code: Mapped[str | None] = mapped_column(String(64))
    internal_error_reference: Mapped[str | None] = mapped_column(String(64))  # log correlation id, safe to show
    progress_percent: Mapped[int] = mapped_column(default=0, nullable=False)

    inputs: Mapped[list["JobInput"]] = relationship(back_populates="job", cascade="all, delete-orphan")
    outputs: Mapped[list["JobOutput"]] = relationship(back_populates="job", cascade="all, delete-orphan")


class JobInput(Base):
    __tablename__ = "job_inputs"

    job_id: Mapped[uuid.UUID] = mapped_column(GUID(), ForeignKey("processing_jobs.id", ondelete="CASCADE"), primary_key=True)
    file_id: Mapped[uuid.UUID] = mapped_column(GUID(), ForeignKey("files.id", ondelete="RESTRICT"), primary_key=True)
    ordering: Mapped[int] = mapped_column(default=0, nullable=False)
    config: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)  # per-input page ranges etc.

    job: Mapped[ProcessingJob] = relationship(back_populates="inputs")
    file: Mapped[File] = relationship(back_populates="inputs")


class JobOutput(Base):
    __tablename__ = "job_outputs"

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    job_id: Mapped[uuid.UUID] = mapped_column(GUID(), ForeignKey("processing_jobs.id", ondelete="CASCADE"), nullable=False, index=True)
    file_id: Mapped[uuid.UUID] = mapped_column(GUID(), ForeignKey("files.id", ondelete="RESTRICT"), nullable=False)
    output_type: Mapped[str] = mapped_column(String(64), nullable=False)  # result|preview|thumbnail
    ordering: Mapped[int] = mapped_column(default=0, nullable=False)
    download_count: Mapped[int] = mapped_column(default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    job: Mapped[ProcessingJob] = relationship(back_populates="outputs")
    file: Mapped[File] = relationship(back_populates="outputs")


class UsageRecord(UUIDMixin, Base):
    """Immutable per-event usage facts feeding quotas and analytics."""

    __tablename__ = "usage_records"

    user_id: Mapped[uuid.UUID] = mapped_column(GUID(), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    subscription_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), ForeignKey("subscriptions.id"))
    job_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), ForeignKey("processing_jobs.id", ondelete="SET NULL"))
    metric_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)  # job, page, ocr_page, storage_mb...
    metric_value: Mapped[int] = mapped_column(BigInteger, default=1, nullable=False)
    billing_period: Mapped[str] = mapped_column(String(16), nullable=False, index=True)  # YYYY-MM
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    meta: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)


Index("ix_usage_user_period", UsageRecord.user_id, UsageRecord.billing_period, UsageRecord.metric_type)
Index("ix_jobs_owner_status", ProcessingJob.owner_user_id, ProcessingJob.status)
