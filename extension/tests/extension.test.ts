import { describe, expect, it } from "vitest";
import {
  BoundedAudioQueue,
  float32ToPcm16,
  MAX_WS_FRAME_BYTES,
  pcm16ToBase64,
  TARGET_SAMPLE_RATE,
} from "../lib/audio-buffer";
import { checkTabEligibility } from "../lib/tab-eligibility";

describe("checkTabEligibility", () => {
  it("accepts Google Meet, Zoom, Microsoft Teams, and web interview tabs", () => {
    const meet = checkTabEligibility("https://meet.google.com/abc-defg-hij");
    expect(meet.eligible).toBe(true);
    expect(meet.hostLabel).toBe("meet.google.com");
    expect(meet.isLikelyMeeting).toBe(true);

    const zoom = checkTabEligibility("https://app.zoom.us/wc/12345/join");
    expect(zoom.eligible).toBe(true);
    expect(zoom.isLikelyMeeting).toBe(true);

    const teams = checkTabEligibility("https://teams.microsoft.com/l/meetup-join/123");
    expect(teams.eligible).toBe(true);
    expect(teams.isLikelyMeeting).toBe(true);

    const local = checkTabEligibility("http://localhost:5173/app");
    expect(local.eligible).toBe(true);
    expect(local.hostLabel).toBe("localhost:5173");
    expect(local.isLikelyMeeting).toBe(false);
  });

  it("blocks internal chrome://, extension://, and Web Store pages cleanly", () => {
    expect(checkTabEligibility(undefined).eligible).toBe(false);
    expect(checkTabEligibility("chrome://extensions").eligible).toBe(false);
    expect(checkTabEligibility("chrome-extension://abcdefghijklmnop/sidepanel.html").eligible).toBe(false);
    expect(checkTabEligibility("https://chromewebstore.google.com/detail/example").eligible).toBe(false);
  });
});

describe("audio framing & BoundedAudioQueue", () => {
  it("downsamples 48 kHz Float32 frames to compact 16 kHz PCM16 base64 frames", () => {
    const input = new Float32Array(12000); // 250ms @ 48 kHz
    for (let i = 0; i < input.length; i += 1) {
      input[i] = Math.sin(i * 0.05) * 0.5;
    }
    const pcm = float32ToPcm16(input, 48000);
    expect(pcm.length).toBe(4000); // 250ms @ 16 kHz
    const b64 = pcm16ToBase64(pcm);
    expect(b64.length).toBeLessThan(MAX_WS_FRAME_BYTES);
    expect(TARGET_SAMPLE_RATE).toBe(16000);
  });

  it("evicts oldest frames when buffer reaches max capacity", () => {
    const queue = new BoundedAudioQueue(2);
    expect(
      queue.enqueue({
        source: "tab",
        sequence: 1,
        capturedAt: "2026-11-11T00:00:00Z",
        sampleRate: 16000,
        channels: 1,
        payload: "AAAA",
      }),
    ).toBe(true);
    expect(
      queue.enqueue({
        source: "tab",
        sequence: 2,
        capturedAt: "2026-11-11T00:00:01Z",
        sampleRate: 16000,
        channels: 1,
        payload: "BBBB",
      }),
    ).toBe(true);

    // 3rd push overflows cap of 2 -> drops sequence 1
    expect(
      queue.enqueue({
        source: "tab",
        sequence: 3,
        capturedAt: "2026-11-11T00:00:02Z",
        sampleRate: 16000,
        channels: 1,
        payload: "CCCC",
      }),
    ).toBe(false);
    expect(queue.size).toBe(2);
    expect(queue.droppedCount).toBe(1);
    expect(queue.dequeue()?.sequence).toBe(2);
    expect(queue.dequeue()?.sequence).toBe(3);
  });
});

