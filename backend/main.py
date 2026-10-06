"""PDFEDI backend — FastAPI application factory.

API-first: the web app, future Android and iOS apps are all clients of
/api/v1. All business logic, auth, entitlements and processing live here.
"""
from __future__ import annotations

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.v1.router import router as v1_router
from app.core.config import get_settings
from app.core.errors import AppException, ErrorCode
from app.core.logging import configure_logging, get_logger, get_request_id
from app.core.middleware import SecurityMiddleware, error_body

settings = get_settings()
configure_logging(settings.log_level, settings.log_json)
log = get_logger("pdfedi")


def _app_error_response(request: Request, exc: AppException) -> JSONResponse:
    return JSONResponse(
        status_code=exc.http_status,
        content=error_body(
            code=exc.code,
            message=exc.message,
            request_id=get_request_id(),
            details=getattr(exc, "details", {}),
            retryable=exc.retryable,
        ),
    )


def create_app() -> FastAPI:
    # --- Startup: seed default plans/roles (idempotent) ---
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        try:
            from app.db.base import Base
            from app.db import models as _models  # noqa: F401 - register all models
            from app.db.session import _session_factory, get_engine
            from app.core.anonymous import ensure_anonymous_user

            # Create tables if they don't exist (SQLite/Turso - safe for serverless)
            engine = get_engine()
            Base.metadata.create_all(engine, checkfirst=True)

            # Idempotent schema repairs (SQLite/Turso). Each repair detects the
            # legacy schema first and is a no-op when already correct.
            try:
                from app.db.repairs import repair_files_storage_key_unique

                repair_files_storage_key_unique(engine)
            except Exception as e:
                log.warning("schema_repair_failed", error=str(e)[:200])

            db = _session_factory()()
            try:
                ensure_anonymous_user(db)
                _ensure_roles(db)
            finally:
                db.close()
        except Exception as e:
            log.warning("startup_seed_failed", error=str(e)[:200])
        yield

    app = FastAPI(
        title="PDFEDI API",
        version=settings.app_version,
        lifespan=lifespan,
        description=(
            "Secure PDF tools and document-processing platform. "
            "API-first: web, Android and iOS clients consume /api/v1. "
            "OpenAPI available at /api/docs (disabled in production)."
        ),
        docs_url="/api/docs" if settings.docs_enabled else None,
        redoc_url="/api/redoc" if settings.docs_enabled else None,
        openapi_url="/api/openapi.json" if settings.docs_enabled else None,
    )

    # --- Middleware: security headers + correlation IDs first ---
    app.add_middleware(SecurityMiddleware)

    # --- CORS: allowlist + vercel preview pattern, never wildcard with credentials ---
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_allow_origins,
        allow_origin_regex=r"https://pdfedi-[a-z0-9-]+\.vercel\.app|https://[a-z0-9-]+\.netlify\.app",
        allow_credentials=settings.cors_allow_credentials,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "X-Request-ID", "X-Idempotency-Key"],
        max_age=600,
    )

    # --- Exception handlers: every error uses the standard envelope ---
    @app.exception_handler(AppException)
    async def app_exception_handler(request: Request, exc: AppException):
        if exc.http_status >= 500:
            log.exception("app_error", code=exc.code)
        return _app_error_response(request, exc)

    @app.exception_handler(RequestValidationError)
    async def validation_handler(request: Request, exc: RequestValidationError):
        return JSONResponse(
            status_code=422,
            content=error_body(
                code=ErrorCode.VALIDATION_ERROR,
                message="Request validation failed.",
                request_id=get_request_id(),
                details={"fields": exc.errors()},
            ),
        )

    @app.exception_handler(StarletteHTTPException)
    async def http_handler(request: Request, exc: StarletteHTTPException):
        return JSONResponse(
            status_code=exc.status_code,
            content=error_body(
                code=ErrorCode.NOT_FOUND if exc.status_code == 404 else ErrorCode.INTERNAL_ERROR,
                message=exc.detail if isinstance(exc.detail, str) else "Request failed.",
                request_id=get_request_id(),
            ),
        )

    @app.exception_handler(Exception)
    async def unhandled_handler(request: Request, exc: Exception):
        log.exception("unhandled_exception", path=request.url.path)
        # Include CORS headers so browser doesn't mask the 500 as CORS error
        origin = request.headers.get("origin")
        headers = {}
        if origin:
            headers["Access-Control-Allow-Origin"] = origin
            headers["Access-Control-Allow-Credentials"] = "true"
        return JSONResponse(
            status_code=500,
            content=error_body(
                code=ErrorCode.INTERNAL_ERROR,
                message="An unexpected error occurred.",
                request_id=get_request_id(),
            ),
            headers=headers,
        )

    # --- Routes ---
    app.include_router(v1_router, prefix=settings.api_v1_prefix)

    # --- Frontend (combined deployment) ---
    # When FRONTEND_DIR points at a Next.js static export, serve it from the
    # same origin: exact files directly, extensionless routes via their
    # .html file, everything else falls back to index.html. API routes are
    # registered above, so they always win over this catch-all.
    _frontend_dir = os.environ.get("FRONTEND_DIR", "")

    @app.get("/", include_in_schema=False)
    def root():
        if _frontend_dir:
            _index = os.path.join(_frontend_dir, "index.html")
            if os.path.isfile(_index):
                from fastapi.responses import FileResponse

                return FileResponse(_index)
        return {"service": settings.app_name, "version": settings.app_version, "api": settings.api_v1_prefix}

    if _frontend_dir and os.path.isdir(_frontend_dir):

        @app.get("/{full_path:path}", include_in_schema=False)
        async def serve_frontend(full_path: str):
            # Never swallow API 404s — keep the JSON error envelope.
            if full_path == "api" or full_path.startswith("api/"):
                raise StarletteHTTPException(status_code=404, detail="Not found")
            from fastapi.responses import FileResponse

            candidates = [
                os.path.join(_frontend_dir, full_path),
                os.path.join(_frontend_dir, full_path + ".html"),
                os.path.join(_frontend_dir, "index.html"),
            ]
            for _candidate in candidates:
                if os.path.isfile(_candidate):
                    return FileResponse(_candidate)
            raise StarletteHTTPException(status_code=404, detail="Not found")

    return app


