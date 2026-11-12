import { BoundedAudioQueue, float32ToPcm16, pcm16ToBase64, TARGET_SAMPLE_RATE } from "./audio-buffer";
import type { ConnectionStatus, ServerEvent } from "./types";

const CHUNK_SAMPLES = 4000; // 250 ms at 16 kHz
const MAX_RECONNECTS = 6;
const HEARTBEAT_MS = 20_000;
const STOP_GRACE_MS = 3_000;

export interface CaptureCallbacks {
  onEvent: (event: ServerEvent) => void;
  onStatus: (status: ConnectionStatus, detail?: string) => void;
}

/**
 * Relays the audio of one tab to the Vren backend and hands every server event to the panel.
 * It makes no decisions: transcription, question detection and answers all happen server-side.
 * Tab audio keeps playing locally while it is captured.
 */
export class CaptureEngine {
  private ctx: AudioContext | null = null;
  private socket: WebSocket | null = null;
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private readonly queue = new BoundedAudioQueue();
  private sequence = 0;
  private lastEventId = "";
  private attempts = 0;
  private paused = false;
  private stopping = false;
  private closedForGood = false;

  constructor(
    private readonly wsUrl: string,
    private readonly stream: MediaStream,
    private readonly cb: CaptureCallbacks,
  ) {}

  async start(): Promise<void> {
    this.ctx = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
    await this.ctx.audioWorklet.addModule(chrome.runtime.getURL("pcm-processor.js"));
    const source = this.ctx.createMediaStreamSource(this.stream);
    const worklet = new AudioWorkletNode(this.ctx, "vren-pcm-processor", {
      processorOptions: { chunkSamples: CHUNK_SAMPLES },
    });
    worklet.port.onmessage = (e: MessageEvent<Float32Array>) => this.onChunk(e.data);
    source.connect(worklet);
    // Capturing a tab mutes it locally unless the stream is routed back to the speakers.
    source.connect(this.ctx.destination);
    this.connect();
  }

  private connect(): void {
    const url = new URL(this.wsUrl);
    if (this.lastEventId) url.searchParams.set("last_event_id", this.lastEventId);
    const ws = new WebSocket(url.toString());
    this.socket = ws;
    this.cb.onStatus(this.attempts === 0 ? "connecting" : "reconnecting");

    ws.onopen = () => {
      this.attempts = 0;
      this.cb.onStatus("connected");
      ws.send(JSON.stringify({ type: "session.configure", role: "capture", sources: ["tab"], client_version: "0.2.0" }));
      clearInterval(this.heartbeat);
      this.heartbeat = setInterval(() => this.send({ type: "client.heartbeat" }), HEARTBEAT_MS);
      this.flush();
    };
    ws.onmessage = (msg) => {
      try {
        const evt = JSON.parse(String(msg.data)) as ServerEvent;
        if (evt.event_id) this.lastEventId = evt.event_id;
        if (evt.type === "session.finalized" || evt.type === "session.expired") this.closedForGood = true;
        this.cb.onEvent(evt);
      } catch {
        /* ignore non-JSON */
      }
    };
    ws.onclose = (evt) => {
      clearInterval(this.heartbeat);
      const refused = evt.code >= 4400 && evt.code < 4500; // ended, expired, revoked, duplicate
      if (this.stopping || this.closedForGood || refused || this.attempts >= MAX_RECONNECTS) {
        this.releaseAudio();
        this.cb.onStatus("closed", refused ? evt.reason || "Session closed by the server." : undefined);
        return;
      }
      this.attempts += 1;
      this.cb.onStatus("reconnecting");
      setTimeout(() => this.connect(), Math.min(1000 * 2 ** (this.attempts - 1), 8000));
    };
  }

  private onChunk(samples: Float32Array): void {
    if (this.paused || this.stopping) return;
    const pcm = float32ToPcm16(samples, TARGET_SAMPLE_RATE);
    this.sequence += 1;
    this.queue.enqueue({
      source: "tab",
      sequence: this.sequence,
      capturedAt: new Date().toISOString(),
      sampleRate: TARGET_SAMPLE_RATE,
      channels: 1,
      payload: pcm16ToBase64(pcm),
    });
    this.flush();
  }

  private flush(): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    for (let f = this.queue.dequeue(); f; f = this.queue.dequeue()) {
      this.socket.send(
        JSON.stringify({
          type: "audio.frame",
          source: f.source,
          sequence: f.sequence,
          captured_at: f.capturedAt,
          sample_rate: f.sampleRate,
          channels: f.channels,
          payload: f.payload,
        }),
      );
    }
  }

  private send(payload: Record<string, unknown>): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(payload));
  }

  pause(): void {
    this.paused = true;
    this.queue.clear();
    this.send({ type: "session.pause" });
  }

  resume(): void {
    this.paused = false;
    this.send({ type: "session.resume" });
  }

  /** Ends the session: asks the server to finalise, then releases the tab audio. */
  stop(): void {
    this.stopping = true;
    this.queue.clear();
    this.send({ type: "session.stop" });
    setTimeout(() => {
      this.socket?.close(1000);
      this.releaseAudio();
    }, STOP_GRACE_MS);
  }

  private releaseAudio(): void {
    clearInterval(this.heartbeat);
    this.stream.getTracks().forEach((t) => t.stop());
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
  }
}
