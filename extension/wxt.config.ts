import { defineConfig } from "wxt";

// API origin the extension may call. Override at build time: WXT_API_ORIGIN=https://api.example.com npm run build
const apiOrigin = process.env.WXT_API_ORIGIN ?? "http://localhost:8000";

// Only used by the automated browser test, so the test can predict the extension id. Never set for a release.
const testKey = process.env.WXT_E2E_PUBLIC_KEY;

export default defineConfig({
  outDir: "dist",
  manifest: {
    ...(testKey ? { key: testKey } : {}),
    name: "Vren AI",
    short_name: "Vren AI",
    description:
      "Shows the answers from your Vren AI interview session in a side panel. When you press Start capture it streams the audio of the tab you chose to Vren AI for live transcription.",
    // The panel and capture relay need no page access. The optional on-page overlay is injected only into
    // the tab you choose, on request (activeTab); nothing is registered for any site.
    permissions: ["sidePanel", "tabCapture", "desktopCapture", "offscreen", "activeTab", "scripting", "storage"],
    host_permissions: [`${apiOrigin}/*`],
    action: { default_title: "Open Vren AI" },
    icons: { "16": "icon/16.png", "48": "icon/48.png", "128": "icon/128.png" },
    web_accessible_resources: [],
  },
});
