from httpx import AsyncClient


async def _verified_headers(client: AsyncClient, email: str = "jobuser@example.com") -> dict[str, str]:
    res = await client.post("/v1/auth/signup", json={"email": email, "password": "StrongPassword1!"})
    assert res.status_code == 201
    verify_token = res.json()["dev_verification_token"]
    verify_res = await client.post("/v1/auth/verify", json={"token": verify_token})
    assert verify_res.status_code == 200
    return {"Authorization": f"Bearer {verify_res.json()['access_token']}"}


async def test_jobs_gap_prep_sessions_and_export(client: AsyncClient) -> None:
    headers = await _verified_headers(client)

    # Seed verified experience and skill
    exp_res = await client.post(
        "/v1/profile/experiences",
        headers=headers,
        json={
            "kind": "experience",
            "title": "Senior Backend Engineer",
            "organization": "Paystack",
            "dates_text": "2022 - Present",
            "summary": "Built FastAPI services and PostgreSQL payment pipelines handling high throughput.",
            "origin": "verified",
            "active": True,
        },
    )
    assert exp_res.status_code == 201
    sk_res = await client.post(
        "/v1/profile/skills",
        headers=headers,
        json={"name": "FastAPI", "origin": "verified"},
    )
    assert sk_res.status_code == 201
    await client.post("/v1/profile/verify", headers=headers, json={"headline": "Backend Lead"})

    # 1. Extract & Create Job
    jd_text = (
        "Staff Backend Engineer at Stripe\n"
        "Responsibilities\n"
        "- Architect distributed payment systems using Python and FastAPI\n"
        "- Improve PostgreSQL query reliability\n"
        "Requirements\n"
        "- FastAPI\n"
        "- PostgreSQL\n"
        "- Kubernetes\n"
    )
    preview = await client.post("/v1/jobs/extract", headers=headers, json={"raw_text": jd_text})
    assert preview.status_code == 200
    assert preview.json()["company"] == "Stripe"

    created_job = await client.post("/v1/jobs", headers=headers, json={"raw_text": jd_text})
    assert created_job.status_code == 201
    job_id = created_job.json()["id"]

    # 2. Gap Report (FastAPI & PostgreSQL matched, Kubernetes flagged as gap)
    gap = await client.get(f"/v1/jobs/{job_id}/gap-report", headers=headers)
    assert gap.status_code == 200
    gap_data = gap.json()
    assert gap_data["fit_score"] > 0
    assert any(g["requirement"] == "Kubernetes" for g in gap_data["gaps"])

    # 3. Preferences + Consent History
    pref_patch = await client.patch(
        "/v1/preparation/preferences",
        headers=headers,
        json={"framework": "STAR", "retain_transcript_default": True},
    )
    assert pref_patch.status_code == 200
    assert pref_patch.json()["framework"] == "STAR"
    assert len(pref_patch.json()["consent_history"]) >= 1

    # 4. Prep Brief
    brief = await client.post("/v1/preparation/brief", headers=headers, json={"job_id": job_id})
    assert brief.status_code == 200
    assert len(brief.json()["talking_points"]) >= 1

    # 5. Interview Session + Grounded Suggestion + Feedback + End
    sess = await client.post("/v1/sessions", headers=headers, json={"job_id": job_id})
    assert sess.status_code == 201
    session_id = sess.json()["id"]

    suggest = await client.post(
        f"/v1/sessions/{session_id}/suggest",
        headers=headers,
        json={
            "question_text": "Tell me about scaling FastAPI and PostgreSQL pipelines.",
            "question_type": "Technical",
        },
    )
    assert suggest.status_code == 201
    suggestion_id = suggest.json()["id"]
    assert "Paystack" in suggest.json()["evidence_ref"]

    fb = await client.patch(
        f"/v1/sessions/{session_id}/suggestions/{suggestion_id}/feedback",
        headers=headers,
        json={"feedback": "helpful"},
    )
    assert fb.status_code == 200
    assert fb.json()["feedback"] == "helpful"

    ended = await client.patch(
        f"/v1/sessions/{session_id}",
        headers=headers,
        json={"state": "ended", "duration_min": 25, "reviewed": True, "note": "Good deep dive."},
    )
    assert ended.status_code == 200
    assert ended.json()["state"] == "ended"
    assert ended.json()["note"] == "Good deep dive."
    assert len(ended.json()["transcript"]) == 1

    # 6. Export & Delete all sessions
    exported = await client.get("/v1/me/export", headers=headers)
    assert exported.status_code == 200
    assert len(exported.json()["sessions"]) == 1

    deleted_all = await client.delete("/v1/sessions", headers=headers)
    assert deleted_all.status_code == 200
    after_list = await client.get("/v1/sessions", headers=headers)
    assert after_list.json() == []


async def test_cross_industry_outside_cv_suggestions(client: AsyncClient) -> None:
    headers = await _verified_headers(client, email="creator@example.com")

    # Create a 3D Artist job without matching backend CV items
    job = await client.post(
        "/v1/jobs",
        headers=headers,
        json={
            "title": "Senior 3D Environment Artist",
            "company": "Studio Nova",
            "raw_text": (
                "Senior 3D Environment Artist\n"
                "Responsibilities\n"
                "- Build stylized game environments in Blender and Unreal Engine\n"
                "- Optimize PBR texturing, UV mapping, and lighting for 60fps\n"
            ),
        },
    )
    assert job.status_code == 201
    job_id = job.json()["id"]

    sess = await client.post("/v1/sessions", headers=headers, json={"job_id": job_id})
    assert sess.status_code == 201
    session_id = sess.json()["id"]

    # Ask a tough domain question not present on any CV
    res = await client.post(
        f"/v1/sessions/{session_id}/suggest",
        headers=headers,
        json={
            "question_text": "How would you optimize a heavy Unreal shader and lighting setup when frame rate drops?",
            "question_type": "Technical",
        },
    )
    assert res.status_code == 201
    body = res.json()
    assert len(body["outline"]) >= 2
    joined = " ".join(body["outline"]).lower()
    assert "budget" in joined or "normal" in joined or "lighting" in joined
    assert "refuse" not in joined


