// What to show for the sound check. Matches the wording in the extension and the desktop app.
// (Kept here because the web app does not import from the extension folder.)

export type SourceState = "no_audio" | "quiet" | "no_stt" | "hearing" | "problem" | "ok";
export interface SourceReport {
  level: number;
  state: SourceState;
  text_ago: number | null;
}
export interface SoundReport {
  sources: Partial<Record<"tab" | "microphone", SourceReport>>;
  sttReady: boolean;
  at: number;
}
export interface Meter {
  label: string;
  tone: "good" | "wait" | "bad";
  level: number;
}

const STALE_MS = 4500;

export function readMeter(
  report: SoundReport | null,
  source: "tab" | "microphone",
  now: number,
  paused: boolean,
): Meter {
  if (paused) return { label: "Paused", tone: "wait", level: 0 };
  if (!report) return { label: "Waiting for sound", tone: "wait", level: 0 };
  if (now - report.at > STALE_MS)
    return { label: "No sound is reaching Vren", tone: "bad", level: 0 };
  const r = report.sources[source];
  if (!r) return { label: "Not listening", tone: "wait", level: 0 };
  switch (r.state) {
    case "ok":
      return { label: "Transcribing ✓", tone: "good", level: r.level };
    case "hearing":
      return { label: "Hearing speech…", tone: "wait", level: r.level };
    case "quiet":
      return { label: "Quiet", tone: "wait", level: r.level };
    case "no_audio":
      return { label: "No sound", tone: "bad", level: 0 };
    case "no_stt":
      return { label: "Can't read speech yet", tone: "bad", level: r.level };
    case "problem":
      return { label: "Can't turn it into text", tone: "bad", level: r.level };
  }
}
