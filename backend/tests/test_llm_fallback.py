import pytest

from app.adapters.llm import CompatProvider, LLMProviderAdapter
from app.core.config import Settings


def _adapter(monkeypatch, **kw) -> LLMProviderAdapter:
    monkeypatch.delenv("PYTEST_CURRENT_TEST", raising=False)  # the adapter reports "not configured" under pytest
    base = dict(env="development", llm_provider="openai_compatible", llm_api_key=None, openai_api_key=None, gemini_api_key=None)
    return LLMProviderAdapter(Settings(**{**base, **kw}))


def test_order_is_primary_then_openai_then_gemini(monkeypatch) -> None:
    a = _adapter(monkeypatch, llm_api_key="p", openai_api_key="o", gemini_api_key="g")
    assert a.provider_names() == ["primary", "openai", "gemini"]
    assert _adapter(monkeypatch, llm_api_key="p").provider_names() == ["primary"]
    assert _adapter(monkeypatch, openai_api_key="o", gemini_api_key="g").provider_names() == ["openai", "gemini"]
    assert _adapter(monkeypatch).provider_names() == []
    assert not _adapter(monkeypatch).is_configured


def test_same_key_is_not_listed_twice_and_gemini_can_lead(monkeypatch) -> None:
    assert _adapter(monkeypatch, llm_api_key="k", openai_api_key="k").provider_names() == ["primary"]
    assert _adapter(monkeypatch, llm_provider="gemini", llm_api_key="p", gemini_api_key="g").provider_names() == ["gemini", "primary"]
    assert _adapter(monkeypatch, llm_provider="offline", llm_api_key="p").provider_names() == []


async def test_stream_falls_back_when_the_primary_gives_nothing(monkeypatch) -> None:
    a = _adapter(monkeypatch, llm_api_key="p", openai_api_key="o", gemini_api_key="g")
    tried: list[str] = []

    async def fake_stream(provider: CompatProvider, *args):
        tried.append(provider.name)
        if provider.name == "openai":
            yield "from "
            yield "openai"

    monkeypatch.setattr(a, "_stream_compat", fake_stream)
    out = "".join([c async for c in a.stream_text("s", "u")])
    assert out == "from openai" and tried == ["primary", "openai"]  # gemini was never needed


async def test_stream_stops_at_the_first_provider_that_works(monkeypatch) -> None:
    a = _adapter(monkeypatch, llm_api_key="p", openai_api_key="o")
    tried: list[str] = []

    async def fake_stream(provider: CompatProvider, *args):
        tried.append(provider.name)
        yield "ok"

    monkeypatch.setattr(a, "_stream_compat", fake_stream)
    assert "".join([c async for c in a.stream_text("s", "u")]) == "ok" and tried == ["primary"]


async def test_json_falls_through_to_gemini(monkeypatch) -> None:
    a = _adapter(monkeypatch, llm_api_key="p", openai_api_key="o", gemini_api_key="g")

    async def none(*args):
        return None

    async def gemini(*args):
        return {"answer": "from gemini"}

    monkeypatch.setattr(a, "_complete_compat", none)
    monkeypatch.setattr(a, "_complete_gemini", gemini)
    assert await a.complete_json("s", "u") == {"answer": "from gemini"}


async def test_everything_failing_returns_nothing_instead_of_raising(monkeypatch) -> None:
    a = _adapter(monkeypatch, llm_api_key="p", openai_api_key="o", gemini_api_key="g")

    async def none(*args):
        return None

    async def empty(*args):
        return
        yield  # pragma: no cover

    monkeypatch.setattr(a, "_complete_compat", none)
    monkeypatch.setattr(a, "_complete_gemini", none)
    monkeypatch.setattr(a, "_stream_compat", empty)
    monkeypatch.setattr(a, "_stream_gemini", empty)
    assert await a.complete_json("s", "u") is None
    assert [c async for c in a.stream_text("s", "u")] == []


def test_models_come_from_settings(monkeypatch) -> None:
    a = _adapter(monkeypatch, gemini_api_key="g", gemini_model="gemini-test", llm_model="claude-x")
    assert a._gemini_models() == ["gemini-test"]
    a = _adapter(monkeypatch, gemini_api_key="g", llm_model="gemini-custom")
    assert a._gemini_models()[0] == "gemini-2.5-flash" and "gemini-custom" in a._gemini_models()
