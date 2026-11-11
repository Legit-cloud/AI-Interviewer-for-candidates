import asyncio
import logging
import smtplib
from email.message import EmailMessage

from app.core.config import Settings, get_settings

logger = logging.getLogger(__name__)


class EmailAdapter:
    """Transactional email sender with SMTP support and safe local fallback."""

    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()

    @property
    def smtp_configured(self) -> bool:
        return bool(self.settings.smtp_host)

    def _send_sync(self, to_email: str, subject: str, body: str) -> None:
        assert self.settings.smtp_host
        msg = EmailMessage()
        msg["Subject"] = subject
        msg["From"] = self.settings.smtp_from_email
        msg["To"] = to_email
        msg.set_content(body)

        with smtplib.SMTP(self.settings.smtp_host, self.settings.smtp_port, timeout=10) as client:
            if self.settings.smtp_use_tls:
                client.starttls()
            if self.settings.smtp_user and self.settings.smtp_password:
                client.login(self.settings.smtp_user, self.settings.smtp_password)
            client.send_message(msg)

    async def send_email(self, to_email: str, subject: str, body: str) -> bool:
        if not self.smtp_configured:
            logger.info("SMTP not configured; skipping email dispatch (subject=%s)", subject)
            return False
        try:
            await asyncio.to_thread(self._send_sync, to_email, subject, body)
            return True
        except Exception as exc:
            logger.warning("Email delivery failed cleanly: %s", exc)
            return False

    async def send_verification_email(self, to_email: str, token: str) -> bool:
        verify_url = f"{self.settings.app_web_url.rstrip('/')}/auth?mode=verify&token={token}"
        body = (
            "Verify your email address to activate your Vren AI workspace.\n\n"
            f"Verification link: {verify_url}\n"
            f"Or use verification token: {token}\n\n"
            f"This link expires in {self.settings.verification_token_hours} hours."
        )
        return await self.send_email(to_email, "Verify your Vren AI account", body)

    async def send_password_reset_email(self, to_email: str, token: str) -> bool:
        reset_url = f"{self.settings.app_web_url.rstrip('/')}/auth?mode=signin&reset_token={token}"
        body = (
            "A password reset was requested for your Vren AI account.\n\n"
            f"Reset link: {reset_url}\n"
            f"Or use reset token: {token}\n\n"
            f"This token expires in {self.settings.reset_token_minutes} minutes."
        )
        return await self.send_email(to_email, "Reset your Vren AI password", body)


def get_email_adapter() -> EmailAdapter:
    return EmailAdapter()

