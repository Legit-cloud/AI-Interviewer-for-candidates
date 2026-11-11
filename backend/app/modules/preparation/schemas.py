from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

LengthType = Literal["Concise", "Balanced", "Detailed"]
StyleType = Literal["Natural", "Executive", "Technical"]
FrameworkType = Literal["Auto", "STAR", "Direct"]


class ConsentEventOut(BaseModel):
    id: UUID
    consent_type: str
    label: str
    detail: str
    created_at: datetime


class PreferencesOut(BaseModel):
    language: str
    length: str
    style: str
    framework: str
    retain_transcript_default: bool
    notes_default: bool
    retention_days: int
    product_emails: bool
    updated_at: datetime
    consent_history: list[ConsentEventOut] = []


class PreferencesUpdateIn(BaseModel):
    language: str | None = Field(default=None, max_length=40)
    length: str | None = Field(default=None, max_length=40)
    style: str | None = Field(default=None, max_length=40)
    framework: str | None = Field(default=None, max_length=80)
    retain_transcript_default: bool | None = None
    notes_default: bool | None = None
    retention_days: int | None = Field(default=None, ge=1, le=365)
    product_emails: bool | None = None


class PrepGenerateIn(BaseModel):
    job_id: UUID


class PrepTalkingPoint(BaseModel):
    theme: str
    prompt_example: str
    outline: list[str]
    evidence_ref: str
    caveat: str = ""


class PrepBriefOut(BaseModel):
    job_id: UUID
    job_title: str
    company: str
    framework: str
    talking_points: list[PrepTalkingPoint]
    checklist: list[str]
