"""Secure file upload lifecycle.

Every upload follows the controlled path:
1. Caller authenticated & authorized (done in the endpoint via deps).
2. Plan limits resolved server-side (size, pages).
3. Extension allowlist + declared MIME treated as hint only.
4. Actual file signature (magic bytes) verified.
5. Parser readability check (PDF opens, page count read).
6. Filename sanitized; storage key is server-generated UUID.
7. SHA-256 computed; metadata row created; bytes to private storage.

Never: trust extension/MIME alone, use user filenames as paths, store
raw bytes in Postgres, execute embedded JS, or return storage keys.
"""
from __future__ import annotations

import hashlib
import re
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import PurePath

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import (
    FileCorrupt,
    FileEncrypted,
    FilePageLimit,
    FileSignatureMismatch,
    FileTooLarge,
    FileTypeNotAllowed,
)
from app.core.logging import get_logger
from app.db.models import File, User
from app.db.models.enums import FileUploadStatus, StorageClass
from app.services.storage import get_storage, new_storage_key

log = get_logger("pdfedi.files")
settings = get_settings()

# Magic bytes: format -> list of (offset, signature)
SIGNATURES: dict[str, list[tuple[int, bytes]]] = {
    "pdf": [(0, b"%PDF-")],
    "png": [(0, b"\x89PNG\r\n\x1a\n")],
    "jpg": [(0, b"\xff\xd8\xff")],
    "jpeg": [(0, b"\xff\xd8\xff")],
    "tiff": [(0, b"II*\x00"), (0, b"MM\x00*")],
    "tif": [(0, b"II*\x00"), (0, b"MM\x00*")],
    "bmp": [(0, b"BM")],
    "webp": [(0, b"RIFF"), (8, b"WEBP")],
}

EXTENSION_BY_TYPE = {"pdf": "pdf", "png": "png", "jpg": "jpg", "jpeg": "jpg"}


def sanitize_filename(name: str) -> str:
    """Strip paths, control chars; keep a safe display name."""
    base = PurePath(name).name  # drops any directory components
    base = re.sub(r"[\x00-\x1f\x7f]", "", base)
    base = re.sub(r"[^A-Za-z0-9._\- ]", "_", base).strip(" .")
    return base[:200] or "file"


def detect_extension(data: bytes) -> str | None:
    for ext, sigs in SIGNATURES.items():
        for offset, sig in sigs:
            if data[offset : offset + len(sig)] == sig:
                return ext
    return None


def _pdf_page_count(data: bytes) -> tuple[int, bool]:
    """Return (page_count, encrypted). Raises FileCorrupt if unreadable.
    
    Uses pypdf (BSD). Falls back to pypdfium2 (Apache-2.0).
    Never requires PyMuPDF (AGPL) — see ARCHITECTURE.md Decision 2.
    """
    # Try pypdf first (pure Python, BSD)
    try:
        from pypdf import PdfReader
        import io
        reader = PdfReader(io.BytesIO(data))
        encrypted = reader.is_encrypted
        count = 0 if encrypted else len(reader.pages)
        return count, encrypted
    except Exception:
        pass
    # Fall back to pypdfium2 (Apache-2.0, PDFium bindings)
    try:
        import pypdfium2 as pdfium
        pdf = pdfium.PdfDocument(data)
        count = len(pdf)
        # pypdfium2 raises on encrypted without password; if we got here it's readable
        return count, False
    except Exception as e:
        raise FileCorrupt(f"Could not parse PDF: {type(e).__name__}") from e


def validate_upload(*, filename: str, data: bytes, max_mb: float, max_pages: int) -> dict:
    """Full validation. Returns metadata dict or raises a safe AppException."""
    size_mb = len(data) / (1024 * 1024)
    if size_mb > max_mb:
        raise FileTooLarge(f"File is {size_mb:.1f} MB; your plan allows {max_mb} MB.")

    declared_ext = PurePath(filename).suffix.lower().lstrip(".")
    if declared_ext not in settings.allowed_upload_extensions:
        raise FileTypeNotAllowed(f".{declared_ext or '?'} files are not accepted.")

    detected = detect_extension(data)
    if not detected:
        raise FileSignatureMismatch("File content could not be recognized.")
    # Declared type must match actual content (allow jpg/jpeg alias)
    if EXTENSION_BY_TYPE.get(detected, detected) != EXTENSION_BY_TYPE.get(declared_ext, declared_ext):
        # For PDF tools the critical check: a claimed PDF must really be a PDF.
        if declared_ext == "pdf" or detected == "pdf":
            raise FileSignatureMismatch("File content does not match its extension.")

    meta: dict = {"detected_type": detected, "size_bytes": len(data)}
    if detected == "pdf":
        pages, encrypted = _pdf_page_count(data)
        if encrypted:
            raise FileEncrypted("This PDF is password-protected.")
        if pages > max_pages:
            raise FilePageLimit(f"PDF has {pages} pages; your plan allows {max_pages}.")
        if pages == 0:
            raise FileCorrupt("PDF has no readable pages.")
        meta["page_count"] = pages
    return meta


