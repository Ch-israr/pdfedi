"""Tool discovery and job management.

- GET  /api/v1/tools              list tools with entitlement flags
- GET  /api/v1/tools/{key}        tool detail incl. config schema
- POST /api/v1/jobs               create job (entitlement + quota checked BEFORE queueing)
- GET  /api/v1/jobs               job history (cursor pagination)
- GET  /api/v1/jobs/{id}          job status (poll this)
- POST /api/v1/jobs/{id}/cancel   cancel a queued job
- POST /api/v1/jobs/{id}/retry    retry a failed job
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Request, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.anonymous import ANONYMOUS_USER_ID
from app.core.deps import get_db
from app.core.errors import JobNotFound, NotFound
from app.core.rate_limit import rate_limit, rate_limit_tool_hourly
from app.db.models import ProcessingJob, User
from app.db.models.enums import JobStatus
from app.schemas.v1 import JobCreateRequest, JobResponse, PageResponse, ToolInfoResponse
from app.services import job_service
from app.services.pdf.registry import get_tool, list_tools

tools_router = APIRouter()
jobs_router = APIRouter()


def _entitled_keys(db) -> set[str]:
    # No auth, no subscriptions: all tools are available to everyone.
    from app.services.pdf.registry import list_tools
    return {t.key for t in list_tools()}


@tools_router.get("", response_model=list[ToolInfoResponse])
def list_tools_ep(db: Session = Depends(get_db)):
    entitled = _entitled_keys(db)
    return [
        ToolInfoResponse(
            key=t.key, name=t.name, description=t.description, version=t.version,
            accepted_types=t.accepted_types, min_inputs=t.min_inputs, max_inputs=t.max_inputs,
            entitled=t.key in entitled, config_schema=t.config_schema,
        )
        for t in list_tools()
    ]


@tools_router.get("/{key}", response_model=ToolInfoResponse)
def get_tool_ep(key: str, db: Session = Depends(get_db)):
    t = get_tool(key)
    if not t:
        raise NotFound("Tool not found.")
    entitled = _entitled_keys(db)
    return ToolInfoResponse(
        key=t.key, name=t.name, description=t.description, version=t.version,
        accepted_types=t.accepted_types, min_inputs=t.min_inputs, max_inputs=t.max_inputs,
        entitled=t.key in entitled, config_schema=t.config_schema,
    )


@jobs_router.post("", dependencies=[Depends(rate_limit("job_create"))])
def create_job(body: JobCreateRequest, request: Request, db: Session = Depends(get_db)):
    from app.core.quotas import quota_manager

    # 1. quota check BEFORE queueing (per-IP abuse prevention)
    client_ip = quota_manager.get_client_ip(request)
    quota_manager.check_and_record(client_ip)
    try:
        # 2. create the job record (anonymous ownership)
        job = job_service.create_job(
            db, owner_id=ANONYMOUS_USER_ID, tool_key=body.tool_key,
            file_ids=body.file_ids, config=body.config,
            idempotency_key=body.idempotency_key,
        )
        db.commit()
        # 3. dispatch to the worker
        job_service.get_worker().submit(db, job)
        db.refresh(job)
        return job_service.job_to_public_dict(job)
    finally:
        quota_manager.release(client_ip)


@jobs_router.get("", response_model=PageResponse)
def list_jobs(
    db: Session = Depends(get_db),
    cursor: str | None = Query(default=None),
    limit: int = Query(default=20, le=100),
    status: str | None = Query(default=None),
):
    q = (
        select(ProcessingJob)
        .where(ProcessingJob.owner_user_id == ANONYMOUS_USER_ID)
        .order_by(ProcessingJob.created_at.desc(), ProcessingJob.id.desc())
        .limit(limit + 1)
    )
    if status:
        q = q.where(ProcessingJob.status == status)
    if cursor:
        try:
            c_time, c_id = cursor.split("|")
            from datetime import datetime

            ts = datetime.fromisoformat(c_time)
            q = q.where((ProcessingJob.created_at < ts) | ((ProcessingJob.created_at == ts) & (ProcessingJob.id < uuid.UUID(c_id))))
        except Exception:
            pass
    rows = list(db.scalars(q))
    next_cursor = None
    if len(rows) > limit:
        rows = rows[:limit]
        last = rows[-1]
        next_cursor = f"{last.created_at.isoformat()}|{last.id}"
    return PageResponse(items=[job_service.job_to_public_dict(j) for j in rows], next_cursor=next_cursor)


@jobs_router.get("/{job_id}")
def get_job(job_id: uuid.UUID, db: Session = Depends(get_db)):
    job = job_service.get_job_for_user(db, job_id=job_id)
    return job_service.job_to_public_dict(job)


@jobs_router.post("/{job_id}/cancel")
def cancel_job(job_id: uuid.UUID, db: Session = Depends(get_db)):
    job = job_service.get_job_for_user(db, job_id=job_id)
    if job.status not in (JobStatus.QUEUED,):
        from app.core.errors import AppException

        raise AppException("Only queued jobs can be cancelled.", details={"status": job.status})
    job_service.get_worker().cancel(db, job)
    return {"message": "Job cancelled."}


@jobs_router.post("/{job_id}/retry", dependencies=[Depends(rate_limit("job_create"))])
def retry_job(job_id: uuid.UUID, request: Request, db: Session = Depends(get_db)):
    from app.core.quotas import quota_manager

    job = job_service.get_job_for_user(db, job_id=job_id)
    if job.status != JobStatus.FAILED:
        raise JobNotFound("Only failed jobs can be retried.")
    if job.retry_count >= 2:
        from app.core.errors import AppException

        raise AppException("Retry limit reached for this job.")
    # Same abuse protection as job creation (no subscriptions in this architecture).
    client_ip = quota_manager.get_client_ip(request)
    quota_manager.check_and_record(client_ip)
    try:
        job.retry_count += 1
        job.status = JobStatus.QUEUED
        job.error_code = None
        job.internal_error_reference = None
        db.commit()
        job_service.get_worker().submit(db, job)
        db.refresh(job)
        return job_service.job_to_public_dict(job)
    finally:
        quota_manager.release(client_ip)
