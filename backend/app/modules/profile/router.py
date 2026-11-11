from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.adapters.cv_parser import normalize_skill_name
from app.core.database import get_db
from app.core.deps import get_verified_user
from app.core.errors import AppError
from app.db.models import (
    AuditEvent,
    CandidateDocument,
    CandidateExperience,
    CandidateSkill,
    InterviewPreferences,
    Profile,
    User,
    UserConsent,
)
from app.modules.profile.schemas import (
    DocumentOut,
    ExperienceCreateIn,
    ExperienceItemOut,
    ExperienceUpdateIn,
    OnboardingIn,
    ProfileOut,
    ProfileUpdateIn,
    SkillCreateIn,
    SkillOut,
    VerifyProfileIn,
)

router = APIRouter(prefix="/v1/profile", tags=["profile"])


def _to_item_out(item: CandidateExperience) -> ExperienceItemOut:
    return ExperienceItemOut(
        id=item.id,
        document_id=item.document_id,
        kind=item.kind,  # type: ignore[arg-type]
        title=item.title,
        organization=item.organization,
        dates_text=item.dates_text,
        summary=item.summary,
        origin=item.origin,  # type: ignore[arg-type]
        confidence=item.confidence,
        source_location=item.source_location,
        active=item.active,
        created_at=item.created_at,
        updated_at=item.updated_at,
    )


async def build_profile_out(user_id: UUID, db: AsyncSession) -> ProfileOut:
    profile = await db.get(Profile, user_id)
    if not profile:
        profile = Profile(user_id=user_id)
        db.add(profile)
        await db.commit()
        await db.refresh(profile)

    items = (
        await db.execute(
            select(CandidateExperience)
            .where(CandidateExperience.user_id == user_id)
            .order_by(CandidateExperience.created_at.desc())
        )
    ).scalars().all()
    skills = (
        await db.execute(
            select(CandidateSkill)
            .where(CandidateSkill.user_id == user_id)
            .order_by(CandidateSkill.created_at.asc())
        )
    ).scalars().all()
    docs = (
        await db.execute(
            select(CandidateDocument)
            .where(CandidateDocument.user_id == user_id)
            .order_by(CandidateDocument.created_at.desc())
        )
    ).scalars().all()

    grouped: dict[str, list[ExperienceItemOut]] = {
        "experience": [],
        "education": [],
        "project": [],
        "certification": [],
    }
    for item in items:
        grouped.setdefault(item.kind, []).append(_to_item_out(item))

    return ProfileOut(
        user_id=profile.user_id,
        full_name=profile.full_name,
        headline=profile.headline,
        summary=profile.summary,
        location=profile.location,
        language=profile.language,
        role_focus=profile.role_focus,
        checklist_dismissed=profile.checklist_dismissed,
        verified_at=profile.verified_at,
        updated_at=profile.updated_at,
        experiences=grouped["experience"],
        education=grouped["education"],
        projects=grouped["project"],
        certifications=grouped["certification"],
        skills=[
            SkillOut(
                id=s.id,
                name=s.name,
                normalized_name=s.normalized_name,
                origin=s.origin,
                created_at=s.created_at,
            )
            for s in skills
        ],
        documents=[
            DocumentOut(
                id=d.id,
                file_name=d.file_name,
                mime_type=d.mime_type,
                size_bytes=d.size_bytes,
                page_count=d.page_count,
                status=d.status,
                error_message=d.error_message,
                created_at=d.created_at,
            )
            for d in docs
        ],
    )


@router.get("", response_model=ProfileOut)
async def get_profile(
    user: User = Depends(get_verified_user),
    db: AsyncSession = Depends(get_db),
) -> ProfileOut:
    return await build_profile_out(user.id, db)


