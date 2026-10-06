"""Celery application for container-based worker deployment.

Used when WORKER_BACKEND=celery. The API dispatches job ids; workers run
the same _run_tool code path against the same database and storage, so the
public API contract is unchanged.

Run a worker with:
    celery -A app.workers.celery_app:celery_app worker -Q pdf --concurrency=2
"""
from __future__ import annotations

from celery import Celery

from app.core.config import get_settings

settings = get_settings()

celery_app = Celery(
    "pdfedi",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
)
celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    task_time_limit=600,
    task_soft_time_limit=540,
)


@celery_app.task(name="pdfedi.run_job", bind=True, max_retries=2)
def run_job(self, job_id: str) -> dict:
    """Worker entrypoint: load job, enforce plan limits, run tool."""
    import uuid

    from app.db.models import ProcessingJob, SubscriptionPlan, User
    from app.db.session import _session_factory
    from app.services import job_service
    from app.services.subscription_service import get_effective_plan

    db = _session_factory()()
    try:
        job = db.get(ProcessingJob, uuid.UUID(job_id))
        if not job:
            return {"ok": False, "error": "job not found"}
        user = db.get(User, job.owner_user_id)
        plan: SubscriptionPlan = get_effective_plan(db, user.id)
        limits = {"max_pages": plan.max_pages_per_pdf, "max_upload_mb": plan.max_upload_mb}
        job_service._run_tool(db, job, user_plan_limits=limits)
        return {"ok": True, "job_id": job_id, "status": job.status}
    except Exception as exc:  # retry transient infra failures
        raise self.retry(exc=exc, countdown=30)
    finally:
        db.close()


@celery_app.task(name="pdfedi.cleanup_expired_files")
def cleanup_expired_files_task() -> dict:
    """Hourly cleanup of expired temporary files (dedup-aware)."""
    from app.db.session import _session_factory
    from app.workers.cleanup import cleanup_expired_files

    db = _session_factory()()
    try:
        return cleanup_expired_files(db)
    finally:
        db.close()


# Celery beat schedule: run cleanup hourly. Enable with:
#   celery -A app.workers.celery_app:celery_app beat --loglevel=info
celery_app.conf.beat_schedule = {
    "cleanup-expired-files-hourly": {
        "task": "pdfedi.cleanup_expired_files",
        "schedule": 3600.0,
    },
}
