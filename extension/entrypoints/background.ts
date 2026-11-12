import { buildWsUrl, DEFAULT_API_BASE, normalizeApiBase, PairingError, redeemPairingCode, type PairedSession } from "../lib/api";
import { plainStartError } from "../lib/plain";
import { clearPairedSession, loadApiBase, loadPairedSession, saveApiBase, savePairedSession } from "../lib/storage";
import { emptyState, type BackgroundMessage, type CaptureMode, type OffscreenMessage, type OverlayPush, type OverlayView, type PanelState, type Phase, type SourceName } from "../lib/types";

const OFFSCREEN_URL = "offscreen.html";
const PREFS_KEY = "vren-ui-prefs";

type Reply = { ok: boolean; code?: string; error?: string };

// ---------------------------------------------------------------- what the page window shows
let paired: PairedSession | null = null;
let apiBase = DEFAULT_API_BASE;
let state: PanelState = emptyState();
let levels: Record<SourceName, number> = { tab: 0, microphone: 0 };
let wantMic = false;
let wantRoom = false;
let error = "";
let busy = false;
let loaded = false;
const windows = new Set<number>(); // tabs that currently show the box

async function load(): Promise<void> {
  if (loaded) return;
  loaded = true;
  apiBase = await loadApiBase(DEFAULT_API_BASE);
  paired = await loadPairedSession();
  const prefs = (await chrome.storage.session.get(PREFS_KEY))[PREFS_KEY] as { mic: boolean; room: boolean } | undefined;
  wantMic = prefs?.mic ?? false;
  wantRoom = prefs?.room ?? false;
  // The service worker can be restarted while a session runs; the sound relay still has the state.
  const snap = (await chrome.runtime.sendMessage({ target: "offscreen", type: "OFFSCREEN_SNAPSHOT" }).catch(() => null)) as { active: boolean; state: PanelState } | null;
  if (snap?.active) state = snap.state;
}

function phase(): Phase {
  if (!paired) return "pairing";
  if (state.ended || state.connection === "closed") return "ended";
  if (state.connection !== "idle") return "live";
  return "ready";
}

function view(): OverlayView {
  return { phase: phase(), jobTitle: paired?.jobTitle ?? "", error, busy, state, levels, wantMic, wantRoom };
}

let pushTimer: ReturnType<typeof setTimeout> | undefined;
/** Sends the current view to every tab that shows the box. Level updates are batched so the page is not flooded. */
function push(now = false): void {
  const send = () => {
    pushTimer = undefined;
    const msg: OverlayPush = { target: "overlay", type: "VIEW", view: view() };
    for (const tabId of [...windows]) {
      chrome.tabs.sendMessage(tabId, msg).catch(() => windows.delete(tabId)); // the tab closed or moved on
    }
  };
  if (now) {
    clearTimeout(pushTimer);
    send();
  } else if (!pushTimer) {
    pushTimer = setTimeout(send, 200);
  }
}

// ---------------------------------------------------------------- the sound relay (offscreen page)
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

const toOffscreen = (msg: OffscreenMessage): Promise<Reply> => chrome.runtime.sendMessage(msg);

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
  // Chrome's own chooser. The person ticks "Share tab audio" (or picks a screen with sound).
  return new Promise((resolve) => {
    chrome.desktopCapture.chooseDesktopMedia(["tab", "screen", "window", "audio"], (id, options) => {
      if (!id) return resolve({ ok: false, code: "CANCELLED", error: "Nothing was chosen." });
      if (!options?.canRequestAudioTrack) return resolve({ ok: false, code: "NO_SOUND", error: "No sound was shared." });
      resolve({ id, kind: "desktop" });
    });
  });
}

async function attempt(mode: CaptureMode, tabId: number): Promise<Reply> {
  if (!paired) return { ok: false, code: "FAILED" };
  const stream = await getStream(mode, tabId);
  if ("ok" in stream) return stream;
  await ensureOffscreen();
  return (await toOffscreen({ target: "offscreen", type: "OFFSCREEN_START", streamId: stream.id, streamKind: stream.kind, wsUrl: buildWsUrl(apiBase, paired.wsPath, paired.wsToken), mic: wantMic || wantRoom })) ?? { ok: false, code: "FAILED" };
}

