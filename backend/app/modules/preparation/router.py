from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.adapters.llm import get_llm_adapter
from app.core.database import get_db
from app.core.deps import get_verified_user
from app.core.errors import AppError
from app.db.models import (
    AuditEvent,
    CandidateExperience,
    CandidateSkill,
    InterviewPreferences,
    JobDescription,
    User,
    UserConsent,
)
from app.modules.preparation.schemas import (
    ConsentEventOut,
    PreferencesOut,
    PreferencesUpdateIn,
    PrepBriefOut,
    PrepGenerateIn,
    PrepTalkingPoint,
)

router = APIRouter(prefix="/v1/preparation", tags=["preparation"])


async def _get_or_create_prefs(user_id: UUID, db: AsyncSession) -> InterviewPreferences:
    prefs = await db.get(InterviewPreferences, user_id)
    if not prefs:
        prefs = InterviewPreferences(user_id=user_id)
        db.add(prefs)
        await db.commit()
        await db.refresh(prefs)
    return prefs


async def _prefs_out(user_id: UUID, db: AsyncSession) -> PreferencesOut:
    prefs = await _get_or_create_prefs(user_id, db)
    consents = (
        await db.execute(
            select(UserConsent)
            .where(UserConsent.user_id == user_id)
            .order_by(UserConsent.created_at.desc())
            .limit(30)
        )
    ).scalars().all()
    return PreferencesOut(
        language=prefs.language,
        length=prefs.length,
        style=prefs.style if prefs.style in ("Direct", "Conversational", "Structured") else "Direct",
        framework=prefs.framework,
        retain_transcript_default=prefs.retain_transcript_default,
        notes_default=prefs.notes_default,
        retention_days=prefs.retention_days,
        product_emails=prefs.product_emails,
        updated_at=prefs.updated_at,
        consent_history=[
            ConsentEventOut(
                id=c.id,
                consent_type=c.consent_type,
                label=c.label,
                detail=c.detail,
                created_at=c.created_at,
            )
            for c in consents
        ],
    )


@router.get("/preferences", response_model=PreferencesOut)
async def get_preferences(
    user: User = Depends(get_verified_user),
    db: AsyncSession = Depends(get_db),
) -> PreferencesOut:
    return await _prefs_out(user.id, db)


@router.patch("/preferences", response_model=PreferencesOut)
async def update_preferences(
    payload: PreferencesUpdateIn,
    user: User = Depends(get_verified_user),
    db: AsyncSession = Depends(get_db),
) -> PreferencesOut:
    prefs = await _get_or_create_prefs(user.id, db)
    prev_retain = prefs.retain_transcript_default
    updates = payload.model_dump(exclude_unset=True)
    for field_name, value in updates.items():
        setattr(prefs, field_name, value)
    prefs.updated_at = datetime.now(timezone.utc)

    if (
        "retain_transcript_default" in updates
        and updates["retain_transcript_default"] != prev_retain
    ):
        db.add(
            UserConsent(
                user_id=user.id,
                consent_type="transcript_retention",
                label=(
                    "Enabled default transcript retention"
                    if prefs.retain_transcript_default
                    else "Disabled default transcript retention (discard after session)"
                ),
                detail=f"Retention policy window: {prefs.retention_days} days.",
            )
        )
    db.add(
        AuditEvent(
            user_id=user.id,
            event_type="preferences_updated",
            metadata_json={"fields": list(updates.keys())},
        )
    )
    await db.commit()
    return await _prefs_out(user.id, db)


