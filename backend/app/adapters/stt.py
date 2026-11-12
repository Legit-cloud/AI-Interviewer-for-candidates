import asyncio
import base64
import io
import json
import logging
import math
import os
import struct
import wave
from collections.abc import Awaitable, Callable
from contextlib import suppress

import httpx

from app.core.config import Settings, get_settings
from app.core.languages import language_code

logger = logging.getLogger(__name__)

MAX_FRAME_BYTES = 256 * 1024  # 256 KB max single frame payload
MAX_BUFFER_BYTES = 2 * 1024 * 1024  # 2 MB bounded per-utterance RAM cap


def pcm16_rms(pcm_bytes: bytes) -> float:
    sample_count = len(pcm_bytes) // 2
    if sample_count == 0:
        return 0.0
    samples = struct.unpack(f"<{sample_count}h", pcm_bytes[: sample_count * 2])
    sq_sum = sum(s * s for s in samples)
    return math.sqrt(sq_sum / sample_count)


def pcm_to_wav_bytes(pcm_bytes: bytes, sample_rate: int = 16000, channels: int = 1) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(channels)
        wf.setsampwidth(2)  # PCM16 = 2 bytes per sample
        wf.setframerate(sample_rate)
        wf.writeframes(pcm_bytes)
    return buf.getvalue()


class AudioUtteranceBuffer:
    """In-memory bounded PCM buffer per audio source. Never touches disk."""

    def __init__(self, sample_rate: int = 16000, channels: int = 1) -> None:
        self.sample_rate = sample_rate
        self.channels = channels
        self._chunks: bytearray = bytearray()
        self.silence_streak: int = 0
        self.has_speech: bool = False

    def append_base64(self, payload_b64: str, sample_rate: int, channels: int) -> tuple[bool, bool]:
        """Returns (accepted, should_flush) without persisting raw audio."""
        raw = base64.b64decode(payload_b64, validate=True)
        if not raw or len(raw) > MAX_FRAME_BYTES:
            return False, False
        self.sample_rate = sample_rate
        self.channels = channels
        if len(self._chunks) + len(raw) > MAX_BUFFER_BYTES:
            excess = len(self._chunks) + len(raw) - MAX_BUFFER_BYTES
            del self._chunks[:excess]
        self._chunks.extend(raw)

        energy = pcm16_rms(raw)
        if energy >= 260.0:
            self.has_speech = True
            self.silence_streak = 0
        elif self.has_speech:
            self.silence_streak += 1

        # Fast end-of-turn flush (~250ms quiet after speech) or bounded 5s max chunk
        should_flush = (self.has_speech and self.silence_streak >= 1) or (
            len(self._chunks) >= sample_rate * channels * 2 * 5
        )
        return True, should_flush

    def drain_wav(self) -> bytes | None:
        if not self._chunks:
            return None
        pcm = bytes(self._chunks)
        sr, ch = self.sample_rate, self.channels
        self.clear()
        return pcm_to_wav_bytes(pcm, sample_rate=sr, channels=ch)

    def clear(self) -> None:
        self._chunks.clear()
        self.silence_streak = 0
        self.has_speech = False

    @property
    def byte_length(self) -> int:
        return len(self._chunks)


class DeepgramStreamingChannel:
    """Dedicated per-channel Deepgram Flux (/v2/listen) or Nova (/v1/listen) WebSocket client."""

    def __init__(
        self,
        api_key: str,
        model: str,
        source: str,
        on_transcript: Callable[[str, bool], Awaitable[None]],
        language: str = "en",
    ) -> None:
        self.api_key = api_key
        self.model = model or "flux-general-en"
        self.language = language or "en"
        self.source = source
        self.on_transcript = on_transcript
        self._ws: object | None = None
        self._recv_task: asyncio.Task[None] | None = None
        self._closed = False

    async def connect(self) -> bool:
        try:
            import websockets

            is_flux = self.model.startswith("flux")
            if is_flux:
                url = (
                    f"wss://api.deepgram.com/v2/listen"
                    f"?model={self.model}&encoding=linear16&sample_rate=16000"
                    f"&eot_threshold=0.7&eager_eot_threshold=0.45&eot_timeout_ms=3500"
                )
            else:
                url = (
                    f"wss://api.deepgram.com/v1/listen"
                    f"?model={self.model}&encoding=linear16&sample_rate=16000&channels=1"
                    f"&interim_results=true&endpointing=300&punctuate=true&smart_format=true"
                    f"&language={self.language}"
                )
            self._ws = await websockets.connect(
                url,
                additional_headers={"Authorization": f"Token {self.api_key}"},
            )
            self._recv_task = asyncio.create_task(self._read_loop())
            return True
        except Exception as exc:
            logger.warning("Deepgram streaming connect failed source=%s: %s", self.source, exc)
            return False

    async def send_pcm(self, pcm_bytes: bytes) -> None:
        if self._closed or self._ws is None or not pcm_bytes:
            return
        try:
            await self._ws.send(pcm_bytes)  # type: ignore[attr-defined]
        except Exception:
            pass

    async def close(self) -> None:
        self._closed = True
        if self._ws is not None:
            with suppress(Exception):
                await self._ws.send(json.dumps({"type": "CloseStream"}))  # type: ignore[attr-defined]
                await self._ws.close()  # type: ignore[attr-defined]
            self._ws = None
        if self._recv_task is not None:
            self._recv_task.cancel()
            with suppress(asyncio.CancelledError):
                await self._recv_task
            self._recv_task = None

    async def _read_loop(self) -> None:
        ws = self._ws
        if ws is None:
            return
        try:
            async for raw in ws:  # type: ignore[attr-defined]
                try:
                    msg = json.loads(raw)
                except Exception:
                    continue
                msg_type = str(msg.get("type") or "")
                # Deepgram Flux v2 events
                if msg_type == "EndOfTurn":
                    text = str(msg.get("transcript") or "").strip()
                    if text:
                        await self.on_transcript(text, True)
                    continue
                if msg_type in ("Update", "EagerEndOfTurn"):
                    text = str(msg.get("transcript") or "").strip()
                    if text:
                        await self.on_transcript(text, False)
                    continue
                # Deepgram Nova v1 Results fallback
                if msg_type == "Results":
                    alts = (msg.get("channel") or {}).get("alternatives") or []
                    text = str(alts[0].get("transcript") or "").strip() if alts else ""
                    if text:
                        is_final = bool(msg.get("speech_final") or msg.get("is_final"))
                        await self.on_transcript(text, is_final)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.info("Deepgram stream ended source=%s: %s", self.source, exc)


