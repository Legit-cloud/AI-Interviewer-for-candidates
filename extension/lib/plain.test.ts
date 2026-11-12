import { describe, expect, it } from "vitest";
import { plainReason, plainStartError } from "./plain";

describe("plain language", () => {
  it("turns server codes into short sentences", () => {
    expect(plainReason("CAPTURE_CLIENT_ALREADY_CONNECTED")).toMatch(/Another Vren app/);
    expect(plainReason("PAIRING_REVOKED")).toMatch(/disconnected/);
    expect(plainReason(undefined)).toBe("");
    expect(plainReason("WHATEVER")).toBe("The connection closed.");
  });
  it("says what to do when capture cannot start", () => {
    expect(plainStartError("NO_SOUND")).toMatch(/Share tab audio/);
    expect(plainStartError("CANCELLED")).toMatch(/Start/);
    expect(plainStartError("FAILED")).toMatch(/Vren icon/);
  });
  it("uses short words (no sentence over 16 words)", () => {
    for (const text of ["NO_SOUND", "CANCELLED", "NO_MIC", "FAILED"].map(plainStartError)) {
      for (const sentence of text.split(/[.!?]/)) expect(sentence.trim().split(/\s+/).length).toBeLessThanOrEqual(16);
    }
  });
});
