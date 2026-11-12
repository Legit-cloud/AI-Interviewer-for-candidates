import logging
from typing import Any
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


logger = logging.getLogger(__name__)


class AppError(Exception):
    """Typed domain error rendered into the PRD §18 error envelope."""

    def __init__(
        self,
        code: str,
        message: str,
        status_code: int = 400,
        details: dict[str, Any] | None = None,
    ) -> None:
        self.code = code
        self.message = message
        self.status_code = status_code
        self.details = details or {}
        super().__init__(message)


def _request_id(request: Request) -> str:
    rid = getattr(request.state, "request_id", None)
    return rid or f"req_{uuid4().hex[:12]}"


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def handle_app_error(request: Request, exc: AppError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content={
                "error": {
                    "code": exc.code,
                    "message": exc.message,
                    "request_id": _request_id(request),
                    "details": exc.details,
                }
            },
        )

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        return JSONResponse(
            status_code=422,
            content={
                "error": {
                    "code": "VALIDATION_ERROR",
                    "message": "One or more fields are invalid.",
                    "request_id": _request_id(request),
                    "details": {"issues": exc.errors()},
                }
            },
        )

    @app.exception_handler(HTTPException)
    async def handle_http_error(request: Request, exc: HTTPException) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content={
                "error": {
                    "code": "HTTP_ERROR",
                    "message": str(exc.detail),
                    "request_id": _request_id(request),
                    "details": {},
                }
            },
        )

    @app.exception_handler(Exception)
    async def handle_unexpected_error(request: Request, exc: Exception) -> JSONResponse:
        from app.core.config import get_settings

        logger.exception("Unhandled error on %s %s", request.method, request.url.path)
        message = "Something went wrong on the server. Please try again."
        if get_settings().env == "development":
            message += (
                " If you just updated Vren AI, apply the database migrations with "
                "`cd backend && uv run alembic upgrade head`, then restart the API."
            )
        return JSONResponse(
            status_code=500,
            content={
                "error": {
                    "code": "INTERNAL_ERROR",
                    "message": message,
                    "request_id": _request_id(request),
                    "details": {},
                }
            },
        )
