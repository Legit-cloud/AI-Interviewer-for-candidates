import { WebSocketServer, WebSocket } from "ws";
import { DeepgramSession } from "../lib/deepgramClient";
import { generateInterviewResponse } from "../lib/geminiClient";
import * as dotenv from "dotenv";

dotenv.config({ path: "backend/.env" });

const PORT = Number(process.env["AUDIO_WS_PORT"]) || 8081;

export interface InterviewTurn {
  answer: string;
  response: string;
  timestamp: number;
}

export interface SessionState {
  deepgram: DeepgramSession;
  answerBuffer: string;
  isGenerating: boolean;
  history: InterviewTurn[];
  ws: WebSocket;
}

const sessions = new Map<WebSocket, SessionState>();

const wss = new WebSocketServer({ port: PORT });
console.log(`[audio-ws] Server listening on ws://localhost:${PORT}`);

wss.on("connection", (ws: WebSocket) => {
  const deepgram = new DeepgramSession({
    model: "nova-3",
    language: "en-US",
    interim_results: true,
    endpointing: 300,
    punctuate: true,
    smart_format: true,
  });

  const state: SessionState = {
    deepgram,
    answerBuffer: "",
    isGenerating: false,
    history: [],
    ws,
  };

  sessions.set(ws, state);

  // Forward binary audio frames from client to Deepgram
  ws.on("message", (data: Buffer) => {
    if (typeof data === "object") {
      state.deepgram.sendAudio(new Uint8Array(data));
    }
  });

  // Handle Deepgram transcription results
  state.deepgram.on("result", async (result) => {
    const transcript = result.channel?.alternatives?.[0]?.transcript ?? "";
    if (!transcript) return;

    // 1. Send interim/final caption to client
    ws.send(JSON.stringify({ type: "transcript", text: transcript, final: result.is_final }));

    // 2. Accumulate finalized text
    if (result.is_final) {
      state.answerBuffer += transcript + " ";
    }

    // 3. When speaker finishes, trigger Gemini (if not already generating)
    if (result.speech_final && !state.isGenerating && state.answerBuffer.trim().length > 0) {
      const completed = state.answerBuffer.trim();
      state.answerBuffer = "";
      state.isGenerating = true;

      // Build compact interview context (recent turns)
      const compactContext = {
        recentTurns: state.history.slice(-3).map((turn) => ({
          candidateAnswer: turn.answer,
          assistantResponse: turn.response,
        })),
      };

      let fullResponse = "";
      try {
        const geminiStream = await generateInterviewResponse({
          answer: completed,
          interviewContext: compactContext,
        });

        // geminiStream is an async iterator of partial strings
        for await (const chunk of geminiStream) {
          fullResponse += chunk;
          ws.send(JSON.stringify({ type: "interview_response", data: chunk }));
        }

        // Store turn in context history
        state.history.push({
          answer: completed,
          response: fullResponse.trim(),
          timestamp: Date.now(),
        });
        if (state.history.length > 10) {
          state.history.shift();
        }
      } catch (e) {
        ws.send(JSON.stringify({ type: "error", message: (e as Error).message }));
      } finally {
        state.isGenerating = false;
      }
    }
  });

  ws.on("close", () => {
    state.deepgram.close();
    sessions.delete(ws);
  });

  ws.on("error", (err) => {
    console.error("[audio-ws] client error", err);
    state.deepgram.close();
    sessions.delete(ws);
  });
});
