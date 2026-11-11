import re
from collections.abc import AsyncIterator
from typing import Any, Sequence

from app.adapters.llm import get_llm_adapter
from app.db.models import CandidateExperience, CandidateSkill, InterviewPreferences, JobDescription

_STOPWORDS = {
    "tell",
    "about",
    "time",
    "when",
    "have",
    "with",
    "your",
    "what",
    "would",
    "could",
    "from",
    "that",
    "this",
    "they",
    "them",
}


def _tokens(text: str) -> set[str]:
    return {
        tok
        for tok in re.findall(r"[a-z0-9+#\.]{3,}", text.lower())
        if tok not in _STOPWORDS
    }


def _direct_domain_outline(
    question_text: str,
    question_type: str,
    job: JobDescription | None,
    bridge_item: CandidateExperience | None,
) -> list[str]:
    lower = question_text.lower()
    role_title = job.title if job else "this role"

    if any(k in lower for k in ("campaign", "marketing", "roas", "cac", "seo", "paid", "ads", "social", "funnel", "audience")):
        bullets = [
            "I start by locking in one measurable goal, like qualified signups or lower acquisition cost, and mapping the audience's main pain point before picking channels.",
            "I launch two or three distinct creative hooks on a tight test budget, track early click-to-conversion drop-off, and cut underperformers within the first few days.",
            f"Once an angle proves consistent payback, I shift budget onto that winner and verify attribution cleanly for {role_title}.",
        ]
    elif any(k in lower for k in ("3d", "render", "shader", "topology", "uv", "lighting", "blender", "maya", "unreal", "texture", "poly", "rig")):
        bullets = [
            "I lock down target engine limits first, including poly budget, texture memory, shader complexity, and target frame rate, before building high-detail geometry.",
            "I block out the silhouette, keep topology and UVs packed cleanly, and bake fine surface detail into normal maps instead of heavy meshes.",
            "If frame rate drops, I profile shader instruction count and light complexity directly in-engine, then simplify expensive transparencies and shadow-casting lights first.",
        ]
    elif any(k in lower for k in ("client", "stakeholder", "budget", "sales", "deadline", "disagree", "conflict", "pushback")):
        bullets = [
            "When a timeline tightens or someone pushes back, I first clarify whether the real constraint is the launch date, budget, or risk tolerance.",
            "Instead of arguing preferences, I propose two clear options: ship the highest-impact core scope on schedule, or move lower-priority items to a fast follow-up.",
            "Once we agree on the trade-off and success metric, I send a short written recap so everyone stays aligned.",
        ]
    elif "behavior" in question_type.lower() or any(k in lower for k in ("tell me about a time", "describe a", "walk me through")):
        bullets = [
            "We had a clear bottleneck slowing down delivery and results, so I stepped in to own the fix end to end.",
            "Instead of waiting for a full overhaul, I isolated the biggest friction point first, shipped a focused fix, and aligned the team on clear ownership.",
            "That unblocked the team right away and left a simpler process we kept using afterward.",
        ]
    else:
        bullets = [
            "My direct approach is to solve the core bottleneck simply first rather than over-complicating things upfront.",
            f"For {role_title}, I check the constraints, put the cleanest working solution in place with clear verification, and measure the real result before scaling.",
            "That keeps quality reliable while moving fast under real deadlines.",
        ]

    if bridge_item:
        bridge_note = (
            f"In my previous work as {bridge_item.title} at {bridge_item.organization}"
            if bridge_item.organization
            else f"In my previous work as {bridge_item.title}"
        )
        summary = bridge_item.summary.strip()
        bullets[-1] = f"{bridge_note}, I applied this directly: {summary[:120]}" if summary else f"{bridge_note}, I handled similar problems hands-on."

    return bullets[:4]


