from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field

SessionStateType = Literal["ready", "listening", "paused", "ended"]
FeedbackType = Literal["helpful", "not_relevant", "none"]


class TranscriptSegmentOut(BaseModel):
    id: UUID
    sequence: int
    speaker: str
    text: str
    timestamp_label: str
    created_at: datetime


class SuggestionOut(BaseModel):
    id: UUID
    question_text: str
    question_type: str
    asked_at: str
    framework: str
    outline: list[str]
    evidence_ref: str
    caveat: str
    feedback: FeedbackType


class SessionOut(BaseModel):
    id: UUID
    user_id: UUID
    job_id: UUID | None = None
    job_title: str = ""
    company: str = ""
    state: str
    duration_min: int
    transcript_retained: bool
    reviewed: bool
    snapshot: dict[str, Any]
    strengths: list[str]
    improvements: list[str]
    missed_evidence: list[str]
    note: str
    started_at: datetime
    ended_at: datetime | None = None
    transcript: list[TranscriptSegmentOut] = []
    questions: list[SuggestionOut] = []


class SessionCreateIn(BaseModel):
    job_id: UUID | None = None
    state: SessionStateType = "listening"
    transcript_retained: bool | None = None
    interview_type: str | None = Field(default=None, max_length=60)
    rules_acknowledged: bool = False


class SessionSuggestIn(BaseModel):
    question_text: str = Field(min_length=4, max_length=2000)
    question_type: str = Field(default="Behavioral", max_length=60)
    asked_at: str = Field(default="Live", max_length=40)


class SessionUpdateIn(BaseModel):
    state: SessionStateType | None = None
    duration_min: int | None = Field(default=None, ge=0, le=600)
    transcript_retained: bool | None = None
    reviewed: bool | None = None
    note: str | None = Field(default=None, max_length=12000)
    strengths: list[str] | None = None
    improvements: list[str] | None = None
    missed_evidence: list[str] | None = None


class SuggestionFeedbackIn(BaseModel):
    feedback: FeedbackType


class SessionTokenOut(BaseModel):
    session_id: UUID
    ws_token: str
    ws_path: str
    expires_at: datetime


class TranscriptResponse(BaseModel):
    session_id: UUID
    retained: bool
    segments: list[TranscriptSegmentOut] = []


class CleanupExpiredOut(BaseModel):
    purged_sessions: int

