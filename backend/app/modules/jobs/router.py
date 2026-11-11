from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_verified_user
from app.core.errors import AppError
from app.db.models import (
    AuditEvent,
    CandidateExperience,
    CandidateSkill,
    JobDescription,
    User,
)
from app.modules.jobs.matcher import compute_gap_report, extract_job_structured
from app.modules.jobs.schemas import (
    GapReportOut,
    JobCreateIn,
    JobExtractIn,
    JobExtractOut,
    JobOut,
    JobUpdateIn,
)

router = APIRouter(prefix="/v1/jobs", tags=["jobs"])


def _to_job_out(job: JobDescription) -> JobOut:
    return JobOut(
        id=job.id,
        user_id=job.user_id,
        title=job.title,
        company=job.company,
        seniority=job.seniority,
        source=job.source,
        raw_text=job.raw_text,
        responsibilities=list(job.responsibilities or []),
        required_skills=list(job.required_skills or []),
        preferred_skills=list(job.preferred_skills or []),
        themes=list(job.themes or []),
        archived=job.archived,
        created_at=job.created_at,
        updated_at=job.updated_at,
    )


async def _get_owned_job(job_id: UUID, user_id: UUID, db: AsyncSession) -> JobDescription:
    job = (
        await db.execute(
            select(JobDescription).where(
                JobDescription.id == job_id,
                JobDescription.user_id == user_id,
            )
        )
    ).scalar_one_or_none()
    if not job:
        raise AppError(code="job_not_found", message="Job description not found.", status_code=404)
    return job


@router.get("", response_model=list[JobOut])
async def list_jobs(
    include_archived: bool = Query(default=False),
    user: User = Depends(get_verified_user),
    db: AsyncSession = Depends(get_db),
) -> list[JobOut]:
    stmt = select(JobDescription).where(JobDescription.user_id == user.id)
    if not include_archived:
        stmt = stmt.where(JobDescription.archived.is_(False))
    jobs = (await db.execute(stmt.order_by(JobDescription.created_at.desc()))).scalars().all()
    return [_to_job_out(j) for j in jobs]


@router.post("/extract", response_model=JobExtractOut)
async def extract_job_preview(
    payload: JobExtractIn,
    user: User = Depends(get_verified_user),
) -> JobExtractOut:
    return await extract_job_structured(
        raw_text=payload.raw_text,
        title_hint=payload.title,
        company_hint=payload.company,
    )


@router.post("", response_model=JobOut, status_code=status.HTTP_201_CREATED)
async def create_job(
    payload: JobCreateIn,
    user: User = Depends(get_verified_user),
    db: AsyncSession = Depends(get_db),
) -> JobOut:
    extracted = None
    if payload.raw_text.strip() and (
        payload.responsibilities is None or payload.required_skills is None or not payload.title.strip()
    ):
        extracted = await extract_job_structured(
            raw_text=payload.raw_text,
            title_hint=payload.title,
            company_hint=payload.company,
        )

    title = payload.title.strip() or (extracted.title if extracted else "Target Role")
    company = payload.company.strip() or (extracted.company if extracted else "")
    seniority = payload.seniority.strip() or (extracted.seniority if extracted else "Senior")

    job = JobDescription(
        user_id=user.id,
        title=title,
        company=company,
        seniority=seniority,
        source=payload.source.strip() or "manual",
        raw_text=payload.raw_text,
        responsibilities=(
            payload.responsibilities
            if payload.responsibilities is not None
            else (extracted.responsibilities if extracted else [])
        ),
        required_skills=(
            payload.required_skills
            if payload.required_skills is not None
            else (extracted.required_skills if extracted else [])
        ),
        preferred_skills=(
            payload.preferred_skills
            if payload.preferred_skills is not None
            else (extracted.preferred_skills if extracted else [])
        ),
        themes=(
            payload.themes
            if payload.themes is not None
            else (extracted.themes if extracted else [])
        ),
    )
    db.add(job)
    await db.flush()
    db.add(
        AuditEvent(
            user_id=user.id,
            event_type="job_created",
            metadata_json={"job_id": str(job.id), "title": job.title},
        )
    )
    await db.commit()
    await db.refresh(job)
    return _to_job_out(job)


@router.get("/{job_id}", response_model=JobOut)
async def get_job(
    job_id: UUID,
    user: User = Depends(get_verified_user),
    db: AsyncSession = Depends(get_db),
) -> JobOut:
    job = await _get_owned_job(job_id, user.id, db)
    return _to_job_out(job)


@router.patch("/{job_id}", response_model=JobOut)
async def update_job(
    job_id: UUID,
    payload: JobUpdateIn,
    user: User = Depends(get_verified_user),
    db: AsyncSession = Depends(get_db),
) -> JobOut:
    job = await _get_owned_job(job_id, user.id, db)
    updates = payload.model_dump(exclude_unset=True)
    for field_name, value in updates.items():
        setattr(job, field_name, value.strip() if isinstance(value, str) else value)
    job.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(job)
    return _to_job_out(job)


@router.delete("/{job_id}")
async def delete_job(
    job_id: UUID,
    user: User = Depends(get_verified_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    job = await _get_owned_job(job_id, user.id, db)
    await db.delete(job)
    await db.commit()
    return {"status": "deleted"}


@router.get("/{job_id}/gap-report", response_model=GapReportOut)
async def get_job_gap_report(
    job_id: UUID,
    user: User = Depends(get_verified_user),
    db: AsyncSession = Depends(get_db),
) -> GapReportOut:
    job = await _get_owned_job(job_id, user.id, db)
    experiences = (
        await db.execute(
            select(CandidateExperience).where(CandidateExperience.user_id == user.id)
        )
    ).scalars().all()
    skills = (
        await db.execute(
            select(CandidateSkill).where(CandidateSkill.user_id == user.id)
        )
    ).scalars().all()
    return compute_gap_report(job, experiences, skills)

