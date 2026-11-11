const statusEl = document.getElementById("status") as HTMLDivElement;
const allowBtn = document.getElementById("allow-btn") as HTMLButtonElement;
const closeBtn = document.getElementById("close-btn") as HTMLButtonElement;

function setStatus(text: string, tone: "neutral" | "ok" | "err") {
  statusEl.textContent = text;
  statusEl.className = tone === "ok" ? "status ok" : tone === "err" ? "status err" : "status";
}

async function notifySidePanel(granted: boolean) {
  await chrome.storage.local.set({ vren_mic_granted: granted });
  chrome.runtime
    .sendMessage({ target: "sidepanel", type: "MIC_PERMISSION_UPDATED", granted })
    .catch(() => {});
}

async function requestMicAccess() {
  allowBtn.disabled = true;
  setStatus("Waiting for Chrome microphone permission prompt...", "neutral");
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const track of stream.getTracks()) track.stop();
    setStatus("Microphone access granted. Returning you to Vren AI...", "ok");
    await notifySidePanel(true);
    window.setTimeout(() => {
      window.close();
    }, 900);
  } catch (err) {
    const msg =
      err instanceof Error && err.name === "NotAllowedError"
        ? "Permission blocked. Click the lock/mic icon in Chrome's address bar and set Microphone to Allow, then click Allow microphone."
        : "No microphone detected or permission dismissed. Check your Chrome audio settings and try again.";
    setStatus(msg, "err");
    await notifySidePanel(false);
  } finally {
    allowBtn.disabled = false;
  }
}

async function init() {
  try {
    const perm = await navigator.permissions.query({ name: "microphone" as PermissionName });
    if (perm.state === "granted") {
      setStatus("Microphone access is already allowed for Vren AI.", "ok");
      await notifySidePanel(true);
    } else if (perm.state === "denied") {
      setStatus(
        "Microphone is currently blocked for Vren AI. Click the address bar site icon to reset it, or click Allow microphone below.",
        "err",
      );
    } else {
      setStatus("Click Allow microphone below to enable your mic.", "neutral");
    }
  } catch {
    setStatus("Click Allow microphone below to enable your mic.", "neutral");
  }
}

allowBtn.addEventListener("click", () => {
  void requestMicAccess();
});
closeBtn.addEventListener("click", () => {
  window.close();
});

void init();

