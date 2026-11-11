import {
  BoundedAudioQueue,
  float32ToPcm16,
  pcm16ToBase64,
  TARGET_SAMPLE_RATE,
} from "./audio-buffer";
import type { AudioSource, OffscreenLiveEvent } from "./types";

export interface LiveCaptureOptions {
  wsUrl: string;
  wsToken: string;
  captureTab: boolean;
  captureMic: boolean;
  remoteStream: MediaStream | null;
  micStream: MediaStream | null;
  passthroughRemoteAudio: boolean;
  onEvent: (event: OffscreenLiveEvent) => void;
}

export class LiveCaptureEngine {
  private readonly opts: LiveCaptureOptions;
  private readonly queue = new BoundedAudioQueue();
  private readonly sequences: Record<AudioSource, number> = { tab: 0, microphone: 0 };

  private paused = false;
  private stopped = false;
  private ws: WebSocket | null = null;
  private reconnectAttempt = 0;
  private reconnectTimer: number | null = null;
  private heartbeatTimer: number | null = null;
  private audioCtx: AudioContext | null = null;

  constructor(opts: LiveCaptureOptions) {
    this.opts = opts;
  }

  async start(): Promise<void> {
    await this.attachAudio();
    this.openSocket();
  }

  pause(): void {
    this.paused = true;
    this.queue.clear();
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "session.pause" }));
    }
  }

  resume(): void {
    this.paused = false;
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "session.resume" }));
    }
  }

  sendUtterance(text: string, source: AudioSource = "tab"): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN || !text.trim()) {
      return false;
    }
    this.ws.send(
      JSON.stringify({
        type: "utterance.commit",
        source,
        text: text.trim(),
      }),
    );
    return true;
  }

  pushExternalPcmFrame(source: AudioSource, base64Payload: string): void {
    if (this.stopped || this.paused || !base64Payload) return;
    this.sequences[source] += 1;
    const ok = this.queue.enqueue({
      source,
      sequence: this.sequences[source],
      capturedAt: new Date().toISOString(),
      sampleRate: TARGET_SAMPLE_RATE,
      channels: 1,
      payload: base64Payload,
    });
    if (!ok) {
      this.opts.onEvent({
        target: "sidepanel",
        type: "LIVE_BUFFER_OVERFLOW",
        droppedFrames: this.queue.droppedCount,
      });
    }
    this.flushQueue();
  }

  stop(notifyBackend = true): void {
    if (this.stopped) return;
    this.stopped = true;
    this.clearTimers();
    this.queue.clear();
    this.stopTracks();

    if (this.ws) {
      try {
        if (notifyBackend && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: "session.stop" }));
        } else {
          this.ws.close(1000);
        }
      } catch {
        this.ws.close(1000);
      }
      this.ws = null;
    }
  }

  private clearTimers(): void {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.heartbeatTimer !== null) {
      window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private stopTracks(): void {
    for (const track of this.opts.remoteStream?.getTracks() ?? []) {
      track.stop();
    }
    for (const track of this.opts.micStream?.getTracks() ?? []) {
      track.stop();
    }
    if (this.audioCtx) {
      this.audioCtx.close().catch(() => {});
      this.audioCtx = null;
    }
  }

  private flushQueue(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    while (this.queue.size > 0) {
      const frame = this.queue.peek();
      if (!frame) break;
      this.ws.send(
        JSON.stringify({
          type: "audio.frame",
          source: frame.source,
          sequence: frame.sequence,
          captured_at: frame.capturedAt,
          sample_rate: frame.sampleRate,
          channels: frame.channels,
          payload: frame.payload,
        }),
      );
      this.queue.dequeue();
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer !== null) return;
    this.reconnectAttempt += 1;
    const delayMs = Math.min(15000, 1000 * 2 ** (this.reconnectAttempt - 1));
    this.opts.onEvent({
      target: "sidepanel",
      type: "LIVE_RECONNECTING",
      attempt: this.reconnectAttempt,
      message: "Connection lost. Reconnecting...",
    });
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.stopped) {
        this.openSocket();
      }
    }, delayMs);
  }

  private openSocket(): void {
    if (this.stopped) return;
    const url = `${this.opts.wsUrl}?token=${encodeURIComponent(this.opts.wsToken)}`;
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectAttempt = 0;
      const sources: AudioSource[] = [];
      if (this.opts.captureTab) sources.push("tab");
      if (this.opts.captureMic) sources.push("microphone");
      ws.send(JSON.stringify({ type: "session.configure", sources }));
      if (this.paused) {
        ws.send(JSON.stringify({ type: "session.pause" }));
      } else {
        this.flushQueue();
      }

      if (this.heartbeatTimer !== null) window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = window.setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "client.heartbeat" }));
        }
      }, 15000);
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data)) as Record<string, unknown>;
        const type = String(msg.type || "");

        if (type === "session.ready") {
          this.opts.onEvent({
            target: "sidepanel",
            type: "LIVE_CONNECTED",
            sttMode: String(msg.stt_mode || "offline"),
          });
          return;
        }

        if (type === "transcript.completed") {
          this.opts.onEvent({
            target: "sidepanel",
            type: "LIVE_TRANSCRIPT",
            item: {
              id: String(msg.item_id || msg.event_id || crypto.randomUUID()),
              speaker: String(msg.speaker || "Interviewer"),
              text: String(msg.text || ""),
              timestamp: String(msg.timestamp || "00:00"),
              source: msg.source === "microphone" ? "microphone" : "tab",
            },
          });
          return;
        }

        if (type === "question.detected") {
          this.opts.onEvent({
            target: "sidepanel",
            type: "LIVE_QUESTION",
            text: String(msg.text || ""),
            kind: String(msg.kind || "General"),
          });
          return;
        }

        if (type === "suggestion.started") {
          this.opts.onEvent({
            target: "sidepanel",
            type: "LIVE_SUGGESTION_STARTED",
            questionText: String(msg.question_text || ""),
            questionType: String(msg.question_type || "General"),
          });
          return;
        }

        if (type === "suggestion.delta") {
          this.opts.onEvent({
            target: "sidepanel",
            type: "LIVE_SUGGESTION_DELTA",
            delta: String(msg.delta || ""),
          });
          return;
        }

        if (type === "suggestion.ready" && msg.suggestion && typeof msg.suggestion === "object") {
          const s = msg.suggestion as Record<string, unknown>;
          this.opts.onEvent({
            target: "sidepanel",
            type: "LIVE_SUGGESTION",
            suggestion: {
              id: String(s.id || crypto.randomUUID()),
              questionText: String(s.question_text || ""),
              questionType: String(s.question_type || "General"),
              askedAt: String(s.asked_at || "Live"),
              framework: String(s.framework || "Direct"),
              outline: Array.isArray(s.outline) ? s.outline.map(String) : [],
              evidenceRef: String(s.evidence_ref || ""),
              caveat: String(s.caveat || ""),
            },
          });
          return;
        }

        if (type === "session.degraded") {
          this.opts.onEvent({
            target: "sidepanel",
            type: "LIVE_DEGRADED",
            code: String(msg.code || "DEGRADED"),
            message: String(msg.message || "Live transcription is degraded."),
          });
          return;
        }

        if (type === "session.finalized") {
          this.opts.onEvent({
            target: "sidepanel",
            type: "LIVE_FINALIZED",
            clean: true,
            retainedTranscript: Boolean(msg.retained_transcript),
          });
        }
      } catch {
        // Ignore malformed server payload.
      }
    };

    ws.onerror = () => {
      // Wait for onclose to schedule reconnect.
    };

    ws.onclose = (ev) => {
      if (this.ws === ws) this.ws = null;
      if (this.heartbeatTimer !== null) {
        window.clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
      }
      if (this.stopped || ev.code === 1000) return;
      if (ev.code === 4401 || ev.code === 4403 || ev.code === 4404 || ev.code === 4409) {
        this.opts.onEvent({
          target: "sidepanel",
          type: "LIVE_ERROR",
          message: ev.reason || "Live session authorization ended.",
        });
        return;
      }
      this.scheduleReconnect();
    };
  }

  private async attachAudio(): Promise<void> {
    const hasRemote = Boolean(
      this.opts.remoteStream && this.opts.remoteStream.getAudioTracks().length > 0,
    );
    const hasMic = Boolean(this.opts.micStream && this.opts.micStream.getAudioTracks().length > 0);
    if (!hasRemote && !hasMic) {
      return;
    }

    const ctx = new AudioContext();
    this.audioCtx = ctx;
    if (ctx.state === "suspended") {
      await ctx.resume();
    }
    const chunkSamples = Math.max(1600, Math.round(ctx.sampleRate * 0.25));
    await ctx.audioWorklet.addModule(chrome.runtime.getURL("pcm-processor.js"));

    const attachStream = (stream: MediaStream, source: AudioSource, passthrough: boolean) => {
      if (stream.getAudioTracks().length === 0) return;
      const mediaSource = ctx.createMediaStreamSource(stream);
      if (passthrough) {
        mediaSource.connect(ctx.destination);
      }

      const worklet = new AudioWorkletNode(ctx, "vren-pcm-processor", {
        processorOptions: { chunkSamples },
      });
      const silentGain = ctx.createGain();
      silentGain.gain.value = 0;

      worklet.port.onmessage = (event: MessageEvent<Float32Array>) => {
        if (this.stopped || this.paused) return;
        const samples = event.data;
        if (!samples || samples.length === 0) return;

        const pcm = float32ToPcm16(samples, ctx.sampleRate);
        if (pcm.length === 0) return;
        this.sequences[source] += 1;
        const ok = this.queue.enqueue({
          source,
          sequence: this.sequences[source],
          capturedAt: new Date().toISOString(),
          sampleRate: TARGET_SAMPLE_RATE,
          channels: 1,
          payload: pcm16ToBase64(pcm),
        });
        if (!ok) {
          this.opts.onEvent({
            target: "sidepanel",
            type: "LIVE_BUFFER_OVERFLOW",
            droppedFrames: this.queue.droppedCount,
          });
        }
        this.flushQueue();
      };

      mediaSource.connect(worklet);
      worklet.connect(silentGain);
      silentGain.connect(ctx.destination);
    };

    if (this.opts.remoteStream && this.opts.remoteStream.getAudioTracks().length > 0) {
      attachStream(this.opts.remoteStream, "tab", this.opts.passthroughRemoteAudio);
    }

    if (this.opts.micStream && this.opts.micStream.getAudioTracks().length > 0) {
      attachStream(this.opts.micStream, "microphone", false);
    }
  }
}

