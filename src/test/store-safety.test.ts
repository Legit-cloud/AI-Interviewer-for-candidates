import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getStoredTokens, setStoredTokens } from "@/lib/api";
import { deleteAccount, deleteAllSessions, getState, startLiveSession } from "@/lib/store";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  setStoredTokens({ access_token: "a", refresh_token: "r", token_type: "bearer" });
});
afterEach(() => {
  vi.unstubAllGlobals();
  setStoredTokens(null);
});

describe("destructive actions only succeed when the server confirms", () => {
  it("keeps the account and tokens when deletion fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(json(500, { error: { code: "INTERNAL_ERROR", message: "boom" } })),
    );
    await expect(deleteAccount()).rejects.toThrow("boom");
    expect(getStoredTokens()).not.toBeNull();
  });

  it("clears tokens once deletion succeeds", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(200, { message: "ok" })));
    await deleteAccount();
    expect(getStoredTokens()).toBeNull();
  });

  it("does not wipe local sessions when the server refuses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(json(500, { error: { code: "INTERNAL_ERROR", message: "nope" } })),
    );
    const before = getState().sessions.length;
    await expect(deleteAllSessions()).rejects.toThrow();
    expect(getState().sessions.length).toBe(before);
  });
});

describe("live session setup", () => {
  it("removes the half-created session when the pairing code cannot be issued", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        calls.push(`${init?.method ?? "GET"} ${url}`);
        if (url.endsWith("/v1/sessions") && init?.method === "POST") return json(201, { id: "s1" });
        if (url.endsWith("/pairing-code"))
          return json(500, { error: { code: "INTERNAL_ERROR", message: "table missing" } });
        return json(200, {});
      }),
    );
    await expect(
      startLiveSession(
        { jobId: null, retainTranscript: false },
        () => {},
        () => {},
      ),
    ).rejects.toThrow("table missing");
    expect(calls).toContain("DELETE /v1/sessions/s1");
  });

  it("explains a bare 5xx instead of showing a raw status code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("Internal Server Error", { status: 500 })),
    );
    await expect(deleteAllSessions()).rejects.toThrow(/migrations/);
  });
});
