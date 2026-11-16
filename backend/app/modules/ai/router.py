"""Quick checks of the AI setup, so a missing or wrong key is found in seconds."""

import time

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.adapters.llm import get_llm_adapter, provider_label
from app.adapters.stt import get_stt_adapter
from app.core.database import get_db
from app.core.deps import get_verified_user
from app.core.rate_limit import rate_limit
from app.db.models import CandidateExperience, CandidateSkill, InterviewPreferences, User
from app.modules.ai.explain import explain_unavailable
from app.modules.sessions.grounding import generate_answer

router = APIRouter(prefix="/v1/ai", tags=["ai"])


class ProviderStatus(BaseModel):
    name: str
    label: str
    ok: bool
    message: str


class SpeechStatus(BaseModel):
    provider: str
    ok: bool
    message: str


class SampleAnswer(BaseModel):
    question: str
    answer: str
    seconds: float


class AiCheckOut(BaseModel):
    ok: bool
    providers: list[ProviderStatus]
    speech: SpeechStatus
    sample: SampleAnswer | None = None
    message: str


class AiCheckIn(BaseModel):
    question: str = "Tell me about yourself."
    sample: bool = True


@router.post("/check", response_model=AiCheckOut, dependencies=[Depends(rate_limit("ai_check", 12, 300))])
async def check_ai(
    payload: AiCheckIn,
    user: User = Depends(get_verified_user),
    db: AsyncSession = Depends(get_db),
) -> AiCheckOut:
    """Tests every AI provider that has a key, checks speech to text, and writes a sample answer."""
    llm = get_llm_adapter()
    statuses: list[ProviderStatus] = []
    for provider in llm.providers():
        name = provider if isinstance(provider, str) else provider.name
        ok, message = await llm.check_provider(provider)
        statuses.append(ProviderStatus(name=name, label=provider_label(name), ok=ok, message=message))

    speech_provider, speech_ok, speech_message = await get_stt_adapter().check()
    speech = SpeechStatus(provider=speech_provider, ok=speech_ok, message=speech_message)

    sample: SampleAnswer | None = None
    working = any(s.ok for s in statuses)
    note = ""
    if not statuses:
        note = "No AI key is set up. Add OPENAI_API_KEY or GEMINI_API_KEY to backend/.env and restart the server."
    elif not working:
        note = "None of your AI keys worked. Fix the first problem above."
    elif payload.sample and payload.question.strip():
        prefs = await db.get(InterviewPreferences, user.id) or InterviewPreferences(user_id=user.id)
        experiences = (await db.execute(select(CandidateExperience).where(CandidateExperience.user_id == user.id))).scalars().all()
        skills = (await db.execute(select(CandidateSkill).where(CandidateSkill.user_id == user.id))).scalars().all()
        started = time.monotonic()
        result = await generate_answer(payload.question.strip(), "General", prefs, experiences, skills, None)
        if result.available:
            sample = SampleAnswer(question=payload.question.strip(), answer=" ".join(result.lines), seconds=round(time.monotonic() - started, 1))
        else:
            note = explain_unavailable(result.reason)
    return AiCheckOut(ok=working and speech_ok, providers=statuses, speech=speech, sample=sample, message=note)
