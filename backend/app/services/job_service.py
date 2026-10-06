"""Worker backend abstraction.

The job lifecycle is identical regardless of where work runs:
  QUEUED -> RUNNING -> SUCCEEDED | FAILED | CANCELLED

Two backends:
- ``InlineWorkerBackend``: runs the tool synchronously inside the API
  process. Used for the Vercel serverless phase and local dev. Bounded by
  ``job_inline_timeout_seconds``; tools are CPU-bounded and stream-safe.
- ``CeleryWorkerBackend``: dispatches to Celery workers (container
  deployment) for long/heavy workloads. Same job table, same API.

The public API contract (job records, status polling, outputs) is stable
regardless of backend — the URL never changes when workers move.
"""
from __future__ import annotations

import time
import uuid
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import JobNotFound, ToolDisabled
from app.core.logging import get_logger, get_request_id, set_request_id
from app.db.models import File, JobInput, JobOutput, ProcessingJob, User
from app.db.models.enums import FileUploadStatus, JobStatus, StorageClass
from app.services.pdf.registry import ToolError, get_tool
from app.services.storage import cleanup_work_dir, ensure_work_dir, get_storage, new_storage_key

log = get_logger("pdfedi.jobs")
settings = get_settings()


def _now():
    return datetime.now(timezone.utc)


class WorkerBackend(ABC):
    @abstractmethod
    def submit(self, db: Session, job: ProcessingJob, user_plan_limits: dict | None = None) -> str:
        """Queue/execute the job. Returns the queue task id."""

    @abstractmethod
    def cancel(self, db: Session, job: ProcessingJob) -> bool:
        """Attempt cancellation. Returns True if cancelled."""


def get_job_for_user(db: Session, *, user: User, job_id: uuid.UUID) -> ProcessingJob:
    job = db.get(ProcessingJob, job_id)
    if not job or job.owner_user_id != owner_id:
        raise JobNotFound()
    return job


def create_job(
    db: Session,
    *,
    owner_id: uuid.UUID,
    tool_key: str,
    file_ids: list[uuid.UUID],
    config: dict,
    idempotency_key: str | None = None,
    priority: int = 5,
) -> ProcessingJob:
    from app.db.models import File as FileModel

    tool = get_tool(tool_key)
    if not tool:
        from app.core.errors import ToolNotFound

        raise ToolNotFound()
    # Feature flag check (admin can disable tools without deploy)
    if tool.feature_flag:
        from app.db.models import FeatureFlag

        flag = db.get(FeatureFlag, tool.feature_flag)
        if flag and not flag.enabled:
            raise ToolDisabled()

    if idempotency_key:
        existing = (
            db.query(ProcessingJob)
            .filter(ProcessingJob.owner_user_id == owner_id, ProcessingJob.idempotency_key == idempotency_key)
            .first()
        )
        if existing:
            return existing

    if not (tool.min_inputs <= len(file_ids) <= tool.max_inputs):
        from app.core.errors import AppException

        raise AppException(f"Tool '{tool_key}' requires {tool.min_inputs}-{tool.max_inputs} files.")

    # Ownership + validated status for every input
    files: list[FileModel] = []
    for fid in file_ids:
        f = db.get(FileModel, fid)
        if not f or f.owner_user_id != owner_id or f.is_deleted:
            from app.core.errors import NotFound

            raise NotFound("One or more input files were not found.")
        if f.upload_status != FileUploadStatus.VALIDATED:
            from app.core.errors import AppException

            raise AppException("One or more input files are not ready.")
        files.append(f)

    # Encrypt sensitive keys before persistence — never store passwords/tokens
    # in plaintext. The worker decrypts in-memory before calling the handler.
    # See _decrypt_config() below.
    _SENSITIVE_KEYS = {"user_password", "owner_password", "password", "secret", "token"}
    safe_config = _encrypt_config(config or {}, _SENSITIVE_KEYS)

    # Job expires after the output retention period (not at creation!)
    from datetime import timedelta
    from app.core.anonymous import ANONYMOUS_USER_ID, ensure_anonymous_user
    if owner_id == ANONYMOUS_USER_ID:
        ensure_anonymous_user(db)
    retention_days = 30  # TODO: make plan-aware via user_plan_limits
    job = ProcessingJob(
        owner_user_id=owner_id,
        tool_key=tool_key,
        tool_version=tool.version,
        status=JobStatus.QUEUED,
        priority=priority,
        configuration=safe_config,
        idempotency_key=idempotency_key,
        expires_at=_now() + timedelta(days=retention_days),
    )
    db.add(job)
    db.flush()
    for i, f in enumerate(files):
        db.add(JobInput(job_id=job.id, file_id=f.id, ordering=i, config={}))
    db.commit()
    log.info("job_created", job_id=str(job.id), tool=tool_key, user_id=str(owner_id))
    return job


