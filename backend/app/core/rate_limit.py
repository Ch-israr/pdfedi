"""Backend-enforced rate limiting.

Design:
- Keyed by (scope, identity) where identity is user_id when authenticated,
  else client IP. Plan-aware multipliers widen limits for paid tiers.
- Storage: Redis when available, otherwise a process-local in-memory store
  (correct for single-process dev; on serverless the in-memory fallback is
  best-effort — Redis is required for strict enforcement in production).
- Sliding-window counter implemented with a sorted set in Redis.

Usage as a FastAPI dependency::

    @router.post("/jobs", dependencies=[Depends(rate_limit("job_create"))])
"""
from __future__ import annotations

import time
from collections import defaultdict, deque

from fastapi import Request

from app.core.config import get_settings
from app.core.errors import RateLimited
from app.core.logging import get_logger

log = get_logger("pdfedi.ratelimit")
settings = get_settings()

# scope -> (limit per 60s, human label)
SCOPES: dict[str, tuple[int, str]] = {
    "auth": (settings.rate_limit_auth_per_minute, "authentication"),
    "upload": (settings.rate_limit_upload_per_minute, "uploads"),
    "job_create": (settings.rate_limit_job_create_per_minute, "job creation"),
    "download": (60, "downloads"),
    "admin_login": (10, "admin login"),
    "default": (settings.rate_limit_default_per_minute, "requests"),
}

_redis = None


def _get_redis():
    global _redis
    if _redis is None and settings.redis_enabled:
        try:
            import redis as redis_lib

            _redis = redis_lib.from_url(settings.redis_url, socket_connect_timeout=2)
            _redis.ping()
        except Exception as e:  # Redis optional; degrade to in-memory
            log.warning("redis_unavailable_fallback_memory", error=str(e))
            _redis = False
    return _redis or None


# In-memory fallback: key -> deque[timestamps]
_mem: dict[str, deque] = defaultdict(deque)


def _check_memory(key: str, limit: int, window: int = 60) -> bool:
    now = time.time()
    dq = _mem[key]
    while dq and dq[0] <= now - window:
        dq.popleft()
    if len(dq) >= limit:
        return False
    dq.append(now)
    return True


def _check_redis(r, key: str, limit: int, window: int = 60) -> bool:
    now = time.time()
    pipe = r.pipeline()
    pipe.zremrangebyscore(key, 0, now - window)
    pipe.zadd(key, {f"{now}:{id(key)}": now})
    pipe.zcard(key)
    pipe.expire(key, window)
    _, _, count, _ = pipe.execute()
    return count <= limit


def check_rate_limit(*, scope: str, identity: str, multiplier: float = 1.0) -> None:
    limit, label = SCOPES.get(scope, SCOPES["default"])
    limit = max(1, int(limit * multiplier))
    key = f"rl:{scope}:{identity}"
    ok = False
    r = _get_redis()
    try:
        ok = _check_redis(r, key, limit) if r else _check_memory(key, limit)
    except Exception as e:
        log.warning("ratelimit_backend_error", error=str(e))
        ok = True  # fail open on infra error; alerting covers abuse
    if not ok:
        raise RateLimited(f"Too many {label} requests. Please try again shortly.")


def _identity(request: Request) -> str:
    user = getattr(request.state, "user_id", None)
    if user:
        return f"user:{user}"
    # Honor X-Forwarded-For only from one trusted hop is out of scope here;
    # take the direct client and let the edge proxy set it correctly.
    fwd = request.headers.get("x-forwarded-for")
    ip = fwd.split(",")[0].strip() if fwd else (request.client.host if request.client else "unknown")
    return f"ip:{ip}"


def rate_limit(scope: str):
    """FastAPI dependency factory."""

    async def _dep(request: Request):
        multiplier = getattr(request.state, "rate_limit_multiplier", 1.0)
        check_rate_limit(scope=scope, identity=_identity(request), multiplier=multiplier)

    return _dep


# --- Per-tool hourly rate limit (3/hour per IP per tool) ---
# Added 2026-10-06 per user request: guest abuse protection.

TOOL_HOURLY_LIMIT = 3
TOOL_HOURLY_WINDOW = 3600  # 1 hour in seconds


def _check_window(key: str, limit: int, window: int) -> bool:
    """Sliding-window check with custom window (seconds)."""
    now = time.time()
    r = _get_redis()
    if r:
        try:
            return _check_redis(r, key, limit, window)
        except Exception as e:
            log.warning("ratelimit_redis_error", error=str(e))
    return _check_memory(key, limit, window)


def rate_limit_tool_hourly():
    """
    FastAPI dependency: 3 job creations per hour per IP per tool.
    Reads tool_key from the request body. Applies to guests and users alike
    (IP-based, not user-based) to prevent abuse.
    """

    async def _dep(request: Request):
        # Parse tool_key from JSON body
        tool_key = "unknown"
        try:
            body = await request.json()
            tool_key = body.get("tool_key", "unknown")
        except Exception:
            pass

        # IP-based identity (not user-based)
        fwd = request.headers.get("x-forwarded-for")
        ip = fwd.split(",")[0].strip() if fwd else (request.client.host if request.client else "unknown")

        key = f"rl:tool_hourly:{tool_key}:ip:{ip}"
        if not _check_window(key, TOOL_HOURLY_LIMIT, TOOL_HOURLY_WINDOW):
            raise RateLimited(
                f"Too many requests for this tool. Limit is {TOOL_HOURLY_LIMIT} per hour. "
                "Please try again later."
            )

    return _dep
