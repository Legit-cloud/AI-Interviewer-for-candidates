import re
from pathlib import Path
from uuid import UUID

from app.core.config import get_settings
from app.core.errors import AppError

_SAFE_FILENAME_RE = re.compile(r"[^A-Za-z0-9._-]+")


def sanitize_filename(filename: str) -> str:
    base = Path(filename).name.strip() or "document"
    cleaned = _SAFE_FILENAME_RE.sub("_", base).strip("._")
    return (cleaned or "document")[:120]


class LocalStorageAdapter:
    """Local filesystem object store designed cleanly for future Supabase Storage swap."""

    def __init__(self, base_dir: Path | None = None) -> None:
        settings = get_settings()
        self.base_dir = (base_dir or settings.storage_dir).resolve()

    def _resolve_key(self, storage_key: str) -> Path:
        candidate = (self.base_dir / storage_key).resolve()
        if not candidate.is_relative_to(self.base_dir):
            raise AppError(
                code="invalid_storage_key",
                message="Invalid document storage key.",
                status_code=400,
            )
        return candidate

    def save_bytes(self, user_id: UUID, doc_id: UUID, filename: str, data: bytes) -> str:
        safe_name = sanitize_filename(filename)
        storage_key = f"{user_id}/{doc_id}_{safe_name}"
        target = self._resolve_key(storage_key)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        return storage_key

    def read_bytes(self, storage_key: str) -> bytes:
        target = self._resolve_key(storage_key)
        if not target.exists():
            raise AppError(
                code="document_file_missing",
                message="Document file could not be found in storage.",
                status_code=404,
            )
        return target.read_bytes()

    def delete(self, storage_key: str) -> bool:
        target = self._resolve_key(storage_key)
        if target.exists():
            target.unlink()
            return True
        return False


def get_storage_adapter() -> LocalStorageAdapter:
    return LocalStorageAdapter()

