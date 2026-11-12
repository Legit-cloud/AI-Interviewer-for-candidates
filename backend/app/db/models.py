from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Index, Integer, String, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, JSONType, UUIDPrimaryKeyMixin, utcnow


# ---------------------------------------------------------------------------
# Local Authentication Tables (replaced by Supabase Auth when migrating)
# ---------------------------------------------------------------------------


class User(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "users"

    email: Mapped[str] = mapped_column(String(320), unique=True, index=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    is_verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    onboarded: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    profile: Mapped["Profile | None"] = relationship(
        back_populates="user", uselist=False, cascade="all, delete-orphan"
    )
    preferences: Mapped["InterviewPreferences | None"] = relationship(
        back_populates="user", uselist=False, cascade="all, delete-orphan"
    )
    auth_tokens: Mapped[list["AuthToken"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )


class AuthToken(UUIDPrimaryKeyMixin, Base):
    """Stores hashed refresh, email-verification, and password-reset tokens."""

    __tablename__ = "auth_tokens"
    __table_args__ = (Index("ix_auth_tokens_user_kind", "user_id", "kind"),)

    user_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    token_hash: Mapped[str] = mapped_column(String(128), unique=True, index=True, nullable=False)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)  # refresh | verify_email | reset_password
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    user: Mapped["User"] = relationship(back_populates="auth_tokens")


# ---------------------------------------------------------------------------
# PRD §17.1 Core Domain Tables (Supabase-ready: user_id ownership + RLS)
# ---------------------------------------------------------------------------


class Profile(Base):
    __tablename__ = "profiles"

    user_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    full_name: Mapped[str] = mapped_column(String(160), default="", nullable=False)
    headline: Mapped[str] = mapped_column(String(200), default="", nullable=False)
    summary: Mapped[str] = mapped_column(Text, default="", nullable=False)
    location: Mapped[str] = mapped_column(String(160), default="", nullable=False)
    language: Mapped[str] = mapped_column(String(64), default="English", nullable=False)
    role_focus: Mapped[str] = mapped_column(String(160), default="", nullable=False)
    checklist_dismissed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False
    )

    user: Mapped["User"] = relationship(back_populates="profile")


class CandidateDocument(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "candidate_documents"
    __table_args__ = (Index("ix_candidate_documents_user_created", "user_id", "created_at"),)

    user_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(120), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    page_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    storage_key: Mapped[str] = mapped_column(String(512), nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="processing", nullable=False)  # processing | processed | failed
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class CandidateExperience(UUIDPrimaryKeyMixin, Base):
    """Structured roles, education, projects, and certifications."""

    __tablename__ = "candidate_experiences"
    __table_args__ = (Index("ix_candidate_experiences_user_active", "user_id", "active"),)

    user_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    document_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("candidate_documents.id", ondelete="SET NULL"), nullable=True
    )
    kind: Mapped[str] = mapped_column(String(32), default="experience", nullable=False)  # experience | education | project | certification
    title: Mapped[str] = mapped_column(String(200), default="", nullable=False)
    organization: Mapped[str] = mapped_column(String(200), default="", nullable=False)
    dates_text: Mapped[str] = mapped_column(String(120), default="", nullable=False)
    summary: Mapped[str] = mapped_column(Text, default="", nullable=False)
    origin: Mapped[str] = mapped_column(String(24), default="extracted", nullable=False)  # extracted | verified | missing
    confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    source_location: Mapped[str | None] = mapped_column(String(120), nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False
    )


class CandidateSkill(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "candidate_skills"
    __table_args__ = (Index("ix_candidate_skills_user_norm", "user_id", "normalized_name"),)

    user_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    normalized_name: Mapped[str] = mapped_column(String(120), nullable=False)
    origin: Mapped[str] = mapped_column(String(24), default="extracted", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class JobDescription(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "job_descriptions"
    __table_args__ = (Index("ix_job_descriptions_user_arch_upd", "user_id", "archived", "updated_at"),)

    user_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    company: Mapped[str] = mapped_column(String(160), default="Unspecified", nullable=False)
    seniority: Mapped[str] = mapped_column(String(64), default="Senior", nullable=False)
    source: Mapped[str] = mapped_column(String(24), default="paste", nullable=False)  # paste | upload
    raw_text: Mapped[str] = mapped_column(Text, nullable=False)
    responsibilities: Mapped[list[str]] = mapped_column(JSONType, default=list, nullable=False)
    required_skills: Mapped[list[str]] = mapped_column(JSONType, default=list, nullable=False)
    preferred_skills: Mapped[list[str]] = mapped_column(JSONType, default=list, nullable=False)
    themes: Mapped[list[str]] = mapped_column(JSONType, default=list, nullable=False)
    archived: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False
    )


class InterviewPreferences(Base):
    __tablename__ = "interview_preferences"

    user_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    language: Mapped[str] = mapped_column(String(64), default="English", nullable=False)
    # Language the answers are written in. Empty means "same as the interview language".
    answer_language: Mapped[str] = mapped_column(String(64), default="", nullable=False)
    length: Mapped[str] = mapped_column(String(32), default="Brief", nullable=False)
    style: Mapped[str] = mapped_column(String(32), default="Structured", nullable=False)
    framework: Mapped[str] = mapped_column(String(64), default="STAR", nullable=False)
    retain_transcript_default: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    notes_default: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    retention_days: Mapped[int] = mapped_column(Integer, default=90, nullable=False)
    product_emails: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False
    )

    user: Mapped["User"] = relationship(back_populates="preferences")


class InterviewSession(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "interview_sessions"
    __table_args__ = (Index("ix_interview_sessions_user_started", "user_id", "started_at"),)

    user_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    job_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("job_descriptions.id", ondelete="SET NULL"), nullable=True
    )
    state: Mapped[str] = mapped_column(String(32), default="created", nullable=False)
    duration_min: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    transcript_retained: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    reviewed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    snapshot: Mapped[dict[str, Any]] = mapped_column(JSONType, default=dict, nullable=False)
    strengths: Mapped[list[str]] = mapped_column(JSONType, default=list, nullable=False)
    improvements: Mapped[list[str]] = mapped_column(JSONType, default=list, nullable=False)
    missed_evidence: Mapped[list[str]] = mapped_column(JSONType, default=list, nullable=False)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class TranscriptSegment(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "transcript_segments"
    __table_args__ = (Index("ix_transcript_segments_session_seq", "session_id", "sequence"),)

    session_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("interview_sessions.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    sequence: Mapped[int] = mapped_column(Integer, nullable=False)
    speaker: Mapped[str] = mapped_column(String(32), default="Interviewer", nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    timestamp_label: Mapped[str] = mapped_column(String(16), default="00:00", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class GeneratedSuggestion(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "generated_suggestions"
    __table_args__ = (Index("ix_generated_suggestions_session_created", "session_id", "created_at"),)

    session_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("interview_sessions.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    question_text: Mapped[str] = mapped_column(Text, nullable=False)
    question_type: Mapped[str] = mapped_column(String(64), default="General", nullable=False)
    asked_at: Mapped[str] = mapped_column(String(16), default="00:00", nullable=False)
    framework: Mapped[str] = mapped_column(String(64), default="STAR", nullable=False)
    outline: Mapped[list[str]] = mapped_column(JSONType, default=list, nullable=False)
    evidence_ref: Mapped[str | None] = mapped_column(Text, nullable=True)
    caveat: Mapped[str | None] = mapped_column(Text, nullable=True)
    feedback: Mapped[str | None] = mapped_column(String(24), nullable=True)  # useful | not_useful | incorrect
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class PairingCode(UUIDPrimaryKeyMixin, Base):
    """Short-lived, single-use code that links the extension to a web-created live session."""

    __tablename__ = "pairing_codes"
    __table_args__ = (Index("ix_pairing_codes_hash", "code_hash"),)

    session_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("interview_sessions.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    code_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    redeemed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class SessionNote(Base):
    __tablename__ = "session_notes"

    session_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("interview_sessions.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    content: Mapped[str] = mapped_column(Text, default="", nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False
    )


class UserConsent(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "user_consents"
    __table_args__ = (Index("ix_user_consents_user_type_created", "user_id", "consent_type", "created_at"),)

    user_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    consent_type: Mapped[str] = mapped_column(String(64), nullable=False)
    label: Mapped[str] = mapped_column(String(200), nullable=False)
    detail: Mapped[str] = mapped_column(String(300), default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class AuditEvent(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "audit_events"

    user_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), index=True, nullable=True)
    event_type: Mapped[str] = mapped_column(String(80), index=True, nullable=False)
    metadata_json: Mapped[dict[str, Any]] = mapped_column(JSONType, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