@router.post("/brief", response_model=PrepBriefOut)
async def generate_prep_brief(
    payload: PrepGenerateIn,
    user: User = Depends(get_verified_user),
    db: AsyncSession = Depends(get_db),
) -> PrepBriefOut:
    job = (
        await db.execute(
            select(JobDescription).where(
                JobDescription.id == payload.job_id,
                JobDescription.user_id == user.id,
            )
        )
    ).scalar_one_or_none()
    if not job:
        raise AppError(code="job_not_found", message="Job description not found.", status_code=404)

    prefs = await _get_or_create_prefs(user.id, db)
    experiences = (
        await db.execute(
            select(CandidateExperience).where(
                CandidateExperience.user_id == user.id,
                CandidateExperience.active.is_(True),
            )
        )
    ).scalars().all()
    skills = (
        await db.execute(select(CandidateSkill).where(CandidateSkill.user_id == user.id))
    ).scalars().all()

    themes = list(job.themes or []) or ["Role Fit & Execution", "Behavioral Ownership"]
    skill_names = [s.name for s in skills[:12]]
    exp_summaries = [
        f"{e.title} ({e.organization or 'Independent'}, {e.dates_text}): {e.summary}"
        for e in experiences[:8]
    ]

    llm = get_llm_adapter()
    talking_points: list[PrepTalkingPoint] = []
    if llm.is_configured:
        ai_res = await llm.complete_json(
            system_prompt=(
                "Generate concise, spoken-style interview prep talking points for ANY industry "
                "(marketing, 3D art, design, ops, sales, finance, tech, etc.). "
                "When candidate CV items fit, reference them naturally without inventing fake jobs. "
                "When themes go beyond the CV, still provide clear, direct, practical talking points for the role. "
                "Avoid robotic phrasing, clichés, or corporate buzzwords. "
                "Return JSON {talking_points: [{theme, prompt_example, outline: string[], evidence_ref, caveat}]}."
            ),
            user_prompt=(
                f"Job: {job.title} at {job.company}\nThemes: {themes}\n"
                f"Framework preference: {prefs.framework}, length: {prefs.length}, style: {prefs.style}\n"
                f"Candidate Experiences:\n" + ("\n".join(exp_summaries) or "None yet") + "\nSkills: " + (", ".join(skill_names) or "None yet")
            ),
            temperature=0.25,
            max_tokens=1600,
        )
        if ai_res and isinstance(ai_res.get("talking_points"), list):
            for tp in ai_res["talking_points"][:4]:
                if isinstance(tp, dict) and tp.get("theme"):
                    talking_points.append(
                        PrepTalkingPoint(
                            theme=str(tp["theme"])[:140],
                            prompt_example=str(tp.get("prompt_example") or "")[:240],
                            outline=[str(o)[:220] for o in (tp.get("outline") or []) if o][:4],
                            evidence_ref=str(tp.get("evidence_ref") or "Role strategy + CV context")[:180],
                            caveat=str(tp.get("caveat") or "")[:240],
                        )
                    )

    if not talking_points:
        for idx, theme in enumerate(themes[:3]):
            ref_item = experiences[idx % len(experiences)] if experiences else None
            if ref_item:
                outline = [
                    f"Anchor in {ref_item.title} at {ref_item.organization or 'your previous team'}.",
                    f"Spell out your hands-on step: {ref_item.summary[:190] or 'explain the trade-off you picked and why.'}",
                    f"Connect it straight to what {job.company or 'this team'} needs on {theme.lower()}.",
                ]
                evidence_ref = f"{ref_item.title} ({ref_item.organization or 'Profile'})"
                caveat = "" if ref_item.origin == "verified" else "Double-check wording on this extracted role in Profile."
            else:
                outline = [
                    f"Give a direct 1-sentence take on how you approach {theme.lower()} in practice.",
                    f"Walk through a real step-by-step workflow using skills you know ({', '.join(skill_names[:4]) or 'clarity, prioritization, iteration'}).",
                    "End on how you measure if it worked without sounding scripted.",
                ]
                evidence_ref = f"Direct role guidance ({job.title})"
                caveat = "Outside CV: focus on clear practical reasoning."

            talking_points.append(
                PrepTalkingPoint(
                    theme=theme,
                    prompt_example=f"Tell me about a time your work demonstrated {theme.lower()}.",
                    outline=outline,
                    evidence_ref=evidence_ref,
                    caveat=caveat,
                )
            )

    checklist = [
        f"Verified experiences active: {sum(1 for e in experiences if e.origin == 'verified')}",
        f"Framework: {prefs.framework} ({prefs.length}, {prefs.style})",
        "Transcript default: " + ("Retained" if prefs.retain_transcript_default else "Discarded after session"),
    ]
    return PrepBriefOut(
        job_id=job.id,
        job_title=job.title,
        company=job.company,
        framework=prefs.framework,
        talking_points=talking_points,
        checklist=checklist,
    )

