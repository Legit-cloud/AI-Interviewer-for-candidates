import asyncio
from datetime import datetime, timedelta, timezone

import pytest
from httpx import AsyncClient
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool
from starlette.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.core.database import get_db
from app.db.base import Base
from app.db.models import CandidateExperience, PairingCode
from app.main import app
from app.modules.sessions.grounding import claim_check, rank_experiences

QUESTION = "How would you launch a paid social campaign on a small budget?"


# ---------------------------------------------------------------- unit: claim check and ranking
def test_claim_check_removes_unverified_figures_and_employers() -> None:
    allowed = "built fastapi services at paystack. reduced latency by 30%"
    kept, removed = claim_check(
        [
            "I cut latency by 30% on the payment services.",
            "I increased revenue by 450% in one quarter.",
            "During my time at Google I led a team.",
            "During my time at Paystack I built the services.",
        ],
        allowed,
    )
    assert any("30%" in k for k in kept)
    assert any("Paystack" in k for k in kept)
    assert any("450%" in r for r in removed)
    assert any("Google" in r for r in removed)


def test_rank_experiences_orders_by_relevance_and_drops_unrelated() -> None:
    def exp(title: str, summary: str) -> CandidateExperience:
        return CandidateExperience(
            kind="experience", title=title, organization="Acme", dates_text="", summary=summary,
            origin="verified", active=True,
        )

    items = [
        exp("Barista", "Served coffee to customers daily."),
        exp("Paid social lead", "Ran paid social campaigns on a small budget."),
        exp("Analyst", "Built reports for finance."),
    ]
    ranked = rank_experiences(QUESTION, items)
    assert [r.title for r in ranked] == ["Paid social lead"]


# ---------------------------------------------------------------- REST: answers
async def _verified_headers(client: AsyncClient, email: str) -> dict[str, str]:
    res = await client.post("/v1/auth/signup", json={"email": email, "password": "StrongPassword1!"})
    token = res.json()["dev_verification_token"]
    verified = await client.post("/v1/auth/verify", json={"token": token})
    return {"Authorization": f"Bearer {verified.json()['access_token']}"}


async def test_suggest_returns_unavailable_instead_of_canned_text(client: AsyncClient, fake_llm) -> None:
    headers = await _verified_headers(client, "unavail@example.com")
    sess = await client.post("/v1/sessions", headers=headers, json={"rules_acknowledged": True})
    session_id = sess.json()["id"]

    fake_llm.configured = False
    res = await client.post(f"/v1/sessions/{session_id}/suggest", headers=headers, json={"question_text": QUESTION})
    assert res.status_code == 503
    assert res.json()["error"]["code"] == "ANSWER_UNAVAILABLE"

    fake_llm.configured = True
    fake_llm.fail = True
    res = await client.post(f"/v1/sessions/{session_id}/suggest", headers=headers, json={"question_text": QUESTION})
    assert res.status_code == 503


async def test_suggest_strips_unsupported_claims(client: AsyncClient, fake_llm) -> None:
    headers = await _verified_headers(client, "claims@example.com")
    sess = await client.post("/v1/sessions", headers=headers, json={"rules_acknowledged": True})
    session_id = sess.json()["id"]
    fake_llm.text = (
        "- I would start with one clear goal for the campaign.\n"
        "- At my last job I grew signups by 900% in a month.\n"
        "- Then I would test two ad angles and keep the better one.\n"
    )
    res = await client.post(f"/v1/sessions/{session_id}/suggest", headers=headers, json={"question_text": QUESTION})
    assert res.status_code == 201
    joined = " ".join(res.json()["outline"])
    assert "900%" not in joined
    assert res.json()["caveat"]

    fake_llm.text = "- I grew signups by 900% in a month."
    res = await client.post(f"/v1/sessions/{session_id}/suggest", headers=headers, json={"question_text": QUESTION})
    assert res.status_code == 503


async def test_prompt_demands_answers_not_coaching(client: AsyncClient, fake_llm) -> None:
    headers = await _verified_headers(client, "prompt@example.com")
    sess = await client.post("/v1/sessions", headers=headers, json={"rules_acknowledged": True})
    await client.post(
        f"/v1/sessions/{sess.json()['id']}/suggest", headers=headers, json={"question_text": QUESTION}
    )
    system_prompt, _ = fake_llm.prompts[-1]
    assert "First person" in system_prompt
    assert "Never give advice about how to answer" in system_prompt


