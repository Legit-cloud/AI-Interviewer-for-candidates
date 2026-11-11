import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "wxt";

export default defineConfig({
  outDir: "dist",
  modules: ["@wxt-dev/module-react"],
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  manifest: {
    name: "Vren AI",
    short_name: "Vren AI",
    description: "Real-time interview preparation and live guidance side panel grounded in your context.",
    version: "0.1.0",
    permissions: ["sidePanel", "tabCapture", "offscreen", "storage", "tabs"],
    host_permissions: ["http://127.0.0.1/*", "http://localhost/*"],
    action: {
      default_title: "Open Vren AI Side Panel",
    },
    side_panel: {
      default_path: "sidepanel.html",
    },
    icons: {
      "16": "icon/16.png",
      "48": "icon/48.png",
      "128": "icon/128.png",
    },
  },
});

