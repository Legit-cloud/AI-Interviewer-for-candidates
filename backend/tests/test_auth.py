import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_health(client: AsyncClient) -> None:
    res = await client.get("/v1/health")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"
    assert res.headers["x-request-id"].startswith("req_")


@pytest.mark.asyncio
async def test_auth_lifecycle_and_account_deletion(client: AsyncClient) -> None:
    # 1. Sign up
    signup = await client.post(
        "/v1/auth/signup",
        json={"email": "ada.obi@example.com", "password": "StrongPassword123"},
    )
    assert signup.status_code == 201
    data = signup.json()
    assert data["user"]["verified"] is False
    verify_token = data["dev_verification_token"]
    assert verify_token

    # 2. Cannot sign in before email verification
    pre_signin = await client.post(
        "/v1/auth/signin",
        json={"email": "ada.obi@example.com", "password": "StrongPassword123"},
    )
    assert pre_signin.status_code == 403
    assert pre_signin.json()["error"]["code"] == "EMAIL_NOT_VERIFIED"

    # 3. Verify email
    verified = await client.post("/v1/auth/verify", json={"token": verify_token})
    assert verified.status_code == 200
    tokens = verified.json()
    assert tokens["user"]["verified"] is True
    access = tokens["access_token"]
    refresh = tokens["refresh_token"]

    # 4. Fetch /v1/me
    me = await client.get("/v1/me", headers={"Authorization": f"Bearer {access}"})
    assert me.status_code == 200
    assert me.json()["user"]["email"] == "ada.obi@example.com"
    assert me.json()["full_name"] == "Ada Obi"

    # 5. Refresh token rotation
    refreshed = await client.post("/v1/auth/refresh", json={"refresh_token": refresh})
    assert refreshed.status_code == 200
    assert refreshed.json()["refresh_token"] != refresh

    # Old refresh token cannot be reused
    reused = await client.post("/v1/auth/refresh", json={"refresh_token": refresh})
    assert reused.status_code == 401

    # 6. Password reset flow
    forgot = await client.post("/v1/auth/forgot-password", json={"email": "ada.obi@example.com"})
    assert forgot.status_code == 200
    reset_token = forgot.json()["dev_token"]
    assert reset_token

    reset = await client.post(
        "/v1/auth/reset-password",
        json={"token": reset_token, "new_password": "NewStrongPassword456"},
    )
    assert reset.status_code == 200

    # Sign in with new password
    signin = await client.post(
        "/v1/auth/signin",
        json={"email": "ada.obi@example.com", "password": "NewStrongPassword456"},
    )
    assert signin.status_code == 200
    new_access = signin.json()["access_token"]

    # 7. Delete account cascades cleanly
    deleted = await client.delete("/v1/me", headers={"Authorization": f"Bearer {new_access}"})
    assert deleted.status_code == 200

    after = await client.get("/v1/me", headers={"Authorization": f"Bearer {new_access}"})
    assert after.status_code == 401



async def test_change_password(client: AsyncClient) -> None:
    signup = await client.post("/v1/auth/signup", json={"email": "chg@example.com", "password": "StrongPassword1!"})
    verified = await client.post("/v1/auth/verify", json={"token": signup.json()["dev_verification_token"]})
    headers = {"Authorization": f"Bearer {verified.json()['access_token']}"}

    wrong = await client.post(
        "/v1/auth/change-password", headers=headers,
        json={"current_password": "nope-nope-nope", "new_password": "BrandNewPassword2!"},
    )
    assert wrong.status_code == 400 and wrong.json()["error"]["code"] == "CURRENT_PASSWORD_INVALID"

    same = await client.post(
        "/v1/auth/change-password", headers=headers,
        json={"current_password": "StrongPassword1!", "new_password": "StrongPassword1!"},
    )
    assert same.status_code == 400

    ok = await client.post(
        "/v1/auth/change-password", headers=headers,
        json={"current_password": "StrongPassword1!", "new_password": "BrandNewPassword2!"},
    )
    assert ok.status_code == 200 and ok.json()["access_token"]

    old = await client.post("/v1/auth/signin", json={"email": "chg@example.com", "password": "StrongPassword1!"})
    new = await client.post("/v1/auth/signin", json={"email": "chg@example.com", "password": "BrandNewPassword2!"})
    assert old.status_code == 401 and new.status_code == 200
    # the old refresh token no longer works, the new one does
    assert (await client.post("/v1/auth/refresh", json={"refresh_token": verified.json()["refresh_token"]})).status_code == 401
    assert (await client.post("/v1/auth/refresh", json={"refresh_token": ok.json()["refresh_token"]})).status_code == 200
