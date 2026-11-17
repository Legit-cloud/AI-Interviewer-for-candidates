// Deepgram client wrapper for real‑time transcription
// Uses Deepgram WebSocket streaming and handles interim/final results with automatic exponential back-off reconnection

import { EventEmitter } from "events";
import { WebSocket } from "ws"; // server‑side WS client
import * as dotenv from "dotenv";

dotenv.config({ path: "backend/.env" });

export interface DeepgramConfig {
  model: string;
  language: string;
  interim_results: boolean;
  endpointing: number; // ms
  punctuate: boolean;
  smart_format: boolean;
}

export interface DeepgramResult {
  is_final: boolean;
  speech_final: boolean;
  channel: {
    alternatives: Array<{ transcript: string }>;
  };
}

export class DeepgramSession extends EventEmitter {
  private ws: WebSocket | null = null;
  private readonly url: string;
  private readonly apiKey: string;
  private retryCount = 0;
  private maxRetries = 5;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isExplicitlyClosed = false;
  private pendingAudioQueue: Uint8Array[] = [];
  private readonly maxQueueSize = 50;

  private readonly config: DeepgramConfig;

  constructor(config: DeepgramConfig) {
    super();
    this.config = config;
    const key = process.env["DEEPGRAM_API_KEY"];
    if (!key) {
      throw new Error("DEEPGRAM_API_KEY not set in backend/.env");
    }
    this.apiKey = key;

    const query = new URLSearchParams({
      model: config.model,
      language: config.language,
      interim_results: String(config.interim_results),
      endpointing: String(config.endpointing),
      punctuate: String(config.punctuate),
      smart_format: String(config.smart_format),
    });
    this.url = `wss://api.deepgram.com/v1/listen?${query.toString()}`;
    this.connect();
  }

  private connect() {
    if (this.isExplicitlyClosed) return;

    this.ws = new WebSocket(this.url, {
      headers: { Authorization: `Token ${this.apiKey}` },
    });

    this.ws.on("open", () => {
      this.retryCount = 0;
      this.emit("open");
      this.flushQueue();
    });

    this.ws.on("message", (data) => this.handleMessage(data.toString()));

    this.ws.on("close", (code, reason) => {
      this.emit("close", code, reason);
      if (!this.isExplicitlyClosed) {
        this.scheduleReconnect();
      }
    });

    this.ws.on("error", (err) => {
      this.emit("error", err);
      // 'close' event typically follows error, but if not closed:
      if (!this.isExplicitlyClosed && this.ws?.readyState !== WebSocket.OPEN) {
        this.scheduleReconnect();
      }
    });
  }

  private scheduleReconnect() {
    if (this.isExplicitlyClosed || this.reconnectTimer) return;

    if (this.retryCount >= this.maxRetries) {
      this.emit(
        "error",
        new Error(`Deepgram WebSocket failed after ${this.maxRetries} reconnection attempts`),
      );
      return;
    }

    const delayMs = Math.min(1000 * Math.pow(2, this.retryCount), 16000); // 1s, 2s, 4s, 8s, 16s
    this.retryCount++;
    this.emit("reconnecting", { attempt: this.retryCount, delayMs });

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delayMs);
  }

  private flushQueue() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    while (this.pendingAudioQueue.length > 0) {
      const chunk = this.pendingAudioQueue.shift();
      if (chunk) {
        this.ws.send(chunk);
      }
    }
  }

  private handleMessage(raw: string) {
    try {
      const json = JSON.parse(raw) as DeepgramResult;
      this.emit("result", json);
    } catch {
      // ignore non‑JSON messages
    }
  }

  // Called by the audio pipeline to forward raw PCM (Int16 LE) bytes
  public sendAudio(chunk: Uint8Array) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(chunk);
    } else if (!this.isExplicitlyClosed) {
      if (this.pendingAudioQueue.length < this.maxQueueSize) {
        this.pendingAudioQueue.push(chunk);
      }
    }
  }

  public close() {
    this.isExplicitlyClosed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.pendingAudioQueue = [];
    if (this.ws) {
      this.ws.terminate();
      this.ws = null;
    }
  }
}
