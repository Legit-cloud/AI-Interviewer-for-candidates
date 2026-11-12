"""Answer generation for live interview questions.

The assistant writes the answer itself, in the candidate's first person, so the
candidate can say it out loud. It never returns coaching-style advice and never
returns canned placeholder text: when no AI provider is available the result is
explicitly marked unavailable.
"""

import re
from collections.abc import AsyncIterator, Sequence
from dataclasses import dataclass, field
from typing import Any

from app.adapters.llm import get_llm_adapter
from app.core.languages import language_name
from app.db.models import CandidateExperience, CandidateSkill, InterviewPreferences, JobDescription

_STOPWORDS = {
    "tell", "about", "time", "when", "have", "with", "your", "what", "would", "could", "from",
    "that", "this", "they", "them", "were", "been", "will", "into", "than", "then", "also",
    "how", "did", "does", "and", "the", "for", "you", "our", "are", "was", "can", "any",
}

_LENGTH_LINES = {"brief": 2, "standard": 3, "detailed": 4}

# Details that must come from the candidate's real context.
_NUMBER_RE = re.compile(r"\$\s?\d[\d,.]*\s?[kKmMbB]?|\b\d[\d,.]*\s?(?:%|x|k|m)\b|\b\d{2,}\b")
_EMPLOYER_RE = re.compile(
    r"\b(?:time|role|work|job|years?|while|was|were|worked|working|joined|left)\s+"
    r"(?:as [^.,;]{0,40}?\s)?at\s+"
    r"([A-Z][\w&.\-]*(?:\s+(?!(?:I|We|My|The|And|Where|When|Then)\b)[A-Z][\w&.\-]*){0,3})"
)


@dataclass
class AnswerResult:
    available: bool
    framework: str = "Direct"
    lines: list[str] = field(default_factory=list)
    key_points: list[str] = field(default_factory=list)
    source_label: str = ""
    caveat: str = ""
    unsupported_claims: list[str] = field(default_factory=list)
    reason: str = ""


def _tokens(text: str) -> set[str]:
    return {
        tok
        for tok in re.findall(r"[a-z0-9+#\.]{3,}", text.lower())
        if tok not in _STOPWORDS
    }


def rank_experiences(
    question_text: str,
    experiences: Sequence[CandidateExperience],
    limit: int = 4,
) -> list[CandidateExperience]:
    """Active CV items ordered by relevance to the question. Items with no overlap are excluded."""
    q_tokens = _tokens(question_text)
    scored: list[tuple[int, CandidateExperience]] = []
    for item in experiences:
        if not item.active:
            continue
        overlap = len(q_tokens & _tokens(f"{item.title} {item.organization} {item.summary}"))
        if overlap <= 0:
            continue
        scored.append((overlap * 2 + (1 if item.origin == "verified" else 0), item))
    scored.sort(key=lambda pair: pair[0], reverse=True)
    return [item for _, item in scored[:limit]]


_FRAMEWORK_HINTS = {
    "STAR": "Situation, Task, Action, Result: set the scene briefly, then what you did and what came of it.",
    "CAR": "Challenge, Action, Result: name the challenge, what you did, and the outcome.",
    "SOAR": "Situation, Obstacle, Action, Result: the situation, what stood in the way, what you did, the result.",
    "Problem / approach / trade-off": "State the problem, your approach, and the trade-off you accepted.",
    "Situation / decision / result": "The situation, the decision you made, and the result.",
}


def framework_hint(framework: str) -> str:
    return _FRAMEWORK_HINTS.get(framework, "")


def answer_language_for(prefs: InterviewPreferences) -> str:
    """The language answers are written in: the answer language if set, otherwise the interview language."""
    return language_name(getattr(prefs, "answer_language", "") or prefs.language)


def choose_framework(prefs: InterviewPreferences, question_type: str, question_text: str) -> str:
    framework = prefs.framework
    if framework == "Auto":
        behavioural = "behavior" in question_type.lower() or "tell me" in question_text.lower()
        return "STAR" if behavioural else "Direct"
    return framework


def target_lines(prefs: InterviewPreferences) -> int:
    return _LENGTH_LINES.get((prefs.length or "").lower(), 3)


