import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_extension_pairing_exchange_heartbeat_and_revocation(client: AsyncClient) -> None:
    signup = await client.post(
        "/v1/auth/signup",
        json={"email": "ext.user@example.com", "password": "StrongPassword123"},
    )
    assert signup.status_code == 201
    verify_token = signup.json()["dev_verification_token"]

    verified = await client.post("/v1/auth/verify", json={"token": verify_token})
    assert verified.status_code == 200
    web_token = verified.json()["access_token"]
    web_headers = {"Authorization": f"Bearer {web_token}"}

    # 1. Pair from web dashboard -> receive one-time pairing_token
    paired = await client.post("/v1/extensions/pair", json={"version": "0.1.0"}, headers=web_headers)
    assert paired.status_code == 201
    pairing_token = paired.json()["pairing_token"]
    conn_id = paired.json()["connection_id"]
    assert pairing_token.startswith("vren_ext_")

    # 2. Extension exchanges pairing_token for scoped extension JWT
    exchanged = await client.post(
        "/v1/extensions/exchange",
        json={"pairing_token": pairing_token, "version": "0.1.0"},
    )
    assert exchanged.status_code == 200
    ext_data = exchanged.json()
    ext_token = ext_data["access_token"]
    assert ext_data["connection_id"] == conn_id
    assert ext_data["user"]["email"] == "ext.user@example.com"
    ext_headers = {"Authorization": f"Bearer {ext_token}"}

    # 3. Single-use pairing token cannot be replayed
    replay = await client.post(
        "/v1/extensions/exchange",
        json={"pairing_token": pairing_token, "version": "0.1.0"},
    )
    assert replay.status_code == 401
    assert replay.json()["error"]["code"] == "INVALID_PAIRING_TOKEN"

    # 4. Extension JWT accesses /v1/me, /v1/extensions/heartbeat, and session creation + ws token
    me_res = await client.get("/v1/me", headers=ext_headers)
    assert me_res.status_code == 200
    assert me_res.json()["extension_connected"] is True

    hb_res = await client.post(
        "/v1/extensions/heartbeat",
        json={"version": "0.1.0", "connection_id": conn_id},
        headers=ext_headers,
    )
    assert hb_res.status_code == 200
    assert hb_res.json()["connected"] is True

    session_res = await client.post(
        "/v1/sessions",
        json={"state": "listening", "interview_type": "Mixed"},
        headers=ext_headers,
    )
    assert session_res.status_code == 201
    session_id = session_res.json()["id"]
    assert session_res.json()["snapshot"]["interview_type"] == "Mixed"

    ws_tok = await client.post(f"/v1/sessions/{session_id}/token", headers=ext_headers)
    assert ws_tok.status_code == 200
    assert ws_tok.json()["ws_token"]

    # 5. Revoke from web dashboard -> extension token is rejected immediately
    revoked = await client.post("/v1/extensions/revoke", headers=web_headers)
    assert revoked.status_code == 200

    blocked_me = await client.get("/v1/me", headers=ext_headers)
    assert blocked_me.status_code == 401
    assert blocked_me.json()["error"]["code"] == "EXTENSION_REVOKED"

    blocked_hb = await client.post(
        "/v1/extensions/heartbeat",
        json={"version": "0.1.0", "connection_id": conn_id},
        headers=ext_headers,
    )
    assert blocked_hb.status_code == 401

