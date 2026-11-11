import asyncio
from contextlib import asynccontextmanager, suppress
from uuid import uuid4

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.database import AsyncSessionLocal, get_db
from app.core.errors import register_exception_handlers
from app.modules.auth.router import router as auth_router
from app.modules.documents.router import router as documents_router
from app.modules.extensions.router import router as extensions_router
from app.modules.jobs.router import router as jobs_router
from app.modules.live.router import router as live_router
from app.modules.preparation.router import router as preparation_router
from app.modules.profile.router import router as profile_router
from app.modules.sessions.retention import purge_expired_transcripts
from app.modules.sessions.router import export_router, router as sessions_router

settings = get_settings()


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
app.include_router(extensions_router)
app.include_router(live_router)


@app.get("/v1/health", tags=["system"])
async def health(db: AsyncSession = Depends(get_db)) -> dict[str, str]:
    await db.execute(text("SELECT 1"))
    return {"status": "ok", "database": "connected", "auth_mode": settings.auth_mode}

