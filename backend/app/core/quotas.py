"""Per-IP quota enforcement (abuse prevention).

Industry pattern (from competitor research): task-frequency quotas instead
of CAPTCHAs. Sejda: 3/hour, Smallpdf: 2/day, PDF Candy: 1/hour.

v1 uses in-memory counters (Redis disabled). Structure allows swapping to
Upstash Redis later without changing call sites.

Limits (configurable via settings):
- tasks_per_hour_per_ip: 10
- tasks_per_day_per_ip: 30
- concurrent_jobs_per_ip: 2
"""
from __future__ import annotations

import time
from collections import defaultdict, deque
from threading import Lock

from fastapi import Request

from app.core.config import get_settings
from app.core.errors import RateLimited


class QuotaManager:
    def __init__(self):
        self._lock = Lock()
        # ip -> deque of timestamps (hour window)
        self._hourly: dict[str, deque[float]] = defaultdict(deque)
        # ip -> deque of timestamps (day window)
        self._daily: dict[str, deque[float]] = defaultdict(deque)
        # ip -> active job count
        self._active: dict[str, int] = defaultdict(int)

    def _prune(self, dq: deque[float], window: float, now: float) -> None:
        cutoff = now - window
        while dq and dq[0] < cutoff:
            dq.popleft()

    def check_and_record(self, ip: str) -> None:
        """Check quotas and record a task. Raises RateLimited if exceeded."""
        settings = get_settings()
        now = time.time()

        with self._lock:
            hourly = self._hourly[ip]
            daily = self._daily[ip]

            self._prune(hourly, 3600, now)
            self._prune(daily, 86400, now)

            if len(hourly) >= settings.quota_tasks_per_hour:
                raise RateLimited(
                    f"Hourly limit reached ({settings.quota_tasks_per_hour} tasks/hour). "
                    "Please try again later."
                )
            if len(daily) >= settings.quota_tasks_per_day:
                raise RateLimited(
                    f"Daily limit reached ({settings.quota_tasks_per_day} tasks/day). "
                    "Please try again tomorrow."
                )
            if self._active[ip] >= settings.quota_concurrent_jobs:
                raise RateLimited(
                    f"Too many concurrent jobs ({settings.quota_concurrent_jobs} max). "
                    "Please wait for current jobs to finish."
                )

            hourly.append(now)
            daily.append(now)
            self._active[ip] += 1

    def release(self, ip: str) -> None:
        """Release a concurrent job slot."""
        with self._lock:
            if self._active[ip] > 0:
                self._active[ip] -= 1

    def get_client_ip(self, request: Request) -> str:
        """Extract client IP, respecting proxy headers."""
        # Vercel provides x-forwarded-for
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            return forwarded.split(",")[0].strip()
        real_ip = request.headers.get("x-real-ip")
        if real_ip:
            return real_ip.strip()
        if request.client:
            return request.client.host
        return "unknown"


# Global instance
quota_manager = QuotaManager()
