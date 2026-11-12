from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

from typing import Literal

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.database import get_db
from app.core.deps import get_verified_user
from app.core.errors import AppError
from app.core.rate_limit import rate_limit
from app.core.security import create_session_ws_token
from app.db.models import (
    AuditEvent,
    CandidateDocument,
    CandidateExperience,
    CandidateSkill,
    GeneratedSuggestion,
    InterviewPreferences,
    InterviewSession,
    JobDescription,
    Profile,
    SessionNote,
    TranscriptSegment,
    User,
    UserConsent,
)
from app.modules.sessions.grounding import generate_answer
from app.modules.sessions.retention import purge_expired_transcripts
from app.modules.sessions.schemas import (
    CleanupExpiredOut,
    SessionCreateIn,
    SessionOut,
    SessionSuggestIn,
    SessionTokenOut,
    SessionUpdateIn,
    SuggestionFeedbackIn,
    SuggestionOut,
    TranscriptResponse,
    TranscriptSegmentOut,
)

router = APIRouter(prefix="/v1/sessions", tags=["sessions"])
export_router = APIRouter(prefix="/v1/me", tags=["account"])


async def _build_session_out(session_row: InterviewSession, db: AsyncSession) -> SessionOut:
    segments = (
        await db.execute(
            select(TranscriptSegment)
            .where(TranscriptSegment.session_id == session_row.id)
            .order_by(TranscriptSegment.sequence.asc())
        )
    ).scalars().all()
    suggestions = (
        await db.execute(
            select(GeneratedSuggestion)
            .where(GeneratedSuggestion.session_id == session_row.id)
            .order_by(GeneratedSuggestion.created_at.asc())
        )
    ).scalars().all()
    note_row = await db.get(SessionNote, session_row.id)

    snapshot = dict(session_row.snapshot or {})
    return SessionOut(
        id=session_row.id,
        user_id=session_row.user_id,
        job_id=session_row.job_id,
        job_title=str(snapshot.get("job_title", "")),
        company=str(snapshot.get("company", "")),
        state=session_row.state,
        duration_min=session_row.duration_min,
        transcript_retained=session_row.transcript_retained,
        reviewed=session_row.reviewed,
        snapshot=snapshot,
        strengths=list(session_row.strengths or []),
        improvements=list(session_row.improvements or []),
        missed_evidence=list(session_row.missed_evidence or []),
        note=note_row.content if note_row else "",
        started_at=session_row.started_at,
        ended_at=session_row.ended_at,
        transcript=[
            TranscriptSegmentOut(
                id=seg.id,
                sequence=seg.sequence,
                speaker=seg.speaker,
                text=seg.text,
                timestamp_label=seg.timestamp_label,
                created_at=seg.created_at,
            )
            for seg in segments
        ]
        if session_row.transcript_retained
        else [],
        questions=[
            SuggestionOut(
                id=s.id,
                question_text=s.question_text,
                question_type=s.question_type,
                asked_at=s.asked_at,
                framework=s.framework,
                outline=list(s.outline or []),
                evidence_ref=s.evidence_ref,
                caveat=s.caveat,
                feedback=s.feedback,  # type: ignore[arg-type]
            )
            for s in suggestions
        ],
    )


async def _get_owned_session(session_id: UUID, user_id: UUID, db: AsyncSession) -> InterviewSession:
    row = (
        await db.execute(
            select(InterviewSession).where(
                InterviewSession.id == session_id,
                InterviewSession.user_id == user_id,
            )
        )
    ).scalar_one_or_none()
    if not row:
        raise AppError(code="session_not_found", message="Interview session not found.", status_code=404)
    return row


def require_rules_acknowledgement(session_row: InterviewSession) -> None:
    """A live session cannot start until the user confirmed the interview-rules acknowledgement (FR-14)."""
    if not (session_row.snapshot or {}).get("rules_acknowledged_at"):
        raise AppError(
            code="RULES_ACK_REQUIRED",
            message="Confirm the interview-rules acknowledgement before starting a live session.",
            status_code=412,
        )


