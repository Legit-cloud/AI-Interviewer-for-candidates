import { CaptureEngine } from "../../lib/capture";
import { reduceEvent } from "../../lib/state";
import {
  emptyState,
  type OffscreenMessage,
  type PanelMessage,
  type PanelState,
  type ServerEvent,
} from "../../lib/types";

let engine: CaptureEngine | null = null;
let state: PanelState = emptyState();

function toPanel(msg: PanelMessage): void {
  chrome.runtime.sendMessage(msg).catch(() => {
    /* the panel may be closed; state is kept here for when it reopens */
  });
}

async function start(streamId: string, wsUrl: string): Promise<void> {
  engine?.stop();
  state = emptyState();

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId } },
    video: false,
  } as MediaStreamConstraints);

  engine = new CaptureEngine(wsUrl, stream, {
    onEvent: (event: ServerEvent) => {
      state = reduceEvent(state, event);
      toPanel({ target: "panel", type: "SERVER_EVENT", event });
    },
    onStatus: (status, detail) => {
      state = { ...state, connection: status };
      toPanel({ target: "panel", type: "STATUS", status, ...(detail ? { detail } : {}) });
    },
  });
  await engine.start();
}

chrome.runtime.onMessage.addListener((raw: OffscreenMessage, _sender, sendResponse) => {
  if (!raw || raw.target !== "offscreen") return false;
  switch (raw.type) {
    case "OFFSCREEN_START":
      start(raw.streamId, raw.wsUrl)
        .then(() => sendResponse({ ok: true }))
        .catch((err: unknown) => {
          engine?.stop();
          engine = null;
          sendResponse({ ok: false, error: err instanceof Error ? err.message : "Could not capture the tab audio." });
        });
      return true;
    case "OFFSCREEN_PAUSE":
      engine?.pause();
      sendResponse({ ok: true });
      return false;
    case "OFFSCREEN_RESUME":
      engine?.resume();
      sendResponse({ ok: true });
      return false;
    case "OFFSCREEN_STOP":
      engine?.stop();
      sendResponse({ ok: true });
      return false;
    case "OFFSCREEN_SNAPSHOT":
      sendResponse({ ok: true, active: engine !== null, state });
      return false;
    default:
      return false;
  }
});
