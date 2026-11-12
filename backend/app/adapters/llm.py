import json
import logging
import os
import re
import time
from collections.abc import AsyncIterator
from typing import Any

import httpx
from dataclasses import dataclass

from app.core.config import Settings, get_settings

logger = logging.getLogger(__name__)

_CODE_FENCE_RE = re.compile(r"```(?:json)?\s*(.*?)\s*```", re.DOTALL | re.IGNORECASE)


def _extract_json_object(raw: str) -> dict[str, Any] | None:
    text = raw.strip()
    if not text:
        return None
    fenced = _CODE_FENCE_RE.search(text)
    if fenced:
        text = fenced.group(1).strip()
    try:
        parsed = json.loads(text)
        return parsed if isinstance(parsed, dict) else None
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}")
        if start != -1 and end > start:
            try:
                parsed = json.loads(text[start : end + 1])
                return parsed if isinstance(parsed, dict) else None
            except json.JSONDecodeError:
                return None
    return None


# A provider whose key was rejected (401/403) is skipped for a while, so one bad key does not slow every answer.
_AUTH_BAN_SECONDS = 600
_banned_until: dict[str, float] = {}


def mark_provider_rejected(name: str) -> None:
    if _banned_until.get(name, 0) < time.monotonic():
        logger.error("LLM provider %s rejected its key (401/403). Skipping it for %d minutes. Check the key in backend/.env.", name, _AUTH_BAN_SECONDS // 60)
    _banned_until[name] = time.monotonic() + _AUTH_BAN_SECONDS


def reset_rejected_providers() -> None:
    _banned_until.clear()


_LABELS = {"primary": "Your AI service", "openai": "OpenAI", "gemini": "Gemini"}
_last_problem: dict[str, str] = {}


def provider_label(name: str) -> str:
    return _LABELS.get(name, name)


def plain_problem(name: str, status: int | None, detail: str = "") -> str:
    """A short sentence a person can act on."""
    who = provider_label(name)
    if status == 401:
        return f"{who} rejected the key. Create a new key and paste it again, with no quotes or spaces."
    if status == 403:
        return f"{who} will not let this key do that. Check the key's permissions and that billing is set up."
    if status == 404:
        return f"{who} does not know that model. Set the model name in backend/.env (for example OPENAI_MODEL or GEMINI_MODEL)."
    if status == 429:
        return f"{who} says you are out of credit or going too fast. Check billing and try again."
    if status is not None and status >= 500:
        return f"{who} is having trouble right now. Try again in a minute."
    if status == 400:
        return f"{who} did not accept the request ({detail[:120].strip() or 'bad request'})."
    return f"Could not reach {who}. Check your internet connection."


def last_problems() -> list[str]:
    return list(_last_problem.values())


def reset_problems() -> None:
    _last_problem.clear()


def _remember_failure(name: str, exc: Exception) -> None:
    if isinstance(exc, httpx.HTTPStatusError):
        try:
            detail = exc.response.text
        except Exception:  # streaming responses may not be read yet
            detail = ""
        _last_problem[name] = plain_problem(name, exc.response.status_code, detail)
    elif _is_auth_failure(exc):
        _last_problem[name] = plain_problem(name, 401)
    else:
        _last_problem[name] = plain_problem(name, None)


def _uses_new_params(model: str) -> bool:
    """Newer OpenAI models want `max_completion_tokens` and only the default temperature."""
    return bool(re.match(r"^(o\d|gpt-5)", model.lower()))


def _chat_payload(provider: "CompatProvider", messages: list, temperature: float, max_tokens: int, *, stream: bool = False, flip: bool = False) -> dict[str, Any]:
    new_style = _uses_new_params(provider.model) != flip
    payload: dict[str, Any] = {"model": provider.model, "messages": messages}
    if new_style:
        payload["max_completion_tokens"] = max_tokens
    else:
        payload["max_tokens"] = max_tokens
        payload["temperature"] = temperature
    if stream:
        payload["stream"] = True
    return payload


def _wants_other_params(exc: Exception) -> bool:
    if not isinstance(exc, httpx.HTTPStatusError) or exc.response.status_code != 400:
        return False
    try:
        text = exc.response.text.lower()
    except Exception:
        return False
    return any(k in text for k in ("max_tokens", "max_completion_tokens", "temperature"))


def _is_auth_failure(exc: Exception) -> bool:
    if isinstance(exc, httpx.HTTPStatusError):
        return exc.response.status_code in (401, 403)
    text = str(exc).upper()
    return any(m in text for m in ("API_KEY_INVALID", "API KEY NOT VALID", "PERMISSION_DENIED", "UNAUTHENTICATED", " 401", " 403"))


@dataclass(frozen=True)
class CompatProvider:
    """An OpenAI-compatible chat API (AgentRouter, OpenAI, Groq and similar)."""

    name: str
    base_url: str
    api_key: str
    model: str


class LLMProviderAdapter:
    """Server-side LLM adapter with a fallback chain.

    Order: the primary provider (LLM_PROVIDER, normally an OpenAI-compatible gateway such as AgentRouter), then
    OpenAI directly, then Gemini. A provider with no key is skipped. If one fails or returns nothing, the next
    one is tried, so an outage at one provider does not stop the interview.
    """

    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()

    # ------------------------------------------------------------------ which providers are available
    def providers(self) -> list[str | CompatProvider]:
        """The providers that can be tried, in order. The string "gemini" stands for Gemini."""
        s = self.settings
        if s.llm_provider == "offline":
            return []
        chain: list[str | CompatProvider] = []
        compat: list[CompatProvider] = []
        if s.llm_api_key:
            compat.append(CompatProvider("primary", s.llm_base_url, s.llm_api_key, s.llm_model))
        if s.openai_api_key and s.openai_api_key != s.llm_api_key:
            compat.append(CompatProvider("openai", s.openai_base_url, s.openai_api_key, s.openai_model))
        gemini: list[str | CompatProvider] = ["gemini"] if s.gemini_api_key else []
        chain = [*gemini, *compat] if s.llm_provider == "gemini" else [*compat, *gemini]
        now = time.monotonic()
        return [p for p in chain if _banned_until.get(p if isinstance(p, str) else p.name, 0) <= now]

    def provider_names(self) -> list[str]:
        return [p if isinstance(p, str) else p.name for p in self.providers()]

    @property
    def is_configured(self) -> bool:
        if "PYTEST_CURRENT_TEST" in os.environ or self.settings.env == "test":
            return False
        return bool(self.providers())

    # ------------------------------------------------------------------ public calls
    async def complete_json(
        self,
        system_prompt: str,
        user_prompt: str,
        temperature: float = 0.2,
        max_tokens: int = 1800,
    ) -> dict[str, Any] | None:
        if not self.is_configured:
            return None
        for provider in self.providers():
            if isinstance(provider, str):
                result = await self._complete_gemini(system_prompt, user_prompt, temperature, max_tokens)
            else:
                result = await self._complete_compat(provider, system_prompt, user_prompt, temperature, max_tokens)
            if result is not None:
                return result
            logger.warning("LLM provider %s gave no result; trying the next one", provider if isinstance(provider, str) else provider.name)
        return None

    async def stream_text(
        self,
        system_prompt: str,
        user_prompt: str,
        temperature: float = 0.2,
        max_tokens: int = 240,
    ) -> AsyncIterator[str]:
        """Streams low-latency text tokens, falling back to the next provider if one gives nothing."""
        if not self.is_configured:
            return
        for provider in self.providers():
            streamed_any = False
            source = (
                self._stream_gemini(system_prompt, user_prompt, temperature, max_tokens)
                if isinstance(provider, str)
                else self._stream_compat(provider, system_prompt, user_prompt, temperature, max_tokens)
            )
            async for chunk in source:
                streamed_any = True
                yield chunk
            if streamed_any:
                return
            logger.warning("LLM provider %s streamed nothing; trying the next one", provider if isinstance(provider, str) else provider.name)

    async def complete_json_with_image(
        self,
        system_prompt: str,
        user_prompt: str,
        image_b64: str,
        mime: str,
        max_tokens: int = 700,
    ) -> dict[str, Any] | None:
        """Like complete_json, but with one image (for example a screenshot of a question)."""
        if not self.is_configured:
            return None
        for provider in self.providers():
            if isinstance(provider, str):
                result = await self._image_gemini(system_prompt, user_prompt, image_b64, mime, max_tokens)
            else:
                result = await self._image_compat(provider, system_prompt, user_prompt, image_b64, mime, max_tokens)
            if result is not None:
                return result
        return None

    async def _image_compat(
        self, provider: CompatProvider, system_prompt: str, user_prompt: str, image_b64: str, mime: str, max_tokens: int
    ) -> dict[str, Any] | None:
        url = f"{provider.base_url.rstrip('/')}/chat/completions"
        headers = {"Authorization": f"Bearer {provider.api_key}", "Content-Type": "application/json"}
        messages = [
            {"role": "system", "content": system_prompt},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": user_prompt},
                    {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{image_b64}"}},
                ],
            },
        ]
        for flip in (False, True):
            try:
                async with httpx.AsyncClient(timeout=40.0) as client:
                    response = await client.post(url, headers=headers, json=_chat_payload(provider, messages, 0, max_tokens, flip=flip))
                    response.raise_for_status()
                    content = (response.json().get("choices") or [{}])[0].get("message", {}).get("content", "")
                if isinstance(content, list):
                    content = "".join(part.get("text", "") for part in content if isinstance(part, dict))
                _last_problem.pop(provider.name, None)
                return _extract_json_object(str(content))
            except Exception as exc:
                if not flip and _wants_other_params(exc):
                    continue
                if _is_auth_failure(exc):
                    mark_provider_rejected(provider.name)
                _remember_failure(provider.name, exc)
                logger.warning("LLM provider %s image request failed cleanly: %s", provider.name, exc)
                return None
        return None

    async def _image_gemini(
        self, system_prompt: str, user_prompt: str, image_b64: str, mime: str, max_tokens: int
    ) -> dict[str, Any] | None:
        try:
            import base64

            from google import genai
            from google.genai import types

            client = genai.Client(api_key=self.settings.gemini_api_key)
            response = await client.aio.models.generate_content(
                model=self._gemini_models()[0],
                contents=[types.Part.from_bytes(data=base64.b64decode(image_b64), mime_type=mime), user_prompt],
                config=types.GenerateContentConfig(
                    system_instruction=system_prompt, temperature=0, max_output_tokens=max_tokens, response_mime_type="application/json"
                ),
            )
            return _extract_json_object(response.text or "")
        except Exception as exc:
            logger.warning("Gemini image request failed cleanly: %s", exc)
            return None

    # ------------------------------------------------------------------ OpenAI-compatible
    async def _stream_compat(
        self,
        provider: CompatProvider,
        system_prompt: str,
        user_prompt: str,
        temperature: float,
        max_tokens: int,
    ) -> AsyncIterator[str]:
        url = f"{provider.base_url.rstrip('/')}/chat/completions"
        headers = {"Authorization": f"Bearer {provider.api_key}", "Content-Type": "application/json"}
        messages = [{"role": "system", "content": system_prompt}, {"role": "user", "content": user_prompt}]
        for flip in (False, True):
            streamed = False
            try:
                payload = _chat_payload(provider, messages, temperature, max_tokens, stream=True, flip=flip)
                async with httpx.AsyncClient(timeout=20.0) as client:
                    async with client.stream("POST", url, headers=headers, json=payload) as response:
                        if response.status_code >= 400:
                            await response.aread()  # so the error text is available
                        response.raise_for_status()
                        async for raw_line in response.aiter_lines():
                            line = raw_line.strip()
                            if not line or not line.startswith("data:"):
                                continue
                            data_part = line[5:].strip()
                            if data_part == "[DONE]":
                                break
                            try:
                                event = json.loads(data_part)
                            except json.JSONDecodeError:
                                continue
                            choices = event.get("choices") or []
                            if not choices:
                                continue
                            delta = choices[0].get("delta", {}).get("content", "")
                            if isinstance(delta, list):
                                delta = "".join(part.get("text", "") for part in delta if isinstance(part, dict))
                            if delta:
                                streamed = True
                                _last_problem.pop(provider.name, None)
                                yield str(delta)
                return
            except Exception as exc:
                if not flip and not streamed and _wants_other_params(exc):
                    continue  # the model wants the other parameter style
                if _is_auth_failure(exc):
                    mark_provider_rejected(provider.name)
                _remember_failure(provider.name, exc)
                logger.warning("LLM provider %s stream failed cleanly: %s", provider.name, exc)
                return

    async def _complete_compat(
        self,
        provider: CompatProvider,
        system_prompt: str,
        user_prompt: str,
        temperature: float,
        max_tokens: int,
    ) -> dict[str, Any] | None:
        url = f"{provider.base_url.rstrip('/')}/chat/completions"
        headers = {"Authorization": f"Bearer {provider.api_key}", "Content-Type": "application/json"}
        messages = [{"role": "system", "content": system_prompt}, {"role": "user", "content": user_prompt}]
        for flip in (False, True):
            try:
                async with httpx.AsyncClient(timeout=30.0) as client:
                    response = await client.post(url, headers=headers, json=_chat_payload(provider, messages, temperature, max_tokens, flip=flip))
                    response.raise_for_status()
                    data = response.json()
                choices = data.get("choices") or []
                if not choices:
                    return None
                content = choices[0].get("message", {}).get("content", "")
                if isinstance(content, list):
                    content = "".join(part.get("text", "") for part in content if isinstance(part, dict))
                _last_problem.pop(provider.name, None)
                return _extract_json_object(str(content))
            except Exception as exc:
                if not flip and _wants_other_params(exc):
                    continue
                if _is_auth_failure(exc):
                    mark_provider_rejected(provider.name)
                _remember_failure(provider.name, exc)
                logger.warning("LLM provider %s request failed cleanly: %s", provider.name, exc)
                return None
        return None

    async def check_provider(self, provider: "str | CompatProvider") -> tuple[bool, str]:
        """A tiny real request to one provider. Returns (works, a sentence the person can act on)."""
        name = provider if isinstance(provider, str) else provider.name
        _last_problem.pop(name, None)
        if isinstance(provider, str):
            result = await self._complete_gemini("Reply with JSON only.", 'Return {"ok": true}', 0, 50)
        else:
            result = await self._complete_compat(provider, "Reply with JSON only.", 'Return {"ok": true}', 0, 50)
        if isinstance(result, dict):
            _banned_until.pop(name, None)
            return True, "Works."
        return False, _last_problem.get(name) or f"{provider_label(name)} did not give a usable answer."

    # ------------------------------------------------------------------ Gemini
    def _gemini_models(self) -> list[str]:
        candidates: list[str] = []
        for name in (self.settings.gemini_model, self.settings.llm_model if self.settings.llm_model.startswith("gemini-") else ""):
            if name and name not in candidates:
                candidates.append(name)
        return candidates or ["gemini-2.5-flash"]

    async def _stream_gemini(
        self,
        system_prompt: str,
        user_prompt: str,
        temperature: float,
        max_tokens: int,
    ) -> AsyncIterator[str]:
        try:
            from google import genai
            from google.genai import types

            client = genai.Client(api_key=self.settings.gemini_api_key)
            stream = await client.aio.models.generate_content_stream(
                model=self._gemini_models()[0],
                contents=user_prompt,
                config=types.GenerateContentConfig(
                    system_instruction=system_prompt,
                    temperature=temperature,
                    max_output_tokens=max_tokens,
                ),
            )
            async for chunk in stream:
                text = getattr(chunk, "text", None)
                if text:
                    yield str(text)
        except Exception as exc:
            if _is_auth_failure(exc):
                mark_provider_rejected("gemini")
            _remember_failure("gemini", exc)
            logger.warning("Gemini LLM stream failed cleanly: %s", exc)

    async def _complete_gemini(
        self,
        system_prompt: str,
        user_prompt: str,
        temperature: float,
        max_tokens: int,
    ) -> dict[str, Any] | None:
        try:
            from google import genai
            from google.genai import types

            client = genai.Client(api_key=self.settings.gemini_api_key)
            for model in self._gemini_models():
                try:
                    response = await client.aio.models.generate_content(
                        model=model,
                        contents=user_prompt,
                        config=types.GenerateContentConfig(
                            system_instruction=system_prompt,
                            temperature=temperature,
                            max_output_tokens=max_tokens,
                            response_mime_type="application/json",
                        ),
                    )
                    parsed = _extract_json_object(response.text or "")
                    if parsed is not None:
                        return parsed
                except Exception as inner_exc:
                    if _is_auth_failure(inner_exc):
                        mark_provider_rejected("gemini")
                        _remember_failure("gemini", inner_exc)
                        return None
                    _last_problem["gemini"] = f"Gemini did not accept the model “{model}”. Set GEMINI_MODEL in backend/.env to one your key can use." if "404" in str(inner_exc) or "NOT_FOUND" in str(inner_exc).upper() else plain_problem("gemini", None)
                    logger.warning("Gemini LLM model=%s failed: %s", model, inner_exc)
            return None
        except Exception as exc:
            _remember_failure("gemini", exc)
            logger.warning("Gemini LLM request failed cleanly: %s", exc)
            return None


def get_llm_adapter() -> LLMProviderAdapter:
    return LLMProviderAdapter()
