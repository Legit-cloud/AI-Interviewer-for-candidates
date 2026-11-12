import type { BackgroundMessage, OffscreenMessage, PanelState } from "../lib/types";

const OFFSCREEN_URL = "offscreen.html";
const OVERLAY_TAB_KEY = "vren-overlay-tab";

async function overlayTab(): Promise<number | null> {
  const out = await chrome.storage.session.get(OVERLAY_TAB_KEY);
  return (out[OVERLAY_TAB_KEY] as number | undefined) ?? null;
}

async function pushOverlayState(state: PanelState): Promise<void> {
  const tabId = await overlayTab();
  if (tabId === null) return;
  chrome.tabs.sendMessage(tabId, { target: "overlay", type: "STATE", state }).catch(() => {
    void chrome.storage.session.remove(OVERLAY_TAB_KEY); // tab closed or navigated away
  });
}

async function disableOverlay(): Promise<void> {
  const tabId = await overlayTab();
  await chrome.storage.session.remove(OVERLAY_TAB_KEY);
  if (tabId !== null) chrome.tabs.sendMessage(tabId, { target: "overlay", type: "CLOSE" }).catch(() => {});
}

async function hasOffscreen(): Promise<boolean> {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
  });
  return contexts.length > 0;
}

async function ensureOffscreen(): Promise<void> {
  if (await hasOffscreen()) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: [chrome.offscreen.Reason.USER_MEDIA],
    justification: "Stream the audio of the tab you chose to Vren AI for live transcription.",
  });
}

function toOffscreen(msg: OffscreenMessage): Promise<{ ok: boolean; error?: string }> {
  return chrome.runtime.sendMessage(msg);
}

// This worker only starts and stops capture. All answers come from the Vren backend.
export default defineBackground(() => {
  // Clicking the toolbar icon opens the panel, and also grants activeTab for that tab,
  // which is what lets tabCapture run when the user presses Start capture.
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

  chrome.runtime.onMessage.addListener((raw: BackgroundMessage, _sender, sendResponse) => {
    if (!raw || raw.target !== "background") return false;

    if (raw.type === "OVERLAY_STATE") {
      void pushOverlayState(raw.state);
      return false;
    }
    if (raw.type === "OVERLAY_ENABLE") {
      (async () => {
        try {
          // activeTab (granted by the user clicking the Vren icon on this tab) lets us inject here only.
          await chrome.scripting.executeScript({ target: { tabId: raw.tabId }, files: ["/content-scripts/overlay.js"] });
          await chrome.storage.session.set({ [OVERLAY_TAB_KEY]: raw.tabId });
          sendResponse({ ok: true });
        } catch (err) {
          sendResponse({ ok: false, error: err instanceof Error ? err.message : "Could not show the overlay on this tab." });
        }
      })();
      return true;
    }
    if (raw.type === "OVERLAY_DISABLE") {
      void disableOverlay();
      sendResponse({ ok: true });
      return false;
    }

    if (raw.type === "START") {
      (async () => {
        try {
          const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: raw.tabId });
          await ensureOffscreen();
          const res = await toOffscreen({ target: "offscreen", type: "OFFSCREEN_START", streamId, wsUrl: raw.wsUrl });
          sendResponse(res ?? { ok: false, error: "Capture did not start." });
        } catch (err) {
          sendResponse({
            ok: false,
            error: err instanceof Error ? err.message : "Could not start capture. Click the Vren icon on the interview tab, then try again.",
          });
        }
      })();
      return true;
    }

    if (raw.type !== "PAUSE" && raw.type !== "RESUME" && raw.type !== "STOP") return false;
    const map = { PAUSE: "OFFSCREEN_PAUSE", RESUME: "OFFSCREEN_RESUME", STOP: "OFFSCREEN_STOP" } as const;
    toOffscreen({ target: "offscreen", type: map[raw.type] })
      .then((res) => {
        sendResponse(res);
        if (raw.type === "STOP") {
          // Give the offscreen page time to finalise the session before closing it.
          setTimeout(() => chrome.offscreen.closeDocument().catch(() => {}), 4000);
        }
      })
      .catch(() => sendResponse({ ok: false }));
    return true;
  });
});
