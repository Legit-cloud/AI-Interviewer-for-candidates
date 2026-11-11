import type { AudioSource } from "./types";

export const TARGET_SAMPLE_RATE = 16000;
export const MAX_WS_FRAME_BYTES = 256 * 1024;
export const DEFAULT_MAX_QUEUE_FRAMES = 40; // ~10s at 250ms per frame

export interface QueuedAudioFrame {
  source: AudioSource;
  sequence: number;
  capturedAt: string;
  sampleRate: number;
  channels: number;
  payload: string;
}

/**
 * Downsamples Float32 [-1, 1] mono samples from sourceRate to 16 kHz and converts to PCM16 LE bytes.
 */
export function float32ToPcm16(samples: Float32Array, sourceRate: number): Int16Array {
  if (samples.length === 0) return new Int16Array(0);

  if (sourceRate === TARGET_SAMPLE_RATE) {
    const out = new Int16Array(samples.length);
    for (let i = 0; i < samples.length; i += 1) {
      const clamped = Math.max(-1, Math.min(1, samples[i] ?? 0));
      out[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    }
    return out;
  }

  const ratio = sourceRate / TARGET_SAMPLE_RATE;
  const targetLen = Math.max(1, Math.floor(samples.length / ratio));
  const out = new Int16Array(targetLen);
  for (let i = 0; i < targetLen; i += 1) {
    const start = Math.floor(i * ratio);
    const end = Math.min(samples.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    let count = 0;
    for (let j = start; j < end; j += 1) {
      sum += samples[j] ?? 0;
      count += 1;
    }
    const avg = count > 0 ? sum / count : (samples[start] ?? 0);
    const clamped = Math.max(-1, Math.min(1, avg));
    out[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }
  return out;
}

export function pcm16ToBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let binary = "";
  const chunk = 0x4000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Fixed-capacity FIFO buffer that discards oldest frames on overflow so capture never leaks RAM.
 */
export class BoundedAudioQueue {
  private readonly items: QueuedAudioFrame[] = [];
  private readonly maxFrames: number;
  public droppedCount = 0;

  constructor(maxFrames = DEFAULT_MAX_QUEUE_FRAMES) {
    this.maxFrames = Math.max(1, maxFrames);
  }

  enqueue(frame: QueuedAudioFrame): boolean {
    if (frame.payload.length > MAX_WS_FRAME_BYTES) {
      return false;
    }
    let overflowed = false;
    if (this.items.length >= this.maxFrames) {
      this.items.shift();
      this.droppedCount += 1;
      overflowed = true;
    }
    this.items.push(frame);
    return !overflowed;
  }

  dequeue(): QueuedAudioFrame | undefined {
    return this.items.shift();
  }

  peek(): QueuedAudioFrame | undefined {
    return this.items[0];
  }

  clear(): void {
    this.items.length = 0;
  }

  get size(): number {
    return this.items.length;
  }
}

