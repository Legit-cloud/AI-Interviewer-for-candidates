import base64

import pytest
from httpx import AsyncClient

from app.modules.live.question_detector import QuestionDetector
from app.modules.sessions.answer_style import split_code
from app.modules.sessions.image_question import read_question_from_image, valid_image
from tests.test_pairing_and_answers import _collect_until, _signup, _verified_headers, ws_env  # noqa: F401

PNG = base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"0" * 64).decode()
CODING = "Write a function that returns the two numbers in a list that add up to a target."


# ---------------------------------------------------------------- coding questions
@pytest.mark.parametrize("text", [CODING, "What is the time complexity of binary search?", "Implement an LRU cache"])
def test_coding_questions_are_recognised(text: str) -> None:
    got = QuestionDetector().inspect(text)
    assert got is not None and got.kind == "Coding"


def test_other_questions_are_not_coding() -> None:
    assert QuestionDetector().inspect("Tell me about a time you disagreed with a manager.").kind == "Behavioral"


def test_split_code_removes_fences_and_keeps_the_spoken_part() -> None:
    spoken, code = split_code("I'd use a hash map.\nIt's linear time.\nCODE:\n```python\ndef f(x):\n    return x\n```")
    assert spoken.strip().endswith("linear time.") and "CODE" not in spoken
    assert code == "def f(x):\n    return x"
    assert split_code("just words") == ("just words", "")


async def test_a_coding_answer_has_spoken_lines_and_a_separate_code_block(client: AsyncClient, fake_llm) -> None:
    headers = await _verified_headers(client, "code@example.com")
    sid = (await client.post("/v1/sessions", headers=headers, json={"rules_acknowledged": True})).json()["id"]
    fake_llm.text = (
        "- I'd keep a map from each number to its index and check for the match as I go.\n"
        "- That's one pass, so linear time and linear space.\n"
        "CODE:\n```python\ndef two_sum(nums, target):\n    seen = {}\n    for i, n in enumerate(nums):\n        if target - n in seen:\n            return [seen[target - n], i]\n        seen[n] = i\n```"
    )
    res = await client.post(f"/v1/sessions/{sid}/suggest", headers=headers, json={"question_text": CODING, "question_type": "Coding"})
    assert res.status_code == 201
    body = res.json()
    assert "def two_sum" in body["code"] and "```" not in body["code"]
    assert all("def " not in line and "CODE" not in line for line in body["outline"])
    assert any("linear" in line for line in body["outline"])
    system, _ = fake_llm.prompts[-1]
    assert "CODE:" in system and "coding question" in system
    saved = (await client.get(f"/v1/sessions/{sid}/answers", headers=headers)).json()
    assert "def two_sum" in saved[0]["code"]  # kept for the review page


# ---------------------------------------------------------------- screenshots
def test_image_validation() -> None:
    assert valid_image(PNG, "image/png")
    assert not valid_image(PNG, "image/gif") and not valid_image("not base64!!", "image/png") and not valid_image("", "image/png")
    assert not valid_image(base64.b64encode(b"0" * (3 * 1024 * 1024 + 1)).decode(), "image/png")


class _Vision:
    def __init__(self, reply):
        self.reply, self.calls, self.is_configured = reply, [], True

    async def complete_json_with_image(self, system, user, image_b64, mime, max_tokens=700):
        self.calls.append((system, user, mime))
        return self.reply


async def test_a_screenshot_becomes_a_question(monkeypatch) -> None:
    vision = _Vision({"question": "Given an array of integers, return the indices of two numbers that add up to a target.", "kind": "Coding"})
    monkeypatch.setattr("app.modules.sessions.image_question.get_llm_adapter", lambda: vision)
    got = await read_question_from_image(PNG, "image/png")
    assert got and got.kind == "Coding" and "two numbers" in got.text
    assert "untrusted" in vision.calls[0][0]


async def test_unreadable_or_empty_screenshots_give_nothing(monkeypatch) -> None:
    monkeypatch.setattr("app.modules.sessions.image_question.get_llm_adapter", lambda: _Vision({"question": "", "kind": "General"}))
    assert await read_question_from_image(PNG, "image/png") is None
    monkeypatch.setattr("app.modules.sessions.image_question.get_llm_adapter", lambda: _Vision(None))
    assert await read_question_from_image(PNG, "image/png") is None
    assert await read_question_from_image("", "image/png") is None  # never reaches the model


def _open(tc, email: str, role: str = "capture"):
    headers = _signup(tc, email)
    sid = tc.post("/v1/sessions", headers=headers, json={"rules_acknowledged": True}).json()["id"]
    token = tc.post(f"/v1/sessions/{sid}/token?role={role}", headers=headers).json()["ws_token"]
    return tc.websocket_connect(f"/v1/live/{sid}?token={token}")


@pytest.mark.parametrize("role", ["capture", "display"])
def test_a_screenshot_over_the_socket_is_answered(ws_env, monkeypatch, fake_llm, role) -> None:
    tc, _ = ws_env
    monkeypatch.setattr(
        "app.modules.sessions.image_question.get_llm_adapter",
        lambda: _Vision({"question": CODING, "kind": "Coding"}),
    )
    fake_llm.text = "- I'd use a map from value to index.\n- One pass, so linear time.\nCODE:\ndef two_sum(a, t):\n    return []"
    with _open(tc, f"img-{role}@example.com", role) as ws:
        ws.receive_json()
        ws.send_json({"type": "image.ask", "image": PNG, "mime": "image/png"})
        events = _collect_until(ws, "answer.ready")
    detected = next(e for e in events if e["type"] == "question.detected")
    assert detected["detection"] == "screenshot" and detected["kind"] == "Coding"
    assert "def two_sum" in events[-1]["answer"]["code"]


def test_an_unreadable_screenshot_says_so(ws_env, monkeypatch) -> None:
    tc, _ = ws_env
    monkeypatch.setattr("app.modules.sessions.image_question.get_llm_adapter", lambda: _Vision(None))
    with _open(tc, "bad-img@example.com") as ws:
        ws.receive_json()
        ws.send_json({"type": "image.ask", "image": PNG, "mime": "image/png"})
        evt = _collect_until(ws, "answer.unavailable")[-1]
    assert evt["reason"] == "IMAGE_UNREADABLE"
