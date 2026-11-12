from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.adapters.email import EmailAdapter, get_email_adapter
from app.adapters.storage import LocalStorageAdapter, get_storage_adapter
from app.core.config import get_settings
from app.core.database import get_db
from app.core.deps import get_current_user
from app.core.errors import AppError
from app.core.rate_limit import rate_limit
from app.core.security import (
    create_access_token,
    generate_opaque_token,
    hash_password,
    hash_token,
    verify_password,
)
from app.db.models import (
    AuditEvent,
    AuthToken,
    CandidateDocument,
    InterviewPreferences,
    Profile,
    User,
    UserConsent,
)
from app.modules.auth.schemas import (
    AuthTokensResponse,
    ForgotPasswordRequest,
    MeResponse,
    MessageResponse,
    RefreshRequest,
    ResendVerificationRequest,
    ResetPasswordRequest,
    SignInRequest,
    SignUpRequest,
    SignUpResponse,
    UserSummary,
    VerifyEmailRequest,
)

router = APIRouter(prefix="/v1", tags=["auth"])


def _user_summary(user: User) -> UserSummary:
    return UserSummary(
        id=user.id,
        email=user.email,
        verified=user.is_verified,
        onboarded=user.onboarded,
        created_at=user.created_at,
    )


async def _issue_session_tokens(db: AsyncSession, user: User) -> AuthTokensResponse:
    settings = get_settings()
    access_token, expires_at = create_access_token(user.id, user.email)
    raw_refresh = generate_opaque_token()
    db.add(
        AuthToken(
            user_id=user.id,
            token_hash=hash_token(raw_refresh),
            kind="refresh",
            expires_at=datetime.now(UTC) + timedelta(days=settings.refresh_token_days),
        )
    )
    await db.commit()
    return AuthTokensResponse(
        access_token=access_token,
        refresh_token=raw_refresh,
        expires_at=expires_at,
        user=_user_summary(user),
    )


@router.post(
    "/auth/signup",
    response_model=SignUpResponse,
    status_code=201,
    dependencies=[Depends(rate_limit("auth_signup", 15, 300))],
)
async def signup(
    payload: SignUpRequest,
    db: AsyncSession = Depends(get_db),
    mailer: EmailAdapter = Depends(get_email_adapter),
) -> SignUpResponse:
    settings = get_settings()
    email = payload.email.strip().lower()
    existing = await db.scalar(select(User).where(User.email == email))
    if existing:
        raise AppError("EMAIL_EXISTS", "An account with that email already exists.", 409)

    user = User(
        email=email,
        password_hash=hash_password(payload.password),
        is_verified=False,
        onboarded=False,
    )
    db.add(user)
    await db.flush()

    db.add(Profile(user_id=user.id, full_name=email.split("@")[0].replace(".", " ").title()))
    db.add(InterviewPreferences(user_id=user.id))
    db.add(
        UserConsent(
            user_id=user.id,
            consent_type="terms",
            label="Terms and privacy accepted",
            detail="Version 1.0",
        )
    )
    db.add(
        UserConsent(
            user_id=user.id,
            consent_type="transcript_retention",
            label="Transcript retention off by default",
            detail="Default setting",
        )
    )

    raw_verify = generate_opaque_token()
    db.add(
        AuthToken(
            user_id=user.id,
            token_hash=hash_token(raw_verify),
            kind="verify_email",
            expires_at=datetime.now(UTC) + timedelta(hours=settings.verification_token_hours),
        )
    )
    db.add(AuditEvent(user_id=user.id, event_type="auth.signup", metadata_json={}))
    await db.commit()
    await db.refresh(user)
    await mailer.send_verification_email(email, raw_verify)

    return SignUpResponse(
        user=_user_summary(user),
        message="Account created. Check your inbox for your verification link.",
        dev_verification_token=raw_verify if settings.env in ("development", "test") else None,
    )


@router.post("/auth/verify", response_model=AuthTokensResponse)
async def verify_email(
    payload: VerifyEmailRequest, db: AsyncSession = Depends(get_db)
) -> AuthTokensResponse:
    token_row = await db.scalar(
        select(AuthToken).where(
            AuthToken.token_hash == hash_token(payload.token),
            AuthToken.kind == "verify_email",
        )
    )
    now = datetime.now(UTC)
    if not token_row or token_row.used_at is not None or token_row.expires_at.replace(tzinfo=UTC) < now:
        raise AppError(
            "VERIFICATION_TOKEN_INVALID",
            "Verification link is invalid or expired. Request a new email.",
            400,
        )

    user = await db.scalar(select(User).where(User.id == token_row.user_id))
    if not user:
        raise AppError("USER_NOT_FOUND", "Account not found.", 404)

    token_row.used_at = now
    user.is_verified = True
    db.add(AuditEvent(user_id=user.id, event_type="auth.verified", metadata_json={}))
    return await _issue_session_tokens(db, user)


@router.post(
    "/auth/resend-verification",
    response_model=MessageResponse,
    dependencies=[Depends(rate_limit("auth_resend", 10, 300))],
)
async def resend_verification(
    payload: ResendVerificationRequest,
    db: AsyncSession = Depends(get_db),
    mailer: EmailAdapter = Depends(get_email_adapter),
) -> MessageResponse:
    settings = get_settings()
    email = payload.email.strip().lower()
    user = await db.scalar(select(User).where(User.email == email))
    if not user or user.is_verified:
        return MessageResponse(message="If an unverified account exists, a new link was sent.")

    raw_verify = generate_opaque_token()
    db.add(
        AuthToken(
            user_id=user.id,
            token_hash=hash_token(raw_verify),
            kind="verify_email",
            expires_at=datetime.now(UTC) + timedelta(hours=settings.verification_token_hours),
        )
    )
    await db.commit()
    await mailer.send_verification_email(email, raw_verify)
    return MessageResponse(
        message="If an unverified account exists, a new link was sent.",
        dev_token=raw_verify if settings.env in ("development", "test") else None,
    )


