"""Turns "the AI did not answer" into one plain sentence that says why."""

from app.adapters.llm import get_llm_adapter, last_problems

_REASONS = {
    "AI_PROVIDER_UNAVAILABLE": "No AI key is set up. Add OPENAI_API_KEY or GEMINI_API_KEY to backend/.env and restart the server.",
    "UNSUPPORTED_CLAIMS_REMOVED": "The answer had details that are not in your CV, so it was held back.",
}


def explain_unavailable(reason: str) -> str:
    """Why there is no answer. Uses what the providers last said, so the message names the real problem."""
    if reason == "AI_PROVIDER_UNAVAILABLE" and not get_llm_adapter().is_configured:
        return _REASONS[reason]
    problems = last_problems()
    if problems:
        return " ".join(problems[:2])
    return _REASONS.get(reason, "The AI did not answer. Try again in a moment.")
