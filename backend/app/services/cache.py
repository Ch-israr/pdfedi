"""Redis-backed cache service.

Used for:
- Frequently accessed user/subscription/plan data (short TTL)
- Temporary session data
- Rate-limiting counters (see app/core/rate_limit.py)
- Idempotency keys and distributed locks

Redis is NEVER the source of truth — PostgreSQL is. All cached data has a
TTL and the application degrades gracefully when Redis is unavailable.
"""
from __future__ import annotations

import hashlib
import json
from typing import Any

from app.core.config import get_settings
from app.core.logging import get_logger

log = get_logger("pdfedi.cache")
settings = get_settings()

_redis = None


def get_redis():
    """Return a Redis client, or None if Redis is disabled/unavailable."""
    global _redis
    if _redis is None and settings.redis_enabled:
        try:
            import redis as redis_lib

            _redis = redis_lib.from_url(
                settings.redis_url,
                socket_connect_timeout=2,
                socket_timeout=2,
                decode_responses=True,
            )
            _redis.ping()
        except Exception as e:
            log.warning("redis_cache_unavailable", error=str(e)[:200])
            _redis = False
    return _redis or None


def _key(namespace: str, *parts: str) -> str:
    safe = ":".join(str(p).replace(":", "_") for p in parts)
    return f"pdfedi:{namespace}:{safe}"


def get(namespace: str, *parts: str) -> Any | None:
    r = get_redis()
    if not r:
        return None
    try:
        raw = r.get(_key(namespace, *parts))
        return json.loads(raw) if raw else None
    except Exception as e:
        log.warning("cache_get_failed", error=str(e)[:100])
        return None


def set(namespace: str, value: Any, ttl_seconds: int, *parts: str) -> bool:
    r = get_redis()
    if not r:
        return False
    try:
        r.setex(_key(namespace, *parts), ttl_seconds, json.dumps(value, default=str))
        return True
    except Exception as e:
        log.warning("cache_set_failed", error=str(e)[:100])
        return False


def delete(namespace: str, *parts: str) -> None:
    r = get_redis()
    if not r:
        return
    try:
        r.delete(_key(namespace, *parts))
    except Exception:
        pass


def delete_pattern(namespace: str, pattern: str = "*") -> None:
    r = get_redis()
    if not r:
        return
    try:
        for k in r.scan_iter(f"pdfedi:{namespace}:{pattern}", count=100):
            r.delete(k)
    except Exception:
        pass


# --- Convenience wrappers for hot paths ---

USER_TTL = 300          # 5 min — user profile + roles
PLAN_TTL = 600          # 10 min — subscription plans (rarely change)
SUBSCRIPTION_TTL = 300  # 5 min — active subscription per user


def get_cached_user(user_id: str) -> dict | None:
    return get("user", user_id)


def set_cached_user(user_id: str, data: dict) -> bool:
    return set("user", data, USER_TTL, user_id)


def invalidate_user(user_id: str) -> None:
    delete("user", user_id)
    delete("subscription", user_id)


def get_cached_plan(plan_code: str) -> dict | None:
    return get("plan", plan_code)


def set_cached_plan(plan_code: str, data: dict) -> bool:
    return set("plan", data, PLAN_TTL, plan_code)


def content_hash(data: bytes) -> str:
    """SHA-256 hex digest used for file deduplication keys."""
    return hashlib.sha256(data).hexdigest()
