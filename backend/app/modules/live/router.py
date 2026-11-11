import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.adapters.stt import AudioUtteranceBuffer, get_stt_adapter
from app.core.config import get_settings
from app.core.database import get_db
from app.core.errors import AppError
from app.core.security import decode_session_ws_token
from app.db.models import (
    CandidateExperience,
    CandidateSkill,
    GeneratedSuggestion,
    InterviewPreferences,
    InterviewSession,
    JobDescription,
    TranscriptSegment,
)
from app.modules.live.question_detector import QuestionDetector
from app.modules.sessions.grounding import generate_grounded_suggestion
from app.modules.sessions.router import finalize_session_row

logger = logging.getLogger(__name__)
router = APIRouter(tags=["live"])


def _event(event_type: str, session_id: UUID, **fields: Any) -> dict[str, Any]:
    return {
        "event_id": f"evt_{uuid4().hex[:12]}",
        "session_id": str(session_id),
        "type": event_type,
        **fields,
    }


def _elapsed_label(started_at: datetime) -> str:
    base = started_at if started_at.tzinfo else started_at.replace(tzinfo=timezone.utc)
    secs = max(0, int((datetime.now(timezone.utc) - base).total_seconds()))
    mins, rem = divmod(secs, 60)
    return f"{mins:02d}:{rem:02d}"


