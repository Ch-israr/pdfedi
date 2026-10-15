"""PDFEDI application entry point.

Single service: FastAPI JSON API under /api/v1 plus the statically exported
Next.js frontend served from FRONTEND_DIR (one origin, no CORS needed).
"""
from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

# stdlib logging (used by jobs.py, tools/ocr.py, ...) has no configuration
# by default, which silently drops everything below WARNING. Configure it
# so worker activity actually reaches the Render log stream.
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)

import structlog
from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool

from pdfedi.api import admin as admin_api
from pdfedi.api import health as health_api
from pdfedi.api import public as public_api
from pdfedi.api.admin import ensure_admin_seed
from pdfedi.config import get_settings
from pdfedi.db import SessionLocal, engine
from pdfedi.migrate import run_migrations

structlog.configure(
    processors=[
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.JSONRenderer(),
    ]
)
log = structlog.get_logger("pdfedi")


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    settings.validate_production()
    applied = run_migrations(engine)
    if applied:
        log.info("migrations_applied", versions=applied)
    with SessionLocal() as db:
        ensure_admin_seed(db)
        # Recover jobs orphaned by a container kill (e.g. OOM): their worker
        # died with the old process, so without this they stay "running"
        # forever. Mark them failed so users get a clear, retryable state.
        from pdfedi.models import Job, JobStatus, enum_value
        from pdfedi.timeutil import utcnow_iso
        orphaned = (
            db.query(Job)
            .filter(Job.status.in_([JobStatus.RUNNING.value, JobStatus.QUEUED.value]))
            .all()
        )
        for job in orphaned:
            job.status = enum_value(JobStatus.FAILED)
            job.error = (
                "The server restarted while this job was processing. "
                "Please try again."
            )
            job.updated_at = utcnow_iso()
        if orphaned:
            db.commit()
            log.info("recovered_orphaned_jobs", count=len(orphaned))
    log.info("startup_complete", db_provider=settings.db_provider)
    yield


def _log_visit_sync(
    path: str, user_agent: str, referer: str, headers: dict, is_bot: bool
) -> None:
    """Sync analytics DB write for the visit-tracking middleware.

    Runs in Starlette's threadpool via a fire-and-forget task so the
    synchronous SQLAlchemy/Turso round trips never block the event loop.
    Records exactly what the old inline middleware recorded (humans and
    bots, same fields, same retention pruning). Never raises — analytics
    must never break a request.
    """
    from pdfedi import analytics as _analytics
    from pdfedi.db import SessionLocal

    try:
        db = SessionLocal()
        try:
            ip = _analytics.client_ip_from_headers(headers)
            if is_bot:
                _analytics.log_bot_visit(
                    db, ip=ip, user_agent=user_agent, path=path
                )
            else:
                _analytics.log_visit(
                    db,
                    ip=ip,
                    user_agent=user_agent,
                    referrer=referer,
                    path=path,
                )
        finally:
            db.close()
    except Exception:
        pass


class _ImmutableNextStatic(StaticFiles):
    """StaticFiles for /_next that marks content-hashed build output immutable.

    Only paths under /_next/static/ (hash-fingerprinted chunks, CSS, media)
    get the long-lived immutable header; anything else keeps default behavior.
    """

    async def get_response(self, path: str, scope):
        response = await super().get_response(path, scope)
        if isinstance(response, FileResponse) and "/_next/static/" in (
            scope.get("path") or ""
        ):
            response.headers["Cache-Control"] = (
                "public, max-age=31536000, immutable"
            )
        return response


def _frontend_cache_headers(path: str) -> dict | None:
    """Cache policy for frontend-served static paths.

    - /_next/static/*: content-hashed build output -> immutable for a year.
    - HTML pages (and the root/404 fallbacks): no caching — deploys
      replace them and the browser must always revalidate.
    - Other static assets (icons, logo, llms.txt, sitemap.xml): 1 day.
    API routes and download responses are never touched by this.
    """
    if "/_next/static/" in path:
        return {"Cache-Control": "public, max-age=31536000, immutable"}
    if path == "" or path.endswith("/") or path.endswith(".html"):
        return None
    return {"Cache-Control": "public, max-age=86400"}


def _frontend_file(path: str, candidate: Path) -> FileResponse:
    headers = _frontend_cache_headers(path)
    if headers:
        return FileResponse(candidate, headers=headers)
    return FileResponse(candidate)


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="PDFEDI", version="2.0.0", lifespan=lifespan,
                  docs_url=None, redoc_url=None, openapi_url=None)

    app.include_router(health_api.router, prefix="/api/v1/health", tags=["health"])
    app.include_router(public_api.router, prefix="/api/v1", tags=["public"])
    app.include_router(admin_api.router, prefix="/api/v1/admin", tags=["admin"])

    @app.middleware("http")
    async def security_headers(request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        # Render terminates TLS; the site is HTTPS-only.
        response.headers["Strict-Transport-Security"] = (
            "max-age=31536000; includeSubDomains"
        )
        return response

    @app.middleware("http")
    async def visit_tracking(request, call_next):
        # Privacy-first page-view logging for the admin analytics dashboard.
        # Humans -> visits table; bots -> separate bot_visits table (name +
        # country only). Runs after the response is built and never blocks it:
        # the sync DB write is dispatched fire-and-forget into Starlette's
        # threadpool, so the event loop stays free for other requests.
        response = await call_next(request)
        try:
            from pdfedi import analytics as _analytics

            path = request.url.path
            ua = request.headers.get("user-agent", "")
            is_bot = _analytics.is_bot(ua)
            if _analytics.should_track(path, ua) or _analytics.should_track_bot(
                path, ua
            ):
                # Capture plain values now; the request scope may be gone
                # by the time the background write runs.
                headers = dict(request.headers)
                referer = request.headers.get("referer", "")
                asyncio.get_running_loop().create_task(
                    run_in_threadpool(
                        _log_visit_sync, path, ua, referer, headers, is_bot
                    )
                )
        except Exception:
            pass
        return response

    frontend = Path(settings.frontend_dir)
    if frontend.is_dir():
        app.mount(
            "/_next",
            _ImmutableNextStatic(directory=frontend / "_next"),
            name="next-static",
        )

        @app.get("/{path:path}")
        def serve_frontend(path: str):
            # Unknown API routes are real 404s (JSON), not the SPA fallback.
            if path == "api" or path.startswith("api/"):
                return JSONResponse(status_code=404, content={"detail": "Not found"})
            # The PDF editor was removed (2026-10-15): its old route must
            # be a real 404, not the SPA fallback serving the homepage.
            if path == "editor" or path.startswith("editor/"):
                not_found = frontend / "404" / "index.html"
                if not_found.is_file():
                    return FileResponse(not_found, status_code=404)
                return JSONResponse(status_code=404, content={"detail": "Not found"})
            # API routes are matched before this catch-all.
            candidate = frontend / path
            if path and candidate.is_file():
                return _frontend_file(path, candidate)
            if (frontend / path / "index.html").is_file():
                return FileResponse(frontend / path / "index.html")
            if path.startswith("tools/"):
                tool_page = frontend / "tools" / path.split("/")[-1] / "index.html"
                if tool_page.is_file():
                    return FileResponse(tool_page)
                # Unknown tool slug: real 404 page, not a silent homepage.
                not_found = frontend / "404" / "index.html"
                if not_found.is_file():
                    return FileResponse(not_found, status_code=404)
                return JSONResponse(status_code=404, content={"detail": "Not found"})
            index = frontend / "index.html"
            if index.is_file():
                return FileResponse(index)
            return {"service": "PDFEDI"}

    return app


app = create_app()
