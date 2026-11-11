import base64
import io
import logging
import math
import struct
import wave

import httpx

from app.core.config import Settings, get_settings

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

        # Auto-flush after ~2 silent frames following speech or once buffer >= ~6s
        should_flush = (self.has_speech and self.silence_streak >= 2) or (
            len(self._chunks) >= sample_rate * channels * 2 * 6
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


class STTProviderAdapter:
    """Server-side streaming/turn Speech-to-Text adapter supporting OpenAI-compatible & Gemini."""

    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()

    @property
    def is_configured(self) -> bool:
        if self.settings.stt_provider == "offline":
            return False
        if self.settings.stt_provider == "gemini":
            return bool(self.settings.gemini_api_key)
        return bool(self.settings.stt_api_key)

    async def transcribe_wav(self, wav_bytes: bytes, language: str = "en") -> str | None:
        if not wav_bytes or not self.is_configured:
            return None
        if self.settings.stt_provider == "gemini":
            return await self._transcribe_gemini(wav_bytes, language)
        return await self._transcribe_openai_compatible(wav_bytes, language)

    async def _transcribe_openai_compatible(self, wav_bytes: bytes, language: str) -> str | None:
        url = f"{self.settings.stt_base_url.rstrip('/')}/audio/transcriptions"
        headers = {"Authorization": f"Bearer {self.settings.stt_api_key}"}
        lang_code = language[:2].lower() if language else "en"
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
            response = await client.aio.models.generate_content(
                model="gemini-3.8-flash",
                contents=[
                    types.Part.from_bytes(data=wav_bytes, mime_type="audio/wav"),
                    f"Transcribe this spoken audio accurately in {language or 'English'}. Return only the spoken words, or empty string if silent.",
                ],
            )
            text = (response.text or "").strip()
            return text or None
        except Exception as exc:
            logger.warning("Gemini STT request failed cleanly: %s", exc)
            return None


def get_stt_adapter() -> STTProviderAdapter:
    return STTProviderAdapter()