def store_upload(
    db: Session,
    *,
    owner_id: uuid.UUID,
    filename: str,
    data: bytes,
    content_type_hint: str | None,
    max_mb: float,
    max_pages: int,
    storage_class: str = StorageClass.INPUT,
    retention_days: int = 7,
) -> File:
    meta = validate_upload(filename=filename, data=data, max_mb=max_mb, max_pages=max_pages)
    storage = get_storage()
    safe_name = sanitize_filename(filename)
    ext = meta["detected_type"]
    file_hash = hashlib.sha256(data).hexdigest()

    # Deduplication: if this user already has a file with identical content,
    # reuse the stored bytes instead of writing duplicates. Each upload still
    # gets its own metadata row so access control and retention stay per-file.
    existing = db.scalar(
        select(File).where(
            File.owner_user_id == owner_id,
            File.sha256 == file_hash,
            File.deleted_at.is_(None),
        ).order_by(File.created_at.desc())
    )
    if existing and storage.exists(existing.internal_storage_key):
        key = existing.internal_storage_key
        log.info("file_dedup_hit", user_id=str(owner_id), sha256=file_hash[:12])
    else:
        key = new_storage_key(prefix=f"{getattr(storage_class, 'value', storage_class)}/{owner_id}", suffix=f".{ext}")
        storage.put(key, data, content_type=f"application/{ext}" if ext == "pdf" else f"image/{ext}")

    now = datetime.now(timezone.utc)
    # Ensure anonymous owner row exists (safe for serverless concurrency).
    # The startup lifespan also does this, but serverless cold starts may race.
    from app.core.anonymous import ANONYMOUS_USER_ID, ensure_anonymous_user
    if owner_id == ANONYMOUS_USER_ID:
        ensure_anonymous_user(db)
    f = File(
        owner_user_id=owner_id,
        original_filename=filename[:512],
        safe_display_name=safe_name,
        internal_storage_key=key,  # never returned to clients
        detected_content_type=f"application/{ext}" if ext == "pdf" else f"image/{ext}",
        size_bytes=len(data),
        sha256=file_hash,
        page_count=meta.get("page_count"),
        encrypted_pdf=False,
        upload_status=FileUploadStatus.VALIDATED,
        storage_class=storage_class,
        retention_expires_at=now + timedelta(days=retention_days),
        validation_report={k: v for k, v in meta.items() if k != "size_bytes"},
    )
    db.add(f)
    db.commit()
    db.refresh(f)
    log.info("file_stored", file_id=str(f.id), user_id=str(owner_id), size=len(data), type=ext)
    return f


def get_user_file(db: Session, *, owner_id: uuid.UUID, file_id: uuid.UUID) -> File:
    """Ownership-enforced fetch. Raises NotFound (not Forbidden) to avoid
    leaking existence of other users' files."""
    from app.core.errors import NotFound

    f = db.get(File, file_id)
    if not f or f.owner_user_id != owner_id or f.is_deleted:
        raise NotFound("File not found.")
    return f


def delete_file(db: Session, *, owner_id: uuid.UUID, file_id: uuid.UUID) -> None:
    f = get_user_file(db, owner_id=owner_id, file_id=file_id)
    # Dedup-aware: only delete storage bytes if no other live file references the key.
    # (store_upload reuses storage keys on SHA-256 match; blind delete would break siblings.)
    from sqlalchemy import func, select
    from app.db.models.files import File as FileModel
    siblings = db.scalar(
        select(func.count())
        .select_from(FileModel)
        .where(
            FileModel.internal_storage_key == f.internal_storage_key,
            FileModel.id != f.id,
            FileModel.deleted_at.is_(None),
        )
    )
    if not siblings:
        get_storage().delete(f.internal_storage_key)
    f.deleted_at = datetime.now(timezone.utc)
    f.upload_status = FileUploadStatus.DELETED
    db.commit()
    log.info("file_deleted", file_id=str(file_id), user_id=str(owner_id))


def file_to_public_dict(f: File) -> dict:
    """Safe serialization — internal_storage_key is NEVER included."""
    return {
        "id": str(f.id),
        "display_name": f.safe_display_name,
        "content_type": f.detected_content_type,
        "size_bytes": f.size_bytes,
        "page_count": f.page_count,
        "upload_status": f.upload_status,
        "storage_class": f.storage_class,
        "retention_expires_at": f.retention_expires_at.isoformat() if f.retention_expires_at else None,
        "created_at": f.created_at.isoformat(),
    }
