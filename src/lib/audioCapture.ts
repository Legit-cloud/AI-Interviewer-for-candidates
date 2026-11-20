/**
 * Dual-channel in-browser audio capture for Vren AI.
 *
 * Captures:
 * 1. Interviewer Voice ("tab"): via navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
 * 2. Candidate Voice ("microphone"): via navigator.mediaDevices.getUserMedia({ audio: true })
 *
 * Converts both streams to 16kHz mono PCM16 and streams them over WebSocket as `audio.frame`.
 * Exposes AnalyserNodes for real-time waveform visualizers and voice activity indicators.
 */

export interface AudioCaptureCallbacks {
  onAudioFrame: (frame: {
    type: "audio.frame";
    source: "tab" | "microphone";
    sequence: number;
    sample_rate: number;
    channels: number;
    payload: string;
  }) => void;
  onError?: (err: Error) => void;
  onInterviewerTrackEnded?: () => void;
}

export interface AudioLevels {
  tabRms: number; // 0.0 to 1.0
  micRms: number; // 0.0 to 1.0
  tabSpeaking: boolean;
  micSpeaking: boolean;
}

export class DualAudioCapture {
  private audioCtx: AudioContext | null = null;
  private tabStream: MediaStream | null = null;
  private micStream: MediaStream | null = null;
  private tabSourceNode: MediaStreamAudioSourceNode | null = null;
  private micSourceNode: MediaStreamAudioSourceNode | null = null;
  private tabProcessor: ScriptProcessorNode | null = null;
  private micProcessor: ScriptProcessorNode | null = null;
  private tabAnalyser: AnalyserNode | null = null;
  private micAnalyser: AnalyserNode | null = null;
  private tabSeq = 0;
  private micSeq = 0;
  private tabSilenceHangover = 0;
  private micSilenceHangover = 0;
  private active = false;

  constructor(private callbacks: AudioCaptureCallbacks) {}

  public getTabAnalyser(): AnalyserNode | null {
    return this.tabAnalyser;
  }

  public getMicAnalyser(): AnalyserNode | null {
    return this.micAnalyser;
  }

  public isActive(): boolean {
    return this.active;
  }

  /**
   * Start capturing system/meeting audio (Interviewer) and microphone (Candidate).
   * Must be triggered from a user gesture (e.g. clicking "Start" or "Enable Audio").
   */
  public async start(options?: { captureTab?: boolean; captureMic?: boolean }): Promise<void> {
    const wantTab = options?.captureTab ?? true;
    const wantMic = options?.captureMic ?? true;

    // 1. Initialize AudioContext at 16kHz (or system rate downsampled)
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.audioCtx = new AudioContextClass();
    if (this.audioCtx.state === "suspended") {
      await this.audioCtx.resume();
    }

    // 2. Capture Interviewer Audio via getDisplayMedia
    if (wantTab) {
      if (!navigator.mediaDevices?.getDisplayMedia) {
        throw new Error("Screen/tab audio capture is not supported in this browser.");
      }

      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });

      const audioTracks = stream.getAudioTracks();
      if (!audioTracks.length) {
        stream.getTracks().forEach((t) => t.stop());
        throw new Error(
          "No audio track was shared. You must check 'Share audio' or 'Share tab audio' in the browser prompt so Vren can transcribe the interviewer."
        );
      }

      this.tabStream = stream;
      audioTracks[0].addEventListener("ended", () => {
        this.callbacks.onInterviewerTrackEnded?.();
      });

      // Set up pipeline for Interviewer
      this.tabSourceNode = this.audioCtx.createMediaStreamSource(new MediaStream([audioTracks[0]]));
      this.tabAnalyser = this.audioCtx.createAnalyser();
      this.tabAnalyser.fftSize = 256;
      this.tabSourceNode.connect(this.tabAnalyser);

      this.tabProcessor = this.audioCtx.createScriptProcessor(4096, 1, 1);
      this.tabSourceNode.connect(this.tabProcessor);
      this.tabProcessor.connect(this.audioCtx.destination);

