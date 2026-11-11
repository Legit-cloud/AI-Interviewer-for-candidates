from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_verified_user
from app.core.errors import AppError
from app.core.security import generate_opaque_token, hash_token
from app.db.models import AuditEvent, ExtensionConnection, User
from app.modules.extensions.schemas import (
    ExtensionConnectionOut,
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

