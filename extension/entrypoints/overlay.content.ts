import { mountOverlay, type OverlayHandle } from "../lib/overlay";
import type { PanelState } from "../lib/types";

// Injected on demand into the one tab the user chose (activeTab). It is not registered for any site.
export default defineContentScript({
  matches: ["<all_urls>"],
  registration: "runtime",
  main() {
    let handle: OverlayHandle | null = null;
    const close = () => {
      handle?.destroy();
      handle = null;
      void chrome.runtime.sendMessage({ target: "background", type: "OVERLAY_DISABLE" });
    };
    handle = mountOverlay(document, {
      onClose: close,
      onControl: (action) => void chrome.runtime.sendMessage({ target: "background", type: "OVERLAY_CONTROL", action }),
    });
    chrome.runtime.onMessage.addListener((msg: { target?: string; type?: string; state?: PanelState }) => {
      if (msg?.target !== "overlay") return;
      if (msg.type === "CLOSE") {
        handle?.destroy();
        handle = null;
      } else if (msg.type === "STATE" && msg.state) {
        handle?.update(msg.state);
      }
    });
    void chrome.runtime.sendMessage({ target: "offscreen", type: "OFFSCREEN_SNAPSHOT" }).then((snap: { state?: PanelState } | undefined) => {
      if (snap?.state) handle?.update(snap.state);
    });
  },
});
