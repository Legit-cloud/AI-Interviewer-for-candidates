import json
import logging
import os
import re
from collections.abc import AsyncIterator
from typing import Any

import httpx

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


class LLMProviderAdapter:
    """Unified server-side LLM adapter for AgentRouter/OpenAI-compatible gateways and Gemini."""

    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()

    @property
    def is_configured(self) -> bool:
        if "PYTEST_CURRENT_TEST" in os.environ or self.settings.env == "test":
            return False
        provider = self.settings.llm_provider
        if provider == "offline":
            return False
        if provider == "gemini":
            return bool(self.settings.gemini_api_key)
        return bool(self.settings.llm_api_key) or bool(self.settings.gemini_api_key)

    async def complete_json(
        self,
        system_prompt: str,
        user_prompt: str,
        temperature: float = 0.2,
        max_tokens: int = 1800,
    ) -> dict[str, Any] | None:
        if not self.is_configured:
            return None

        if self.settings.llm_provider == "gemini":
            return await self._complete_gemini(system_prompt, user_prompt, temperature, max_tokens)

        result = await self._complete_openai_compatible(
            system_prompt, user_prompt, temperature, max_tokens
        )
        if result is not None:
            return result
        if self.settings.gemini_api_key:
            return await self._complete_gemini(system_prompt, user_prompt, temperature, max_tokens)
        return None

    async def stream_text(
        self,
        system_prompt: str,
        user_prompt: str,
        temperature: float = 0.2,
        max_tokens: int = 240,
    ) -> AsyncIterator[str]:
        """Streams low-latency text tokens from the active LLM provider."""
        if not self.is_configured:
            return

        if self.settings.llm_provider == "gemini":
            async for chunk in self._stream_gemini(system_prompt, user_prompt, temperature, max_tokens):
                yield chunk
            return

        streamed_any = False
        async for chunk in self._stream_openai_compatible(
            system_prompt, user_prompt, temperature, max_tokens
        ):
            streamed_any = True
            yield chunk

        if not streamed_any and self.settings.gemini_api_key:
            async for chunk in self._stream_gemini(system_prompt, user_prompt, temperature, max_tokens):
                yield chunk

    async def _stream_openai_compatible(
        self,
        system_prompt: str,
        user_prompt: str,
        temperature: float,
        max_tokens: int,
    ) -> AsyncIterator[str]:
        base_url = self.settings.llm_base_url.rstrip("/")
        url = f"{base_url}/chat/completions"
        headers = {
            "Authorization": f"Bearer {self.settings.llm_api_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": self.settings.llm_model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": True,
        }
        try:
            async with httpx.AsyncClient(timeout=20.0) as client:
                async with client.stream("POST", url, headers=headers, json=payload) as response:
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
                            delta = "".join(
                                part.get("text", "") for part in delta if isinstance(part, dict)
                            )
                        if delta:
                            yield str(delta)
        except Exception as exc:
            logger.warning("OpenAI-compatible LLM stream failed cleanly: %s", exc)

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

            model = (
                self.settings.llm_model
                if self.settings.llm_model.startswith("gemini-")
                else "gemini-3.5-flash-lite"
            )
            client = genai.Client(api_key=self.settings.gemini_api_key)
            stream = await client.aio.models.generate_content_stream(
                model=model,
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
            logger.warning("Gemini LLM stream failed cleanly: %s", exc)

    async def _complete_openai_compatible(
        self,
        system_prompt: str,
        user_prompt: str,
        temperature: float,
        max_tokens: int,
    ) -> dict[str, Any] | None:
        base_url = self.settings.llm_base_url.rstrip("/")
        url = f"{base_url}/chat/completions"
        headers = {
            "Authorization": f"Bearer {self.settings.llm_api_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": self.settings.llm_model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(url, headers=headers, json=payload)
                response.raise_for_status()
                data = response.json()
            choices = data.get("choices") or []
            if not choices:
                return None
            content = choices[0].get("message", {}).get("content", "")
            if isinstance(content, list):
                content = "".join(
                    part.get("text", "") for part in content if isinstance(part, dict)
                )
            return _extract_json_object(str(content))
        except Exception as exc:
            logger.warning("OpenAI-compatible LLM request failed cleanly: %s", exc)
            return None

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

            candidates: list[str] = []
            if self.settings.llm_model.startswith("gemini-"):
                candidates.append(self.settings.llm_model)
            for fallback_model in (
                "gemini-3.5-flash-lite",
                "gemini-3.5-flash",
                "gemini-3.8-flash",
                "gemini-3.7-flash",
                "gemini-3.1-flash-lite",
            ):
                if fallback_model not in candidates:
                    candidates.append(fallback_model)

            client = genai.Client(api_key=self.settings.gemini_api_key)
            for model in candidates:
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
                    logger.warning("Gemini LLM model=%s failed: %s", model, inner_exc)
            return None
        except Exception as exc:
            logger.warning("Gemini LLM request failed cleanly: %s", exc)
            return None


def get_llm_adapter() -> LLMProviderAdapter:
    return LLMProviderAdapter()

