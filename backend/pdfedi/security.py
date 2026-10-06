"""Admin authentication: argon2id password hashing + JWT bearer tokens.

There is no end-user auth in PDFEDI — the public tools are anonymous.
Only the /admin panel uses these helpers.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from .config import get_settings
from .db import get_db
from .models import AdminUser

_ph = PasswordHasher()
_bearer = HTTPBearer(auto_error=False)


def hash_password(password: str) -> str:
    return _ph.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return _ph.verify(password_hash, password)
    except VerifyMismatchError:
        return False
    except Exception:
        return False


def is_legacy_sha256_hash(password_hash: str) -> bool:
    return (
        len(password_hash) == 64
        and all(c in "0123456789abcdef" for c in password_hash.lower())
        and not password_hash.startswith("$argon2")
    )


def verify_legacy_sha256(password: str, password_hash: str) -> bool:
    import hashlib
    import hmac

    if not is_legacy_sha256_hash(password_hash):
        return False
    candidate = hashlib.sha256(password.encode("utf-8")).hexdigest()
    return hmac.compare_digest(candidate, password_hash.lower())


def create_admin_token(username: str) -> str:
    settings = get_settings()
    now = datetime.now(timezone.utc)
    payload = {
        "sub": username,
        "role": "admin",
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(hours=settings.jwt_expire_hours)).timestamp()),
    }
    return jwt.encode(payload, settings.jwt_secret_key, algorithm="HS256")


def decode_admin_token(token: str) -> str | None:
    """Return the username for a valid token, else None."""
    settings = get_settings()
    try:
        payload = jwt.decode(token, settings.jwt_secret_key, algorithms=["HS256"])
        username = payload.get("sub")
        return username if isinstance(username, str) else None
    except jwt.PyJWTError:
        return None


def require_admin(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: Session = Depends(get_db),
) -> AdminUser:
    """FastAPI dependency: valid admin bearer token + existing admin user."""
    unauthorized = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Admin authentication required",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if creds is None or not creds.credentials:
        raise unauthorized
    username = decode_admin_token(creds.credentials)
    if not username:
        raise unauthorized
    user = db.query(AdminUser).filter(AdminUser.username == username).first()
    if user is None:
        raise unauthorized
    return user
