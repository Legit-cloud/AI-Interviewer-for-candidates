import re
from collections.abc import AsyncGenerator
from dataclasses import dataclass, field

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.database import get_db
from app.db.base import Base
from app.main import app

DEFAULT_ANSWER = (
    "- I would check the frame budget first and profile where the time is going.\n"
    "- Then I would simplify the heaviest shaders and cut expensive lighting before touching anything else.\n"
    "- I would measure again and keep only the changes that clearly help.\n"
)


@dataclass
class FakeLLMState:
    configured: bool = True
    fail: bool = False
    text: str | None = None  # fixed output; otherwise echo the first relevant background item
    prompts: list[tuple[str, str]] = field(default_factory=list)


class FakeLLM:
    """Deterministic stand-in for the LLM adapter used by answer generation."""

    def __init__(self, state: FakeLLMState) -> None:
        self.state = state

    @property
    def is_configured(self) -> bool:
        return self.state.configured

    async def stream_text(self, system_prompt, user_prompt, temperature=0.2, max_tokens=240):
        self.state.prompts.append((system_prompt, user_prompt))
        if self.state.fail:
            raise RuntimeError("provider down")
        if self.state.text is not None:
            out = self.state.text
        else:
            match = re.search(r"Relevant background:\n- ([^\n]+)", user_prompt)
            if match:
                out = f"- {match.group(1)}\n- I would use the same approach here.\n- I would check the result and adjust.\n"
            else:
                out = DEFAULT_ANSWER
        for line in out.splitlines(keepends=True):
            yield line


@pytest.fixture(autouse=True)
def fake_llm(monkeypatch) -> FakeLLMState:
    state = FakeLLMState()
    monkeypatch.setattr("app.modules.sessions.grounding.get_llm_adapter", lambda: FakeLLM(state))
    return state


@pytest.fixture
async def client() -> AsyncGenerator[AsyncClient, None]:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
    session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async def override_get_db() -> AsyncGenerator[AsyncSession, None]:
        async with session_factory() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()
    await engine.dispose()