# ---------------------------------------------------------------- pairing + live room
@pytest.fixture
def ws_env(tmp_path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'pair.db'}", echo=False, poolclass=NullPool)
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async def _init():
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    asyncio.run(_init())

    async def override_get_db():
        async with factory() as db:
            yield db

    app.dependency_overrides[get_db] = override_get_db
    try:
        with TestClient(app) as tc:
            yield tc, factory
    finally:
        app.dependency_overrides.clear()
        asyncio.run(engine.dispose())


def _signup(tc: TestClient, email: str) -> dict[str, str]:
    su = tc.post("/v1/auth/signup", json={"email": email, "password": "StrongPassword1!"})
    vr = tc.post("/v1/auth/verify", json={"token": su.json()["dev_verification_token"]})
    return {"Authorization": f"Bearer {vr.json()['access_token']}"}


def _collect_until(ws, wanted: str, limit: int = 30) -> list[dict]:
    seen = []
    for _ in range(limit):
        evt = ws.receive_json()
        seen.append(evt)
        if evt["type"] == wanted:
            return seen
    raise AssertionError(f"never saw {wanted}: {[e['type'] for e in seen]}")


def test_pairing_flow_roles_and_fanout(ws_env) -> None:
    tc, _ = ws_env
    headers = _signup(tc, "pair@example.com")
    sid = tc.post("/v1/sessions", headers=headers, json={"transcript_retained": False, "rules_acknowledged": True}).json()["id"]

    code_res = tc.post(f"/v1/sessions/{sid}/pairing-code", headers=headers)
    assert code_res.status_code == 201
    code = code_res.json()["code"]
    assert len(code) == 6 and code.isdigit()

    # Invalid code is rejected; the real code works exactly once and needs no account credentials.
    assert tc.post("/v1/pairing/redeem", json={"code": "000000" if code != "000000" else "111111"}).status_code == 400
    redeem = tc.post("/v1/pairing/redeem", json={"code": code})
    assert redeem.status_code == 200
    capture_token = redeem.json()["ws_token"]
    assert tc.post("/v1/pairing/redeem", json={"code": code}).status_code == 400

    # The pairing token is not an account token.
    assert tc.get("/v1/profile", headers={"Authorization": f"Bearer {capture_token}"}).status_code == 401

    display_token = tc.post(f"/v1/sessions/{sid}/token?role=display", headers=headers).json()["ws_token"]

    with tc.websocket_connect(f"/v1/live/{sid}?token={capture_token}") as cap:
        assert cap.receive_json()["role"] == "capture"
        with tc.websocket_connect(f"/v1/live/{sid}?token={display_token}") as disp:
            assert disp.receive_json()["role"] == "display"

            # A second capture client is refused.
            second_capture = tc.post(f"/v1/sessions/{sid}/token?role=capture", headers=headers).json()["ws_token"]
            with pytest.raises(WebSocketDisconnect) as exc:
                with tc.websocket_connect(f"/v1/live/{sid}?token={second_capture}") as dup:
                    dup.receive_json()
            assert exc.value.code == 4409

            cap.send_json({"type": "session.configure", "sources": ["tab"]})
            assert cap.receive_json()["type"] == "capture.state"
            assert disp.receive_json()["type"] == "capture.state"

            # The display client cannot inject audio, but can type a test question.
            disp.send_json({"type": "audio.frame", "source": "tab", "sequence": 1, "payload": "AAAA"})
            disp.send_json({"type": "transcript.simulate", "source": "tab", "text": QUESTION})
            cap_events = _collect_until(cap, "answer.ready")
            disp_events = _collect_until(disp, "answer.ready")
            assert [e["type"] for e in cap_events] == [e["type"] for e in disp_events]
            ready = disp_events[-1]["answer"]
            assert ready["lines"] and ready["source_label"] and ready["key_points"]
            assert any(e["type"] == "answer.delta" for e in disp_events)

            # Display can stop; both clients are told the session is finalised.
            disp.send_json({"type": "session.stop"})
            assert _collect_until(disp, "session.finalized")[-1]["retained_transcript"] is False


def test_live_answer_unavailable_when_ai_is_down(ws_env, fake_llm) -> None:
    tc, _ = ws_env
    headers = _signup(tc, "down@example.com")
    sid = tc.post("/v1/sessions", headers=headers, json={"rules_acknowledged": True}).json()["id"]
    token = tc.post(f"/v1/sessions/{sid}/token", headers=headers).json()["ws_token"]
    fake_llm.configured = False
    with tc.websocket_connect(f"/v1/live/{sid}?token={token}") as ws:
        ws.receive_json()
        ws.send_json({"type": "transcript.simulate", "source": "tab", "text": QUESTION})
        events = _collect_until(ws, "answer.unavailable")
        assert events[-1]["reason"] == "AI_PROVIDER_UNAVAILABLE"
        assert not any(e["type"] in ("answer.delta", "answer.ready") for e in events)


