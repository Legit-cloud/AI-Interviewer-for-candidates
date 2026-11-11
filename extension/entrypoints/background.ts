import {
  checkApiHealth,
  createLiveSession,
  exchangePairingToken,
  loadContextWorkspace,
  sendExtensionHeartbeat,
  signInAndPairExtension,
  stopLiveSession,
} from "../lib/api-client";
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
  getWidgetUiState,
  type LiveSnapshotState,
  saveContextCache,
  saveLiveSnapshot,
  saveSessionSelection,
  saveWidgetUiState,
  setActiveSessionState,
  setCaptureState,
} from "../lib/storage";
import { checkTabEligibility } from "../lib/tab-eligibility";
import type {
  AudioSource,
  CaptureTabOption,
  CaptureTargetMode,
  ControlOffscreenPayload,
  OffscreenLiveEvent,
  StartOffscreenCapturePayload,
  WidgetPublicSnapshot,
} from "../lib/types";

const OFFSCREEN_PATH = "offscreen.html";
const LAST_TAB_KEY = "vren_last_invoked_tab_id";
const INVOKED_TABS_KEY = "vren_invoked_tab_ids";

async function getInvokedTabIds(): Promise<number[]> {
  const stored = await chrome.storage.session.get(INVOKED_TABS_KEY).catch(() => ({}));
  const arr = (stored as Record<string, unknown>)[INVOKED_TABS_KEY];
  return Array.isArray(arr) ? arr.filter((id): id is number => typeof id === "number") : [];
}

async function markTabInvoked(tabId: number): Promise<void> {
  const ids = await getInvokedTabIds();
  if (!ids.includes(tabId)) {
    await chrome.storage.session.set({ [INVOKED_TABS_KEY]: [...ids, tabId] });
  }
}

async function unmarkTabInvoked(tabId: number): Promise<void> {
  const ids = await getInvokedTabIds();
  if (ids.includes(tabId)) {
    await chrome.storage.session.set({
      [INVOKED_TABS_KEY]: ids.filter((id) => id !== tabId),
    });
  }
}

async function hasOffscreenDocument(): Promise<boolean> {
  if (chrome.runtime.getContexts) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
      documentUrls: [chrome.runtime.getURL(OFFSCREEN_PATH)],
    });
    return contexts.length > 0;
  }
  return false;
}

async function ensureOffscreenDocument(): Promise<void> {
  if (await hasOffscreenDocument()) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: [chrome.offscreen.Reason.USER_MEDIA, chrome.offscreen.Reason.AUDIO_PLAYBACK],
    justification:
      "Capture selected tab audio and optional microphone for live interview transcription while preserving speaker playback.",
  });
}

async function closeOffscreenDocument(): Promise<void> {
  if (!(await hasOffscreenDocument())) return;
  await chrome.offscreen.closeDocument().catch(() => {});
}

async function updateBadge(state: "recording" | "paused" | "idle") {
  if (state === "recording") {
    await chrome.action.setBadgeText({ text: "REC" });
    await chrome.action.setBadgeBackgroundColor({ color: "#14362B" });
  } else if (state === "paused") {
    await chrome.action.setBadgeText({ text: "II" });
    await chrome.action.setBadgeBackgroundColor({ color: "#B86A3A" });
  } else {
    await chrome.action.setBadgeText({ text: "" });
  }
}

async function getActiveTabInfo() {
  const [tab] = await chrome.tabs.query({ active: true, windowType: "normal" });
  const eligibility = checkTabEligibility(tab?.url);
  return {
    tabId: tab?.id ?? null,
    title: tab?.title ?? "",
    url: tab?.url ?? "",
    eligibility,
  };
}

