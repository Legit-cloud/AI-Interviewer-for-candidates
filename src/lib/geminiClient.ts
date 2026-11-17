import fetch from "node-fetch";
import * as dotenv from "dotenv";
import type { IncomingMessage } from "http";

dotenv.config({ path: "backend/.env" });

interface GeminiRequestPayload {
  answer: string;
  interviewContext: Record<string, unknown>;
}

/**
 * Calls Gemini Flash (models/gemini-3.8-flash) with streaming enabled.
 * Returns an async generator that yields each partial text chunk.
 */
export async function generateInterviewResponse({
  answer,
  interviewContext,
}: GeminiRequestPayload): Promise<AsyncGenerator<string>> {
  const apiKey = process.env["GEMINI_API_KEY"];
  if (!apiKey) throw new Error("GEMINI_API_KEY not set in backend/.env");

  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContentStream";

  const body = {
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `Answer: ${answer}\nContext: ${JSON.stringify(interviewContext)}`,
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 400,
    },
  };

  const response = await fetch(`${url}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini API error ${response.status}: ${errText}`);
  }

  // node-fetch v2 response.body is a Node.js Readable stream
  const stream = response.body as unknown as IncomingMessage;

  async function* iterator(): AsyncGenerator<string> {
    let buffer = "";
    for await (const chunk of stream) {
      buffer += (chunk as Buffer).toString("utf-8");
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const json = JSON.parse(trimmed) as {
            candidates?: Array<{
              content?: { parts?: Array<{ text?: string }> };
            }>;
          };
          const text = json?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
          if (text) yield text;
        } catch {
          // ignore malformed lines
        }
      }
    }
    // Flush remaining buffer
    if (buffer.trim()) {
      try {
        const json = JSON.parse(buffer) as {
          candidates?: Array<{
            content?: { parts?: Array<{ text?: string }> };
          }>;
        };
        const text = json?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
        if (text) yield text;
      } catch {
        // ignore
      }
    }
  }

  return iterator();
}