async def finalize_session_row(session_row: InterviewSession, db: AsyncSession) -> None:
    """Marks a session ended, populates default review notes if missing, and prunes unretained transcripts."""
    session_row.state = "ended"
    if session_row.ended_at is None:
        session_row.ended_at = datetime.now(timezone.utc)
    suggestions = (
        await db.execute(
            select(GeneratedSuggestion).where(GeneratedSuggestion.session_id == session_row.id)
        )
    ).scalars().all()
    if not session_row.strengths:
        helpful = [s for s in suggestions if s.feedback == "helpful"]
        if helpful:
            session_row.strengths = [f"Grounded answer using {s.evidence_ref}" for s in helpful[:3]]
        elif suggestions:
            session_row.strengths = [f"Anchored answers in {suggestions[0].evidence_ref}"]
    if not session_row.missed_evidence:
        caveated = [s for s in suggestions if s.caveat]
        if caveated:
            session_row.missed_evidence = [
                f"{s.question_text[:80]} ({s.caveat})" for s in caveated[:3]
            ]
    if not session_row.transcript_retained:
        await db.execute(
            delete(TranscriptSegment).where(TranscriptSegment.session_id == session_row.id)
        )


@router.get("", response_model=list[SessionOut])
async def list_sessions(
    user: User = Depends(get_verified_user),
    db: AsyncSession = Depends(get_db),
) -> list[SessionOut]:
    await purge_expired_transcripts(db, user_id=user.id)
    rows = (
        await db.execute(
            select(InterviewSession)
            .where(InterviewSession.user_id == user.id)
            .order_by(InterviewSession.started_at.desc())
        )
    ).scalars().all()
    return [await _build_session_out(row, db) for row in rows]


@router.post(
    "",
    response_model=SessionOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(rate_limit("session_create", 30, 3600))],
)
async def create_session(
    payload: SessionCreateIn,
    user: User = Depends(get_verified_user),
    db: AsyncSession = Depends(get_db),
) -> SessionOut:
    settings = get_settings()
    day_ago = datetime.now(timezone.utc) - timedelta(hours=24)
    recent_count = await db.scalar(
        select(func.count(InterviewSession.id)).where(
            InterviewSession.user_id == user.id,
            InterviewSession.started_at >= day_ago,
        )
    )
    if (recent_count or 0) >= settings.daily_session_quota:
        raise AppError(
            code="QUOTA_EXCEEDED",
            message="Daily interview session limit reached. Try again later.",
            status_code=429,
            details={"daily_limit": settings.daily_session_quota},
        )

    prefs = await db.get(InterviewPreferences, user.id)
    if not prefs:
        prefs = InterviewPreferences(user_id=user.id)
        db.add(prefs)
        await db.flush()

    job: JobDescription | None = None
    if payload.job_id:
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

    verified_count = len(
        (
            await db.execute(
                select(CandidateExperience).where(
                    CandidateExperience.user_id == user.id,
                    CandidateExperience.active.is_(True),
                )
            )
        ).scalars().all()
    )

    retain = (
        payload.transcript_retained
        if payload.transcript_retained is not None
        else prefs.retain_transcript_default
    )
    row = InterviewSession(
        user_id=user.id,
        job_id=job.id if job else None,
        state=payload.state,
        transcript_retained=retain,
        snapshot={
            "job_title": job.title if job else "General Interview",
            "company": job.company if job else "",
            "interview_type": payload.interview_type or "Mixed",
            "framework": prefs.framework,
            "length": prefs.length,
            "style": prefs.style,
            "verified_items_count": verified_count,
            **(
                {"rules_acknowledged_at": datetime.now(timezone.utc).isoformat()}
                if payload.rules_acknowledged
                else {}
            ),
        },
    )
    db.add(row)
    await db.flush()
    db.add(
        AuditEvent(
            user_id=user.id,
            event_type="session_started",
            metadata_json={"session_id": str(row.id)},
        )
    )
    await db.commit()
    await db.refresh(row)
    return await _build_session_out(row, db)


@router.get("/{session_id}", response_model=SessionOut)
async def get_session(
    session_id: UUID,
    user: User = Depends(get_verified_user),
    db: AsyncSession = Depends(get_db),
) -> SessionOut:
    await purge_expired_transcripts(db, user_id=user.id)
    row = await _get_owned_session(session_id, user.id, db)
    return await _build_session_out(row, db)


