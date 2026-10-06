"""Anonymous (no-auth) ownership for the public API.

All public uploads/jobs are owned by a single synthetic user row so the
NOT NULL ``owner_user_id`` FK stays satisfied. The row is created once at
application startup (see ``ensure_anonymous_user``), not per-request —
per-request get-or-create caused 500s under serverless concurrency.

Ownership checks are intentionally disabled: with no user accounts, files
and jobs are addressed by unguessable UUIDs / signed download tokens.
"""
from __future__ import annotations

import uuid

from sqlalchemy.orm import Session

ANONYMOUS_USER_ID = uuid.UUID("00000000-0000-0000-0000-000000000000")
ANONYMOUS_EMAIL = "anonymous@pdfedi.local"


def ensure_anonymous_user(db: Session) -> None:
    """Create the synthetic anonymous owner row if it does not exist.

    Best-effort only. If creation fails (schema mismatch, etc.), we log
    and continue — the FK may still succeed if the row was created by
    another instance, or the DB may not enforce FKs.
    """
    from sqlalchemy import text
    from app.core.logging import get_logger

    log = get_logger("pdfedi.anonymous")
    try:
        # Try raw SQL first (most robust)
        result = db.execute(
            text("SELECT id FROM users WHERE id = :id LIMIT 1"),
            {"id": str(ANONYMOUS_USER_ID)},
        )
        if result.fetchone() is None:
            db.execute(
                text("""
                    INSERT OR IGNORE INTO users
                    (id, email, normalized_email, password_hash, display_name,
                     account_status, locale, timezone, failed_login_attempts,
                     created_at, updated_at)
                    VALUES
                    (:id, :email, :email, '!', 'Anonymous',
                     'active', 'en', 'UTC', 0,
                     CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                """),
                {"id": str(ANONYMOUS_USER_ID), "email": ANONYMOUS_EMAIL},
            )
            db.commit()
    except Exception as e:
        db.rollback()
        log.warning("ensure_anonymous_user_failed", error=str(e)[:200])
        # Continue anyway — do not crash the request
