import io
import re
import zipfile
from dataclasses import dataclass, field
from typing import Literal

from docx import Document as DocxDocument
from pypdf import PdfReader

from app.adapters.llm import LLMProviderAdapter, get_llm_adapter
from app.core.config import get_settings
from app.core.errors import AppError

PDF_MIME = "application/pdf"
DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

ExperienceKind = Literal["experience", "education", "project", "certification"]

_DATE_RANGE_RE = re.compile(
    r"((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{4}|(?:19|20)\d{2})\s*(?:-|to|until)\s*((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{4}|(?:19|20)\d{2}|Present|Current|Now)",
    re.IGNORECASE,
)

_SECTION_MAP: dict[str, str] = {
    "experience": "experience",
    "work experience": "experience",
    "professional experience": "experience",
    "employment": "experience",
    "employment history": "experience",
    "career history": "experience",
    "education": "education",
    "academic background": "education",
    "qualifications": "education",
    "projects": "project",
    "selected projects": "project",
    "key projects": "project",
    "certifications": "certification",
    "certificates": "certification",
    "licenses": "certification",
    "licenses & certifications": "certification",
    "skills": "skills",
    "technical skills": "skills",
    "core skills": "skills",
    "core competencies": "skills",
    "competencies": "skills",
    "tools & technologies": "skills",
    "summary": "summary",
    "professional summary": "summary",
    "profile": "summary",
    "about": "summary",
}

_KNOWN_SKILL_CATALOG = [
    # Marketing, Content & Growth
    "SEO",
    "Google Ads",
    "Meta Ads",
    "Paid Social",
    "Google Analytics",
    "GA4",
    "Content Strategy",
    "Copywriting",
    "Email Marketing",
    "Lifecycle Marketing",
    "Brand Strategy",
    "HubSpot",
    "Conversion Rate Optimization",
    "A/B Testing",
    "Experimentation",
    "Activation",
    # 3D Art, Creative & Design
    "Blender",
    "Autodesk Maya",
    "ZBrush",
    "Substance Painter",
    "Unreal Engine",
    "Unity",
    "Cinema 4D",
    "Houdini",
    "3D Modeling",
    "PBR Texturing",
    "UV Mapping",
    "Rigging",
    "Lighting & Rendering",
    "Motion Graphics",
    "Adobe After Effects",
    "Adobe Photoshop",
    "Figma",
    "Design Systems",
    "User Research",
    # Business, Sales, Operations & Finance
    "CRM",
    "Salesforce",
    "Account Management",
    "Financial Modeling",
    "Excel",
    "Budgeting",
    "Forecasting",
    "Process Optimization",
    "Project Management",
    "Stakeholder Management",
    "Cross-Functional Leadership",
    "Product Strategy",
    "Product Management",
    "Roadmap Planning",
    # Software & Data
    "Python",
    "TypeScript",
    "JavaScript",
    "React",
    "Next.js",
    "Node.js",
    "FastAPI",
    "Django",
    "PostgreSQL",
    "SQL",
    "SQL Analytics",
    "Redis",
    "Docker",
    "Kubernetes",
    "AWS",
    "GCP",
    "Azure",
    "GraphQL",
    "REST APIs",
    "System Design",
    "Distributed Systems",
    "CI/CD",
    "Git",
    "Terraform",
    "Go",
    "Java",
    "C#",
]


@dataclass
class ExtractedItem:
    kind: ExperienceKind
    title: str
    organization: str
    dates_text: str
    summary: str
    confidence: float
    source_location: str


@dataclass
class ExtractedSkill:
    name: str
    normalized_name: str


@dataclass
class ParsedDocumentResult:
    mime_type: str
    page_count: int
    raw_text: str
    headline: str = ""
    summary: str = ""
    location: str = ""
    items: list[ExtractedItem] = field(default_factory=list)
    skills: list[ExtractedSkill] = field(default_factory=list)


