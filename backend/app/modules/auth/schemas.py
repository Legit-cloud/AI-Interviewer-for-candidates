from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field


class SignUpRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class SignInRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class VerifyEmailRequest(BaseModel):
    token: str = Field(min_length=16, max_length=256)


class ResendVerificationRequest(BaseModel):
    email: EmailStr


class RefreshRequest(BaseModel):
    refresh_token: str = Field(min_length=16, max_length=256)


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str = Field(min_length=16, max_length=256)
    new_password: str = Field(min_length=8, max_length=128)


class UserSummary(BaseModel):
    id: UUID
    email: str
    verified: bool
    onboarded: bool
    created_at: datetime


class AuthTokensResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_at: datetime
    user: UserSummary


class SignUpResponse(BaseModel):
    user: UserSummary
    message: str
    dev_verification_token: str | None = None


class MessageResponse(BaseModel):
    message: str
    dev_token: str | None = None


class MeResponse(BaseModel):
    user: UserSummary
    full_name: str
    headline: str
    language: str
    role_focus: str
    checklist_dismissed: bool
    extension_connected: bool