async def generate_grounded_suggestion(
    question_text: str,
    question_type: str,
    prefs: InterviewPreferences,
    experiences: Sequence[CandidateExperience],
    skills: Sequence[CandidateSkill],
    job: JobDescription | None,
) -> tuple[str, list[str], str, str]:
    active_items = [e for e in experiences if e.active]
    pool = active_items

    framework = prefs.framework
    if framework == "Auto":
        framework = (
            "STAR"
            if ("behavior" in question_type.lower() or "tell me" in question_text.lower())
            else "Direct"
        )

    llm = get_llm_adapter()
    if llm.is_configured:
        evidence_block = "\n".join(
            f"- {e.title} at {e.organization or 'Independent'} ({e.dates_text}): {e.summary}"
            for e in pool[:10]
        ) or "No CV items uploaded yet."
        skill_block = ", ".join(s.name for s in skills[:15]) or "None listed yet"
        job_line = f"{job.title} at {job.company}".strip() if job else "General interview"

        ai_res = await llm.complete_json(
            system_prompt=(
                "You are generating the exact spoken interview answer for a candidate during a live interview "
                "(any industry: digital marketing, 3D art, design, sales, operations, finance, healthcare, software, etc.). "
                "CRITICAL RULES: "
                "1) ALWAYS write the ACTUAL ANSWER in first person ('I...' / 'We...') that the candidate can say out loud word-for-word. "
                "2) NEVER coach or tell the candidate what to do. STRICTLY FORBIDDEN phrases: 'Start with', 'Begin by', 'Mention', 'Walk through', 'Explain how', 'Focus on', 'Set the scene', 'Highlight', 'You should', 'Talk about', 'Tie it back', 'Share a'. Give the real answer itself, not advice on how to answer. "
                "3) Answer tough questions directly even when the topic is NOT on their CV. If a verified CV item fits, weave it in naturally without inventing fake jobs or metrics. "
                "4) Sound like a sharp human speaking casually and clearly: short direct sentences, everyday words, zero AI buzzwords "
                "(ban: leverage, synergy, delve, tapestry, holistic, fast-paced, rockstar, spearheaded, great question). "
                "Return JSON: {framework: string, outline: string[] (3-4 ready-to-say first-person answer lines), evidence_ref: string, caveat: string}."
            ),
            user_prompt=(
                f"Target role: {job_line}\n"
                f"Preferences: framework={framework}, length={prefs.length}, style={prefs.style}, language={prefs.language}\n"
                f"Interviewer question/task ({question_type}): {question_text}\n\n"
                f"Candidate CV context (use if relevant, otherwise answer directly from role expertise):\n{evidence_block}\n"
                f"Listed skills: {skill_block}"
            ),
            temperature=0.25,
            max_tokens=900,
        )
        if ai_res and isinstance(ai_res.get("outline"), list):
            outline = [str(x).strip()[:240] for x in ai_res["outline"] if str(x).strip()][:4]
            if outline:
                return (
                    str(ai_res.get("framework") or framework)[:40],
                    outline,
                    str(ai_res.get("evidence_ref") or "Role strategy + Candidate context")[:180],
                    str(ai_res.get("caveat") or "")[:240],
                )

    q_tokens = _tokens(question_text)
    scored: list[tuple[int, CandidateExperience]] = []
    for item in pool:
        item_tokens = _tokens(f"{item.title} {item.organization} {item.summary}")
        score = len(q_tokens & item_tokens) + (1 if item.origin == "verified" else 0)
        scored.append((score, item))
    scored.sort(key=lambda pair: pair[0], reverse=True)

    best_score, best_item = scored[0] if scored else (0, None)
    strong_cv_hit = best_item is not None and best_score >= 2

    if strong_cv_hit and best_item is not None:
        evidence_ref = (
            f"{best_item.title} ({best_item.organization})"
            if best_item.organization
            else best_item.title
        )
        snippet = best_item.summary.strip() or f"Your work as {best_item.title}."
        if framework == "STAR":
            outline = [
                f"In my role as {best_item.title}{f' at {best_item.organization}' if best_item.organization else ''} ({best_item.dates_text or 'recently'}), I ran into a similar challenge.",
                f"I handled it directly: {snippet[:185]}",
                "That resolved the bottleneck cleanly and gave the team a concrete outcome we could measure.",
            ]
        else:
            matched_skills = [
                s.name for s in skills if any(tok in s.normalized_name for tok in q_tokens)
            ][:3]
            skills_note = f" using {', '.join(matched_skills)}" if matched_skills else ""
            outline = [
                f"Yes, I've done this hands-on{skills_note} as {best_item.title}.",
                f"Specifically, {snippet[:190]}",
                f"For {job.title if job else 'this role'}, I would apply that exact same approach from day one.",
            ]
        return framework, outline, evidence_ref[:180], ""

    # Outside CV or general tough task: still give a sharp, direct, first-person answer.
    outline = _direct_domain_outline(question_text, question_type, job, best_item)
    evidence_ref = (
        f"Role answer + {best_item.title}"
        if best_item
        else f"Direct role answer ({job.title if job else question_type})"
    )
    caveat = ""
    return framework, outline, evidence_ref[:180], caveat