def normalize_skill_name(name: str) -> str:
    return re.sub(r"\s+", " ", name.strip().lower())


def detect_document_type(filename: str, content_type: str | None, data: bytes) -> str:
    lower_name = filename.lower()
    if data.startswith(b"%PDF-"):
        return PDF_MIME
    if data.startswith(b"PK\x03\x04"):
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as zf:
                if "word/document.xml" in zf.namelist():
                    return DOCX_MIME
        except zipfile.BadZipFile:
            pass
    if lower_name.endswith(".pdf") or content_type == PDF_MIME:
        raise AppError(
            code="invalid_document",
            message="The uploaded PDF file header is corrupted or invalid.",
            status_code=422,
        )
    if lower_name.endswith(".docx") or content_type == DOCX_MIME:
        raise AppError(
            code="invalid_document",
            message="The uploaded DOCX file is corrupted or invalid.",
            status_code=422,
        )
    raise AppError(
        code="unsupported_media_type",
        message="Only PDF and DOCX CV files are supported.",
        status_code=415,
    )


def extract_raw_pages(data: bytes, mime_type: str, max_pages: int) -> tuple[list[str], int]:
    if mime_type == PDF_MIME:
        try:
            reader = PdfReader(io.BytesIO(data))
            page_count = len(reader.pages)
        except Exception as exc:
            raise AppError(
                code="invalid_document",
                message="Could not read the uploaded PDF document.",
                status_code=422,
            ) from exc
        if page_count == 0:
            raise AppError(
                code="invalid_document",
                message="The uploaded PDF has zero pages.",
                status_code=422,
            )
        if page_count > max_pages:
            raise AppError(
                code="too_many_pages",
                message=f"CV exceeds the maximum allowed {max_pages} pages.",
                status_code=422,
                details={"page_count": page_count, "max_pages": max_pages},
            )
        pages = [(page.extract_text() or "").strip() for page in reader.pages]
        return pages, page_count

    try:
        doc = DocxDocument(io.BytesIO(data))
    except Exception as exc:
        raise AppError(
            code="invalid_document",
            message="Could not read the uploaded DOCX document.",
            status_code=422,
        ) from exc

    blocks: list[str] = []
    for para in doc.paragraphs:
        txt = para.text.strip()
        if txt:
            blocks.append(txt)
    for table in doc.tables:
        for row in table.rows:
            row_text = " | ".join(cell.text.strip() for cell in row.cells if cell.text.strip())
            if row_text:
                blocks.append(row_text)

    combined = "\n".join(blocks).strip()
    approx_pages = max(1, (len(blocks) + 39) // 40)
    if approx_pages > max_pages:
        raise AppError(
            code="too_many_pages",
            message=f"CV exceeds the maximum allowed {max_pages} pages.",
            status_code=422,
            details={"page_count": approx_pages, "max_pages": max_pages},
        )
    return [combined], approx_pages


def _clean_heading(line: str) -> str:
    return re.sub(r"[:\-\|\s]+$", "", re.sub(r"^[\s\*\-#]+", "", line)).strip().lower()


def _parse_item_header(line: str) -> tuple[str, str, str, float]:
    dates_text = ""
    working = line.strip()
    date_match = _DATE_RANGE_RE.search(working)
    if date_match:
        dates_text = date_match.group(0).strip()
        working = (working[: date_match.start()] + working[date_match.end() :]).strip(" ,|-()")

    for sep in (" | ", " @ ", " at ", " - "):
        if sep in working:
            parts = [p.strip() for p in working.split(sep, 1)]
            title = parts[0]
            org = parts[1] if len(parts) > 1 else ""
            conf = 0.9 if (title and org and dates_text) else 0.78
            return title[:180], org[:180], dates_text[:100], conf

    if "," in working:
        parts = [p.strip() for p in working.split(",", 1)]
        conf = 0.8 if dates_text else 0.68
        return parts[0][:180], parts[1][:180], dates_text[:100], conf

    return working[:180], "", dates_text[:100], 0.68 if dates_text else 0.62


def deterministic_sort_cv(pages: list[str], mime_type: str) -> ParsedDocumentResult:
    full_text = "\n\n".join(p for p in pages if p).strip()
    section_chunks: dict[str, list[tuple[int, str]]] = {
        "header": [],
        "summary": [],
        "experience": [],
        "education": [],
        "project": [],
        "certification": [],
        "skills": [],
    }
    current_section = "header"
    for page_idx, page_text in enumerate(pages, start=1):
        for raw_line in page_text.splitlines():
            line = raw_line.strip()
            if not line:
                continue
            normalized_heading = _clean_heading(line)
            if len(normalized_heading) <= 36 and normalized_heading in _SECTION_MAP:
                current_section = _SECTION_MAP[normalized_heading]
                continue
            section_chunks[current_section].append((page_idx, line))

    header_lines = [line for _, line in section_chunks["header"][:4]]
    headline = header_lines[1][:180] if len(header_lines) > 1 else (header_lines[0][:180] if header_lines else "")
    summary = " ".join(line for _, line in section_chunks["summary"])[:1000]

    items: list[ExtractedItem] = []
    source_prefix = "PDF page" if mime_type == PDF_MIME else "DOCX section"

    for kind in ("experience", "education", "project", "certification"):
        entries = section_chunks[kind]
        if not entries:
            continue
        current_header: tuple[int, str, str, str, float] | None = None
        bullets: list[str] = []

        def flush_current() -> None:
            if not current_header:
                return
            pg, title, org, dates, conf = current_header
            if not title:
                return
            items.append(
                ExtractedItem(
                    kind=kind,  # type: ignore[arg-type]
                    title=title,
                    organization=org,
                    dates_text=dates,
                    summary=" ".join(bullets).strip()[:1200],
                    confidence=conf,
                    source_location=f"{source_prefix} {pg} ({kind})",
                )
            )

        for pg, line in entries:
            is_bullet = line.startswith(("-", "*", "•", "–"))
            if is_bullet and current_header is not None:
                bullets.append(line.lstrip("-*•– ").strip())
                continue
            has_date_or_sep = bool(_DATE_RANGE_RE.search(line) or " | " in line or " at " in line or " - " in line)
            if current_header is None or has_date_or_sep or kind in ("education", "certification"):
                flush_current()
                title, org, dates, conf = _parse_item_header(line.lstrip("-*•– "))
                current_header = (pg, title, org, dates, conf)
                bullets = []
            else:
                bullets.append(line)
        flush_current()

    # Skills sorting (section tokens + known skill matching in raw text)
    seen_skills: dict[str, ExtractedSkill] = {}
    for _, line in section_chunks["skills"]:
        clean_line = re.sub(r"^[A-Za-z &/]+:\s*", "", line)
        for token in re.split(r"[,|/•·]+", clean_line):
            skill_name = token.strip().strip(".")
            if 2 <= len(skill_name) <= 48:
                norm = normalize_skill_name(skill_name)
                if norm not in seen_skills:
                    seen_skills[norm] = ExtractedSkill(name=skill_name, normalized_name=norm)

    lowered_text = full_text.lower()
    for candidate in _KNOWN_SKILL_CATALOG:
        if re.search(rf"\b{re.escape(candidate.lower())}\b", lowered_text):
            norm = normalize_skill_name(candidate)
            if norm not in seen_skills:
                seen_skills[norm] = ExtractedSkill(name=candidate, normalized_name=norm)

    return ParsedDocumentResult(
        mime_type=mime_type,
        page_count=len(pages) if mime_type == PDF_MIME else max(1, (len(full_text.splitlines()) + 39) // 40),
        raw_text=full_text,
        headline=headline,
        summary=summary,
        location="",
        items=items,
        skills=list(seen_skills.values()),
    )


async def parse_and_sort_cv(
    filename: str,
    content_type: str | None,
    data: bytes,
    llm: LLMProviderAdapter | None = None,
) -> ParsedDocumentResult:
    settings = get_settings()
    if not data:
        raise AppError(
            code="empty_document",
            message="The uploaded file is empty.",
            status_code=400,
        )
    max_bytes = settings.max_upload_mb * 1024 * 1024
    if len(data) > max_bytes:
        raise AppError(
            code="file_too_large",
            message=f"CV file must be {settings.max_upload_mb} MB or smaller.",
            status_code=413,
            details={"size_bytes": len(data), "max_bytes": max_bytes},
        )

    mime_type = detect_document_type(filename, content_type, data)
    pages, page_count = extract_raw_pages(data, mime_type, settings.max_cv_pages)
    full_text = "\n\n".join(p for p in pages if p).strip()
    if len(full_text) < 20:
        raise AppError(
            code="no_extractable_text",
            message="No readable text was found in this document. Please upload a text-based PDF or DOCX.",
            status_code=422,
        )

    baseline = deterministic_sort_cv(pages, mime_type)
    baseline.page_count = page_count

    provider = llm or get_llm_adapter()
    if not provider.is_configured:
        return baseline

    system_prompt = (
        "You sort and extract factual CV entries into strict JSON. "
        "NEVER invent metrics, outcomes, dates, titles, or companies. "
        "Preserve ambiguous dates exactly as written in the CV text. "
        "Return JSON with keys: headline (string), summary (string), location (string), "
        "items (array of objects with kind in ['experience','education','project','certification'], "
        "title, organization, dates_text, summary, confidence float 0..1, source_location), "
        "and skills (array of strings)."
    )
    user_prompt = (
        f"Extract and sort the candidate's verified CV facts from this {page_count}-page document:\n\n"
        f"{full_text[:14000]}"
    )
    ai_data = await provider.complete_json(system_prompt, user_prompt, temperature=0.1, max_tokens=2200)
    if not ai_data:
        return baseline

    allowed_kinds = {"experience", "education", "project", "certification"}
    ai_items: list[ExtractedItem] = []
    for entry in ai_data.get("items") or []:
        if not isinstance(entry, dict):
            continue
        kind = str(entry.get("kind", "experience")).lower().strip()
        if kind not in allowed_kinds:
            continue
        title = str(entry.get("title", "")).strip()[:180]
        if not title:
            continue
        raw_conf = entry.get("confidence", 0.85)
        try:
            conf = max(0.0, min(1.0, float(raw_conf)))
        except (TypeError, ValueError):
            conf = 0.8
        ai_items.append(
            ExtractedItem(
                kind=kind,  # type: ignore[arg-type]
                title=title,
                organization=str(entry.get("organization", "")).strip()[:180],
                dates_text=str(entry.get("dates_text", "")).strip()[:100],
                summary=str(entry.get("summary", "")).strip()[:1500],
                confidence=conf,
                source_location=str(entry.get("source_location", "Uploaded CV")).strip()[:160],
            )
        )

    ai_skills_map: dict[str, ExtractedSkill] = {}
    for raw_skill in ai_data.get("skills") or []:
        if not isinstance(raw_skill, str):
            continue
        clean = raw_skill.strip()[:60]
        if len(clean) >= 2:
            norm = normalize_skill_name(clean)
            ai_skills_map.setdefault(norm, ExtractedSkill(name=clean, normalized_name=norm))

    if ai_items:
        baseline.items = ai_items
    if ai_skills_map:
        baseline.skills = list(ai_skills_map.values())
    if isinstance(ai_data.get("headline"), str) and ai_data["headline"].strip():
        baseline.headline = ai_data["headline"].strip()[:180]
    if isinstance(ai_data.get("summary"), str) and ai_data["summary"].strip():
        baseline.summary = ai_data["summary"].strip()[:1500]
    if isinstance(ai_data.get("location"), str) and ai_data["location"].strip():
        baseline.location = ai_data["location"].strip()[:160]
    return baseline

