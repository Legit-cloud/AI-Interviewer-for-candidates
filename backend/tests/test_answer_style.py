import pytest
from httpx import AsyncClient

from app.modules.sessions.answer_style import budget_for, clean_lines, kind_guidance, retry_note, style_issues, system_prompt
from tests.test_pairing_and_answers import _verified_headers

QUESTION = "Tell me about a time you disagreed with a teammate."


# ---------------------------------------------------------------- length and the prompt
def test_length_preferences_map_to_spoken_budgets() -> None:
    assert [budget_for(x).sentences for x in ("Brief", "Standard", "Detailed")] == [3, 5, 7]
    assert budget_for("Brief").max_words < budget_for("Standard").max_words < budget_for("Detailed").max_words
    assert budget_for("nonsense") == budget_for("Standard")


def test_prompt_makes_the_model_write_speech_not_text() -> None:
    p = system_prompt(budget_for("Standard"))
    assert "out loud" in p and "Contractions" in p
    assert "Answer first" in p
    assert "No lists, bullets" in p
    assert "Never invent employers" in p
    assert "Too generic:" in p and "Human:" in p  # contrast examples, not just "be natural"
    assert "leverage" in p  # banned words are listed
    assert "I haven't run that directly" in p  # honest bridge when the background does not cover it


def test_guidance_depends_on_the_kind_of_question() -> None:
    assert "story" in kind_guidance("Behavioral", QUESTION)
    assert "trade-off" in kind_guidance("Role task", "How would you size a cache?")
    assert "where you are now" in kind_guidance("General", "Tell me about yourself")
    assert "this company" in kind_guidance("General", "Why do you want to work here?")


# ---------------------------------------------------------------- spotting generic or written-style output
def test_generic_ai_language_is_flagged_as_severe() -> None:
    b = budget_for("Standard")
    generic = ["Great question! I'm passionate about leveraging data to drive results in fast-paced environments."]
    report = style_issues(generic, b)
    assert report.needs_retry and any("great question" in x for x in report.severe)
    assert any("leverag" in x for x in report.severe)

    human = ["Mostly I'd talk to him first, privately, because it usually isn't about the code.", "Then we tried his approach for a week and compared."]
    assert not style_issues(human, b).needs_retry


def test_coaching_instead_of_answering_is_flagged() -> None:
    b = budget_for("Standard")
    assert style_issues(["Start by describing the situation clearly."], b).needs_retry
    assert style_issues(["You should mention the result you achieved."], b).needs_retry
    assert style_issues(["As an AI, I can't have colleagues."], b).needs_retry


def test_written_formatting_is_cleaned_and_length_is_enforced() -> None:
    b = budget_for("Brief")
    cleaned = clean_lines(
        ["**Situation:** We shipped late — twice.", "- Action: I split the release.", "1. Result: it held.", "Four.", "Five."],
        b,
    )
    assert cleaned[0] == "We shipped late, twice."
    assert cleaned[1] == "I split the release." and cleaned[2] == "it held."
    assert len(cleaned) <= b.sentences
    assert not style_issues(cleaned, b).severe
    assert "—" not in " ".join(cleaned) and "*" not in " ".join(cleaned)


def test_retry_note_names_what_went_wrong() -> None:
    note = retry_note(style_issues(["Great question, I'm passionate about this."], budget_for("Brief")))
    assert "broke these rules" in note and "great question" in note


# ---------------------------------------------------------------- end to end through the answer pipeline
async def _session(client: AsyncClient, email: str):
    headers = await _verified_headers(client, email)
    sid = (await client.post("/v1/sessions", headers=headers, json={"rules_acknowledged": True})).json()["id"]
    return headers, sid


async def test_a_generic_draft_is_rewritten_once(client: AsyncClient, fake_llm) -> None:
    headers, sid = await _session(client, "retry@example.com")
    fake_llm.sequence = [
        "- Great question! I'm passionate about leveraging collaboration.\n- At the end of the day it is about communication.\n- I always strive for synergy.\n",
        "- I talked to him privately first, because it usually isn't about the code.\n- Then we tried his way for a week and compared.\n- It turned out his version was simpler, so we kept it.\n",
    ]
    res = await client.post(f"/v1/sessions/{sid}/suggest", headers=headers, json={"question_text": QUESTION, "question_type": "Behavioral"})
    assert res.status_code == 201
    text = " ".join(res.json()["outline"])
    assert "passionate" not in text and "synergy" not in text
    assert "privately" in text
    assert len(fake_llm.prompts) == 2 and "broke these rules" in fake_llm.prompts[1][1]


async def test_clean_drafts_are_not_retried(client: AsyncClient, fake_llm) -> None:
    headers, sid = await _session(client, "noretry@example.com")
    fake_llm.sequence = ["- I talked to him privately first.\n- We tried his way for a week.\n- It was simpler, so we kept it.\n"]
    res = await client.post(f"/v1/sessions/{sid}/suggest", headers=headers, json={"question_text": QUESTION})
    assert res.status_code == 201 and len(fake_llm.prompts) == 1


async def test_a_retry_that_is_no_better_keeps_the_first_draft_instead_of_looping(client: AsyncClient, fake_llm) -> None:
    headers, sid = await _session(client, "stuck@example.com")
    bad = "- Great question, I'm passionate about teamwork.\n- I leverage synergy daily.\n- At the end of the day it works.\n"
    fake_llm.sequence = [bad, bad]
    res = await client.post(f"/v1/sessions/{sid}/suggest", headers=headers, json={"question_text": QUESTION})
    assert res.status_code == 201 and len(fake_llm.prompts) == 2  # exactly one retry, never more


async def test_the_prompt_carries_the_role_and_question_kind(client: AsyncClient, fake_llm) -> None:
    headers = await _verified_headers(client, "job@example.com")
    job = await client.post(
        "/v1/jobs", headers=headers,
        json={"raw_text": "Senior Product Manager at Globex\nResponsibilities\n- Own the roadmap\n- Work with engineering\nRequirements\n- Product strategy\n- SQL\n"},
    )
    sid = (await client.post("/v1/sessions", headers=headers, json={"job_id": job.json()["id"], "rules_acknowledged": True})).json()["id"]
    await client.patch("/v1/preparation/preferences", headers=headers, json={"style": "Conversational", "length": "Detailed"})
    await client.post(f"/v1/sessions/{sid}/suggest", headers=headers, json={"question_text": QUESTION, "question_type": "Behavioral"})
    system, user = fake_llm.prompts[-1]
    assert "about 7 sentences" in system and "160 words" in system
    assert "Globex" in user and "Own the roadmap" in user
    assert "colleague over coffee" in user  # the chosen style
    assert "one short true story" in user  # the kind of question
    assert "never say the labels" in user
