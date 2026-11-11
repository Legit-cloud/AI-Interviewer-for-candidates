from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

SeniorityType = Literal["Junior", "Mid-level", "Senior", "Lead", "Staff", "Executive"]


class JobExtractIn(BaseModel):
    raw_text: str = Field(min_length=10, max_length=30000)
    title: str = Field(default="", max_length=200)
    company: str = Field(default="", max_length=200)
    source: str = Field(default="manual", max_length=60)


class JobExtractOut(BaseModel):
    title: str
    company: str
    seniority: str
    responsibilities: list[str]
    required_skills: list[str]
    preferred_skills: list[str]
    themes: list[str]


class JobCreateIn(BaseModel):
    title: str = Field(default="", max_length=200)
    company: str = Field(default="", max_length=200)
    seniority: str = Field(default="", max_length=60)
    source: str = Field(default="manual", max_length=60)
    raw_text: str = Field(default="", max_length=30000)
    responsibilities: list[str] | None = None
    required_skills: list[str] | None = None
    preferred_skills: list[str] | None = None
    themes: list[str] | None = None


class JobUpdateIn(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    company: str | None = Field(default=None, max_length=200)
    seniority: str | None = Field(default=None, max_length=60)
    source: str | None = Field(default=None, max_length=60)
    raw_text: str | None = Field(default=None, max_length=30000)
    responsibilities: list[str] | None = None
    required_skills: list[str] | None = None
    preferred_skills: list[str] | None = None
    themes: list[str] | None = None
    archived: bool | None = None


class JobOut(BaseModel):
    id: UUID
    user_id: UUID
    title: str
    company: str
    seniority: str
    source: str
    raw_text: str
    responsibilities: list[str]
    required_skills: list[str]
    preferred_skills: list[str]
    themes: list[str]
    archived: bool
    created_at: datetime
    updated_at: datetime


class StrongMatchOut(BaseModel):
    requirement: str
    evidence: str
    source: str


class PartialMatchOut(BaseModel):
    requirement: str
    note: str


class GapItemOut(BaseModel):
    requirement: str
    suggestion: str


class GapReportOut(BaseModel):
    job_id: UUID
    fit_score: int
    strong_matches: list[StrongMatchOut]
    partial_matches: list[PartialMatchOut]
    gaps: list[GapItemOut]
    themes: list[str]

