import os

import httpx
import pytest
from httpx import AsyncClient

from app.adapters import llm as llm_module
from app.adapters.llm import CompatProvider, LLMProviderAdapter, _chat_payload, plain_problem, reset_problems, reset_rejected_providers
from app.core.config import Settings
from app.modules.ai.explain import explain_unavailable
from tests.test_pairing_and_answers import _verified_headers


@pytest.fixture(autouse=True)
def clean():
    os.environ.pop("PYTEST_CURRENT_TEST", None)
    reset_problems()
    reset_rejected_providers()
    yield
    reset_problems()
    reset_rejected_providers()


# ---------------------------------------------------------------- plain sentences
@pytest.mark.parametrize(
    ("status", "needle"),
    [(401, "rejected the key"), (403, "billing"), (404, "model"), (429, "credit"), (500, "trouble"), (None, "Could not reach")],
)
def test_problems_are_in_plain_words(status, needle) -> None:
    assert needle in plain_problem("openai", status)
    assert "OpenAI" in plain_problem("openai", status)


def test_newer_openai_models_get_the_parameters_they_accept() -> None:
    msgs = [{"role": "user", "content": "hi"}]
    old = _chat_payload(CompatProvider("openai", "u", "k", "gpt-4o-mini"), msgs, 0.5, 100)
    new = _chat_payload(CompatProvider("openai", "u", "k", "gpt-5-mini"), msgs, 0.5, 100)
    o3 = _chat_payload(CompatProvider("openai", "u", "k", "o3-mini"), msgs, 0.5, 100)
    assert old["max_tokens"] == 100 and old["temperature"] == 0.5 and "max_completion_tokens" not in old
    assert new["max_completion_tokens"] == 100 and "temperature" not in new and "max_tokens" not in new
    assert "max_completion_tokens" in o3
    flipped = _chat_payload(CompatProvider("openai", "u", "k", "gpt-4o-mini"), msgs, 0.5, 100, flip=True)
    assert "max_completion_tokens" in flipped and "temperature" not in flipped


class _Resp:
    def __init__(self, status, text="", data=None):
        self.status_code, self.text, self._data = status, text, data or {}
        self.request = httpx.Request("POST", "http://x")

    def raise_for_status(self):
        if self.status_code >= 400:
            raise httpx.HTTPStatusError("bad", request=self.request, response=httpx.Response(self.status_code, text=self.text, request=self.request))

    def json(self):
        return self._data


def _client(seen, script):
    class C:
        def __init__(self, *a, **k): ...
        async def __aenter__(self): return self
        async def __aexit__(self, *a): ...
        async def post(self, url, headers=None, json=None):
            seen.append(json)
            return script(len(seen), json)
    return C


async def test_a_model_that_rejects_max_tokens_is_retried_with_the_other_style(monkeypatch) -> None:
    os.environ.pop("PYTEST_CURRENT_TEST", None)  # pytest sets it again for the test body; the adapter reads it as "offline"
    ok = {"choices": [{"message": {"content": '{"ok": true}'}}]}
    seen: list[dict] = []
    script = lambda n, body: _Resp(400, '{"error": {"message": "Unsupported parameter: max_tokens. Use max_completion_tokens."}}') if "max_tokens" in body else _Resp(200, data=ok)
    monkeypatch.setattr(llm_module.httpx, "AsyncClient", _client(seen, script))
    a = LLMProviderAdapter(Settings(env="development", llm_api_key=None, openai_api_key="o", gemini_api_key=None, openai_model="gpt-4o-mini"))
    assert await a.complete_json("s", "u") == {"ok": True}
    assert "max_tokens" in seen[0] and "max_completion_tokens" in seen[1] and len(seen) == 2


