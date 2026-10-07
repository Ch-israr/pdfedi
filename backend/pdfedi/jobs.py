"""Job lifecycle and upload ingestion.

Uploads are validated synchronously (PDF parses, page count extracted).
Jobs run in background threads — the API returns immediately with status
`queued` and clients poll GET /api/v1/jobs/{id} for real progress states:
queued → running → succeeded | failed (or cancelled).
"""
from __future__ import annotations

import hashlib
import io
import json
import logging
import threading
import uuid

from pypdf import PdfReader
from sqlalchemy.orm import Session

from .config import get_settings
from .db import SessionLocal
from .models import File, FileKind, FileStatus, Job, JobStatus, enum_value
from . import quotas
from .storage import delete_file_record, get_object_path, put_object, storage_key_for
from .timeutil import utcnow_iso
from .tools import get_tool
from .tools.base import ToolContext, ToolError, ToolInput

log = logging.getLogger("pdfedi.jobs")

PDF_MIME = "application/pdf"
IMAGE_MIMES = {"image/png", "image/jpeg", "image/webp"}

# Concurrency guard: limits simultaneous job executions to protect
# memory-constrained hosts. The semaphore is created lazily from settings
# so tests can override MAX_CONCURRENT_JOBS via environment.
_job_semaphore: threading.Semaphore | None = None
_job_semaphore_lock = threading.Lock()


def _get_job_semaphore() -> threading.Semaphore:
    """Return the process-wide job concurrency semaphore (configurable)."""
    global _job_semaphore
    if _job_semaphore is None:
        with _job_semaphore_lock:
            if _job_semaphore is None:
                limit = max(1, get_settings().max_concurrent_jobs)
                _job_semaphore = threading.Semaphore(limit)
                log.info("job concurrency limit: %d", limit)
    return _job_semaphore


class UploadError(Exception):
    def __init__(self, message: str, *, status_code: int = 422):
        super().__init__(message)
        self.status_code = status_code


def _extension_for(filename: str, mime: str) -> str:
    if "." in filename:
        return filename.rsplit(".", 1)[-1].lower()[:10]
    return {"application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg"}.get(mime, "bin")