@router.post(
    "/{session_id}/token",
    response_model=SessionTokenOut,
    dependencies=[Depends(rate_limit("ws_token", 30, 300))],
)
async def issue_session_ws_token(
    session_id: UUID,
    role: Literal["capture", "display"] = Query(default="capture"),
    user: User = Depends(get_verified_user),
    db: AsyncSession = Depends(get_db),
) -> SessionTokenOut:
    session_row = await _get_owned_session(session_id, user.id, db)
    if session_row.state == "ended":
        raise AppError(
            code="SESSION_ENDED",
            message="Cannot open a live stream on a finalized session.",
            status_code=409,
        )
    require_rules_acknowledgement(session_row)
    settings = get_settings()
    ws_token, expires_at = create_session_ws_token(
        user_id=user.id,
        session_id=session_row.id,
        minutes=settings.max_session_minutes,
        role=role,
    )
    return SessionTokenOut(
        session_id=session_row.id,
        ws_token=ws_token,
        ws_path=f"/v1/live/{session_row.id}",
        expires_at=expires_at,
    )


@router.post("/{session_id}/stop", response_model=SessionOut)
async def stop_session(
    session_id: UUID,
    user: User = Depends(get_verified_user),
    db: AsyncSession = Depends(get_db),
) -> SessionOut:
    session_row = await _get_owned_session(session_id, user.id, db)
    await finalize_session_row(session_row, db)
    db.add(
        AuditEvent(
            user_id=user.id,
            event_type="session_stopped",
            metadata_json={"session_id": str(session_id)},
        )
    )
    await db.commit()
    await db.refresh(session_row)
    return await _build_session_out(session_row, db)


@router.get("/{session_id}/transcript", response_model=TranscriptResponse)
async def get_session_transcript(
    session_id: UUID,
    user: User = Depends(get_verified_user),
    db: AsyncSession = Depends(get_db),
) -> TranscriptResponse:
    await purge_expired_transcripts(db, user_id=user.id)
    session_row = await _get_owned_session(session_id, user.id, db)
    if not session_row.transcript_retained:
        return TranscriptResponse(session_id=session_row.id, retained=False, segments=[])
    segments = (
        await db.execute(
            select(TranscriptSegment)
            .where(TranscriptSegment.session_id == session_row.id)
            .order_by(TranscriptSegment.sequence.asc())
        )
    ).scalars().all()
    return TranscriptResponse(
        session_id=session_row.id,
        retained=True,
        segments=[
            TranscriptSegmentOut(
                id=seg.id,
                sequence=seg.sequence,
                speaker=seg.speaker,
                text=seg.text,
                timestamp_label=seg.timestamp_label,
                created_at=seg.created_at,
            )
            for seg in segments
        ],
    )


@router.get("/{session_id}/answers", response_model=list[SuggestionOut])
@router.get("/{session_id}/suggestions", response_model=list[SuggestionOut])
async def list_session_suggestions(
    session_id: UUID,
    user: User = Depends(get_verified_user),
    db: AsyncSession = Depends(get_db),
) -> list[SuggestionOut]:
    await _get_owned_session(session_id, user.id, db)
    suggestions = (
        await db.execute(
            select(GeneratedSuggestion)
            .where(GeneratedSuggestion.session_id == session_id)
            .order_by(GeneratedSuggestion.created_at.asc())
        )
    ).scalars().all()
    return [
        SuggestionOut(
            id=s.id,
            question_text=s.question_text,
            question_type=s.question_type,
            asked_at=s.asked_at,
            framework=s.framework,
            outline=list(s.outline or []),
            evidence_ref=s.evidence_ref,
            caveat=s.caveat,
            feedback=s.feedback,  # type: ignore[arg-type]
        )
        for s in suggestions
    ]


@router.post("/cleanup-expired", response_model=CleanupExpiredOut)
async def cleanup_expired_sessions(
    user: User = Depends(get_verified_user),
    db: AsyncSession = Depends(get_db),
) -> CleanupExpiredOut:
    purged = await purge_expired_transcripts(db, user_id=user.id)
    return CleanupExpiredOut(purged_sessions=purged)


