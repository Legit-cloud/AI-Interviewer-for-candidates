from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_verified_user
from app.core.errors import AppError
from app.core.rate_limit import rate_limit
from app.db.models import (
    CandidateExperience,
    CandidateSkill,
    InterviewPreferences,
    JobDescription,
    MockInterview,
    User,
)
from app.modules.ai.explain import explain_unavailable
from app.modules.mock import service

router = APIRouter(prefix="/v1/mock", tags=["mock"])


class MockCreateIn(BaseModel):
    job_id: UUID | None = None
    interview_type: str = Field(default="Behavioural", max_length=60)
    count: int = Field(default=5, ge=3, le=8)


class MockAnswerIn(BaseModel):
    answer: str = Field(min_length=3, max_length=4000)


class MockOut(BaseModel):
    id: UUID
    job_id: UUID | None
    title: str
    interview_type: str
    state: str
    turns: list[dict[str, Any]]
    summary: dict[str, Any] | None
    created_at: datetime
    finished_at: datetime | None


def _out(row: MockInterview) -> MockOut:
    return MockOut(
        id=row.id, job_id=row.job_id, title=row.title, interview_type=row.interview_type, state=row.state,
        turns=list(row.turns or []), summary=row.summary, created_at=row.created_at, finished_at=row.finished_at,
    )


def _unavailable() -> AppError:
    return AppError(
        code="ANSWER_UNAVAILABLE",
        message=explain_unavailable("AI_PROVIDER_UNAVAILABLE"),
        status_code=503,
    )


async def _owned(mock_id: UUID, user: User, db: AsyncSession) -> MockInterview:
    row = (
        await db.execute(select(MockInterview).where(MockInterview.id == mock_id, MockInterview.user_id == user.id))
    ).scalar_one_or_none()
    if not row:
        raise AppError("MOCK_NOT_FOUND", "Practice interview not found.", 404)
    return row


async def _context(user: User, job_id: UUID | None, db: AsyncSession):
    job = await db.get(JobDescription, job_id) if job_id else None
    if job_id and (job is None or job.user_id != user.id):
        raise AppError("job_not_found", "Job description not found.", 404)
    experiences = (await db.execute(select(CandidateExperience).where(CandidateExperience.user_id == user.id))).scalars().all()
    skills = (await db.execute(select(CandidateSkill).where(CandidateSkill.user_id == user.id))).scalars().all()
    prefs = await db.get(InterviewPreferences, user.id)
    language = (prefs.answer_language or prefs.language) if prefs else "English"
    return job, experiences, skills, language


@router.get("", response_model=list[MockOut])
async def list_mocks(user: User = Depends(get_verified_user), db: AsyncSession = Depends(get_db)) -> list[MockOut]:
    rows = (
        await db.execute(select(MockInterview).where(MockInterview.user_id == user.id).order_by(MockInterview.created_at.desc()).limit(50))
    ).scalars().all()
    return [_out(r) for r in rows]


@router.post("", response_model=MockOut, status_code=201, dependencies=[Depends(rate_limit("mock_create", 20, 3600))])
async def create_mock(payload: MockCreateIn, user: User = Depends(get_verified_user), db: AsyncSession = Depends(get_db)) -> MockOut:
    job, experiences, skills, language = await _context(user, payload.job_id, db)
    try:
        questions = await service.generate_questions(payload.interview_type, payload.count, language, job, experiences, skills)
    except service.MockUnavailable:
        raise _unavailable() from None
    row = MockInterview(
        user_id=user.id,
        job_id=job.id if job else None,
        interview_type=payload.interview_type,
        title=(f"{job.title}{' at ' + job.company if job.company else ''} · {payload.interview_type}") if job and job.title else f"{payload.interview_type} practice",
        turns=[{"index": i, "question": q["text"], "kind": q["kind"], "answer": None, "feedback": None} for i, q in enumerate(questions)],
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return _out(row)


@router.get("/{mock_id}", response_model=MockOut)
async def get_mock(mock_id: UUID, user: User = Depends(get_verified_user), db: AsyncSession = Depends(get_db)) -> MockOut:
    return _out(await _owned(mock_id, user, db))


@router.post(
    "/{mock_id}/turns/{index}/answer",
    response_model=MockOut,
    dependencies=[Depends(rate_limit("mock_answer", 60, 3600))],
)
async def answer_turn(
    mock_id: UUID, index: int, payload: MockAnswerIn, user: User = Depends(get_verified_user), db: AsyncSession = Depends(get_db)
) -> MockOut:
    row = await _owned(mock_id, user, db)
    if row.state != "active":
        raise AppError("MOCK_FINISHED", "This practice interview is finished.", 409)
    turns = [dict(t) for t in (row.turns or [])]
    if not 0 <= index < len(turns):
        raise AppError("TURN_NOT_FOUND", "That question does not exist.", 404)
    job, experiences, skills, language = await _context(user, row.job_id, db)
    try:
        feedback = await service.evaluate_answer(
            turns[index]["question"], turns[index].get("kind", "General"), payload.answer.strip(), language, job, experiences, skills
        )
    except service.MockUnavailable:
        raise _unavailable() from None
    turns[index]["answer"] = payload.answer.strip()
    turns[index]["feedback"] = feedback
    row.turns = turns  # reassign so the change is saved
    await db.commit()
    await db.refresh(row)
    return _out(row)


@router.post("/{mock_id}/finish", response_model=MockOut, dependencies=[Depends(rate_limit("mock_finish", 30, 3600))])
async def finish_mock(mock_id: UUID, user: User = Depends(get_verified_user), db: AsyncSession = Depends(get_db)) -> MockOut:
    row = await _owned(mock_id, user, db)
    if row.state == "finished":
        return _out(row)
    job, _, _, language = await _context(user, row.job_id, db)
    try:
        row.summary = await service.summarize(list(row.turns or []), language, job)
    except service.MockUnavailable:
        raise _unavailable() from None
    row.state = "finished"
    row.finished_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(row)
    return _out(row)


@router.delete("/{mock_id}", status_code=204)
async def delete_mock(mock_id: UUID, user: User = Depends(get_verified_user), db: AsyncSession = Depends(get_db)) -> None:
    row = await _owned(mock_id, user, db)
    await db.delete(row)
    await db.commit()
