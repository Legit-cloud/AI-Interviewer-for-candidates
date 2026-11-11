from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    env: Literal["development", "staging", "production", "test"] = "development"
    app_name: str = "Vren AI API"
    cors_origins: str = "http://localhost:3000,http://localhost:5173,http://127.0.0.1:5173"

    # PostgreSQL connection string (async psycopg3 driver)
    database_url: str = "postgresql+psycopg://postgres:postgres@127.0.0.1:5432/vren_ai"

    # Auth configuration ("local" for local Postgres auth, "supabase" for Supabase JWTs)
    auth_mode: Literal["local", "supabase"] = "local"
    jwt_secret: str = "dev-only-change-before-production-32chars-minimum"
    jwt_issuer: str = "vren-local-auth"
    jwt_audience: str = "vren-api"
    supabase_jwt_secret: str | None = None
    access_token_minutes: int = 30
    refresh_token_days: int = 14
    verification_token_hours: int = 24
    reset_token_minutes: int = 30

    # Private document storage
    storage_dir: Path = Path("./storage/uploads")
    max_upload_mb: int = 5
    max_cv_pages: int = 10

    # Server-side AI provider configuration (never sent to browser or extension)
    llm_provider: Literal["openai_compatible", "gemini", "offline"] = "openai_compatible"
    llm_base_url: str = "https://agentrouter.org/v1"
    llm_api_key: str | None = None
    llm_model: str = "claude-sonnet-4-5-20250929"
    gemini_api_key: str | None = None

    # Speech-to-Text provider configuration (server-side only; raw audio stays in RAM only)
    stt_provider: Literal["openai_compatible", "gemini", "offline"] = "offline"
    stt_base_url: str = "https://api.openai.com/v1"
    stt_api_key: str | None = None
    stt_model: str = "whisper-1"

    # Transactional email delivery (optional SMTP; dev_token previews remain active in dev/test)
    app_web_url: str = "http://localhost:5173"
    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_user: str | None = None
    smtp_password: str | None = None
    smtp_from_email: str = "noreply@vren.local"
    smtp_use_tls: bool = True

    # Rate limiting, retention, and session quotas
    rate_limit_enabled: bool = True
    max_session_minutes: int = 120
    daily_session_quota: int = 40

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def active_jwt_secret(self) -> str:
        if self.auth_mode == "supabase" and self.supabase_jwt_secret:
            return self.supabase_jwt_secret
        return self.jwt_secret


@lru_cache
def get_settings() -> Settings:
    return Settings()