@router.post(
    "/{session_id}/suggest",
    response_model=SuggestionOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(rate_limit("session_suggest", 60, 300))],
)
async def create_session_suggestion(
    session_id: UUID,
    payload: SessionSuggestIn,
    user: User = Depends(get_verified_user),
    db: AsyncSession = Depends(get_db),
) -> SuggestionOut:
    session_row = await _get_owned_session(session_id, user.id, db)
    prefs = await db.get(InterviewPreferences, user.id)
    if not prefs:
        prefs = InterviewPreferences(user_id=user.id)

    job = await db.get(JobDescription, session_row.job_id) if session_row.job_id else None
    experiences = (
        await db.execute(
            select(CandidateExperience).where(CandidateExperience.user_id == user.id)
        )
    ).scalars().all()
    skills = (
        await db.execute(select(CandidateSkill).where(CandidateSkill.user_id == user.id))
    ).scalars().all()

    answer = await generate_answer(
        question_text=payload.question_text.strip(),
        question_type=payload.question_type.strip() or "Behavioral",
        prefs=prefs,
        experiences=experiences,
        skills=skills,
        job=job,
    )
    if not answer.available:
        raise AppError(
            code="ANSWER_UNAVAILABLE",
            message="An answer could not be generated right now.",
            status_code=503,
            details={"reason": answer.reason},
        )
    framework, outline = answer.framework, answer.lines
    evidence_ref, caveat = answer.source_label, answer.caveat

    if session_row.transcript_retained:
        existing_segs = (
            await db.execute(
                select(TranscriptSegment).where(TranscriptSegment.session_id == session_row.id)
            )
        ).scalars().all()
        db.add(
            TranscriptSegment(
                session_id=session_row.id,
                user_id=user.id,
                sequence=len(existing_segs) + 1,
                speaker="Interviewer",
                text=payload.question_text.strip(),
                timestamp_label=payload.asked_at.strip() or "Live",
            )
        )

    suggestion = GeneratedSuggestion(
        session_id=session_row.id,
        user_id=user.id,
        question_text=payload.question_text.strip(),
        question_type=payload.question_type.strip() or "Behavioral",
        asked_at=payload.asked_at.strip() or "Live",
        framework=framework,
        outline=outline,
        evidence_ref=evidence_ref,
        caveat=caveat,
        feedback="none",
    )
    db.add(suggestion)
    await db.commit()
    await db.refresh(suggestion)
    return SuggestionOut(
        id=suggestion.id,
        question_text=suggestion.question_text,
        question_type=suggestion.question_type,
        asked_at=suggestion.asked_at,
        framework=suggestion.framework,
        outline=list(suggestion.outline or []),
        evidence_ref=suggestion.evidence_ref,
        caveat=suggestion.caveat,
        feedback=suggestion.feedback,  # type: ignore[arg-type]
    )


@router.patch("/{session_id}", response_model=SessionOut)
async def update_session(
    session_id: UUID,
    payload: SessionUpdateIn,
    user: User = Depends(get_verified_user),
    db: AsyncSession = Depends(get_db),
) -> SessionOut:
    session_row = await _get_owned_session(session_id, user.id, db)
    updates = payload.model_dump(exclude_unset=True)

    if "note" in updates:
        note_content = updates.pop("note") or ""
        note_row = await db.get(SessionNote, session_row.id)
        if note_row:
            note_row.content = note_content
            note_row.updated_at = datetime.now(timezone.utc)
        else:
            db.add(SessionNote(session_id=session_row.id, user_id=user.id, content=note_content))

    for field_name, value in updates.items():
        setattr(session_row, field_name, value)

    if session_row.state == "ended" and session_row.ended_at is None:
        await finalize_session_row(session_row, db)
    elif not session_row.transcript_retained:
        await db.execute(
            delete(TranscriptSegment).where(TranscriptSegment.session_id == session_row.id)
        )

    await db.commit()
    await db.refresh(session_row)
    return await _build_session_out(session_row, db)


@router.patch("/{session_id}/suggestions/{suggestion_id}/feedback", response_model=SuggestionOut)
async def set_suggestion_feedback(
    session_id: UUID,
    suggestion_id: UUID,
    payload: SuggestionFeedbackIn,
    user: User = Depends(get_verified_user),
    db: AsyncSession = Depends(get_db),
) -> SuggestionOut:
    await _get_owned_session(session_id, user.id, db)
    suggestion = (
        await db.execute(
            select(GeneratedSuggestion).where(
                GeneratedSuggestion.id == suggestion_id,
                GeneratedSuggestion.session_id == session_id,
                GeneratedSuggestion.user_id == user.id,
            )
        )
    ).scalar_one_or_none()
    if not suggestion:
        raise AppError(
            code="suggestion_not_found",
            message="Generated suggestion not found.",
            status_code=404,
        )
    suggestion.feedback = payload.feedback
    await db.commit()
    await db.refresh(suggestion)
    return SuggestionOut(
        id=suggestion.id,
        question_text=suggestion.question_text,
        question_type=suggestion.question_type,
        asked_at=suggestion.asked_at,
        framework=suggestion.framework,
        outline=list(suggestion.outline or []),
        evidence_ref=suggestion.evidence_ref,
        caveat=suggestion.caveat,
        feedback=suggestion.feedback,  # type: ignore[arg-type]
    )