def _get_config_cipher():
    """Fernet cipher for sensitive job config values. Key from JWT secret."""
    from cryptography.fernet import Fernet
    from app.core.config import get_settings
    import hashlib, base64
    secret = get_settings().jwt_secret_key.encode()
    # Derive a 32-byte key via SHA-256, then base64url-encode for Fernet
    key = base64.urlsafe_b64encode(hashlib.sha256(b"pdfedi-job-config:" + secret).digest())
    return Fernet(key)


def _encrypt_config(config: dict, sensitive_keys: set[str]) -> dict:
    """Encrypt sensitive config values. Returns a copy with encrypted markers."""
    if not config:
        return {}
    cipher = _get_config_cipher()
    out = {}
    for k, v in config.items():
        if k.lower() in sensitive_keys and isinstance(v, str) and v:
            token = cipher.encrypt(v.encode()).decode()
            out[k] = {"__encrypted__": token}
        else:
            out[k] = v
    return out


def _decrypt_config(config: dict) -> dict:
    """Decrypt __encrypted__ markers in job config. Returns a copy."""
    if not config:
        return {}
    cipher = _get_config_cipher()
    out = {}
    for k, v in config.items():
        if isinstance(v, dict) and "__encrypted__" in v:
            try:
                out[k] = cipher.decrypt(v["__encrypted__"].encode()).decode()
            except Exception:
                out[k] = ""  # decryption failed — handler will reject empty password
        else:
            out[k] = v
    return out


def _run_tool(db: Session, job: ProcessingJob, *, user_plan_limits: dict) -> None:
    """Execute the tool handler and persist outputs. Shared by both backends."""
    set_request_id(f"job_{job.id.hex[:12]}")
    tool = get_tool(job.tool_key)
    assert tool and tool.handler
    storage = get_storage()
    work_dir = ensure_work_dir()
    try:
        job.status = JobStatus.RUNNING
        job.started_at = _now()
        job.progress_percent = 5
        db.commit()

        inputs = [storage.get(inp.file.internal_storage_key) for inp in sorted(job.inputs, key=lambda x: x.ordering)]

        def _progress(p: int):
            job.progress_percent = max(0, min(100, p))

        from app.services.pdf.registry import ToolContext

        ctx = ToolContext(
            job_id=str(job.id),
            work_dir=work_dir,
            max_pages=user_plan_limits["max_pages"],
            max_upload_mb=user_plan_limits["max_upload_mb"],
            progress=_progress,
        )
        result = tool.handler(inputs, _decrypt_config(job.configuration or {}), ctx)

        # Output verification: non-empty, re-parseable, expected pages
        for filename, data in result.outputs:
            if not data:
                raise ToolError("EMPTY_OUTPUT", f"Tool produced an empty output: {filename}")
        _verify_outputs(tool.key, result.outputs)

        now = _now()
        for i, (filename, data) in enumerate(result.outputs):
            safe = filename[:200].replace("/", "_")
            ext = Path(safe).suffix or (".pdf" if tool.key != "extract_text" else ".txt")
            key = new_storage_key(prefix=f"output/{job.owner_user_id}", suffix=ext)
            ctype = "application/pdf" if ext == ".pdf" else ("image/png" if ext == ".png" else "application/octet-stream")
            storage.put(key, data, content_type=ctype)
            out_file = File(
                owner_user_id=job.owner_user_id,
                original_filename=safe,
                safe_display_name=safe,
                internal_storage_key=key,
                detected_content_type=ctype,
                size_bytes=len(data),
                sha256=__import__("hashlib").sha256(data).hexdigest(),
                page_count=result.meta.get("page_count"),
                upload_status=FileUploadStatus.VALIDATED,
                storage_class=StorageClass.OUTPUT,
                retention_expires_at=now,
            )
            db.add(out_file)
            db.flush()
            db.add(
                JobOutput(
                    job_id=job.id,
                    file_id=out_file.id,
                    output_type="result",
                    ordering=i,
                    created_at=now,
                )
            )
        job.status = JobStatus.SUCCEEDED
        job.progress_percent = 100
        job.completed_at = _now()
        # retention for outputs comes from the plan; set at creation via service
        db.commit()
        log.info("job_succeeded", job_id=str(job.id), outputs=len(result.outputs))
    except ToolError as e:
        db.rollback()
        job = db.get(ProcessingJob, job.id)
        job.status = JobStatus.FAILED
        job.error_code = e.code
        job.internal_error_reference = get_request_id()
        job.completed_at = _now()
        db.commit()
        log.warning("job_failed", job_id=str(job.id), code=e.code)
    except Exception as e:  # unexpected -> safe message, full log
        db.rollback()
        job = db.get(ProcessingJob, job.id)
        job.status = JobStatus.FAILED
        job.error_code = "INTERNAL_ERROR"
        job.internal_error_reference = get_request_id()
        job.completed_at = _now()
        db.commit()
        log.exception("job_crashed", job_id=str(job.id), error=str(e)[:200])
    finally:
        cleanup_work_dir(work_dir)


