import os

import httpx
import pytest

from app.adapters import llm as llm_module
from app.adapters.llm import CompatProvider, LLMProviderAdapter, mark_provider_rejected, reset_rejected_providers
from app.adapters.stt import STTProviderAdapter
from app.core.config import Settings


@pytest.fixture(autouse=True)
def clean(monkeypatch):
    monkeypatch.delenv("PYTEST_CURRENT_TEST", raising=False)
    reset_rejected_providers()
    yield
    reset_rejected_providers()


def llm(**kw) -> LLMProviderAdapter:
    os.environ.pop("PYTEST_CURRENT_TEST", None)  # pytest sets it for each phase; the adapters treat it as "offline"
    base = dict(env="development", llm_api_key=None, openai_api_key=None, gemini_api_key=None)
    return LLMProviderAdapter(Settings(**{**base, **kw}))


def stt(**kw) -> STTProviderAdapter:
    os.environ.pop("PYTEST_CURRENT_TEST", None)
    base = dict(env="development", stt_provider="offline", deepgram_api_key=None, stt_api_key=None, openai_api_key=None, gemini_api_key=None)
    return STTProviderAdapter(Settings(**{**base, **kw}))


# ---------------------------------------------------------------- a rejected key stops being tried
def test_a_rejected_provider_is_skipped_for_a_while() -> None:
    a = llm(llm_api_key="bad", openai_api_key="o", gemini_api_key="g")
    assert a.provider_names() == ["primary", "openai", "gemini"]
    mark_provider_rejected("primary")
    assert a.provider_names() == ["openai", "gemini"]
    reset_rejected_providers()
    assert a.provider_names() == ["primary", "openai", "gemini"]


async def test_a_401_bans_the_provider_and_the_next_one_answers(monkeypatch) -> None:
    a = llm(llm_api_key="bad", openai_api_key="o")
    calls: list[str] = []

    class FakeResponse:
        def __init__(self, status): self.status_code = status
        def raise_for_status(self):
            if self.status_code >= 400:
                raise httpx.HTTPStatusError("nope", request=httpx.Request("POST", "http://x"), response=httpx.Response(self.status_code))
        def json(self): return {"choices": [{"message": {"content": '{"ok": true}'}}]}

    class FakeClient:
        def __init__(self, *a, **k): ...
        async def __aenter__(self): return self
        async def __aexit__(self, *a): ...
        async def post(self, url, headers=None, json=None):
            calls.append(headers["Authorization"])
            return FakeResponse(401 if headers["Authorization"] == "Bearer bad" else 200)

    monkeypatch.setattr(llm_module.httpx, "AsyncClient", FakeClient)
    assert await a.complete_json("s", "u") == {"ok": True}
    assert calls == ["Bearer bad", "Bearer o"]
    assert await a.complete_json("s", "u") == {"ok": True}
    assert calls[2:] == ["Bearer o"]  # the rejected key is not tried again
    assert a.provider_names() == ["openai"]


def test_a_500_is_not_treated_as_a_bad_key() -> None:
    from app.adapters.llm import _is_auth_failure

    err = lambda code: httpx.HTTPStatusError("x", request=httpx.Request("POST", "http://x"), response=httpx.Response(code))
    assert _is_auth_failure(err(401)) and _is_auth_failure(err(403))
    assert not _is_auth_failure(err(500)) and not _is_auth_failure(err(429)) and not _is_auth_failure(RuntimeError("timeout"))
    assert _is_auth_failure(RuntimeError("400 API_KEY_INVALID. API key not valid"))


# ---------------------------------------------------------------- speech to text with only OpenAI and Gemini keys
@pytest.mark.parametrize(
    ("kw", "expected"),
    [
        ({}, "offline"),
        ({"gemini_api_key": "g"}, "gemini"),
        ({"openai_api_key": "o"}, "openai_compatible"),  # Whisper, reusing the OpenAI key
        ({"openai_api_key": "o", "gemini_api_key": "g"}, "openai_compatible"),
        ({"deepgram_api_key": "d", "openai_api_key": "o"}, "deepgram"),
        ({"stt_provider": "gemini", "gemini_api_key": "g", "openai_api_key": "o"}, "gemini"),
        ({"stt_provider": "openai_compatible", "openai_api_key": "o"}, "openai_compatible"),
        ({"stt_provider": "openai_compatible"}, "offline"),
        ({"stt_provider": "openai_compatible", "gemini_api_key": "g"}, "gemini"),  # no key for it: fall back, do not fail
        ({"stt_provider": "openai_compatible", "stt_base_url": "https://other.example/v1", "openai_api_key": "o"}, "offline"),  # OpenAI key is not sent elsewhere
    ],
)
def test_which_transcription_is_used(kw, expected) -> None:
    assert stt(**kw).active_provider == expected


def test_the_openai_key_is_only_sent_to_openai() -> None:
    assert stt(openai_api_key="o")._whisper_key() == "o"
    assert stt(openai_api_key="o", stt_api_key="s")._whisper_key() == "s"
    assert stt(openai_api_key="o", stt_base_url="https://other.example/v1")._whisper_key() is None