async function listCaptureTabs(): Promise<CaptureTabOption[]> {
  const [tabs, stored] = await Promise.all([
    chrome.tabs.query({ windowType: "normal" }),
    chrome.storage.session.get(LAST_TAB_KEY),
  ]);
  const lastInvokedId = stored[LAST_TAB_KEY] as number | undefined;
  const result: CaptureTabOption[] = [];
  for (const tab of tabs) {
    if (typeof tab.id !== "number") continue;
    const check = checkTabEligibility(tab.url);
    if (!check.eligible) continue;
    result.push({
      tabId: tab.id,
      title: tab.title || check.hostLabel,
      url: tab.url || "",
      hostLabel: check.hostLabel,
      active: Boolean(tab.active) || tab.id === lastInvokedId,
      isLikelyMeeting: check.isLikelyMeeting,
    });
  }
  result.sort((a, b) => {
    if (a.isLikelyMeeting !== b.isLikelyMeeting) return a.isLikelyMeeting ? -1 : 1;
    if (a.active !== b.active) return a.active ? -1 : 1;
    return a.title.localeCompare(b.title);
  });
  return result;
}

async function openUrlInBrowserWindow(url: string): Promise<void> {
  const normalWindows = await chrome.windows.getAll({ windowTypes: ["normal"] });
  const targetWindow = normalWindows.find((w) => w.focused) ?? normalWindows[0];
  if (targetWindow?.id !== undefined) {
    await chrome.tabs.create({ windowId: targetWindow.id, url, active: true });
    await chrome.windows.update(targetWindow.id, { focused: true }).catch(() => {});
    return;
  }
  await chrome.windows.create({ url, type: "normal", focused: true });
}

async function openOrFocusPermissionsTab(): Promise<void> {
  const url = chrome.runtime.getURL("permissions.html");
  const existing = await chrome.tabs.query({ url });
  if (existing[0]?.id !== undefined) {
    await chrome.tabs.update(existing[0].id, { active: true });
    if (existing[0].windowId !== undefined) {
      await chrome.windows.update(existing[0].windowId, { focused: true });
    }
    return;
  }
  await openUrlInBrowserWindow(url);
}

async function sendToOffscreen(msg: StartOffscreenCapturePayload | ControlOffscreenPayload) {
  try {
    return await chrome.runtime.sendMessage(msg);
  } catch {
    // Retry once immediately in case offscreen listener finished registering just after createDocument.
    await new Promise((r) => setTimeout(r, 80));
    return await chrome.runtime.sendMessage(msg);
  }
}

async function broadcastToWidgetTabs(payload: Record<string, unknown>) {
  const tabs = await chrome.tabs.query({ windowType: "normal" }).catch(() => []);
  for (const tab of tabs) {
    if (typeof tab.id !== "number" || !checkTabEligibility(tab.url).eligible) continue;
    chrome.tabs.sendMessage(tab.id, payload).catch(() => {});
  }
}

async function buildPublicSnapshot(
  checkHealth = false,
  tabId?: number,
): Promise<WidgetPublicSnapshot> {
  const [auth, cache, selection, liveSnap, activeSession, captureState, micStore, invokedIds] =
    await Promise.all([
      getAuthRecord(),
      getContextCache(),
      getSessionSelection(),
      getLiveSnapshot(),
      getActiveSessionState(),
      getCaptureState(),
      chrome.storage.local.get("vren_mic_granted"),
      getInvokedTabIds(),
    ]);

  const apiHealthy = checkHealth
    ? await checkApiHealth(auth?.apiBaseUrl ?? DEFAULT_API_BASE_URL)
    : true;

  let stage = liveSnap?.stage ?? (auth ? "context" : "welcome");
  if (!auth) {
    stage = "welcome";
  } else if (
    !liveSnap &&
    activeSession &&
    (captureState === "recording" || captureState === "paused")
  ) {
    stage = "live";
  }

  return {
    authenticated: Boolean(auth),
    userEmail: auth?.userEmail ?? null,
    profileName: cache?.profile?.full_name ?? null,
    profileExperienceCount: cache?.profile?.experiences?.length ?? 0,
    jobs: cache?.jobs ?? [],
    preferences: cache?.preferences ?? null,
    selection,
    micGranted: Boolean(micStore.vren_mic_granted),
    tabCaptureReady: typeof tabId === "number" ? invokedIds.includes(tabId) : false,
    apiHealthy,
    sessionId: liveSnap?.sessionId ?? activeSession?.sessionId ?? null,
    stage,
    liveStatus:
      liveSnap?.liveStatus ?? (captureState === "paused" ? "paused" : "listening"),
    sttMode: liveSnap?.sttMode ?? "offline",
    startedAt: liveSnap?.startedAt ?? activeSession?.startedAt ?? null,
    transcript: liveSnap?.transcript ?? [],
    suggestions: liveSnap?.suggestions ?? [],
    detectedQuestion: liveSnap?.detectedQuestion ?? null,
    streamingText: liveSnap?.streamingText ?? "",
    degradedMessage: liveSnap?.degradedMessage ?? null,
    endedCleanly: liveSnap?.endedCleanly ?? true,
    webBaseUrl: auth?.webBaseUrl ?? DEFAULT_WEB_BASE_URL,
  };
}

