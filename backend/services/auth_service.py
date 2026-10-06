"""Authentication service: registration, login, sessions, tokens.

Flows:
- Register -> creates user (pending_verification) + email verification token.
- Verify email -> activates account.
- Login -> verifies credentials, checks status, creates AuthSession +
  refresh token, returns short-lived access JWT.
- Refresh -> rotates refresh token (old one revoked, chained).
- Logout -> revokes session + refresh tokens. Logout-all revokes everything.
- Password reset -> single-use token, short-lived.
- Failed logins are counted; account locks after 10 failures for 30 min.
  Error messages stay generic to reduce account enumeration.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import (
    AccountLocked,
    AccountSuspended,
    EmailNotVerified,
    InvalidCredentials,
    NotFound,
    TokenExpired,
    TokenInvalid,
    TokenRevoked,
)
from app.core.logging import get_logger
from app.core.security import (
    create_access_token,
    generate_refresh_token,
    generate_single_use_token,
    hash_password,
    hash_token,
    verify_password,
)
from app.db.models import (
    AuthSession,
    EmailVerificationToken,
    PasswordResetToken,
    RefreshToken,
    User,
    UserProfile,
)
from app.db.models.enums import AccountStatus

log = get_logger("pdfedi.auth")
settings = get_settings()

MAX_FAILED_LOGINS = 10
LOCKOUT_MINUTES = 30


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(dt: datetime | None) -> datetime | None:
    """SQLite returns naive datetimes; Postgres returns aware. Normalize."""
    if dt is not None and dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def normalize_email(email: str) -> str:
    return email.strip().lower()


def get_user_by_email(db: Session, email: str) -> User | None:
    return db.scalar(select(User).where(User.normalized_email == normalize_email(email)))


def register(db: Session, *, email: str, password: str, first_name: str | None, last_name: str | None) -> tuple[User, str]:
    """Create user + verification token. Returns (user, plaintext_token)."""
    from app.core.errors import Conflict

    if get_user_by_email(db, email):
        # Generic message: do not reveal whether the email is registered.
        raise Conflict("If this email is already registered, you can sign in or reset your password.")
    user = User(
        email=email.strip(),
        normalized_email=normalize_email(email),
        password_hash=hash_password(password),
        first_name=first_name,
        last_name=last_name,
        display_name=f"{first_name or ''} {last_name or ''}".strip() or None,
        account_status=AccountStatus.PENDING_VERIFICATION,
    )
    db.add(user)
    db.flush()
    db.add(UserProfile(user_id=user.id))
    token, token_hash = generate_single_use_token()
    db.add(
        EmailVerificationToken(
            user_id=user.id,
            token_hash=token_hash,
            expires_at=_now() + timedelta(hours=settings.email_verification_token_expire_hours),
        )
    )
    db.commit()
    log.info("user_registered", user_id=str(user.id))
    return user, token


def verify_email(db: Session, token: str) -> User:
    rec = db.scalar(
        select(EmailVerificationToken).where(EmailVerificationToken.token_hash == hash_token(token))
    )
    if not rec or rec.used_at or _aware(rec.expires_at) < _now():
        raise TokenInvalid("Invalid or expired verification link.")
    user = db.get(User, rec.user_id)
    if not user:
        raise NotFound("Account not found.")
    rec.used_at = _now()
    user.email_verified_at = _now()
    if user.account_status == AccountStatus.PENDING_VERIFICATION:
        user.account_status = AccountStatus.ACTIVE
    db.commit()
    log.info("email_verified", user_id=str(user.id))
    return user


def _check_account_usable(user: User) -> None:
    if user.account_status == AccountStatus.BANNED:
        from app.core.errors import AccountBanned
        raise AccountBanned()
    if user.account_status == AccountStatus.DELETED:
        from app.core.errors import AccountDeleted
        raise AccountDeleted()
    if user.account_status == AccountStatus.SUSPENDED:
        raise AccountSuspended()
    if user.account_status == AccountStatus.LOCKED or (
        user.locked_until and _aware(user.locked_until) > _now()
    ):
        raise AccountLocked()
    if user.account_status == AccountStatus.PENDING_VERIFICATION or not user.email_verified_at:
        raise EmailNotVerified()


def _record_failed_login(db: Session, user: User | None, email: str) -> None:
    # Always take ~constant time-ish path; never reveal which branch failed.
    if user:
        user.failed_login_attempts += 1
        if user.failed_login_attempts >= MAX_FAILED_LOGINS:
            user.locked_until = _now() + timedelta(minutes=LOCKOUT_MINUTES)
            log.warning("account_locked", user_id=str(user.id))
        db.commit()
    log.warning("login_failed", email=email.strip().lower()[:3] + "***")


def login(
    db: Session, *, email: str, password: str, device_label: str | None, ip: str | None, user_agent: str | None
) -> tuple[User, AuthSession, str, str]:
    """Returns (user, session, access_token, refresh_token)."""
    user = get_user_by_email(db, email)
    if not user or not verify_password(password, user.password_hash):
        _record_failed_login(db, user, email)
        raise InvalidCredentials()
    _check_account_usable(user)

    user.failed_login_attempts = 0
    user.locked_until = None
    user.last_login_at = _now()
    session = AuthSession(
        user_id=user.id,
        device_label=device_label,
        ip_address=ip,
        user_agent=(user_agent or "")[:500],
        expires_at=_now() + timedelta(days=settings.refresh_token_expire_days),
    )
    db.add(session)
    db.flush()
    refresh_token, refresh_hash = generate_refresh_token()
    db.add(
        RefreshToken(
            user_id=user.id,
            session_id=session.id,
            token_hash=refresh_hash,
            expires_at=session.expires_at,
            device_label=device_label,
        )
    )
    db.commit()
    access = create_access_token(user_id=user.id, session_id=session.id)
    log.info("login", user_id=str(user.id), session_id=str(session.id))
    return user, session, access, refresh_token


def refresh(db: Session, refresh_token: str) -> tuple[User, str, str]:
    """Rotate refresh token. Returns (user, new_access_token, new_refresh_token)."""
    rec = db.scalar(select(RefreshToken).where(RefreshToken.token_hash == hash_token(refresh_token)))
    if not rec or rec.revoked_at or _aware(rec.expires_at) < _now():
        raise TokenRevoked()
    session = db.get(AuthSession, rec.session_id)
    user = db.get(User, rec.user_id)
    if not session or session.revoked_at or not user or user.is_deleted:
        raise TokenRevoked()
    _check_account_usable(user)

    # Rotate: revoke old, issue new chained token
    new_token, new_hash = generate_refresh_token()
    new_rec = RefreshToken(
        user_id=user.id,
        session_id=session.id,
        token_hash=new_hash,
        expires_at=session.expires_at,
        device_label=rec.device_label,
    )
    db.add(new_rec)
    db.flush()
    rec.revoked_at = _now()
    rec.replaced_by_id = new_rec.id
    session.last_used_at = _now()
    db.commit()
    access = create_access_token(user_id=user.id, session_id=session.id)
    return user, access, new_token


def logout(db: Session, session_id: uuid.UUID) -> None:
    session = db.get(AuthSession, session_id)
    if session and not session.revoked_at:
        session.revoked_at = _now()
        for rt in db.scalars(select(RefreshToken).where(RefreshToken.session_id == session.id, RefreshToken.revoked_at.is_(None))):
            rt.revoked_at = _now()
        db.commit()
        log.info("logout", session_id=str(session_id))


def logout_all(db: Session, user_id: uuid.UUID) -> int:
    sessions = db.scalars(
        select(AuthSession).where(AuthSession.user_id == user_id, AuthSession.revoked_at.is_(None))
    ).all()
    for s in sessions:
        s.revoked_at = _now()
    rts = db.scalars(
        select(RefreshToken).where(RefreshToken.user_id == user_id, RefreshToken.revoked_at.is_(None))
    ).all()
    for rt in rts:
        rt.revoked_at = _now()
    db.commit()
    log.info("logout_all", user_id=str(user_id), count=len(sessions))
    return len(sessions)


def request_password_reset(db: Session, email: str) -> str | None:
    """Returns plaintext token, or None if no such user (generic response)."""
    user = get_user_by_email(db, email)
    if not user or user.is_deleted:
        return None
    # Invalidate previous unused tokens
    for t in db.scalars(
        select(PasswordResetToken).where(
            PasswordResetToken.user_id == user.id, PasswordResetToken.used_at.is_(None)
        )
    ):
        t.used_at = _now()
    token, token_hash = generate_single_use_token()
    db.add(
        PasswordResetToken(
            user_id=user.id,
            token_hash=token_hash,
            expires_at=_now() + timedelta(minutes=settings.password_reset_token_expire_minutes),
        )
    )
    db.commit()
    log.info("password_reset_requested", user_id=str(user.id))
    return token


def reset_password(db: Session, token: str, new_password: str) -> User:
    rec = db.scalar(select(PasswordResetToken).where(PasswordResetToken.token_hash == hash_token(token)))
    if not rec or rec.used_at or _aware(rec.expires_at) < _now():
        raise TokenInvalid("Invalid or expired reset link.")
    user = db.get(User, rec.user_id)
    if not user or user.is_deleted:
        raise NotFound("Account not found.")
    rec.used_at = _now()
    user.password_hash = hash_password(new_password)
    user.failed_login_attempts = 0
    user.locked_until = None
    db.commit()
    logout_all(db, user.id)  # reset invalidates all sessions
    log.info("password_reset", user_id=str(user.id))
    return user


def list_sessions(db: Session, user_id: uuid.UUID) -> list[AuthSession]:
    return list(
        db.scalars(
            select(AuthSession)
            .where(AuthSession.user_id == user_id, AuthSession.revoked_at.is_(None))
            .order_by(AuthSession.issued_at.desc())
        )
    )
