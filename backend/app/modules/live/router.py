import asyncio
import logging
from uuid import UUID

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.errors import AppError
from app.core.security import decode_session_ws_claims
from app.db.models import InterviewSession
from app.modules.live.session import LiveSessionError, live_registry

logger = logging.getLogger(__name__)
router = APIRouter(tags=["live"])


@router.websocket("/v1/live/{session_id}")
async def live_session_ws(
    websocket: WebSocket,
    session_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> None:
    await websocket.accept()
    token = websocket.query_params.get("token")

    if not token:
        try:
            first_msg = await asyncio.wait_for(websocket.receive_json(), timeout=5.0)
            if isinstance(first_msg, dict) and first_msg.get("type") == "session.auth":
                token = str(first_msg.get("token") or "")
        except Exception:
            await websocket.close(code=4401, reason="Authentication token missing.")
            return

    if not token:
        await websocket.close(code=4401, reason="Authentication token missing.")
        return

    try:
        user_id, role = decode_session_ws_claims(token, expected_session_id=session_id)
    except AppError as exc:
        await websocket.close(code=4403 if exc.status_code == 403 else 4401, reason=exc.code)
        return

    session_row = (
        await db.execute(
            select(InterviewSession).where(
                InterviewSession.id == session_id,
                InterviewSession.user_id == user_id,
            )
        )
    ).scalar_one_or_none()
    if not session_row:
        await websocket.close(code=4404, reason="SESSION_NOT_FOUND")
        return
    if session_row.state == "ended":
        await websocket.close(code=4409, reason="SESSION_ENDED")
        return

    live = live_registry.get_or_create(session_id, user_id)
    try:
        await live.join(
            websocket,
            role,
            db,
            last_event_id=websocket.query_params.get("last_event_id"),
        )
    except LiveSessionError as exc:
        if not live.clients:
            live_registry.drop(session_id)
        await websocket.close(code=exc.close_code, reason=exc.reason)
        return
    await db.rollback()  # release the read transaction opened while joining

    try:
        while True:
            msg = await websocket.receive_json()
            if not isinstance(msg, dict):
                continue
            if await live.handle(websocket, role, msg, db):
                return
    except WebSocketDisconnect:
        logger.info("Live WebSocket disconnected session_id=%s role=%s", session_id, role)
    finally:
        await live.leave(websocket, db)
