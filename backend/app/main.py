import asyncio
import logging
from contextlib import asynccontextmanager, suppress
from typing import Any
from uuid import uuid4

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.database import AsyncSessionLocal, get_db
from app.core.errors import register_exception_handlers
from app.adapters.llm import get_llm_adapter
from app.adapters.stt import get_stt_adapter
from app.core.schema_check import schema_status
from app.modules.auth.router import router as auth_router
from app.modules.documents.router import router as documents_router
from app.modules.jobs.router import router as jobs_router
from app.modules.live.router import router as live_router
from app.modules.mock.router import router as mock_router
from app.modules.pairing.router import router as pairing_router
from app.modules.preparation.router import router as preparation_router
from app.modules.profile.router import router as profile_router
from app.modules.sessions.retention import purge_expired_transcripts
from app.modules.sessions.router import export_router, router as sessions_router

settings = get_settings()
logger = logging.getLogger("uvicorn.error")


async def _retention_sweep_loop() -> None:
    while True:
        await asyncio.sleep(3600)
        try:
            async with AsyncSessionLocal() as db:
                await purge_expired_transcripts(db)
        except Exception:
            pass


@asynccontextmanager
async def lifespan(_app: FastAPI):
    task: asyncio.Task[None] | None = None
    if settings.env != "test":
        task = asyncio.create_task(_retention_sweep_loop())
        try:
            async with AsyncSessionLocal() as db:
                if await schema_status(db) == "needs_migration":
                    logger.warning(
                        "Database schema is behind the code. Run: cd backend && uv run alembic upgrade head"
                    )
        except Exception:
            pass
    try:
        yield
    finally:
        if task is not None:
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task


app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    docs_url="/docs" if settings.env != "production" else None,
    redoc_url=None,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def attach_request_id(request: Request, call_next):
    rid = request.headers.get("x-request-id") or f"req_{uuid4().hex[:12]}"
    request.state.request_id = rid
    response = await call_next(request)
    response.headers["x-request-id"] = rid
    return response


register_exception_handlers(app)
app.include_router(auth_router)
app.include_router(profile_router)
app.include_router(documents_router)
app.include_router(jobs_router)
app.include_router(preparation_router)
app.include_router(sessions_router)
app.include_router(export_router)
app.include_router(live_router)
app.include_router(pairing_router)
app.include_router(mock_router)


@app.get("/v1/health", tags=["system"])
async def health(db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    await db.execute(text("SELECT 1"))
    return {
        "status": "ok",
        "database": "connected",
        "schema": await schema_status(db),
        "auth_mode": settings.auth_mode,
        # Which AI pieces the server can actually use. Never includes keys.
        "ai": {
            "answers": get_llm_adapter().is_configured,
            "providers": get_llm_adapter().provider_names(),
            "transcription": get_stt_adapter().active_provider,
        },
    }

