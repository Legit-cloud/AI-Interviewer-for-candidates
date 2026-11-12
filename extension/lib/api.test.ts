import { afterEach, describe, expect, it, vi } from "vitest";
import { buildWsUrl, normalizeApiBase, PairingError, redeemPairingCode } from "./api";

afterEach(() => vi.unstubAllGlobals());

describe("pairing api", () => {
  it("builds a websocket url with the token", () => {
    expect(buildWsUrl("https://api.example.com", "/v1/live/abc", "tok")).toBe("wss://api.example.com/v1/live/abc?token=tok");
    expect(buildWsUrl("http://localhost:8000", "/v1/live/abc", "t")).toBe("ws://localhost:8000/v1/live/abc?token=t");
  });

  it("refuses non-https servers except localhost", () => {
    expect(() => normalizeApiBase("http://example.com")).toThrow(PairingError);
    expect(normalizeApiBase("http://localhost:8000/")).toBe("http://localhost:8000");
    expect(normalizeApiBase("https://api.example.com/")).toBe("https://api.example.com");
  });

  it("rejects malformed codes before any request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(redeemPairingCode("http://localhost:8000", "12ab")).rejects.toThrow(/6-digit/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps a server rejection to a readable error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: { code: "PAIRING_CODE_INVALID", message: "That code is invalid or has expired." } }) }));
    await expect(redeemPairingCode("http://localhost:8000", "123456")).rejects.toMatchObject({ code: "PAIRING_CODE_INVALID" });
  });

  it("returns the paired session on success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ session_id: "s1", ws_token: "t", ws_path: "/v1/live/s1", expires_at: "2099-01-01T00:00:00Z", job_title: "PM" }) }));
    const s = await redeemPairingCode("http://localhost:8000", "123456");
    expect(s).toMatchObject({ sessionId: "s1", wsToken: "t", jobTitle: "PM" });
  });
});
