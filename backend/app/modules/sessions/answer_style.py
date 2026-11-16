"""How a good spoken interview answer sounds, and a check that the model actually delivered one.

The candidate reads these words aloud, live, while the model is still writing them. So the answer has to be
speakable (short sentences, no lists), answer-first, specific, and honest. Voice-agent practice is to say the
output is spoken and to show good and bad contrasts rather than ask for "a natural tone", and interview
coaching converges on: answer first, one concrete example, roughly 60 to 90 seconds spoken at most.
"""

import re
from dataclasses import dataclass
from typing import Sequence


@dataclass(frozen=True)
class Budget:
    sentences: int
    max_words: int
    spoken: str


_BUDGETS = {
    "brief": Budget(3, 55, "about 15 to 20 seconds"),
    "standard": Budget(5, 95, "about 30 to 40 seconds"),
    "detailed": Budget(7, 160, "about 50 to 60 seconds"),
}


def budget_for(length: str | None) -> Budget:
    return _BUDGETS.get((length or "").strip().lower(), _BUDGETS["standard"])


STYLE_NOTES = {
    "Direct": "Get to the point in the first sentence. No warm-up.",
    "Conversational": "Sound relaxed, like explaining it to a colleague over coffee. Contractions everywhere, a little informal.",
    "Structured": "Keep a clear order (the answer, then the example, then what came of it) but say it in plain sentences. Never use labels like 'Situation:'.",
}

KIND_GUIDANCE = {
    "Behavioral": "Tell it as one short true story from the background: what was going on, what you did yourself (say 'I' for your own part, not 'we'), and what came of it. One story, not three.",
    "Situational": "Say what you would do and why, in the order you would actually do it. Name the one trade-off or risk you would watch.",
    "Role task": "Give the approach straight away, then the reasoning that shows you know the craft: the specific tools, checks or measures a practitioner would name, and one trade-off.",
    "General": "Answer the question asked in the first sentence. Then add one concrete detail that backs it up.",
    "Coding": "Say the idea in plain words first, then what it costs (time and space) in one sentence. Name one edge case you would check.",
}


def kind_guidance(question_type: str, question_text: str) -> str:
    lower = question_text.lower()
    if any(p in lower for p in ("tell me about yourself", "walk me through your resume", "walk me through your background", "introduce yourself")):
        return "Cover where you are now, how you got here, and why this role, in that order. Keep each part to a sentence or two and tie it to this job."
    if any(p in lower for p in ("why do you want", "why this company", "why this role", "why are you interested")):
        return "Be specific about this company and role using the job details given, and connect them to something real from the background. No flattery."
    return KIND_GUIDANCE.get(question_type, KIND_GUIDANCE["General"])


CODE_MARKER = "CODE:"


def code_instructions() -> str:
    return (
        "\n\nThis is a coding question. First write the spoken part: how you would solve it, in plain sentences, "
        "then the time and space cost. Then on its own line write exactly "
        f"{CODE_MARKER} and after it only the code: a working solution of at most 25 lines, in the language the "
        "interviewer used (or Python if none was named), with no markdown fences and no commentary outside short comments."
    )


def split_code(text: str) -> tuple[str, str]:
    """Separates the spoken answer from the code block the model was asked to put after `CODE:`."""
    if CODE_MARKER not in text:
        return text, ""
    spoken, _, code = text.partition(CODE_MARKER)
    code = re.sub(r"^\s*```[a-zA-Z0-9_+-]*\n?", "", code)
    code = re.sub(r"\n?```\s*$", "", code).strip("\n")
    return spoken, "\n".join(code.splitlines()[:40])


# Style contrasts only. They show how it should sound; the model is told never to reuse their facts.
STYLE_EXAMPLES = """\
Too generic: "I'm a results-driven professional with a passion for leveraging data to drive impactful outcomes."
Human: "Most of my time goes into onboarding emails that nobody was opening. The fun part is when a small change, like sending the first one the minute someone signs up, actually moves the numbers."

Too generic: "There are several factors to consider, including scalability, performance and maintainability."
Human: "I'd start with how often it's read versus written, because that decides most of it. If it's mostly reads I'd cache in front of the database and accept slightly stale data."
"""

BANNED_WORDS = (
    "leverage, synergy, delve, holistic, spearhead, passionate, fast-paced, dynamic, cutting-edge, robust, seamless, "
    "game-changer, results-driven, detail-oriented, team player, think outside the box, go the extra mile, "
    "hit the ground running, 'great question', 'in today's world', 'at the end of the day'"
)