@router.patch("", response_model=ProfileOut)
async def update_profile(
    payload: ProfileUpdateIn,
    user: User = Depends(get_verified_user),
    db: AsyncSession = Depends(get_db),
) -> ProfileOut:
    profile = await db.get(Profile, user.id)
    if not profile:
        profile = Profile(user_id=user.id)
        db.add(profile)

    updates = payload.model_dump(exclude_unset=True)
    for field_name, value in updates.items():
        setattr(profile, field_name, value)
    profile.updated_at = datetime.now(timezone.utc)
    await db.commit()
    return await build_profile_out(user.id, db)


@router.post("/onboarding", response_model=ProfileOut)
async def complete_onboarding(
    payload: OnboardingIn,
    user: User = Depends(get_verified_user),
    db: AsyncSession = Depends(get_db),
) -> ProfileOut:
    if not payload.ai_consent:
        raise AppError(
            code="consent_required",
            message="AI evidence processing consent is required to use Vren AI.",
            status_code=400,
        )

    profile = await db.get(Profile, user.id)
    if not profile:
        profile = Profile(user_id=user.id)
        db.add(profile)
    profile.full_name = payload.full_name.strip()
    profile.role_focus = payload.role_focus.strip()
    profile.language = payload.language.strip() or "English"
    profile.updated_at = datetime.now(timezone.utc)

    prefs = await db.get(InterviewPreferences, user.id)
    if prefs:
        prefs.language = profile.language
        prefs.retain_transcript_default = payload.transcript_consent
        prefs.updated_at = datetime.now(timezone.utc)

    user.onboarded = True
    db.add(
        UserConsent(
            user_id=user.id,
            consent_type="ai_processing",
            label="Granted AI profile & interview grounding consent",
            detail="Candidate-approved server-side CV extraction and talking-point generation.",
        )
    )
    if payload.transcript_consent:
        db.add(
            UserConsent(
                user_id=user.id,
                consent_type="transcript_retention",
                label="Opted into default transcript retention",
                detail="Retain interview transcript segments until manually deleted or retention expires.",
            )
        )
    db.add(AuditEvent(user_id=user.id, event_type="onboarding_completed", metadata_json={}))
    await db.commit()
    return await build_profile_out(user.id, db)


@router.post("/verify", response_model=ProfileOut)
async def verify_profile(
    payload: VerifyProfileIn,
    user: User = Depends(get_verified_user),
    db: AsyncSession = Depends(get_db),
) -> ProfileOut:
    now = datetime.now(timezone.utc)
    profile = await db.get(Profile, user.id)
    if not profile:
        profile = Profile(user_id=user.id)
        db.add(profile)

    for field_name in ("full_name", "headline", "summary", "location", "language", "role_focus"):
        val = getattr(payload, field_name)
        if val is not None:
            setattr(profile, field_name, val.strip())

    stmt = select(CandidateExperience).where(CandidateExperience.user_id == user.id)
    if payload.item_ids is not None:
        stmt = stmt.where(CandidateExperience.id.in_(payload.item_ids))
    items = (await db.execute(stmt)).scalars().all()
    for item in items:
        if item.active and item.origin == "extracted":
            item.origin = "verified"
            item.updated_at = now

    if payload.skills is not None:
        await db.execute(delete(CandidateSkill).where(CandidateSkill.user_id == user.id))
        seen: set[str] = set()
        for raw in payload.skills:
            name = raw.strip()[:80]
            norm = normalize_skill_name(name)
            if name and norm not in seen:
                seen.add(norm)
                db.add(
                    CandidateSkill(
                        user_id=user.id,
                        name=name,
                        normalized_name=norm,
                        origin="verified",
                    )
                )
    else:
        skills = (
            await db.execute(select(CandidateSkill).where(CandidateSkill.user_id == user.id))
        ).scalars().all()
        for skill in skills:
            if skill.origin == "extracted":
                skill.origin = "verified"

    profile.verified_at = now
    profile.updated_at = now
    db.add(
        AuditEvent(
            user_id=user.id,
            event_type="profile_verified",
            metadata_json={"item_count": len(items)},
        )
    )
    await db.commit()
    return await build_profile_out(user.id, db)


