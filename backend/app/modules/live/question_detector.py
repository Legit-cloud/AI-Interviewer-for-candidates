import re
import time
from dataclasses import dataclass

_CHATTY_EXACT = {
    "sounds good",
    "can you hear me",
    "can you hear me okay",
    "yes i can hear you",
    "thank you",
    "thanks for joining",
    "nice to meet you",
    "let us get started",
    "lets get started",
    "got it",
    "makes sense",
    "okay cool",
    "great",
}

_PROMPT_CUES = (
    "tell me about",
    "walk me through",
    "how would you",
    "how did you",
    "how do you",
    "what would you",
    "describe a time",
    "give me an example",
    "explain how",
    "what is your approach",
    "why did you",
    "imagine ",
    "suppose ",
    "let us say ",
    "what trade-offs",
    "how have you",
    "have you ever",
)

_STOPWORDS = {"the", "a", "an", "to", "of", "in", "on", "for", "with", "you", "your", "and", "or", "it", "is", "are"}


@dataclass
class DetectedQuestion:
    text: str
    kind: str
    fingerprint: str


class QuestionDetector:
    """Detects real interviewer questions/tasks and suppresses chatter or recent duplicates."""

    def __init__(self, dedupe_window_seconds: float = 90.0) -> None:
        self.dedupe_window_seconds = dedupe_window_seconds
        self._recent: list[tuple[float, set[str], str]] = []

    def _normalize_tokens(self, text: str) -> set[str]:
        return {
            tok
            for tok in re.findall(r"[a-z0-9]{2,}", text.lower())
            if tok not in _STOPWORDS
        }

    def _classify(self, lower: str) -> str:
        if any(p in lower for p in ("tell me about a time", "describe a time", "conflict", "disagree", "failure", "mistake", "proud of")):
            return "Behavioral"
        if any(p in lower for p in ("imagine ", "what would you do", "suppose ", "how would you handle")):
            return "Situational"
        if any(p in lower for p in ("launch", "campaign", "audit", "optimize", "3d", "render", "shader", "design", "budget", "strategy", "architecture", "system", "pipeline", "sql", "code")):
            return "Role task"
        return "General"

    def inspect(self, utterance: str, speaker: str = "Interviewer") -> DetectedQuestion | None:
        text = re.sub(r"\s+", " ", utterance).strip()
        if not text:
            return None
        # Only inspect interviewer/tab speech unless explicitly marked
        if speaker.lower() in ("you", "candidate", "microphone"):
            return None

        cleaned = re.sub(r"[^\w\s]", "", text.lower()).strip()
        if cleaned in _CHATTY_EXACT:
            return None

        lower = text.lower()
        words = cleaned.split()
        is_question_mark = text.endswith("?")
        has_prompt_cue = any(cue in lower for cue in _PROMPT_CUES)

        if len(words) < 4 and not is_question_mark:
            return None
        if not is_question_mark and not has_prompt_cue:
            return None
        if is_question_mark and len(words) <= 5 and any(k in lower for k in ("hear me", "see my screen", "recording", "ready to start")):
            return None

        tokens = self._normalize_tokens(text)
        now = time.monotonic()
        self._recent = [(ts, toks, fp) for ts, toks, fp in self._recent if now - ts <= self.dedupe_window_seconds]

        for _, prev_tokens, _ in self._recent:
            if not tokens or not prev_tokens:
                continue
            overlap = len(tokens & prev_tokens) / max(1, len(tokens | prev_tokens))
            if overlap >= 0.8:
                return None

        fingerprint = "-".join(sorted(list(tokens))[:8]) or cleaned[:32]
        self._recent.append((now, tokens, fingerprint))
        return DetectedQuestion(text=text, kind=self._classify(lower), fingerprint=fingerprint)

