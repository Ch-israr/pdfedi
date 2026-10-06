"""Structured JSON logging with correlation IDs.

Every log line carries ``request_id`` so an API request can be traced
through the queue and worker to completion. Secrets are never logged —
use ``safe_extra`` helpers and never interpolate user input blindly.
"""
from __future__ import annotations

import logging
import sys
import uuid
from contextvars import ContextVar

import structlog

_request_id: ContextVar[str] = ContextVar("request_id", default="-")


def get_request_id() -> str:
    return _request_id.get()


def set_request_id(value: str | None = None) -> str:
    rid = value or f"req_{uuid.uuid4().hex[:16]}"
    _request_id.set(rid)
    return rid


def _add_request_id(logger, method_name, event_dict):
    event_dict["request_id"] = get_request_id()
    return event_dict


def configure_logging(level: str = "INFO", json_format: bool = True) -> None:
    processors: list = [
        structlog.contextvars.merge_contextvars,
        _add_request_id,
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso", utc=True),
        structlog.processors.StackInfoRenderer(),
    ]
    if json_format:
        processors.append(structlog.processors.JSONRenderer())
    else:
        processors.append(structlog.dev.ConsoleRenderer())

    structlog.configure(
        processors=processors,
        wrapper_class=structlog.make_filtering_bound_logger(getattr(logging, level.upper(), logging.INFO)),
        context_class=dict,
        logger_factory=structlog.PrintLoggerFactory(file=sys.stdout),
        cache_logger_on_first_use=True,
    )


def get_logger(name: str = "pdfedi"):
    return structlog.get_logger(name)
