import { CaptureEngine, type SourceSpec } from "../../lib/capture";
import { reduceEvent } from "../../lib/state";
import { emptyState, type OffscreenMessage, type PanelMessage, type PanelState, type ServerEvent } from "../../lib/types";

let engine: CaptureEngine | null = null;
let micFailed = false;
let state: PanelState = emptyState();

function relayToOverlay(): void {
  chrome.runtime.sendMessage({ target: "background", type: "OVERLAY_STATE", state }).catch(() => {});
}

function toPanel(msg: PanelMessage): void {
  chrome.runtime.sendMessage(msg).catch(() => {
    /* the panel may be closed; the state is kept here for when it reopens */
  });
}

async function start(streamId: string, kind: "tab" | "desktop" | "none", wsUrl: string, mic: boolean): Promise<void> {
  engine?.stop();
  state = emptyState();

  const specs: SourceSpec[] = [];
  let stream: MediaStream | null = null;
  if (kind !== "none") {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { mandatory: { chromeMediaSource: kind, chromeMediaSourceId: streamId } },
      video: false,
    } as MediaStreamConstraints);
    // A captured tab goes quiet unless it is played back. Shared screen sound already plays, so it must not.
    specs.push({ source: "tab", stream, passthrough: kind === "tab" });
  }

  micFailed = false;
  if (mic || kind === "none") {
    try {
      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
      specs.push({ source: "microphone", stream: micStream, passthrough: false });
    } catch (err) {
      micFailed = true; // the sound from the tab is fine, only the microphone is not
      stream?.getTracks().forEach((t) => t.stop());
      throw err;
    }
  }

  engine = new CaptureEngine(wsUrl, specs, kind === "none", {
    onEvent: (event: ServerEvent) => {
      state = reduceEvent(state, event);
      toPanel({ target: "panel", type: "SERVER_EVENT", event });
      relayToOverlay();
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
      start(raw.streamId, raw.streamKind, raw.wsUrl, raw.mic)
        .then(() => sendResponse({ ok: true }))
        .catch((err: unknown) => {
          engine?.stop();
          engine = null;
          const name = err instanceof DOMException ? err.name : "";
          sendResponse({
            ok: false,
            code: raw.mic && (name === "NotAllowedError" || name === "NotFoundError") && micFailed ? "NO_MIC" : "FAILED",
            error: err instanceof Error ? `${err.name}: ${err.message}` : "Could not capture the sound.",
          });
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
    case "OFFSCREEN_IMAGE":
      engine?.sendImage(raw.image, raw.mime);
      sendResponse({ ok: engine !== null });
      return false;
    case "OFFSCREEN_SNAPSHOT":
      sendResponse({ ok: true, active: engine !== null, state });
      return false;
    default:
      return false;
  }
});
