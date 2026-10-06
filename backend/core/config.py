"""Central application configuration.

Every setting is read from the environment (or ``.env`` in development).
No secrets are hard-coded; see ``.env.example`` for the full reference.
All values here are safe to log at startup except those marked secret.
"""
from __future__ import annotations

import os
from functools import lru_cache
from typing import Literal

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # --- App ---
    app_name: str = "PDFEDI"
    app_env: Literal["local", "staging", "production"] = "local"
    app_version: str = "1.0.0"
    debug: bool = False
    api_v1_prefix: str = "/api/v1"
    docs_enabled: bool = True  # disabled in production via env

    # --- Database ---
    # DB_PROVIDER selects the active database:
    # --- Database ---
    # PDFEDI uses SQLite as its primary database (per project decision 2026-10-06).
    # Two modes:
    #   1. Local SQLite file (default): ./pdfedi.db locally, /tmp/pdfedi.db on Vercel
    #   2. Turso (hosted SQLite): set TURSO_DATABASE_URL + TURSO_AUTH_TOKEN env vars
    #      Turso is SQLite-compatible (libSQL fork) — NOT Supabase.
    #
    # Supabase/PostgreSQL is BANNED in this project under all circumstances.
    # Google Sheets/Drive/Docs are used for backup/reports only, never as database.
    #
    # THIS CONFIGURATION IS PDFEDI-ONLY. Do not apply to other projects.
    db_provider: str = "sqlite"  # "sqlite" (local file) or "turso" (hosted SQLite)
    # SQLite database file:
    #   - Local dev: ./pdfedi.db (project root)
    #   - Vercel: /tmp/pdfedi.db (only writable location on serverless)
    sqlite_database_url: str = (
        "sqlite:////tmp/pdfedi.db" if os.getenv("VERCEL") else "sqlite:///./pdfedi.db"
    )
    # Turso (hosted SQLite) — set via env vars, never hard-coded
    turso_database_url: str = ""  # e.g. libsql://your-db.turso.io (set via TURSO_DATABASE_URL)
    turso_auth_token: str = ""  # set via TURSO_AUTH_TOKEN env var (never commit)
    db_pool_size: int = 20
    db_max_overflow: int = 30
    # On serverless (Vercel) each invocation is short-lived; NullPool avoids
    # holding connections open. Set DB_USE_NULL_POOL=true on Vercel.
    db_use_null_pool: bool = False

    @property
    def effective_database_url(self) -> str:
        """Return the active database URL (SQLite or Turso-hosted SQLite).

        - DB_PROVIDER=turso + TURSO_DATABASE_URL + TURSO_AUTH_TOKEN → Turso
        - Otherwise → local SQLite file
        Supabase/PostgreSQL is not supported in this project.
        """
        import warnings

        provider = self.db_provider.strip().lower()

        # Turso mode: hosted SQLite via HTTP API (pure Python, no native deps)
        if provider == "turso":
            turso_url = os.environ.get("TURSO_DATABASE_URL", "").strip() or self.turso_database_url
            turso_token = os.environ.get("TURSO_AUTH_TOKEN", "").strip() or self.turso_auth_token
            if not turso_url:
                warnings.warn(
                    "DB_PROVIDER=turso but TURSO_DATABASE_URL not set. "
                    "Falling back to local SQLite.",
                    UserWarning,
                    stacklevel=2,
                )
                return self.sqlite_database_url
            # Build SQLAlchemy URL for custom tursohttp dialect
            # Format: sqlite+tursohttp://host?authToken=TOKEN
            host = turso_url.replace("libsql://", "").replace("https://", "").rstrip("/")
            url = f"sqlite+tursohttp://{host}"
            if turso_token:
                from urllib.parse import quote
                url += f"?authToken={quote(turso_token, safe='')}"
            return url

        if provider != "sqlite":
            warnings.warn(
                f"DB_PROVIDER='{self.db_provider}' is not supported in PDFEDI. "
                "This project uses SQLite only (local file or Turso). "
                "Falling back to local SQLite.",
                UserWarning,
                stacklevel=2,
            )
        return self.sqlite_database_url

    # --- Redis (cache, rate limits, locks, queue infra — never source of truth) ---
    redis_url: str = "redis://localhost:6379/0"
    redis_enabled: bool = False

    # --- Auth / sessions ---
    # SECURITY: generate with `python -c "import secrets; print(secrets.token_urlsafe(64))"`
    jwt_secret_key: str = "CHANGE-ME-generate-a-64-char-secret"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 15
    refresh_token_expire_days: int = 30
    # Cookie-based browser sessions
    session_cookie_name: str = "pdfedi_session"
    session_cookie_secure: bool = True  # set false only for plain-http local dev
    session_cookie_samesite: Literal["lax", "strict", "none"] = "lax"
    password_reset_token_expire_minutes: int = 30
    email_verification_token_expire_hours: int = 48

    # --- CORS (strict allowlist; never "*" with credentials) ---
    cors_allow_origins: list[str] = [
        "http://localhost:3000",
        "https://pdfedi-4p5ugp4we-chisrar647-3507.vercel.app",
    ]
    cors_allow_credentials: bool = True

    # --- Storage (private; S3-compatible interface) ---
    storage_backend: Literal["local", "s3"] = "local"
    # On Vercel serverless, only /tmp is writable
    storage_local_dir: str = "/tmp/pdfedi-storage" if os.getenv("VERCEL") else "./var/storage"
    s3_endpoint_url: str | None = None  # set for R2 / MinIO / other S3-compatible
    s3_bucket: str = "pdfedi-files"
    s3_region: str = "auto"
    s3_access_key_id: str | None = None
    s3_secret_access_key: str | None = None
    # Short-lived download URLs
    download_url_expire_seconds: int = 900

    # --- Upload / download limits ---
    # Flat 4MB limits for uploads and downloads (user requirement).
    # No plan-based or other file size restrictions.
    max_upload_mb: float = 4
    max_download_mb: float = 4
    max_pages_per_pdf: int = 1000
    allowed_upload_extensions: list[str] = ["pdf", "png", "jpg", "jpeg", "tiff", "tif", "bmp", "webp"]
    request_body_max_mb: float = 4.5 if os.getenv("VERCEL") else 110

    # --- Workers ---
    # "inline"  -> process inside the API process (Vercel serverless phase).
    # "celery"  -> dispatch to Celery workers (container deployment).
    worker_backend: Literal["inline", "celery"] = "inline"
    celery_broker_url: str = "redis://localhost:6379/1"
    celery_result_backend: str = "redis://localhost:6379/2"
    job_inline_timeout_seconds: int = 55  # keep under serverless limits
    job_max_retries: int = 2

    # --- Retention (days; plans override) ---
    retention_inputs_days: int = 7
    retention_outputs_days: int = 30
    retention_temp_hours: int = 1

    # --- Rate limits (requests per window; plan-aware multipliers applied) ---
    rate_limit_auth_per_minute: int = 10
    rate_limit_upload_per_minute: int = 20
    rate_limit_job_create_per_minute: int = 30
    rate_limit_default_per_minute: int = 120

    # --- Quotas (per-IP task limits; abuse prevention) ---
    quota_tasks_per_hour: int = 10
    quota_tasks_per_day: int = 30
    quota_concurrent_jobs: int = 2

    # --- Admin (separate auth system; set via environment) ---
    admin_username: str = "admin"
    admin_password_hash: str = ""  # SHA256 hex; set ADMIN_PASSWORD_HASH env var
    admin_jwt_secret: str | None = None  # defaults to jwt_secret_key

    # --- Observability ---
    log_level: str = "INFO"
    log_json: bool = True
    sentry_dsn: str | None = None
    enable_tracing: bool = False

    # --- Email (verification / reset links) ---
    # "console" logs the link (dev only). "smtp" sends via SMTP.
    email_backend: Literal["console", "smtp"] = "console"
    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_username: str | None = None
    smtp_password: str | None = None
    smtp_from: str = "no-reply@pdfedi.example"
    frontend_base_url: str = "http://localhost:3000"

    # --- Admin bootstrap ---
    # Initial super-admin is created via `scripts/create_admin.py`, never seeded
    # with a default password.
    admin_ip_allowlist: list[str] = []

    @field_validator("jwt_secret_key")
    @classmethod
    def _require_real_jwt_secret(cls, v: str, info) -> str:
        # Fail fast in production if the default placeholder secret is still set.
        # Forgeable tokens are a critical vulnerability.
        import os
        if v.startswith("CHANGE-ME") and os.getenv("APP_ENV", "local") == "production":
            raise ValueError(
                "JWT_SECRET_KEY must be set to a strong random value in production. "
                "Generate with: python -c \"import secrets; print(secrets.token_urlsafe(64))\""
            )
        return v

    @field_validator("cors_allow_origins", mode="before")
    @classmethod
    def _split_origins(cls, v):  # allow comma-separated env string or JSON array
        # Always include production frontend URLs
        production_urls = [
            "https://pdfedi-4p5ugp4we-chisrar647-3507.vercel.app",
            "https://pdfedi-opaxhedxr-chisrar647-3507.vercel.app",
        ]
        if isinstance(v, str):
            v = v.strip()
            if v.startswith("["):
                import json
                try:
                    parsed = json.loads(v)
                    return list(set(parsed + production_urls))
                except json.JSONDecodeError:
                    pass
            parsed = [o.strip() for o in v.split(",") if o.strip()]
            return list(set(parsed + production_urls))
        if isinstance(v, list):
            return list(set(v + production_urls))
        return production_urls

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()