@router.post("/experiences", response_model=ExperienceItemOut, status_code=status.HTTP_201_CREATED)
async def create_experience_item(
    payload: ExperienceCreateIn,
    user: User = Depends(get_verified_user),
    db: AsyncSession = Depends(get_db),
) -> ExperienceItemOut:
    item = CandidateExperience(
        user_id=user.id,
        kind=payload.kind,
        title=payload.title.strip(),
        organization=payload.organization.strip(),
        dates_text=payload.dates_text.strip(),
        summary=payload.summary.strip(),
        origin=payload.origin,
        confidence=1.0,
        source_location="Added manually",
        active=payload.active,
    )
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return _to_item_out(item)


@router.patch("/experiences/{item_id}", response_model=ExperienceItemOut)
async def update_experience_item(
    item_id: UUID,
    payload: ExperienceUpdateIn,
    user: User = Depends(get_verified_user),
    db: AsyncSession = Depends(get_db),
) -> ExperienceItemOut:
    item = (
        await db.execute(
            select(CandidateExperience).where(
                CandidateExperience.id == item_id,
                CandidateExperience.user_id == user.id,
            )
        )
    ).scalar_one_or_none()
    if not item:
        raise AppError(
            code="experience_not_found",
            message="Profile item not found.",
            status_code=404,
        )
    updates = payload.model_dump(exclude_unset=True)
    for field_name, value in updates.items():
        setattr(item, field_name, value.strip() if isinstance(value, str) else value)
    item.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(item)
    return _to_item_out(item)


@router.delete("/experiences/{item_id}")
async def delete_experience_item(
    item_id: UUID,
    user: User = Depends(get_verified_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    item = (
        await db.execute(
            select(CandidateExperience).where(
                CandidateExperience.id == item_id,
                CandidateExperience.user_id == user.id,
            )
        )
    ).scalar_one_or_none()
    if not item:
        raise AppError(
            code="experience_not_found",
            message="Profile item not found.",
            status_code=404,
        )
    await db.delete(item)
    await db.commit()
    return {"status": "deleted"}


@router.post("/skills", response_model=SkillOut, status_code=status.HTTP_201_CREATED)
async def create_skill(
    payload: SkillCreateIn,
    user: User = Depends(get_verified_user),
    db: AsyncSession = Depends(get_db),
) -> SkillOut:
    clean_name = payload.name.strip()
    norm = normalize_skill_name(clean_name)
    if not norm:
        raise AppError(code="invalid_skill", message="Skill name cannot be empty.", status_code=400)

    existing = (
        await db.execute(
            select(CandidateSkill).where(
                CandidateSkill.user_id == user.id,
                CandidateSkill.normalized_name == norm,
            )
        )
    ).scalar_one_or_none()
    if existing:
        return SkillOut(
            id=existing.id,
            name=existing.name,
            normalized_name=existing.normalized_name,
            origin=existing.origin,
            created_at=existing.created_at,
        )

    skill = CandidateSkill(
        user_id=user.id,
        name=clean_name,
        normalized_name=norm,
        origin=payload.origin,
    )
    db.add(skill)
    await db.commit()
    await db.refresh(skill)
    return SkillOut(
        id=skill.id,
        name=skill.name,
        normalized_name=skill.normalized_name,
        origin=skill.origin,
        created_at=skill.created_at,
    )


@router.delete("/skills/{skill_id}")
async def delete_skill(
    skill_id: UUID,
    user: User = Depends(get_verified_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    skill = (
        await db.execute(
            select(CandidateSkill).where(
                CandidateSkill.id == skill_id,
                CandidateSkill.user_id == user.id,
            )
        )
    ).scalar_one_or_none()
    if not skill:
        raise AppError(code="skill_not_found", message="Skill not found.", status_code=404)
    await db.delete(skill)
    await db.commit()
    return {"status": "deleted"}

