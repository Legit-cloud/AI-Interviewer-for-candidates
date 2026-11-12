"""Detects a database that has not had the latest Alembic migrations applied."""

import logging
from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)
_BACKEND_DIR = Path(__file__).resolve().parents[2]


def _head_revision() -> str | None:
    cfg = Config()
    cfg.set_main_option("script_location", str(_BACKEND_DIR / "alembic"))
    return ScriptDirectory.from_config(cfg).get_current_head()


async def schema_status(db: AsyncSession) -> str:
    """Returns 'ok', 'needs_migration', or 'unknown' (for example when tables were created without Alembic)."""
    try:
        head = _head_revision()
        current = (await db.execute(text("SELECT version_num FROM alembic_version"))).scalar_one_or_none()
    except Exception:
        return "unknown"
    return "ok" if current == head else "needs_migration"
