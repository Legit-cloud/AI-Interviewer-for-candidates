import { describe, expect, it, vi, beforeEach } from "vitest";
import { Readable } from "stream";

vi.mock("node-fetch", () => {
  return {
    default: vi.fn(),
  };
});

describe("generateInterviewResponse", () => {
  beforeEach(() => {
    process.env["GEMINI_API_KEY"] = "mock-gemini-key";
    vi.clearAllMocks();
  });

  it("streams response chunks from Gemini API", async () => {
    const fetch = (await import("node-fetch")).default as unknown as ReturnType<typeof vi.fn>;

    const mockStream = new Readable({
      read() {
        const chunk1 =
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: "Great answer! " }] } }],
          }) + "\n";

        const chunk2 =
          JSON.stringify({
            candidates: [
              { content: { parts: [{ text: "Can you elaborate on state management?" }] } },
            ],
          }) + "\n";

        this.push(Buffer.from(chunk1));
        this.push(Buffer.from(chunk2));
        this.push(null);
      },
    });

    fetch.mockResolvedValueOnce({
      ok: true,
      body: mockStream,
    });

    const { generateInterviewResponse } = await import("../geminiClient");
    const stream = await generateInterviewResponse({
      answer: "I used Redux and React Context for global state.",
      interviewContext: { role: "Frontend Engineer" },
    });

    const results: string[] = [];
    for await (const chunk of stream) {
      results.push(chunk);
    }

    expect(results).toEqual(["Great answer! ", "Can you elaborate on state management?"]);
  });

  it("throws error when API returns non-200", async () => {
    const fetch = (await import("node-fetch")).default as unknown as ReturnType<typeof vi.fn>;
    fetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: async () => "Forbidden",
    });

    const { generateInterviewResponse } = await import("../geminiClient");
    await expect(
      generateInterviewResponse({
        answer: "Test answer",
        interviewContext: {},
      }),
    ).rejects.toThrow("Gemini API error 403: Forbidden");
  });
});
