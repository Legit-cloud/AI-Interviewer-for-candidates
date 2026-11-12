import { INVOKED_KEY } from "../lib/storage";
import type { BackgroundMessage, CaptureMode, OffscreenMessage, PanelState, StartFailure } from "../lib/types";

const OFFSCREEN_URL = "offscreen.html";
const OVERLAY_TAB_KEY = "vren-overlay-tab";

type Reply = { ok: boolean; code?: StartFailure | "NO_MIC"; error?: string };

async function hasOffscreen(): Promise<boolean> {
  const contexts = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT] });
  return contexts.length > 0;
}

async function ensureOffscreen(): Promise<void> {
  if (await hasOffscreen()) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: [chrome.offscreen.Reason.USER_MEDIA],
    justification: "Send the sound you chose to Vren AI so it can write answers.",
  });
}

function toOffscreen(msg: OffscreenMessage): Promise<Reply> {
  return chrome.runtime.sendMessage(msg);
}

/** Gets a one-time id for the sound. "tab" needs the Vren icon to have been clicked on that tab (activeTab). */
async function getStream(mode: CaptureMode, tabId: number): Promise<{ id: string; kind: "tab" | "desktop" | "none" } | Reply> {
  if (mode === "room") return { id: "", kind: "none" }; // microphone only: nothing to pick
  if (mode === "tab") {
    try {
      return { id: await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }), kind: "tab" };
    } catch {
      return { ok: false, code: "NEEDS_PICKER", error: "Chrome needs you to pick the tab." };
    }
  }
  // Chrome's own chooser. The user ticks "Share tab audio" (or picks a screen with sound).
  return new Promise((resolve) => {
    chrome.desktopCapture.chooseDesktopMedia(["tab", "screen", "window", "audio"], (id, options) => {
      if (!id) return resolve({ ok: false, code: "CANCELLED", error: "Nothing was chosen." });
      if (!options?.canRequestAudioTrack) return resolve({ ok: false, code: "NO_SOUND", error: "No sound was shared." });
      resolve({ id, kind: "desktop" });
    });
  });
}

// ---- overlay helpers
async function overlayTab(): Promise<number | null> {
  const out = await chrome.storage.session.get(OVERLAY_TAB_KEY);
  return (out[OVERLAY_TAB_KEY] as number | undefined) ?? null;
}

async function pushOverlayState(state: PanelState): Promise<void> {
  const tabId = await overlayTab();
  if (tabId === null) return;
  chrome.tabs.sendMessage(tabId, { target: "overlay", type: "STATE", state }).catch(() => {
    void chrome.storage.session.remove(OVERLAY_TAB_KEY); // the tab closed or moved on
  });
}

async function disableOverlay(): Promise<void> {
  const tabId = await overlayTab();
  await chrome.storage.session.remove(OVERLAY_TAB_KEY);
  if (tabId !== null) chrome.tabs.sendMessage(tabId, { target: "overlay", type: "CLOSE" }).catch(() => {});
}

/** The panel and the overlay should not both be on screen. Chrome 141+ can close the panel; older Chrome cannot, so ask the panel to close itself. */
async function hidePanel(tabId: number): Promise<void> {
  const sidePanel = chrome.sidePanel as unknown as { close?: (o: { tabId: number }) => Promise<void> };
  try {
    if (sidePanel.close) {
      await sidePanel.close({ tabId });
      return;
    }
  } catch {
    /* fall through */
  }
  chrome.runtime.sendMessage({ target: "panel", type: "CLOSE" }).catch(() => {});
}

// This worker only starts and stops capture. All answers come from the Vren backend.
export default defineBackground(() => {
  // Clicking the icon opens the panel and lets Chrome grant "this tab only" access (activeTab) to that tab.
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
  chrome.action.onClicked.addListener((tab) => {
    if (tab.id === undefined) return;
    void chrome.sidePanel.open({ tabId: tab.id }); // must be called straight away to count as the click
    void chrome.storage.session.set({ [INVOKED_KEY]: { tabId: tab.id, url: tab.url ?? "", title: tab.title ?? "" } });
  });

  chrome.runtime.onMessage.addListener((raw: BackgroundMessage, _sender, sendResponse) => {
    if (!raw || raw.target !== "background") return false;

    switch (raw.type) {
      case "OVERLAY_STATE":
        void pushOverlayState(raw.state);
        return false;

      case "OVERLAY_ENABLE":
        (async () => {
          try {
            await chrome.scripting.executeScript({ target: { tabId: raw.tabId }, files: ["/content-scripts/overlay.js"] });
            await chrome.storage.session.set({ [OVERLAY_TAB_KEY]: raw.tabId });
            await hidePanel(raw.tabId);
            sendResponse({ ok: true });
          } catch {
            sendResponse({ ok: false, error: "Click the Vren icon on that tab first." });
          }
        })();
        return true;

      case "OVERLAY_DISABLE":
        void disableOverlay();
        sendResponse({ ok: true });
        return false;

      case "OVERLAY_CONTROL": {
        const map = { PAUSE: "OFFSCREEN_PAUSE", RESUME: "OFFSCREEN_RESUME", STOP: "OFFSCREEN_STOP" } as const;
        void toOffscreen({ target: "offscreen", type: map[raw.action] });
        return false;
      }

      case "START":
        (async () => {
          try {
            const stream = await getStream(raw.mode, raw.tabId);
            if ("ok" in stream) return sendResponse(stream);
            await ensureOffscreen();
            const res = await toOffscreen({
              target: "offscreen",
              type: "OFFSCREEN_START",
              streamId: stream.id,
              streamKind: stream.kind,
              wsUrl: raw.wsUrl,
              mic: raw.mic,
            });
            sendResponse(res ?? { ok: false, code: "FAILED", error: "Capture did not start." });
          } catch (err) {
            sendResponse({ ok: false, code: "FAILED", error: err instanceof Error ? err.message : "Could not start." });
          }
        })();
        return true;

      case "PAUSE":
      case "RESUME":
      case "STOP": {
        const map = { PAUSE: "OFFSCREEN_PAUSE", RESUME: "OFFSCREEN_RESUME", STOP: "OFFSCREEN_STOP" } as const;
        toOffscreen({ target: "offscreen", type: map[raw.type] })
          .then((res) => {
            sendResponse(res);
            if (raw.type === "STOP") {
              void disableOverlay();
              // Give the offscreen page time to finish the session before closing it.
              setTimeout(() => chrome.offscreen.closeDocument().catch(() => {}), 4000);
            }
          })
          .catch(() => sendResponse({ ok: false }));
        return true;
      }
      default:
        return false;
    }
  });
});