      this.tabProcessor.onaudioprocess = (e) => {
        if (!this.active) return;
        const inputData = e.inputBuffer.getChannelData(0);
        this.processAndSendFrame(inputData, e.inputBuffer.sampleRate, "tab");
      };
    }

    // 3. Capture Candidate Audio via getUserMedia
    if (wantMic) {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Microphone capture is not supported in this browser.");
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      this.micStream = stream;
      const micTracks = stream.getAudioTracks();
      if (micTracks.length) {
        this.micSourceNode = this.audioCtx.createMediaStreamSource(new MediaStream([micTracks[0]]));
        this.micAnalyser = this.audioCtx.createAnalyser();
        this.micAnalyser.fftSize = 256;
        this.micSourceNode.connect(this.micAnalyser);

        this.micProcessor = this.audioCtx.createScriptProcessor(4096, 1, 1);
        this.micSourceNode.connect(this.micProcessor);
        this.micProcessor.connect(this.audioCtx.destination);

        this.micProcessor.onaudioprocess = (e) => {
          if (!this.active) return;
          const inputData = e.inputBuffer.getChannelData(0);
          this.processAndSendFrame(inputData, e.inputBuffer.sampleRate, "microphone");
        };
      }
    }

    this.active = true;
  }

  /**
   * Resamples float32 PCM to 16kHz, converts to PCM16 Int16Array, and dispatches base64 frame.
   */
  private processAndSendFrame(input: Float32Array, inputSampleRate: number, source: "tab" | "microphone") {
    const targetSampleRate = 16000;
    const resampled = this.resampleTo16k(input, inputSampleRate, targetSampleRate);
    if (!resampled.length) return;

    // Client-side VAD energy gate: suppress streaming silence frames
    let sumSquares = 0;
    for (let i = 0; i < resampled.length; i++) {
      sumSquares += resampled[i] * resampled[i];
    }
    const rms = Math.sqrt(sumSquares / resampled.length);
    const threshold = source === "microphone" ? 0.012 : 0.008;

    if (rms >= threshold) {
      if (source === "tab") {
        this.tabSilenceHangover = 4;
      } else {
        this.micSilenceHangover = 4;
      }
    } else {
      if (source === "tab") {
        if (this.tabSilenceHangover > 0) {
          this.tabSilenceHangover--;
        } else {
          return; // Suppress silence packet
        }
      } else {
        if (this.micSilenceHangover > 0) {
          this.micSilenceHangover--;
        } else {
          return; // Suppress silence packet
        }
      }
    }

    // Convert Float32 [-1.0, 1.0] to Int16 [-32768, 32767]
    const pcm16 = new Int16Array(resampled.length);
    for (let i = 0; i < resampled.length; i++) {
      const s = Math.max(-1, Math.min(1, resampled[i]));
      pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }

    const uint8 = new Uint8Array(pcm16.buffer);
    const b64 = this.uint8ToBase64(uint8);

    const seq = source === "tab" ? ++this.tabSeq : ++this.micSeq;
    this.callbacks.onAudioFrame({
      type: "audio.frame",
      source,
      sequence: seq,
      sample_rate: targetSampleRate,
      channels: 1,
      payload: b64,
    });
  }

  private resampleTo16k(input: Float32Array, fromRate: number, toRate: number): Float32Array {
    if (fromRate === toRate) return input;
    const ratio = fromRate / toRate;
    const newLength = Math.round(input.length / ratio);
    const result = new Float32Array(newLength);
    for (let i = 0; i < newLength; i++) {
      const srcIdx = i * ratio;
      const low = Math.floor(srcIdx);
      const high = Math.min(low + 1, input.length - 1);
      const frac = srcIdx - low;
      result[i] = input[low] * (1 - frac) + input[high] * frac;
    }
    return result;
  }

  private uint8ToBase64(bytes: Uint8Array): string {
    let binary = "";
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  public getLevels(): AudioLevels {
    let tabRms = 0;
    let micRms = 0;

    if (this.tabAnalyser) {
      const data = new Uint8Array(this.tabAnalyser.frequencyBinCount);
      this.tabAnalyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const val = (data[i] - 128) / 128;
        sum += val * val;
      }
      tabRms = Math.sqrt(sum / data.length);
    }

    if (this.micAnalyser) {
      const data = new Uint8Array(this.micAnalyser.frequencyBinCount);
      this.micAnalyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const val = (data[i] - 128) / 128;
        sum += val * val;
      }
      micRms = Math.sqrt(sum / data.length);
    }

    return {
      tabRms,
      micRms,
      tabSpeaking: tabRms > 0.05,
      micSpeaking: micRms > 0.05,
    };
  }

  public stop(): void {
    this.active = false;
    if (this.tabProcessor) {
      this.tabProcessor.disconnect();
      this.tabProcessor = null;
    }
    if (this.micProcessor) {
      this.micProcessor.disconnect();
      this.micProcessor = null;
    }
    if (this.tabStream) {
      this.tabStream.getTracks().forEach((t) => t.stop());
      this.tabStream = null;
    }
    if (this.micStream) {
      this.micStream.getTracks().forEach((t) => t.stop());
      this.micStream = null;
    }
    if (this.audioCtx) {
      this.audioCtx.close().catch(() => {});
      this.audioCtx = null;
    }
  }
}

