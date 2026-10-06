"""Uploads, files and downloads.

- POST /api/v1/uploads            multipart file upload (plan limits enforced)
- GET  /api/v1/files              list own files (cursor pagination)
- GET  /api/v1/files/{id}         file metadata
- DELETE /api/v1/files/{id}       delete own file
- GET  /api/v1/downloads/{file_id} authorized short-lived download (stream)
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.anonymous import ANONYMOUS_USER_ID
from app.core.deps import get_db
from app.core.errors import NotFound
from app.core.rate_limit import rate_limit
from app.db.models import File, User
from app.schemas.v1 import FileResponse, PageResponse
from app.services import file_service
from app.services.storage import get_storage

uploads_router = APIRouter()
files_router = APIRouter()
downloads_router = APIRouter()


@uploads_router.post("", dependencies=[Depends(rate_limit("upload"))])
async def upload(file: UploadFile, db: Session = Depends(get_db)):
    from app.core.config import get_settings
    _settings = get_settings()
    data = await file.read()
    # Flat 4MB upload limit (user requirement). No other file size restrictions.
    max_mb = _settings.max_upload_mb
    if len(data) > max_mb * 1024 * 1024:
        from app.core.errors import FileTooLarge

        raise FileTooLarge(f"File exceeds the {max_mb}MB upload limit.")
    stored = file_service.store_upload(
        db,
        owner_id=ANONYMOUS_USER_ID,
        filename=file.filename or "upload",
        data=data,
        content_type_hint=file.content_type,
        max_mb=max_mb,
        max_pages=500,
        retention_days=2,
    )
    return file_service.file_to_public_dict(stored)


@files_router.get("", response_model=PageResponse)
def list_files(
    db: Session = Depends(get_db),
    cursor: str | None = Query(default=None),
    limit: int = Query(default=20, le=100),
):
    q = (
        select(File)
        .where(File.owner_user_id == ANONYMOUS_USER_ID, File.deleted_at.is_(None))
        .order_by(File.created_at.desc(), File.id.desc())
        .limit(limit + 1)
    )
    if cursor:
        try:
            c_time, c_id = cursor.split("|")
            from datetime import datetime

            q = q.where((File.created_at < datetime.fromisoformat(c_time)) | ((File.created_at == datetime.fromisoformat(c_time)) & (File.id < uuid.UUID(c_id))))
        except Exception:
            pass
    rows = list(db.scalars(q))
    next_cursor = None
    if len(rows) > limit:
        rows = rows[:limit]
        last = rows[-1]
        next_cursor = f"{last.created_at.isoformat()}|{last.id}"
    return PageResponse(
        items=[file_service.file_to_public_dict(f) for f in rows],
        next_cursor=next_cursor,
    )


@files_router.get("/{file_id}", response_model=FileResponse)
def get_file(file_id: uuid.UUID, db: Session = Depends(get_db)):
    f = file_service.get_user_file(db, owner_id=ANONYMOUS_USER_ID, file_id=file_id)
    d = file_service.file_to_public_dict(f)
    return FileResponse(id=f.id, display_name=d["display_name"], content_type=d["content_type"],
                        size_bytes=d["size_bytes"], page_count=d["page_count"],
                        upload_status=d["upload_status"], created_at=f.created_at)


@files_router.delete("/{file_id}")
def delete_file(file_id: uuid.UUID, db: Session = Depends(get_db)):
    file_service.delete_file(db, owner_id=ANONYMOUS_USER_ID, file_id=file_id)
    return {"message": "File deleted."}


@downloads_router.get("/{file_id}", dependencies=[Depends(rate_limit("download"))])
def download(file_id: uuid.UUID, db: Session = Depends(get_db)):
    """Authorized download: ownership verified, then streamed. For outputs,
    the download is counted."""
    from app.core.config import get_settings
    from app.core.errors import FileTooLarge
    from app.db.models import JobOutput

    _settings = get_settings()
    f = file_service.get_user_file(db, owner_id=ANONYMOUS_USER_ID, file_id=file_id)
    storage = get_storage()

    # Flat 4MB download limit (user requirement)
    max_bytes = _settings.max_download_mb * 1024 * 1024
    if f.size_bytes and f.size_bytes > max_bytes:
        raise FileTooLarge(f"File exceeds the {_settings.max_download_mb}MB download limit.")

    out = db.scalar(select(JobOutput).where(JobOutput.file_id == f.id))
    if out:
        out.download_count += 1
        db.commit()

    def _stream():
        # Chunked streaming keeps memory flat for large files.
        data = storage.get(f.internal_storage_key)
        chunk = 1024 * 256
        for i in range(0, len(data), chunk):
            yield data[i : i + chunk]

    headers = {"Content-Disposition": f'attachment; filename="{f.safe_display_name}"'}
    return StreamingResponse(_stream(), media_type=f.detected_content_type, headers=headers)


@downloads_router.post("/zip", dependencies=[Depends(rate_limit("download"))])
def download_zip(body: dict, db: Session = Depends(get_db)):
    """Download multiple files as a single ZIP archive (streamed).
    Body: {"file_ids": ["uuid", ...]} — max 20 files, 100MB total.
    Ownership is verified for every file."""
    import io
    import zipfile

    file_ids = body.get("file_ids", [])
    if not isinstance(file_ids, list) or not 1 <= len(file_ids) <= 20:
        from app.core.errors import AppException
        raise AppException("Provide 1–20 file_ids.")
    storage = get_storage()
    files = []
    total = 0
    for fid in file_ids:
        try:
            f = file_service.get_user_file(db, owner_id=ANONYMOUS_USER_ID, file_id=uuid.UUID(str(fid)))
        except (ValueError, AttributeError):
            from app.core.errors import NotFound
            raise NotFound("One or more files were not found.")
        total += f.size_bytes
        if total > 100 * 1024 * 1024:
            from app.core.errors import FileTooLarge
            raise FileTooLarge("Combined size exceeds 100MB ZIP limit.")
        files.append(f)

    def _zip_stream():
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
            for f in files:
                data = storage.get(f.internal_storage_key)
                zf.writestr(f.safe_display_name, data)
        buf.seek(0)
        chunk = 1024 * 256
        while True:
            piece = buf.read(chunk)
            if not piece:
                break
            yield piece

    headers = {"Content-Disposition": 'attachment; filename="pdfedi-files.zip"'}
    return StreamingResponse(_zip_stream(), media_type="application/zip", headers=headers)
