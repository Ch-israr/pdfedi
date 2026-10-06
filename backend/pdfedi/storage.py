"""Local content-addressed file storage.

Keys are ``<sha256>.<ext>`` — identical uploads intentionally share one
object (dedup by design). Deletion is reference-counted against the files
table: the object is removed only when no file record references its key.
"""
from __future__ import annotations

from pathlib import Path

from sqlalchemy.orm import Session

from .config import get_settings
from .models import File


def storage_dir() -> Path:
    d = Path(get_settings().storage_dir)
    d.mkdir(parents=True, exist_ok=True)
    return d


def storage_key_for(sha256: str, extension: str) -> str:
    ext = extension.lower().lstrip(".") or "bin"
    return f"{sha256}.{ext}"


def put_object(key: str, data: bytes) -> Path:
    path = storage_dir() / key
    if not path.exists():
        path.write_bytes(data)
    return path


def get_object_path(key: str) -> Path:
    return storage_dir() / key


def object_exists(key: str) -> bool:
    return (storage_dir() / key).exists()


def delete_file_record(db: Session, file: File) -> None:
    """Delete a file record; remove the storage object only if unreferenced."""
    key = file.storage_key
    db.delete(file)
    db.flush()
    still_referenced = (
        db.query(File).filter(File.storage_key == key).first() is not None
    )
    if not still_referenced:
        path = storage_dir() / key
        if path.exists():
            path.unlink()
    db.commit()