async function syncPublicSnapshotToTabs(checkHealth = false) {
  const [baseSnapshot, invokedIds, tabs] = await Promise.all([
    buildPublicSnapshot(checkHealth),
    getInvokedTabIds(),
    chrome.tabs.query({ windowType: "normal" }).catch(() => [] as chrome.tabs.Tab[]),
  ]);
  for (const tab of tabs) {
    if (typeof tab.id !== "number" || !checkTabEligibility(tab.url).eligible) continue;
    chrome.tabs
      .sendMessage(tab.id, {
        target: "vren-widget",
        type: "WIDGET_PUBLIC_SNAPSHOT",
        snapshot: {
          ...baseSnapshot,
          tabCaptureReady: invokedIds.includes(tab.id),
        },
      })
      .catch(() => {});
  }
  return baseSnapshot;
}

async function applyOffscreenEventToSessionSnapshot(evt: OffscreenLiveEvent) {
  const active = await getActiveSessionState();
  const current: LiveSnapshotState = (await getLiveSnapshot()) ?? {
    sessionId: active?.sessionId ?? null,
    stage: "live",
    liveStatus: "connecting",
    sttMode: "offline",
    startedAt: active?.startedAt ?? new Date().toISOString(),
    transcript: [],
    suggestions: [],
    detectedQuestion: null,
    streamingText: "",
    degradedMessage: null,
    endedCleanly: true,
  };

  if (evt.type === "LIVE_CONNECTED") {
    current.sttMode = evt.sttMode;
    current.liveStatus = current.liveStatus === "paused" ? "paused" : "listening";
    current.degradedMessage = null;
    if (current.stage === "degraded") current.stage = "live";
  } else if (evt.type === "LIVE_TRANSCRIPT") {
    current.transcript = [...current.transcript.slice(-24), evt.item];
  } else if (evt.type === "LIVE_QUESTION") {
    current.detectedQuestion = evt.text;
  } else if (evt.type === "LIVE_SUGGESTION_STARTED") {
    current.streamingText = "";
    if (evt.questionText) current.detectedQuestion = evt.questionText;
  } else if (evt.type === "LIVE_SUGGESTION_DELTA") {
    current.streamingText = `${current.streamingText ?? ""}${evt.delta}`;
  } else if (evt.type === "LIVE_SUGGESTION") {
    current.detectedQuestion = null;
    current.streamingText = "";
    current.suggestions = [evt.suggestion, ...current.suggestions].slice(0, 12);
  } else if (evt.type === "LIVE_RECONNECTING") {
    current.degradedMessage = evt.message;
    if (current.stage === "live") current.stage = "degraded";
  } else if (evt.type === "LIVE_DEGRADED") {
    current.degradedMessage = evt.message;
  } else if (evt.type === "LIVE_BUFFER_OVERFLOW") {
    current.degradedMessage = `Audio buffer reached capacity (${evt.droppedFrames} older frames discarded).`;
  } else if (evt.type === "LIVE_ERROR") {
    current.degradedMessage = evt.message;
    current.stage = "degraded";
  } else if (evt.type === "LIVE_FINALIZED") {
    current.endedCleanly = evt.clean;
    current.stage = "ended";
  }

  await saveLiveSnapshot(current);
}

async function stopActiveSession(clean = true) {
  const currentState = await getCaptureState();
  if (currentState === "stopping") return;
  await setCaptureState("stopping");

  const active = await getActiveSessionState();
  try {
    await sendToOffscreen({ target: "offscreen", type: "OFFSCREEN_STOP" }).catch(() => {});
    if (clean && active?.sessionId) {
      await stopLiveSession(active.sessionId).catch(() => {});
    }
  } finally {
    await closeOffscreenDocument();
    await setActiveSessionState(null);
    await setCaptureState("idle");
    await updateBadge("idle");
  }
}

