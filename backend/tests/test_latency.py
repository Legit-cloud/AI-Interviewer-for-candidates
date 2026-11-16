"""The audio path must never wait for the model."""

from tests.test_pairing_and_answers import QUESTION, _collect_until, _signup, ws_env  # noqa: F401


def _open(tc, email: str):
    headers = _signup(tc, email)
    sid = tc.post("/v1/sessions", headers=headers, json={"rules_acknowledged": True}).json()["id"]
    token = tc.post(f"/v1/sessions/{sid}/token", headers=headers).json()["ws_token"]
    return tc.websocket_connect(f"/v1/live/{sid}?token={token}")


def test_controls_and_audio_are_not_held_up_while_an_answer_is_written(ws_env, fake_llm) -> None:
    tc, _ = ws_env
    fake_llm.delay = 1.2  # a slow model
    with _open(tc, "slow@example.com") as ws:
        ws.receive_json()
        ws.send_json({"type": "utterance.commit", "source": "tab", "text": QUESTION})
        events = _collect_until(ws, "answer.started")  # the question is known straight away
        assert "question.detected" in [e["type"] for e in events]

        # The model is still thinking, yet a heartbeat is answered at once instead of after the answer.
        ws.send_json({"type": "client.heartbeat"})
        seen = []
        while True:
            evt = ws.receive_json()
            seen.append(evt["type"])
            if evt["type"] in ("server.heartbeat", "answer.ready"):
                break
        assert seen[-1] == "server.heartbeat", seen
        ready = _collect_until(ws, "answer.ready")[-1]["answer"]
        assert ready["lines"]


def test_a_newer_question_cancels_the_answer_still_being_written(ws_env, fake_llm) -> None:
    tc, _ = ws_env
    fake_llm.delay = 1.0
    with _open(tc, "cancel@example.com") as ws:
        ws.receive_json()
        ws.send_json({"type": "utterance.commit", "source": "tab", "text": "How would you launch a paid social campaign on a small budget?"})
        first = _collect_until(ws, "answer.started")[-1]
        ws.send_json({"type": "utterance.commit", "source": "tab", "text": "Tell me about a time you disagreed with a manager."})
        events = _collect_until(ws, "answer.ready")
        cancelled = [e for e in events if e["type"] == "answer.cancelled"]
        assert cancelled and cancelled[0]["question_id"] == first["question_id"]
        ready = events[-1]
        assert ready["answer"]["question_text"].startswith("Tell me about a time")  # only the newest one was answered


def test_every_answer_reports_how_long_it_took(ws_env, fake_llm) -> None:
    tc, _ = ws_env
    fake_llm.delay = 0.2
    with _open(tc, "timing@example.com") as ws:
        ws.receive_json()
        ws.send_json({"type": "utterance.commit", "source": "tab", "text": QUESTION})
        timing = _collect_until(ws, "answer.ready")[-1]["answer"]["timing"]
    assert timing["first_word_ms"] >= 150 and timing["total_ms"] >= timing["first_word_ms"]


def test_stopping_right_after_a_question_still_saves_the_answer(ws_env, fake_llm) -> None:
    tc, _ = ws_env
    fake_llm.delay = 0.5
    headers = _signup(tc, "stop@example.com")
    sid = tc.post("/v1/sessions", headers=headers, json={"rules_acknowledged": True}).json()["id"]
    token = tc.post(f"/v1/sessions/{sid}/token", headers=headers).json()["ws_token"]
    with tc.websocket_connect(f"/v1/live/{sid}?token={token}") as ws:
        ws.receive_json()
        ws.send_json({"type": "utterance.commit", "source": "tab", "text": QUESTION})
        _collect_until(ws, "answer.started")
        ws.send_json({"type": "session.stop"})
        _collect_until(ws, "session.finalized")
    answers = tc.get(f"/v1/sessions/{sid}/answers", headers=headers).json()
    assert len(answers) == 1  # the answer that was in flight was saved before the session closed