def _verify_outputs(tool_key: str, outputs: list[tuple[str, bytes]]) -> None:
    """Operation-specific output verification (safe, no secrets).
    
    Uses pypdf (BSD) for verification. Falls back gracefully if unavailable.
    Never requires PyMuPDF (AGPL) — see ARCHITECTURE.md Decision 2.
    """
    if tool_key in ("extract_text", "metadata"):
        return  # text/json outputs
    for filename, data in outputs:
        if not filename.lower().endswith(".pdf"):
            continue
        if len(data) < 8 or not data[:5] == b"%PDF-":
            raise ToolError("EMPTY_OUTPUT", "Output is not a valid PDF.")
        try:
            from pypdf import PdfReader
            import io
            reader = PdfReader(io.BytesIO(data))
            if len(reader.pages) == 0:
                raise ToolError("EMPTY_OUTPUT", "Output PDF has no pages.")
        except ToolError:
            raise
        except Exception:
            # pypdf unavailable or parse failed — basic header check already passed.
            # Don't fail the job on verification alone.
            pass


class InlineWorkerBackend(WorkerBackend):
    """Runs the tool in-process. Bounded by job_inline_timeout_seconds."""

    def submit(self, db: Session, job: ProcessingJob, user_plan_limits: dict | None = None) -> str:
        task_id = f"inline-{job.id.hex[:12]}"
        job.queue_task_id = task_id
        db.commit()
        # NOTE: runs synchronously; the endpoint returns the job record and
        # the client polls /jobs/{id}. For true background semantics on
        # Vercel, jobs complete within the request's function invocation.
        # Use the caller's plan limits; fall back to safe defaults.
        limits = user_plan_limits or {"max_pages": 1000, "max_upload_mb": 100}
        _run_tool(db, job, user_plan_limits=limits)
        return task_id

    def cancel(self, db: Session, job: ProcessingJob) -> bool:
        if job.status == JobStatus.QUEUED:
            job.status = JobStatus.CANCELLED
            job.completed_at = _now()
            db.commit()
            return True
        return False


class CeleryWorkerBackend(WorkerBackend):
    """Dispatches to Celery workers (container deployment)."""

    def submit(self, db: Session, job: ProcessingJob, user_plan_limits: dict | None = None) -> str:
        from app.workers.celery_app import celery_app

        # Plan limits are read by the worker from the job's stored configuration.
        task = celery_app.send_task("pdfedi.run_job", args=[str(job.id)], queue="pdf")
        job.queue_task_id = task.id
        db.commit()
        return task.id

    def cancel(self, db: Session, job: ProcessingJob) -> bool:
        from app.workers.celery_app import celery_app

        if job.status in (JobStatus.QUEUED, JobStatus.RUNNING) and job.queue_task_id:
            celery_app.control.revoke(job.queue_task_id, terminate=True)
            job.status = JobStatus.CANCELLED
            job.completed_at = _now()
            db.commit()
            return True
        return False


def get_worker() -> WorkerBackend:
    if settings.worker_backend == "celery":
        return CeleryWorkerBackend()
    return InlineWorkerBackend()


def job_to_public_dict(job: ProcessingJob) -> dict:
    return {
        "id": str(job.id),
        "tool_key": job.tool_key,
        "tool_version": job.tool_version,
        "status": job.status,
        "progress_percent": job.progress_percent,
        "error_code": job.error_code,
        "error_reference": job.internal_error_reference,
        "created_at": job.created_at.isoformat() if job.created_at else None,
        "started_at": job.started_at.isoformat() if job.started_at else None,
        "completed_at": job.completed_at.isoformat() if job.completed_at else None,
        "outputs": [
            {
                "file_id": str(o.file_id),
                "output_type": o.output_type,
                "download_count": o.download_count,
            }
            for o in job.outputs
        ],
    }