def test_reconnect_replays_missed_events(ws_env) -> None:
    tc, _ = ws_env
    headers = _signup(tc, "replay@example.com")
    sid = tc.post("/v1/sessions", headers=headers, json={"rules_acknowledged": True}).json()["id"]
    cap_token = tc.post(f"/v1/sessions/{sid}/token", headers=headers).json()["ws_token"]
    disp_token = tc.post(f"/v1/sessions/{sid}/token?role=display", headers=headers).json()["ws_token"]

    with tc.websocket_connect(f"/v1/live/{sid}?token={cap_token}") as cap:
        cap.receive_json()
        with tc.websocket_connect(f"/v1/live/{sid}?token={disp_token}") as disp:
            disp.receive_json()
            cap.send_json({"type": "transcript.simulate", "source": "tab", "text": QUESTION})
            events = _collect_until(disp, "answer.ready")
            _collect_until(cap, "answer.ready")
            first_id = events[0]["event_id"]

        # Display reconnects having only seen the first event, and gets the rest back.
        with tc.websocket_connect(f"/v1/live/{sid}?token={disp_token}&last_event_id={first_id}") as disp2:
            assert disp2.receive_json()["type"] == "session.ready"
            replayed = _collect_until(disp2, "answer.ready")
            assert replayed[-1]["type"] == "answer.ready"
            assert all(e["event_id"] != first_id for e in replayed)


def test_expired_code_and_revoke(ws_env) -> None:
    tc, factory = ws_env
    headers = _signup(tc, "expire@example.com")
    sid = tc.post("/v1/sessions", headers=headers, json={"rules_acknowledged": True}).json()["id"]

    code = tc.post(f"/v1/sessions/{sid}/pairing-code", headers=headers).json()["code"]

    async def _expire():
        async with factory() as db:
            await db.execute(update(PairingCode).values(expires_at=datetime.now(timezone.utc) - timedelta(minutes=1)))
            await db.commit()

    asyncio.run(_expire())
    assert tc.post("/v1/pairing/redeem", json={"code": code}).status_code == 400

    # Revoking removes unredeemed codes and disconnects the paired capture client.
    code2 = tc.post(f"/v1/sessions/{sid}/pairing-code", headers=headers).json()["code"]
    token = tc.post("/v1/pairing/redeem", json={"code": code2}).json()["ws_token"]
    with tc.websocket_connect(f"/v1/live/{sid}?token={token}") as cap:
        assert cap.receive_json()["type"] == "session.ready"
        assert tc.post(f"/v1/sessions/{sid}/pairing/revoke", headers=headers).status_code == 204
        with pytest.raises(WebSocketDisconnect) as exc:
            cap.receive_json()
        assert exc.value.code == 4403


def test_session_time_limit_is_enforced(ws_env, monkeypatch) -> None:
    tc, _ = ws_env
    headers = _signup(tc, "limit@example.com")
    sid = tc.post("/v1/sessions", headers=headers, json={"rules_acknowledged": True}).json()["id"]
    token = tc.post(f"/v1/sessions/{sid}/token", headers=headers).json()["ws_token"]

    class _Zero:
        def __getattr__(self, name):
            from app.core.config import get_settings

            return 0 if name == "max_session_minutes" else getattr(get_settings(), name)

    monkeypatch.setattr("app.modules.live.session.get_settings", lambda: _Zero())
    with pytest.raises(WebSocketDisconnect) as exc:
        with tc.websocket_connect(f"/v1/live/{sid}?token={token}") as ws:
            ws.receive_json()
    assert exc.value.code == 4408


async def test_live_session_requires_rules_acknowledgement(client: AsyncClient) -> None:
    headers = await _verified_headers(client, "ack@example.com")
    sid = (await client.post("/v1/sessions", headers=headers, json={})).json()["id"]

    token = await client.post(f"/v1/sessions/{sid}/token", headers=headers)
    code = await client.post(f"/v1/sessions/{sid}/pairing-code", headers=headers)
    assert token.status_code == 412 and token.json()["error"]["code"] == "RULES_ACK_REQUIRED"
    assert code.status_code == 412

    acked = (await client.post("/v1/sessions", headers=headers, json={"rules_acknowledged": True})).json()
    assert acked["snapshot"]["rules_acknowledged_at"]
    assert (await client.post(f"/v1/sessions/{acked['id']}/pairing-code", headers=headers)).status_code == 201


