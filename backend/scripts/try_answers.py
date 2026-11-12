"""Try the answer pipeline against your real AI provider.

    cd backend
    uv run python -m scripts.try_answers                 # sample candidate and questions
    uv run python -m scripts.try_answers "Why this role?"  # your own question

Reads backend/.env. First tests every AI provider that has a key (LLM_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY) and says
what is wrong with each one, then prints answers with their length, speed and style check. Nothing is saved.
"""

import asyncio
import sys
import time

import httpx

from app.adapters.llm import LLMProviderAdapter
from app.adapters.stt import get_stt_adapter
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


async def check_providers() -> bool:
    """Tries every provider that has a key, in the order the app uses them. True if at least one works."""
    s = get_settings()
    adapter = LLMProviderAdapter(s)
    providers = adapter.providers()
    if not providers:
        print("No AI key is set in backend/.env. Add OPENAI_API_KEY and/or GEMINI_API_KEY (or LLM_API_KEY).")
        return False

    print("AI providers, in the order they are tried:")
    working = 0
    for provider in providers:
        if isinstance(provider, str):  # Gemini
            result = await adapter._complete_gemini("Reply with JSON only.", 'Return {"ok": true}', 0, 50)
            ok = isinstance(result, dict)
            print(f"  gemini  (model {adapter._gemini_models()[0]}): " + ("works" if ok else "FAILED. Check GEMINI_API_KEY, or GEMINI_MODEL (try gemini-2.5-flash)."))
        else:
            ok, note = await check_compat(provider)
            print(f"  {provider.name:<7} ({provider.base_url}, model {provider.model}): {note}")
        working += int(ok)

    if working == 0:
        print("\nNone of them worked, so there are no answers yet. Fix the first message above and run this again.")
        return False
    stt = get_stt_adapter().active_provider
    print(f"\nSpeech to text: {stt}" + ("  (no speech-to-text key: add DEEPGRAM_API_KEY, or reuse OPENAI_API_KEY / GEMINI_API_KEY)" if stt == "offline" else ""))
    print()
    return True


async def check_compat(provider) -> tuple[bool, str]:
    headers = {"Authorization": f"Bearer {provider.api_key}"}
    base = provider.base_url.rstrip("/")
    async with httpx.AsyncClient(timeout=30) as client:
        try:
            r = await client.post(
                f"{base}/chat/completions", headers=headers,
                json={"model": provider.model, "messages": [{"role": "user", "content": "Reply with the single word: ok"}], "max_tokens": 8},
            )
        except httpx.HTTPError as exc:
            return False, f"could not reach it ({exc}). Check the address and your network."
    if r.status_code == 200:
        return True, "works"
    if r.status_code == 401:
        return False, "the key was rejected (401). Create a new key and paste it again, with no quotes or spaces."
    if r.status_code == 403:
        return False, "the key is not allowed to do this (403). Check the key's permissions or billing."
    if r.status_code == 404:
        return False, f"not found (404). Check the model name '{provider.model}' and that the address ends in /v1."
    if r.status_code == 429:
        return False, "rate limited or out of credit (429). Check billing."
    return False, f"HTTP {r.status_code}: {r.text[:200]}"


async def main() -> None:
    if not await check_providers():
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
