// Deepgram client wrapper for real‑time transcription
// Uses the @deepgram/sdk to build the WS URL and handles interim/final results

import { EventEmitter } from "events";
import { WebSocket } from "ws"; // server‑side WS client
import * as dotenv from "dotenv";

dotenv.config({ path: "backend/.env" });

interface DeepgramConfig {
  model: string;
  language: string;
  interim_results: boolean;
  endpointing: number; // ms
  punctuate: boolean;
  smart_format: boolean;
}

interface DeepgramResult {
  is_final: boolean;
  speech_final: boolean;
  channel: {
    alternatives: Array<{ transcript: string }>
  };
}

export class DeepgramSession extends EventEmitter {
  private ws: WebSocket | null = null;
  private readonly url: string;

  constructor(private readonly config: DeepgramConfig) {
    super();
    const apiKey = process.env["DEEPGRAM_API_KEY"];
    if (!apiKey) {
      throw new Error("DEEPGRAM_API_KEY not set in backend/.env");
    }
    const query = new URLSearchParams({
      model: config.model,
      language: config.language,
      interim_results: String(config.interim_results),
      endpointing: String(config.endpointing),
      punctuate: String(config.punctuate),
      smart_format: String(config.smart_format),
    });
    this.url = `wss://api.deepgram.com/v1/listen?${query.toString()}`;
    this.connect(apiKey);
  }

  private connect(apiKey: string) {
    this.ws = new WebSocket(this.url, {
      headers: { Authorization: `Token ${apiKey}` },
    });

    this.ws.on("open", () => this.emit("open"));
    this.ws.on("message", (data) => this.handleMessage(data.toString()));
    this.ws.on("close", (code, reason) => this.emit("close", code, reason));
    this.ws.on("error", (err) => this.emit("error", err));
  }

  private handleMessage(raw: string) {
    try {
      const json = JSON.parse(raw) as DeepgramResult;
      this.emit("result", json);
    } catch (e) {
      // ignore non‑JSON messages
    }
  }

  // Called by the audio pipeline to forward raw PCM (Int16 LE) bytes
  public sendAudio(chunk: Uint8Array) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(chunk);
    }
  }

  public close() {
    if (this.ws) this.ws.terminate();
  }
}
