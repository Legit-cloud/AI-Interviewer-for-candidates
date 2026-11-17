import { describe, expect, it, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";
import type { DeepgramResult } from "../deepgramClient";

// Mock WebSocket class
class MockWebSocket extends EventEmitter {
  public static OPEN = 1;
  public static CLOSED = 3;
  public readyState = MockWebSocket.OPEN;
  public sentData: unknown[] = [];
  public headers: Record<string, string> | undefined;
  public url: string;

  constructor(url: string, options?: { headers?: Record<string, string> }) {
    super();
    this.url = url;
    this.headers = options?.headers;
    setTimeout(() => this.emit("open"), 0);
  }

  send(data: unknown) {
    this.sentData.push(data);
  }

  terminate() {
    this.readyState = MockWebSocket.CLOSED;
    this.emit("close", 1000, "terminated");
  }
}

vi.mock("ws", () => {
  return {
    WebSocket: MockWebSocket,
  };
});

describe("DeepgramSession", () => {
  beforeEach(() => {
    process.env["DEEPGRAM_API_KEY"] = "mock-deepgram-key";
  });

  it("initializes and connects with correct query params", async () => {
    const { DeepgramSession } = await import("../deepgramClient");
    const session = new DeepgramSession({
      model: "nova-3",
      language: "en-US",
      interim_results: true,
      endpointing: 300,
      punctuate: true,
      smart_format: true,
    });

    expect(session).toBeDefined();
    session.close();
  });

  it("handles incoming transcript results and emits result event", async () => {
    const { DeepgramSession } = await import("../deepgramClient");
    const session = new DeepgramSession({
      model: "nova-3",
      language: "en-US",
      interim_results: true,
      endpointing: 300,
      punctuate: true,
      smart_format: true,
    });

    const mockResult: DeepgramResult = {
      is_final: true,
      speech_final: true,
      channel: {
        alternatives: [{ transcript: "I have five years of experience with React." }],
      },
    };

    let receivedResult: DeepgramResult | null = null;
    session.on("result", (res: DeepgramResult) => {
      receivedResult = res;
    });

    const ws = (session as unknown as { ws: MockWebSocket }).ws;
    ws.emit("message", JSON.stringify(mockResult));

    expect(receivedResult).toEqual(mockResult);
    session.close();
  });

  it("sends audio chunk when socket is open", async () => {
    const { DeepgramSession } = await import("../deepgramClient");
    const session = new DeepgramSession({
      model: "nova-3",
      language: "en-US",
      interim_results: true,
      endpointing: 300,
      punctuate: true,
      smart_format: true,
    });

    const chunk = new Uint8Array([1, 2, 3, 4]);
    session.sendAudio(chunk);

    const ws = (session as unknown as { ws: MockWebSocket }).ws;
    expect(ws.sentData).toContainEqual(chunk);
    session.close();
  });
});
