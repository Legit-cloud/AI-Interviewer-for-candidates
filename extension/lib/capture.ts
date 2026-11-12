import { BoundedAudioQueue, float32ToPcm16, pcm16ToBase64, TARGET_SAMPLE_RATE, type AudioSource } from "./audio-buffer";
import type { ConnectionStatus, ServerEvent } from "./types";

const CHUNK_SAMPLES = 4000; // 250 ms at 16 kHz
const MAX_RECONNECTS = 6;
const HEARTBEAT_MS = 20_000;
const STOP_GRACE_MS = 3_000;

/** One audio source to relay. `passthrough` keeps a captured tab audible (Chrome mutes a tab while it is captured). */
export interface SourceSpec {
  source: AudioSource;
  stream: MediaStream;
  passthrough: boolean;
}

export interface CaptureCallbacks {
  onEvent: (event: ServerEvent) => void;
  onStatus: (status: ConnectionStatus, detail?: string) => void;
}

/**
 * Relays audio to the Vren backend and hands every server event to the panel. It makes no decisions:
 * transcription, question detection and answers all happen on the server.
 */
export class CaptureEngine {
  private contexts: AudioContext[] = [];
  private socket: WebSocket | null = null;
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private readonly queue = new BoundedAudioQueue();
  private readonly sequences: Record<AudioSource, number> = { tab: 0, microphone: 0 };
  private lastEventId = "";
  private attempts = 0;
  private paused = false;
  private stopping = false;
  private closedForGood = false;

  constructor(
    private readonly wsUrl: string,
    private readonly specs: SourceSpec[],
    /** Phone or in-person interview: the microphone hears the interviewer. */
    private readonly room: boolean,
    private readonly cb: CaptureCallbacks,
  ) {}

  async start(): Promise<void> {
    for (const spec of this.specs) {
      const ctx = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
      await ctx.audioWorklet.addModule(chrome.runtime.getURL("pcm-processor.js"));
      const node = ctx.createMediaStreamSource(spec.stream);
      const worklet = new AudioWorkletNode(ctx, "vren-pcm-processor", { processorOptions: { chunkSamples: CHUNK_SAMPLES } });
      worklet.port.onmessage = (e: MessageEvent<Float32Array>) => this.onChunk(spec.source, e.data);
      node.connect(worklet);
      if (spec.passthrough) node.connect(ctx.destination);
      this.contexts.push(ctx);
    }
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
      ws.send(JSON.stringify({ type: "session.configure", role: "capture", sources: this.specs.map((s) => s.source), room: this.room, client_version: "0.3.0" }));
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
      const refused = evt.code >= 4400 && evt.code < 4500; // ended, expired, revoked, another capture client
      if (this.stopping || this.closedForGood || refused || this.attempts >= MAX_RECONNECTS) {
        this.releaseAudio();
        this.cb.onStatus("closed", refused ? evt.reason || "CLOSED_BY_SERVER" : undefined);
        return;
      }
      this.attempts += 1;
      this.cb.onStatus("reconnecting");
      setTimeout(() => this.connect(), Math.min(1000 * 2 ** (this.attempts - 1), 8000));
    };
  }

  private onChunk(source: AudioSource, samples: Float32Array): void {
    if (this.paused || this.stopping) return;
    const pcm = float32ToPcm16(samples, TARGET_SAMPLE_RATE);
    this.sequences[source] += 1;
    this.queue.enqueue({
      source,
      sequence: this.sequences[source],
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

  /** Sends a screenshot of a question; the server reads it and answers. */
  sendImage(imageB64: string, mime: string): void {
    this.send({ type: "image.ask", image: imageB64, mime });
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

  /** Ends the session: asks the server to finalise, then releases the audio. */
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
    for (const spec of this.specs) spec.stream.getTracks().forEach((t) => t.stop());
    for (const ctx of this.contexts) void ctx.close().catch(() => {});
    this.contexts = [];
  }
}
