import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  checkApiHealth,
  createLiveSession,
  exchangePairingToken,
  ExtensionApiError,
  loadContextWorkspace,
  sendExtensionHeartbeat,
  signInAndPairExtension,
  stopLiveSession,
} from "../../lib/api-client";
import { LiveCaptureEngine } from "../../lib/live-capture";
import {
  clearAuthRecord,
  clearLiveSnapshot,
  DEFAULT_API_BASE_URL,
  DEFAULT_WEB_BASE_URL,
  getActiveSessionState,
  getAuthRecord,
  getCaptureState,
  getContextCache,
  getLiveSnapshot,
  getSessionSelection,
  saveContextCache,
  saveLiveSnapshot,
  saveSessionSelection,
} from "../../lib/storage";
import type {
  CaptureTabOption,
  ExtensionAuthRecord,
  InterviewType,
  JobSummary,
  LiveSuggestionItem,
  LiveTranscriptItem,
  OffscreenLiveEvent,
  PanelStage,
  PreferencesSummary,
  ProfileSummary,
  SessionSelection,
} from "../../lib/types";

const INTERVIEW_TYPES: InterviewType[] = [
  "Mixed",
  "Behavioural",
  "Technical",
  "System Design",
  "Case / Portfolio",
];

interface DocumentPiPApi {
  requestWindow(options?: {
    width?: number;
    height?: number;
    disallowReturnToOpener?: boolean;
  }): Promise<Window>;
}

function formatDuration(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

async function sendSwMessage<T = Record<string, unknown>>(payload: Record<string, unknown>): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(payload, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve((response ?? {}) as T);
    });
  });
}

function openWebPage(path: string, webBaseUrl: string) {
  const cleanBase = webBaseUrl.replace(/\/+$/, "");
  void chrome.tabs.create({ url: `${cleanBase}${path}` });
}

function copyDocumentStyles(targetDoc: Document) {
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const rules = Array.from(sheet.cssRules)
        .map((r) => r.cssText)
        .join("\n");
      const style = targetDoc.createElement("style");
      style.textContent = rules;
      targetDoc.head.appendChild(style);
    } catch {
      if (sheet.href) {
        const link = targetDoc.createElement("link");
        link.rel = "stylesheet";
        link.href = sheet.href;
        targetDoc.head.appendChild(link);
      }
    }
  }
}

