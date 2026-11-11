import re
from typing import Sequence

from app.adapters.cv_parser import _KNOWN_SKILL_CATALOG, normalize_skill_name
from app.adapters.llm import LLMProviderAdapter, get_llm_adapter
from app.db.models import CandidateExperience, CandidateSkill, JobDescription
from app.modules.jobs.schemas import (
    GapItemOut,
    GapReportOut,
    JobExtractOut,
    PartialMatchOut,
    StrongMatchOut,
)

_STOPWORDS = {
    "and",
    "with",
    "for",
    "the",
    "of",
    "in",
    "to",
    "on",
    "or",
    "a",
    "an",
    "experience",
    "strong",
    "ability",
    "work",
}

_THEME_KEYWORDS: dict[str, tuple[str, ...]] = {
    "Campaign Strategy & Growth": ("campaign", "seo", "paid", "ads", "acquisition", "funnel", "conversion", "retention", "roas", "cac", "growth"),
    "Creative Craft & Production": ("3d", "render", "shader", "lighting", "modeling", "texturing", "animation", "blender", "maya", "unreal", "figma", "brand", "visual", "portfolio"),
    "Strategy & Prioritization": ("roadmap", "strategy", "vision", "prioritization", "market", "positioning"),
    "Metrics & Experimentation": ("metric", "a/b", "experiment", "analytics", "kpi", "attribution", "cohort"),
    "Operations & Stakeholder Alignment": ("stakeholder", "cross-functional", "client", "workflow", "crm", "pipeline", "budget", "leadership"),
    "Technical Architecture & Reliability": ("architecture", "distributed", "scalability", "api", "latency", "security", "testing", "monitoring"),
}


def _infer_seniority(text: str) -> str:
    lowered = text.lower()
    if re.search(r"\bstaff\b|\bprincipal\b", lowered):
        return "Staff"
    if re.search(r"\bdirector\b|\bhead of\b|\bvp\b", lowered):
        return "Executive"
    if re.search(r"\blead\b", lowered):
        return "Lead"
    if re.search(r"\bsenior\b|\bsr\.", lowered):
        return "Senior"
    if re.search(r"\bjunior\b|\bentry\b|\bassociate\b", lowered):
        return "Junior"
    return "Mid-level"


def deterministic_extract_job(
    raw_text: str,
    title_hint: str = "",
    company_hint: str = "",
) -> JobExtractOut:
    lines = [line.strip() for line in raw_text.splitlines() if line.strip()]
    title = title_hint.strip()
    company = company_hint.strip()

    if not title and lines:
        first = lines[0]
        if " at " in first:
            parts = first.split(" at ", 1)
            title = parts[0].strip()[:180]
            company = company or parts[1].strip()[:180]
        elif " - " in first:
            parts = first.split(" - ", 1)
            title = parts[0].strip()[:180]
            company = company or parts[1].strip()[:180]
        else:
            title = first[:180]

    if not company:
        for line in lines[:5]:
            m = re.match(r"^(?:company|organization|employer)\s*:\s*(.+)$", line, re.IGNORECASE)
            if m:
                company = m.group(1).strip()[:180]
                break

    responsibilities: list[str] = []
    required_skills: list[str] = []
    preferred_skills: list[str] = []

    section = "general"
    for line in lines:
        clean = re.sub(r"[:\-\s]+$", "", line).lower()
        if len(clean) <= 42:
            if any(k in clean for k in ("responsibilities", "what you'll do", "what you will do", "the role")):
                section = "responsibilities"
                continue
            if any(k in clean for k in ("preferred", "nice to have", "bonus")):
                section = "preferred"
                continue
            if any(k in clean for k in ("requirements", "qualifications", "must have", "skills")):
                section = "required"
                continue

        is_bullet = line.startswith(("-", "*", "•", "–"))
        bullet_text = line.lstrip("-*•– ").strip()
        if not bullet_text or len(bullet_text) < 4:
            continue
        if section == "responsibilities" and (is_bullet or len(responsibilities) < 5):
            responsibilities.append(bullet_text[:220])
        elif section == "required" and is_bullet and len(required_skills) < 10:
            required_skills.append(bullet_text[:140])
        elif section == "preferred" and is_bullet and len(preferred_skills) < 8:
            preferred_skills.append(bullet_text[:140])

    lowered = raw_text.lower()
    detected_catalog_skills: list[str] = []
    for candidate in _KNOWN_SKILL_CATALOG:
        if re.search(rf"\b{re.escape(candidate.lower())}\b", lowered):
            detected_catalog_skills.append(candidate)

    # Merge catalog skills cleanly if explicit bullet requirements didn't list short skill names
    seen_req = {normalize_skill_name(r) for r in required_skills}
    for skill in detected_catalog_skills:
        norm = normalize_skill_name(skill)
        if norm not in seen_req and len(required_skills) < 10:
            required_skills.append(skill)
            seen_req.add(norm)

    if not responsibilities:
        responsibilities = [
            line.lstrip("-*•– ").strip()[:220]
            for line in lines[1:6]
            if len(line.strip()) > 18
        ]

    themes: list[str] = []
    for theme, keywords in _THEME_KEYWORDS.items():
        if any(kw in lowered for kw in keywords):
            themes.append(theme)
    if not themes:
        themes = ["Role Execution & Collaboration", "Behavioral & Problem Solving"]

    return JobExtractOut(
        title=title or "Target Role",
        company=company or "Target Company",
        seniority=_infer_seniority(f"{title} {raw_text[:1200]}"),
        responsibilities=responsibilities[:8],
        required_skills=required_skills[:10],
        preferred_skills=preferred_skills[:6],
        themes=themes[:6],
    )