def _ensure_roles(db) -> None:
    from sqlalchemy import select

    from app.db.models import Permission, Role, RolePermission

    role_defs = {
        "super_admin": "Full system access.",
        "admin": "Administrative access.",
        "support_viewer": "Read-only support access.",
        "subscription_manager": "Manage plans and subscriptions.",
        "operations_manager": "Manage jobs, files and feature flags.",
    }
    perm_defs = [
        "admin.users.read", "admin.users.write", "admin.subscriptions.read", "admin.subscriptions.write",
        "admin.jobs.read", "admin.jobs.write", "admin.files.read", "admin.settings.read",
        "admin.settings.write", "admin.analytics.read", "admin.audit.read",
    ]
    for perm_name in perm_defs:
        if not db.scalar(select(Permission).where(Permission.name == perm_name)):
            db.add(Permission(name=perm_name, description=perm_name))
    db.flush()
    grants = {
        "super_admin": perm_defs,
        "admin": [p for p in perm_defs if p != "admin.settings.write"],
        "support_viewer": ["admin.users.read", "admin.jobs.read", "admin.files.read", "admin.audit.read"],
        "subscription_manager": ["admin.subscriptions.read", "admin.subscriptions.write", "admin.users.read"],
        "operations_manager": ["admin.jobs.read", "admin.jobs.write", "admin.files.read", "admin.settings.read", "admin.analytics.read"],
    }
    for role_name, desc in role_defs.items():
        role = db.scalar(select(Role).where(Role.name == role_name))
        if not role:
            role = Role(name=role_name, description=desc)
            db.add(role)
            db.flush()
        have = {rp.permission_id for rp in role.permissions}
        for perm_name in grants[role_name]:
            perm = db.scalar(select(Permission).where(Permission.name == perm_name))
            if perm.id not in have:
                db.add(RolePermission(role_id=role.id, permission_id=perm.id))
    db.commit()


app = create_app()
