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
}

export const emptyState = (): PanelState => ({
  connection: "idle",
  capture: "idle",
  ended: false,
  pending: null,
  answers: [],
  transcript: [],
  notice: "",
});

/* ---- extension-internal messages ---- */
/** How to get the sound: "tab" is one click on this tab; "picker" opens Chrome's own tab-and-sound chooser. */
export type CaptureMode = "tab" | "picker" | "room";

export interface StartCaptureMessage {
  target: "background";
  type: "START";
  mode: CaptureMode;
  tabId: number;
  wsUrl: string;
  mic: boolean;
}
export interface ControlMessage {
  target: "background";
  type: "PAUSE" | "RESUME" | "STOP";
}

export interface OverlayControlMessage {
  target: "background";
  type: "OVERLAY_CONTROL";
  action: "PAUSE" | "RESUME" | "STOP";
}
export interface OverlayEnableMessage {
  target: "background";
  type: "OVERLAY_ENABLE";
  tabId: number;
}
export interface OverlayOtherMessage {
  target: "background";
  type: "OVERLAY_DISABLE";
}
export interface OverlayStateMessage {
  target: "background";
  type: "OVERLAY_STATE";
  state: PanelState;
}
export type BackgroundMessage =
  | StartCaptureMessage
  | ControlMessage
  | OverlayControlMessage
  | OverlayEnableMessage
  | OverlayOtherMessage
  | OverlayStateMessage;

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
export type OffscreenMessage = OffscreenStartMessage | OffscreenControlMessage;

export type PanelMessage =
  | { target: "panel"; type: "SERVER_EVENT"; event: ServerEvent }
  | { target: "panel"; type: "STATUS"; status: ConnectionStatus; detail?: string }
  | { target: "panel"; type: "ERROR"; message: string }
  | { target: "panel"; type: "CLOSE" }
  | { target: "panel"; type: "MIC_GRANTED" };

/** Reply codes the background gives the panel when capture cannot start. */
export type StartFailure = "NEEDS_PICKER" | "NO_SOUND" | "CANCELLED" | "FAILED";