def _parse_streamed_bullets(raw_text: str) -> list[str]:
    lines = []
    for raw in raw_text.splitlines():
        cleaned = re.sub(r"^\s*(?:[-*]|\d+[.)])\s*", "", raw).strip()
        if cleaned:
            lines.append(cleaned[:240])
    if len(lines) <= 1 and raw_text.strip():
        parts = [p.strip() for p in re.split(r"(?<=[.!?])\s+", raw_text.strip()) if p.strip()]
        if len(parts) > 1:
            lines = [p[:240] for p in parts[:3]]
    return lines[:3]


async def stream_grounded_suggestion(
    question_text: str,
    question_type: str,
    prefs: InterviewPreferences,
    experiences: Sequence[CandidateExperience],
    skills: Sequence[CandidateSkill],
    job: JobDescription | None,
    recent_turns: Sequence[str] = (),
) -> AsyncIterator[tuple[str, Any]]:
    """
    Streams fast first-person spoken answer chunks (`('delta', str)`) followed by
    the finalized tuple `('done', (framework, outline, evidence_ref, caveat))`.
    """
    active_items = [e for e in experiences if e.active]
    framework = prefs.framework
    if framework == "Auto":
        framework = (
            "STAR"
            if ("behavior" in question_type.lower() or "tell me" in question_text.lower())
            else "Direct"
        )

    llm = get_llm_adapter()
    if llm.is_configured:
        # Lean fixed prefix: top 4 experiences + top 8 skills + last 2 transcript turns
        evidence_lines = "\n".join(
            f"- {e.title} ({e.organization or 'Independent'}): {e.summary[:140]}"
            for e in active_items[:4]
        ) or "None provided"
        skill_line = ", ".join(s.name for s in skills[:8]) or "General"
        job_line = f"{job.title} ({job.company})" if job and job.company else (job.title if job else "General")
        turns_block = "\n".join(recent_turns[-2:]) if recent_turns else "None"

        system_prompt = (
            "Output ONLY 2 to 3 short first-person spoken interview bullet lines starting with '- '. "
            "Write exact words the candidate can read aloud immediately ('I...'). "
            "NEVER give coaching instructions ('Start with', 'Mention', 'Walk through', 'Explain how'). "
            "Answer tough questions directly even outside the CV. Zero buzzwords. No preamble."
        )
        user_prompt = (
            f"Role: {job_line} | Style: {framework}, {prefs.length}, {prefs.language}\n"
            f"Background:\n{evidence_lines}\nSkills: {skill_line}\n"
            f"Recent turns:\n{turns_block}\n"
            f"Question ({question_type}): {question_text}"
        )

        collected: list[str] = []
        async for chunk in llm.stream_text(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            temperature=0.2,
            max_tokens=200,
        ):
            collected.append(chunk)
            yield ("delta", chunk)

        outline = _parse_streamed_bullets("".join(collected))
        if outline:
            evidence_ref = (
                f"Anchored in {active_items[0].title}"
                if active_items
                else f"Direct answer ({job_line})"
            )
            yield ("done", (framework, outline, evidence_ref[:180], ""))
            return

    # Deterministic low-latency fallback (no AI delay)
    fw, outline, evidence_ref, caveat = await generate_grounded_suggestion(
        question_text=question_text,
        question_type=question_type,
        prefs=prefs,
        experiences=experiences,
        skills=skills,
        job=job,
    )
    yield ("delta", "\n".join(f"- {b}" for b in outline))
    yield ("done", (fw, outline, evidence_ref, caveat))
