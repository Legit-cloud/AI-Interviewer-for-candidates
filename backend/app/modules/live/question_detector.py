import re
import time
from collections.abc import Awaitable, Callable
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
    # coding tasks are usually phrased as instructions, not questions
    "write a function", "write a program", "write some code", "write code", "write a query", "implement ", "code a ",
)

_STOPWORDS = {"the", "a", "an", "to", "of", "in", "on", "for", "with", "you", "your", "and", "or", "it", "is", "are"}


@dataclass
class LLMVerdict:
    is_question: bool
    question: str = ""
    kind: str = ""


@dataclass
class DetectedQuestion:
    text: str
    kind: str
    fingerprint: str
    source: str = "heuristic"  # "heuristic" or "llm"


QUESTION_KINDS = ("Behavioral", "Situational", "Role task", "Coding", "General")

_CODING_CUES = (
    "write a function", "write a program", "write some code", "write code", "write a query", "sql query", "implement ",
    "algorithm", "leetcode", "time complexity", "space complexity", "big o", "linked list", "binary tree", "binary search",
    "data structure", "pseudocode", "write a regex", "reverse a ", "debug this", "what does this code", "code a ", "two sum",
)
# Openers of small talk that never needs the model (checked only when there is no question mark or cue).
_CHATTY_PREFIXES = (
    "sounds good", "thanks for", "thank you", "great", "perfect", "awesome", "nice to meet", "welcome",
    "no problem", "good morning", "good afternoon", "good evening", "okay", "alright", "all right",
    "yeah", "yes", "right", "sure", "cool", "got it", "makes sense", "hi ", "hello", "hey ",
)
_AUDIO_CHECK = ("hear me", "see my screen", "recording", "ready to start")


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
        if any(p in lower for p in _CODING_CUES):
            return "Coding"
        if any(p in lower for p in ("tell me about a time", "describe a time", "conflict", "disagree", "failure", "mistake", "proud of")):
            return "Behavioral"
        if any(p in lower for p in ("imagine ", "what would you do", "suppose ", "how would you handle")):
            return "Situational"
        if any(p in lower for p in ("launch", "campaign", "audit", "optimize", "3d", "render", "shader", "design", "budget", "strategy", "architecture", "system", "pipeline", "sql", "code")):
            return "Role task"
        return "General"

    def triage(self, utterance: str, speaker: str = "Interviewer") -> str:
        """Cheap first look: 'question' (clear), 'skip' (clearly not), or 'unsure' (worth asking the LLM)."""
        text = re.sub(r"\s+", " ", utterance).strip()
        if not text or speaker.lower() in ("you", "candidate", "microphone"):
            return "skip"
        cleaned = re.sub(r"[^\w\s]", "", text.lower()).strip()
        if cleaned in _CHATTY_EXACT:
            return "skip"
        lower = text.lower()
        words = cleaned.split()
        is_question_mark = text.endswith("?")
        has_prompt_cue = any(cue in lower for cue in _PROMPT_CUES)
        if is_question_mark and len(words) <= 5 and any(k in lower for k in _AUDIO_CHECK):
            return "skip"
        if is_question_mark or has_prompt_cue:
            return "question" if len(words) >= 4 or is_question_mark else "skip"
        if lower.startswith(_CHATTY_PREFIXES):
            return "skip"
        if len(words) < 5 or any(k in lower for k in _AUDIO_CHECK):
            return "skip"
        return "unsure"

    def register(self, text: str, kind: str, source: str = "heuristic") -> DetectedQuestion | None:
        """Applies the duplicate window and records the question. None means it was a recent repeat."""
        cleaned = re.sub(r"[^\w\s]", "", text.lower()).strip()
        tokens = self._normalize_tokens(text)
        now = time.monotonic()
        self._recent = [(ts, toks, fp) for ts, toks, fp in self._recent if now - ts <= self.dedupe_window_seconds]
        for _, prev_tokens, _ in self._recent:
            if not tokens or not prev_tokens:
                continue
            if len(tokens & prev_tokens) / max(1, len(tokens | prev_tokens)) >= 0.8:
                return None
        fingerprint = "-".join(sorted(list(tokens))[:8]) or cleaned[:32]
        self._recent.append((now, tokens, fingerprint))
        return DetectedQuestion(text=text, kind=kind, fingerprint=fingerprint, source=source)

    async def detect(
        self,
        utterance: str,
        speaker: str = "Interviewer",
        classify: Callable[[str], Awaitable[LLMVerdict | None]] | None = None,
    ) -> DetectedQuestion | None:
        """Heuristics first; only unclear utterances are passed to `classify` (the LLM)."""
        verdict = self.triage(utterance, speaker)
        if verdict == "question":
            return self.inspect(utterance, speaker)
        if verdict != "unsure" or classify is None:
            return None
        text = re.sub(r"\s+", " ", utterance).strip()
        llm = await classify(text)
        if llm is None or not llm.is_question:
            return None
        question = llm.question or text
        return self.register(question, llm.kind or self._classify(question.lower()), source="llm")

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
        if is_question_mark and len(words) <= 5 and any(k in lower for k in _AUDIO_CHECK):
            return None

        return self.register(text, self._classify(lower))
