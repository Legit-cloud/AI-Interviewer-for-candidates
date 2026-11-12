import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

// Two pages: the control window and the answers box. They share the small, window-free logic in ../extension/lib
// (event reducer, plain wording), so the extension and the desktop app always read the server the same way.
export default defineConfig({
  clearScreen: false,
  server: { port: 1420, strictPort: true, fs: { allow: [".."] } },
  build: {
    outDir: "dist",
    target: "es2022",
    rollupOptions: { input: { main: resolve(__dirname, "index.html"), overlay: resolve(__dirname, "overlay.html") } },
  },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