async def test_check_provider_says_what_is_wrong(monkeypatch) -> None:
    seen: list[dict] = []
    monkeypatch.setattr(llm_module.httpx, "AsyncClient", _client(seen, lambda n, b: _Resp(401, "no")))
    a = LLMProviderAdapter(Settings(env="development", llm_api_key="bad", openai_api_key=None, gemini_api_key=None))
    ok, message = await a.check_provider(a.providers()[0])
    assert not ok and "rejected the key" in message
    # the real reason is what the app tells you later, not a vague "not available"
    assert "rejected the key" in explain_unavailable("AI_PROVIDER_ERROR")

    reset_rejected_providers()
    monkeypatch.setattr(llm_module.httpx, "AsyncClient", _client(seen, lambda n, b: _Resp(404, "model not found")))
    ok, message = await a.check_provider(a.providers()[0])
    assert not ok and "model" in message.lower()


def test_no_key_says_how_to_add_one() -> None:
    assert "OPENAI_API_KEY" in explain_unavailable("AI_PROVIDER_UNAVAILABLE")


# ---------------------------------------------------------------- the check endpoint
class _FakeLLM:
    def __init__(self, statuses): self.statuses = statuses
    def providers(self): return [name for name, _, _ in self.statuses]
    async def check_provider(self, p):
        _, ok, msg = next(s for s in self.statuses if s[0] == p)
        return ok, msg
    is_configured = True


class _FakeSTT:
    async def check(self): return "openai_compatible", True, "OpenAI Whisper is ready."


async def test_the_check_endpoint_reports_each_provider(client: AsyncClient, monkeypatch, fake_llm) -> None:
    monkeypatch.setattr("app.modules.ai.router.get_llm_adapter", lambda: _FakeLLM([("openai", False, "OpenAI rejected the key."), ("gemini", True, "Works.")]))
    monkeypatch.setattr("app.modules.ai.router.get_stt_adapter", lambda: _FakeSTT())
    headers = await _verified_headers(client, "check1@example.com")
    res = await client.post("/v1/ai/check", headers=headers, json={"question": "Why this role?"})
    assert res.status_code == 200
    body = res.json()
    assert [(p["name"], p["ok"]) for p in body["providers"]] == [("openai", False), ("gemini", True)]
    assert body["providers"][0]["message"] == "OpenAI rejected the key."
    assert body["speech"] == {"provider": "openai_compatible", "ok": True, "message": "OpenAI Whisper is ready."}
    assert body["sample"]["answer"] and body["sample"]["seconds"] >= 0  # a sample answer was written (fake model)
    assert body["ok"] is True


async def test_the_check_endpoint_when_nothing_is_set_up(client: AsyncClient, monkeypatch) -> None:
    monkeypatch.setattr("app.modules.ai.router.get_llm_adapter", lambda: _FakeLLM([]))
    monkeypatch.setattr("app.modules.ai.router.get_stt_adapter", lambda: type("S", (), {"check": lambda self: _none()})())
    headers = await _verified_headers(client, "check2@example.com")
    body = (await client.post("/v1/ai/check", headers=headers, json={})).json()
    assert body["ok"] is False and body["providers"] == [] and "OPENAI_API_KEY" in body["message"]


async def _none():
    return "offline", False, "No speech-to-text key."


async def test_all_keys_failing_skips_the_sample(client: AsyncClient, monkeypatch) -> None:
    monkeypatch.setattr("app.modules.ai.router.get_llm_adapter", lambda: _FakeLLM([("openai", False, "OpenAI rejected the key.")]))
    monkeypatch.setattr("app.modules.ai.router.get_stt_adapter", lambda: _FakeSTT())
    headers = await _verified_headers(client, "check3@example.com")
    body = (await client.post("/v1/ai/check", headers=headers, json={})).json()
    assert body["sample"] is None and body["ok"] is False and "Fix the first problem" in body["message"]


async def test_the_check_needs_a_signed_in_user(client: AsyncClient) -> None:
    assert (await client.post("/v1/ai/check", json={})).status_code == 401
