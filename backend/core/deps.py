"""FastAPI dependencies: DB session, current user, roles, entitlements.

Authorization principle: identity, ownership, account status, plan
entitlement and quota are resolved server-side on EVERY protected request.
Nothing from the client (user id, role, plan) is ever trusted.
"""
from __future__ import annotations

import uuid
from collections.abc import Generator

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import AdminForbidden, Forbidden, TokenInvalid, TokenRevoked
from app.core.security import decode_access_token
from app.db.models import AuthSession, RefreshToken, Role, User, UserRole
from app.db.models.enums import AccountStatus
from app.db.session import get_db as _get_db

settings = get_settings()
_bearer = HTTPBearer(auto_error=False)


def get_db() -> Generator[Session, None, None]:
    yield from _get_db()


def _bearer_token(request: Request, creds: HTTPAuthorizationCredentials | None) -> str | None:
    if creds and creds.scheme.lower() == "bearer":
        return creds.credentials
    # Fallback: HttpOnly session cookie holds the access token for browsers
    return request.cookies.get(settings.session_cookie_name)


def get_current_user(
    request: Request,
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: Session = Depends(get_db),
) -> User:
    token = _bearer_token(request, creds)
    if not token:
        raise TokenInvalid("Authentication required.")
    payload = decode_access_token(token)
    try:
        user_id = uuid.UUID(payload["sub"])
        session_id = uuid.UUID(payload["sid"])
    except (KeyError, ValueError) as e:
        raise TokenInvalid() from e

    session = db.get(AuthSession, session_id)
    if not session or session.revoked_at or session.user_id != user_id:
        raise TokenRevoked()

    user = db.get(User, user_id)
    if not user or user.is_deleted:
        raise TokenInvalid("Account not found.")
    if user.account_status == AccountStatus.BANNED:
        from app.core.errors import AccountBanned

        raise AccountBanned()
    if user.account_status == AccountStatus.DELETED:
        from app.core.errors import AccountDeleted

        raise AccountDeleted()
    if user.account_status == AccountStatus.SUSPENDED:
        from app.core.errors import AccountSuspended

        raise AccountSuspended()
    if user.account_status == AccountStatus.LOCKED:
        from app.core.errors import AccountLocked

        raise AccountLocked()

    # Expose for rate limiting / logging (authorization still per-request)
    request.state.user_id = str(user.id)
    request.state.session_id = str(session.id)
    return user


def get_optional_user(
    request: Request,
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: Session = Depends(get_db),
) -> User | None:
    try:
        return get_current_user(request, creds, db)
    except Exception:
        return None


def _user_roles(db: Session, user_id: uuid.UUID) -> set[str]:
    rows = (
        db.query(Role.name)
        .join(UserRole, UserRole.role_id == Role.id)
        .filter(UserRole.user_id == user_id)
        .all()
    )
    return {r[0] for r in rows}


def require_role(*roles: str):
    """Dependency factory: user must hold at least one of the roles."""

    def _dep(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> User:
        held = _user_roles(db, user.id)
        if not held.intersection(roles):
            raise AdminForbidden()
        return user

    return _dep


# Convenience aliases for the admin role hierarchy
require_super_admin = require_role("super_admin")
require_admin = require_role("super_admin", "admin")
require_admin_viewer = require_role("super_admin", "admin", "support_viewer", "subscription_manager", "operations_manager")


def require_permission(permission: str):
    """Fine-grained permission check via role_permissions."""

    def _dep(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> User:
        from app.db.models import Permission, RolePermission

        exists = (
            db.query(RolePermission)
            .join(Role, Role.id == RolePermission.role_id)
            .join(Permission, Permission.id == RolePermission.permission_id)
            .join(UserRole, UserRole.role_id == Role.id)
            .filter(UserRole.user_id == user.id, Permission.name == permission)
            .first()
        )
        if not exists:
            raise Forbidden(f"Missing permission: {permission}")
        return user

    return _dep
