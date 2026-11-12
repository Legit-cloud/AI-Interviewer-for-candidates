from uuid import UUID

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.errors import AppError
from app.core.security import decode_access_token
from app.db.models import User

bearer_scheme = HTTPBearer(auto_error=False)


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    if not credentials or credentials.scheme.lower() != "bearer":
        raise AppError("UNAUTHORIZED", "Authentication required.", 401)

    claims = decode_access_token(credentials.credentials)
    try:
        user_id = UUID(str(claims["sub"]))
    except ValueError as exc:
        raise AppError("INVALID_TOKEN", "Invalid subject claim.", 401) from exc

    user = await db.scalar(select(User).where(User.id == user_id))
    if not user:
        raise AppError("USER_NOT_FOUND", "Account no longer exists.", 401)
    return user


async def get_verified_user(user: User = Depends(get_current_user)) -> User:
    if not user.is_verified:
        raise AppError(
            "EMAIL_NOT_VERIFIED",
            "Verify your email address before accessing this workspace.",
            403,
        )
    return user

