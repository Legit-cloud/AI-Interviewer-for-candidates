from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class ExtensionPairIn(BaseModel):
    version: str = Field(default="0.1.0", max_length=40)


class ExtensionConnectionOut(BaseModel):
    connected: bool
    connection_id: UUID | None = None
    version: str | None = None
    connected_at: datetime | None = None
    last_seen_at: datetime | None = None


class ExtensionPairOut(ExtensionConnectionOut):
    pairing_token: str