async def test_unexpected_errors_return_json_and_health_reports_schema(client: AsyncClient, monkeypatch) -> None:
    from app.main import app as fastapi_app

    health = await client.get("/v1/health")
    assert health.status_code == 200 and health.json()["schema"] in ("ok", "needs_migration", "unknown")

    @fastapi_app.get("/v1/_boom")
    async def _boom() -> None:
        raise RuntimeError("kaboom")

    from httpx import ASGITransport

    async with AsyncClient(transport=ASGITransport(app=fastapi_app, raise_app_exceptions=False), base_url="http://test") as c:
        res = await c.get("/v1/_boom")
    assert res.status_code == 500
    assert res.json()["error"]["code"] == "INTERNAL_ERROR"
    assert "request_id" in res.json()["error"]


def _speech_frame(loud: bool) -> str:
    """One 250 ms frame of 16 kHz PCM16: a loud tone (stands in for speech) or near silence."""
    import base64
    import math
    import struct

    n = 4000
    amp = 8000 if loud else 0
    samples = [int(amp * math.sin(2 * math.pi * 220 * i / 16000)) for i in range(n)]
    return base64.b64encode(struct.pack(f"<{n}h", *samples)).decode()


def test_audio_frames_become_transcript_question_and_answer(ws_env, monkeypatch) -> None:
    """The whole server path for captured audio: frames -> end-of-turn -> speech-to-text -> question -> answer."""
    tc, _ = ws_env

    class FakeSTT:
        active_provider = "fake"
        is_configured = True
        heard: list[int] = []

        async def transcribe_wav(self, wav_bytes: bytes, language: str = "en") -> str | None:
            self.heard.append(len(wav_bytes))
            return QUESTION

    stt = FakeSTT()
    monkeypatch.setattr("app.modules.live.session.get_stt_adapter", lambda: stt)

    headers = _signup(tc, "audio@example.com")
    sid = tc.post("/v1/sessions", headers=headers, json={"rules_acknowledged": True}).json()["id"]
    token = tc.post(f"/v1/sessions/{sid}/token", headers=headers).json()["ws_token"]

    with tc.websocket_connect(f"/v1/live/{sid}?token={token}") as ws:
        ready = ws.receive_json()
        assert ready["stt_mode"] == "fake" and "answers_ready" in ready
        ws.send_json({"type": "session.configure", "sources": ["tab"]})
        assert ws.receive_json()["type"] == "capture.state"

        seq = 0
        for loud in (True, True, False):  # two frames of speech, then a quiet frame ends the turn
            seq += 1
            ws.send_json({"type": "audio.frame", "source": "tab", "sequence": seq, "sample_rate": 16000, "channels": 1, "payload": _speech_frame(loud)})
        events = _collect_until(ws, "answer.ready")

    types = [e["type"] for e in events]
    assert "transcript.completed" in types and "question.detected" in types
    completed = next(e for e in events if e["type"] == "transcript.completed")
    assert completed["speaker"] == "Interviewer" and completed["text"] == QUESTION
    assert stt.heard and stt.heard[0] > 16000  # a real WAV of the buffered speech was sent to speech-to-text


def test_language_codes_are_correct() -> None:
    from app.core.languages import language_code, language_name

    # These used to be derived from the first two letters of the name ("ge", "sp", "po"), which is wrong.
    assert [language_code(n) for n in ("German", "Spanish", "Portuguese", "Japanese", "Chinese")] == ["de", "es", "pt", "ja", "zh"]
    assert language_code("fr") == "fr" and language_code("klingon") == "en" and language_code(None) == "en"
    assert language_name("de") == "German"


async def test_separate_answer_language_and_framework_reach_the_prompt(client: AsyncClient, fake_llm) -> None:
    headers = await _verified_headers(client, "lang@example.com")
    patched = await client.patch(
        "/v1/preparation/preferences", headers=headers,
        json={"language": "German", "answer_language": "English", "framework": "SOAR"},
    )
    assert patched.status_code == 200 and patched.json()["answer_language"] == "English"
    sid = (await client.post("/v1/sessions", headers=headers, json={"rules_acknowledged": True})).json()["id"]
    res = await client.post(f"/v1/sessions/{sid}/suggest", headers=headers, json={"question_text": QUESTION})
    assert res.status_code == 201
    _, user_prompt = fake_llm.prompts[-1]
    assert "Write the answer in English" in user_prompt
    assert "SOAR" in user_prompt and "Obstacle" in user_prompt


