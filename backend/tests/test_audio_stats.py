import base64
import math
import struct

from app.modules.live.audio_stats import (PROBLEM_AFTER, QUIET_AFTER, SourceStats, level_percent)
from tests.test_pairing_and_answers import _collect_until, _signup, ws_env  # noqa: F401


def test_the_meter_moves_for_quiet_and_loud_speech() -> None:
    assert level_percent(0) == 0
    assert 0 < level_percent(260) < level_percent(1500) < level_percent(6000) <= 100
    assert level_percent(10**9) == 100


def test_states_follow_what_is_happening() -> None:
    st = SourceStats()
    assert st.state(100.0, True) == "no_audio"  # nothing has arrived

    st.on_frame(100.0, 10)  # sound card is delivering silence
    assert st.state(100.5, True) == "quiet"

    st.on_frame(101.0, 3000)  # someone starts talking
    assert st.state(101.2, True) == "hearing"
    assert st.state(101.2, False) == "no_stt"

    st.on_text(102.0)  # text comes back
    st.on_frame(102.1, 3000)
    assert st.state(102.2, True) == "ok"

    st.on_frame(100.0 + 3.1 + 100, 0)
    # capture stalls: no frames for a few seconds
    assert st.state(100.0 + 3.1 + 100 + 4, True) == "no_audio"


def test_speech_that_never_turns_into_text_becomes_a_problem() -> None:
    st = SourceStats()
    t = 50.0
    for i in range(int(PROBLEM_AFTER) + 3):
        st.on_frame(t + i, 3000)  # loud for longer than text should take
    assert st.state(t + PROBLEM_AFTER + 2, True) == "problem"
    st.on_text(t + PROBLEM_AFTER + 2.5)  # then it recovers
    assert st.state(t + PROBLEM_AFTER + 2.6, True) == "ok"


def test_a_pause_and_new_speech_starts_a_new_stretch() -> None:
    st = SourceStats()
    st.on_frame(10.0, 3000)
    st.on_text(10.5)
    st.on_frame(10.0 + QUIET_AFTER + 2, 10)  # quiet for a while
    assert st.state(10.0 + QUIET_AFTER + 2.1, True) == "quiet"
    st.on_frame(30.0, 3000)  # new question, not yet transcribed
    assert st.state(30.1, True) == "hearing"  # the old text does not count for the new speech


def _frame(loud: bool) -> str:
    n = 4000
    amp = 8000 if loud else 0
    return base64.b64encode(struct.pack(f"<{n}h", *[int(amp * math.sin(2 * math.pi * 220 * i / 16000)) for i in range(n)])).decode()


def test_the_server_sends_audio_stats_to_every_screen(ws_env, monkeypatch) -> None:
    tc, _ = ws_env
    headers = _signup(tc, "stats@example.com")
    sid = tc.post("/v1/sessions", headers=headers, json={"rules_acknowledged": True}).json()["id"]
    cap_token = tc.post(f"/v1/sessions/{sid}/token", headers=headers).json()["ws_token"]
    disp_token = tc.post(f"/v1/sessions/{sid}/token?role=display", headers=headers).json()["ws_token"]

    class FakeSTT:
        active_provider = "fake"
        is_configured = True

        async def transcribe_wav(self, wav, language="en"):
            return None

    monkeypatch.setattr("app.modules.live.session.get_stt_adapter", lambda: FakeSTT())
    with tc.websocket_connect(f"/v1/live/{sid}?token={cap_token}") as cap:
        cap.receive_json()
        with tc.websocket_connect(f"/v1/live/{sid}?token={disp_token}") as disp:
            disp.receive_json()
            cap.send_json({"type": "session.configure", "sources": ["tab", "microphone"]})
            cap.receive_json(); cap.receive_json()
            cap.send_json({"type": "audio.frame", "source": "tab", "sequence": 1, "sample_rate": 16000, "channels": 1, "payload": _frame(True)})
            stats = _collect_until(disp, "audio.stats")[-1]
    assert stats["stt_ready"] is True
    assert stats["sources"]["tab"]["level"] > 20 and stats["sources"]["tab"]["state"] in ("hearing", "ok")
    assert stats["sources"]["microphone"]["state"] == "no_audio"  # nothing from the microphone yet
