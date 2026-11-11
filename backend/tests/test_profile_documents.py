import io
from pathlib import Path

from docx import Document as DocxDocument
from httpx import AsyncClient

from app.adapters.storage import LocalStorageAdapter, get_storage_adapter
from app.main import app


def _make_docx_bytes(lines: list[str]) -> bytes:
    doc = DocxDocument()
    for line in lines:
        doc.add_paragraph(line)
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


async def _signup_and_headers(client: AsyncClient, email: str = "cvuser@example.com") -> dict[str, str]:
    res = await client.post("/v1/auth/signup", json={"email": email, "password": "StrongPassword1!"})
    assert res.status_code == 201
    token = res.json()["dev_verification_token"]
    verify_res = await client.post("/v1/auth/verify", json={"token": token})
    assert verify_res.status_code == 200
    access = verify_res.json()["access_token"]
    return {"Authorization": f"Bearer {access}"}


async def test_onboarding_cv_sort_verify_and_doc_delete(client: AsyncClient, tmp_path: Path) -> None:
    app.dependency_overrides[get_storage_adapter] = lambda: LocalStorageAdapter(base_dir=tmp_path)
    headers = await _signup_and_headers(client)

    onboard = await client.post(
        "/v1/profile/onboarding",
        headers=headers,
        json={
            "full_name": "Adaeze Okafor",
            "role_focus": "Senior Product Manager",
            "language": "English",
            "ai_consent": True,
            "transcript_consent": False,
        },
    )
    assert onboard.status_code == 200
    assert onboard.json()["full_name"] == "Adaeze Okafor"

    docx_bytes = _make_docx_bytes(
        [
            "Adaeze Okafor",
            "Senior Product Manager - Fintech & Growth",
            "Summary",
            "Product leader with 7 years building onboarding and experimentation flows.",
            "Experience",
            "Lead Product Manager | Paystack | Jan 2022 - Present",
            "- Led merchant onboarding redesign reducing drop-off from 41% to 23%.",
            "- Coordinated A/B Testing across 12 enterprise funnels.",
            "Education",
            "B.Sc. Computer Science | University of Lagos | 2014 - 2018",
            "Skills",
            "Product Strategy, Experimentation, SQL, Figma",
        ]
    )

    upload = await client.post(
        "/v1/documents",
        headers=headers,
        files={
            "file": (
                "adaeze_cv.docx",
                docx_bytes,
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            )
        },
    )
    assert upload.status_code == 201, upload.text
    body = upload.json()
    doc_id = body["document"]["id"]
    assert len(body["extracted_items"]) >= 2
    assert any(sk["normalized_name"] == "product strategy" for sk in body["extracted_skills"])

    # Verify one extracted item + add a manual item, leave another extracted if any or verify
    verify_res = await client.post(
        "/v1/profile/verify",
        headers=headers,
        json={"headline": "Verified Senior PM"},
    )
    assert verify_res.status_code == 200
    profile_data = verify_res.json()
    assert profile_data["verified_at"] is not None
    assert profile_data["headline"] == "Verified Senior PM"
    assert all(item["origin"] == "verified" for item in profile_data["experiences"])

    # Deleting the document must keep verified experiences intact
    del_doc = await client.delete(f"/v1/documents/{doc_id}", headers=headers)
    assert del_doc.status_code == 200
    after_profile = (await client.get("/v1/profile", headers=headers)).json()
    assert len(after_profile["documents"]) == 0
    assert len(after_profile["experiences"]) >= 1
    assert after_profile["experiences"][0]["origin"] == "verified"


async def test_reject_invalid_cv_upload(client: AsyncClient, tmp_path: Path) -> None:
    app.dependency_overrides[get_storage_adapter] = lambda: LocalStorageAdapter(base_dir=tmp_path)
    headers = await _signup_and_headers(client, email="badcv@example.com")

    bad_pdf = await client.post(
        "/v1/documents",
        headers=headers,
        files={"file": ("spoof.pdf", b"NOT_A_REAL_PDF", "application/pdf")},
    )
    assert bad_pdf.status_code == 422
    assert bad_pdf.json()["error"]["code"] == "invalid_document"
