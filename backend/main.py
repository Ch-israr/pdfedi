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
from starlette.middleware.gzip import GZipMiddleware

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
            job.error_code = "server_restart"
            job.updated_at = utcnow_iso()
        if orphaned:
            db.commit()
            log.info("recovered_orphaned_jobs", count=len(orphaned))
    # Warm heavy tool imports (python-docx, pdfplumber, python-pptx,
    # pypdfium2): the registry imports every tool module, and the first
    # job of a type otherwise pays ~1.7 s of cold import (pdf_to_word
    # measured 2,218 ms first run vs ~510 ms warm). Trades ~10–20 MB
    # baseline RSS and ~1 s of boot for predictable first-job latency.
    from pdfedi.tools import TOOLS as _warmed_tools

    log.info("tools_warmed", count=len(_warmed_tools))
    log.info("startup_complete", db_provider=settings.db_provider)
    yield


# Responses that must never be gzipped: file downloads (already-compressed
# PDFs/ZIPs — gzipping them wastes CPU for ~0 bytes saved) and binary
# image/font media. Everything else (HTML, JS, CSS, JSON) is gzipped.
_NEVER_GZIP_PREFIXES = ("/api/v1/downloads", "/api/v1/files")
_NEVER_GZIP_SUFFIXES = (
    ".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif", ".ico",
    ".pdf", ".zip", ".gz", ".br", ".woff", ".woff2", ".mp4", ".mp3",
)