async def extract_job_structured(
    raw_text: str,
    title_hint: str = "",
    company_hint: str = "",
    llm: LLMProviderAdapter | None = None,
) -> JobExtractOut:
    baseline = deterministic_extract_job(raw_text, title_hint=title_hint, company_hint=company_hint)
    provider = llm or get_llm_adapter()
    if not provider.is_configured or len(raw_text.strip()) < 30:
        return baseline

    system_prompt = (
        "Extract structured job description details into strict JSON with keys: "
        "title, company, seniority (one of Junior, Mid-level, Senior, Lead, Staff, Executive), "
        "responsibilities (string[]), required_skills (string[]), preferred_skills (string[]), "
        "and themes (string[] of interview themes). Ground strictly in the provided text."
    )
    user_prompt = f"Title hint: {title_hint}\nCompany hint: {company_hint}\n\nJob Description:\n{raw_text[:12000]}"
    ai_data = await provider.complete_json(system_prompt, user_prompt, temperature=0.1, max_tokens=1400)
    if not ai_data:
        return baseline

    def _str_list(key: str, fallback: list[str], limit: int) -> list[str]:
        raw = ai_data.get(key)
        if not isinstance(raw, list):
            return fallback
        cleaned = [str(item).strip()[:220] for item in raw if isinstance(item, str) and item.strip()]
        return cleaned[:limit] if cleaned else fallback

    return JobExtractOut(
        title=str(ai_data.get("title") or "").strip()[:180] or baseline.title,
        company=str(ai_data.get("company") or "").strip()[:180] or baseline.company,
        seniority=str(ai_data.get("seniority") or "").strip()[:60] or baseline.seniority,
        responsibilities=_str_list("responsibilities", baseline.responsibilities, 8),
        required_skills=_str_list("required_skills", baseline.required_skills, 10),
        preferred_skills=_str_list("preferred_skills", baseline.preferred_skills, 6),
        themes=_str_list("themes", baseline.themes, 6),
    )


def _tokens(text: str) -> set[str]:
    return {
        tok
        for tok in re.findall(r"[a-z0-9+#\.]{2,}", text.lower())
        if tok not in _STOPWORDS
    }


def compute_gap_report(
    job: JobDescription,
    experiences: Sequence[CandidateExperience],
    skills: Sequence[CandidateSkill],
) -> GapReportOut:
    active_items = [e for e in experiences if e.active]
    skill_map = {s.normalized_name: s for s in skills}

    requirements: list[str] = []
    seen_req: set[str] = set()
    for req in [*(job.required_skills or []), *(job.preferred_skills or [])]:
        clean = str(req).strip()
        norm = normalize_skill_name(clean)
        if clean and norm not in seen_req:
            seen_req.add(norm)
            requirements.append(clean)

    strong: list[StrongMatchOut] = []
    partial: list[PartialMatchOut] = []
    gaps: list[GapItemOut] = []

    for req in requirements:
        req_norm = normalize_skill_name(req)
        req_tokens = _tokens(req)
        matched_skill = None
        for sk_norm, sk_obj in skill_map.items():
            if sk_norm == req_norm or sk_norm in req_norm or req_norm in sk_norm:
                matched_skill = sk_obj
                break

        best_item: CandidateExperience | None = None
        best_overlap = 0.0
        for item in active_items:
            haystack = f"{item.title} {item.organization} {item.summary}".lower()
            if req_norm in haystack:
                best_item = item
                best_overlap = 1.0
                break
            item_tokens = _tokens(haystack)
            if req_tokens and item_tokens:
                overlap = len(req_tokens & item_tokens) / len(req_tokens)
                if overlap > best_overlap:
                    best_overlap = overlap
                    best_item = item

        if matched_skill and matched_skill.origin == "verified" and best_item and best_item.origin == "verified":
            strong.append(
                StrongMatchOut(
                    requirement=req,
                    evidence=f"{best_item.title} ({best_item.organization or 'Verified profile'}) + skill '{matched_skill.name}'",
                    source=best_item.source_location or "Verified profile",
                )
            )
        elif best_item and best_overlap >= 0.6 and best_item.origin == "verified":
            strong.append(
                StrongMatchOut(
                    requirement=req,
                    evidence=f"{best_item.title}: {best_item.summary[:160] or best_item.organization}",
                    source=best_item.source_location or "Verified profile",
                )
            )
        elif matched_skill and matched_skill.origin == "verified":
            strong.append(
                StrongMatchOut(
                    requirement=req,
                    evidence=f"Verified skill: {matched_skill.name}",
                    source="Verified skills",
                )
            )
        elif matched_skill or (best_item and best_overlap >= 0.35):
            note = (
                f"Skill '{matched_skill.name}' is unverified; verify it in Profile."
                if matched_skill
                else f"Partial overlap in '{best_item.title}'; clarify specific examples before interview."
            )
            partial.append(PartialMatchOut(requirement=req, note=note))
        else:
            gaps.append(
                GapItemOut(
                    requirement=req,
                    suggestion=(
                        f"No verified evidence found for '{req}'. Prepare an honest transferable "
                        "example or add real prior work in Profile if missed during CV sorting."
                    ),
                )
            )

    total = max(1, len(requirements))
    weighted = (len(strong) * 1.0 + len(partial) * 0.5) / total
    fit_score = int(round(weighted * 100)) if requirements else 50

    return GapReportOut(
        job_id=job.id,
        fit_score=fit_score,
        strong_matches=strong,
        partial_matches=partial,
        gaps=gaps,
        themes=list(job.themes or []),
    )

