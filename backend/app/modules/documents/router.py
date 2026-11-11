from datetime import datetime, timezone
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, File, UploadFile, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.adapters.cv_parser import parse_and_sort_cv
from app.adapters.storage import LocalStorageAdapter, get_storage_adapter
from app.core.database import get_db
from app.core.deps import get_verified_user
from app.core.errors import AppError
from app.core.rate_limit import rate_limit
from app.db.models import (
    AuditEvent,
    CandidateDocument,
    CandidateExperience,
    CandidateSkill,
    Profile,
    User,
)
from app.modules.documents.schemas import DocumentDetailOut, DocumentUploadResponse
from app.modules.profile.router import _to_item_out
from app.modules.profile.schemas import DocumentOut, SkillOut

router = APIRouter(prefix="/v1/documents", tags=["documents"])


def _to_doc_out(doc: CandidateDocument) -> DocumentOut:
    return DocumentOut(
        id=doc.id,
        file_name=doc.file_name,
        mime_type=doc.mime_type,
        size_bytes=doc.size_bytes,
        page_count=doc.page_count,
        status=doc.status,
        error_message=doc.error_message,
        created_at=doc.created_at,
    )


@router.get("", response_model=list[DocumentOut])
async def list_documents(
    user: User = Depends(get_verified_user),
    db: AsyncSession = Depends(get_db),
) -> list[DocumentOut]:
    docs = (
        await db.execute(
            select(CandidateDocument)
            .where(CandidateDocument.user_id == user.id)
            .order_by(CandidateDocument.created_at.desc())
        )
    ).scalars().all()
    return [_to_doc_out(d) for d in docs]


@router.post(
    "",
    response_model=DocumentUploadResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(rate_limit("document_upload", 12, 300))],
)
async def upload_and_sort_document(
    file: UploadFile = File(...),
    user: User = Depends(get_verified_user),
    db: AsyncSession = Depends(get_db),
    storage: LocalStorageAdapter = Depends(get_storage_adapter),
) -> DocumentUploadResponse:
    raw_bytes = await file.read()
    filename = file.filename or "cv.pdf"
    parsed = await parse_and_sort_cv(filename=filename, content_type=file.content_type, data=raw_bytes)

    doc_id = uuid4()
    storage_key = storage.save_bytes(user.id, doc_id, filename, raw_bytes)

    doc = CandidateDocument(
        id=doc_id,
        user_id=user.id,
        file_name=filename[:255],
        mime_type=parsed.mime_type,
        size_bytes=len(raw_bytes),
        page_count=parsed.page_count,
        storage_key=storage_key,
        status="parsed",
        error_message=None,
    )
    db.add(doc)
    await db.flush()

    created_items: list[CandidateExperience] = []
    for item in parsed.items:
        row = CandidateExperience(
            user_id=user.id,
            document_id=doc.id,
            kind=item.kind,
            title=item.title,
            organization=item.organization,
            dates_text=item.dates_text,
            summary=item.summary,
            origin="extracted",
            confidence=item.confidence,
            source_location=item.source_location,
            active=True,
        )
        db.add(row)
        created_items.append(row)

    existing_skills = {
        s.normalized_name: s
        for s in (
            await db.execute(select(CandidateSkill).where(CandidateSkill.user_id == user.id))
        ).scalars().all()
    }
    added_skills: list[CandidateSkill] = []
    for sk in parsed.skills:
        if sk.normalized_name not in existing_skills:
            row = CandidateSkill(
                user_id=user.id,
                name=sk.name,
                normalized_name=sk.normalized_name,
                origin="extracted",
            )
            db.add(row)
            existing_skills[sk.normalized_name] = row
            added_skills.append(row)

    profile = await db.get(Profile, user.id)
    if profile:
        if not profile.headline and parsed.headline:
            profile.headline = parsed.headline
        if not profile.summary and parsed.summary:
            profile.summary = parsed.summary
        if not profile.location and parsed.location:
            profile.location = parsed.location
        profile.updated_at = datetime.now(timezone.utc)

    db.add(
        AuditEvent(
            user_id=user.id,
            event_type="document_uploaded",
            metadata_json={
                "document_id": str(doc.id),
                "page_count": parsed.page_count,
                "items_extracted": len(created_items),
                "skills_added": len(added_skills),
            },
        )
    )
    await db.commit()
    await db.refresh(doc)
    for row in created_items:
        await db.refresh(row)
    for row in added_skills:
        await db.refresh(row)

    return DocumentUploadResponse(
        document=_to_doc_out(doc),
        extracted_items=[_to_item_out(r) for r in created_items],
        extracted_skills=[
            SkillOut(
                id=s.id,
                name=s.name,
                normalized_name=s.normalized_name,
                origin=s.origin,
                created_at=s.created_at,
            )
            for s in added_skills
        ],
        suggested_headline=parsed.headline,
        suggested_summary=parsed.summary,
        suggested_location=parsed.location,
    )


@router.get("/{doc_id}", response_model=DocumentDetailOut)
async def get_document(
    doc_id: UUID,
    user: User = Depends(get_verified_user),
    db: AsyncSession = Depends(get_db),
) -> DocumentDetailOut:
    doc = (
        await db.execute(
            select(CandidateDocument).where(
                CandidateDocument.id == doc_id,
                CandidateDocument.user_id == user.id,
            )
        )
    ).scalar_one_or_none()
    if not doc:
        raise AppError(code="document_not_found", message="Document not found.", status_code=404)

    items = (
        await db.execute(
            select(CandidateExperience)
            .where(
                CandidateExperience.user_id == user.id,
                CandidateExperience.document_id == doc_id,
            )
            .order_by(CandidateExperience.created_at.asc())
        )
    ).scalars().all()
    return DocumentDetailOut(document=_to_doc_out(doc), items=[_to_item_out(i) for i in items])


@router.delete("/{doc_id}")
async def delete_document(
    doc_id: UUID,
    user: User = Depends(get_verified_user),
    db: AsyncSession = Depends(get_db),
    storage: LocalStorageAdapter = Depends(get_storage_adapter),
) -> dict[str, str]:
    doc = (
        await db.execute(
            select(CandidateDocument).where(
                CandidateDocument.id == doc_id,
                CandidateDocument.user_id == user.id,
            )
        )
    ).scalar_one_or_none()
    if not doc:
        raise AppError(code="document_not_found", message="Document not found.", status_code=404)

    # Preserve user-verified profile items while removing unverified items from the deleted CV.
    await db.execute(
        delete(CandidateExperience).where(
            CandidateExperience.user_id == user.id,
            CandidateExperience.document_id == doc_id,
            CandidateExperience.origin != "verified",
        )
    )
    verified_linked = (
        await db.execute(
            select(CandidateExperience).where(
                CandidateExperience.user_id == user.id,
                CandidateExperience.document_id == doc_id,
                CandidateExperience.origin == "verified",
            )
        )
    ).scalars().all()
    for item in verified_linked:
        item.document_id = None

    storage_key = doc.storage_key
    await db.delete(doc)
    db.add(
        AuditEvent(
            user_id=user.id,
            event_type="document_deleted",
            metadata_json={"document_id": str(doc_id)},
        )
    )
    await db.commit()
    storage.delete(storage_key)
    return {"status": "deleted"}

