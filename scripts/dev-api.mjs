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

const busy = await isPortInUse(8000);
if (busy) {
  console.log("[api] Backend already listening on http://127.0.0.1:8000");
  const keepAlive = setInterval(() => {}, 60000);
  const shutdown = () => {
    clearInterval(keepAlive);
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
} else {
  const child = spawn(
    "uv",
    ["--directory", "backend", "run", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000", "--reload"],
    { stdio: "inherit", shell: false },
  );
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
