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
    description: "Real-time interview preparation and live guidance floating companion grounded in your context.",
    version: "0.1.0",
    permissions: ["tabCapture", "offscreen", "storage", "tabs", "scripting"],
    host_permissions: [
      "http://127.0.0.1/*",
      "http://localhost/*",
      "http://*/*",
      "https://*/*",
    ],
    action: {
      default_title: "Toggle Vren AI Floating Widget",
    },
    web_accessible_resources: [
      {
        resources: ["pcm-processor.js"],
        matches: ["http://*/*", "https://*/*"],
      },
    ],
    icons: {
      "16": "icon/16.png",
      "48": "icon/48.png",
      "128": "icon/128.png",
    },
  },
});

