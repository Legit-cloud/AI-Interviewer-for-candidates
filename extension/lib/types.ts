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
export interface StartCaptureMessage {
  target: "background";
  type: "START";
  tabId: number;
  wsUrl: string;
}
export interface ControlMessage {
  target: "background";
  type: "PAUSE" | "RESUME" | "STOP";
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
  | OverlayEnableMessage
  | OverlayOtherMessage
  | OverlayStateMessage;

export interface OffscreenStartMessage {
  target: "offscreen";
  type: "OFFSCREEN_START";
  streamId: string;
  wsUrl: string;
}
export interface OffscreenControlMessage {
  target: "offscreen";
  type: "OFFSCREEN_PAUSE" | "OFFSCREEN_RESUME" | "OFFSCREEN_STOP" | "OFFSCREEN_SNAPSHOT";
}
export type OffscreenMessage = OffscreenStartMessage | OffscreenControlMessage;

export type PanelMessage =
  | { target: "panel"; type: "SERVER_EVENT"; event: ServerEvent }
  | { target: "panel"; type: "STATUS"; status: ConnectionStatus; detail?: string }
  | { target: "panel"; type: "ERROR"; message: string };
