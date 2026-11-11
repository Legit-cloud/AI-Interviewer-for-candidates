from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_verified_user
from app.core.errors import AppError
from app.core.rate_limit import rate_limit
from app.core.security import (
    create_extension_access_token,
    generate_opaque_token,
    hash_token,
)
from app.db.models import AuditEvent, ExtensionConnection, User
from app.modules.auth.schemas import UserSummary
from app.modules.extensions.schemas import (
    ExtensionConnectionOut,
    ExtensionExchangeIn,
    ExtensionExchangeOut,
    ExtensionHeartbeatIn,
    ExtensionPairIn,
    ExtensionPairOut,
)

router = APIRouter(prefix="/v1/extensions", tags=["extensions"])


@router.get("", response_model=ExtensionConnectionOut)
async def get_extension_status(
    user: User = Depends(get_verified_user),
    db: AsyncSession = Depends(get_db),
) -> ExtensionConnectionOut:
    conn = (
        await db.execute(
            select(ExtensionConnection)
            .where(
                ExtensionConnection.user_id == user.id,
                ExtensionConnection.revoked_at.is_(None),
            )
            .order_by(ExtensionConnection.connected_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if not conn:
        return ExtensionConnectionOut(connected=False)
    return ExtensionConnectionOut(
        connected=True,
        connection_id=conn.id,
        version=conn.version,
        connected_at=conn.connected_at,
        last_seen_at=conn.last_seen_at,
    )


@router.post("/pair", response_model=ExtensionPairOut, status_code=status.HTTP_201_CREATED)
async def pair_extension(
    payload: ExtensionPairIn,
    user: User = Depends(get_verified_user),
    db: AsyncSession = Depends(get_db),
) -> ExtensionPairOut:
    now = datetime.now(timezone.utc)
    active_conns = (
        await db.execute(
            select(ExtensionConnection).where(
                ExtensionConnection.user_id == user.id,
                ExtensionConnection.revoked_at.is_(None),
            )
        )
    ).scalars().all()
    for existing in active_conns:
        existing.revoked_at = now

    raw_token = f"vren_ext_{generate_opaque_token()}"
    conn = ExtensionConnection(
        user_id=user.id,
        token_hash=hash_token(raw_token),
        version=payload.version.strip() or "0.1.0",
        connected_at=now,
        last_seen_at=now,
    )
    db.add(conn)
    db.add(
        AuditEvent(
            user_id=user.id,
            event_type="extension_connected",
            metadata_json={"version": conn.version},
        )
    )
    await db.commit()
    await db.refresh(conn)
    return ExtensionPairOut(
        connected=True,
        connection_id=conn.id,
        version=conn.version,
        connected_at=conn.connected_at,
        last_seen_at=conn.last_seen_at,
        pairing_token=raw_token,
    )


@router.post(
    "/exchange",
    response_model=ExtensionExchangeOut,
    dependencies=[Depends(rate_limit("extension_exchange", 20, 300))],
)
async def exchange_pairing_token(
    payload: ExtensionExchangeIn,
    db: AsyncSession = Depends(get_db),
) -> ExtensionExchangeOut:
    token_value = payload.pairing_token.strip()
    conn = (
        await db.execute(
            select(ExtensionConnection).where(
                ExtensionConnection.token_hash == hash_token(token_value),
                ExtensionConnection.revoked_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if not conn:
        raise AppError(
            code="INVALID_PAIRING_TOKEN",
            message="Pairing code is invalid, already used, or revoked.",
            status_code=401,
        )

    now = datetime.now(timezone.utc)
    created = conn.connected_at if conn.connected_at.tzinfo else conn.connected_at.replace(tzinfo=timezone.utc)
    if created < now - timedelta(minutes=15):
        raise AppError(
            code="PAIRING_TOKEN_EXPIRED",
            message="Pairing code expired. Generate a fresh code from Vren AI Settings.",
            status_code=401,
        )

    user = await db.get(User, conn.user_id)
    if not user or not user.is_verified:
        raise AppError(
            code="ACCOUNT_NOT_VERIFIED",
            message="Verify your Vren AI account before connecting the extension.",
            status_code=403,
        )

    # Rotate token_hash immediately so the pairing code is strictly single-use.
    conn.token_hash = hash_token(f"paired_{generate_opaque_token()}")
    conn.version = payload.version.strip() or conn.version
    conn.last_seen_at = now
    db.add(
        AuditEvent(
            user_id=user.id,
            event_type="extension_exchanged",
            metadata_json={"connection_id": str(conn.id), "version": conn.version},
        )
    )
    await db.commit()

    access_token, expires_at = create_extension_access_token(
        user_id=user.id,
        email=user.email,
        connection_id=conn.id,
    )
    return ExtensionExchangeOut(
        access_token=access_token,
        expires_at=expires_at,
        connection_id=conn.id,
        user=UserSummary(
            id=user.id,
            email=user.email,
            verified=user.is_verified,
            onboarded=user.onboarded,
            created_at=user.created_at,
        ),
    )


@router.post("/heartbeat", response_model=ExtensionConnectionOut)
async def extension_heartbeat(
    payload: ExtensionHeartbeatIn,
    user: User = Depends(get_verified_user),
    db: AsyncSession = Depends(get_db),
) -> ExtensionConnectionOut:
    stmt = select(ExtensionConnection).where(
        ExtensionConnection.user_id == user.id,
        ExtensionConnection.revoked_at.is_(None),
    )
    if payload.connection_id:
        stmt = stmt.where(ExtensionConnection.id == payload.connection_id)
    stmt = stmt.order_by(ExtensionConnection.connected_at.desc()).limit(1)
    conn = (await db.execute(stmt)).scalar_one_or_none()
    if not conn:
        raise AppError(
            code="EXTENSION_REVOKED",
            message="Extension connection is inactive or revoked.",
            status_code=401,
        )

    conn.last_seen_at = datetime.now(timezone.utc)
    if payload.version.strip():
        conn.version = payload.version.strip()
    await db.commit()
    return ExtensionConnectionOut(
        connected=True,
        connection_id=conn.id,
        version=conn.version,
        connected_at=conn.connected_at,
        last_seen_at=conn.last_seen_at,
    )


@router.post("/revoke")
async def revoke_active_extension(
    user: User = Depends(get_verified_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    now = datetime.now(timezone.utc)
    active_conns = (
        await db.execute(
            select(ExtensionConnection).where(
                ExtensionConnection.user_id == user.id,
                ExtensionConnection.revoked_at.is_(None),
            )
        )
    ).scalars().all()
    for conn in active_conns:
        conn.revoked_at = now
    db.add(AuditEvent(user_id=user.id, event_type="extension_revoked", metadata_json={}))
    await db.commit()
    return {"status": "revoked"}


@router.delete("/{connection_id}")
async def revoke_extension_by_id(
    connection_id: UUID,
    user: User = Depends(get_verified_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    conn = (
        await db.execute(
            select(ExtensionConnection).where(
                ExtensionConnection.id == connection_id,
                ExtensionConnection.user_id == user.id,
            )
        )
    ).scalar_one_or_none()
    if not conn:
        raise AppError(
            code="extension_not_found",
            message="Extension connection not found.",
            status_code=404,
        )
    conn.revoked_at = datetime.now(timezone.utc)
    db.add(
        AuditEvent(
            user_id=user.id,
            event_type="extension_revoked",
            metadata_json={"connection_id": str(connection_id)},
        )
    )
    await db.commit()
    return {"status": "revoked"}

