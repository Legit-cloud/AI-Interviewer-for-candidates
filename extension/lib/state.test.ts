import { describe, expect, it } from "vitest";
import { reduceEvent } from "./state";
import { emptyState, type LiveAnswer, type ServerEvent } from "./types";

const ev = (type: string, extra: Record<string, unknown> = {}): ServerEvent => ({ event_id: `e_${type}`, session_id: "s1", type, ...extra });
const answer = (id: string): LiveAnswer => ({
  id, question_text: "Q?", question_type: "Behavioral", asked_at: "00:10", framework: "STAR",
  answer: "I did the thing.", lines: ["I did the thing."], key_points: ["did the thing"], source_label: "Direct answer", caveat: "",
});

describe("panel state reducer", () => {
  it("streams an answer and replaces it with the final one", () => {
    let s = emptyState();
    s = reduceEvent(s, ev("answer.started", { question_id: "q1", question_text: "Tell me about X" }));
    s = reduceEvent(s, ev("answer.delta", { question_id: "q1", delta: "- I did " }));
    s = reduceEvent(s, ev("answer.delta", { question_id: "q1", delta: "the thing." }));
    expect(s.pending?.text).toBe("- I did the thing.");
    s = reduceEvent(s, ev("answer.ready", { question_id: "q1", answer: answer("a1") }));
    expect(s.pending).toBeNull();
    expect(s.answers[0]?.answer).toBe("I did the thing.");
  });

  it("ignores deltas for a different question and duplicate final answers", () => {
    let s = reduceEvent(emptyState(), ev("answer.started", { question_id: "q1", question_text: "?" }));
    s = reduceEvent(s, ev("answer.delta", { question_id: "other", delta: "x" }));
    expect(s.pending?.text).toBe("");
    s = reduceEvent(s, ev("answer.ready", { answer: answer("a1") }));
    s = reduceEvent(s, ev("answer.ready", { answer: answer("a1") }));
    expect(s.answers).toHaveLength(1);
  });

  it("shows an explicit notice instead of an answer when unavailable", () => {
    let s = reduceEvent(emptyState(), ev("answer.started", { question_id: "q1", question_text: "?" }));
    s = reduceEvent(s, ev("answer.unavailable", { message: "Answer unavailable for this question." }));
    expect(s.pending).toBeNull();
    expect(s.answers).toHaveLength(0);
    expect(s.notice).toMatch(/unavailable/i);
  });

  it("marks the session ended on finalise or expiry", () => {
    expect(reduceEvent(emptyState(), ev("session.finalized")).ended).toBe(true);
    expect(reduceEvent(emptyState(), ev("session.expired")).ended).toBe(true);
  });

  it("tracks capture state and bounds the transcript", () => {
    let s = reduceEvent(emptyState(), ev("capture.state", { state: "paused" }));
    expect(s.capture).toBe("paused");
    for (let i = 0; i < 60; i += 1) s = reduceEvent(s, ev("transcript.completed", { item_id: `t${i}`, text: "x", speaker: "Interviewer" }));
    expect(s.transcript.length).toBeLessThanOrEqual(40);
  });
});