def _split_sentences(line: str) -> list[str]:
    parts = re.split(r"(?<=[.!?])\s+", line.strip())
    return [p for p in parts if p]


def _allowed_corpus(
    question_text: str,
    experiences: Sequence[CandidateExperience],
    skills: Sequence[CandidateSkill],
    job: JobDescription | None,
    recent_turns: Sequence[str],
) -> str:
    chunks = [question_text, *recent_turns]
    for e in experiences:
        if e.active:
            chunks.extend([e.title, e.organization or "", e.dates_text or "", e.summary or ""])
    chunks.extend(s.name for s in skills)
    if job:
        chunks.extend([job.title or "", job.company or "", job.raw_text or ""])
    return " ".join(chunks).lower().replace(",", "")


def claim_check(lines: Sequence[str], allowed_text: str) -> tuple[list[str], list[str]]:
    """Drop sentences that state figures or employers not found in the candidate's context.

    Returns (kept_sentences, removed_sentences).
    """
    kept: list[str] = []
    removed: list[str] = []
    for line in lines:
        for sentence in _split_sentences(line):
            bad = False
            for match in _NUMBER_RE.findall(sentence):
                core = re.sub(r"[^\d.]", "", match).strip(".")
                if core and core not in allowed_text:
                    bad = True
                    break
            if not bad:
                for org in _EMPLOYER_RE.findall(sentence):
                    if org.strip().lower() not in allowed_text:
                        bad = True
                        break
            (removed if bad else kept).append(sentence)
    return kept, removed


def _parse_bullets(raw_text: str, limit: int) -> list[str]:
    lines: list[str] = []
    for raw in raw_text.splitlines():
        cleaned = re.sub(r"^\s*(?:[-*•]|\d+[.)])\s*", "", raw).strip()
        if cleaned:
            lines.append(cleaned[:280])
    if len(lines) <= 1 and raw_text.strip():
        parts = [p.strip() for p in re.split(r"(?<=[.!?])\s+", raw_text.strip()) if p.strip()]
        if len(parts) > 1:
            lines = [p[:280] for p in parts]
    return lines[:limit]


def _key_points(lines: Sequence[str]) -> list[str]:
    points: list[str] = []
    for line in lines[:4]:
        words = re.sub(r"[.!?]+$", "", line).split()
        points.append(" ".join(words[:7]))
    return points


def _source_label(
    answer_lines: Sequence[str],
    ranked: Sequence[CandidateExperience],
    job: JobDescription | None,
) -> str:
    answer_tokens = _tokens(" ".join(answer_lines))
    for item in ranked:
        item_tokens = _tokens(f"{item.title} {item.organization} {item.summary}")
        if len(answer_tokens & item_tokens) >= 2:
            where = f" at {item.organization}" if item.organization else ""
            return f"From your experience: {item.title}{where}"[:180]
    return f"Direct answer for {job.title}" if job and job.title else "Direct answer"