def system_prompt(budget: Budget) -> str:
    return (
        "You write what a job candidate will say out loud, in real time, to answer the interviewer's last question. "
        "They read your words as you write them, so it must sound like a capable person talking, not like writing. "
        f"Write about {budget.sentences} sentences, {budget.max_words} words at most ({budget.spoken} spoken), "
        "one sentence per line, plain text only.\n\n"
        "How it should sound:\n"
        "- First person, as the candidate. Contractions. Short sentences, mostly under 20 words, with the odd longer one. "
        "Concrete nouns and active verbs.\n"
        "- Answer first. The first sentence answers the question or takes a position. Then one concrete example or "
        "detail. No warm-up, no repeating the question, no closing summary.\n"
        "- Specifics beat adjectives: name the tool, the step, the situation, as written in the background.\n"
        "- Say 'I' for what the candidate did themselves. Use the vocabulary of the role, at the seniority of the role, "
        "like a competent peer and not a textbook.\n"
        "- No lists, bullets, numbering, headings, labels, markdown, em dashes or symbols. It will be read aloud.\n"
        "- If the interview so far shows an example was just used, use a different one.\n"
        "- If the question is ambiguous, answer the most likely meaning. Do not ask back.\n\n"
        "Honesty:\n"
        "- Use only facts in the background. Never invent employers, titles, dates, numbers, results or tools.\n"
        "- If the background does not cover the question, do not claim you did it. Say how you would approach it "
        "('I'd start by...'), or make one honest bridge to related experience that is in the background "
        "('I haven't run that directly, but...').\n"
        "- Never give advice about how to answer ('Start with', 'You should', 'Mention', 'Explain how').\n\n"
        f"Never use these words or phrases: {BANNED_WORDS}.\n\n"
        "Two contrasts for tone only. Never reuse their facts:\n"
        f"{STYLE_EXAMPLES}\n"
        "Reply with the answer sentences only."
    )


# ---------------------------------------------------------------- checking what came back
_BANNED_RE = re.compile(
    r"\b(great question|good question|that'?s an? (?:interesting|excellent|great|good) question|passionate about|"
    r"i'?m passionate|leverag\w*|synerg\w*|delv\w*|holistic\w*|spearhead\w*|fast[- ]paced|dynamic environment|"
    r"cutting[- ]edge|robust|seamless\w*|game[- ]chang\w*|results[- ]driven|detail[- ]oriented|team player|"
    r"think outside the box|go the extra mile|hit the ground running|at the end of the day|in today'?s)\b",
    re.IGNORECASE,
)
_DISCLAIMER_RE = re.compile(r"\b(as an ai|i hope (?:this|that) helps|i hope (?:this|that) answers|certainly!|absolutely!|of course!)", re.IGNORECASE)
_COACHING_RE = re.compile(
    r"^(start|begin) (by|with)\b|^mention\b|^you should\b|^talk about\b|^explain how\b|^walk through\b|"
    r"^set the scene\b|^highlight\b|^tie it back\b|^share a\b|^you could\b|^try to\b",
    re.IGNORECASE,
)
_LABEL_RE = re.compile(r"^\s*(situation|task|action|result|challenge|obstacle|problem|approach|trade-?off|decision)\s*[:\-–]\s*", re.IGNORECASE)
_MARKDOWN_RE = re.compile(r"[*_#`>]+")


@dataclass
class StyleReport:
    severe: list[str]
    minor: list[str]

    @property
    def needs_retry(self) -> bool:
        return bool(self.severe)


def word_count(lines: Sequence[str]) -> int:
    return sum(len(line.split()) for line in lines)


def style_issues(lines: Sequence[str], budget: Budget) -> StyleReport:
    severe: list[str] = []
    minor: list[str] = []
    for line in lines:
        if _COACHING_RE.search(line.strip()):
            severe.append(f"gives advice instead of the answer: “{line[:60]}”")
        if _DISCLAIMER_RE.search(line):
            severe.append(f"assistant-style filler: “{line[:60]}”")
        for hit in {m.group(0).lower() for m in _BANNED_RE.finditer(line)}:
            severe.append(f"uses the banned phrase “{hit}”")
        if _LABEL_RE.search(line) or _MARKDOWN_RE.search(line) or "—" in line or re.match(r"^\s*(\d+[.)]|[-•])\s", line):
            minor.append("written-only formatting")
    if word_count(lines) > budget.max_words * 1.4:
        minor.append("too long to say comfortably")
    return StyleReport(severe=sorted(set(severe)), minor=sorted(set(minor)))


def clean_lines(lines: Sequence[str], budget: Budget) -> list[str]:
    """Removes written-only formatting and trims to the length budget. Never adds words."""
    out: list[str] = []
    for line in lines:
        text = _MARKDOWN_RE.sub("", line).replace(" — ", ", ").replace("—", ", ").replace(" – ", ", ")
        text = re.sub(r"^\s*(\d+[.)]|[-•])\s+", "", text)
        text = _LABEL_RE.sub("", text)
        text = re.sub(r"\s+", " ", text).strip()
        if text:
            out.append(text)
    out = out[: budget.sentences]
    while len(out) > 2 and word_count(out) > budget.max_words * 1.4:
        out.pop()
    return out


def retry_note(report: StyleReport) -> str:
    return (
        "Your previous draft broke these rules: "
        + "; ".join(report.severe[:4])
        + ". Rewrite it as plain spoken sentences from the candidate, answer first, with a concrete detail from the "
        "background, and none of those phrases."
    )
