export type CaptureState =
  | "idle"
  | "starting"
  | "recording"
  | "pausing"
  | "paused"
  | "stopping";

export type PanelStage =
  | "welcome"
  | "context"
  | "disclosure"
  | "preflight"
  | "live"
  | "degraded"
  | "ended";

export type InterviewType =
  | "Mixed"
  | "Behavioural"
  | "Technical"
  | "System Design"
  | "Case / Portfolio";

export interface ExtensionUser {
  id: string;
  email: string;
  verified: boolean;
  onboarded: boolean;
  created_at: string;
}

export interface ProfileSummary {
  user_id: string;
  full_name: string;
  headline: string;
  role_focus: string;
  language: string;
  verified_at?: string | null;
  experiences: Array<{ id: string; title: string; organization: string; active: boolean }>;
  skills: Array<{ id: string; name: string }>;
}

export interface JobSummary {
  id: string;
  title: string;
  company: string;
  seniority: string;
  archived: boolean;
  required_skills: string[];
  themes: string[];
}

export interface PreferencesSummary {
  language: string;
  length: string;
  style: string;
  framework: string;
  retain_transcript_default: boolean;
}

export interface ExtensionAuthRecord {
  accessToken: string;
  expiresAt: string;
  connectionId: string;
  userEmail: string;
  apiBaseUrl: string;
  webBaseUrl: string;
}

export type CaptureTargetMode = "tab" | "desktop";

export interface CaptureTabOption {
  tabId: number;
  title: string;
  url: string;
  hostLabel: string;
  active: boolean;
  isLikelyMeeting: boolean;
}

export interface SessionSelection {
  jobId: string | null;
  interviewType: InterviewType;
  captureTargetMode: CaptureTargetMode;
  selectedTabId: number | null;
  captureTab: boolean;
  captureMic: boolean;
  retainTranscript: boolean;
}

export interface WidgetUiState {
  x: number;
  y: number;
  width: number;
  height: number;
  expanded: boolean;
  hidden: boolean;
}

export interface WidgetPublicSnapshot {
  authenticated: boolean;
  userEmail: string | null;
  profileName: string | null;
  profileExperienceCount: number;
  jobs: JobSummary[];
  preferences: PreferencesSummary | null;
  selection: SessionSelection;
  micGranted: boolean;
  tabCaptureReady: boolean;
  apiHealthy: boolean;
  sessionId: string | null;
  stage: PanelStage;
  liveStatus: "connecting" | "listening" | "paused";
  sttMode: string;
  startedAt: string | null;
  transcript: LiveTranscriptItem[];
  suggestions: LiveSuggestionItem[];
  detectedQuestion: string | null;
  streamingText: string;
  degradedMessage: string | null;
  endedCleanly: boolean;
  webBaseUrl: string;
}

export interface LiveTranscriptItem {
  id: string;
  speaker: string;
  text: string;
  timestamp: string;
  source: "tab" | "microphone";
}

export interface LiveSuggestionItem {
  id: string;
  questionText: string;
  questionType: string;
  askedAt: string;
  framework: string;
  outline: string[];
  evidenceRef: string;
  caveat: string;
}

export type AudioSource = "tab" | "microphone";

export interface StartOffscreenCapturePayload {
  target: "offscreen";
  type: "OFFSCREEN_START";
  sessionId: string;
  wsUrl: string;
  wsToken: string;
  captureMode: CaptureTargetMode;
  streamId: string | null;
  externalDisplayAudio?: boolean;
  captureTab: boolean;
  captureMic: boolean;
}

export interface ControlOffscreenPayload {
  target: "offscreen";
  type: "OFFSCREEN_PAUSE" | "OFFSCREEN_RESUME" | "OFFSCREEN_STOP" | "OFFSCREEN_SIMULATE";
  text?: string;
  source?: AudioSource;
}

export type OffscreenLiveEvent =
  | { target: "sidepanel"; type: "LIVE_CONNECTED"; sttMode: string }
  | { target: "sidepanel"; type: "LIVE_RECONNECTING"; attempt: number; message: string }
  | { target: "sidepanel"; type: "LIVE_DEGRADED"; code: string; message: string }
  | { target: "sidepanel"; type: "LIVE_BUFFER_OVERFLOW"; droppedFrames: number }
  | { target: "sidepanel"; type: "LIVE_TRANSCRIPT"; item: LiveTranscriptItem }
  | { target: "sidepanel"; type: "LIVE_QUESTION"; text: string; kind: string }
  | { target: "sidepanel"; type: "LIVE_SUGGESTION_STARTED"; questionText: string; questionType: string }
  | { target: "sidepanel"; type: "LIVE_SUGGESTION_DELTA"; delta: string }
  | { target: "sidepanel"; type: "LIVE_SUGGESTION"; suggestion: LiveSuggestionItem }
  | { target: "sidepanel"; type: "LIVE_AUDIO_LEVEL"; source: AudioSource; active: boolean }
  | { target: "sidepanel"; type: "LIVE_FINALIZED"; clean: boolean; retainedTranscript: boolean }
  | { target: "sidepanel"; type: "LIVE_ERROR"; message: string };

