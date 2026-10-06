"""Password hashing (Argon2id) and JWT session tokens.

Security notes:
- Passwords are hashed with Argon2id (OWASP recommended). Never log or
  return hashes.
- Access tokens are short-lived JWTs. Refresh tokens are opaque random
  strings; only their SHA-256 hash is stored in the database, enabling
  rotation and revocation without ever persisting a usable token.
- Token payloads never carry roles, plan status, or quotas — those are
  always resolved server-side from the database on each request.
"""
from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import datetime, timedelta, timezone

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError

from app.core.config import get_settings
from app.core.errors import TokenExpired, TokenInvalid

_ph = PasswordHasher()  # Argon2id with OWASP-sensible defaults
_settings = get_settings()


# --- Passwords ---
def hash_password(password: str) -> str:
    return _ph.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return _ph.verify(password_hash, password)
    except VerifyMismatchError:
        return False
    except Exception:
        return False


def password_needs_rehash(password_hash: str) -> bool:
    return _ph.check_needs_rehash(password_hash)


# --- Access tokens (JWT, short-lived) ---
def create_access_token(*, user_id: uuid.UUID, session_id: uuid.UUID) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "sid": str(session_id),
        "typ": "access",
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=_settings.access_token_expire_minutes)).timestamp()),
        "jti": uuid.uuid4().hex,
    }
    return jwt.encode(payload, _settings.jwt_secret_key, algorithm=_settings.jwt_algorithm)


def decode_access_token(token: str) -> dict:
    try:
        payload = jwt.decode(token, _settings.jwt_secret_key, algorithms=[_settings.jwt_algorithm])
    except jwt.ExpiredSignatureError as e:
        raise TokenExpired() from e
    except jwt.InvalidTokenError as e:
        raise TokenInvalid() from e
    if payload.get("typ") != "access":
        raise TokenInvalid("Invalid token type.")
    return payload


# --- Refresh tokens (opaque, hashed at rest, rotating) ---
def generate_refresh_token() -> tuple[str, str]:
    """Return (plaintext_token, sha256_hash). Store only the hash."""
    token = secrets.token_urlsafe(48)
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    return token, token_hash


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


# --- Single-use tokens (email verification, password reset) ---
def generate_single_use_token() -> tuple[str, str]:
    token = secrets.token_urlsafe(32)
    return token, hash_token(token)
