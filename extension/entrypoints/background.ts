import type { BackgroundMessage, OffscreenMessage } from "../lib/types";

const OFFSCREEN_URL = "offscreen.html";

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
