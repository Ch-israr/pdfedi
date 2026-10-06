"""Separate admin authentication (not user auth).

Public users have NO authentication. Admins use this isolated system:
- Login with username/password (from env vars, never in code)
- JWT tokens (separate from removed user JWTs)
- Session via Authorization header

Bootstrap: ADMIN_USERNAME and ADMIN_PASSWORD_HASH in environment.
"""
from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.deps import get_db
from app.core.errors import AdminForbidden

_bearer = HTTPBearer(auto_error=False)


def _get_admin_credentials() -> tuple[str, str]:
    """Get admin username and password hash from environment."""
    settings = get_settings()
    username = getattr(settings, 'admin_username', 'admin')
    # Password hash should be set via ADMIN_PASSWORD_HASH env var
    # Format: sha256 hex digest (for v1; upgrade to argon2 later)
    pwd_hash = getattr(settings, 'admin_password_hash', '')
    return username, pwd_hash


def verify_admin_password(password: str, expected_hash: str) -> bool:
    """Verify password against SHA256 hash (v1; upgrade to argon2)."""
    if not expected_hash:
        return False
    actual = hashlib.sha256(password.encode()).hexdigest()
    return secrets.compare_digest(actual, expected_hash)


def create_admin_token(admin_id: str) -> str:
    """Create JWT for admin session (24h expiry)."""
    settings = get_settings()
    now = datetime.now(timezone.utc)
    payload = {
        "sub": admin_id,
        "type": "admin",
        "iat": now,
        "exp": now + timedelta(hours=24),
        "jti": str(uuid.uuid4()),
    }
    # Use a separate secret for admin tokens
    secret = settings.admin_jwt_secret or settings.jwt_secret_key
    return jwt.encode(payload, secret, algorithm="HS256")


def verify_admin_token(token: str) -> dict | None:
    """Verify admin JWT, return payload or None."""
    settings = get_settings()
    secret = settings.admin_jwt_secret or settings.jwt_secret_key
    try:
        payload = jwt.decode(token, secret, algorithms=["HS256"])
        if payload.get("type") != "admin":
            return None
        return payload
    except jwt.PyJWTError:
        return None


async def get_current_admin(
    request: Request,
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: Session = Depends(get_db),
) -> dict:
    """Dependency: require valid admin JWT. Returns admin info dict."""
    token = None
    if creds:
        token = creds.credentials
    if not token:
        # Also check cookie for browser-based admin UI
        token = request.cookies.get("admin_token")

    if not token:
        raise AdminForbidden("Admin authentication required.")

    payload = verify_admin_token(token)
    if not payload:
        raise AdminForbidden("Invalid or expired admin token.")

    return {
        "admin_id": payload["sub"],
        "token_id": payload.get("jti"),
    }


# For v1, all authenticated admins have full access.
# Role-based admin (super_admin, etc.) can be added later.
require_admin = get_current_admin
