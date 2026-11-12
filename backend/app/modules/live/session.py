"""Shared live-session room.

One `LiveSession` exists per active interview session. It owns the audio buffers, the question
detector and the speech-to-text channels, and fans every event out to all attached clients:

* ``capture`` client: normally the extension. May send audio and control messages.
* ``display`` client: the Side Panel or the web live page. Receives events, and may only send
  heartbeat, pause, resume, stop and ``transcript.simulate`` (a typed test question).

At most one capture client is attached at a time.
"""

import asyncio
import base64
import logging
import time
from collections import deque
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID, uuid4

from fastapi import WebSocket
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.adapters.llm import get_llm_adapter
from app.adapters.stt import AudioUtteranceBuffer, DeepgramStreamingChannel, get_stt_adapter
from app.core.config import get_settings
from app.core.languages import language_code
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
from app.modules.live.question_llm import QuestionClassifier
from app.modules.sessions.grounding import AnswerResult, stream_answer
from app.modules.sessions.router import finalize_session_row

logger = logging.getLogger(__name__)

DISPLAY_ALLOWED = {
    "client.heartbeat",
    "session.pause",
    "session.resume",
    "session.stop",
    "transcript.simulate",
}
REPLAYABLE = {
    "transcript.completed",
    "question.detected",
    "answer.started",
    "answer.ready",
    "answer.unavailable",
    "answer.cancelled",
    "capture.state",
    "session.degraded",
}
HISTORY_LIMIT = 300


class LiveSessionError(Exception):
    def __init__(self, close_code: int, reason: str) -> None:
        super().__init__(reason)
        self.close_code = close_code
        self.reason = reason


def make_event(event_type: str, session_id: UUID, **fields: Any) -> dict[str, Any]:
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


@dataclass
class _Client:
    role: str


