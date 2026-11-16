import { describe, expect, it } from "vitest";
import { levelPercent, readMeter, rmsOfFloat, visibleSources } from "./overlay-model";
import { emptyState, type OverlayView, type SourceReport, type SourceState } from "./types";

const NOW = 100_000;
const view = (over: Partial<OverlayView["state"]> = {}, levels = { tab: 0, microphone: 0 }): Pick<OverlayView, "levels" | "state"> => ({
  levels,
  state: { ...emptyState(), connection: "connected", capture: "listening", ...over },
});
const report = (state: SourceState, level = 50): Record<"tab", SourceReport> => ({ tab: { level, state, text_ago: null } });

describe("sound check wording", () => {
  it("says transcribing only when the server confirms text is coming back", () => {
    const r = readMeter("tab", view({ audio: report("ok"), audioAt: NOW - 500 }, { tab: 60, microphone: 0 }), NOW);
    expect(r).toEqual({ label: "Transcribing ✓", tone: "good", level: 60 });
  });

  it("is honest about each problem", () => {
    const at = (state: SourceState) => readMeter("tab", view({ audio: report(state), audioAt: NOW - 500 }, { tab: 30, microphone: 0 }), NOW);
    expect(at("no_audio")).toMatchObject({ label: "No sound", tone: "bad", level: 0 });
    expect(at("no_stt")).toMatchObject({ tone: "bad" });
    expect(at("problem")).toMatchObject({ label: "Can't turn it into text", tone: "bad" });
    expect(at("quiet")).toMatchObject({ tone: "wait" });
    expect(at("hearing")).toMatchObject({ tone: "wait" });
  });

  it("notices when sound is arriving here but nothing comes back from the server", () => {
    const stale = readMeter("tab", view({ audio: report("ok"), audioAt: NOW - 9000 }, { tab: 40, microphone: 0 }), NOW);
    expect(stale).toMatchObject({ label: "Not reaching Vren", tone: "bad" });
    const silent = readMeter("tab", view({ audio: report("ok"), audioAt: NOW - 9000 }, { tab: 0, microphone: 0 }), NOW);
    expect(silent).toMatchObject({ label: "No sound", tone: "bad" });
  });

  it("waits quietly before the first report, and while paused or reconnecting", () => {
    expect(readMeter("tab", view({}, { tab: 0, microphone: 0 }), NOW)).toMatchObject({ label: "Waiting for sound", tone: "wait" });
    expect(readMeter("tab", view({}, { tab: 30, microphone: 0 }), NOW)).toMatchObject({ label: "Hearing sound" });
    expect(readMeter("tab", view({ capture: "paused" }), NOW)).toMatchObject({ label: "Paused" });
    expect(readMeter("tab", view({ connection: "reconnecting" }), NOW)).toMatchObject({ label: "Connecting…" });
  });

  it("matches the server's level curve", () => {
    expect(levelPercent(0)).toBe(0);
    expect(levelPercent(260)).toBe(25); // the speech threshold lands at a visible level
    expect(levelPercent(10 ** 9)).toBe(100);
    const sine = new Float32Array(1000).map((_, i) => 0.3 * Math.sin(i / 5));
    expect(rmsOfFloat(sine)).toBeGreaterThan(5000);
    expect(rmsOfFloat(new Float32Array(10))).toBe(0);
  });

  it("shows the microphone meter only when the microphone is used", () => {
    expect(visibleSources({ wantMic: false, wantRoom: false })).toEqual(["tab"]);
    expect(visibleSources({ wantMic: true, wantRoom: false })).toEqual(["tab", "microphone"]);
    expect(visibleSources({ wantMic: false, wantRoom: true })).toEqual(["microphone"]);
  });
});
