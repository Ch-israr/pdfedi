"""PDFEDI application entry point.

Single service: FastAPI JSON API under /api/v1 plus the statically exported
Next.js frontend served from FRONTEND_DIR (one origin, no CORS needed).
"""
from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

import structlog
from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

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
    log.info("startup_complete", db_provider=settings.db_provider)
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="PDFEDI", version="2.0.0", lifespan=lifespan,
                  docs_url=None, redoc_url=None, openapi_url=None)

    app.include_router(health_api.router, prefix="/api/v1/health", tags=["health"])
    app.include_router(public_api.router, prefix="/api/v1", tags=["public"])
    app.include_router(admin_api.router, prefix="/api/v1/admin", tags=["admin"])

    frontend = Path(settings.frontend_dir)
    if frontend.is_dir():
        app.mount("/_next", StaticFiles(directory=frontend / "_next"), name="next-static")

        @app.get("/{path:path}")
        def serve_frontend(path: str):
            # Unknown API routes are real 404s (JSON), not the SPA fallback.
            if path == "api" or path.startswith("api/"):
                return JSONResponse(status_code=404, content={"detail": "Not found"})
            # API routes are matched before this catch-all.
            candidate = frontend / path
            if path and candidate.is_file():
                return FileResponse(candidate)
            if (frontend / path / "index.html").is_file():
                return FileResponse(frontend / path / "index.html")
            if path.startswith("tools/"):
                tool_page = frontend / "tools" / path.split("/")[-1] / "index.html"
                if tool_page.is_file():
                    return FileResponse(tool_page)
            index = frontend / "index.html"
            if index.is_file():
                return FileResponse(index)
            return {"service": "PDFEDI"}

    return app


app = create_app()
