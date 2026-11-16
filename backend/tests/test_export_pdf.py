import io
import subprocess

import pytest
from httpx import AsyncClient

from app.modules.export.report import build_report_pdf
from tests.test_pairing_and_answers import _verified_headers


def _text(pdf: bytes) -> str:
    """Reads the text back out of the PDF, to prove people can actually read it."""
    try:
        import pypdf

        return "\n".join(p.extract_text() or "" for p in pypdf.PdfReader(io.BytesIO(pdf)).pages)
    except ImportError:
        out = subprocess.run(["pdftotext", "-", "-"], input=pdf, capture_output=True, check=True)
        return out.stdout.decode()


DATA = {
    "exported_at": "2026-11-12T10:00:00+00:00",
    "user": {"email": "ada@example.com"},
    "profile": {"full_name": "Zoë Ångström", "headline": "Customer Success Manager", "summary": "I help customers get value fast.", "location": "Lagos", "role_focus": "Support"},
    "profile_items": [
        {"kind": "experience", "title": "Support Lead", "organization": "Brightside", "dates_text": "2019 - 2022", "summary": "Led support for a scheduling product.", "active": True},
        {"kind": "education", "title": "BSc Economics", "organization": "University of Lagos", "dates_text": "2015", "summary": "", "active": True},
    ],
    "skills": [{"name": "Onboarding"}, {"name": "SQL"}],
    "jobs": [{"title": "Customer Success Manager", "company": "Globex", "required_skills": ["Onboarding", "Renewals"], "archived": False}],
    "sessions": [
        {
            "started_at": "2026-11-10T09:00:00Z", "duration_min": 32, "state": "ended", "job_title": "Customer Success Manager", "company": "Globex",
            "snapshot": {"job_title": "Customer Success Manager", "review": {"ai": {"summary": "You covered onboarding well."}}},
            "strengths": ["Clear examples"], "improvements": ["Add numbers"],
            "questions": [{"question_text": "How do you run onboarding?", "outline": ["I start with a call.", "Then a checklist."], "evidence_ref": "From your experience: Support Lead", "code": "def f():\n    return 1"}],
            "transcript": [{"speaker": "Interviewer", "text": "How do you run onboarding? Привет"}], "note": "Went fine.",
        }
    ],
    "practice": [{"title": "Customer Success Manager at Globex · Behavioural", "created_at": "2026-11-11T10:00:00Z", "summary": {"overall": "A solid start.", "average_score": 4.0},
                  "turns": [{"question": "Tell me about yourself.", "answer": "I run onboarding.", "feedback": {"score": 4, "improve": ["Add the result."]}}, {"question": "Unanswered?", "answer": None}]}],
    "preferences": {"language": "English", "length": "Brief"},
    "consents": [{"label": "Terms accepted", "created_at": "2026-11-01T08:00:00Z"}],
}


def test_the_report_is_a_readable_pdf_with_every_section() -> None:
    pdf = build_report_pdf(DATA)
    assert pdf.startswith(b"%PDF") and len(pdf) > 3000
    text = _text(pdf)
    for needle in ["Your Vren AI report", "Zoë Ångström", "Customer Success Manager", "Brightside", "BSc Economics", "Onboarding, SQL",
                   "Globex", "How do you run onboarding?", "I start with a call.", "From your experience: Support Lead", "def f():",
                   "You covered onboarding well.", "Clear examples", "Add numbers", "Привет", "Went fine.", "Practice interviews",
                   "average 4.0/5", "Tell me about yourself.", "Score 4/5", "Terms accepted"]:
        assert needle in text, needle
    assert "Unanswered?" not in text  # questions that were never answered are left out


def test_an_empty_account_still_makes_a_valid_report() -> None:
    pdf = build_report_pdf({"exported_at": "2026-11-12T10:00:00+00:00", "user": {"email": "new@example.com"}, "profile": {}, "preferences": {}})
    assert pdf.startswith(b"%PDF")
    assert "Your Vren AI report" in _text(pdf)


def test_text_with_markup_characters_cannot_break_the_pdf() -> None:
    data = {**DATA, "profile": {"full_name": "<b>Bold & </i> </para> name</b>", "summary": "5 < 6 & 7 > 3"}}
    assert "5 < 6 & 7 > 3" in _text(build_report_pdf(data))


async def test_the_endpoint_returns_a_downloadable_pdf(client: AsyncClient) -> None:
    headers = await _verified_headers(client, "pdf@example.com")
    await client.post("/v1/profile/experiences", headers=headers,
                      json={"kind": "experience", "title": "Support Lead", "organization": "Brightside", "dates_text": "2019", "summary": "Led support.", "origin": "verified", "active": True})
    res = await client.get("/v1/me/export.pdf", headers=headers)
    assert res.status_code == 200
    assert res.headers["content-type"] == "application/pdf"
    assert 'attachment; filename="vren-ai-report.pdf"' in res.headers["content-disposition"]
    assert "Support Lead" in _text(res.content)
    assert (await client.get("/v1/me/export")).status_code == 401 and (await client.get("/v1/me/export.pdf")).status_code == 401
    assert "exported_at" in (await client.get("/v1/me/export", headers=headers)).json()  # the data file is still there
