import { LiveCaptureEngine } from "../../lib/live-capture";
import type {
  ControlOffscreenPayload,
  OffscreenLiveEvent,
  StartOffscreenCapturePayload,
} from "../../lib/types";

let engine: LiveCaptureEngine | null = null;

function emit(event: OffscreenLiveEvent) {
  chrome.runtime.sendMessage(event).catch(() => {});
}

async function startCapture(msg: StartOffscreenCapturePayload) {
  if (engine) {
    engine.stop(false);
    engine = null;
  }

  let tabStream: MediaStream | null = null;
  if (msg.captureTab && msg.streamId) {
    tabStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: "tab",
          chromeMediaSourceId: msg.streamId,
        },
      } as MediaTrackConstraints,
      video: false,
    });
  }

  let micStream: MediaStream | null = null;
  if (msg.captureMic) {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
  }

  const nextEngine = new LiveCaptureEngine({
    wsUrl: msg.wsUrl,
    wsToken: msg.wsToken,
    captureTab: msg.captureTab,
    captureMic: msg.captureMic,
    remoteStream: tabStream,
    micStream,
    passthroughRemoteAudio: true,
    onEvent: emit,
  });
  engine = nextEngine;
  await nextEngine.start();
}

chrome.runtime.onMessage.addListener(
  (message: StartOffscreenCapturePayload | ControlOffscreenPayload, _sender, sendResponse) => {
    if (!message || message.target !== "offscreen") return false;

    if (message.type === "OFFSCREEN_START") {
      void startCapture(message)
        .then(() => sendResponse({ ok: true }))
        .catch((err) => {
          engine?.stop(false);
          engine = null;
          sendResponse({
            ok: false,
            error: err instanceof Error ? err.message : "Could not capture tab audio.",
          });
        });
      return true;
    }

    if (message.type === "OFFSCREEN_PAUSE" && engine) {
      engine.pause();
      sendResponse({ ok: true });
      return false;
    }

    if (message.type === "OFFSCREEN_RESUME" && engine) {
      engine.resume();
      sendResponse({ ok: true });
      return false;
    }

    if (message.type === "OFFSCREEN_STOP") {
      if (engine) {
        engine.stop(true);
        engine = null;
      }
      sendResponse({ ok: true });
      return false;
    }

    if (message.type === "OFFSCREEN_SIMULATE" && engine) {
      const sent = engine.sendUtterance(message.text || "", message.source || "tab");
      sendResponse(sent ? { ok: true } : { ok: false, error: "Live socket is not connected yet." });
      return false;
    }

    return false;
  },
);
