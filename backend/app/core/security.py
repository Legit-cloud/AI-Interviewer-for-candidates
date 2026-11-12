import hashlib
import secrets
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

import jwt
from pwdlib import PasswordHash

from app.core.config import get_settings
from app.core.errors import AppError

password_hasher = PasswordHash.recommended()


def hash_password(plain: str) -> str:
    return password_hasher.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return password_hasher.verify(plain, hashed)
    except Exception:
        return False


def generate_opaque_token() -> str:
    return secrets.token_urlsafe(32)


def hash_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def create_access_token(user_id: UUID, email: str) -> tuple[str, datetime]:
    settings = get_settings()
    now = datetime.now(UTC)
    expires = now + timedelta(minutes=settings.access_token_minutes)
    payload: dict[str, Any] = {
        "sub": str(user_id),
        "email": email,
        "iss": settings.jwt_issuer,
        "aud": settings.jwt_audience,
        "iat": int(now.timestamp()),
        "exp": int(expires.timestamp()),
        "scope": "web",
    }
    token = jwt.encode(payload, settings.active_jwt_secret, algorithm="HS256")
    return token, expires


def decode_access_token(token: str) -> dict[str, Any]:
    settings = get_settings()
    try:
        options = {"require": ["sub", "exp"]}
        kwargs: dict[str, Any] = {
            "algorithms": ["HS256"],
            "options": options,
        }
        if settings.auth_mode == "local":
            kwargs["issuer"] = settings.jwt_issuer
            kwargs["audience"] = settings.jwt_audience
        else:
            kwargs["audience"] = "authenticated"
        payload = jwt.decode(token, settings.active_jwt_secret, **kwargs)
    except jwt.ExpiredSignatureError as exc:
        raise AppError("TOKEN_EXPIRED", "Your session has expired. Sign in again.", 401) from exc
    except jwt.InvalidTokenError as exc:
        raise AppError("INVALID_TOKEN", "Invalid authentication token.", 401) from exc
    # Live-session tokens (pairing / WebSocket) must never work as account tokens.
    if payload.get("scope") == "ws_session":
        raise AppError("INVALID_TOKEN", "Invalid authentication token.", 401)
    return payload


def create_session_ws_token(
    user_id: UUID,
    session_id: UUID,
    minutes: int = 60,
    role: str = "capture",
) -> tuple[str, datetime]:
    settings = get_settings()
    now = datetime.now(UTC)
    expires = now + timedelta(minutes=minutes)
    payload: dict[str, Any] = {
        "sub": str(user_id),
        "session_id": str(session_id),
        "iss": settings.jwt_issuer,
        "aud": settings.jwt_audience,
        "iat": int(now.timestamp()),
        "exp": int(expires.timestamp()),
        "scope": "ws_session",
        "role": role,
    }
    token = jwt.encode(payload, settings.active_jwt_secret, algorithm="HS256")
    return token, expires


def decode_session_ws_claims(token: str, expected_session_id: UUID) -> tuple[UUID, str]:
    """Validate a live-session token and return (user_id, role). Role is 'capture' or 'display'."""
    settings = get_settings()
    try:
        payload = jwt.decode(
            token,
            settings.active_jwt_secret,
            algorithms=["HS256"],
            audience=settings.jwt_audience,
            issuer=settings.jwt_issuer,
            options={"require": ["sub", "exp", "session_id", "scope"]},
        )
    except jwt.InvalidTokenError as exc:
        raise AppError("INVALID_WS_TOKEN", "Invalid or expired WebSocket token.", 401) from exc

    if payload.get("scope") != "ws_session" or payload.get("session_id") != str(expected_session_id):
        raise AppError("FORBIDDEN_WS_SESSION", "Token is not valid for this session.", 403)
    role = str(payload.get("role") or "capture")
    if role not in ("capture", "display"):
        raise AppError("FORBIDDEN_WS_SESSION", "Token role is not valid.", 403)
    return UUID(str(payload["sub"])), role


def decode_session_ws_token(token: str, expected_session_id: UUID) -> UUID:
    return decode_session_ws_claims(token, expected_session_id)[0]
