"""Is sound getting through, and is it being turned into text? One small answer per source, once a second.

States, from worst to best:
  no_audio  nothing has arrived from this source for a few seconds (capture stalled or nothing is playing)
  quiet     sound is arriving but nobody is speaking
  no_stt    speech is arriving but there is no speech-to-text set up to read it
  hearing   speech just started; text is not back yet
  problem   speech has been arriving for a while and no text came back (the speech-to-text is failing)
  ok        speech is being turned into text
"""

import math
from dataclasses import dataclass

SPEECH_RMS = 260.0  # same threshold the turn detector uses
STALE_AFTER = 3.0  # seconds without any frame -> no_audio
QUIET_AFTER = 4.0  # seconds without speech -> quiet
TEXT_FRESH = 8.0  # text this recent means "ok"
PROBLEM_AFTER = 8.0  # speech this long with no text -> problem


def level_percent(rms: float) -> int:
    """0 to 100, on a curve so quiet speech still moves the meter."""
    return max(0, min(100, int(math.sqrt(max(rms, 0.0)) * 1.6)))


@dataclass
class SourceStats:
    frame_at: float = 0.0
    loud_at: float = 0.0
    speech_since: float = 0.0
    text_at: float = 0.0
    level: int = 0

    def on_frame(self, now: float, rms: float) -> None:
        self.frame_at = now
        self.level = level_percent(rms)
        if rms >= SPEECH_RMS:
            if now - self.loud_at > QUIET_AFTER:
                self.speech_since = now  # a new stretch of speech
            self.loud_at = now

    def on_text(self, now: float) -> None:
        self.text_at = now

    def state(self, now: float, stt_ready: bool) -> str:
        if self.frame_at == 0.0 or now - self.frame_at > STALE_AFTER:
            return "no_audio"
        if self.loud_at == 0.0 or now - self.loud_at > QUIET_AFTER:
            return "quiet"
        if not stt_ready:
            return "no_stt"
        if self.text_at and now - self.text_at <= TEXT_FRESH and self.text_at >= self.speech_since - TEXT_FRESH:
            return "ok"
        if now - self.speech_since > PROBLEM_AFTER:
            return "problem"
        return "hearing"

    def report(self, now: float, stt_ready: bool) -> dict:
        return {
            "level": self.level if now - self.frame_at <= STALE_AFTER else 0,
            "state": self.state(now, stt_ready),
            "text_ago": round(now - self.text_at, 1) if self.text_at else None,
        }