async def _handle_completed_utterance(
    websocket: WebSocket,
    db: AsyncSession,
    session_row: InterviewSession,
    detector: QuestionDetector,
    utterance_text: str,
    source: str,
    segment_seq: int,
    item_id: str,
) -> int:
    text = utterance_text.strip()
    if not text:
        return segment_seq

    speaker = "You" if source == "microphone" else "Interviewer"
    ts_label = _elapsed_label(session_row.started_at)
    segment_seq += 1

    if session_row.transcript_retained:
        db.add(
            TranscriptSegment(
                session_id=session_row.id,
                user_id=session_row.user_id,
                sequence=segment_seq,
                speaker=speaker,
                text=text[:4000],
                timestamp_label=ts_label,
            )
        )
        await db.commit()

    await websocket.send_json(
        _event(
            "transcript.completed",
            session_row.id,
            item_id=item_id,
            source=source,
            speaker=speaker,
            sequence=segment_seq,
            timestamp=ts_label,
            text=text,
        )
    )

    detected = detector.inspect(text, speaker=speaker)
    if not detected:
        return segment_seq

    question_id = f"q_{uuid4().hex[:10]}"
    await websocket.send_json(
        _event(
            "question.detected",
            session_row.id,
            question_id=question_id,
            kind=detected.kind,
            text=detected.text,
            fingerprint=detected.fingerprint,
        )
    )
    await websocket.send_json(
        _event("suggestion.started", session_row.id, question_id=question_id)
    )

    prefs = await db.get(InterviewPreferences, session_row.user_id)
    if not prefs:
        prefs = InterviewPreferences(user_id=session_row.user_id)
    job = await db.get(JobDescription, session_row.job_id) if session_row.job_id else None
    experiences = (
        await db.execute(
            select(CandidateExperience).where(CandidateExperience.user_id == session_row.user_id)
        )
    ).scalars().all()
    skills = (
        await db.execute(
            select(CandidateSkill).where(CandidateSkill.user_id == session_row.user_id)
        )
    ).scalars().all()

    try:
        framework, outline, evidence_ref, caveat = await generate_grounded_suggestion(
            question_text=detected.text,
            question_type=detected.kind,
            prefs=prefs,
            experiences=experiences,
            skills=skills,
            job=job,
        )
    except Exception:
        await websocket.send_json(
            _event(
                "session.degraded",
                session_row.id,
                code="SUGGESTION_TIMEOUT",
                message="Suggestion generation delayed. You can continue or stop safely.",
            )
        )
        return segment_seq

    suggestion = GeneratedSuggestion(
        session_id=session_row.id,
        user_id=session_row.user_id,
        question_text=detected.text,
        question_type=detected.kind,
        asked_at=ts_label,
        framework=framework,
        outline=outline,
        evidence_ref=evidence_ref,
        caveat=caveat,
        feedback="none",
    )
    db.add(suggestion)
    await db.commit()
    await db.refresh(suggestion)

    await websocket.send_json(
        _event(
            "suggestion.ready",
            session_row.id,
            question_id=question_id,
            suggestion={
                "id": str(suggestion.id),
                "question_text": suggestion.question_text,
                "question_type": suggestion.question_type,
                "asked_at": suggestion.asked_at,
                "framework": suggestion.framework,
                "outline": list(suggestion.outline or []),
                "evidence_ref": suggestion.evidence_ref,
                "caveat": suggestion.caveat,
            },
        )
    )
    return segment_seq


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
        user_id = decode_session_ws_token(token, expected_session_id=session_id)
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

    settings = get_settings()
    stt = get_stt_adapter()
    detector = QuestionDetector()
    buffers: dict[str, AudioUtteranceBuffer] = {
        "tab": AudioUtteranceBuffer(),
        "microphone": AudioUtteranceBuffer(),
    }
    last_sequences: dict[str, int] = {"tab": 0, "microphone": 0}
    active_sources: list[str] = ["tab"]
    segment_seq = len(
        (
            await db.execute(
                select(TranscriptSegment.id).where(TranscriptSegment.session_id == session_id)
            )
        ).scalars().all()
    )
    paused = session_row.state == "paused"
    stopped_cleanly = False

    expires_at = datetime.now(timezone.utc) + timedelta(minutes=settings.max_session_minutes)
    await websocket.send_json(
        _event(
            "session.ready",
            session_id,
            state=session_row.state,
            expires_at=expires_at.isoformat(),
            stt_mode=settings.stt_provider,
        )
    )

    try:
        while True:
            msg = await websocket.receive_json()
            if not isinstance(msg, dict):
                continue
            msg_type = str(msg.get("type") or "")

            if msg_type == "client.heartbeat":
                await websocket.send_json(
                    _event(
                        "server.heartbeat",
                        session_id,
                        at=datetime.now(timezone.utc).isoformat(),
                    )
                )
                continue

            if msg_type == "session.configure":
                requested_sources = msg.get("sources") or ["tab"]
                active_sources = [
                    str(s) for s in requested_sources if s in ("tab", "microphone")
                ] or ["tab"]
                if session_row.state == "ready":
                    session_row.state = "listening"
                    await db.commit()
                paused = False
                for src in active_sources:
                    await websocket.send_json(
                        _event("capture.state", session_id, source=src, state="listening")
                    )
                continue

            if msg_type == "session.pause":
                paused = True
                for buf in buffers.values():
                    buf.clear()
                session_row.state = "paused"
                await db.commit()
                for src in active_sources:
                    await websocket.send_json(
                        _event("capture.state", session_id, source=src, state="paused")
                    )
                continue

            if msg_type == "session.resume":
                paused = False
                session_row.state = "listening"
                await db.commit()
                for src in active_sources:
                    await websocket.send_json(
                        _event("capture.state", session_id, source=src, state="listening")
                    )
                continue

            if msg_type == "audio.frame":
                if paused:
                    continue
                src = str(msg.get("source") or "tab")
                if src not in buffers:
                    continue
                try:
                    seq = int(msg.get("sequence", 0))
                except (TypeError, ValueError):
                    continue
                if seq <= last_sequences[src]:
                    # Idempotent duplicate/out-of-order ignore per PRD §19.3
                    continue
                last_sequences[src] = seq

                payload_b64 = str(msg.get("payload") or "")
                sample_rate = int(msg.get("sample_rate") or 16000)
                channels = int(msg.get("channels") or 1)
                try:
                    accepted, should_flush = buffers[src].append_base64(
                        payload_b64, sample_rate, channels
                    )
                except Exception:
                    await websocket.send_json(
                        _event(
                            "session.degraded",
                            session_id,
                            code="INVALID_AUDIO_FRAME",
                            message="Dropped malformed audio frame cleanly.",
                        )
                    )
                    continue

                if not accepted:
                    continue

                item_id = f"turn_{src}_{seq}"
                if should_flush:
                    wav_bytes = buffers[src].drain_wav()
                    if wav_bytes and stt.is_configured:
                        prefs = await db.get(InterviewPreferences, user_id)
                        lang = prefs.language if prefs else "English"
                        text = await stt.transcribe_wav(wav_bytes, language=lang)
                        if text:
                            segment_seq = await _handle_completed_utterance(
                                websocket, db, session_row, detector, text, src, segment_seq, item_id
                            )
                else:
                    await websocket.send_json(
                        _event("transcript.delta", session_id, item_id=item_id, source=src, text="")
                    )
                continue

            if msg_type in ("audio.flush", "utterance.commit", "transcript.simulate"):
                src = str(msg.get("source") or "tab")
                direct_text = str(msg.get("text") or msg.get("utterance") or "").strip()
                item_id = f"turn_{uuid4().hex[:8]}"

                if direct_text:
                    segment_seq = await _handle_completed_utterance(
                        websocket, db, session_row, detector, direct_text, src, segment_seq, item_id
                    )
                elif src in buffers:
                    wav_bytes = buffers[src].drain_wav()
                    if wav_bytes and stt.is_configured:
                        prefs = await db.get(InterviewPreferences, user_id)
                        lang = prefs.language if prefs else "English"
                        text = await stt.transcribe_wav(wav_bytes, language=lang)
                        if text:
                            segment_seq = await _handle_completed_utterance(
                                websocket, db, session_row, detector, text, src, segment_seq, item_id
                            )
                continue

            if msg_type == "session.stop":
                for src, buf in buffers.items():
                    wav_bytes = buf.drain_wav()
                    if wav_bytes and stt.is_configured:
                        prefs = await db.get(InterviewPreferences, user_id)
                        text = await stt.transcribe_wav(wav_bytes, language=prefs.language if prefs else "English")
                        if text:
                            segment_seq = await _handle_completed_utterance(
                                websocket, db, session_row, detector, text, src, segment_seq, f"turn_{uuid4().hex[:8]}"
                            )
                    buf.clear()

                await finalize_session_row(session_row, db)
                await db.commit()
                stopped_cleanly = True
                await websocket.send_json(
                    _event(
                        "session.finalized",
                        session_id,
                        retained_transcript=session_row.transcript_retained,
                    )
                )
                await websocket.close(code=1000)
                return

    except WebSocketDisconnect:
        logger.info("Live WebSocket disconnected session_id=%s clean=%s", session_id, stopped_cleanly)
    finally:
        for buf in buffers.values():
            buf.clear()
        if not stopped_cleanly and session_row.state != "ended":
            session_row.state = "paused"
            try:
                await db.commit()
            except Exception:
                pass

