from httpx import AsyncClient

from app.modules.sessions.review import parse_ai_review
from tests.test_pairing_and_answers import _verified_headers


class _JsonLLM:
    def __init__(self, reply, configured=True):
        self.reply, self.is_configured, self.calls = reply, configured, []

    async def complete_json(self, system, user, temperature=0.2, max_tokens=1800):
        self.calls.append((system, user))
        return self.reply


async def _session_with_answers(client: AsyncClient, email: str):
    headers = await _verified_headers(client, email)
    await client.post(
        "/v1/profile/experiences", headers=headers,
        json={"kind": "experience", "title": "Support Lead", "organization": "Brightside", "dates_text": "2019 - 2022",
              "summary": "Led support for a scheduling product and wrote the help centre.", "origin": "verified", "active": True},
    )
    job = await client.post(
        "/v1/jobs", headers=headers,
        json={"raw_text": "Customer Success Manager at Globex\nResponsibilities\n- Own onboarding\nRequirements\n- Onboarding\n- Renewals\n- SQL\n"},
    )
    sid = (await client.post("/v1/sessions", headers=headers, json={"job_id": job.json()["id"], "rules_acknowledged": True})).json()["id"]
    for q in ("How do you run customer onboarding at scale?", "Tell me about a time you disagreed with a teammate."):
        r = await client.post(f"/v1/sessions/{sid}/suggest", headers=headers, json={"question_text": q})
        assert r.status_code == 201
    return headers, sid


def test_parse_ai_review_validates_and_trims() -> None:
    assert parse_ai_review(None, 2) is None and parse_ai_review({"summary": "  "}, 2) is None
    out = parse_ai_review(
        {"summary": "Went well.", "strengths": ["a", 3, "b", "c", "d"], "improvements": "nope",
         "per_question": [{"index": 1, "note": "Good"}, {"index": 9, "note": "out of range"}, {"index": "x", "note": "bad"}],
         "next_steps": ["practise SQL"]},
        2,
    )
    assert out["strengths"] == ["a", "b", "c"] and out["improvements"] == []
    assert out["per_question"] == [{"index": 1, "note": "Good"}] and out["next_steps"] == ["practise SQL"]


async def test_review_always_has_the_numbers(client: AsyncClient, monkeypatch) -> None:
    headers, sid = await _session_with_answers(client, "rev1@example.com")
    monkeypatch.setattr("app.modules.sessions.review.get_llm_adapter", lambda: _JsonLLM(None, configured=False))
    res = await client.post(f"/v1/sessions/{sid}/review", headers=headers)
    assert res.status_code == 200
    review = res.json()["snapshot"]["review"]
    assert review["ai_available"] is False and review["ai"] is None
    stats = review["stats"]
    assert stats["questions"] == 2
    assert "Onboarding" in stats["skills_covered"] and set(stats["skills_not_covered"]) >= {"Renewals", "SQL"}
    assert any("Renewals" in m for m in res.json()["missed_evidence"])  # shown as missed evidence on the review page


async def test_review_adds_the_coaching_summary_when_the_ai_works(client: AsyncClient, monkeypatch) -> None:
    headers, sid = await _session_with_answers(client, "rev2@example.com")
    llm = _JsonLLM({
        "summary": "You covered onboarding well but renewals never came up.",
        "strengths": ["Clear onboarding example"], "improvements": ["Prepare a renewals story"],
        "per_question": [{"index": 0, "note": "Strong, specific."}], "next_steps": ["Practise renewals"],
    })
    monkeypatch.setattr("app.modules.sessions.review.get_llm_adapter", lambda: llm)
    res = await client.post(f"/v1/sessions/{sid}/review", headers=headers)
    body = res.json()
    assert body["snapshot"]["review"]["ai"]["summary"].startswith("You covered onboarding")
    assert body["strengths"] == ["Clear onboarding example"] and body["improvements"] == ["Prepare a renewals story"]
    system, user = llm.calls[0]
    assert "Never invent" in system and "Renewals" in user and "How do you run customer onboarding" in user
    assert "not recorded" in user  # no transcript was kept, so the coach is told it has no spoken words


async def test_review_survives_a_model_that_returns_rubbish(client: AsyncClient, monkeypatch) -> None:
    headers, sid = await _session_with_answers(client, "rev3@example.com")
    monkeypatch.setattr("app.modules.sessions.review.get_llm_adapter", lambda: _JsonLLM({"unexpected": True}))
    res = await client.post(f"/v1/sessions/{sid}/review", headers=headers)
    assert res.status_code == 200 and res.json()["snapshot"]["review"]["ai_available"] is False


async def test_review_of_someone_elses_session_is_refused(client: AsyncClient) -> None:
    _, sid = await _session_with_answers(client, "rev4@example.com")
    other = await _verified_headers(client, "rev5@example.com")
    assert (await client.post(f"/v1/sessions/{sid}/review", headers=other)).status_code == 404
