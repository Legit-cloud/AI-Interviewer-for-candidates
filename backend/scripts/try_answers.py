"""Try the answer pipeline against your real AI provider.

    cd backend
    uv run python -m scripts.try_answers                 # sample candidate and questions
    uv run python -m scripts.try_answers "Why this role?"  # your own question

Reads backend/.env (LLM_BASE_URL, LLM_API_KEY, LLM_MODEL). First checks that the key and model work and says
what is wrong if not, then prints each answer with its length, speed and style check. Nothing is saved.
"""

import asyncio
import sys
import time

import httpx

from app.core.config import get_settings
from app.db.models import CandidateExperience, CandidateSkill, InterviewPreferences, JobDescription
from app.modules.sessions import answer_style
from app.modules.sessions.grounding import stream_answer

SAMPLE_QUESTIONS = [
    ("Behavioral", "Tell me about a time you disagreed with a teammate."),
    ("General", "Tell me about yourself."),
    ("Role task", "How would you cut the time it takes to onboard a new customer?"),
    ("Situational", "Imagine a key customer threatens to leave a week before renewal. What do you do?"),
    ("General", "Why do you want this role?"),
]


def sample_candidate() -> tuple[list[CandidateExperience], list[CandidateSkill], JobDescription]:
    exp = [
        CandidateExperience(
            kind="experience", title="Customer Success Manager", organization="Acme Software", dates_text="2021 - Present",
            summary="Own onboarding and renewals for 40 mid-size accounts. Rebuilt the onboarding checklist and cut time to first value.",
            origin="verified", active=True,
        ),
        CandidateExperience(
            kind="experience", title="Support Specialist", organization="Brightside", dates_text="2018 - 2021",
            summary="First-line and escalated support for a scheduling product. Wrote the help-centre articles for the top ten issues.",
            origin="verified", active=True,
        ),
    ]
    skills = [CandidateSkill(name=n, normalized_name=n.lower(), origin="verified") for n in ("Onboarding", "Renewals", "Zendesk", "SQL")]
    job = JobDescription(
        title="Senior Customer Success Manager", company="Globex", raw_text="Own onboarding and renewals for enterprise accounts.",
        responsibilities=["Lead onboarding for new enterprise customers", "Own renewals and expansion"], required_skills=["Onboarding", "Renewals"],
    )
    return exp, skills, job


async def check_provider() -> bool:
    s = get_settings()
    if not s.llm_api_key:
        print("LLM_API_KEY is empty in backend/.env, so there is nothing to call.")
        return False
    base = s.llm_base_url.rstrip("/")
    print(f"Provider: {base}   model: {s.llm_model}")
    headers = {"Authorization": f"Bearer {s.llm_api_key}"}
    async with httpx.AsyncClient(timeout=30) as client:
        try:
            r = await client.get(f"{base}/models", headers=headers)
            if r.status_code == 200:
                ids = [m.get("id") for m in r.json().get("data", [])]
                print(f"Key accepted. {len(ids)} models available." + ("" if s.llm_model in ids else f"  NOTE: '{s.llm_model}' is not in that list, set LLM_MODEL to one of: {', '.join(map(str, ids[:12]))}"))
            else:
                print(f"/models returned HTTP {r.status_code} (some gateways do not list models). Trying a real request next.")
            r = await client.post(
                f"{base}/chat/completions", headers=headers,
                json={"model": s.llm_model, "messages": [{"role": "user", "content": "Reply with the single word: ok"}], "max_tokens": 8},
            )
        except httpx.HTTPError as exc:
            print(f"Could not reach {base}: {exc}. Check LLM_BASE_URL and your network.")
            return False
    if r.status_code == 401:
        print("HTTP 401: the key was rejected. Check LLM_API_KEY (no quotes, no spaces) and that it belongs to this provider.")
    elif r.status_code == 404:
        print("HTTP 404: wrong LLM_BASE_URL (it should end in /v1) or an unknown model name.")
    elif r.status_code != 200:
        print(f"HTTP {r.status_code}: {r.text[:300]}")
    else:
        print("A test request worked.\n")
    return r.status_code == 200


async def main() -> None:
    if not await check_provider():
        sys.exit(1)
    exp, skills, job = sample_candidate()
    questions = [("General", " ".join(sys.argv[1:]))] if len(sys.argv) > 1 else SAMPLE_QUESTIONS
    for length in ("Brief", "Standard") if len(sys.argv) == 1 else ("Standard",):
        prefs = InterviewPreferences(user_id=None, length=length, style="Conversational", framework="STAR", language="English", answer_language="")
        print(f"===== length: {length} =====")
        for kind, q in questions:
            start, first, result = time.monotonic(), None, None
            async for ev, payload in stream_answer(q, kind, prefs, exp, skills, job, []):
                if ev == "delta" and first is None:
                    first = time.monotonic() - start
                if ev == "done":
                    result = payload
            total = time.monotonic() - start
            print(f"\nQ ({kind}): {q}")
            if not result or not result.available:
                print(f"  unavailable: {getattr(result, 'reason', '?')}")
                continue
            print("  " + "\n  ".join(result.lines))
            report = answer_style.style_issues(result.lines, answer_style.budget_for(length))
            print(f"  [{answer_style.word_count(result.lines)} words | first words after {first or 0:.1f}s, done in {total:.1f}s | {result.source_label}]")
            if report.severe or report.minor:
                print(f"  style notes: {'; '.join(report.severe + report.minor)}")


if __name__ == "__main__":
    asyncio.run(main())
