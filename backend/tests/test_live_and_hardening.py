import base64
from datetime import datetime, timedelta, timezone
from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool
from starlette.testclient import TestClient

from app.core.database import get_db
from app.core.errors import AppError
from app.core.rate_limit import rate_limiter
from app.db.base import Base
from app.db.models import InterviewPreferences, InterviewSession
from app.main import app


async def _verified_headers(client: AsyncClient, email: str) -> dict[str, str]:
    signup = await client.post("/v1/auth/signup", json={"email": email, "password": "StrongPassword1!"})
    assert signup.status_code == 201
    token = signup.json()["dev_verification_token"]
    verified = await client.post("/v1/auth/verify", json={"token": token})
    assert verified.status_code == 200
    return {"Authorization": f"Bearer {verified.json()['access_token']}"}


async def test_session_subroutes_stop_and_retention_purge(client: AsyncClient) -> None:
    headers = await _verified_headers(client, "retain@example.com")
    await client.patch(
        "/v1/preparation/preferences",
        headers=headers,
        json={"retain_transcript_default": True, "retention_days": 30},
    )

    sess = await client.post("/v1/sessions", headers=headers, json={"rules_acknowledged": True})
    assert sess.status_code == 201
    session_id = sess.json()["id"]

    # Add suggestion (records transcript segment since transcript_retained=True)
    sug = await client.post(
        f"/v1/sessions/{session_id}/suggest",
        headers=headers,
        json={"question_text": "How would you structure a Q3 paid search campaign?"},
    )
    assert sug.status_code == 201

    tr = await client.get(f"/v1/sessions/{session_id}/transcript", headers=headers)
    assert tr.status_code == 200
    assert tr.json()["retained"] is True
    assert len(tr.json()["segments"]) == 1

    sugs = await client.get(f"/v1/sessions/{session_id}/suggestions", headers=headers)
    assert sugs.status_code == 200
    assert len(sugs.json()) == 1

    # Explicit stop endpoint finalizes cleanly
    stopped = await client.post(f"/v1/sessions/{session_id}/stop", headers=headers)
    assert stopped.status_code == 200
    assert stopped.json()["state"] == "ended"

    # Cannot mint WS token on an already ended session
    token_res = await client.post(f"/v1/sessions/{session_id}/token", headers=headers)
    assert token_res.status_code == 409

    # Manual cleanup returns 0 while session is fresh (< 30 days)
    cleanup = await client.post("/v1/sessions/cleanup-expired", headers=headers)
    assert cleanup.status_code == 200
    assert cleanup.json()["purged_sessions"] == 0


async def test_rate_limiter_enforces_429() -> None:
    await rate_limiter.reset()
    await rate_limiter.check("unit_bucket", max_requests=2, window_seconds=60)
    await rate_limiter.check("unit_bucket", max_requests=2, window_seconds=60)
    with pytest.raises(AppError) as exc_info:
        await rate_limiter.check("unit_bucket", max_requests=2, window_seconds=60)
    assert exc_info.value.status_code == 429
    assert exc_info.value.code == "RATE_LIMIT_EXCEEDED"
    await rate_limiter.reset()


