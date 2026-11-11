from pydantic import BaseModel

from app.modules.profile.schemas import DocumentOut, ExperienceItemOut, SkillOut


class DocumentDetailOut(BaseModel):
    document: DocumentOut
    items: list[ExperienceItemOut]


class DocumentUploadResponse(BaseModel):
    document: DocumentOut
    extracted_items: list[ExperienceItemOut]
    extracted_skills: list[SkillOut]
    suggested_headline: str = ""
    suggested_summary: str = ""
    suggested_location: str = ""

