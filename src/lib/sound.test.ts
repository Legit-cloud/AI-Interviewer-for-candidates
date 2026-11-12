import { describe, expect, it } from "vitest";
import { readMeter, type SoundReport } from "./sound";

const rep = (state: "ok" | "quiet" | "no_audio", at = 1000): SoundReport => ({
  sources: { tab: { level: 40, state, text_ago: null } },
  sttReady: true,
  at,
});

describe("readMeter", () => {
  it("says transcribing when text is flowing", () => {
    expect(readMeter(rep("ok"), "tab", 1500, false).label).toBe("Transcribing ✓");
  });
  it("goes stale after a few seconds", () => {
    expect(readMeter(rep("ok"), "tab", 9000, false).tone).toBe("bad");
  });
  it("shows paused and waiting", () => {
    expect(readMeter(rep("ok"), "tab", 1500, true).label).toBe("Paused");
    expect(readMeter(null, "tab", 1, false).label).toBe("Waiting for sound");
  });
  it("shows a source that is not listening", () => {
    expect(readMeter(rep("ok"), "microphone", 1500, false).label).toBe("Not listening");
  });
});
