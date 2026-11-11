import asyncio
import math
import time
from collections import defaultdict, deque

from fastapi import Request

from app.core.config import get_settings
from app.core.errors import AppError


class InMemoryRateLimiter:
    """Sliding-window rate limiter keyed by bucket + client IP or user ID."""

    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = asyncio.Lock()

    async def check(self, key: str, max_requests: int, window_seconds: int) -> None:
        now = time.monotonic()
        cutoff = now - window_seconds
        async with self._lock:
            dq = self._hits[key]
            while dq and dq[0] <= cutoff:
                dq.popleft()
            if len(dq) >= max_requests:
                retry_after = max(1, math.ceil(dq[0] + window_seconds - now))
                raise AppError(
                    code="RATE_LIMIT_EXCEEDED",
                    message="Too many requests. Please wait a moment and try again.",
                    status_code=429,
                    details={"retry_after_seconds": retry_after},
                )
            dq.append(now)

    async def reset(self) -> None:
        async with self._lock:
            self._hits.clear()


rate_limiter = InMemoryRateLimiter()


def rate_limit(bucket: str, max_requests: int, window_seconds: int):
    """FastAPI dependency enforcing sliding-window rate limits per route bucket."""

    async def _dependency(request: Request) -> None:
        settings = get_settings()
        if not settings.rate_limit_enabled or settings.env == "test":
            return
        client_ip = request.client.host if request.client else "unknown"
        auth_header = request.headers.get("authorization", "")
        key_scope = auth_header[-16:] if len(auth_header) >= 16 else client_ip
        await rate_limiter.check(f"{bucket}:{client_ip}:{key_scope}", max_requests, window_seconds)

    return _dependency

