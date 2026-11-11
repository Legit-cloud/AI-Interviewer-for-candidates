export default defineContentScript({
  matches: ["http://localhost/*", "http://127.0.0.1/*"],
  runAt: "document_idle",
  main() {
    window.addEventListener("message", (event) => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const data = event.data as { source?: string; type?: string; token?: string } | null;
      if (!data || data.source !== "vren-webapp") return;

      if (data.type === "VREN_EXTENSION_PING") {
        window.postMessage(
          { source: "vren-extension", type: "VREN_EXTENSION_PONG" },
          window.location.origin,
        );
        return;
      }

      if (data.type === "VREN_PAIR_TOKEN" && typeof data.token === "string") {
        chrome.runtime.sendMessage(
          {
            type: "PAIR_FROM_WEBAPP",
            token: data.token,
            webOrigin: window.location.origin,
          },
          (res) => {
            if (chrome.runtime.lastError) return;
            if (res?.ok) {
              window.postMessage(
                { source: "vren-extension", type: "VREN_EXTENSION_PAIRED" },
                window.location.origin,
              );
            }
          },
        );
        return;
      }

      if (data.type === "VREN_EXTENSION_REVOKE") {
        chrome.runtime.sendMessage({ type: "REVOKE_FROM_WEBAPP" });
      }
    });

    // Proactively announce availability in case Settings mounted before content script idle.
    window.postMessage(
      { source: "vren-extension", type: "VREN_EXTENSION_PONG" },
      window.location.origin,
    );
  },
});

