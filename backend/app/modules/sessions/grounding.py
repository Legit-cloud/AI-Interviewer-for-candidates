import re
from typing import Sequence

from app.adapters.llm import LLMProviderAdapter, get_llm_adapter
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
            "Start with the audience and one measurable goal (pipeline, signups, or CAC) before naming channels.",
            "Show how you test small first: 2 to 3 hooks or creatives, read early click/conversion data, cut losers fast.",
            f"Close with attribution: explain what happens next when scaling winning creative for {role_title}.",
        ]
    elif any(k in lower for k in ("3d", "render", "shader", "topology", "uv", "lighting", "blender", "maya", "unreal", "texture", "poly", "rig")):
        bullets = [
            "Lead with pipeline constraints first: target engine, poly budget, texture budget, and frame-rate or render deadline.",
            "Walk cleanly through your workflow: blockout silhouette, clean topology/UVs, PBR look-dev, and lighting checks.",
            "Mention trade-offs clearly (bake detail into normal maps instead of heavy geometry where performance matters).",
        ]
    elif any(k in lower for k in ("client", "stakeholder", "budget", "sales", "deadline", "disagree", "conflict", "pushback")):
        bullets = [
            "Listen first: pinpoint whether their pushback is about timeline, risk, or unclear expectations.",
            "Offer a concrete option instead of arguing (e.g., ship a smaller test scope this week, measure, then decide).",
            "Keep tone calm and outcome-focused rather than defensive.",
        ]
    elif "behavior" in question_type.lower() or any(k in lower for k in ("tell me about a time", "describe a", "walk me through")):
        bullets = [
            "Set the scene in one sentence: what was broken or at stake.",
            "Focus 60% of the answer on what YOU specifically changed or decided.",
            "End on the concrete result and one quick takeaway you still apply today.",
        ]
    else:
        bullets = [
            "Give a direct 1-sentence answer upfront before unpacking your steps.",
            f"Explain the practical approach you'd take in {role_title} (inputs, key trade-off, and how you verify it worked).",
            "Keep sentences short so it sounds like natural speech, not a textbook.",
        ]

    if bridge_item:
        bridge_note = (
            f"Tie it back briefly to {bridge_item.title} at {bridge_item.organization}"
            if bridge_item.organization
            else f"Tie it back briefly to {bridge_item.title}"
        )
        bullets[-1] = f"{bridge_note}: {bridge_item.summary[:120] or bullets[-1]}"

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
                "You are a sharp, human-sounding real-time interview partner for ANY industry "
                "(digital marketing, 3D art, design, sales, operations, finance, healthcare, software, etc.). "
                "Your job is to help the candidate answer tough interviewer questions or live tasks clearly, "
                "EVEN WHEN the question topic is NOT on their CV. "
                "Rules: "
                "1) Always provide a direct, practical, usable answer to the question or task. Never refuse just because a keyword is missing from the CV. "
                "2) If a verified CV item genuinely fits, anchor the answer in it naturally. Never fabricate fake past jobs, titles, or dates on their CV. "
                "3) Write like a sharp human talking out loud: short everyday words, zero fluff, zero clichés or AI buzzwords "
                "(ban: leverage, synergy, delve, tapestry, holistic, fast-paced world, rockstar, Spearhead, Great question). "
                "4) Respect the candidate's preferred framework/length/style. "
                "Return JSON: {framework: string, outline: string[] (3-4 concise spoken-style bullets), evidence_ref: string, caveat: string}."
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
                f"Scene: Anchor in your time as {best_item.title} ({best_item.dates_text or 'recent role'}).",
                f"Action: Walk through what you handled: {snippet[:185]}",
                "Result: Share the real outcome in plain terms and what it changed for the team.",
            ]
        else:
            matched_skills = [
                s.name for s in skills if any(tok in s.normalized_name for tok in q_tokens)
            ][:3]
            skills_note = f" ({', '.join(matched_skills)})" if matched_skills else ""
            outline = [
                f"Direct point{skills_note}: tie this directly to {best_item.title}.",
                f"Real detail: {snippet[:190]}",
                f"Why it fits {job.title if job else 'this role'}: connect that approach to their priorities.",
            ]
        return framework, outline, evidence_ref[:180], ""

    # Outside CV or general tough task: still give a sharp, direct, natural answer!
    outline = _direct_domain_outline(question_text, question_type, job, best_item)
    evidence_ref = (
        f"Role guidance + Bridge from {best_item.title}"
        if best_item
        else f"Direct role guidance ({job.title if job else question_type})"
    )
    caveat = "Outside your CV: answer directly on approach and keep examples grounded in real work."
    return framework, outline, evidence_ref[:180], caveat
