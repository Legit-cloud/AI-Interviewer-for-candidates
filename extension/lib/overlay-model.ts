import type { OverlayView, PanelState, SourceName, SourceReport } from "./types";

/** Short, plain words for each state of the sound check. */
export interface MeterReading {
  label: string;
  /** green = working, amber = waiting, red = something is wrong */
  tone: "good" | "wait" | "bad";
  level: number;
}

const STALE_MS = 4000;

/**
 * What to show next to a level meter. `level` is what the extension hears on this computer (instant).
 * `report` is what the server says about turning that sound into text (once a second).
 */
export function readMeter(
  source: SourceName,
  view: Pick<OverlayView, "levels" | "state">,
  now: number,
): MeterReading {
  const level = view.levels[source] ?? 0;
  const st: PanelState = view.state;
  const fresh = st.audioAt > 0 && now - st.audioAt <= STALE_MS;
  const report: SourceReport | undefined = fresh ? st.audio?.[source] : undefined;

  if (st.capture === "paused") return { label: "Paused", tone: "wait", level: 0 };
  if (st.connection === "reconnecting" || st.connection === "connecting") return { label: "Connecting…", tone: "wait", level };
  if (!report) {
    // No report from the server. If sound is arriving here but nothing comes back, say so.
    if (st.audioAt > 0) return { label: level > 5 ? "Not reaching Vren" : "No sound", tone: "bad", level };
    return level > 5 ? { label: "Hearing sound", tone: "wait", level } : { label: "Waiting for sound", tone: "wait", level };
  }
  switch (report.state) {
    case "ok":
      return { label: "Transcribing ✓", tone: "good", level };
    case "hearing":
      return { label: "Hearing you…", tone: "wait", level };
    case "quiet":
      return { label: "Quiet", tone: "wait", level };
    case "no_audio":
      return { label: "No sound", tone: "bad", level: 0 };
    case "no_stt":
      return { label: "Can't read speech yet", tone: "bad", level };
    case "problem":
      return { label: "Can't turn it into text", tone: "bad", level };
  }
}

export const SOURCE_NAME: Record<SourceName, string> = { tab: "Interviewer", microphone: "You" };

/** The 0 to 100 level the extension computes from raw samples (same curve as the server). */
export function levelPercent(rms: number): number {
  return Math.max(0, Math.min(100, Math.floor(Math.sqrt(Math.max(rms, 0)) * 1.6)));
}

/** Root-mean-square of float samples in the range -1 to 1, scaled like 16-bit audio so levels match the server. */
export function rmsOfFloat(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const v = (samples[i] ?? 0) * 32767;
    sum += v * v;
  }
  return Math.sqrt(sum / samples.length);
}

/** Which meters to draw: the interviewer always, and the microphone only when it is being listened to. */
export function visibleSources(view: Pick<OverlayView, "wantMic" | "wantRoom">): SourceName[] {
  if (view.wantRoom) return ["microphone"];
  return view.wantMic ? ["tab", "microphone"] : ["tab"];
}
