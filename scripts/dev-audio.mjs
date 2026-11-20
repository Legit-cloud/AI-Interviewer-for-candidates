import { spawn } from "node:child_process";
import net from "node:net";

function isPortInUse(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(600);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => {
      resolve(false);
    });
    socket.connect(port, host);
  });
}

const port = Number(process.env.AUDIO_WS_PORT) || 8081;
const busy = await isPortInUse(port);

if (busy) {
  console.log(`[audio-ws] Audio server already listening on ws://127.0.0.1:${port}`);
  const keepAlive = setInterval(() => {}, 60000);
  const shutdown = () => {
    clearInterval(keepAlive);
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
} else {
  const child = spawn("node", ["src/server/audioWsServer.ts"], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  child.on("exit", (code) => process.exit(code ?? 0));

  const stopChild = () => {
    if (process.platform === "win32" && child.pid) {
      spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
    } else {
      child.kill("SIGTERM");
    }
  };

  process.on("SIGINT", stopChild);
  process.on("SIGTERM", stopChild);
}
