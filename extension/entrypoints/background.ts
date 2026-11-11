import {
  createLiveSession,
  exchangePairingToken,
  stopLiveSession,
} from "../lib/api-client";
import {
  clearAuthRecord,
  DEFAULT_API_BASE_URL,
  getActiveSessionState,
  getAuthRecord,
  getCaptureState,
  getFloatingBounds,
  saveFloatingBounds,
  setActiveSessionState,
  setCaptureState,
} from "../lib/storage";
import { checkTabEligibility } from "../lib/tab-eligibility";
import type {
  AudioSource,
  CaptureTabOption,
  CaptureTargetMode,
  ControlOffscreenPayload,
  StartOffscreenCapturePayload,
} from "../lib/types";

const OFFSCREEN_PATH = "offscreen.html";
const FLOATING_WINDOW_KEY = "vren_floating_window_id";

function applySidePanelBehavior() {
  if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
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
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const eligibility = checkTabEligibility(tab?.url);
  return {
    tabId: tab?.id ?? null,
    title: tab?.title ?? "",
    url: tab?.url ?? "",
    eligibility,
  };
}

async function listCaptureTabs(): Promise<CaptureTabOption[]> {
  const tabs = await chrome.tabs.query({});
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
      active: Boolean(tab.active),
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
  await chrome.tabs.create({ url, active: true });
}

async function openOrFocusFloatingWindow(): Promise<number | undefined> {
  const stored = await chrome.storage.session.get(FLOATING_WINDOW_KEY);
  const existingId = stored[FLOATING_WINDOW_KEY] as number | undefined;
  if (typeof existingId === "number") {
    try {
      const win = await chrome.windows.get(existingId);
      if (win?.id !== undefined) {
        await chrome.windows.update(win.id, { focused: true, state: "normal" });
        return win.id;
      }
    } catch {
      await chrome.storage.session.remove(FLOATING_WINDOW_KEY);
    }
  }

  const bounds = await getFloatingBounds();
  const created = await chrome.windows.create({
    url: chrome.runtime.getURL("sidepanel.html?mode=floating"),
    type: "popup",
    focused: true,
    left: bounds.left,
    top: bounds.top,
    width: bounds.width,
    height: bounds.height,
  });
  if (created?.id !== undefined) {
    await chrome.storage.session.set({ [FLOATING_WINDOW_KEY]: created.id });
  }
  return created?.id;
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

export default defineBackground(() => {
  applySidePanelBehavior();

  chrome.runtime.onInstalled.addListener(() => {
    applySidePanelBehavior();
    void setCaptureState("idle");
  });

  chrome.tabs.onRemoved.addListener((closedTabId) => {
    void (async () => {
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

  chrome.windows.onBoundsChanged.addListener((win) => {
    void (async () => {
      const stored = await chrome.storage.session.get(FLOATING_WINDOW_KEY);
      if (stored[FLOATING_WINDOW_KEY] !== win.id) return;
      if (
        typeof win.left === "number" &&
        typeof win.top === "number" &&
        typeof win.width === "number" &&
        typeof win.height === "number"
      ) {
        await saveFloatingBounds({
          left: win.left,
          top: win.top,
          width: win.width,
          height: win.height,
        });
      }
    })();
  });

  chrome.windows.onRemoved.addListener((closedWindowId) => {
    void (async () => {
      const stored = await chrome.storage.session.get(FLOATING_WINDOW_KEY);
      if (stored[FLOATING_WINDOW_KEY] === closedWindowId) {
        await chrome.storage.session.remove(FLOATING_WINDOW_KEY);
      }
    })();
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message !== "object") return false;

    if (message.type === "PAIR_FROM_WEBAPP") {
      void (async () => {
        try {
          const auth = await exchangePairingToken(
            String(message.token ?? ""),
            DEFAULT_API_BASE_URL,
            typeof message.webOrigin === "string" ? message.webOrigin : undefined,
          );
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
        await clearAuthRecord();
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

    if (message.type === "OPEN_FLOATING_WINDOW") {
      void openOrFocusFloatingWindow()
        .then((windowId) => sendResponse({ ok: true, windowId }))
        .catch((err) =>
          sendResponse({
            ok: false,
            error: err instanceof Error ? err.message : "Could not open floating window.",
          }),
        );
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
          const captureMode: CaptureTargetMode = "tab";
          const requestedTabId =
            typeof message.selectedTabId === "number" ? message.selectedTabId : null;

          if (!captureTab && !captureMic) {
            throw new Error("Enable interview audio or microphone before starting.");
          }

          let targetTabId: number | null = null;
          let targetHost = "Microphone";
          let streamId: string | null = null;

          if (captureTab) {
            let targetTab: chrome.tabs.Tab | undefined;
            if (requestedTabId !== null) {
              targetTab = await chrome.tabs.get(requestedTabId).catch(() => undefined);
            }
            if (!targetTab) {
              const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
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
                throw new Error(
                  "Click the Vren AI icon once while viewing your interview tab, or choose 'Window or screen' mode instead.",
                );
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

          await setActiveSessionState({
            sessionId: session.id,
            tabId: targetTabId,
            startedAt: new Date().toISOString(),
            jobTitle: String(message.jobTitle || "General Interview"),
            company: String(message.company || ""),
            interviewType: String(message.interviewType || "Mixed"),
            retainTranscript: Boolean(message.retainTranscript),
            captureTab,
            captureMic,
          });

          const startRes = (await sendToOffscreen({
            target: "offscreen",
            type: "OFFSCREEN_START",
            sessionId: session.id,
            wsUrl: session.wsUrl,
            wsToken: session.wsToken,
            captureMode,
            streamId,
            captureTab,
            captureMic,
          })) as { ok?: boolean; error?: string } | undefined;

          if (startRes && startRes.ok === false) {
            throw new Error(startRes.error || "Could not start media capture.");
          }

          await setCaptureState("recording");
          await updateBadge("recording");
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
      void stopActiveSession(message.clean !== false).then(() => sendResponse({ ok: true }));
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

