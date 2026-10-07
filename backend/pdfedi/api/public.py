"""Public API: tools, uploads, files, jobs, downloads. No auth required."""
from __future__ import annotations

import json

from fastapi import APIRouter, Depends, File as FastAPIFile, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import jobs
from ..config import get_settings
from ..db import get_db
from ..models import File, Job, enum_value
from ..models import JobStatus
from ..storage import get_object_path
from ..tools import list_specs

router = APIRouter()


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


# ---------------------------------------------------------------------------
# Serialization
# ---------------------------------------------------------------------------
def file_to_dict(f: File) -> dict:
    return {
        "id": f.id,
        "filename": f.filename,
        "size_bytes": f.size_bytes,
        "mime": f.mime,
        "sha256": f.sha256,
        "kind": f.kind,
        "upload_status": f.status,
        "page_count": f.page_count,
        "created_at": f.created_at,
    }


def job_to_dict(j: Job) -> dict:
    return {
        "id": j.id,
        "tool": j.tool,
        "status": j.status,
        "file_ids": json.loads(j.file_ids),
        "options": json.loads(j.options),
        "output_file_id": j.output_file_id,
        "error": j.error,
        "created_at": j.created_at,
        "updated_at": j.updated_at,
    }


def _as_http_error(e: jobs.UploadError) -> HTTPException:
    return HTTPException(status_code=e.status_code, detail=str(e))


# ---------------------------------------------------------------------------
# Tools
# ---------------------------------------------------------------------------
@router.get("/tools")
def list_tools():
    return [
        {
            "key": s.key,
            "name": s.name,
            "tagline": s.tagline,
            "description": s.description,
            "input_kinds": s.input_kinds,
            "min_files": s.min_files,
            "max_files": s.max_files,
            "options": [
                {
                    "name": o.name, "kind": o.kind, "label": o.label,
                    "required": o.required, "default": o.default,
                    "choices": o.choices, "help": o.help,
                }
                for o in s.options
            ],
            "output_kind": s.output_kind,
            "output_ext": s.output_ext,
            "activity": s.activity,
        }
        for s in list_specs()
    ]


@router.get("/tools/{tool_key}")
def tool_detail(tool_key: str):
    specs = {s.key: s for s in list_specs()}
    s = specs.get(tool_key)
    if s is None:
        raise HTTPException(status_code=404, detail="Unknown tool")
    return {
        "key": s.key, "name": s.name, "tagline": s.tagline,
        "description": s.description, "input_kinds": s.input_kinds,
        "min_files": s.min_files, "max_files": s.max_files,
        "options": [
            {"name": o.name, "kind": o.kind, "label": o.label,
             "required": o.required, "default": o.default,
             "choices": o.choices, "help": o.help}
            for o in s.options
        ],
        "output_kind": s.output_kind, "output_ext": s.output_ext,
        "activity": s.activity,
    }


# ---------------------------------------------------------------------------
# Uploads & files
# ---------------------------------------------------------------------------
@router.post("/uploads")
async def upload_file(
    request: Request,
    file: UploadFile = FastAPIFile(...),
    db: Session = Depends(get_db),
):
    data = await file.read()
    try:
        record = jobs.ingest_upload(db, file.filename or "upload", data, file.content_type or "")
    except jobs.UploadError as e:
        raise _as_http_error(e)
    return file_to_dict(record)


@router.get("/files/{file_id}")
def get_file(file_id: str, db: Session = Depends(get_db)):
    f = db.query(File).filter(File.id == file_id).first()
    if f is None:
        raise HTTPException(status_code=404, detail="File not found")
    return file_to_dict(f)


@router.delete("/files/{file_id}")
def delete_file_endpoint(file_id: str, db: Session = Depends(get_db)):
    try:
        jobs.delete_file(db, file_id)
    except jobs.UploadError as e:
        raise _as_http_error(e)
    return {"deleted": True, "id": file_id}


# ---------------------------------------------------------------------------
# Jobs
# ---------------------------------------------------------------------------
class JobCreate(BaseModel):
    tool_key: str
    file_ids: list[str]
    config: dict = {}


@router.post("/jobs", status_code=202)
def create_job(payload: JobCreate, request: Request, db: Session = Depends(get_db)):
    """Create a job and start it in the background.

    Returns 202 immediately with status `queued`. Poll GET /jobs/{id} for
    real progress: queued → running → succeeded | failed.
    """
    ip = _client_ip(request)
    try:
        job = jobs.create_job(db, payload.tool_key, payload.file_ids, payload.config or {}, ip)
    except jobs.UploadError as e:
        raise _as_http_error(e)
    jobs.enqueue_job(job.id, ip)
    db.refresh(job)
    return job_to_dict(job)


@router.get("/jobs/{job_id}")
def get_job(job_id: str, db: Session = Depends(get_db)):
    j = db.query(Job).filter(Job.id == job_id).first()
    if j is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return job_to_dict(j)


@router.post("/jobs/{job_id}/cancel")
def cancel_job(job_id: str, db: Session = Depends(get_db)):
    try:
        j = jobs.cancel_job(db, job_id)
    except jobs.UploadError as e:
        raise _as_http_error(e)
    return job_to_dict(j)


@router.post("/jobs/{job_id}/retry", status_code=202)
def retry_job(job_id: str, request: Request, db: Session = Depends(get_db)):
    try:
        j = jobs.retry_job(db, job_id, _client_ip(request))
    except jobs.UploadError as e:
        raise _as_http_error(e)
    return job_to_dict(j)


# ---------------------------------------------------------------------------
# Downloads
# ---------------------------------------------------------------------------
@router.get("/downloads/{file_id}")
def download_file(file_id: str, db: Session = Depends(get_db)):
    settings = get_settings()
    f = db.query(File).filter(File.id == file_id).first()
    if f is None:
        raise HTTPException(status_code=404, detail="File not found")
    if f.size_bytes > settings.max_download_bytes:
        raise HTTPException(status_code=413, detail="File exceeds the download limit")
    path = get_object_path(f.storage_key)
    if not path.exists():
        raise HTTPException(status_code=410, detail="File no longer available")
    return FileResponse(path, media_type=f.mime or "application/octet-stream", filename=f.filename)


# ---------------------------------------------------------------------------
# Quota info (lets the frontend show remaining uses)
# ---------------------------------------------------------------------------
@router.get("/quota/{tool_key}")
def quota_info(tool_key: str, request: Request, db: Session = Depends(get_db)):
    from .. import quotas as quota_mod

    allowed, used, limit = quota_mod.check_quota(db, _client_ip(request), tool_key)
    return {"tool": tool_key, "used": used, "limit": limit, "remaining": max(0, limit - used)}


@router.get("/limits")
def limits():
    """File-size limits, so the frontend validates against real config."""
    settings = get_settings()
    return {
        "max_upload_mb": settings.max_upload_mb,
        "max_download_mb": settings.max_download_mb,
    }