async function injectWidgetIntoTab(tabId: number): Promise<boolean> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content-scripts/widget.js"],
    });
    return true;
  } catch {
    return false;
  }
}

async function injectWidgetIntoOpenTabs(): Promise<void> {
  const tabs = await chrome.tabs
    .query({ url: ["http://*/*", "https://*/*"] })
    .catch(() => [] as chrome.tabs.Tab[]);
  for (const t of tabs) {
    if (t.id !== undefined && checkTabEligibility(t.url).eligible) {
      await injectWidgetIntoTab(t.id);
    }
  }
}

export default defineBackground(() => {
  chrome.action.onClicked.addListener((tab) => {
    void (async () => {
      if (tab?.id !== undefined && checkTabEligibility(tab.url).eligible) {
        await chrome.storage.session.set({ [LAST_TAB_KEY]: tab.id });
        await markTabInvoked(tab.id);
        const ui = await getWidgetUiState();
        const nextUi = await saveWidgetUiState({ expanded: !ui.expanded, hidden: false });
        try {
          await chrome.tabs.sendMessage(tab.id, {
            target: "vren-widget",
            type: "WIDGET_UI_CHANGED",
            ui: nextUi,
          });
          await syncPublicSnapshotToTabs(false);
          return;
        } catch {
          // Already-open tab before extension reload: inject widget.js now.
          if (await injectWidgetIntoTab(tab.id)) {
            const expandedUi = await saveWidgetUiState({ expanded: true, hidden: false });
            try {
              await chrome.tabs.sendMessage(tab.id, {
                target: "vren-widget",
                type: "WIDGET_UI_CHANGED",
                ui: expandedUi,
              });
              await syncPublicSnapshotToTabs(false);
            } catch {
              // Ignore if page navigated away.
            }
            return;
          }
        }
      }
      const auth = await getAuthRecord();
      const webBase = (auth?.webBaseUrl ?? DEFAULT_WEB_BASE_URL).replace(/\/+$/, "");
      await openUrlInBrowserWindow(`${webBase}/app`);
    })();
  });

  chrome.runtime.onInstalled.addListener(() => {
    void setCaptureState("idle");
    void injectWidgetIntoOpenTabs();
  });

  chrome.runtime.onStartup.addListener(() => {
    void injectWidgetIntoOpenTabs();
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.url) {
      void unmarkTabInvoked(tabId);
    }
  });

  chrome.tabs.onRemoved.addListener((closedTabId) => {
    void (async () => {
      await unmarkTabInvoked(closedTabId);
      const active = await getActiveSessionState();
      if (active?.tabId && active.tabId === closedTabId) {
        await stopActiveSession(false);
        chrome.runtime
          .sendMessage({
            target: "sidepanel",
            type: "LIVE_FINALIZED",
            clean: false,
            retainedTranscript: active.retainTranscript,
          })
          .catch(() => {});
      }
    })();
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes.vren_mic_granted) {
      void syncPublicSnapshotToTabs(false);
    }
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message !== "object") return false;

    // Relay live events from offscreen document cleanly into session snapshot and active page widgets.
    if (message.target === "sidepanel" && typeof message.type === "string" && message.type.startsWith("LIVE_")) {
      const evt = message as OffscreenLiveEvent;
      void applyOffscreenEventToSessionSnapshot(evt).then(() =>
        broadcastToWidgetTabs({ target: "vren-widget", type: "WIDGET_LIVE_EVENT", event: evt }),
      );
      return false;
    }

    if (message.type === "WIDGET_GET_STATE") {
      void (async () => {
        const [snapshot, ui] = await Promise.all([
          buildPublicSnapshot(Boolean(message.checkHealth), sender?.tab?.id),
          getWidgetUiState(),
        ]);
        sendResponse({ ok: true, snapshot, ui });
      })();
      return true;
    }

    if (message.type === "WIDGET_UPDATE_UI") {
      void (async () => {
        const nextUi = await saveWidgetUiState(message.patch ?? {});
        await broadcastToWidgetTabs({
          target: "vren-widget",
          type: "WIDGET_UI_CHANGED",
          ui: nextUi,
        });
        sendResponse({ ok: true, ui: nextUi });
      })();
      return true;
    }

    if (message.type === "WIDGET_UPDATE_SELECTION") {
      void (async () => {
        const nextSel = await saveSessionSelection(message.patch ?? {});
        await syncPublicSnapshotToTabs(false);
        sendResponse({ ok: true, selection: nextSel });
      })();
      return true;
    }

    if (message.type === "WIDGET_REFRESH_WORKSPACE") {
      void (async () => {
        try {
          const auth = await getAuthRecord();
          if (!auth) {
            const snapshot = await syncPublicSnapshotToTabs(true);
            sendResponse({ ok: true, snapshot });
            return;
          }
          const ws = await loadContextWorkspace();
          await saveContextCache({
            profile: ws.profile,
            jobs: ws.jobs,
            preferences: ws.preferences,
            cachedAt: new Date().toISOString(),
          });
          const currentSel = await getSessionSelection();
          await saveSessionSelection({
            retainTranscript: ws.preferences.retain_transcript_default,
            jobId:
              currentSel.jobId && ws.jobs.some((j) => j.id === currentSel.jobId)
                ? currentSel.jobId
                : (ws.jobs[0]?.id ?? null),
          });
          void sendExtensionHeartbeat(auth.connectionId).catch(() => {});
          const snapshot = await syncPublicSnapshotToTabs(true);
          sendResponse({ ok: true, snapshot });
        } catch (err) {
          const snapshot = await syncPublicSnapshotToTabs(true);
          sendResponse({
            ok: false,
            error: err instanceof Error ? err.message : "Failed to sync workspace.",
            snapshot,
          });
        }
      })();
      return true;
    }

    if (message.type === "WIDGET_SIGN_IN") {
      void (async () => {
        try {
          await signInAndPairExtension(String(message.email ?? ""), String(message.password ?? ""));
          const ws = await loadContextWorkspace();
          await saveContextCache({
            profile: ws.profile,
            jobs: ws.jobs,
            preferences: ws.preferences,
            cachedAt: new Date().toISOString(),
          });
          await saveSessionSelection({
            retainTranscript: ws.preferences.retain_transcript_default,
            jobId: ws.jobs[0]?.id ?? null,
          });
          const snapshot = await syncPublicSnapshotToTabs(true);
          sendResponse({ ok: true, snapshot });
        } catch (err) {
          sendResponse({
            ok: false,
            error: err instanceof Error ? err.message : "Sign in failed.",
          });
        }
      })();
      return true;
    }

    if (message.type === "WIDGET_PAIR_CODE") {
      void (async () => {
        try {
          await exchangePairingToken(String(message.token ?? ""));
          const ws = await loadContextWorkspace();
          await saveContextCache({
            profile: ws.profile,
            jobs: ws.jobs,
            preferences: ws.preferences,
            cachedAt: new Date().toISOString(),
          });
          await saveSessionSelection({
            retainTranscript: ws.preferences.retain_transcript_default,
            jobId: ws.jobs[0]?.id ?? null,
          });
          const snapshot = await syncPublicSnapshotToTabs(true);
          sendResponse({ ok: true, snapshot });
        } catch (err) {
          sendResponse({
            ok: false,
            error: err instanceof Error ? err.message : "Invalid pairing code.",
          });
        }
      })();
      return true;
    }

    if (message.type === "WIDGET_SIGN_OUT") {
      void (async () => {
        await stopActiveSession(true);
        await clearLiveSnapshot();
        await clearAuthRecord();
        const snapshot = await syncPublicSnapshotToTabs(false);
        sendResponse({ ok: true, snapshot });
      })();
      return true;
    }

    if (message.type === "WIDGET_RESET_ENDED") {
      void (async () => {
        await clearLiveSnapshot();
        const snapshot = await syncPublicSnapshotToTabs(false);
        sendResponse({ ok: true, snapshot });
      })();
      return true;
    }

    if (message.type === "PAIR_FROM_WEBAPP") {
      void (async () => {
        try {
          const auth = await exchangePairingToken(
            String(message.token ?? ""),
            DEFAULT_API_BASE_URL,
            typeof message.webOrigin === "string" ? message.webOrigin : undefined,
          );
          const ws = await loadContextWorkspace().catch(() => null);
          if (ws) {
            await saveContextCache({
              profile: ws.profile,
              jobs: ws.jobs,
              preferences: ws.preferences,
              cachedAt: new Date().toISOString(),
            });
            await saveSessionSelection({
              retainTranscript: ws.preferences.retain_transcript_default,
              jobId: ws.jobs[0]?.id ?? null,
            });
          }
          await syncPublicSnapshotToTabs(true);
          sendResponse({ ok: true, email: auth.userEmail });
        } catch (err) {
          sendResponse({
            ok: false,
            error: err instanceof Error ? err.message : "Pairing failed",
          });
        }
      })();
      return true;
    }

    if (message.type === "REVOKE_FROM_WEBAPP") {
      void (async () => {
        await stopActiveSession(true);
        await clearLiveSnapshot();
        await clearAuthRecord();
        await syncPublicSnapshotToTabs(false);
        sendResponse({ ok: true });
      })();
      return true;
    }

    if (message.type === "GET_ACTIVE_TAB") {
      void getActiveTabInfo().then((info) => sendResponse({ ok: true, ...info }));
      return true;
    }

    if (message.type === "LIST_CAPTURE_TABS") {
      void listCaptureTabs().then((tabs) => sendResponse({ ok: true, tabs }));
      return true;
    }

    if (message.type === "OPEN_PERMISSIONS_TAB") {
      void openOrFocusPermissionsTab().then(() => sendResponse({ ok: true }));
      return true;
    }

    if (message.type === "OPEN_WEB_TAB" && typeof message.url === "string") {
      void openUrlInBrowserWindow(message.url).then(() => sendResponse({ ok: true }));
      return true;
    }

    if (message.type === "SET_CAPTURE_BADGE") {
      const badgeState =
        message.state === "recording" || message.state === "paused" ? message.state : "idle";
      void updateBadge(badgeState).then(() => sendResponse({ ok: true }));
      return true;
    }

    if (message.type === "START_SESSION_CAPTURE") {
      void (async () => {
        let state = await getCaptureState();
        if (state !== "idle" && !(await hasOffscreenDocument())) {
          await setCaptureState("idle");
          state = "idle";
        }
        if (state !== "idle") {
          sendResponse({ ok: false, error: "A capture session is already active or transitioning." });
          return;
        }
        await setCaptureState("starting");
        try {
          const auth = await getAuthRecord();
          if (!auth) {
            throw new Error("Connect your Vren AI account first.");
          }
          const captureTab = Boolean(message.captureTab);
          const captureMic = Boolean(message.captureMic);
          const externalDisplayAudio = Boolean(message.externalDisplayAudio);
          const requestedTabId =
            typeof message.selectedTabId === "number"
              ? message.selectedTabId
              : typeof sender?.tab?.id === "number"
                ? sender.tab.id
                : null;

          if (!captureTab && !captureMic) {
            throw new Error("Enable interview audio or microphone before starting.");
          }

          let targetTabId: number | null = requestedTabId;
          let targetHost = externalDisplayAudio ? "Shared audio" : "Microphone";
          let streamId: string | null = null;

          if (captureTab && !externalDisplayAudio) {
            let targetTab: chrome.tabs.Tab | undefined;
            if (requestedTabId !== null) {
              targetTab = await chrome.tabs.get(requestedTabId).catch(() => undefined);
            }
            if (!targetTab) {
              const [activeTab] = await chrome.tabs.query({ active: true, windowType: "normal" });
              targetTab = activeTab;
            }
            const eligibility = checkTabEligibility(targetTab?.url);
            if (!targetTab?.id || !eligibility.eligible) {
              throw new Error(eligibility.reason);
            }
            targetTabId = targetTab.id;
            targetHost = eligibility.hostLabel;
            try {
              streamId = await chrome.tabCapture.getMediaStreamId({
                targetTabId,
              });
            } catch (tabErr) {
              const raw = tabErr instanceof Error ? tabErr.message : String(tabErr);
              if (raw.toLowerCase().includes("invoked")) {
                await unmarkTabInvoked(targetTabId);
                await setCaptureState("idle");
                sendResponse({
                  ok: false,
                  needsDisplayPicker: true,
                  error: "Select your interview tab or window in the browser share prompt to stream audio.",
                });
                return;
              }
              throw tabErr;
            }
          }

          const session = await createLiveSession({
            jobId: message.jobId ?? null,
            interviewType: String(message.interviewType || "Mixed"),
            retainTranscript: Boolean(message.retainTranscript),
          });

          await ensureOffscreenDocument();

          const startedAtIso = new Date().toISOString();
          await setActiveSessionState({
            sessionId: session.id,
            tabId: targetTabId,
            startedAt: startedAtIso,
            jobTitle: String(message.jobTitle || "General Interview"),
            company: String(message.company || ""),
            interviewType: String(message.interviewType || "Mixed"),
            retainTranscript: Boolean(message.retainTranscript),
            captureTab,
            captureMic,
          });
          await saveLiveSnapshot({
            sessionId: session.id,
            stage: "live",
            liveStatus: "connecting",
            sttMode: "offline",
            startedAt: startedAtIso,
            transcript: [],
            suggestions: [],
            detectedQuestion: null,
            streamingText: "",
            degradedMessage: null,
            endedCleanly: true,
          });

          const startRes = (await sendToOffscreen({
            target: "offscreen",
            type: "OFFSCREEN_START",
            sessionId: session.id,
            wsUrl: session.wsUrl,
            wsToken: session.wsToken,
            captureMode: externalDisplayAudio ? "desktop" : "tab",
            streamId,
            externalDisplayAudio,
            captureTab,
            captureMic,
          })) as { ok?: boolean; error?: string } | undefined;

          if (startRes && startRes.ok === false) {
            throw new Error(startRes.error || "Could not start media capture.");
          }

          await setCaptureState("recording");
          await updateBadge("recording");
          await syncPublicSnapshotToTabs(false);
          sendResponse({ ok: true, sessionId: session.id, tabHost: targetHost });
        } catch (err) {
          await closeOffscreenDocument();
          await setActiveSessionState(null);
          await setCaptureState("idle");
          await updateBadge("idle");
          sendResponse({
            ok: false,
            error: err instanceof Error ? err.message : "Failed to start capture.",
          });
        }
      })();
      return true;
    }

    if (message.type === "PAUSE_SESSION_CAPTURE") {
      void (async () => {
        const state = await getCaptureState();
        if (state !== "recording") {
          sendResponse({ ok: false, error: "Session is not listening." });
          return;
        }
        await setCaptureState("pausing");
        await sendToOffscreen({ target: "offscreen", type: "OFFSCREEN_PAUSE" }).catch(() => {});
        await setCaptureState("paused");
        await updateBadge("paused");
        sendResponse({ ok: true });
      })();
      return true;
    }

    if (message.type === "RESUME_SESSION_CAPTURE") {
      void (async () => {
        const state = await getCaptureState();
        if (state !== "paused") {
          sendResponse({ ok: false, error: "Session is not paused." });
          return;
        }
        await setCaptureState("starting");
        await sendToOffscreen({ target: "offscreen", type: "OFFSCREEN_RESUME" }).catch(() => {});
        await setCaptureState("recording");
        await updateBadge("recording");
        sendResponse({ ok: true });
      })();
      return true;
    }

    if (message.type === "STOP_SESSION_CAPTURE") {
      void stopActiveSession(message.clean !== false).then(async () => {
        const snap = await getLiveSnapshot();
        if (snap) {
          snap.stage = "ended";
          snap.endedCleanly = message.clean !== false;
          await saveLiveSnapshot(snap);
        }
        await syncPublicSnapshotToTabs(false);
        sendResponse({ ok: true });
      });
      return true;
    }

    if (message.type === "SIMULATE_UTTERANCE") {
      void sendToOffscreen({
        target: "offscreen",
        type: "OFFSCREEN_SIMULATE",
        text: String(message.text || ""),
        source: (message.source as AudioSource) || "tab",
      })
        .then((res) => sendResponse(res ?? { ok: true }))
        .catch((err) =>
          sendResponse({ ok: false, error: err instanceof Error ? err.message : "Not connected" }),
        );
      return true;
    }

    return false;
  });
});

