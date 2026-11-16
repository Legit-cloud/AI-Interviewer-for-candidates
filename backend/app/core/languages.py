"""Interview and answer languages.

The interview language (what the interviewer speaks) drives speech-to-text. The answer language is what
the candidate wants to read, and may differ from it. Keep the names in sync with `LANGUAGES` in
`src/lib/store.ts`.
"""

LANGUAGE_CODES: dict[str, str] = {
    "English": "en",
    "French": "fr",
    "Spanish": "es",
    "German": "de",
    "Portuguese": "pt",
    "Italian": "it",
    "Dutch": "nl",
    "Polish": "pl",
    "Russian": "ru",
    "Ukrainian": "uk",
    "Turkish": "tr",
    "Arabic": "ar",
    "Hebrew": "he",
    "Hindi": "hi",
    "Bengali": "bn",
    "Urdu": "ur",
    "Indonesian": "id",
    "Malay": "ms",
    "Vietnamese": "vi",
    "Thai": "th",
    "Filipino": "tl",
    "Japanese": "ja",
    "Korean": "ko",
    "Chinese": "zh",
    "Swedish": "sv",
    "Norwegian": "no",
    "Danish": "da",
    "Finnish": "fi",
    "Greek": "el",
    "Czech": "cs",
    "Romanian": "ro",
    "Hungarian": "hu",
    "Swahili": "sw",
    "Yoruba": "yo",
}

_BY_CODE = {code: name for name, code in LANGUAGE_CODES.items()}


def language_code(language: str | None) -> str:
    """ISO 639-1 code for a language name (or an existing code). Unknown values fall back to English."""
    if not language:
        return "en"
    value = language.strip()
    if value in LANGUAGE_CODES:
        return LANGUAGE_CODES[value]
    lowered = value.lower()
    for name, code in LANGUAGE_CODES.items():
        if name.lower() == lowered:
            return code
    return lowered if lowered in _BY_CODE else "en"


def language_name(language: str | None) -> str:
    """Display name for prompts. Accepts a name or a code; unknown values become English."""
    return _BY_CODE.get(language_code(language), "English")