@router.post(
    "/auth/signin",
    response_model=AuthTokensResponse,
    dependencies=[Depends(rate_limit("auth_signin", 20, 300))],
)
async def signin(payload: SignInRequest, db: AsyncSession = Depends(get_db)) -> AuthTokensResponse:
    email = payload.email.strip().lower()
    user = await db.scalar(select(User).where(User.email == email))
    if not user or not verify_password(payload.password, user.password_hash):
        raise AppError(
            "INVALID_CREDENTIALS",
            "We could not sign you in. Check your details or reset your password.",
            401,
        )
    if not user.is_verified:
        raise AppError(
            "EMAIL_NOT_VERIFIED",
            "Verify your email address before signing in.",
            403,
        )

    db.add(AuditEvent(user_id=user.id, event_type="auth.signin", metadata_json={}))
    return await _issue_session_tokens(db, user)


@router.post("/auth/refresh", response_model=AuthTokensResponse)
async def refresh(payload: RefreshRequest, db: AsyncSession = Depends(get_db)) -> AuthTokensResponse:
    token_row = await db.scalar(
        select(AuthToken).where(
            AuthToken.token_hash == hash_token(payload.refresh_token),
            AuthToken.kind == "refresh",
        )
    )
    now = datetime.now(UTC)
    if not token_row or token_row.used_at is not None or token_row.expires_at.replace(tzinfo=UTC) < now:
        raise AppError("REFRESH_INVALID", "Session expired. Please sign in again.", 401)

    user = await db.scalar(select(User).where(User.id == token_row.user_id))
    if not user:
        raise AppError("USER_NOT_FOUND", "Account not found.", 401)

    token_row.used_at = now
    return await _issue_session_tokens(db, user)


@router.post(
    "/auth/forgot-password",
    response_model=MessageResponse,
    dependencies=[Depends(rate_limit("auth_forgot", 10, 300))],
)
async def forgot_password(
    payload: ForgotPasswordRequest,
    db: AsyncSession = Depends(get_db),
    mailer: EmailAdapter = Depends(get_email_adapter),
) -> MessageResponse:
    settings = get_settings()
    email = payload.email.strip().lower()
    user = await db.scalar(select(User).where(User.email == email))
    dev_token: str | None = None
    if user:
        raw_reset = generate_opaque_token()
        db.add(
            AuthToken(
                user_id=user.id,
                token_hash=hash_token(raw_reset),
                kind="reset_password",
                expires_at=datetime.now(UTC) + timedelta(minutes=settings.reset_token_minutes),
            )
        )
        db.add(AuditEvent(user_id=user.id, event_type="auth.password_reset_requested", metadata_json={}))
        await db.commit()
        await mailer.send_password_reset_email(email, raw_reset)
        if settings.env in ("development", "test"):
            dev_token = raw_reset

    return MessageResponse(
        message="If an account exists for that email, a reset link is on its way.",
        dev_token=dev_token,
    )


@router.post("/auth/reset-password", response_model=MessageResponse)
async def reset_password(
    payload: ResetPasswordRequest, db: AsyncSession = Depends(get_db)
) -> MessageResponse:
    token_row = await db.scalar(
        select(AuthToken).where(
            AuthToken.token_hash == hash_token(payload.token),
            AuthToken.kind == "reset_password",
        )
    )
    now = datetime.now(UTC)
    if not token_row or token_row.used_at is not None or token_row.expires_at.replace(tzinfo=UTC) < now:
        raise AppError("RESET_TOKEN_INVALID", "Password reset link is invalid or expired.", 400)

    user = await db.scalar(select(User).where(User.id == token_row.user_id))
    if not user:
        raise AppError("USER_NOT_FOUND", "Account not found.", 404)

    token_row.used_at = now
    user.password_hash = hash_password(payload.new_password)
    # Invalidate active refresh tokens upon password change
    await db.execute(
        delete(AuthToken).where(AuthToken.user_id == user.id, AuthToken.kind == "refresh")
    )
    db.add(AuditEvent(user_id=user.id, event_type="auth.password_reset_completed", metadata_json={}))
    await db.commit()
    return MessageResponse(message="Password updated. You can sign in now.")


@router.get("/me", response_model=MeResponse)
async def get_me(
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
) -> MeResponse:
    profile = await db.scalar(select(Profile).where(Profile.user_id == user.id))
    return MeResponse(
        user=_user_summary(user),
        full_name=profile.full_name if profile else "",
        headline=profile.headline if profile else "",
        language=profile.language if profile else "English",
        role_focus=profile.role_focus if profile else "",
        checklist_dismissed=profile.checklist_dismissed if profile else False,
    )


@router.delete(
    "/me",
    response_model=MessageResponse,
    dependencies=[Depends(rate_limit("account_delete", 5, 300))],
)
async def delete_me(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    storage: LocalStorageAdapter = Depends(get_storage_adapter),
) -> MessageResponse:
    user_id = user.id
    docs = (
        await db.execute(select(CandidateDocument).where(CandidateDocument.user_id == user_id))
    ).scalars().all()
    storage_keys = [d.storage_key for d in docs]
    await db.delete(user)
    db.add(AuditEvent(user_id=None, event_type="account.deleted", metadata_json={"deleted_user_id": str(user_id)}))
    await db.commit()
    for key in storage_keys:
        storage.delete(key)
    return MessageResponse(message="Account and all associated records deleted.")

