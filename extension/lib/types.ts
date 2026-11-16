export interface ServerEvent {
  event_id: string;
  session_id: string;
  type: string;
  [key: string]: unknown;
}

export interface LiveAnswer {
  id: string;
  question_text: string;
  question_type: string;
  asked_at: string;
  framework: string;
  answer: string;
  lines: string[];
  key_points: string[];
  source_label: string;
  caveat: string;
  /** A short code snippet for coding questions. */
  code?: string;
}

/** What the server says about one source of sound. */
export type SourceState = "no_audio" | "quiet" | "no_stt" | "hearing" | "problem" | "ok";
export interface SourceReport {
  level: number;
  state: SourceState;
  text_ago: number | null;
}
export type SourceName = "tab" | "microphone";

export type ConnectionStatus = "idle" | "connecting" | "connected" | "reconnecting" | "closed";
export type CaptureStatus = "idle" | "listening" | "paused";

export interface PendingAnswer {
  questionId: string;
  question: string;
  text: string;
}

export interface TranscriptLine {
  id: string;
  speaker: string;
  text: string;
  at: string;
}

/** Everything the panel displays. Built only from server events, never from local business logic. */
export interface PanelState {
  connection: ConnectionStatus;
  capture: CaptureStatus;
  ended: boolean;
  pending: PendingAnswer | null;
  answers: LiveAnswer[];
  transcript: TranscriptLine[];
  notice: string;
  /** Latest report per source, once a second. Null until the first one arrives. */
  audio: Partial<Record<SourceName, SourceReport>> | null;
  sttReady: boolean | null;
  /** When the last report arrived (ms). Used to notice that the reports stopped. */
  audioAt: number;
}

export const emptyState = (): PanelState => ({
  connection: "idle",
  capture: "idle",
  ended: false,
  pending: null,
  answers: [],
  transcript: [],
  notice: "",
  audio: null,
  sttReady: null,
  audioAt: 0,
});

/* ---- extension-internal messages ---- */

/** How to get the sound: "tab" is one click on this tab; "picker" opens Chrome's own tab-and-sound chooser. */
export type CaptureMode = "tab" | "picker" | "room";
export type Phase = "pairing" | "ready" | "live" | "ended";

/** Everything the on-page window needs to draw itself. The background builds it; the window only draws it. */
export interface OverlayView {
  phase: Phase;
  jobTitle: string;
  error: string;
  busy: boolean;
  state: PanelState;
  /** What the extension itself hears, 0 to 100, for the level meters. */
  levels: Record<SourceName, number>;
  wantMic: boolean;
  wantRoom: boolean;
}

export type UiMessage =
  | { target: "background"; type: "UI_HELLO" }
  | { target: "background"; type: "UI_PAIR"; code: string; server?: string }
  | { target: "background"; type: "UI_START" }
  | { target: "background"; type: "UI_PREFS"; mic: boolean; room: boolean }
  | { target: "background"; type: "UI_CONTROL"; action: "PAUSE" | "RESUME" | "STOP" }
  | { target: "background"; type: "UI_UNPAIR" }
  | { target: "background"; type: "UI_SCREEN" }
  | { target: "background"; type: "UI_CLOSE" };

/** From the sound relay (the offscreen page) to the background. */
export type RelayMessage =
  | { target: "background"; type: "RELAY_STATE"; state: PanelState }
  | { target: "background"; type: "RELAY_LEVEL"; source: SourceName; level: number };

export type BackgroundMessage = UiMessage | RelayMessage;

export interface OffscreenStartMessage {
  target: "offscreen";
  type: "OFFSCREEN_START";
  /** Chrome media stream id for the captured sound. */
  streamId: string;
  /** "tab" for tabCapture ids, "desktop" for ids from the picker, "none" for microphone-only (phone or in person). */
  streamKind: "tab" | "desktop" | "none";
  wsUrl: string;
  mic: boolean;
}
export interface OffscreenControlMessage {
  target: "offscreen";
  type: "OFFSCREEN_PAUSE" | "OFFSCREEN_RESUME" | "OFFSCREEN_STOP" | "OFFSCREEN_SNAPSHOT";
}
export interface OffscreenImageMessage {
  target: "offscreen";
  type: "OFFSCREEN_IMAGE";
  image: string;
  mime: string;
}
export type OffscreenMessage = OffscreenStartMessage | OffscreenControlMessage | OffscreenImageMessage;

/** Pushed from the background into the page window. */
export type OverlayPush = { target: "overlay"; type: "VIEW"; view: OverlayView } | { target: "overlay"; type: "CLOSE" };

/** Reply codes the background gives when capture cannot start. */
export type StartFailure = "NEEDS_PICKER" | "NO_SOUND" | "CANCELLED" | "FAILED" | "NO_MIC";