export default function App() {
  const isFloatingWindow = useMemo(
    () => new URLSearchParams(window.location.search).get("mode") === "floating",
    [],
  );

  const [stage, setStage] = useState<PanelStage>("welcome");
  const [auth, setAuth] = useState<ExtensionAuthRecord | null>(null);
  const [profile, setProfile] = useState<ProfileSummary | null>(null);
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [preferences, setPreferences] = useState<PreferencesSummary | null>(null);
  const [selection, setSelection] = useState<SessionSelection>({
    jobId: null,
    interviewType: "Mixed",
    captureTargetMode: "tab",
    selectedTabId: null,
    captureTab: true,
    captureMic: true,
    retainTranscript: false,
  });

  // Auth inputs
  const [authMode, setAuthMode] = useState<"signin" | "code">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pairingInput, setPairingInput] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Sync, capture tabs & preflight state
  const [syncingContext, setSyncingContext] = useState(false);
  const [captureTabs, setCaptureTabs] = useState<CaptureTabOption[]>([]);
  const [apiHealthy, setApiHealthy] = useState<boolean | null>(null);
  const [micPermission, setMicPermission] = useState<"unknown" | "granted" | "prompt" | "denied">(
    "unknown",
  );
  const [preflightBusy, setPreflightBusy] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  // Live session & stealth display controls
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [liveStatus, setLiveStatus] = useState<"connecting" | "listening" | "paused">("connecting");
  const [sttMode, setSttMode] = useState<string>("offline");
  const [elapsedSec, setElapsedSec] = useState(0);
  const [transcript, setTranscript] = useState<LiveTranscriptItem[]>([]);
  const [suggestions, setSuggestions] = useState<LiveSuggestionItem[]>([]);
  const [detectedQuestion, setDetectedQuestion] = useState<string | null>(null);
  const [streamingText, setStreamingText] = useState<string>("");
  const [degradedMessage, setDegradedMessage] = useState<string | null>(null);
  const [endedCleanly, setEndedCleanly] = useState(true);
  const [quickQuestion, setQuickQuestion] = useState("");
  const [sendingQuestion, setSendingQuestion] = useState(false);

  // Stealth & movable window state
  const [stealthMasked, setStealthMasked] = useState(false);
  const [compactMode, setCompactMode] = useState(false);
  const [pipContainer, setPipContainer] = useState<HTMLElement | null>(null);
  const pipWindowRef = useRef<Window | null>(null);
  const directEngineRef = useRef<LiveCaptureEngine | null>(null);
  const directSessionIdRef = useRef<string | null>(null);

  const stageRef = useRef(stage);
  stageRef.current = stage;
  const startedAtRef = useRef<string | null>(null);
  const sttModeRef = useRef(sttMode);
  sttModeRef.current = sttMode;
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;
  const liveStatusRef = useRef(liveStatus);
  liveStatusRef.current = liveStatus;
  const transcriptRef = useRef(transcript);
  transcriptRef.current = transcript;
  const suggestionsRef = useRef(suggestions);
  suggestionsRef.current = suggestions;
  const detectedQuestionRef = useRef(detectedQuestion);
  detectedQuestionRef.current = detectedQuestion;
  const degradedMessageRef = useRef(degradedMessage);
  degradedMessageRef.current = degradedMessage;
  const endedCleanlyRef = useRef(endedCleanly);
  endedCleanlyRef.current = endedCleanly;

  const persistSnapshot = useCallback(
    (patch: Partial<import("../../lib/storage").LiveSnapshotState> = {}) => {
      void saveLiveSnapshot({
        sessionId: sessionIdRef.current,
        stage: stageRef.current,
        liveStatus: liveStatusRef.current,
        sttMode: sttModeRef.current,
        startedAt: startedAtRef.current,
        transcript: transcriptRef.current.slice(-25),
        suggestions: suggestionsRef.current.slice(0, 12),
        detectedQuestion: detectedQuestionRef.current,
        degradedMessage: degradedMessageRef.current,
        endedCleanly: endedCleanlyRef.current,
        ...patch,
      });
    },
    [],
  );

  const webBaseUrl = auth?.webBaseUrl ?? DEFAULT_WEB_BASE_URL;
  const apiBaseUrl = auth?.apiBaseUrl ?? DEFAULT_API_BASE_URL;

  const checkMicPermissionState = useCallback(async () => {
    try {
      const status = await navigator.permissions.query({ name: "microphone" as PermissionName });
      setMicPermission(status.state);
      status.onchange = () => {
        setMicPermission(status.state);
      };
    } catch {
      setMicPermission("prompt");
    }
  }, []);

  const refreshWorkspace = useCallback(async (record: ExtensionAuthRecord) => {
    setSyncingContext(true);
    try {
      const ws = await loadContextWorkspace();
      setProfile(ws.profile);
      setJobs(ws.jobs);
      setPreferences(ws.preferences);
      await saveContextCache({
        profile: ws.profile,
        jobs: ws.jobs,
        preferences: ws.preferences,
        cachedAt: new Date().toISOString(),
      });
      await saveSessionSelection({
        retainTranscript: ws.preferences.retain_transcript_default,
      });
      setSelection((prev) => ({
        ...prev,
        jobId:
          prev.jobId && ws.jobs.some((j) => j.id === prev.jobId)
            ? prev.jobId
            : (ws.jobs[0]?.id ?? null),
      }));
      void sendExtensionHeartbeat(record.connectionId).catch(() => {});
    } catch (err) {
      if (err instanceof ExtensionApiError && err.status === 401) {
        setAuth(null);
        setStage("welcome");
        setAuthError("Extension access was revoked or expired. Reconnect your account.");
      }
    } finally {
      setSyncingContext(false);
    }
  }, []);

  // Fast initial hydrate from chrome.storage + active session / floating window recovery
  useEffect(() => {
    void checkMicPermissionState();
    void (async () => {
      const [storedAuth, storedSelection, cached, captureState, activeSession, snapshot] =
        await Promise.all([
          getAuthRecord(),
          getSessionSelection(),
          getContextCache(),
          getCaptureState(),
          getActiveSessionState(),
          getLiveSnapshot(),
        ]);

      setSelection(storedSelection);
      if (cached) {
        setProfile(cached.profile);
        setJobs(cached.jobs);
        setPreferences(cached.preferences);
      }

      if (!storedAuth) {
        setStage("welcome");
        return;
      }

      setAuth(storedAuth);
      if (snapshot && (snapshot.stage === "live" || snapshot.stage === "degraded")) {
        startedAtRef.current = snapshot.startedAt;
        setSessionId(snapshot.sessionId);
        setLiveStatus(snapshot.liveStatus);
        setSttMode(snapshot.sttMode);
        setTranscript(snapshot.transcript);
        setSuggestions(snapshot.suggestions);
        setDetectedQuestion(snapshot.detectedQuestion);
        setDegradedMessage(snapshot.degradedMessage);
        if (snapshot.startedAt) {
          const startedMs = new Date(snapshot.startedAt).getTime();
          setElapsedSec(Math.max(0, Math.floor((Date.now() - startedMs) / 1000)));
        }
        setStage(snapshot.stage);
      } else if (activeSession && (captureState === "recording" || captureState === "paused")) {
        startedAtRef.current = activeSession.startedAt;
        setSessionId(activeSession.sessionId);
        setLiveStatus(captureState === "paused" ? "paused" : "listening");
        const startedMs = new Date(activeSession.startedAt).getTime();
        setElapsedSec(Math.max(0, Math.floor((Date.now() - startedMs) / 1000)));
        setStage("live");
      } else {
        setStage("context");
      }

      void refreshWorkspace(storedAuth);
    })();
  }, [checkMicPermissionState, refreshWorkspace]);

  // React immediately to pairing/revocation/mic/session updates across Side Panel & Floating Popup
  useEffect(() => {
    const onStorageChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ) => {
      if (areaName === "session" && changes.vren_live_snapshot) {
        const snap = changes.vren_live_snapshot.newValue as
          | import("../../lib/storage").LiveSnapshotState
          | undefined;
        if (!snap) return;
        startedAtRef.current = snap.startedAt;
        setSessionId(snap.sessionId);
        setLiveStatus(snap.liveStatus);
        setSttMode(snap.sttMode);
        setTranscript(snap.transcript);
        setSuggestions(snap.suggestions);
        setDetectedQuestion(snap.detectedQuestion);
        setDegradedMessage(snap.degradedMessage);
        setEndedCleanly(snap.endedCleanly);
        if (snap.stage === "live" || snap.stage === "degraded" || snap.stage === "ended") {
          setStage(snap.stage);
        }
        return;
      }

      if (areaName !== "local") return;
      if (changes.vren_mic_granted) {
        void checkMicPermissionState();
      }
      if (changes.vren_ext_auth) {
        const nextAuth = changes.vren_ext_auth.newValue as ExtensionAuthRecord | undefined;
        if (nextAuth?.accessToken) {
          setAuth(nextAuth);
          setAuthError(null);
          if (stageRef.current === "welcome") {
            setStage("context");
          }
          void refreshWorkspace(nextAuth);
        } else {
          setAuth(null);
          setStage("welcome");
        }
      }
    };
    chrome.storage.onChanged.addListener(onStorageChange);
    return () => chrome.storage.onChanged.removeListener(onStorageChange);
  }, [checkMicPermissionState, refreshWorkspace]);

  const applyLiveEvent = useCallback(
    (evt: OffscreenLiveEvent) => {
      if (evt.type === "LIVE_CONNECTED") {
        setSttMode(evt.sttMode);
        const nextStatus = liveStatusRef.current === "paused" ? "paused" : "listening";
        setLiveStatus(nextStatus);
        setDegradedMessage(null);
        const nextStage = stageRef.current === "degraded" ? "live" : stageRef.current;
        if (nextStage !== stageRef.current) setStage(nextStage);
        persistSnapshot({ sttMode: evt.sttMode, liveStatus: nextStatus, degradedMessage: null, stage: nextStage });
        return;
      }

      if (evt.type === "LIVE_TRANSCRIPT") {
        const next = [...transcriptRef.current.slice(-39), evt.item];
        setTranscript(next);
        persistSnapshot({ transcript: next });
        return;
      }

      if (evt.type === "LIVE_QUESTION") {
        setDetectedQuestion(evt.text);
        persistSnapshot({ detectedQuestion: evt.text });
        return;
      }

      if (evt.type === "LIVE_SUGGESTION_STARTED") {
        setStreamingText("");
        if (evt.questionText) {
          setDetectedQuestion(evt.questionText);
        }
        return;
      }

      if (evt.type === "LIVE_SUGGESTION_DELTA") {
        setStreamingText((prev) => prev + evt.delta);
        return;
      }

      if (evt.type === "LIVE_SUGGESTION") {
        const next = [evt.suggestion, ...suggestionsRef.current].slice(0, 20);
        setDetectedQuestion(null);
        setStreamingText("");
        setSuggestions(next);
        persistSnapshot({ detectedQuestion: null, suggestions: next });
        return;
      }

      if (evt.type === "LIVE_RECONNECTING") {
        const nextStage = stageRef.current === "live" ? "degraded" : stageRef.current;
        setDegradedMessage(evt.message);
        if (nextStage !== stageRef.current) setStage(nextStage);
        persistSnapshot({ degradedMessage: evt.message, stage: nextStage });
        return;
      }

      if (evt.type === "LIVE_DEGRADED") {
        setDegradedMessage(evt.message);
        persistSnapshot({ degradedMessage: evt.message });
        return;
      }

      if (evt.type === "LIVE_BUFFER_OVERFLOW") {
        const msg = `Audio buffer reached capacity (${evt.droppedFrames} older frames discarded).`;
        setDegradedMessage(msg);
        persistSnapshot({ degradedMessage: msg });
        return;
      }

      if (evt.type === "LIVE_ERROR") {
        setDegradedMessage(evt.message);
        setStage("degraded");
        persistSnapshot({ degradedMessage: evt.message, stage: "degraded" });
        return;
      }

      if (evt.type === "LIVE_FINALIZED") {
        setEndedCleanly(evt.clean);
        setStage("ended");
        persistSnapshot({ endedCleanly: evt.clean, stage: "ended" });
      }
    },
    [persistSnapshot],
  );

  // Listen to live WebSocket events, mic permission updates, and cross-window direct-capture controls
  useEffect(() => {
    const onMessage = (
      message:
        | OffscreenLiveEvent
        | { target?: string; type?: string; granted?: boolean; action?: string; text?: string },
    ) => {
      if (!message) return;
      if (message.target === "direct-host" && message.type === "DIRECT_CONTROL" && directEngineRef.current) {
        if (message.action === "pause") {
          directEngineRef.current.pause();
          setLiveStatus("paused");
          void sendSwMessage({ type: "SET_CAPTURE_BADGE", state: "paused" }).catch(() => {});
          persistSnapshot({ liveStatus: "paused" });
        } else if (message.action === "resume") {
          directEngineRef.current.resume();
          setLiveStatus("listening");
          void sendSwMessage({ type: "SET_CAPTURE_BADGE", state: "recording" }).catch(() => {});
          persistSnapshot({ liveStatus: "listening" });
        } else if (message.action === "stop") {
          void (async () => {
            directEngineRef.current?.stop(true);
            directEngineRef.current = null;
            const sid = directSessionIdRef.current;
            directSessionIdRef.current = null;
            if (sid) await stopLiveSession(sid).catch(() => {});
            await sendSwMessage({ type: "SET_CAPTURE_BADGE", state: "idle" }).catch(() => {});
            setEndedCleanly(true);
            setStage("ended");
            persistSnapshot({ endedCleanly: true, stage: "ended" });
          })();
        } else if (message.action === "ask" && typeof message.text === "string") {
          directEngineRef.current.sendUtterance(message.text, "tab");
        }
        return;
      }

      if (message.target !== "sidepanel") return;

      if (message.type === "MIC_PERMISSION_UPDATED") {
        setMicPermission(message.granted ? "granted" : "denied");
        return;
      }

      applyLiveEvent(message as OffscreenLiveEvent);
    };

    chrome.runtime.onMessage.addListener(onMessage);
    return () => chrome.runtime.onMessage.removeListener(onMessage);
  }, [applyLiveEvent, persistSnapshot]);

  // Keyboard shortcut Alt+H to toggle stealth mask quickly
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && e.key.toLowerCase() === "h") {
        e.preventDefault();
        setStealthMasked((prev) => !prev);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Elapsed timer while live/degraded and not paused
  useEffect(() => {
    if ((stage !== "live" && stage !== "degraded") || liveStatus === "paused") return;
    const timer = window.setInterval(() => {
      setElapsedSec((prev) => prev + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [stage, liveStatus]);

  // Close PiP & any direct stream cleanly on unmount
  useEffect(() => {
    return () => {
      pipWindowRef.current?.close();
      directEngineRef.current?.stop(false);
    };
  }, []);

  const updateSelection = async (patch: Partial<SessionSelection>) => {
    const next = await saveSessionSelection(patch);
    setSelection(next);
  };

  const runPreflightChecks = useCallback(async () => {
    setPreflightBusy(true);
    setStartError(null);
    try {
      const [tabsRes, healthy] = await Promise.all([
        sendSwMessage<{ tabs?: CaptureTabOption[] }>({ type: "LIST_CAPTURE_TABS" }),
        checkApiHealth(apiBaseUrl),
        checkMicPermissionState(),
      ]);

      const tabs = tabsRes.tabs ?? [];
      setCaptureTabs(tabs);
      setApiHealthy(healthy);

      const hasExistingTarget = tabs.some((t) => t.tabId === selection.selectedTabId);
      if (!hasExistingTarget && tabs[0]) {
        const nextSel = await saveSessionSelection({ selectedTabId: tabs[0].tabId });
        setSelection(nextSel);
      }
    } finally {
      setPreflightBusy(false);
    }
  }, [apiBaseUrl, checkMicPermissionState, selection.selectedTabId]);

  const handleRequestMicPermission = async () => {
    setStartError(null);
    try {
      // Try inline prompt first if permission state is still "prompt"; fallback to full tab if blocked/dismissed.
      if (micPermission === "prompt") {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        for (const track of stream.getTracks()) track.stop();
        setMicPermission("granted");
        return;
      }
    } catch {
      // Side panel inline prompt is auto-dismissed in Chromium; fall through to permissions.html tab.
    }
    await sendSwMessage({ type: "OPEN_PERMISSIONS_TAB" });
  };

  const handleToggleAlwaysOnTop = async () => {
    if (!isFloatingWindow) {
      persistSnapshot();
      await sendSwMessage({ type: "OPEN_FLOATING_WINDOW" });
      return;
    }

    if (pipWindowRef.current && !pipWindowRef.current.closed) {
      pipWindowRef.current.close();
      pipWindowRef.current = null;
      setPipContainer(null);
      return;
    }

    const docPiP = (window as Window & { documentPictureInPicture?: DocumentPiPApi })
      .documentPictureInPicture;
    if (docPiP) {
      try {
        const pipWin = await docPiP.requestWindow({
          width: 380,
          height: 480,
        });
        pipWin.document.title = "Vren Notes";
        pipWin.document.body.className = "bg-[#F6F3EC] text-[#17211E] antialiased";
        copyDocumentStyles(pipWin.document);
        const mount = pipWin.document.createElement("div");
        pipWin.document.body.appendChild(mount);

        pipWin.addEventListener("keydown", (e) => {
          if (e.altKey && e.key.toLowerCase() === "h") {
            e.preventDefault();
            setStealthMasked((prev) => !prev);
          }
        });
        pipWin.addEventListener("pagehide", () => {
          pipWindowRef.current = null;
          setPipContainer(null);
        });

        pipWindowRef.current = pipWin;
        setPipContainer(mount);
      } catch {
        // Ignore if browser disallows PiP in current window context.
      }
    }
  };

  const handlePopOutWindow = async () => {
    persistSnapshot();
    await sendSwMessage({ type: "OPEN_FLOATING_WINDOW" });
  };

  const selectedJob = useMemo(
    () => jobs.find((j) => j.id === selection.jobId) ?? null,
    [jobs, selection.jobId],
  );

  const selectedTabOption = useMemo(
    () => captureTabs.find((t) => t.tabId === selection.selectedTabId) ?? captureTabs[0] ?? null,
    [captureTabs, selection.selectedTabId],
  );

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthBusy(true);
    setAuthError(null);
    try {
      const record = await signInAndPairExtension(email, password);
      setAuth(record);
      setPassword("");
      setStage("context");
      void refreshWorkspace(record);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Sign in failed.");
    } finally {
      setAuthBusy(false);
    }
  };

  const handlePairCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthBusy(true);
    setAuthError(null);
    try {
      const record = await exchangePairingToken(pairingInput);
      setAuth(record);
      setPairingInput("");
      setStage("context");
      void refreshWorkspace(record);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Could not verify pairing code.");
    } finally {
      setAuthBusy(false);
    }
  };

  const handleSignOut = async () => {
    pipWindowRef.current?.close();
    directEngineRef.current?.stop(true);
    directEngineRef.current = null;
    if (directSessionIdRef.current) {
      await stopLiveSession(directSessionIdRef.current).catch(() => {});
      directSessionIdRef.current = null;
    }
    await clearLiveSnapshot();
    await sendSwMessage({ type: "SET_CAPTURE_BADGE", state: "idle" }).catch(() => {});
    await sendSwMessage({ type: "STOP_SESSION_CAPTURE", clean: true }).catch(() => {});
    await clearAuthRecord();
    setAuth(null);
    setProfile(null);
    setJobs([]);
    setStage("welcome");
  };

  const handleStartLiveSession = async () => {
    setStartError(null);
    const useMic = selection.captureMic && micPermission === "granted";

    // Window/screen capture runs directly via getDisplayMedia from this visible document
    // immediately inside the user click stack so Chrome never sees a stale/foreign streamId.
    if (selection.captureTab && selection.captureTargetMode === "desktop") {
      let displayStream: MediaStream | null = null;
      let micStream: MediaStream | null = null;
      try {
        try {
          displayStream = await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: true,
            systemAudio: "include",
          } as DisplayMediaStreamOptions);
        } catch (err) {
          if (err instanceof Error && (err.name === "NotAllowedError" || err.name === "AbortError")) {
            throw new Error(
              err.message && !err.message.toLowerCase().includes("permission denied by user")
                ? `Screen picker could not open here (${err.message}). Click 'Pop out movable window' and start there.`
                : "Screen or window selection was cancelled.",
            );
          }
          displayStream = await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: true,
          });
        }

        if (displayStream.getAudioTracks().length === 0) {
          for (const t of displayStream.getTracks()) t.stop();
          throw new Error(
            "No audio track was shared. Re-click Start session and toggle 'Also share tab/system audio' in Chrome's picker.",
          );
        }

        for (const vTrack of displayStream.getVideoTracks()) {
          vTrack.enabled = false;
        }

        setPreflightBusy(true);

        if (useMic) {
          micStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
            video: false,
          });
        }

        const session = await createLiveSession({
          jobId: selection.jobId,
          interviewType: selection.interviewType,
          retainTranscript: selection.retainTranscript,
        });

        const engine = new LiveCaptureEngine({
          wsUrl: session.wsUrl,
          wsToken: session.wsToken,
          captureTab: true,
          captureMic: useMic,
          remoteStream: displayStream,
          micStream,
          passthroughRemoteAudio: false,
          onEvent: applyLiveEvent,
        });
        await engine.start();

        directEngineRef.current = engine;
        directSessionIdRef.current = session.id;
        void sendSwMessage({ type: "SET_CAPTURE_BADGE", state: "recording" }).catch(() => {});

        // Stop cleanly if the user clicks Chrome's native "Stop sharing" bar.
        const primaryAudioTrack = displayStream.getAudioTracks()[0];
        if (primaryAudioTrack) {
          primaryAudioTrack.onended = () => {
            if (directEngineRef.current === engine) {
              void handleStopSession(true);
            }
          };
        }

        const nowIso = new Date().toISOString();
        startedAtRef.current = nowIso;
        setSessionId(session.id);
        setElapsedSec(0);
        setTranscript([]);
        setSuggestions([]);
        setDetectedQuestion(null);
        setDegradedMessage(null);
        setEndedCleanly(true);
        setStealthMasked(false);
        setLiveStatus("connecting");
        setStage("live");
        persistSnapshot({
          sessionId: session.id,
          startedAt: nowIso,
          transcript: [],
          suggestions: [],
          detectedQuestion: null,
          degradedMessage: null,
          endedCleanly: true,
          liveStatus: "connecting",
          stage: "live",
        });
      } catch (err) {
        for (const t of displayStream?.getTracks() ?? []) t.stop();
        for (const t of micStream?.getTracks() ?? []) t.stop();
        setStartError(err instanceof Error ? err.message : "Failed to start screen/window capture.");
      } finally {
        setPreflightBusy(false);
      }
      return;
    }

    setPreflightBusy(true);
    try {
      const res = await sendSwMessage<{ ok?: boolean; error?: string; sessionId?: string }>({
        type: "START_SESSION_CAPTURE",
        jobId: selection.jobId,
        jobTitle: selectedJob?.title ?? "General Interview",
        company: selectedJob?.company ?? "",
        interviewType: selection.interviewType,
        captureMode: "tab",
        selectedTabId: selectedTabOption?.tabId ?? null,
        captureTab: selection.captureTab,
        captureMic: useMic,
        retainTranscript: selection.retainTranscript,
      });

      if (!res.ok || !res.sessionId) {
        throw new Error(res.error || "Could not start live capture.");
      }

      const nowIso = new Date().toISOString();
      startedAtRef.current = nowIso;
      setSessionId(res.sessionId);
      setElapsedSec(0);
      setTranscript([]);
      setSuggestions([]);
      setDetectedQuestion(null);
      setDegradedMessage(null);
      setEndedCleanly(true);
      setStealthMasked(false);
      setLiveStatus("connecting");
      setStage("live");
      persistSnapshot({
        sessionId: res.sessionId,
        startedAt: nowIso,
        transcript: [],
        suggestions: [],
        detectedQuestion: null,
        degradedMessage: null,
        endedCleanly: true,
        liveStatus: "connecting",
        stage: "live",
      });
    } catch (err) {
      setStartError(err instanceof Error ? err.message : "Failed to start session.");
    } finally {
      setPreflightBusy(false);
    }
  };

  const handleTogglePause = async () => {
    if (directEngineRef.current) {
      if (liveStatus === "paused") {
        directEngineRef.current.resume();
        setLiveStatus("listening");
        void sendSwMessage({ type: "SET_CAPTURE_BADGE", state: "recording" }).catch(() => {});
        persistSnapshot({ liveStatus: "listening" });
      } else {
        directEngineRef.current.pause();
        setLiveStatus("paused");
        void sendSwMessage({ type: "SET_CAPTURE_BADGE", state: "paused" }).catch(() => {});
        persistSnapshot({ liveStatus: "paused" });
      }
      return;
    }

    if (liveStatus === "paused") {
      const res = await sendSwMessage<{ ok?: boolean }>({ type: "RESUME_SESSION_CAPTURE" });
      if (res.ok) {
        setLiveStatus("listening");
        persistSnapshot({ liveStatus: "listening" });
      } else {
        chrome.runtime
          .sendMessage({ target: "direct-host", type: "DIRECT_CONTROL", action: "resume" })
          .catch(() => {});
      }
    } else {
      const res = await sendSwMessage<{ ok?: boolean }>({ type: "PAUSE_SESSION_CAPTURE" });
      if (res.ok) {
        setLiveStatus("paused");
        persistSnapshot({ liveStatus: "paused" });
      } else {
        chrome.runtime
          .sendMessage({ target: "direct-host", type: "DIRECT_CONTROL", action: "pause" })
          .catch(() => {});
      }
    }
  };

  const handleStopSession = async (clean = true) => {
    if (directEngineRef.current) {
      directEngineRef.current.stop(clean);
      directEngineRef.current = null;
      const sid = directSessionIdRef.current;
      directSessionIdRef.current = null;
      if (clean && sid) {
        await stopLiveSession(sid).catch(() => {});
      }
      await sendSwMessage({ type: "SET_CAPTURE_BADGE", state: "idle" }).catch(() => {});
      setEndedCleanly(clean);
      setStage("ended");
      persistSnapshot({ endedCleanly: clean, stage: "ended" });
      return;
    }

    chrome.runtime
      .sendMessage({ target: "direct-host", type: "DIRECT_CONTROL", action: "stop" })
      .catch(() => {});
    await sendSwMessage({ type: "STOP_SESSION_CAPTURE", clean }).catch(() => {});
    setEndedCleanly(clean);
    setStage("ended");
    persistSnapshot({ endedCleanly: clean, stage: "ended" });
  };

  const handleSendQuickQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = quickQuestion.trim();
    if (!text) return;
    setSendingQuestion(true);
    try {
      if (directEngineRef.current) {
        const sent = directEngineRef.current.sendUtterance(text, "tab");
        if (sent) {
          setQuickQuestion("");
        } else {
          setDegradedMessage("Live socket is not connected yet.");
        }
        return;
      }

      const res = await sendSwMessage<{ ok?: boolean; error?: string }>({
        type: "SIMULATE_UTTERANCE",
        text,
        source: "tab",
      });
      if (res.ok) {
        setQuickQuestion("");
      } else {
        chrome.runtime
          .sendMessage({ target: "direct-host", type: "DIRECT_CONTROL", action: "ask", text })
          .catch(() => {});
        setQuickQuestion("");
      }
    } finally {
      setSendingQuestion(false);
    }
  };

  const latestSuggestion = suggestions[0] ?? null;

  const canStartLive =
    !preflightBusy &&
    (!selection.captureTab ||
      selection.captureTargetMode === "desktop" ||
      selectedTabOption !== null);

  const renderLiveExperience = () => (
    <div className="flex flex-col gap-3">
      {stage === "degraded" && (
        <div className="rounded-xl border border-[#B86A3A]/50 bg-[#FFF7ED] p-3 text-xs">
          <p className="font-semibold text-[#9A3412]">Connection or transcription issue</p>
          <p className="mt-1 text-[#7C2D12]">
            {degradedMessage || "Connection lost. We are trying to reconnect."}
          </p>
          <div className="mt-2.5 flex gap-2">
            <button
              type="button"
              onClick={() => setStage("live")}
              className="rounded-md border border-[#D9D2C0] bg-white px-2.5 py-1 font-medium text-[#17211E] hover:bg-[#FAF8F3]"
            >
              Continue without live guidance
            </button>
            <button
              type="button"
              onClick={() => void handleStopSession(false)}
              className="rounded-md bg-[#9F2D2D] px-2.5 py-1 font-medium text-white hover:bg-[#822424]"
            >
              Stop session
            </button>
          </div>
        </div>
      )}

      {/* Stealth quick bar */}
      <div className="flex flex-wrap items-center justify-between gap-1.5 rounded-lg border border-[#E4DEC9] bg-white px-2.5 py-1.5 text-[11px]">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setStealthMasked((prev) => !prev)}
            className={`rounded px-2 py-0.5 font-medium ${
              stealthMasked
                ? "bg-[#14362B] text-[#F6F3EC]"
                : "bg-[#FAF8F3] text-[#17211E] hover:bg-[#EFEAE0]"
            }`}
            title="Shortcut: Alt+H"
          >
            {stealthMasked ? "Show notes (Alt+H)" : "Hide notes (Alt+H)"}
          </button>
          <button
            type="button"
            onClick={() => setCompactMode((prev) => !prev)}
            className={`rounded px-2 py-0.5 font-medium ${
              compactMode
                ? "bg-[#14362B] text-[#F6F3EC]"
                : "bg-[#FAF8F3] text-[#17211E] hover:bg-[#EFEAE0]"
            }`}
          >
            {compactMode ? "Full view" : "Compact"}
          </button>
        </div>

        <button
          type="button"
          onClick={() => void handleToggleAlwaysOnTop()}
          className="rounded bg-[#14362B]/10 px-2 py-0.5 font-medium text-[#14362B] hover:bg-[#14362B]/15"
        >
          {!isFloatingWindow
            ? "Float movable window"
            : pipContainer
              ? "Return to window"
              : "Pin always on top"}
        </button>
      </div>

      {stealthMasked ? (
        <section className="rounded-xl border border-[#E4DEC9] bg-white p-4 text-center">
          <p className="text-xs font-medium text-[#17211E]">Notes hidden</p>
          <p className="mt-1 text-[11px] text-[#59635F]">
            Live listening continues quietly in the background. Press Alt+H or click Show notes.
          </p>
        </section>
      ) : (
        <>
          {/* Primary Live Answer Guidance */}
          <section className="rounded-xl border border-[#E4DEC9] bg-white p-4">
            {(detectedQuestion || streamingText) ? (
              <div>
                <div className="flex items-center justify-between gap-2 text-[11px] text-[#59635F]">
                  <span>Answering live</span>
                  <span>Streaming</span>
                </div>
                {detectedQuestion && (
                  <p className="mt-1 text-xs font-semibold text-[#17211E]">{detectedQuestion}</p>
                )}
                <p className="mt-2 whitespace-pre-line text-xs leading-relaxed text-[#17211E]">
                  {streamingText || "Thinking..."}
                </p>
              </div>
            ) : latestSuggestion ? (
              <div>
                <div className="flex items-center justify-between gap-2 text-[11px] text-[#59635F]">
                  <span>{latestSuggestion.questionType}</span>
                  <span>{latestSuggestion.framework}</span>
                </div>
                <p className="mt-1 text-xs font-semibold text-[#17211E]">
                  {latestSuggestion.questionText}
                </p>
                <ul className="mt-2.5 space-y-1.5 text-xs leading-relaxed text-[#17211E]">
                  {latestSuggestion.outline.map((point, idx) => (
                    <li key={idx} className="flex gap-2">
                      <span className="mt-1.5 size-1 shrink-0 rounded-full bg-[#14362B]" />
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>
                {!compactMode && latestSuggestion.evidenceRef && (
                  <p className="mt-2.5 border-t border-[#EFEAE0] pt-2 text-[11px] text-[#59635F]">
                    {latestSuggestion.evidenceRef}
                  </p>
                )}
                {!compactMode && latestSuggestion.caveat && (
                  <p className="mt-1 text-[11px] text-[#B86A3A]">{latestSuggestion.caveat}</p>
                )}
              </div>
            ) : (
              <div>
                <p className="text-xs font-medium text-[#17211E]">
                  Listening for interviewer questions
                </p>
                <p className="mt-1 text-[11px] leading-relaxed text-[#59635F]">
                  Drag this floating window near your webcam for natural eye contact. Hidden during tab or meeting-window shares.
                </p>
              </div>
            )}
          </section>

          {!compactMode && sttMode === "offline" && (
            <form
              onSubmit={handleSendQuickQuestion}
              className="rounded-xl border border-[#E4DEC9] bg-white p-3"
            >
              <p className="text-[11px] text-[#59635F]">
                Live transcription provider is offline. Ask or paste an interviewer question here for instant talking points:
              </p>
              <div className="mt-2 flex gap-1.5">
                <input
                  type="text"
                  value={quickQuestion}
                  onChange={(e) => setQuickQuestion(e.target.value)}
                  placeholder="e.g. How do you handle tight deadlines?"
                  className="min-w-0 flex-1 rounded-lg border border-[#D9D2C0] bg-[#FAF8F3] px-2.5 py-1.5 text-xs outline-none focus:border-[#14362B]"
                />
                <button
                  type="submit"
                  disabled={sendingQuestion || !quickQuestion.trim()}
                  className="rounded-lg bg-[#14362B] px-3 py-1.5 text-xs font-medium text-[#F6F3EC] disabled:opacity-50"
                >
                  Ask
                </button>
              </div>
            </form>
          )}

          {!compactMode && (
            <section className="rounded-xl border border-[#E4DEC9] bg-white p-3.5">
              <div className="flex items-center justify-between text-[11px] text-[#59635F]">
                <span className="font-medium text-[#17211E]">Live transcript</span>
                <span>{transcript.length} turns</span>
              </div>
              {transcript.length === 0 ? (
                <p className="mt-2 text-[11px] text-[#59635F]">No transcript lines yet.</p>
              ) : (
                <div className="mt-2 max-h-40 space-y-2 overflow-y-auto pr-1 text-xs">
                  {transcript.map((item) => (
                    <div key={item.id} className="leading-snug">
                      <span className="font-medium text-[#14362B]">{item.speaker}</span>{" "}
                      <span className="tabular font-mono text-[10px] text-[#59635F]">
                        {item.timestamp}
                      </span>
                      <p className="text-[#17211E]">{item.text}</p>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
        </>
      )}

      {/* Footer controls */}
      <footer className="flex items-center justify-between rounded-xl border border-[#E4DEC9] bg-white px-3 py-2 text-[11px]">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void handleTogglePause()}
            className="rounded-md border border-[#D9D2C0] px-2.5 py-1 font-medium text-[#17211E] hover:bg-[#FAF8F3]"
          >
            {liveStatus === "paused" ? "Resume" : "Pause"}
          </button>
          <span className="text-[#59635F]">
            {selection.captureTab ? "Audio on" : "Audio off"} ·{" "}
            {selection.captureMic && micPermission === "granted" ? "Mic on" : "Mic off"}
          </span>
        </div>
        <button
          type="button"
          onClick={() => openWebPage("/app/settings", webBaseUrl)}
          className="text-[#59635F] hover:text-[#17211E] hover:underline"
        >
          Settings
        </button>
      </footer>
    </div>
  );

  return (
    <div className="flex min-h-screen flex-col bg-[#F6F3EC] text-[#17211E]">
      {/* Top header */}
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-[#E4DEC9] bg-[#F6F3EC]/95 px-4 py-3 backdrop-blur-xs">
        <div className="flex items-center gap-2">
          <span className="inline-flex size-6 items-center justify-center rounded-md bg-[#14362B] text-xs font-semibold text-[#F6F3EC]">
            V
          </span>
          <span className="text-sm font-semibold tracking-tight text-[#17211E]">Vren AI</span>
        </div>

        {(stage === "live" || stage === "degraded") ? (
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#14362B]">
              <span
                className={`size-2 rounded-full ${
                  liveStatus === "paused"
                    ? "bg-[#B86A3A]"
                    : stage === "degraded"
                      ? "bg-[#C2410C]"
                      : "bg-[#15803D]"
                }`}
              />
              {stage === "degraded"
                ? "Reconnecting"
                : liveStatus === "paused"
                  ? "Paused"
                  : liveStatus === "connecting"
                    ? "Connecting"
                    : "Listening"}
            </span>
            <span className="tabular font-mono text-xs text-[#59635F]">
              {formatDuration(elapsedSec)}
            </span>
            <button
              type="button"
              onClick={() => void handleStopSession(true)}
              className="rounded-md bg-[#9F2D2D] px-2.5 py-1 text-xs font-medium text-white hover:bg-[#822424]"
            >
              Stop
            </button>
          </div>
        ) : auth ? (
          <div className="flex items-center gap-2.5">
            {!isFloatingWindow && (
              <button
                type="button"
                onClick={() => void handlePopOutWindow()}
                className="text-xs font-medium text-[#59635F] hover:text-[#17211E] hover:underline"
                title="Open as a movable window anywhere on screen"
              >
                Pop out
              </button>
            )}
            <button
              type="button"
              onClick={() => openWebPage("/app", webBaseUrl)}
              className="text-xs font-medium text-[#14362B] hover:underline"
            >
              Dashboard
            </button>
          </div>
        ) : null}
      </header>

      <main className="flex-1 p-4">
        {/* 11.1 Welcome / Signed-out */}
        {stage === "welcome" && (
          <div className="space-y-4">
            <div className="rounded-xl border border-[#E4DEC9] bg-white p-4">
              <h1 className="text-base font-semibold text-[#17211E]">Live interview companion</h1>
              <p className="mt-1 text-xs leading-relaxed text-[#59635F]">
                Stay grounded with concise talking points tailored to your role and background.
                No tab audio is captured until you explicitly start a session.
              </p>

              <button
                type="button"
                onClick={() => openWebPage("/app/settings", webBaseUrl)}
                className="mt-3 w-full rounded-lg bg-[#14362B] px-3 py-2 text-xs font-medium text-[#F6F3EC] hover:bg-[#1C493A]"
              >
                Connect in one click via Dashboard
              </button>
              <p className="mt-1.5 text-[11px] text-[#59635F]">
                In Dashboard Settings, click Connect extension and this window pairs automatically.
              </p>
            </div>

            <div className="rounded-xl border border-[#E4DEC9] bg-white p-4">
              <div className="flex gap-2 border-b border-[#EFEAE0] pb-2 text-xs font-medium">
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode("signin");
                    setAuthError(null);
                  }}
                  className={`rounded-md px-2 py-1 ${
                    authMode === "signin"
                      ? "bg-[#14362B]/10 text-[#14362B]"
                      : "text-[#59635F] hover:text-[#17211E]"
                  }`}
                >
                  Sign in with email
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode("code");
                    setAuthError(null);
                  }}
                  className={`rounded-md px-2 py-1 ${
                    authMode === "code"
                      ? "bg-[#14362B]/10 text-[#14362B]"
                      : "text-[#59635F] hover:text-[#17211E]"
                  }`}
                >
                  Paste pairing code
                </button>
              </div>

              {authMode === "signin" ? (
                <form onSubmit={handleSignIn} className="mt-3 space-y-2.5">
                  <div>
                    <label className="block text-[11px] font-medium text-[#59635F]" htmlFor="ext-email">
                      Email
                    </label>
                    <input
                      id="ext-email"
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      className="mt-1 w-full rounded-lg border border-[#D9D2C0] bg-[#FAF8F3] px-2.5 py-1.5 text-xs outline-none focus:border-[#14362B]"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-[#59635F]" htmlFor="ext-pass">
                      Password
                    </label>
                    <input
                      id="ext-pass"
                      type="password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Your Vren AI password"
                      className="mt-1 w-full rounded-lg border border-[#D9D2C0] bg-[#FAF8F3] px-2.5 py-1.5 text-xs outline-none focus:border-[#14362B]"
                    />
                  </div>
                  {authError && <p className="text-xs text-[#9F2D2D]">{authError}</p>}
                  <button
                    type="submit"
                    disabled={authBusy}
                    className="w-full rounded-lg border border-[#14362B] bg-white px-3 py-1.5 text-xs font-medium text-[#14362B] hover:bg-[#14362B]/5 disabled:opacity-60"
                  >
                    {authBusy ? "Connecting..." : "Sign in and connect"}
                  </button>
                </form>
              ) : (
                <form onSubmit={handlePairCode} className="mt-3 space-y-2.5">
                  <div>
                    <label className="block text-[11px] font-medium text-[#59635F]" htmlFor="ext-code">
                      One-time pairing code
                    </label>
                    <input
                      id="ext-code"
                      type="text"
                      required
                      value={pairingInput}
                      onChange={(e) => setPairingInput(e.target.value)}
                      placeholder="vren_ext_..."
                      className="mt-1 w-full rounded-lg border border-[#D9D2C0] bg-[#FAF8F3] px-2.5 py-1.5 font-mono text-xs outline-none focus:border-[#14362B]"
                    />
                  </div>
                  {authError && <p className="text-xs text-[#9F2D2D]">{authError}</p>}
                  <button
                    type="submit"
                    disabled={authBusy}
                    className="w-full rounded-lg border border-[#14362B] bg-white px-3 py-1.5 text-xs font-medium text-[#14362B] hover:bg-[#14362B]/5 disabled:opacity-60"
                  >
                    {authBusy ? "Verifying..." : "Connect with pairing code"}
                  </button>
                </form>
              )}
            </div>

            <div className="flex items-center justify-between px-1 text-[11px] text-[#59635F]">
              <span>Works in Chrome Side Panel & Floating Window</span>
              <button
                type="button"
                onClick={() => openWebPage("/app/settings", webBaseUrl)}
                className="hover:text-[#17211E] hover:underline"
              >
                Privacy & controls
              </button>
            </div>
          </div>
        )}

        {/* 11.2 Context Selection */}
        {stage === "context" && auth && (
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-xl border border-[#E4DEC9] bg-white px-3.5 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-[#17211E]">
                  {profile?.full_name || auth.userEmail}
                </p>
                <p className="truncate text-[11px] text-[#59635F]">{auth.userEmail}</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={syncingContext}
                  onClick={() => void refreshWorkspace(auth)}
                  className="text-[11px] font-medium text-[#14362B] hover:underline disabled:opacity-50"
                >
                  {syncingContext ? "Syncing..." : "Sync"}
                </button>
                <button
                  type="button"
                  onClick={() => void handleSignOut()}
                  className="text-[11px] text-[#59635F] hover:text-[#9F2D2D]"
                >
                  Sign out
                </button>
              </div>
            </div>

            <div className="space-y-3 rounded-xl border border-[#E4DEC9] bg-white p-4">
              <div>
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-[#17211E]" htmlFor="ctx-job">
                    Target role
                  </label>
                  <button
                    type="button"
                    onClick={() => openWebPage("/app/jobs", webBaseUrl)}
                    className="text-[11px] text-[#14362B] hover:underline"
                  >
                    Manage jobs
                  </button>
                </div>
                <select
                  id="ctx-job"
                  value={selection.jobId ?? ""}
                  onChange={(e) => void updateSelection({ jobId: e.target.value || null })}
                  className="mt-1.5 w-full rounded-lg border border-[#D9D2C0] bg-[#FAF8F3] px-2.5 py-2 text-xs outline-none focus:border-[#14362B]"
                >
                  <option value="">General interview (no target job)</option>
                  {jobs.map((job) => (
                    <option key={job.id} value={job.id}>
                      {job.title}
                      {job.company ? ` - ${job.company}` : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-medium text-[#17211E]" htmlFor="ctx-type">
                  Interview type
                </label>
                <select
                  id="ctx-type"
                  value={selection.interviewType}
                  onChange={(e) =>
                    void updateSelection({ interviewType: e.target.value as InterviewType })
                  }
                  className="mt-1.5 w-full rounded-lg border border-[#D9D2C0] bg-[#FAF8F3] px-2.5 py-2 text-xs outline-none focus:border-[#14362B]"
                >
                  {INTERVIEW_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>

              <div className="rounded-lg bg-[#FAF8F3] px-3 py-2.5 text-[11px] text-[#59635F]">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-[#17211E]">Response style</span>
                  <button
                    type="button"
                    onClick={() => openWebPage("/app/prepare", webBaseUrl)}
                    className="font-medium text-[#14362B] hover:underline"
                  >
                    Change preparation
                  </button>
                </div>
                <p className="mt-1">
                  {preferences
                    ? `${preferences.length}, ${preferences.style} (${preferences.framework}) · ${preferences.language}`
                    : "Brief, Structured · English"}
                </p>
                <p className="mt-0.5">
                  {profile
                    ? `${profile.experiences.length} profile items loaded`
                    : "Syncing profile context..."}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setStage("disclosure")}
              className="w-full rounded-lg bg-[#14362B] px-3 py-2.5 text-xs font-medium text-[#F6F3EC] hover:bg-[#1C493A]"
            >
              Continue to capture setup
            </button>
          </div>
        )}

        {/* 11.3 Capture Disclosure */}
        {stage === "disclosure" && (
          <div className="space-y-4">
            <div className="rounded-xl border border-[#E4DEC9] bg-white p-4">
              <h2 className="text-sm font-semibold text-[#17211E]">Audio capture disclosure</h2>
              <ul className="mt-2.5 space-y-1.5 text-xs text-[#59635F]">
                <li>• Interview audio: captured only from the tab, window, or screen you select</li>
                <li>• Microphone: your microphone, only if enabled and allowed in Chrome</li>
                <li>• Audio is sent for live transcription while the session is running</li>
                <li>• Raw audio is not retained by default</li>
              </ul>

              <div className="mt-4 space-y-2.5 border-t border-[#EFEAE0] pt-3">
                <label className="flex cursor-pointer items-center justify-between text-xs">
                  <span className="font-medium text-[#17211E]">Capture interview audio</span>
                  <input
                    type="checkbox"
                    checked={selection.captureTab}
                    onChange={(e) => void updateSelection({ captureTab: e.target.checked })}
                    className="size-4 accent-[#14362B]"
                  />
                </label>

                <label className="flex cursor-pointer items-center justify-between text-xs">
                  <span className="font-medium text-[#17211E]">Capture microphone</span>
                  <input
                    type="checkbox"
                    checked={selection.captureMic}
                    onChange={(e) => void updateSelection({ captureMic: e.target.checked })}
                    className="size-4 accent-[#14362B]"
                  />
                </label>

                <label className="flex cursor-pointer items-center justify-between text-xs">
                  <span className="font-medium text-[#17211E]">Retain transcript after session</span>
                  <input
                    type="checkbox"
                    checked={selection.retainTranscript}
                    onChange={(e) => void updateSelection({ retainTranscript: e.target.checked })}
                    className="size-4 accent-[#14362B]"
                  />
                </label>
              </div>
            </div>

            {!selection.captureTab && !selection.captureMic && (
              <p className="text-xs text-[#9F2D2D]">
                Enable at least Interview audio or Microphone to continue.
              </p>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setStage("context")}
                className="flex-1 rounded-lg border border-[#D9D2C0] bg-white px-3 py-2 text-xs font-medium text-[#17211E] hover:bg-[#FAF8F3]"
              >
                Back
              </button>
              <button
                type="button"
                disabled={!selection.captureTab && !selection.captureMic}
                onClick={() => {
                  setStage("preflight");
                  void runPreflightChecks();
                }}
                className="flex-[2] rounded-lg bg-[#14362B] px-3 py-2 text-xs font-medium text-[#F6F3EC] hover:bg-[#1C493A] disabled:opacity-50"
              >
                Check permissions & source
              </button>
            </div>
          </div>
        )}

        {/* 11.4 Preflight: Permissions + Where Interview Takes Place + Stealth Placement */}
        {stage === "preflight" && (
          <div className="space-y-3.5">
            <div className="rounded-xl border border-[#E4DEC9] bg-white p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-[#17211E]">Session preflight</h2>
                <button
                  type="button"
                  disabled={preflightBusy}
                  onClick={() => void runPreflightChecks()}
                  className="text-xs font-medium text-[#14362B] hover:underline disabled:opacity-50"
                >
                  {preflightBusy ? "Checking..." : "Refresh"}
                </button>
              </div>

              {selection.captureTab && (
                <div className="mt-3 space-y-2.5 rounded-lg bg-[#FAF8F3] p-3 text-xs">
                  <p className="font-medium text-[#17211E]">Where is the interview taking place?</p>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={() => void updateSelection({ captureTargetMode: "tab" })}
                      className={`rounded-md px-2.5 py-1.5 text-[11px] font-medium ${
                        selection.captureTargetMode === "tab"
                          ? "bg-[#14362B] text-[#F6F3EC]"
                          : "border border-[#D9D2C0] bg-white text-[#17211E]"
                      }`}
                    >
                      Chrome tab
                    </button>
                    <button
                      type="button"
                      onClick={() => void updateSelection({ captureTargetMode: "desktop" })}
                      className={`rounded-md px-2.5 py-1.5 text-[11px] font-medium ${
                        selection.captureTargetMode === "desktop"
                          ? "bg-[#14362B] text-[#F6F3EC]"
                          : "border border-[#D9D2C0] bg-white text-[#17211E]"
                      }`}
                    >
                      Window or screen
                    </button>
                  </div>

                  {selection.captureTargetMode === "tab" ? (
                    <div>
                      <select
                        aria-label="Interview browser tab"
                        value={selectedTabOption?.tabId ?? ""}
                        onChange={(e) =>
                          void updateSelection({
                            selectedTabId: e.target.value ? Number(e.target.value) : null,
                          })
                        }
                        className="w-full rounded-md border border-[#D9D2C0] bg-white px-2 py-1.5 text-xs outline-none focus:border-[#14362B]"
                      >
                        {captureTabs.length === 0 ? (
                          <option value="">No open web tabs found</option>
                        ) : (
                          captureTabs.map((tab) => (
                            <option key={tab.tabId} value={tab.tabId}>
                              {tab.isLikelyMeeting ? "[Meeting] " : ""}
                              {tab.title} ({tab.hostLabel})
                            </option>
                          ))
                        )}
                      </select>
                      {captureTabs.length === 0 && (
                        <p className="mt-1.5 text-[11px] text-[#9F2D2D]">
                          Open Google Meet, Zoom web, Microsoft Teams, or any call tab and click Refresh.
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="text-[11px] text-[#59635F]">
                      When you click Start session, Chrome opens its picker so you can select any screen, desktop Zoom/Teams window, or tab with audio.
                    </p>
                  )}
                </div>
              )}

              {selection.captureMic && (
                <div className="mt-2.5 flex items-center justify-between gap-2 rounded-lg bg-[#FAF8F3] p-2.5 text-xs">
                  <div className="min-w-0">
                    <p className="font-medium text-[#17211E]">Microphone permission</p>
                    <p className="text-[11px] text-[#59635F]">
                      {micPermission === "granted"
                        ? "Allowed for Side Panel and floating capture."
                        : "Chrome needs one-time mic approval in a browser tab."}
                    </p>
                  </div>
                  {micPermission === "granted" ? (
                    <span className="shrink-0 font-medium text-[#15803D]">Allowed</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void handleRequestMicPermission()}
                      className="shrink-0 rounded-md bg-[#14362B] px-2.5 py-1 text-[11px] font-medium text-[#F6F3EC] hover:bg-[#1C493A]"
                    >
                      Allow mic
                    </button>
                  )}
                </div>
              )}

              <div className="mt-2.5 flex items-center justify-between rounded-lg bg-[#FAF8F3] p-2.5 text-xs">
                <div>
                  <p className="font-medium text-[#17211E]">Vren AI API connection</p>
                  <p className="text-[11px] text-[#59635F]">{apiBaseUrl}</p>
                </div>
                <span
                  className={`font-medium ${
                    apiHealthy ? "text-[#15803D]" : apiHealthy === false ? "text-[#9F2D2D]" : "text-[#59635F]"
                  }`}
                >
                  {apiHealthy === null ? "Checking" : apiHealthy ? "Online" : "Offline"}
                </span>
              </div>

              <div className="mt-2.5 rounded-lg border border-[#E4DEC9] bg-white p-2.5 text-[11px] text-[#59635F]">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-[#17211E]">Stealth placement</span>
                  {!isFloatingWindow && (
                    <button
                      type="button"
                      onClick={() => void handlePopOutWindow()}
                      className="font-medium text-[#14362B] hover:underline"
                    >
                      Pop out movable window
                    </button>
                  )}
                </div>
                <p className="mt-1 leading-relaxed">
                  Pop out movable window opens a separate window you can drag near your webcam, staying hidden during Chrome tab or meeting-window shares. Note: Chrome extensions cannot hide from full-desktop screen recording or Entire Screen shares, so press Alt+H or use a second screen if sharing your full monitor.
                </p>
              </div>
            </div>

            {startError && <p className="text-xs text-[#9F2D2D]">{startError}</p>}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setStage("disclosure")}
                className="flex-1 rounded-lg border border-[#D9D2C0] bg-white px-3 py-2 text-xs font-medium text-[#17211E] hover:bg-[#FAF8F3]"
              >
                Back
              </button>
              <button
                type="button"
                disabled={!canStartLive}
                onClick={() => void handleStartLiveSession()}
                className="flex-[2] rounded-lg bg-[#14362B] px-3 py-2 text-xs font-medium text-[#F6F3EC] hover:bg-[#1C493A] disabled:opacity-50"
              >
                {preflightBusy ? "Starting..." : "Start session"}
              </button>
            </div>
          </div>
        )}

        {/* 11.5 Live Guidance & 11.6 Degraded Banner */}
        {(stage === "live" || stage === "degraded") &&
          (pipContainer ? (
            <div className="rounded-xl border border-[#E4DEC9] bg-white p-4 text-xs">
              <p className="font-medium text-[#17211E]">Floating movable window active</p>
              <p className="mt-1 text-[#59635F]">
                Drag and resize the always-on-top window anywhere on your screen (for example under your camera). Closing it returns notes here automatically.
              </p>
              <button
                type="button"
                onClick={() => void handleToggleAlwaysOnTop()}
                className="mt-3 rounded-lg border border-[#D9D2C0] px-3 py-1.5 font-medium text-[#17211E] hover:bg-[#FAF8F3]"
              >
                Return view to Side Panel
              </button>
              {createPortal(
                <div className="min-h-screen bg-[#F6F3EC] p-3 text-[#17211E]">
                  <div className="mb-2.5 flex items-center justify-between border-b border-[#E4DEC9] pb-2">
                    <span className="text-xs font-semibold">Vren Notes</span>
                    <div className="flex items-center gap-2">
                      <span className="tabular font-mono text-[11px] text-[#59635F]">
                        {formatDuration(elapsedSec)}
                      </span>
                      <button
                        type="button"
                        onClick={() => void handleStopSession(true)}
                        className="rounded bg-[#9F2D2D] px-2 py-0.5 text-[11px] font-medium text-white"
                      >
                        Stop
                      </button>
                    </div>
                  </div>
                  {renderLiveExperience()}
                </div>,
                pipContainer,
              )}
            </div>
          ) : (
            renderLiveExperience()
          ))}

        {/* 11.7 Ended / Interrupted */}
        {stage === "ended" && (
          <div className="space-y-4">
            <div className="rounded-xl border border-[#E4DEC9] bg-white p-4">
              <h2 className="text-base font-semibold text-[#17211E]">
                {endedCleanly ? "Session ended" : "Session interrupted"}
              </h2>
              <p className="mt-1 text-xs text-[#59635F]">
                Duration:{" "}
                <span className="tabular font-medium text-[#17211E]">
                  {formatDuration(elapsedSec)}
                </span>
              </p>
              <p className="mt-1 text-xs text-[#59635F]">
                {selection.retainTranscript
                  ? "Your transcript and generated guidance were saved to this session."
                  : "Raw audio was discarded and transcript retention was off for this session."}
              </p>
            </div>

            <div className="space-y-2">
              {sessionId && (
                <button
                  type="button"
                  onClick={() => openWebPage(`/app/sessions/${sessionId}`, webBaseUrl)}
                  className="w-full rounded-lg bg-[#14362B] px-3 py-2.5 text-xs font-medium text-[#F6F3EC] hover:bg-[#1C493A]"
                >
                  Review on dashboard
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  void clearLiveSnapshot();
                  setStage("context");
                }}
                className="w-full rounded-lg border border-[#D9D2C0] bg-white px-3 py-2 text-xs font-medium text-[#17211E] hover:bg-[#FAF8F3]"
              >
                Prepare another session
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