def _build_prompts(
    question_text: str,
    question_type: str,
    prefs: InterviewPreferences,
    framework: str,
    ranked: Sequence[CandidateExperience],
    skills: Sequence[CandidateSkill],
    job: JobDescription | None,
    recent_turns: Sequence[str],
    n_lines: int,
) -> tuple[str, str]:
    style = prefs.style if prefs.style in ("Direct", "Conversational", "Structured") else "Direct"
    system_prompt = (
        "You write the exact words a job candidate can say out loud to answer the interviewer's question, "
        "for any industry (marketing, design, 3D art, sales, operations, finance, healthcare, software and more). "
        f"Output ONLY {n_lines} short sentences, one per line, each starting with '- '. "
        "Write in the first person ('I' / 'we') as the candidate speaking. "
        "Give the answer itself. Never give advice about how to answer: no 'Start with', 'Mention', "
        "'Walk through', 'Explain how', 'You should', 'Talk about'. "
        "Answer tough questions directly even when the topic is not on the candidate's CV. "
        "Use a CV item only when it truly fits, and use only the facts given below. "
        "Never invent employers, job titles, dates, numbers or results. "
        "Use plain, conversational words. Do not use buzzwords such as leverage, synergy, delve, holistic, "
        "spearheaded, passionate or 'great question'. No preamble."
    )
    evidence = "\n".join(
        f"- {e.title} ({e.organization or 'Independent'}, {e.dates_text or 'dates not given'}): {(e.summary or '')[:220]}"
        for e in ranked
    ) or "None that match this question. Answer from general role knowledge without claiming personal history."
    skill_line = ", ".join(s.name for s in skills[:10]) or "None listed"
    job_line = f"{job.title} at {job.company}".strip() if job and job.title else "General interview"
    turns = "\n".join(recent_turns[-3:]) or "None"
    user_prompt = (
        f"Role: {job_line}\n"
        f"Answer style: {style}. Structure: {framework}"
        f"{' (' + framework_hint(framework) + ')' if framework_hint(framework) else ''}. "
        f"Write the answer in {answer_language_for(prefs)}.\n"
        f"Relevant background:\n{evidence}\n"
        f"Skills: {skill_line}\n"
        f"Recent conversation:\n{turns}\n"
        f"Interviewer question ({question_type}): {question_text}"
    )
    return system_prompt, user_prompt


async def stream_answer(
    question_text: str,
    question_type: str,
    prefs: InterviewPreferences,
    experiences: Sequence[CandidateExperience],
    skills: Sequence[CandidateSkill],
    job: JobDescription | None,
    recent_turns: Sequence[str] = (),
) -> AsyncIterator[tuple[str, Any]]:
    """Yields ('delta', text) chunks while the answer is generated, then ('done', AnswerResult).

    The final result is authoritative: it has passed the claim check, so clients must replace the
    streamed text with it.
    """
    llm = get_llm_adapter()
    if not llm.is_configured:
        yield ("done", AnswerResult(available=False, reason="AI_PROVIDER_UNAVAILABLE"))
        return

    framework = choose_framework(prefs, question_type, question_text)
    ranked = rank_experiences(question_text, experiences)
    n_lines = target_lines(prefs)
    system_prompt, user_prompt = _build_prompts(
        question_text, question_type, prefs, framework, ranked, skills, job, recent_turns, n_lines
    )

    collected: list[str] = []
    try:
        async for chunk in llm.stream_text(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            temperature=0.25,
            max_tokens=320,
        ):
            collected.append(chunk)
            yield ("delta", chunk)
    except Exception:
        yield ("done", AnswerResult(available=False, reason="AI_PROVIDER_ERROR"))
        return

    lines = _parse_bullets("".join(collected), limit=n_lines + 2)
    if not lines:
        yield ("done", AnswerResult(available=False, reason="AI_PROVIDER_ERROR"))
        return

    allowed = _allowed_corpus(question_text, experiences, skills, job, recent_turns)
    kept, removed = claim_check(lines, allowed)
    if not kept:
        yield (
            "done",
            AnswerResult(
                available=False,
                reason="UNSUPPORTED_CLAIMS_REMOVED",
                unsupported_claims=[r[:200] for r in removed],
            ),
        )
        return
    kept = kept[: max(n_lines, 2)]

    yield (
        "done",
        AnswerResult(
            available=True,
            framework=framework[:40],
            lines=[k[:280] for k in kept],
            key_points=_key_points(kept),
            source_label=_source_label(kept, ranked, job),
            caveat="Some unverified details were removed from this answer." if removed else "",
            unsupported_claims=[r[:200] for r in removed],
        ),
    )


async def generate_answer(
    question_text: str,
    question_type: str,
    prefs: InterviewPreferences,
    experiences: Sequence[CandidateExperience],
    skills: Sequence[CandidateSkill],
    job: JobDescription | None,
    recent_turns: Sequence[str] = (),
) -> AnswerResult:
    """Non-streaming wrapper used by the REST endpoint."""
    result = AnswerResult(available=False, reason="AI_PROVIDER_UNAVAILABLE")
    async for kind, payload in stream_answer(
        question_text, question_type, prefs, experiences, skills, job, recent_turns
    ):
        if kind == "done":
            result = payload
    return result