async function start(tabId: number): Promise<void> {
  error = "";
  busy = true;
  push(true);
  try {
    // One click on this tab when Chrome allows it, otherwise Chrome's own chooser. Phone or in-person needs no tab.
    let res = await attempt(wantRoom ? "room" : "tab", tabId);
    if (!res.ok && res.code === "NEEDS_PICKER") res = await attempt("picker", tabId);
    if (!res.ok) {
      if (res.code === "NO_MIC") void chrome.tabs.create({ url: chrome.runtime.getURL("permissions.html") }); // the page cannot show Chrome's microphone prompt
      error = plainStartError(res.code);
    } else {
      state = { ...emptyState(), connection: "connecting" };
    }
  } catch {
    error = plainStartError("FAILED");
  }
  busy = false;
  push(true);
}

async function savePrefs(): Promise<void> {
  await chrome.storage.session.set({ [PREFS_KEY]: { mic: wantMic, room: wantRoom } });
}

// ---------------------------------------------------------------- messages
async function handle(msg: BackgroundMessage, tabId: number | undefined): Promise<OverlayView | Reply | void> {
  await load();
  switch (msg.type) {
    case "RELAY_STATE":
      state = msg.state;
      push();
      return;
    case "RELAY_LEVEL":
      levels = { ...levels, [msg.source]: msg.level };
      push();
      return;

    case "UI_HELLO":
      if (tabId !== undefined) windows.add(tabId);
      return view();

    case "UI_PAIR": {
      busy = true;
      error = "";
      push(true);
      try {
        if (msg.server && msg.server.trim() && msg.server.trim() !== apiBase) {
          apiBase = normalizeApiBase(msg.server);
          await saveApiBase(apiBase);
        }
        paired = await redeemPairingCode(apiBase, msg.code.trim());
        await savePairedSession(paired);
        state = emptyState();
      } catch (err) {
        error = err instanceof PairingError ? err.message : "Could not connect. Check your internet and try again.";
      }
      busy = false;
      return view();
    }

    case "UI_PREFS":
      wantMic = msg.mic;
      wantRoom = msg.room;
      await savePrefs();
      return view();

    case "UI_START":
      if (tabId !== undefined) void start(tabId);
      return view();

    case "UI_CONTROL": {
      const map = { PAUSE: "OFFSCREEN_PAUSE", RESUME: "OFFSCREEN_RESUME", STOP: "OFFSCREEN_STOP" } as const;
      await toOffscreen({ target: "offscreen", type: map[msg.action] }).catch(() => null);
      if (msg.action === "STOP") setTimeout(() => chrome.offscreen.closeDocument().catch(() => {}), 4000); // let the session finish first
      return view();
    }

    case "UI_UNPAIR":
      await toOffscreen({ target: "offscreen", type: "OFFSCREEN_STOP" }).catch(() => null);
      await clearPairedSession();
      paired = null;
      state = emptyState();
      levels = { tab: 0, microphone: 0 };
      error = "";
      return view();

    case "UI_SCREEN": {
      if (tabId === undefined) return view();
      try {
        const tab = await chrome.tabs.get(tabId);
        const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 70 });
        await toOffscreen({ target: "offscreen", type: "OFFSCREEN_IMAGE", image: dataUrl.split(",")[1] ?? "", mime: "image/jpeg" });
        error = "";
      } catch {
        error = "Could not take a picture of this tab. Click the Vren icon on it first.";
      }
      return view();
    }

    case "UI_CLOSE":
      if (tabId !== undefined) windows.delete(tabId);
      return;
  }
}

export default defineBackground(() => {
  chrome.runtime.onMessage.addListener((raw: BackgroundMessage, sender, sendResponse) => {
    if (!raw || raw.target !== "background") return false;
    handle(raw, sender.tab?.id).then((r) => sendResponse(r ?? null), () => sendResponse(null));
    return true;
  });

  // Clicking the icon is what lets Chrome grant "this tab only" access (activeTab): it shows the box on this
  // tab and allows listening to this tab's sound. Clicking again brings the box back if it was closed.
  chrome.action.onClicked.addListener(async (tab) => {
    if (tab.id === undefined) return;
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["/content-scripts/overlay.js"] });
    } catch {
      // Chrome's own pages and the Web Store cannot be changed by extensions.
      void chrome.action.setBadgeText({ tabId: tab.id, text: "×" });
      void chrome.action.setTitle({ tabId: tab.id, title: "Vren AI can't run on this page. Open your meeting tab and click again." });
      setTimeout(() => void chrome.action.setBadgeText({ tabId: tab.id!, text: "" }), 3000);
    }
  });
});
