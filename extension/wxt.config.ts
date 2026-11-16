import { defineConfig } from "wxt";

// API origin the extension may call. Override at build time: WXT_API_ORIGIN=https://api.example.com npm run build
const apiOrigin = process.env.WXT_API_ORIGIN ?? "http://localhost:8000";

// Only used by the automated browser test, so the test can predict the extension id. Never set for a release.
const testKey = process.env.WXT_E2E_PUBLIC_KEY;

export default defineConfig({
  outDir: "dist",
  hooks: {
    // WXT adds "<all_urls>" because the on-page box is a runtime content script. That would give the extension access to
    // every website. The box is injected only into the tab where the icon is clicked (activeTab), so it is removed.
    "build:manifestGenerated": (_wxt, manifest) => {
      manifest.host_permissions = (manifest.host_permissions ?? []).filter((h: string) => h !== "<all_urls>" && !h.startsWith("*://"));
    },
  },
  manifest: {
    ...(testKey ? { key: testKey } : {}),
    name: "Vren AI",
    short_name: "Vren AI",
    description:
      "Click the icon on your meeting tab to show a small box with your interview answers. When you press Start it streams the sound you chose to Vren AI so it can write answers.",
    // The box is injected only into the tab where you click the Vren icon (activeTab). Nothing is registered for any site.
    permissions: ["tabCapture", "desktopCapture", "offscreen", "activeTab", "scripting", "storage"],
    // WXT_E2E_HOSTS is only used by the automated browser test, to stand in for the toolbar click. Never set for a release.
    host_permissions: [`${apiOrigin}/*`, ...(process.env.WXT_E2E_HOSTS ? [process.env.WXT_E2E_HOSTS] : [])],
    action: { default_title: "Show Vren AI on this tab" },
    icons: { "16": "icon/16.png", "48": "icon/48.png", "128": "icon/128.png" },
    web_accessible_resources: [],
  },
});