class _ScopedGzipMiddleware:
    """GZipMiddleware that skips downloads and already-compressed media.

    Starlette's GZipMiddleware has no content-type filter — applied
    plainly it would gzip 12 MB ZIP/PDF downloads for no benefit.
    This wrapper delegates to it only for compressible paths.
    """

    def __init__(self, app, minimum_size: int = 1000):
        self._gzip = GZipMiddleware(app, minimum_size=minimum_size)
        self._app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self._app(scope, receive, send)
            return
        path = scope.get("path", "")
        if path.startswith(_NEVER_GZIP_PREFIXES) or path.endswith(
            _NEVER_GZIP_SUFFIXES
        ):
            await self._app(scope, receive, send)
            return
        await self._gzip(scope, receive, send)


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
    - pdf.min.mjs / pdf.worker.min.mjs: versioned by ?v=<pdfjs-dist
      version> at the fetch site (web/lib/canvas/pdfjs.ts), so the URL
      changes on upgrade and immutable caching is safe.
    - HTML pages (and the root/404 fallbacks): no caching — deploys
      replace them and the browser must always revalidate.
    - Other static assets (icons, logo, llms.txt, sitemap.xml): 1 day.
    API routes and download responses are never touched by this.
    """
    if "/_next/static/" in path:
        return {"Cache-Control": "public, max-age=31536000, immutable"}
    if path in ("pdf.min.mjs", "pdf.worker.min.mjs"):
        return {"Cache-Control": "public, max-age=31536000, immutable"}
    if path == "" or path.endswith("/") or path.endswith(".html"):
        return None
    return {"Cache-Control": "public, max-age=86400"}


def _frontend_file(path: str, candidate: Path) -> FileResponse:
    headers = _frontend_cache_headers(path)
    if headers:
        return FileResponse(candidate, headers=headers)
    return FileResponse(candidate)


def _frontend_not_found(frontend: Path):
    """The real 404 page (frontend 404/index.html, status 404), or a JSON
    404 if the static export has no 404 page (e.g. frontend dir missing
    it). Used for every unknown path — never the homepage."""
    not_found = frontend / "404" / "index.html"
    if not_found.is_file():
        return FileResponse(not_found, status_code=404)
    return JSONResponse(status_code=404, content={"detail": "Not found"})


# Prefixed (non-English) locale segments, mirroring web/i18n/routing.ts.
# English is prefix-free, so "en" is deliberately NOT in this set: /en/
# has no page and must 404 like any other unknown path.
_FRONTEND_LOCALES = {"es", "fr", "pt", "id", "zh-cn", "hi", "bn", "ar", "ur"}

# Top-level public pages besides the homepage and tool pages (mirrors
# web/app/sitemap.ts PAGES). /admin is included: it is a real generated
# page, just not listed in the sitemap.
_FRONTEND_TOP_PAGES = {
    "lawyers",
    "how-we-handle-files",
    "privacy",
    "terms",
    "about",
    "contact",
    "admin",
}


def _is_known_frontend_route(norm: str) -> bool:
    """True only for routes the static export actually generates, given a
    normalized path (no leading/trailing slash). `norm` is "" for "/".
    Tool slugs come from the backend tool registry (pdfedi.tools.TOOLS),
    which is the same 34-tool set the frontend builds pages for — so a
    removed tool (e.g. thumbnails) 404s here instead of soft-404ing.
    Deliberately no fallback to the English page for a locale URL: a
    locale URL must never return English content with a 200."""
    if norm == "":
        return True
    parts = norm.split("/")
    if len(parts) == 1:
        # /<page> or /<locale> (locale homepage, e.g. /fr).
        return parts[0] in _FRONTEND_TOP_PAGES or parts[0] in _FRONTEND_LOCALES
    if len(parts) == 2:
        # /tools/<slug> or /<locale>/<page>.
        if parts[0] == "tools":
            from pdfedi.tools import TOOLS

            return parts[1] in TOOLS
        return parts[0] in _FRONTEND_LOCALES and parts[1] in _FRONTEND_TOP_PAGES
    if len(parts) == 3:
        # /<locale>/tools/<slug>.
        if parts[0] in _FRONTEND_LOCALES and parts[1] == "tools":
            from pdfedi.tools import TOOLS

            return parts[2] in TOOLS
        return False
    return False


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="PDFEDI", version="2.0.0", lifespan=lifespan,
                  docs_url=None, redoc_url=None, openapi_url=None)

    # Gzip for HTML/JS/CSS/JSON (scoped: downloads + binary media are
    # excluded by _ScopedGzipMiddleware). Added first so it ends up
    # outermost and compresses the fully-built response.
    app.add_middleware(_ScopedGzipMiddleware, minimum_size=1000)

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
            # Normalize BEFORE any routing decision: strip trailing "/"
            # (and any leading "/") so "fr/tools/nonexistent/" and
            # "fr/tools/nonexistent" route identically. Previously the
            # locale-tools check required exactly 3 parts, so the
            # trailing-slash form (4 parts) slipped through to the
            # homepage fallback and soft-404'd with a 200 (I18N-2).
            norm = path.strip("/")
            # Unknown API routes are real 404s (JSON), not the SPA fallback.
            if norm == "api" or norm.startswith("api/"):
                return JSONResponse(status_code=404, content={"detail": "Not found"})
            # The PDF editor was removed (2026-10-15): its old route must
            # be a real 404, not the SPA fallback serving the homepage.
            # (Also covers <locale>/editor via the whitelist below.)
            if norm == "editor" or norm.startswith("editor/"):
                return _frontend_not_found(frontend)
            # Real static files (logo, sitemap.xml, robots.txt, favicon,
            # llms.txt, ...) are served as-is, exactly as before.
            candidate = frontend / norm
            if norm and candidate.is_file():
                return _frontend_file(norm, candidate)
            # Whitelist of known frontend routes (DISC-01 / I18N-2 fix).
            # The old catch-all served the homepage with a 200 for EVERY
            # unknown path, so search engines could index an infinite set
            # of duplicate-homepage URLs and visitors never saw a 404.
            # Only these routes serve a page (both slash forms, via norm);
            # everything else gets the real 404 page below.
            if _is_known_frontend_route(norm):
                page = frontend / norm / "index.html" if norm else frontend / "index.html"
                if page.is_file():
                    return FileResponse(page)
            return _frontend_not_found(frontend)

    return app


app = create_app()
