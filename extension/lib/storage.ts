import type {
  CaptureState,
  ExtensionAuthRecord,
  JobSummary,
  LiveSuggestionItem,
  LiveTranscriptItem,
  PanelStage,
  PreferencesSummary,
  ProfileSummary,
  SessionSelection,
  WidgetUiState,
} from "./types";

export const DEFAULT_API_BASE_URL = "http://127.0.0.1:8000";
export const DEFAULT_WEB_BASE_URL = "http://localhost:5173";
export const EXTENSION_VERSION = "0.1.0";

const AUTH_KEY = "vren_ext_auth";
const SELECTION_KEY = "vren_ext_selection";
const CACHE_KEY = "vren_ext_context_cache";
const WIDGET_UI_KEY = "vren_ext_widget_ui";
const CAPTURE_STATE_KEY = "vren_capture_state";
const ACTIVE_SESSION_KEY = "vren_active_session";
const LIVE_SNAPSHOT_KEY = "vren_live_snapshot";

export interface LiveSnapshotState {
  sessionId: string | null;
  stage: PanelStage;
  liveStatus: "connecting" | "listening" | "paused";
  sttMode: string;
  startedAt: string | null;
  transcript: LiveTranscriptItem[];
  suggestions: LiveSuggestionItem[];
  detectedQuestion: string | null;
  streamingText?: string;
  degradedMessage: string | null;
  endedCleanly: boolean;
}

export interface ContextCache {
  profile: ProfileSummary | null;
  jobs: JobSummary[];
  preferences: PreferencesSummary | null;
  cachedAt: string;
}

export interface ActiveSessionState {
  sessionId: string;
  tabId: number | null;
  startedAt: string;
  jobTitle: string;
  company: string;
  interviewType: string;
  retainTranscript: boolean;
  captureTab: boolean;
  captureMic: boolean;
}

export const defaultSelection: SessionSelection = {
  jobId: null,
  interviewType: "Mixed",
  captureTargetMode: "tab",
  selectedTabId: null,
  captureTab: true,
  captureMic: true,
  retainTranscript: false,
};

export async function getAuthRecord(): Promise<ExtensionAuthRecord | null> {
  const res = await chrome.storage.local.get(AUTH_KEY);
  const rec = res[AUTH_KEY] as ExtensionAuthRecord | undefined;
  return rec && rec.accessToken ? rec : null;
}

export async function saveAuthRecord(record: ExtensionAuthRecord): Promise<void> {
  await chrome.storage.local.set({ [AUTH_KEY]: record });
}

export async function clearAuthRecord(): Promise<void> {
  await chrome.storage.local.remove([AUTH_KEY, CACHE_KEY]);
}

export async function getSessionSelection(): Promise<SessionSelection> {
  const res = await chrome.storage.local.get(SELECTION_KEY);
  return { ...defaultSelection, ...(res[SELECTION_KEY] as Partial<SessionSelection> | undefined) };
}

export async function saveSessionSelection(patch: Partial<SessionSelection>): Promise<SessionSelection> {
  const current = await getSessionSelection();
  const next = { ...current, ...patch };
  await chrome.storage.local.set({ [SELECTION_KEY]: next });
  return next;
}

export async function getContextCache(): Promise<ContextCache | null> {
  const res = await chrome.storage.local.get(CACHE_KEY);
  return (res[CACHE_KEY] as ContextCache | undefined) ?? null;
}

export async function saveContextCache(cache: ContextCache): Promise<void> {
  await chrome.storage.local.set({ [CACHE_KEY]: cache });
}

export async function getWidgetUiState(): Promise<WidgetUiState> {
  const res = await chrome.storage.local.get(WIDGET_UI_KEY);
  const w = res[WIDGET_UI_KEY] as Partial<WidgetUiState> | undefined;
  return {
    x: typeof w?.x === "number" ? w.x : -1,
    y: typeof w?.y === "number" ? w.y : -1,
    width: typeof w?.width === "number" && w.width >= 300 ? w.width : 380,
    height: typeof w?.height === "number" && w.height >= 260 ? w.height : 480,
    expanded: Boolean(w?.expanded),
    hidden: Boolean(w?.hidden),
  };
}

export async function saveWidgetUiState(patch: Partial<WidgetUiState>): Promise<WidgetUiState> {
  const current = await getWidgetUiState();
  const next = { ...current, ...patch };
  await chrome.storage.local.set({ [WIDGET_UI_KEY]: next });
  return next;
}

export async function getCaptureState(): Promise<CaptureState> {
  const res = await chrome.storage.session.get(CAPTURE_STATE_KEY);
  return (res[CAPTURE_STATE_KEY] as CaptureState | undefined) ?? "idle";
}

export async function setCaptureState(state: CaptureState): Promise<void> {
  await chrome.storage.session.set({ [CAPTURE_STATE_KEY]: state });
}

export async function getActiveSessionState(): Promise<ActiveSessionState | null> {
  const res = await chrome.storage.session.get(ACTIVE_SESSION_KEY);
  return (res[ACTIVE_SESSION_KEY] as ActiveSessionState | undefined) ?? null;
}

export async function setActiveSessionState(session: ActiveSessionState | null): Promise<void> {
  if (!session) {
    await chrome.storage.session.remove(ACTIVE_SESSION_KEY);
    return;
  }
  await chrome.storage.session.set({ [ACTIVE_SESSION_KEY]: session });
}

export async function getLiveSnapshot(): Promise<LiveSnapshotState | null> {
  const res = await chrome.storage.session.get(LIVE_SNAPSHOT_KEY);
  return (res[LIVE_SNAPSHOT_KEY] as LiveSnapshotState | undefined) ?? null;
}

export async function saveLiveSnapshot(snapshot: LiveSnapshotState): Promise<void> {
  await chrome.storage.session.set({ [LIVE_SNAPSHOT_KEY]: snapshot });
}

export async function clearLiveSnapshot(): Promise<void> {
  await chrome.storage.session.remove(LIVE_SNAPSHOT_KEY);
}

