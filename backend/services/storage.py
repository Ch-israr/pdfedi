"""Private storage abstraction.

All file bytes live in private storage under server-generated keys —
never user filenames, never public web directories. Two backends:

- ``LocalStorage``: filesystem under a private dir (dev / single-node).
- ``S3Storage``: any S3-compatible object storage (AWS S3, R2, GCS, MinIO).

Downloads are served through authenticated API endpoints (streaming) —
presigned URLs are available via ``presigned_url`` for direct-to-storage
flows but are never exposed without an authorization check first.
"""
from __future__ import annotations

import os
import uuid
from abc import ABC, abstractmethod
from pathlib import Path

from app.core.config import get_settings

settings = get_settings()


def new_storage_key(*, prefix: str, suffix: str = "") -> str:
    """Server-generated, unguessable storage key. No user input inside."""
    return f"{prefix}/{uuid.uuid4().hex}{suffix}"


class StorageBackend(ABC):
    @abstractmethod
    def put(self, key: str, data: bytes, content_type: str) -> None: ...

    @abstractmethod
    def get(self, key: str) -> bytes: ...

    @abstractmethod
    def delete(self, key: str) -> None: ...

    @abstractmethod
    def exists(self, key: str) -> bool: ...

    @abstractmethod
    def size(self, key: str) -> int: ...

    def presigned_url(self, key: str, expires_seconds: int) -> str | None:
        return None


class LocalStorage(StorageBackend):
    def __init__(self, base_dir: str | None = None):
        self.base = Path(base_dir or settings.storage_local_dir)
        self.base.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        # Guard against path traversal even though keys are server-generated.
        p = (self.base / key).resolve()
        if not str(p).startswith(str(self.base.resolve())):
            raise ValueError("Invalid storage key")
        return p

    def put(self, key: str, data: bytes, content_type: str) -> None:
        p = self._path(key)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)

    def get(self, key: str) -> bytes:
        return self._path(key).read_bytes()

    def delete(self, key: str) -> None:
        try:
            self._path(key).unlink()
        except FileNotFoundError:
            pass

    def exists(self, key: str) -> bool:
        return self._path(key).exists()

    def size(self, key: str) -> int:
        return self._path(key).stat().st_size


class S3Storage(StorageBackend):
    def __init__(self):
        import boto3

        self._s3 = boto3.client(
            "s3",
            endpoint_url=settings.s3_endpoint_url,
            region_name=settings.s3_region,
            aws_access_key_id=settings.s3_access_key_id,
            aws_secret_access_key=settings.s3_secret_access_key,
        )
        self.bucket = settings.s3_bucket

    def put(self, key: str, data: bytes, content_type: str) -> None:
        self._s3.put_object(Bucket=self.bucket, Key=key, Body=data, ContentType=content_type)

    def get(self, key: str) -> bytes:
        resp = self._s3.get_object(Bucket=self.bucket, Key=key)
        return resp["Body"].read()

    def delete(self, key: str) -> None:
        self._s3.delete_object(Bucket=self.bucket, Key=key)

    def exists(self, key: str) -> bool:
        try:
            self._s3.head_object(Bucket=self.bucket, Key=key)
            return True
        except Exception:
            return False

    def size(self, key: str) -> int:
        return self._s3.head_object(Bucket=self.bucket, Key=key)["ContentLength"]

    def presigned_url(self, key: str, expires_seconds: int) -> str | None:
        return self._s3.generate_presigned_url(
            "get_object", Params={"Bucket": self.bucket, "Key": key}, ExpiresIn=expires_seconds
        )


def get_storage() -> StorageBackend:
    if settings.storage_backend == "s3":
        return S3Storage()
    return LocalStorage()


# Convenience for temp workspaces
def ensure_work_dir(base: str | None = None) -> Path:
    """Create a unique temp work directory.
    
    On Vercel serverless, only /tmp is writable. Defaults to /tmp on Vercel,
    ./var/tmp otherwise.
    """
    import os
    if base is None:
        base = "/tmp/pdfedi-work" if os.getenv("VERCEL") else "./var/tmp"
    d = Path(base) / uuid.uuid4().hex
    d.mkdir(parents=True, exist_ok=True)
    return d


def cleanup_work_dir(path: Path) -> None:
    import shutil

    shutil.rmtree(path, ignore_errors=True)
