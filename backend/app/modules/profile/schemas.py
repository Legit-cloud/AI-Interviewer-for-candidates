from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

ExperienceKind = Literal["experience", "education", "project", "certification"]
OriginType = Literal["extracted", "verified", "missing"]


class ExperienceItemOut(BaseModel):
    id: UUID
    document_id: UUID | None = None
    kind: ExperienceKind
    title: str
    organization: str
    dates_text: str
    summary: str
    origin: OriginType
    confidence: float
    source_location: str
    active: bool
    created_at: datetime
    updated_at: datetime


class SkillOut(BaseModel):
    id: UUID
    name: str
    normalized_name: str
    origin: str
    created_at: datetime


class DocumentOut(BaseModel):
    id: UUID
    file_name: str
    mime_type: str
    size_bytes: int
    page_count: int
    status: str
    error_message: str | None = None
    created_at: datetime


class ProfileOut(BaseModel):
    user_id: UUID
    full_name: str
    headline: str
    summary: str
    location: str
    language: str
    role_focus: str
    checklist_dismissed: bool
    verified_at: datetime | None = None
    updated_at: datetime
    experiences: list[ExperienceItemOut] = []
    education: list[ExperienceItemOut] = []
    projects: list[ExperienceItemOut] = []
    certifications: list[ExperienceItemOut] = []
    skills: list[SkillOut] = []
    documents: list[DocumentOut] = []


class ProfileUpdateIn(BaseModel):
    full_name: str | None = Field(default=None, max_length=160)
    headline: str | None = Field(default=None, max_length=200)
    summary: str | None = Field(default=None, max_length=4000)
    location: str | None = Field(default=None, max_length=160)
    language: str | None = Field(default=None, max_length=40)
    role_focus: str | None = Field(default=None, max_length=160)
    checklist_dismissed: bool | None = None


class OnboardingIn(BaseModel):
    full_name: str = Field(min_length=1, max_length=160)
    role_focus: str = Field(default="", max_length=160)
    language: str = Field(default="English", max_length=40)
    ai_consent: bool
    transcript_consent: bool = False


class ExperienceCreateIn(BaseModel):
    kind: ExperienceKind = "experience"
    title: str = Field(min_length=1, max_length=200)
    organization: str = Field(default="", max_length=200)
    dates_text: str = Field(default="", max_length=120)
    summary: str = Field(default="", max_length=3000)
    origin: OriginType = "verified"
    active: bool = True


class ExperienceUpdateIn(BaseModel):
    kind: ExperienceKind | None = None
    title: str | None = Field(default=None, min_length=1, max_length=200)
    organization: str | None = Field(default=None, max_length=200)
    dates_text: str | None = Field(default=None, max_length=120)
    summary: str | None = Field(default=None, max_length=3000)
    origin: OriginType | None = None
    active: bool | None = None


class SkillCreateIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    origin: OriginType = "verified"


class VerifyProfileIn(BaseModel):
    full_name: str | None = Field(default=None, max_length=160)
    headline: str | None = Field(default=None, max_length=200)
    summary: str | None = Field(default=None, max_length=4000)
    location: str | None = Field(default=None, max_length=160)
    language: str | None = Field(default=None, max_length=40)
    role_focus: str | None = Field(default=None, max_length=160)
    skills: list[str] | None = None
    item_ids: list[UUID] | None = None

