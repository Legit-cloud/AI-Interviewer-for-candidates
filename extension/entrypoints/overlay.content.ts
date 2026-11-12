import { mountOverlay, type OverlayHandle } from "../lib/overlay";
import type { OverlayPush, UiMessage } from "../lib/types";

// Injected on demand into the tab where the Vren icon was clicked (activeTab). It is not registered for any site.
export default defineContentScript({
  matches: ["<all_urls>"],
  registration: "runtime",
  main() {
    let handle: OverlayHandle | null = null;

    const send = (msg: UiMessage) => {
      void chrome.runtime.sendMessage(msg).then((view) => {
        // Some actions answer with a fresh view straight away.
        if (view && typeof view === "object" && "phase" in view) handle?.update(view as never);
      }).catch(() => {});
    };
    const close = () => {
      handle?.destroy();
      handle = null;
      send({ target: "background", type: "UI_CLOSE" });
    };

    handle = mountOverlay(document, send, close);
    chrome.runtime.onMessage.addListener((msg: OverlayPush) => {
      if (msg?.target !== "overlay") return;
      if (msg.type === "CLOSE") {
        handle?.destroy();
        handle = null;
      } else if (msg.type === "VIEW") {
        handle?.update(msg.view);
      }
    });
    send({ target: "background", type: "UI_HELLO" });
  },
});