def test_deepgram_switches_to_a_multilingual_model_for_non_english(ws_env, monkeypatch) -> None:
    tc, _ = ws_env
    seen: dict[str, str] = {}

    class FakeChannel:
        def __init__(self, api_key, model, source, on_transcript, language="en"):
            seen.update(model=model, language=language)

        async def connect(self) -> bool:
            return False  # no real network in tests

        async def close(self) -> None: ...

    class FakeSTT:
        active_provider = "deepgram"
        is_configured = True

    monkeypatch.setattr("app.modules.live.session.DeepgramStreamingChannel", FakeChannel)
    monkeypatch.setattr("app.modules.live.session.get_stt_adapter", lambda: FakeSTT())

    class _S:
        deepgram_api_key = "k"
        deepgram_model = "flux-general-en"
        max_session_minutes = 120

    monkeypatch.setattr("app.modules.live.session.get_settings", lambda: _S())

    headers = _signup(tc, "dg@example.com")
    assert tc.patch("/v1/preparation/preferences", headers=headers, json={"language": "German"}).status_code == 200
    sid = tc.post("/v1/sessions", headers=headers, json={"rules_acknowledged": True}).json()["id"]
    token = tc.post(f"/v1/sessions/{sid}/token", headers=headers).json()["ws_token"]
    with tc.websocket_connect(f"/v1/live/{sid}?token={token}") as ws:
        ws.receive_json()
        ws.send_json({"type": "session.configure", "sources": ["tab"]})
        ws.receive_json()
    assert seen == {"model": "nova-3", "language": "de"}


@pytest.mark.parametrize(
    ("configure", "expected_speaker"),
    [
        ({"sources": ["microphone"], "room": True}, "Interviewer"),  # phone / in person: the room is the interviewer
        ({"sources": ["tab", "microphone"]}, "You"),  # normal call: the microphone is the candidate
        ({"sources": ["tab", "microphone"], "room": True}, "You"),  # room mode only applies when the microphone is the only source
    ],
)
def test_room_mode_treats_the_microphone_as_the_interviewer(ws_env, configure, expected_speaker) -> None:
    tc, _ = ws_env
    headers = _signup(tc, "room@example.com")
    sid = tc.post("/v1/sessions", headers=headers, json={"rules_acknowledged": True}).json()["id"]
    token = tc.post(f"/v1/sessions/{sid}/token", headers=headers).json()["ws_token"]
    with tc.websocket_connect(f"/v1/live/{sid}?token={token}") as ws:
        ws.receive_json()
        ws.send_json({"type": "session.configure", **configure})
        ws.receive_json()
        ws.send_json({"type": "utterance.commit", "source": "microphone", "text": QUESTION})
        events = _collect_until(ws, "transcript.completed")
        if expected_speaker == "Interviewer":
            _collect_until(ws, "answer.ready")  # let the answer finish before closing the socket
        else:
            ws.send_json({"type": "client.heartbeat"})
            assert ws.receive_json()["type"] == "server.heartbeat"  # nothing was detected as a question
    assert events[-1]["speaker"] == expected_speaker


def test_a_display_only_pairing_never_conflicts_with_the_capture_app(ws_env) -> None:
    """The desktop app can pair to only show answers while the extension is the one listening."""
    tc, _ = ws_env
    headers = _signup(tc, "both@example.com")
    sid = tc.post("/v1/sessions", headers=headers, json={"rules_acknowledged": True}).json()["id"]

    code1 = tc.post(f"/v1/sessions/{sid}/pairing-code", headers=headers).json()["code"]
    capture = tc.post("/v1/pairing/redeem", json={"code": code1}).json()["ws_token"]
    code2 = tc.post(f"/v1/sessions/{sid}/pairing-code", headers=headers).json()["code"]
    display = tc.post("/v1/pairing/redeem", json={"code": code2, "role": "display"}).json()["ws_token"]

    with tc.websocket_connect(f"/v1/live/{sid}?token={capture}") as cap:
        assert cap.receive_json()["role"] == "capture"
        with tc.websocket_connect(f"/v1/live/{sid}?token={display}") as disp:
            assert disp.receive_json()["role"] == "display"
            cap.send_json({"type": "utterance.commit", "source": "tab", "text": QUESTION})
            assert _collect_until(disp, "answer.ready")[-1]["answer"]["lines"]  # the display app sees what the capture app heard
            _collect_until(cap, "answer.ready")