class LiveSession:
    def __init__(self, session_id: UUID, user_id: UUID) -> None:
        self.session_id = session_id
        self.user_id = user_id
        self.clients: dict[WebSocket, _Client] = {}
        self.detector = QuestionDetector()
        self.classifier = QuestionClassifier()
        self.buffers = {"tab": AudioUtteranceBuffer(), "microphone": AudioUtteranceBuffer()}
        self.last_sequences = {"tab": 0, "microphone": 0}
        self.active_sources: list[str] = ["tab"]
        # Phone or in-person interviews: the microphone is hearing the interviewer, not the candidate.
        self.room_mode = False
        self.segment_seq = 0
        self.paused = False
        self.stopped = False
        self.recent_turns: list[str] = []
        self.dg_channels: dict[str, DeepgramStreamingChannel] = {}
        self.history: deque[dict[str, Any]] = deque(maxlen=HISTORY_LIMIT)
        self.expires_at: datetime | None = None
        self.lock = asyncio.Lock()
        self._capture_db: AsyncSession | None = None
        self._answer_task: asyncio.Task[None] | None = None
        self._answer_qid = ""
        # Detection and answering run in the background so audio and controls are never held up by the model.
        self._queue: asyncio.Queue[tuple[str, str, str, list[str]]] = asyncio.Queue(maxsize=20)
        self._worker: asyncio.Task[None] | None = None
        self._bind = None  # database engine, so background work can open its own sessions

    # ------------------------------------------------------------------ fan-out
    async def broadcast(self, event: dict[str, Any]) -> None:
        if event["type"] in REPLAYABLE:
            self.history.append(event)
        for ws in list(self.clients):
            try:
                await ws.send_json(event)
            except Exception:
                self.clients.pop(ws, None)

    async def emit(self, event_type: str, **fields: Any) -> None:
        await self.broadcast(make_event(event_type, self.session_id, **fields))

    async def _send_to(self, ws: WebSocket, event: dict[str, Any]) -> None:
        try:
            await ws.send_json(event)
        except Exception:
            self.clients.pop(ws, None)

    # ------------------------------------------------------------------ membership
    async def join(
        self,
        ws: WebSocket,
        role: str,
        db: AsyncSession,
        last_event_id: str | None = None,
    ) -> None:
        row = await db.get(InterviewSession, self.session_id)
        if row is None:
            raise LiveSessionError(4404, "SESSION_NOT_FOUND")
        if row.state == "ended" or self.stopped:
            raise LiveSessionError(4409, "SESSION_ENDED")
        settings = get_settings()
        started = row.started_at if row.started_at.tzinfo else row.started_at.replace(tzinfo=timezone.utc)
        self.expires_at = started + timedelta(minutes=settings.max_session_minutes)
        if datetime.now(timezone.utc) >= self.expires_at:
            raise LiveSessionError(4408, "SESSION_EXPIRED")
        if role == "capture" and any(c.role == "capture" for c in self.clients.values()):
            raise LiveSessionError(4409, "CAPTURE_CLIENT_ALREADY_CONNECTED")

        self._bind = self._bind or db.bind
        first_join = not self.clients
        self.clients[ws] = _Client(role=role)
        if role == "capture":
            self._capture_db = db
        if first_join:
            self.paused = row.state == "paused"
            self.segment_seq = len(
                (
                    await db.execute(
                        select(TranscriptSegment.id).where(TranscriptSegment.session_id == self.session_id)
                    )
                ).scalars().all()
            )

        await self._send_to(
            ws,
            make_event(
                "session.ready",
                self.session_id,
                state=row.state,
                role=role,
                expires_at=self.expires_at.isoformat(),
                stt_mode=get_stt_adapter().active_provider,
                answers_ready=get_llm_adapter().is_configured,
            ),
        )
        if last_event_id:
            replay = False
            for evt in list(self.history):
                if replay:
                    await self._send_to(ws, evt)
                elif evt["event_id"] == last_event_id:
                    replay = True

    async def leave(self, ws: WebSocket, db: AsyncSession) -> None:
        client = self.clients.pop(ws, None)
        if client is None:
            return
        if client.role == "capture":
            await self._close_capture_resources()
            if not self.stopped:
                row = await db.get(InterviewSession, self.session_id)
                if row is not None and row.state != "ended":
                    row.state = "paused"
                    try:
                        await db.commit()
                    except Exception:
                        pass
                self.paused = True
                await self.emit("capture.state", source="tab", state="paused")
        if not self.clients:
            await self._cancel_tasks()
            live_registry.drop(self.session_id)

    async def _close_capture_resources(self) -> None:
        for ch in self.dg_channels.values():
            await ch.close()
        self.dg_channels.clear()
        for buf in self.buffers.values():
            buf.clear()
        self._capture_db = None

    async def kick_capture(self) -> None:
        for ws, client in list(self.clients.items()):
            if client.role == "capture":
                self.clients.pop(ws, None)
                try:
                    await ws.close(code=4403, reason="PAIRING_REVOKED")
                except Exception:
                    pass
        await self._close_capture_resources()

    # ------------------------------------------------------------------ message dispatch
    async def handle(self, ws: WebSocket, role: str, msg: dict[str, Any], db: AsyncSession) -> bool:
        """Process one client message. Returns True when the session has been finalised."""
        msg_type = str(msg.get("type") or "")
        if role == "display" and msg_type not in DISPLAY_ALLOWED:
            return False

        async with self.lock:
            try:
                return await self._dispatch(ws, msg_type, msg, db)
            finally:
                # Long-lived sockets must not hold an open DB transaction between messages.
                try:
                    await db.rollback()
                except Exception:
                    pass

    async def _dispatch(self, ws: WebSocket, msg_type: str, msg: dict[str, Any], db: AsyncSession) -> bool:
        if self.stopped:
            return True
        if self.expires_at and datetime.now(timezone.utc) >= self.expires_at:
            await self._finalize(db, expired=True)
            return True

        if msg_type == "client.heartbeat":
            await self._send_to(
                ws,
                make_event("server.heartbeat", self.session_id, at=datetime.now(timezone.utc).isoformat()),
            )
        elif msg_type == "session.configure":
            await self._configure(db, msg)
        elif msg_type == "session.pause":
            await self._set_paused(db, True)
        elif msg_type == "session.resume":
            await self._set_paused(db, False)
        elif msg_type == "audio.frame":
            await self._audio_frame(db, msg)
        elif msg_type in ("audio.flush", "utterance.commit", "transcript.simulate"):
            await self._commit_or_flush(db, msg)
        elif msg_type == "session.stop":
            await self._finalize(db)
            return True
        return False

    # ------------------------------------------------------------------ handlers
    async def _configure(self, db: AsyncSession, msg: dict[str, Any]) -> None:
        requested = msg.get("sources") or ["tab"]
        self.active_sources = [str(s) for s in requested if s in ("tab", "microphone")] or ["tab"]
        self.room_mode = bool(msg.get("room")) and self.active_sources == ["microphone"]
        row = await db.get(InterviewSession, self.session_id)
        if row is not None and row.state == "ready":
            row.state = "listening"
            await db.commit()
        self.paused = False

        settings = get_settings()
        stt = get_stt_adapter()
        if stt.active_provider == "deepgram" and settings.deepgram_api_key:
            prefs = await db.get(InterviewPreferences, self.user_id)
            lang = language_code(prefs.language if prefs else "English")
            # flux-general-en only understands English; switch to a multilingual model otherwise.
            model = settings.deepgram_model
            if lang != "en" and model.startswith("flux"):
                model = "nova-3"
            for src in self.active_sources:
                if src in self.dg_channels:
                    continue
                channel = DeepgramStreamingChannel(
                    api_key=settings.deepgram_api_key,
                    model=model,
                    source=src,
                    on_transcript=lambda text, is_final, s=src: self._on_deepgram(s, text, is_final),
                    language=lang,
                )
                if await channel.connect():
                    self.dg_channels[src] = channel

        for src in self.active_sources:
            await self.emit("capture.state", source=src, state="listening")

    async def _on_deepgram(self, src: str, text: str, is_final: bool) -> None:
        if self.paused or self.stopped:
            return
        if not is_final:
            await self.emit("transcript.delta", item_id=f"live_{src}", source=src, text=text)
            return
        db = self._capture_db
        if db is None:
            return
        async with self.lock:
            try:
                await self._complete_utterance(db, text, src, f"dg_{src}_{uuid4().hex[:8]}")
            finally:
                try:
                    await db.rollback()
                except Exception:
                    pass

    async def _set_paused(self, db: AsyncSession, paused: bool) -> None:
        self.paused = paused
        if paused:
            for buf in self.buffers.values():
                buf.clear()
        row = await db.get(InterviewSession, self.session_id)
        if row is not None and row.state != "ended":
            row.state = "paused" if paused else "listening"
            await db.commit()
        for src in self.active_sources:
            await self.emit("capture.state", source=src, state="paused" if paused else "listening")

    async def _audio_frame(self, db: AsyncSession, msg: dict[str, Any]) -> None:
        if self.paused:
            return
        src = str(msg.get("source") or "tab")
        if src not in self.buffers:
            return
        try:
            seq = int(msg.get("sequence", 0))
        except (TypeError, ValueError):
            return
        if seq <= self.last_sequences[src]:
            return  # duplicate or out-of-order frame (PRD §19.3)
        self.last_sequences[src] = seq

        payload_b64 = str(msg.get("payload") or "")
        sample_rate = int(msg.get("sample_rate") or 16000)
        channels = int(msg.get("channels") or 1)

        if src in self.dg_channels:
            try:
                pcm_raw = base64.b64decode(payload_b64, validate=True)
            except Exception:
                pcm_raw = b""
            if pcm_raw:
                await self.dg_channels[src].send_pcm(pcm_raw)
            return

        try:
            accepted, should_flush = self.buffers[src].append_base64(payload_b64, sample_rate, channels)
        except Exception:
            await self.emit("session.degraded", code="INVALID_AUDIO_FRAME", message="Dropped malformed audio frame cleanly.")
            return
        if not accepted:
            return

        item_id = f"turn_{src}_{seq}"
        if should_flush:
            await self._transcribe_buffer(db, src, item_id)
        else:
            await self.emit("transcript.delta", item_id=item_id, source=src, text="")

    async def _transcribe_buffer(self, db: AsyncSession, src: str, item_id: str) -> None:
        stt = get_stt_adapter()
        wav_bytes = self.buffers[src].drain_wav()
        if not wav_bytes or not stt.is_configured:
            return
        prefs = await db.get(InterviewPreferences, self.user_id)
        text = await stt.transcribe_wav(wav_bytes, language=prefs.language if prefs else "English")
        if text:
            await self._complete_utterance(db, text, src, item_id)

    async def _commit_or_flush(self, db: AsyncSession, msg: dict[str, Any]) -> None:
        src = str(msg.get("source") or "tab")
        direct_text = str(msg.get("text") or msg.get("utterance") or "").strip()
        item_id = f"turn_{uuid4().hex[:8]}"
        if direct_text:
            await self._complete_utterance(db, direct_text, src if src in self.buffers else "tab", item_id)
        elif src in self.buffers:
            await self._transcribe_buffer(db, src, item_id)

    async def _finalize(self, db: AsyncSession, expired: bool = False) -> None:
        self.stopped = True
        for ch in self.dg_channels.values():
            await ch.close()
        self.dg_channels.clear()
        if not expired:
            for src in list(self.buffers):
                await self._transcribe_buffer(db, src, f"turn_{uuid4().hex[:8]}")
        for buf in self.buffers.values():
            buf.clear()
        await self._drain_for_stop()

        row = await db.get(InterviewSession, self.session_id)
        retained = False
        if row is not None:
            await finalize_session_row(row, db)
            await db.commit()
            retained = row.transcript_retained
        if expired:
            await self.emit("session.expired", message="This session reached its time limit.")
        await self.emit("session.finalized", retained_transcript=retained)
        self.history.clear()
        for ws in list(self.clients):
            try:
                await ws.close(code=1000)
            except Exception:
                pass
        self.clients.clear()
        live_registry.drop(self.session_id)

    # ------------------------------------------------------------------ transcript -> answer
    async def _complete_utterance(self, db: AsyncSession, utterance_text: str, source: str, item_id: str) -> None:
        text = utterance_text.strip()
        if not text:
            return
        row = await db.get(InterviewSession, self.session_id)
        if row is None:
            return

        # Per-channel attribution: tab audio is the interviewer, microphone is the candidate.
        speaker = "You" if source == "microphone" and not self.room_mode else "Interviewer"
        ts_label = _elapsed_label(row.started_at)
        self.segment_seq += 1
        self.recent_turns.append(f"{speaker}: {text[:220]}")
        if len(self.recent_turns) > 6:
            del self.recent_turns[:-4]

        if row.transcript_retained:
            db.add(
                TranscriptSegment(
                    session_id=row.id,
                    user_id=row.user_id,
                    sequence=self.segment_seq,
                    speaker=speaker,
                    text=text[:4000],
                    timestamp_label=ts_label,
                )
            )
            await db.commit()

        await self.emit(
            "transcript.completed",
            item_id=item_id,
            source=source,
            speaker=speaker,
            sequence=self.segment_seq,
            timestamp=ts_label,
            text=text,
        )

        # Earlier turns give the classifier context (the current turn is already the last entry).
        self._enqueue_detection(text, speaker, ts_label, self.recent_turns[:-1])

    # ------------------------------------------------------------------ background detection and answers
    def _enqueue_detection(self, text: str, speaker: str, ts_label: str, earlier: list[str]) -> None:
        if self._worker is None or self._worker.done():
            self._worker = asyncio.create_task(self._detection_loop())
        try:
            self._queue.put_nowait((text, speaker, ts_label, list(earlier)))
        except asyncio.QueueFull:
            logger.warning("Detection queue full; dropping an utterance session_id=%s", self.session_id)

    async def _detection_loop(self) -> None:
        """Looks at one utterance at a time, in order. A found question starts its answer without waiting for it."""
        while True:
            text, speaker, ts_label, earlier = await self._queue.get()
            try:
                detected = await self.detector.detect(
                    text, speaker=speaker, classify=lambda t, e=earlier: self.classifier.classify(t, e)
                )
                if not detected:
                    continue
                question_id = f"q_{uuid4().hex[:10]}"
                await self.emit(
                    "question.detected",
                    question_id=question_id,
                    kind=detected.kind,
                    text=detected.text,
                    fingerprint=detected.fingerprint,
                    detection=detected.source,
                )
                # A newer question interrupts an answer that is still being written.
                if self._answer_task and not self._answer_task.done():
                    self._answer_task.cancel()
                    await self.emit("answer.cancelled", question_id=self._answer_qid)
                self._answer_qid = question_id
                self._answer_task = asyncio.create_task(
                    self._answer_job(question_id, detected.text, detected.kind, ts_label)
                )
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Question detection failed session_id=%s", self.session_id)

    async def _answer_job(self, question_id: str, text: str, kind: str, ts_label: str) -> None:
        started = time.monotonic()
        await self.emit("answer.started", question_id=question_id, question_text=text, question_type=kind)
        # The job has its own database session: the socket's session is busy with audio and controls.
        async with AsyncSession(bind=self._bind, expire_on_commit=False) as sdb:
            row = await sdb.get(InterviewSession, self.session_id)
            if row is None:
                return
            await self._generate_answer(sdb, row, question_id, text, kind, ts_label, started)

    async def _cancel_tasks(self) -> None:
        for task in (self._worker, self._answer_task):
            if task and not task.done():
                task.cancel()
        for task in (self._worker, self._answer_task):
            if task:
                try:
                    await task
                except (asyncio.CancelledError, Exception):
                    pass

    async def _drain_for_stop(self) -> None:
        """On stop: give a running answer a few seconds to be saved, then cancel whatever is left."""
        if self._worker and not self._worker.done():
            self._worker.cancel()
        task = self._answer_task
        if task and not task.done():
            try:
                await asyncio.wait_for(asyncio.shield(task), timeout=3.0)
            except (asyncio.TimeoutError, asyncio.CancelledError, Exception):
                task.cancel()
        await self._cancel_tasks()

    async def _generate_answer(
        self,
        db: AsyncSession,
        row: InterviewSession,
        question_id: str,
        question_text: str,
        question_kind: str,
        ts_label: str,
        started: float | None = None,
    ) -> None:
        started = started or time.monotonic()
        first_word: float | None = None
        prefs = await db.get(InterviewPreferences, row.user_id) or InterviewPreferences(user_id=row.user_id)
        job = await db.get(JobDescription, row.job_id) if row.job_id else None
        experiences = (
            await db.execute(select(CandidateExperience).where(CandidateExperience.user_id == row.user_id))
        ).scalars().all()
        skills = (
            await db.execute(select(CandidateSkill).where(CandidateSkill.user_id == row.user_id))
        ).scalars().all()

        result: AnswerResult | None = None
        try:
            async for kind, payload in stream_answer(
                question_text=question_text,
                question_type=question_kind,
                prefs=prefs,
                experiences=experiences,
                skills=skills,
                job=job,
                recent_turns=list(self.recent_turns),
            ):
                if kind == "delta":
                    if first_word is None:
                        first_word = time.monotonic() - started
                    await self.emit("answer.delta", question_id=question_id, delta=str(payload))
                elif kind == "done":
                    result = payload
        except Exception:
            logger.exception("Answer generation failed session_id=%s", self.session_id)
            result = AnswerResult(available=False, reason="AI_PROVIDER_ERROR")

        if result is None or not result.available:
            await self.emit(
                "answer.unavailable",
                question_id=question_id,
                reason=(result.reason if result else "AI_PROVIDER_ERROR"),
                message="Answer unavailable for this question. You can continue or stop safely.",
            )
            return

        suggestion = GeneratedSuggestion(
            session_id=row.id,
            user_id=row.user_id,
            question_text=question_text,
            question_type=question_kind,
            asked_at=ts_label,
            framework=result.framework,
            outline=result.lines,
            evidence_ref=result.source_label,
            caveat=result.caveat,
            feedback="none",
        )
        db.add(suggestion)
        await db.commit()
        await db.refresh(suggestion)

        total = time.monotonic() - started
        timing = {
            "first_word_ms": int((first_word if first_word is not None else total) * 1000),
            "total_ms": int(total * 1000),
        }
        logger.info(
            "Answer timing session=%s kind=%s first_word_ms=%d total_ms=%d",
            self.session_id, question_kind, timing["first_word_ms"], timing["total_ms"],
        )
        await self.emit(
            "answer.ready",
            question_id=question_id,
            answer={
                "id": str(suggestion.id),
                "question_text": question_text,
                "question_type": question_kind,
                "asked_at": ts_label,
                "framework": result.framework,
                "answer": " ".join(result.lines),
                "lines": list(result.lines),
                "key_points": list(result.key_points),
                "source_label": result.source_label,
                "caveat": result.caveat,
                "timing": timing,
            },
        )


class LiveRegistry:
    def __init__(self) -> None:
        self._sessions: dict[UUID, LiveSession] = {}

    def get_or_create(self, session_id: UUID, user_id: UUID) -> LiveSession:
        live = self._sessions.get(session_id)
        if live is None:
            live = LiveSession(session_id, user_id)
            self._sessions[session_id] = live
        return live

    def drop(self, session_id: UUID) -> None:
        self._sessions.pop(session_id, None)

    async def kick_capture(self, session_id: UUID) -> None:
        live = self._sessions.get(session_id)
        if live is not None:
            await live.kick_capture()


live_registry = LiveRegistry()
