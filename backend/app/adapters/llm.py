import json
import logging
import re
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
        provider = self.settings.llm_provider
        if provider == "offline":
            return False
        if provider == "gemini":
            return bool(self.settings.gemini_api_key)
        return bool(self.settings.llm_api_key)

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
        return await self._complete_openai_compatible(
            system_prompt, user_prompt, temperature, max_tokens
        )

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

            model = (
                self.settings.llm_model
                if self.settings.llm_model.startswith("gemini-")
                else "gemini-3.8-flash"
            )
            client = genai.Client(api_key=self.settings.gemini_api_key)
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
            return _extract_json_object(response.text or "")
        except Exception as exc:
            logger.warning("Gemini LLM request failed cleanly: %s", exc)
            return None


def get_llm_adapter() -> LLMProviderAdapter:
    return LLMProviderAdapter()

