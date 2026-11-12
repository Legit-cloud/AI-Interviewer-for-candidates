"""Pairing codes: link the browser extension to a live session created in the web app.

The web app (authenticated) asks for a 6-digit code. The extension redeems it, without any
account credentials, for a token scoped to that one session. The code is stored hashed,
is valid for 10 minutes and works once.
"""

import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.database import get_db
from app.core.deps import get_verified_user
from app.core.errors import AppError
from app.core.rate_limit import rate_limit, rate_limiter
from app.core.security import create_session_ws_token
from app.db.models import InterviewSession, JobDescription, PairingCode, User
from app.modules.live.session import live_registry
from app.modules.sessions.router import require_rules_acknowledgement

router = APIRouter(tags=["pairing"])

CODE_TTL_MINUTES = 10


class PairingCodeOut(BaseModel):
    code: str
    expires_at: datetime
    ttl_seconds: int


class PairingRedeemIn(BaseModel):
    code: str = Field(min_length=6, max_length=6, pattern=r"^\d{6}$")


class PairingRedeemOut(BaseModel):
    session_id: UUID
    ws_token: str
    ws_path: str
    expires_at: datetime
    job_title: str = ""
    company: str = ""
    transcript_retained: bool = False


def _hash_code(code: str) -> str:
    secret = get_settings().active_jwt_secret.encode()
    return hmac.new(secret, f"pairing:{code}".encode(), hashlib.sha256).hexdigest()


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


async def _owned_live_session(session_id: UUID, user_id: UUID, db: AsyncSession) -> InterviewSession:
    row = (
        await db.execute(
            select(InterviewSession).where(
                InterviewSession.id == session_id, InterviewSession.user_id == user_id
            )
        )
    ).scalar_one_or_none()
    if not row:
        raise AppError("SESSION_NOT_FOUND", "Session not found.", 404)
    if row.state == "ended":
        raise AppError("SESSION_ENDED", "This session has already ended.", 409)
    return row


@router.post(
    "/v1/sessions/{session_id}/pairing-code",
    response_model=PairingCodeOut,
    status_code=201,
    dependencies=[Depends(rate_limit("pairing_issue", 20, 300))],
)
async def issue_pairing_code(
    session_id: UUID,
    user: User = Depends(get_verified_user),
    db: AsyncSession = Depends(get_db),
) -> PairingCodeOut:
    session_row = await _owned_live_session(session_id, user.id, db)
    require_rules_acknowledgement(session_row)
    now = datetime.now(timezone.utc)

    # One live code per session: issuing a new one replaces any unredeemed code.
    await db.execute(
        delete(PairingCode).where(
            PairingCode.session_id == session_row.id, PairingCode.redeemed_at.is_(None)
        )
    )

    active_hashes = {
        h
        for (h,) in (
            await db.execute(
                select(PairingCode.code_hash).where(
                    PairingCode.redeemed_at.is_(None), PairingCode.expires_at > now
                )
            )
        ).all()
    }
    code = ""
    for _ in range(25):
        candidate = f"{secrets.randbelow(1_000_000):06d}"
        if _hash_code(candidate) not in active_hashes:
            code = candidate
            break
    if not code:
        raise AppError("PAIRING_BUSY", "Could not allocate a pairing code. Try again.", 503)

    expires_at = now + timedelta(minutes=CODE_TTL_MINUTES)
    db.add(
        PairingCode(
            session_id=session_row.id,
            user_id=user.id,
            code_hash=_hash_code(code),
            expires_at=expires_at,
        )
    )
    await db.commit()
    return PairingCodeOut(code=code, expires_at=expires_at, ttl_seconds=CODE_TTL_MINUTES * 60)


@router.post(
    "/v1/pairing/redeem",
    response_model=PairingRedeemOut,
    dependencies=[Depends(rate_limit("pairing_redeem", 20, 300))],
)
async def redeem_pairing_code(
    payload: PairingRedeemIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> PairingRedeemOut:
    settings = get_settings()
    client_ip = request.client.host if request.client else "unknown"
    now = datetime.now(timezone.utc)

    row = (
        await db.execute(
            select(PairingCode).where(
                PairingCode.code_hash == _hash_code(payload.code),
                PairingCode.redeemed_at.is_(None),
            )
        )
    ).scalar_one_or_none()

    if row is None or _aware(row.expires_at) <= now:
        # Brute-force guard: repeated failures from one address are throttled.
        if settings.rate_limit_enabled and settings.env != "test":
            await rate_limiter.check(f"pairing_fail:{client_ip}", 8, 600)
        raise AppError("PAIRING_CODE_INVALID", "That code is invalid or has expired.", 400)

    session_row = await db.get(InterviewSession, row.session_id)
    if session_row is None or session_row.state == "ended":
        raise AppError("SESSION_ENDED", "This session has already ended.", 409)

    row.redeemed_at = now
    job = await db.get(JobDescription, session_row.job_id) if session_row.job_id else None
    await db.commit()

    minutes = settings.max_session_minutes
    ws_token, expires_at = create_session_ws_token(
        user_id=row.user_id, session_id=session_row.id, minutes=minutes, role="capture"
    )
    return PairingRedeemOut(
        session_id=session_row.id,
        ws_token=ws_token,
        ws_path=f"/v1/live/{session_row.id}",
        expires_at=expires_at,
        job_title=job.title if job else "",
        company=job.company if job else "",
        transcript_retained=session_row.transcript_retained,
    )


@router.post("/v1/sessions/{session_id}/pairing/revoke", status_code=204)
async def revoke_pairing(
    session_id: UUID,
    user: User = Depends(get_verified_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    session_row = await _owned_live_session(session_id, user.id, db)
    await db.execute(
        delete(PairingCode).where(
            PairingCode.session_id == session_row.id, PairingCode.redeemed_at.is_(None)
        )
    )
    await db.commit()
    await live_registry.kick_capture(session_row.id)