class STTProviderAdapter:
    """Server-side streaming/turn Speech-to-Text adapter supporting Deepgram Flux, OpenAI Whisper & Gemini."""

    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()

    def _whisper_key(self) -> str | None:
        """The key for OpenAI-style transcription. STT_API_KEY wins; for OpenAI itself the OpenAI key is reused."""
        s = self.settings
        if s.stt_api_key:
            return s.stt_api_key
        if s.openai_api_key and s.stt_base_url.startswith("https://api.openai.com"):
            return s.openai_api_key
        return None

    @property
    def active_provider(self) -> str:
        if "PYTEST_CURRENT_TEST" in os.environ or self.settings.env == "test":
            return "offline"
        s = self.settings
        if s.stt_provider == "deepgram" and s.deepgram_api_key:
            return "deepgram"
        if s.stt_provider == "gemini":
            return "gemini" if s.gemini_api_key else "offline"
        if s.stt_provider == "openai_compatible":
            if self._whisper_key():
                return "openai_compatible"
            return "gemini" if s.gemini_api_key else "offline"
        # Nothing chosen: use the best key that is there. Deepgram streams (fastest), then OpenAI Whisper, then Gemini.
        if s.deepgram_api_key:
            return "deepgram"
        if self._whisper_key():
            return "openai_compatible"
        if s.gemini_api_key:
            return "gemini"
        return "offline"

    @property
    def is_configured(self) -> bool:
        return self.active_provider != "offline"

    async def transcribe_wav(self, wav_bytes: bytes, language: str = "en") -> str | None:
        provider = self.active_provider
        if not wav_bytes or provider == "offline":
            return None
        if provider == "gemini":
            return await self._transcribe_gemini(wav_bytes, language)
        return await self._transcribe_openai_compatible(wav_bytes, language)

    async def _transcribe_openai_compatible(self, wav_bytes: bytes, language: str) -> str | None:
        url = f"{self.settings.stt_base_url.rstrip('/')}/audio/transcriptions"
        headers = {"Authorization": f"Bearer {self._whisper_key()}"}
        lang_code = language_code(language)
        try:
            async with httpx.AsyncClient(timeout=20.0) as client:
                res = await client.post(
                    url,
                    headers=headers,
                    files={"file": ("turn.wav", wav_bytes, "audio/wav")},
                    data={"model": self.settings.stt_model, "language": lang_code},
                )
                res.raise_for_status()
                text = (res.json().get("text") or "").strip()
                return text or None
        except Exception as exc:
            logger.warning("STT transcription request failed cleanly: %s", exc)
            return None

    async def _transcribe_gemini(self, wav_bytes: bytes, language: str) -> str | None:
        try:
            from google import genai
            from google.genai import types

            client = genai.Client(api_key=self.settings.gemini_api_key)
            models = [self.settings.gemini_model, "gemini-2.5-flash", "gemini-2.0-flash"]
            for model in dict.fromkeys(m for m in models if m):
                try:
                    response = await client.aio.models.generate_content(
                        model=model,
                        contents=[
                            types.Part.from_bytes(data=wav_bytes, mime_type="audio/wav"),
                            f"Transcribe the spoken words accurately in {language or 'English'}. Return only the spoken words. If there is no speech, return an empty string.",
                        ],
                    )
                    text = (response.text or "").strip()
                    if text:
                        return text
                except Exception as inner_exc:
                    logger.warning("Gemini STT model=%s failed: %s", model, inner_exc)
            return None
        except Exception as exc:
            logger.warning("Gemini STT request failed cleanly: %s", exc)
            return None


def get_stt_adapter() -> STTProviderAdapter:
    return STTProviderAdapter()

