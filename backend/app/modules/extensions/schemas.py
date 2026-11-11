from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field

from app.modules.auth.schemas import UserSummary


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


class ExtensionExchangeIn(BaseModel):
    pairing_token: str = Field(min_length=12, max_length=256)
    version: str = Field(default="0.1.0", max_length=40)


class ExtensionExchangeOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_at: datetime
    connection_id: UUID
    user: UserSummary


class ExtensionHeartbeatIn(BaseModel):
    version: str = Field(default="0.1.0", max_length=40)
    connection_id: UUID | None = None

