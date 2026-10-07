"""PDFEDI configuration — single source of truth for all settings.

Environment variables (same names as the Render dashboard already uses):
  DB_PROVIDER            sqlite | turso            (default: sqlite)
  TURSO_DATABASE_URL     libsql://<host>          (when DB_PROVIDER=turso)
  TURSO_AUTH_TOKEN       Turso auth token         (when DB_PROVIDER=turso)
  JWT_SECRET_KEY         secret for admin JWTs    (required in production)
  ADMIN_USERNAME         admin login username     (default: admin@pdfedi.com)
  ADMIN_PASSWORD_HASH    argon2 hash; seeded on first boot if set
  STORAGE_DIR            local file storage dir   (default: ./storage)
  MAX_UPLOAD_MB          upload limit             (default: 50)
  MAX_DOWNLOAD_MB        download limit           (default: 50)
  QUOTA_PER_HOUR         successful actions per tool per IP per hour (default: 5)
  ENV                    development | production (default: development)
  FRONTEND_DIR           static frontend dir      (default: ./static)
"""
from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    env: str = "development"

    db_provider: str = "sqlite"
    turso_database_url: str = ""
    turso_auth_token: str = ""

    jwt_secret_key: str = "dev-secret-change-me"
    jwt_expire_hours: int = 12

    admin_username: str = "admin@pdfedi.com"
    admin_password_hash: str = ""
    # One-time admin password set/reset: put the PLAINTEXT password here,
    # deploy, log in, then REMOVE the variable. It is hashed with argon2
    # on startup and never stored in plaintext.
    admin_password: str = ""

    storage_dir: str = "./storage"
    max_upload_mb: int = 50
    max_download_mb: int = 50
    quota_per_hour: int = 5
    # Max simultaneous job executions. Prevents OOM on memory-constrained
    # hosts when multiple heavy jobs (e.g. OCR) are submitted at once.
    # Jobs beyond the limit wait in QUEUED status until a slot frees up.
    max_concurrent_jobs: int = 2

    frontend_dir: str = "./static"

    @property
    def is_production(self) -> bool:
        return self.env.lower() == "production"

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024

    @property
    def max_download_bytes(self) -> int:
        return self.max_download_mb * 1024 * 1024

    def validate_production(self) -> None:
        """Fail fast on insecure production configuration."""
        if not self.is_production:
            return
        if self.jwt_secret_key in ("dev-secret-change-me", "CHANGE_ME", ""):
            raise RuntimeError("JWT_SECRET_KEY must be set to a real secret in production")
        if self.db_provider == "turso" and not self.turso_auth_token:
            raise RuntimeError("TURSO_AUTH_TOKEN is required when DB_PROVIDER=turso")


@lru_cache
def get_settings() -> Settings:
    return Settings()
