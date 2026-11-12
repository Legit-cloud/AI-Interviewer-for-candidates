"""Post-session review.

Two parts. The numbers (what was asked, which required skills came up, how much of the CV was used) are always
computed from the saved session. The coaching summary is written by the AI on request, from what was asked, the
answers Vren suggested and, if the transcript was kept, what the candidate actually said. If the AI is not
available the numbers are still returned and the review says so; nothing is invented.
"""

import re
from collections import Counter
from datetime import datetime, timezone
from typing import Any, Sequence

from app.adapters.llm import get_llm_adapter
from app.db.models import CandidateExperience, GeneratedSuggestion, InterviewSession, JobDescription, TranscriptSegment


def _words(text: str) -> set[str]:
    return set(re.findall(r"[a-z0-9+#.]{2,}", text.lower()))


def compute_stats(
    suggestions: Sequence[GeneratedSuggestion],
    segments: Sequence[TranscriptSegment],
    job: JobDescription | None,
    experiences: Sequence[CandidateExperience],
) -> dict[str, Any]:
    by_type = Counter(s.question_type or "General" for s in suggestions)
    spoken = " ".join([*(s.question_text for s in suggestions), *(" ".join(s.outline or []) for s in suggestions), *(g.text for g in segments)])
    spoken_words = _words(spoken)

    required = list(job.required_skills or []) if job else []
    covered = [r for r in required if _words(r) and _words(r) <= spoken_words]
    from_cv = sum(1 for s in suggestions if (s.evidence_ref or "").startswith("From your experience"))
    cited = {s.evidence_ref for s in suggestions if (s.evidence_ref or "").startswith("From your experience")}
    unused = [
        f"{e.title}{' at ' + e.organization if e.organization else ''}"
        for e in experiences
        if e.active and not any(e.title in (c or "") for c in cited)
    ]
    return {
        "questions": len(suggestions),
        "by_type": dict(by_type),
        "answers_from_cv": from_cv,
        "answers_direct": max(0, len(suggestions) - from_cv),
        "required_skills": required,
        "skills_covered": covered,
        "skills_not_covered": [r for r in required if r not in covered],
        "cv_not_used": unused[:6],
        "useful": sum(1 for s in suggestions if s.feedback == "helpful"),
        "not_useful": sum(1 for s in suggestions if s.feedback == "not_relevant"),
    }


def _candidate_replies(suggestions: Sequence[GeneratedSuggestion], segments: Sequence[TranscriptSegment]) -> dict[int, str]:
    """What the candidate said after each question, if the transcript was kept and the microphone was on."""
    replies: dict[int, str] = {}
    if not segments:
        return replies
    ordered = sorted(segments, key=lambda g: g.sequence)
    for i, s in enumerate(suggestions):
        idx = next((n for n, g in enumerate(ordered) if g.speaker == "Interviewer" and g.text.strip()[:60] == s.question_text.strip()[:60]), None)
        if idx is None:
            continue
        said: list[str] = []
        for g in ordered[idx + 1 :]:
            if g.speaker == "Interviewer":
                break
            said.append(g.text)
        if said:
            replies[i] = " ".join(said)[:900]
    return replies


_SYSTEM = (
    "You are a kind, honest interview coach reviewing one finished interview. Be specific and short. "
    "Base every point on what is shown. Never invent things the candidate said or did. "
    "Write plainly, in simple words, as if talking to the candidate. "
    'Reply with JSON only: {"summary": "<2 to 3 sentences on how it went>", "strengths": ["<up to 3>"], '
    '"improvements": ["<up to 3, each something they can do next time>"], '
    '"per_question": [{"index": <number>, "note": "<one sentence on this question>"}], '
    '"next_steps": ["<up to 3 things to practise>"]}.'
)


def _clean_list(value: Any, limit: int, width: int = 220) -> list[str]:
    if not isinstance(value, list):
        return []
    return [" ".join(str(v).split())[:width] for v in value if isinstance(v, str) and v.strip()][:limit]


def parse_ai_review(result: Any, question_count: int) -> dict[str, Any] | None:
    if not isinstance(result, dict) or not isinstance(result.get("summary"), str) or not result["summary"].strip():
        return None
    notes = []
    for item in result.get("per_question") or []:
        if isinstance(item, dict) and isinstance(item.get("index"), int) and 0 <= item["index"] < question_count and isinstance(item.get("note"), str):
            notes.append({"index": item["index"], "note": " ".join(item["note"].split())[:240]})
    return {
        "summary": " ".join(result["summary"].split())[:600],
        "strengths": _clean_list(result.get("strengths"), 3),
        "improvements": _clean_list(result.get("improvements"), 3),
        "per_question": notes,
        "next_steps": _clean_list(result.get("next_steps"), 3),
    }


async def build_review(
    row: InterviewSession,
    suggestions: Sequence[GeneratedSuggestion],
    segments: Sequence[TranscriptSegment],
    job: JobDescription | None,
    experiences: Sequence[CandidateExperience],
) -> dict[str, Any]:
    stats = compute_stats(suggestions, segments, job, experiences)
    review: dict[str, Any] = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "stats": stats,
        "ai": None,
        "ai_available": False,
        "used_transcript": bool(segments),
    }
    if not suggestions:
        return review

    llm = get_llm_adapter()
    if not llm.is_configured:
        return review

    replies = _candidate_replies(suggestions, segments)
    lines = []
    for i, s in enumerate(suggestions):
        lines.append(f"[{i}] Question ({s.question_type}): {s.question_text}")
        lines.append(f"    Suggested answer: {' '.join(s.outline or [])[:400]}")
        if i in replies:
            lines.append(f"    What the candidate actually said: {replies[i]}")
    user = (
        f"Role: {(job.title + ' at ' + job.company) if job and job.title else 'general interview'}\n"
        f"Required skills: {', '.join(stats['required_skills']) or 'not given'}\n"
        f"Required skills that never came up: {', '.join(stats['skills_not_covered']) or 'none'}\n"
        f"The candidate's own words were {'available' if replies else 'not recorded'} for this review.\n\n"
        + "\n".join(lines)
    )
    parsed = parse_ai_review(await llm.complete_json(_SYSTEM, user, temperature=0.3, max_tokens=900), len(suggestions))
    if parsed:
        review["ai"] = parsed
        review["ai_available"] = True
    return review