@router.delete("/{session_id}")
async def delete_session(
    session_id: UUID,
    user: User = Depends(get_verified_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    session_row = await _get_owned_session(session_id, user.id, db)
    await db.delete(session_row)
    db.add(
        AuditEvent(
            user_id=user.id,
            event_type="session_deleted",
            metadata_json={"session_id": str(session_id)},
        )
    )
    await db.commit()
    return {"status": "deleted"}


@router.delete("")
async def delete_all_sessions(
    user: User = Depends(get_verified_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    await db.execute(delete(InterviewSession).where(InterviewSession.user_id == user.id))
    db.add(AuditEvent(user_id=user.id, event_type="all_sessions_deleted", metadata_json={}))
    await db.commit()
    return {"status": "deleted"}


@export_router.get("/export")
async def export_user_data(
    user: User = Depends(get_verified_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    profile = await db.get(Profile, user.id)
    prefs = await db.get(InterviewPreferences, user.id)
    docs = (
        await db.execute(select(CandidateDocument).where(CandidateDocument.user_id == user.id))
    ).scalars().all()
    items = (
        await db.execute(select(CandidateExperience).where(CandidateExperience.user_id == user.id))
    ).scalars().all()
    skills = (
        await db.execute(select(CandidateSkill).where(CandidateSkill.user_id == user.id))
    ).scalars().all()
    jobs = (
        await db.execute(select(JobDescription).where(JobDescription.user_id == user.id))
    ).scalars().all()
    consents = (
        await db.execute(select(UserConsent).where(UserConsent.user_id == user.id))
    ).scalars().all()
    sessions = (
        await db.execute(select(InterviewSession).where(InterviewSession.user_id == user.id))
    ).scalars().all()
    exported_sessions = [await _build_session_out(s, db) for s in sessions]

    return {
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "user": {
            "id": str(user.id),
            "email": user.email,
            "verified": user.is_verified,
            "onboarded": user.onboarded,
            "created_at": user.created_at.isoformat(),
        },
        "profile": {
            "full_name": profile.full_name if profile else "",
            "headline": profile.headline if profile else "",
            "summary": profile.summary if profile else "",
            "location": profile.location if profile else "",
            "language": profile.language if profile else "English",
            "role_focus": profile.role_focus if profile else "",
            "verified_at": profile.verified_at.isoformat() if (profile and profile.verified_at) else None,
        },
        "documents": [
            {
                "id": str(d.id),
                "file_name": d.file_name,
                "mime_type": d.mime_type,
                "size_bytes": d.size_bytes,
                "page_count": d.page_count,
                "status": d.status,
                "created_at": d.created_at.isoformat(),
            }
            for d in docs
        ],
        "profile_items": [
            {
                "id": str(i.id),
                "kind": i.kind,
                "title": i.title,
                "organization": i.organization,
                "dates_text": i.dates_text,
                "summary": i.summary,
                "origin": i.origin,
                "active": i.active,
            }
            for i in items
        ],
        "skills": [{"id": str(s.id), "name": s.name, "origin": s.origin} for s in skills],
        "jobs": [
            {
                "id": str(j.id),
                "title": j.title,
                "company": j.company,
                "seniority": j.seniority,
                "required_skills": j.required_skills,
                "themes": j.themes,
                "archived": j.archived,
            }
            for j in jobs
        ],
        "preferences": {
            "language": prefs.language if prefs else "English",
            "length": prefs.length if prefs else "Concise",
            "style": prefs.style if prefs else "Natural",
            "framework": prefs.framework if prefs else "Auto",
            "retain_transcript_default": prefs.retain_transcript_default if prefs else False,
            "notes_default": prefs.notes_default if prefs else True,
            "retention_days": prefs.retention_days if prefs else 30,
        },
        "consents": [
            {
                "id": str(c.id),
                "consent_type": c.consent_type,
                "label": c.label,
                "created_at": c.created_at.isoformat(),
            }
            for c in consents
        ],
        "sessions": [s.model_dump(mode="json") for s in exported_sessions],
    }