def test_live_websocket_protocol_question_detection_and_stop(tmp_path) -> None:
    db_file = tmp_path / "ws_test.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{db_file}", echo=False, poolclass=NullPool)
    session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    import asyncio

    async def _init():
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    asyncio.run(_init())

    async def override_get_db():
        async with session_factory() as db_sess:
            yield db_sess

    app.dependency_overrides[get_db] = override_get_db
    try:
        with TestClient(app) as tc:
            # Signup + verify user A
            su = tc.post("/v1/auth/signup", json={"email": "wsuser@example.com", "password": "StrongPassword1!"})
            assert su.status_code == 201
            vr = tc.post("/v1/auth/verify", json={"token": su.json()["dev_verification_token"]})
            headers_a = {"Authorization": f"Bearer {vr.json()['access_token']}"}

            # User B cannot mint token for user A's session
            su_b = tc.post("/v1/auth/signup", json={"email": "other@example.com", "password": "StrongPassword1!"})
            vr_b = tc.post("/v1/auth/verify", json={"token": su_b.json()["dev_verification_token"]})
            headers_b = {"Authorization": f"Bearer {vr_b.json()['access_token']}"}

            sess_res = tc.post("/v1/sessions", headers=headers_a, json={"transcript_retained": True, "rules_acknowledged": True})
            assert sess_res.status_code == 201
            session_id = sess_res.json()["id"]

            forbidden = tc.post(f"/v1/sessions/{session_id}/token", headers=headers_b)
            assert forbidden.status_code == 404

            tok_res = tc.post(f"/v1/sessions/{session_id}/token", headers=headers_a)
            assert tok_res.status_code == 200
            ws_token = tok_res.json()["ws_token"]

            with tc.websocket_connect(f"/v1/live/{session_id}") as ws:
                # Authenticate via first message (PRD §19)
                ws.send_json({"type": "session.auth", "token": ws_token})
                ready = ws.receive_json()
                assert ready["type"] == "session.ready"

                # Heartbeat
                ws.send_json({"type": "client.heartbeat"})
                hb = ws.receive_json()
                assert hb["type"] == "server.heartbeat"

                # Configure capture
                ws.send_json({"type": "session.configure", "sources": ["tab"]})
                cap = ws.receive_json()
                assert cap["type"] == "capture.state"
                assert cap["state"] == "listening"

                # Send audio frame + duplicate sequence
                pcm_sample = base64.b64encode(b"\x00\x00" * 160).decode("ascii")
                ws.send_json({"type": "audio.frame", "source": "tab", "sequence": 1, "payload": pcm_sample})
                # the level meter report may arrive first; the transcript update follows
                delta = ws.receive_json()
                while delta["type"] == "audio.stats":
                    delta = ws.receive_json()
                assert delta["type"] == "transcript.delta"
                # Duplicate frame seq=1 is ignored cleanly without emitting another delta
                ws.send_json({"type": "audio.frame", "source": "tab", "sequence": 1, "payload": pcm_sample})

                # Chatter suppressed cleanly (no question.detected)
                ws.send_json({"type": "utterance.commit", "source": "tab", "text": "Sounds good, thanks for joining"})
                chatter = ws.receive_json()
                assert chatter["type"] == "transcript.completed"

                # Real tough marketing question triggers detection + suggestion
                q_text = "How would you launch a paid social campaign on a small budget?"
                ws.send_json({"type": "utterance.commit", "source": "tab", "text": q_text})
                assert ws.receive_json()["type"] == "transcript.completed"
                qd = ws.receive_json()
                assert qd["type"] == "question.detected"
                assert ws.receive_json()["type"] == "answer.started"
                deltas = []
                sr = ws.receive_json()
                while sr["type"] == "answer.delta":
                    deltas.append(sr["delta"])
                    sr = ws.receive_json()
                assert len(deltas) >= 1
                assert sr["type"] == "answer.ready"
                assert len(sr["answer"]["lines"]) >= 2
                assert sr["answer"]["source_label"]

                # Pause + Resume + Stop
                ws.send_json({"type": "session.pause"})
                assert ws.receive_json()["state"] == "paused"
                ws.send_json({"type": "session.resume"})
                assert ws.receive_json()["state"] == "listening"

                ws.send_json({"type": "session.stop"})
                fin = ws.receive_json()
                assert fin["type"] == "session.finalized"
                assert fin["retained_transcript"] is True

            # Verify retention expiry cleanup deletes old transcripts
            async def _age_session():
                async with session_factory() as db_sess:
                    await db_sess.execute(
                        update(InterviewPreferences).values(retention_days=30)
                    )
                    await db_sess.execute(
                        update(InterviewSession)
                        .where(InterviewSession.id == UUID(session_id))
                        .values(started_at=datetime.now(timezone.utc) - timedelta(days=45))
                    )
                    await db_sess.commit()

            asyncio.run(_age_session())
            cleanup = tc.post("/v1/sessions/cleanup-expired", headers=headers_a)
            assert cleanup.status_code == 200
            assert cleanup.json()["purged_sessions"] == 1
            after_tr = tc.get(f"/v1/sessions/{session_id}/transcript", headers=headers_a)
            assert after_tr.json()["retained"] is False
            assert after_tr.json()["segments"] == []
    finally:
        app.dependency_overrides.clear()
        asyncio.run(engine.dispose())

