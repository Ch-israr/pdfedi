"""API v1 router aggregation."""
from fastapi import APIRouter

from app.api.v1.endpoints import admin_v1, files, health, jobs, maintenance

router = APIRouter()

router.include_router(health.router, prefix="/health", tags=["health"])
router.include_router(files.uploads_router, prefix="/uploads", tags=["uploads"])
router.include_router(files.files_router, prefix="/files", tags=["files"])
router.include_router(files.downloads_router, prefix="/downloads", tags=["downloads"])
router.include_router(jobs.tools_router, prefix="/tools", tags=["tools"])
router.include_router(jobs.jobs_router, prefix="/jobs", tags=["jobs"])
router.include_router(admin_v1.router, prefix="/admin", tags=["admin"])
router.include_router(maintenance.router, tags=["maintenance"])