def ingest_upload(db: Session, filename: str, data: bytes, mime: str) -> File:
    """Validate and persist an uploaded file. Raises UploadError on problems."""
    settings = get_settings()
    if len(data) > settings.max_upload_bytes:
        raise UploadError(
            f"File exceeds the {settings.max_upload_mb} MB upload limit.",
            status_code=413,
        )
    if not data:
        raise UploadError("Empty file.", status_code=422)

    kind = (mime or "").lower()
    is_pdf = kind == PDF_MIME or filename.lower().endswith(".pdf")
    is_image = kind in IMAGE_MIMES or filename.lower().endswith((".png", ".jpg", ".jpeg", ".webp"))

    page_count: int | None = None
    if is_pdf:
        if not data.startswith(b"%PDF-"):
            raise UploadError("Not a valid PDF file.", status_code=422)
        try:
            reader = PdfReader(io.BytesIO(data))
            if reader.is_encrypted:
                # Allowed through: the Unlock PDF tool decrypts it.
                # page_count is unknown until the password is supplied.
                page_count = None
            else:
                page_count = len(reader.pages)
        except Exception as e:
            raise UploadError(f"Could not parse PDF: {e}", status_code=422) from e
        mime = PDF_MIME
    elif not is_image:
        raise UploadError("Unsupported file type. Upload a PDF or an image.", status_code=422)

    sha256 = hashlib.sha256(data).hexdigest()
    key = storage_key_for(sha256, _extension_for(filename, mime))
    put_object(key, data)

    record = File(
        id=uuid.uuid4().hex,
        sha256=sha256,
        filename=filename[:255],
        size_bytes=len(data),
        mime=mime,
        storage_key=key,
        kind=enum_value(FileKind.INPUT),
        status=enum_value(FileStatus.VALIDATED),
        page_count=page_count,
        created_at=utcnow_iso(),
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


def create_job(db: Session, tool_key: str, file_ids: list[str], options: dict, client_ip: str) -> Job:
    tool = get_tool(tool_key)
    if tool is None:
        raise UploadError(f"Unknown tool: {tool_key}", status_code=404)
    spec = tool.SPEC

    if not isinstance(file_ids, list) or not (spec.min_files <= len(file_ids) <= spec.max_files):
        raise UploadError(
            f"{spec.name} needs {spec.min_files}–{spec.max_files} file(s).",
            status_code=422,
        )

    files = []
    for fid in file_ids:
        f = db.query(File).filter(File.id == fid).first()
        if f is None or f.status != FileStatus.VALIDATED.value:
            raise UploadError("One or more input files are not ready.", status_code=422)
        if "pdf" in spec.input_kinds and f.mime != PDF_MIME:
            raise UploadError(f"{spec.name} needs PDF input.", status_code=422)
        if "image" in spec.input_kinds and f.mime not in IMAGE_MIMES:
            raise UploadError(f"{spec.name} needs image input.", status_code=422)
        if spec.key != "unlock_pdf" and _stored_pdf_is_encrypted(f):
            raise UploadError(
                "This PDF is password protected. Use Unlock PDF first.",
                status_code=422,
            )
        files.append(f)

    allowed, used, limit = quotas.check_quota(db, client_ip, tool_key)
    if not allowed:
        raise UploadError(
            f"Hourly limit reached for {spec.name} ({used}/{limit}). Try again later.",
            status_code=429,
        )

    job = Job(
        id=uuid.uuid4().hex,
        tool=tool_key,
        status=enum_value(JobStatus.QUEUED),
        file_ids=json.dumps([f.id for f in files]),
        options=json.dumps(options or {}),
        created_at=utcnow_iso(),
        updated_at=utcnow_iso(),
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


def _stored_pdf_is_encrypted(f: File) -> bool:
    """Check whether a stored PDF is encrypted.

    Uses the file path directly instead of loading the whole file into
    RAM: PdfReader only parses the header/trailer for is_encrypted.
    """
    if f.mime != PDF_MIME:
        return False
    try:
        # PdfReader accepts a path; it does NOT slurp the whole file for
        # a simple is_encrypted check (reads header + trailer only).
        return PdfReader(get_object_path(f.storage_key)).is_encrypted
    except Exception:  # noqa: BLE001 — treat unreadable as not encrypted
        return False


def _run_in_thread(job_id: str, client_ip: str) -> None:
    """Worker entry point: own DB session, never leaks exceptions.

    Acquires the concurrency semaphore first: if too many jobs are already
    running, this worker waits here (job stays QUEUED) until a slot frees.
    If the worker dies unexpectedly, the job is marked failed instead of
    being left stuck in "running" forever.
    """
    sem = _get_job_semaphore()
    # Wait for a slot. No timeout: queued jobs wait their turn; the
    # frontend polls and shows "Queued" meanwhile.
    sem.acquire()
    db = SessionLocal()
    try:
        run_job(db, job_id, client_ip)
    except Exception:  # noqa: BLE001 — run_job already records failures
        log.exception("background worker crashed for job %s", job_id)
        try:
            db.rollback()
            job = db.query(Job).filter(Job.id == job_id).first()
            if job is not None and job.status == JobStatus.RUNNING.value:
                job.status = enum_value(JobStatus.FAILED)
                job.error = "Processing was interrupted unexpectedly. Please try again."
                job.updated_at = utcnow_iso()
                db.commit()
        except Exception:  # noqa: BLE001 — best effort only
            log.exception("could not mark crashed job %s as failed", job_id)
    finally:
        db.close()
        sem.release()


def enqueue_job(job_id: str, client_ip: str) -> None:
    """Start background execution of a queued job. Returns immediately."""
    thread = threading.Thread(
        target=_run_in_thread, args=(job_id, client_ip), daemon=True,
        name=f"pdfedi-job-{job_id[:8]}",
    )
    thread.start()


def run_job(db: Session, job_id: str, client_ip: str) -> Job:
    """Execute a job. Never raises — failures are recorded on the job."""
    job = db.query(Job).filter(Job.id == job_id).first()
    if job is None:
        raise UploadError("Job not found.", status_code=404)
    if job.status == JobStatus.CANCELLED.value:
        return job  # cancelled while queued — leave it
    if job.status not in (JobStatus.QUEUED.value, JobStatus.FAILED.value):
        return job

    tool = get_tool(job.tool)
    job.status = enum_value(JobStatus.RUNNING)
    job.updated_at = utcnow_iso()
    db.commit()

    ctx = ToolContext([])
    try:
        file_ids = json.loads(job.file_ids)
        options = json.loads(job.options)
        inputs = []
        for fid in file_ids:
            f = db.query(File).filter(File.id == fid).first()
            if f is None:
                raise ToolError("An input file is missing.")
            inputs.append(ToolInput(
                file_id=f.id, filename=f.filename, path=get_object_path(f.storage_key),
                size=f.size_bytes, sha256=f.sha256, page_count=f.page_count,
            ))
        ctx = ToolContext(inputs)
        output_path = tool.run(ctx, options if isinstance(options, dict) else {})
        data = output_path.read_bytes()

        settings = get_settings()
        if len(data) > settings.max_download_bytes:
            raise ToolError(f"Output exceeds the {settings.max_download_mb} MB download limit.")

        spec = tool.SPEC
        sha256 = hashlib.sha256(data).hexdigest()
        key = storage_key_for(sha256, spec.output_ext)
        put_object(key, data)
        out = File(
            id=uuid.uuid4().hex,
            sha256=sha256,
            filename=f"{job.tool}_output.{spec.output_ext}",
            size_bytes=len(data),
            mime=spec.output_mime,
            storage_key=key,
            kind=enum_value(FileKind.OUTPUT),
            status=enum_value(FileStatus.VALIDATED),
            created_at=utcnow_iso(),
        )
        db.add(out)
        db.flush()
        job.output_file_id = out.id
        job.status = enum_value(JobStatus.SUCCEEDED)
        job.error = None
        quotas.record_success(db, client_ip, job.tool)
    except ToolError as e:
        job.status = enum_value(JobStatus.FAILED)
        job.error = str(e)
        log.info("job %s failed (user error): %s", job.id, e)
    except Exception as e:  # noqa: BLE001 — recorded, never leaked raw
        job.status = enum_value(JobStatus.FAILED)
        job.error = "Processing failed. Please try again."
        log.exception("job %s failed (internal)", job.id)
    finally:
        job.updated_at = utcnow_iso()
        db.commit()
        ctx.cleanup()
    db.refresh(job)
    return job


def cancel_job(db: Session, job_id: str) -> Job:
    job = db.query(Job).filter(Job.id == job_id).first()
    if job is None:
        raise UploadError("Job not found.", status_code=404)
    if job.status == JobStatus.RUNNING.value:
        raise UploadError("Job is already running and cannot be cancelled.", status_code=409)
    if job.status == JobStatus.QUEUED.value:
        job.status = enum_value(JobStatus.CANCELLED)
        job.updated_at = utcnow_iso()
        db.commit()
        db.refresh(job)
    return job


def retry_job(db: Session, job_id: str, client_ip: str) -> Job:
    """Reset a failed/cancelled job to queued and re-enqueue it."""
    job = db.query(Job).filter(Job.id == job_id).first()
    if job is None:
        raise UploadError("Job not found.", status_code=404)
    if job.status not in (JobStatus.FAILED.value, JobStatus.CANCELLED.value):
        raise UploadError("Only failed or cancelled jobs can be retried.", status_code=409)
    allowed, used, limit = quotas.check_quota(db, client_ip, job.tool)
    if not allowed:
        raise UploadError(
            f"Hourly limit reached ({used}/{limit}). Try again later.", status_code=429
        )
    job.status = enum_value(JobStatus.QUEUED)
    job.error = None
    job.updated_at = utcnow_iso()
    db.commit()
    db.refresh(job)
    enqueue_job(job.id, client_ip)
    return job


def delete_file(db: Session, file_id: str) -> None:
    f = db.query(File).filter(File.id == file_id).first()
    if f is None:
        raise UploadError("File not found.", status_code=404)
    delete_file_record(db, f)
